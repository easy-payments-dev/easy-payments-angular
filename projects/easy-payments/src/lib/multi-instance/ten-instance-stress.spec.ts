import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { BrowserGuard } from '../utils/browser-guard';
import { FakeBrowserGuard, SAMPLE_PRODUCT } from '../testing/test-doubles';
import { MockPaymentController } from '../adapters/mock/mock-payment.controller';
import { EasyPaymentsComponent } from '../components/payments/easy-payments.component';
import { EasyPaymentButtonsComponent } from '../components/payment-buttons/easy-payment-buttons.component';
import { StripeRedirectRecoveryService } from '../adapters/stripe/stripe-redirect-recovery.service';
import { ApplePayAdapter } from '../adapters/apple-pay/apple-pay.adapter';
import { StripeCardMockAdapter } from '../adapters/stripe/stripe-card.adapter';
import { AdapterFactory } from '../adapters/adapter.factory';
import { PaymentError } from '../errors/payment-error';
import { PaymentMethod, PaymentProduct, PaymentResult } from '../models';

type Kind = 'buttons' | 'checkout';

interface Host {
  kind: Kind;
  fixture: ComponentFixture<EasyPaymentButtonsComponent | EasyPaymentsComponent>;
  successes: PaymentResult[];
  errors: PaymentError[];
  cancels: PaymentResult[];
  started: unknown[];
  methodChanges: unknown[];
  destroyed: boolean;
}

function product(i: number): PaymentProduct {
  return { ...SAMPLE_PRODUCT, id: `plan-${i}`, name: `Plan Number ${i}`, amount: 10 + i };
}

function createHost(kind: Kind, i: number, methods: PaymentMethod[], extra: Record<string, unknown> = {}): Host {
  const fixture =
    kind === 'buttons'
      ? TestBed.createComponent(EasyPaymentButtonsComponent)
      : TestBed.createComponent(EasyPaymentsComponent);
  fixture.componentRef.setInput('product', product(i));
  fixture.componentRef.setInput('methods', methods);
  for (const [key, value] of Object.entries(extra)) {
    fixture.componentRef.setInput(key, value);
  }
  const host: Host = {
    kind,
    fixture,
    successes: [],
    errors: [],
    cancels: [],
    started: [],
    methodChanges: [],
    destroyed: false,
  };
  const c = fixture.componentInstance;
  c.success.subscribe((r: PaymentResult) => host.successes.push(r));
  c.error.subscribe((e: PaymentError) => host.errors.push(e));
  c.cancel.subscribe((r: PaymentResult) => host.cancels.push(r));
  c.started.subscribe((s: unknown) => host.started.push(s));
  c.methodChange.subscribe((m: unknown) => host.methodChanges.push(m));
  return host;
}

function destroy(host: Host): void {
  host.fixture.destroy();
  host.destroyed = true;
}

async function settle(hosts: Host[]): Promise<void> {
  const live = hosts.filter((h) => !h.destroyed);
  live.forEach((h) => h.fixture.detectChanges());
  for (const h of live) {
    await h.fixture.whenStable();
  }
  live.forEach((h) => h.fixture.detectChanges());
}

function el(host: Host): HTMLElement {
  return host.fixture.nativeElement as HTMLElement;
}

function slotMethods(host: Host): string[] {
  return Array.from(el(host).querySelectorAll('.ep-payment-buttons__item[data-method]')).map(
    (node) => node.getAttribute('data-method') ?? '',
  );
}

function slot(host: Host, method: string): HTMLElement | null {
  return el(host).querySelector(`.ep-payment-buttons__item[data-method="${method}"]`);
}

/** Selects Card on a buttons host and returns its mock pay CTA. */
function openButtonsCard(host: Host): HTMLButtonElement {
  slot(host, 'card')!.querySelector('button')!.dispatchEvent(new Event('click'));
  host.fixture.detectChanges();
  return el(host).querySelector(
    '[data-testid="easy-payment-buttons-card-mock-panel"] button.ep-mock-panel__cta',
  ) as HTMLButtonElement;
}

function checkoutCta(host: Host): HTMLButtonElement {
  return el(host).querySelector('button.ep-mock-panel__cta, button.ep-stripe-card__pay') as HTMLButtonElement;
}

function view(host: Host): string {
  return (host.fixture.componentInstance as EasyPaymentsComponent).viewState();
}

function terminalCount(host: Host): number {
  return host.successes.length + host.errors.length + host.cancels.length;
}

const ALL: PaymentMethod[] = ['apple-pay', 'google-pay', 'paypal', 'card', 'klarna', 'affirm'];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Ten-instance stress (mock mode)', () => {
  let mock: MockPaymentController;
  let hosts: Host[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent, EasyPaymentsComponent],
      providers: [
        provideEasyPayments({ enableMockMode: true, providers: {} }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
      ],
    }).compileComponents();
    mock = TestBed.inject(MockPaymentController);
    mock.reset();
    hosts = [];
  });

  afterEach(() => {
    hosts.filter((h) => !h.destroyed).forEach(destroy);
    mock.reset();
  });

  it('S1: ten buttons hosts render independent six-method lists and select independently', async () => {
    hosts = Array.from({ length: 10 }, (_, i) => createHost('buttons', i, ALL));
    await settle(hosts);
    hosts.forEach((h) => expect(slotMethods(h)).toEqual(ALL));

    openButtonsCard(hosts[3]);
    hosts.forEach((h, i) => {
      const selected = (h.fixture.componentInstance as EasyPaymentButtonsComponent).selectedMethod();
      expect(selected).withContext(`host ${i}`).toBe(i === 3 ? 'card' : null);
      expect(h.methodChanges.length).withContext(`host ${i}`).toBe(i === 3 ? 1 : 0);
    });
  });

  it('S2: ten full checkouts render their own product and pay independently', async () => {
    hosts = Array.from({ length: 10 }, (_, i) => createHost('checkout', i, ['card', 'paypal']));
    await settle(hosts);
    hosts.forEach((h, i) => {
      expect(el(h).textContent).toContain(`Plan Number ${i}`);
      expect(view(h)).toBe('checkout');
    });

    checkoutCta(hosts[5]).click();
    await settle(hosts);
    hosts.forEach((h, i) => {
      expect(h.successes.length).withContext(`host ${i}`).toBe(i === 5 ? 1 : 0);
      expect(view(h)).withContext(`host ${i}`).toBe(i === 5 ? 'success' : 'checkout');
    });
  });

  it('S3: 5 checkouts + 5 buttons interleaved stay isolated', async () => {
    hosts = Array.from({ length: 10 }, (_, i) =>
      createHost(i % 2 ? 'buttons' : 'checkout', i, ['card', 'paypal', 'klarna']),
    );
    await settle(hosts);

    openButtonsCard(hosts[1]).click();
    checkoutCta(hosts[4]).click();
    await settle(hosts);

    hosts.forEach((h, i) => {
      expect(h.successes.length).withContext(`host ${i}`).toBe(i === 1 || i === 4 ? 1 : 0);
      expect(h.errors.length).withContext(`host ${i}`).toBe(0);
    });
    expect(hosts[1].successes[0].method).toBe('card');
    expect(hosts[4].successes[0].method).toBe('card');
  });

  it('S4: different layouts, themes and locales per host do not bleed', async () => {
    hosts = Array.from({ length: 10 }, (_, i) =>
      createHost('buttons', i, ['card', 'paypal'], {
        layout: i % 2 ? 'horizontal' : 'vertical',
        theme: i % 3 === 0 ? 'dark' : 'light',
        locale: i % 2 ? 'es' : 'en',
      }),
    );
    await settle(hosts);
    hosts.forEach((h, i) => {
      expect(el(h).getAttribute('data-layout')).toBe(i % 2 ? 'horizontal' : 'vertical');
      expect(el(h).getAttribute('data-theme')).toBe(i % 3 === 0 ? 'dark' : 'light');
      expect(el(h).getAttribute('data-locale')).toBe(i % 2 ? 'es' : 'en');
    });
  });

  it('S5: same provider everywhere and different provider sets per host', async () => {
    const sets: PaymentMethod[][] = [
      ['card'],
      ['paypal'],
      ['google-pay', 'card'],
      ['apple-pay'],
      ['klarna', 'affirm'],
      ['card'],
      ['card'],
      ALL,
      ['affirm', 'paypal'],
      ['card'],
    ];
    hosts = sets.map((methods, i) => createHost('buttons', i, methods));
    await settle(hosts);
    hosts.forEach((h, i) => expect(slotMethods(h)).withContext(`host ${i}`).toEqual(sets[i]));
  });

  it('S6: destroying host #3 leaves the other nine working', async () => {
    hosts = Array.from({ length: 10 }, (_, i) => createHost('checkout', i, ['card']));
    await settle(hosts);
    destroy(hosts[2]);

    for (const i of [0, 9]) {
      checkoutCta(hosts[i]).click();
    }
    await settle(hosts);
    expect(hosts[0].successes.length).toBe(1);
    expect(hosts[9].successes.length).toBe(1);
    expect(terminalCount(hosts[2])).toBe(0);
    hosts.filter((h, i) => i !== 0 && i !== 9 && !h.destroyed).forEach((h) => expect(view(h)).toBe('checkout'));
  });

  it('S7: five destroy/recreate cycles of ten hosts leave no registered hosts or listeners', async () => {
    const recovery = TestBed.inject(StripeRedirectRecoveryService) as unknown as { hosts: unknown[] };
    const apple = TestBed.inject(ApplePayAdapter) as unknown as { availabilityListeners: Set<unknown> };
    const timings: number[] = [];
    for (let cycle = 0; cycle < 5; cycle++) {
      const t0 = performance.now();
      const batch = Array.from({ length: 10 }, (_, i) =>
        createHost(i % 2 ? 'buttons' : 'checkout', i, ALL),
      );
      await settle(batch);
      timings.push(performance.now() - t0);
      expect(recovery.hosts.length).toBe(10);
      expect(apple.availabilityListeners.size).toBe(10);
      batch.forEach(destroy);
      expect(recovery.hosts.length).toBe(0);
      expect(apple.availabilityListeners.size).toBe(0);
    }
    console.log(
      `[perf] 10 mixed hosts mount+settle (ms) per cycle: ${timings.map((t) => t.toFixed(1)).join(', ')}`,
    );
  });

  it('S8: changing one host product does not affect the others', async () => {
    hosts = Array.from({ length: 10 }, (_, i) => createHost('buttons', i, ['card', 'paypal']));
    await settle(hosts);
    openButtonsCard(hosts[0]);
    openButtonsCard(hosts[1]);

    hosts[2].fixture.componentRef.setInput('product', product(42));
    await settle(hosts);

    expect((hosts[0].fixture.componentInstance as EasyPaymentButtonsComponent).selectedMethod()).toBe('card');
    expect((hosts[1].fixture.componentInstance as EasyPaymentButtonsComponent).selectedMethod()).toBe('card');
    hosts.forEach((h) => expect(slotMethods(h)).toEqual(['card', 'paypal']));
    hosts.forEach((h) => expect(h.errors.length).toBe(0));
  });

  it('S9/S13: hosts destroyed during a pending (delayed) payment emit nothing; survivors finish', async () => {
    mock.setDelay(30);
    hosts = Array.from({ length: 10 }, (_, i) => createHost('checkout', i, ['card']));
    await settle(hosts);

    hosts.forEach((h) => checkoutCta(h).click());
    hosts.slice(0, 5).forEach(destroy);
    await wait(60);
    await settle(hosts);

    hosts.forEach((h, i) => {
      expect(terminalCount(h))
        .withContext(`host ${i}`)
        .toBe(i < 5 ? 0 : 1);
    });
    hosts.slice(5).forEach((h) => expect(h.successes.length).toBe(1));
  });

  it('S10/H: a Stripe init failure does not disable PayPal on any host', async () => {
    const card = TestBed.inject(StripeCardMockAdapter);
    spyOn(card, 'initialize').and.rejectWith(new Error('stripe init failed'));
    spyOn(console, 'warn');
    hosts = Array.from({ length: 10 }, (_, i) =>
      createHost(i % 2 ? 'buttons' : 'checkout', i, ['card', 'paypal']),
    );
    await settle(hosts);

    hosts
      .filter((h) => h.kind === 'buttons')
      .forEach((h) => {
        expect(el(h).getAttribute('data-card-ready')).toBe('false');
        expect(el(h).getAttribute('data-paypal-ready')).toBe('true');
      });

    const buttonsHost = hosts[1];
    (slot(buttonsHost, 'paypal')!.querySelector('button.ep-mock-panel__strip') as HTMLButtonElement).click();
    await settle(hosts);
    expect(buttonsHost.successes.length).toBe(1);
    expect(buttonsHost.successes[0].method).toBe('paypal');
  });

  it('S11/H: success on one host while others fail or cancel (independent outcomes)', async () => {
    hosts = Array.from({ length: 10 }, (_, i) => createHost('checkout', i, ['card', 'paypal']));
    await settle(hosts);

    mock.setOutcome('success');
    checkoutCta(hosts[0]).click();
    await settle(hosts);
    mock.setOutcome('failed');
    checkoutCta(hosts[1]).click();
    await settle(hosts);
    mock.setOutcome('cancelled');
    checkoutCta(hosts[2]).click();
    await settle(hosts);

    expect(view(hosts[0])).toBe('success');
    expect(hosts[0].successes.length).toBe(1);
    expect(hosts[1].errors.length).toBe(1);
    expect(hosts[1].successes.length).toBe(0);
    expect(hosts[2].cancels.length).toBe(1);
    expect(hosts[2].successes.length).toBe(0);
    hosts.slice(3).forEach((h) => {
      expect(terminalCount(h)).toBe(0);
      expect(view(h)).toBe('checkout');
    });

    // A failed host can retry without affecting the successful one.
    mock.setOutcome('success');
    expect(view(hosts[1])).toBe('error');
    (el(hosts[1]).querySelector('button.ep-outcome__action') as HTMLButtonElement).click();
    await settle(hosts);
    checkoutCta(hosts[1]).click();
    await settle(hosts);
    expect(hosts[1].successes.length).toBe(1);
    expect(hosts[0].successes.length).toBe(1);
  });

  it('S12: a card payment failure on one host does not block PayPal on another', async () => {
    const card = TestBed.inject(StripeCardMockAdapter);
    spyOn(card, 'createPayment').and.rejectWith(
      new PaymentError({ code: 'PAYMENT_FAILED', message: 'declined', method: 'card', provider: 'stripe' }),
    );
    hosts = [createHost('buttons', 0, ['card', 'paypal']), createHost('buttons', 1, ['card', 'paypal'])];
    await settle(hosts);

    openButtonsCard(hosts[0]).click();
    await settle(hosts);
    (slot(hosts[1], 'paypal')!.querySelector('button.ep-mock-panel__strip') as HTMLButtonElement).click();
    await settle(hosts);

    expect(hosts[0].errors.length).toBe(1);
    expect(hosts[0].successes.length).toBe(0);
    expect(hosts[1].successes.length).toBe(1);
    expect(hosts[1].errors.length).toBe(0);
  });

  it('S14: simultaneous attempts on ten hosts — one started/terminal per host, no double submit', async () => {
    mock.setDelay(20);
    hosts = Array.from({ length: 10 }, (_, i) => createHost('checkout', i, ['card']));
    await settle(hosts);

    hosts.forEach((h) => {
      const cta = checkoutCta(h);
      cta.click();
      cta.click();
    });
    await wait(50);
    await settle(hosts);

    hosts.forEach((h, i) => {
      expect(h.started.length).withContext(`host ${i}`).toBe(1);
      expect(h.successes.length).withContext(`host ${i}`).toBe(1);
    });
  });

  it('S15: a stale callback after remount does not reach the new host', async () => {
    mock.setDelay(30);
    const first = createHost('checkout', 0, ['card']);
    hosts = [first];
    await settle(hosts);
    checkoutCta(first).click();
    destroy(first);

    const remount = createHost('checkout', 0, ['card']);
    hosts.push(remount);
    await settle([remount]);
    await wait(60);
    await settle([remount]);

    expect(terminalCount(first)).toBe(0);
    expect(terminalCount(remount)).toBe(0);
    expect(view(remount)).toBe('checkout');

    checkoutCta(remount).click();
    await wait(60);
    await settle([remount]);
    expect(remount.successes.length).toBe(1);
  });

  it('initializes provider adapters once for ten concurrently mounted hosts', async () => {
    const factory = TestBed.inject(AdapterFactory);
    const init = spyOn(factory, 'initializeAdapters').and.callThrough();
    hosts = Array.from({ length: 10 }, (_, i) => createHost(i % 2 ? 'buttons' : 'checkout', i, ALL));
    await settle(hosts);
    expect(init.calls.count()).toBe(1);
  });
});
