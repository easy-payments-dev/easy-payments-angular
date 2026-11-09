import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { isDevMode, signal } from '@angular/core';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { MockPaymentController } from '../../adapters/mock/mock-payment.controller';
import { StripeRedirectRecoveryService } from '../../adapters/stripe/stripe-redirect-recovery.service';
import { CheckoutHostContext } from '../../services/checkout-host-context';
import { BrowserGuard } from '../../utils/browser-guard';
import { PaymentError } from '../../errors/payment-error';
import { PaymentMethodChangeEvent, PaymentResult, PaymentStartedEvent } from '../../models';
import { EasyPaymentsDiagnosticsService } from '../../diagnostics/easy-payments-diagnostics.service';
import { FakeBrowserGuard, SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { resetTestLocation, setTestLocation } from '../../testing/test-history';
import type { AvailablePaymentMethod } from '../../services/payment-orchestrator.service';
import { resetProviderDiagnosticsForTests } from '../../diagnostics/provider-diagnostics';
import { ApplePayAdapter } from '../../adapters/apple-pay/apple-pay.adapter';
import { StripeCardAdapter } from '../../adapters/stripe/stripe-card.adapter';
import { clearStripePendingReturn } from '../../adapters/stripe/stripe-redirect-return';
import { EasyPaymentsComponent } from './easy-payments.component';

async function render(fixture: ComponentFixture<EasyPaymentsComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

/** Apply a local readiness snapshot (tiles read the instance session, not root orchestrator). */
function applyInstanceAvailability(
  fixture: ComponentFixture<EasyPaymentsComponent>,
  results: AvailablePaymentMethod[],
): void {
  (
    fixture.componentInstance as unknown as {
      availabilitySession: { apply: (value: readonly AvailablePaymentMethod[]) => void };
    }
  ).availabilitySession.apply(results);
}

function tileLabels(fixture: ComponentFixture<EasyPaymentsComponent>): string[] {
  return fixture.debugElement
    .queryAll(By.css('button.ep-tile'))
    .map((button) => {
      const el = button.nativeElement as HTMLButtonElement;
      return el.getAttribute('aria-label') ?? '';
    });
}

function payCta(fixture: ComponentFixture<EasyPaymentsComponent>): HTMLButtonElement | null {
  return fixture.nativeElement.querySelector(
    'button.ep-mock-panel__cta, button.ep-stripe-card__pay',
  ) as HTMLButtonElement | null;
}

/** Compare computed `rgb()` / `rgba()` colors to expected 8-bit channels. */
function rgbCloseTo(cssColor: string, r: number, g: number, b: number, tolerance = 2): boolean {
  const match = cssColor.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!match) {
    return false;
  }
  return (
    Math.abs(Number(match[1]) - r) <= tolerance &&
    Math.abs(Number(match[2]) - g) <= tolerance &&
    Math.abs(Number(match[3]) - b) <= tolerance
  );
}

describe('EasyPaymentsComponent', () => {
  let fixture: ComponentFixture<EasyPaymentsComponent>;
  let browser: FakeBrowserGuard;

  beforeEach(async () => {
    browser = new FakeBrowserGuard();
    await TestBed.configureTestingModule({
      imports: [EasyPaymentsComponent],
      providers: [
        provideEasyPayments({ enableMockMode: true, providers: {} }),
        { provide: BrowserGuard, useValue: browser },
      ],
    }).compileComponents();

    TestBed.inject(MockPaymentController).reset();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
    fixture = TestBed.createComponent(EasyPaymentsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
  });

  afterEach(() => {
    resetTestLocation();
    clearStripePendingReturn();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
  });

  it('renders the requested methods in array order', async () => {
    fixture.componentRef.setInput('methods', ['paypal', 'apple-pay', 'card']);
    await render(fixture);

    expect(tileLabels(fixture)).toEqual([
      'PayPal, demo mode, selected',
      'Apple Pay, demo mode',
      'Card, demo mode',
    ]);
    expect(fixture.nativeElement.textContent).toContain('Complete your purchase');
    expect(fixture.nativeElement.textContent).toContain('Premium Plan');
  });

  it('updates visual order when the methods array changes', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);
    expect(tileLabels(fixture).map((label) => label.replace(/,.*/, ''))).toEqual(['Card', 'PayPal']);

    fixture.componentRef.setInput('methods', ['paypal', 'card']);
    await render(fixture);
    expect(tileLabels(fixture).map((label) => label.replace(/,.*/, ''))).toEqual(['PayPal', 'Card']);
  });

  it('hides methods that are not enabled in the methods array', async () => {
    fixture.componentRef.setInput('methods', ['card']);
    await render(fixture);

    expect(tileLabels(fixture)).toEqual(['Card, demo mode, selected']);
    expect(fixture.nativeElement.textContent).not.toContain('PayPal');
  });

  it('hides methods whose mock adapter reports unavailable', async () => {
    TestBed.inject(MockPaymentController).setUnavailableMethods(['paypal']);
    fixture.componentRef.setInput('methods', ['paypal', 'card']);
    await render(fixture);

    expect(tileLabels(fixture)).toEqual(['Card, demo mode, selected']);
  });

  it('selects a payment method and shows only that method panel', async () => {
    fixture.componentRef.setInput('methods', ['paypal', 'card']);
    await render(fixture);

    expect(fixture.componentInstance.selectedMethod()).toBe('paypal');
    expect(fixture.nativeElement.textContent).toContain('Pay with PayPal');

    const cardTile = fixture.debugElement
      .queryAll(By.css('button.ep-tile'))
      .find((btn) =>
        ((btn.nativeElement as HTMLButtonElement).getAttribute('aria-label') ?? '').includes('Card'),
      );
    cardTile!.nativeElement.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedMethod()).toBe('card');
    expect(fixture.nativeElement.textContent).toContain('Pay with Card');
    expect(fixture.nativeElement.querySelector('easy-mock-method-panel')).toBeTruthy();
  });

  it('keeps method tiles keyboard-focusable inside a radiogroup', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);

    const group = fixture.nativeElement.querySelector('[role="radiogroup"]') as HTMLElement;
    const tiles = Array.from(
      fixture.nativeElement.querySelectorAll('button.ep-tile'),
    ) as HTMLButtonElement[];
    expect(group).toBeTruthy();
    expect(tiles.length).toBe(2);
    expect(tiles[0].type).toBe('button');

    tiles[1].focus();
    expect(document.activeElement).toBe(tiles[1]);

    const pay = payCta(fixture);
    expect(pay).toBeTruthy();
    pay!.focus();
    expect(document.activeElement).toBe(pay);
  });

  it('exposes radiogroup accessibility attributes on the selector', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);

    const group = fixture.nativeElement.querySelector('[role="radiogroup"]');
    expect(group).toBeTruthy();
    const selected = fixture.nativeElement.querySelector('button.ep-tile[aria-checked="true"]');
    expect(selected).toBeTruthy();
  });

  it('renders a product summary with formatted amount', async () => {
    fixture.componentRef.setInput('methods', ['card']);
    await render(fixture);

    const summary = fixture.nativeElement.querySelector('easy-checkout-product-summary');
    expect(summary.textContent).toContain('Premium Plan');
    expect(summary.textContent).toMatch(/\$99\.99|USD/);
  });

  it('uses a CSS grid structure for payment method tiles', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal', 'klarna']);
    await render(fixture);

    const grid = fixture.nativeElement.querySelector('.ep-selector__grid');
    expect(grid).toBeTruthy();
    expect(getComputedStyle(grid).display).toBe('grid');
  });

  it('renders six methods in the supplied array order and selects the first', async () => {
    fixture.componentRef.setInput('methods', [
      'card',
      'paypal',
      'apple-pay',
      'google-pay',
      'klarna',
      'affirm',
    ]);
    await render(fixture);

    expect(tileLabels(fixture).map((label) => label.replace(/,.*/, ''))).toEqual([
      'Card',
      'PayPal',
      'Apple Pay',
      'Google Pay',
      'Klarna',
      'Affirm',
    ]);
    expect(fixture.componentInstance.selectedMethod()).toBe('card');
    expect(fixture.nativeElement.textContent).toContain('Pay with Card');
    expect(fixture.componentInstance.effectiveMaxWidth()).toBe(640);
    expect(fixture.nativeElement.style.maxWidth).toBe('640px');
  });

  it('keeps a Minimal-style Apple Pay bootstrap host while availability is unknown', async () => {
    const applePay = TestBed.inject(ApplePayAdapter);
    const configured = signal(true);
    spyOn(applePay, 'isConfigured').and.returnValue(true);
    Object.defineProperty(applePay, 'configured', {
      configurable: true,
      get: () => configured.asReadonly(),
    });
    spyOn(applePay, 'mountExpressCheckout').and.returnValue(
      Promise.resolve('legacy-singleton'),
    );
    spyOn(applePay, 'unmountExpressCheckout');

    fixture.componentRef.setInput('methods', ['card', 'apple-pay']);
    await render(fixture);

    applyInstanceAvailability(fixture, [
      { method: 'card', isMock: true, available: true, status: 'available' },
      { method: 'apple-pay', isMock: false, available: false, status: 'checking' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.showApplePayBootstrap()).toBeTrue();
    expect(fixture.componentInstance.hasRealApplePayMethod()).toBeFalse();
    expect(tileLabels(fixture).some((label) => label.startsWith('Apple Pay'))).toBeFalse();

    const bootstrap = fixture.nativeElement.querySelector(
      '.ep-apay-bootstrap__host',
    ) as HTMLElement | null;
    expect(bootstrap).toBeTruthy();
  });

  it('renders the Apple Pay express button in its list position once available', async () => {
    fixture.componentRef.setInput('methods', ['card', 'apple-pay', 'paypal']);
    await render(fixture);

    applyInstanceAvailability(fixture, [
      { method: 'card', isMock: true, available: true, status: 'available' },
      { method: 'apple-pay', isMock: false, available: true, status: 'available' },
      { method: 'paypal', isMock: true, available: true, status: 'available' },
    ]);
    fixture.detectChanges();

    expect(fixture.componentInstance.hasRealApplePayMethod()).toBeTrue();
    expect(fixture.componentInstance.showApplePayBootstrap()).toBeFalse();
    expect(fixture.componentInstance.applePayExpressInList()).toBeTrue();

    // Apple Pay is no longer a selectable tile: Stripe's own button takes that cell.
    expect(tileLabels(fixture).map((label) => label.replace(/,.*/, ''))).toEqual([
      'Card',
      'PayPal',
    ]);

    const cells = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.ep-selector__grid > easy-payment-method-tile, .ep-selector__grid > .ep-selector__express',
      ),
    );
    expect(cells.length).toBe(3);
    expect(cells[1].classList.contains('ep-selector__express')).toBeTrue();
    expect(cells[1].querySelector('easy-apple-pay-payment')).toBeTruthy();

    // Selecting it is a no-op; the express button owns the interaction.
    fixture.componentInstance.selectMethod('apple-pay');
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedMethod()).toBe('card');
    expect(fixture.componentInstance.showApplePayPanel()).toBeFalse();
  });

  it('hides Apple Pay when Stripe availability is false (no empty grid cell)', async () => {
    fixture.componentRef.setInput('methods', ['card', 'apple-pay', 'paypal']);
    await render(fixture);

    applyInstanceAvailability(fixture, [
      { method: 'card', isMock: true, available: true, status: 'available' },
      { method: 'apple-pay', isMock: false, available: false, status: 'unavailable' },
      { method: 'paypal', isMock: true, available: true, status: 'available' },
    ]);
    fixture.detectChanges();

    expect(fixture.componentInstance.hasRealApplePayMethod()).toBeFalse();
    expect(fixture.componentInstance.applePayExpressInList()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.ep-selector__express')).toBeNull();
    expect(tileLabels(fixture).map((label) => label.replace(/,.*/, ''))).toEqual([
      'Card',
      'PayPal',
    ]);
  });

  it('does not show Apple Pay when merchant methods omit it even if runtime says available (TEST D)', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);

    applyInstanceAvailability(fixture, [
      { method: 'card', isMock: true, available: true, status: 'available' },
      { method: 'apple-pay', isMock: false, available: true, status: 'available' },
      { method: 'paypal', isMock: true, available: true, status: 'available' },
    ]);
    fixture.detectChanges();

    expect(fixture.componentInstance.methods().includes('apple-pay')).toBeFalse();
    expect(fixture.componentInstance.hasRealApplePayMethod()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.ep-selector__express')).toBeNull();
    expect(fixture.nativeElement.querySelector('easy-apple-pay-payment')).toBeNull();
  });

  it('preserves merchant method order after runtime filtering (TEST I)', async () => {
    fixture.componentRef.setInput('methods', ['paypal', 'card', 'apple-pay', 'klarna']);
    await render(fixture);

    applyInstanceAvailability(fixture, [
      { method: 'paypal', isMock: true, available: true, status: 'available' },
      { method: 'card', isMock: true, available: true, status: 'available' },
      { method: 'apple-pay', isMock: false, available: true, status: 'available' },
      { method: 'klarna', isMock: true, available: true, status: 'available' },
    ]);
    fixture.detectChanges();

    const cells = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.ep-selector__grid > easy-payment-method-tile, .ep-selector__grid > .ep-selector__express',
      ),
    );
    expect(cells.length).toBe(4);
    expect(cells[0].tagName.toLowerCase()).toBe('easy-payment-method-tile');
    expect(cells[1].tagName.toLowerCase()).toBe('easy-payment-method-tile');
    expect(cells[2].classList.contains('ep-selector__express')).toBeTrue();
    expect(cells[3].tagName.toLowerCase()).toBe('easy-payment-method-tile');
    expect(tileLabels(fixture).map((label) => label.replace(/,.*/, ''))).toEqual([
      'PayPal',
      'Card',
      'Klarna',
    ]);
  });

  it('clears Apple Pay availability when merchant removes apple-pay from methods', async () => {
    const applePay = TestBed.inject(ApplePayAdapter);
    const clearSpy = spyOn(applePay, 'clearAvailability').and.callThrough();

    fixture.componentRef.setInput('methods', ['card', 'apple-pay']);
    await render(fixture);
    clearSpy.calls.reset();

    fixture.componentRef.setInput('methods', ['card']);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(clearSpy).toHaveBeenCalled();
  });

  it('clamps and applies maxWidth on the host', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixture.componentRef.setInput('maxWidth', 200);
    await render(fixture);
    expect(fixture.componentInstance.effectiveMaxWidth()).toBe(320);
    expect(fixture.nativeElement.style.maxWidth).toBe('320px');

    fixture.componentRef.setInput('maxWidth', 3000);
    fixture.detectChanges();
    expect(fixture.componentInstance.effectiveMaxWidth()).toBe(1200);

    fixture.componentRef.setInput('maxWidth', 'not-a-number');
    fixture.detectChanges();
    expect(fixture.componentInstance.effectiveMaxWidth()).toBe(640);

    fixture.componentRef.setInput('maxWidth', 900);
    fixture.detectChanges();
    expect(fixture.componentInstance.effectiveMaxWidth()).toBe(900);
    expect(fixture.nativeElement.style.maxWidth).toBe('900px');
  });

  it('defaults to appearance=default and stays backward compatible', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);

    expect(fixture.componentInstance.appearance()).toBe('default');
    expect(fixture.nativeElement.classList.contains('ep-appearance-transparent')).toBeFalse();
    expect(fixture.nativeElement.getAttribute('data-appearance')).toBe('default');

    const shell = fixture.nativeElement.querySelector('.ep-checkout') as HTMLElement;
    expect(shell).toBeTruthy();
    const style = getComputedStyle(shell);
    expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.borderTopWidth).not.toBe('0px');
  });

  it('applies transparent appearance by removing outer shell chrome only', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixture.componentRef.setInput('appearance', 'transparent');
    fixture.componentRef.setInput('theme', 'light');
    await render(fixture);

    expect(fixture.componentInstance.appearance()).toBe('transparent');
    expect(fixture.nativeElement.classList.contains('ep-appearance-transparent')).toBeTrue();
    expect(fixture.nativeElement.getAttribute('data-appearance')).toBe('transparent');
    expect(fixture.nativeElement.classList.contains('ep-theme-light')).toBeTrue();

    const shell = fixture.nativeElement.querySelector('.ep-checkout') as HTMLElement;
    const style = getComputedStyle(shell);
    expect(style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent').toBeTrue();
    expect(style.borderTopWidth).toBe('0px');
    expect(style.boxShadow === 'none' || style.boxShadow === '').toBeTrue();
    expect(style.paddingTop).toBe('0px');

    // Internal payment methods still render.
    expect(tileLabels(fixture).map((label) => label.replace(/,.*/, ''))).toEqual(['Card', 'PayPal']);
    expect(fixture.componentInstance.effectiveMaxWidth()).toBe(640);
  });

  it('keeps theme and appearance independent', async () => {
    fixture.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('theme', 'dark');
    fixture.componentRef.setInput('appearance', 'transparent');
    await render(fixture);

    expect(fixture.nativeElement.classList.contains('ep-theme-dark')).toBeTrue();
    expect(fixture.nativeElement.classList.contains('ep-appearance-transparent')).toBeTrue();
    expect(fixture.nativeElement.getAttribute('data-theme')).toBe('dark');
    expect(fixture.nativeElement.getAttribute('data-appearance')).toBe('transparent');
  });

  it('defaults visualStyle to null and does not set override CSS variables', async () => {
    fixture.componentRef.setInput('methods', ['card']);
    await render(fixture);

    expect(fixture.componentInstance.visualStyle()).toBeNull();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--ep-font-family')).toBe('');
    expect(host.style.getPropertyValue('--ep-text')).toBe('');
    expect(host.style.getPropertyValue('--ep-accent')).toBe('');
    expect(host.style.getPropertyValue('--ep-radius')).toBe('');
    expect(getComputedStyle(host).getPropertyValue('--ep-font-family').trim()).toContain('Segoe UI');
  });

  it('accepts optional cardButtonAppearance without changing mock CTA chrome', async () => {
    fixture.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('cardButtonAppearance', {
      label: 'Checkout with card',
      backgroundColor: '#111827',
      textColor: '#f8fafc',
      borderRadius: '6px',
    });
    await render(fixture);

    expect(fixture.componentInstance.cardButtonAppearance()).toEqual({
      label: 'Checkout with card',
      backgroundColor: '#111827',
      textColor: '#f8fafc',
      borderRadius: '6px',
    });
    expect(fixture.nativeElement.querySelector('easy-stripe-card-payment')).toBeNull();
    expect(payCta(fixture)?.textContent?.trim()).toMatch(/^Pay \$/);
  });

  it('keeps independent cardButtonAppearance inputs per Full Checkout instance', async () => {
    fixture.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('cardButtonAppearance', {
      label: 'Instance A',
      backgroundColor: '#aa0000',
    });
    await render(fixture);

    const fixtureB = TestBed.createComponent(EasyPaymentsComponent);
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixtureB.componentRef.setInput('methods', ['card']);
    fixtureB.componentRef.setInput('cardButtonAppearance', {
      label: 'Instance B',
      backgroundColor: '#00aa00',
    });
    await render(fixtureB);

    expect(fixture.componentInstance.cardButtonAppearance()?.label).toBe('Instance A');
    expect(fixtureB.componentInstance.cardButtonAppearance()?.label).toBe('Instance B');
    expect(fixture.componentInstance.cardButtonAppearance()?.backgroundColor).toBe('#aa0000');
    expect(fixtureB.componentInstance.cardButtonAppearance()?.backgroundColor).toBe('#00aa00');
    fixtureB.destroy();
  });

  it('applies valid visualStyle overrides as host CSS variables', async () => {
    fixture.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('theme', 'light');
    fixture.componentRef.setInput('visualStyle', {
      fontFamily: 'inherit',
      textColor: '#112233',
      textSecondaryColor: '#445566',
      backgroundColor: 'transparent',
      surfaceColor: '#fefefe',
      accentColor: '#0b6e4f',
      borderRadius: '12px',
      spacing: '20px',
    });
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--ep-font-family').trim()).toBe('inherit');
    expect(host.style.getPropertyValue('--ep-text').trim()).toBe('#112233');
    expect(host.style.getPropertyValue('--ep-text-secondary').trim()).toBe('#445566');
    expect(host.style.getPropertyValue('--ep-background').trim()).toBe('transparent');
    expect(host.style.getPropertyValue('--ep-surface').trim()).toBe('#fefefe');
    expect(host.style.getPropertyValue('--ep-accent').trim()).toBe('#0b6e4f');
    expect(host.style.getPropertyValue('--ep-focus').trim()).toBe('#0b6e4f');
    expect(host.style.getPropertyValue('--ep-accent-soft').trim()).toContain('color-mix');
    expect(host.style.getPropertyValue('--ep-accent-soft').trim()).toContain('#0b6e4f');
    expect(host.style.getPropertyValue('--ep-radius').trim()).toBe('12px');
    // md radius stays derived in SCSS (not flattened to the same inline value).
    expect(host.style.getPropertyValue('--ep-radius-md')).toBe('');
    expect(getComputedStyle(host).getPropertyValue('--ep-radius-md').trim()).toMatch(
      /calc\(\s*12px\s*\*\s*0\.625\s*\)/,
    );
    expect(host.style.getPropertyValue('--ep-spacing').trim()).toBe('20px');
  });

  it('ignores invalid visualStyle values without disrupting checkout', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixture.componentRef.setInput('visualStyle', {
      fontFamily: 'Arial; } * { color: red',
      textColor: 'not-a-color!!!',
      borderRadius: '12',
      spacing: 'calc(1px)',
      accentColor: 'url(https://evil.example)',
    });
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--ep-font-family')).toBe('');
    expect(host.style.getPropertyValue('--ep-text')).toBe('');
    expect(host.style.getPropertyValue('--ep-accent')).toBe('');
    expect(host.style.getPropertyValue('--ep-radius')).toBe('');
    expect(host.style.getPropertyValue('--ep-spacing')).toBe('');
    expect(tileLabels(fixture).map((label) => label.replace(/,.*/, ''))).toEqual(['Card', 'PayPal']);
    expect(fixture.nativeElement.classList.contains('ep-appearance-transparent')).toBeFalse();
  });

  it('keeps visualStyle independent of theme and transparent appearance', async () => {
    fixture.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('theme', 'dark');
    fixture.componentRef.setInput('appearance', 'transparent');
    fixture.componentRef.setInput('visualStyle', {
      textColor: '#f8fafc',
      accentColor: '#60a5fa',
    });
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('ep-theme-dark')).toBeTrue();
    expect(host.classList.contains('ep-appearance-transparent')).toBeTrue();
    expect(host.style.getPropertyValue('--ep-text').trim()).toBe('#f8fafc');
    expect(host.style.getPropertyValue('--ep-accent').trim()).toBe('#60a5fa');

    const shell = host.querySelector('.ep-checkout') as HTMLElement;
    const shellStyle = getComputedStyle(shell);
    expect(
      shellStyle.backgroundColor === 'rgba(0, 0, 0, 0)' || shellStyle.backgroundColor === 'transparent',
    ).toBeTrue();
  });

  it('applies font and text colors to EP-owned UI and updates them dynamically', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixture.componentRef.setInput('theme', 'light');
    fixture.componentRef.setInput('visualStyle', {
      fontFamily: "'Courier New', monospace",
      textColor: '#112233',
      textSecondaryColor: '#445566',
    });
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--ep-font-family').trim()).toBe("'Courier New', monospace");
    expect(getComputedStyle(host).fontFamily.toLowerCase()).toContain('courier new');

    const title = host.querySelector('.ep-checkout__title') as HTMLElement;
    const subtitle = host.querySelector('.ep-checkout__subtitle') as HTMLElement;
    expect(title).toBeTruthy();
    expect(subtitle).toBeTruthy();
    expect(rgbCloseTo(getComputedStyle(title).color, 17, 34, 51)).toBeTrue();
    expect(rgbCloseTo(getComputedStyle(subtitle).color, 68, 85, 102)).toBeTrue();

    fixture.componentRef.setInput('visualStyle', {
      fontFamily: 'inherit',
      textColor: '#010203',
      textSecondaryColor: '#040506',
    });
    await render(fixture);
    expect(host.style.getPropertyValue('--ep-font-family').trim()).toBe('inherit');
    expect(host.style.getPropertyValue('--ep-text').trim()).toBe('#010203');
    expect(host.style.getPropertyValue('--ep-text-secondary').trim()).toBe('#040506');
  });

  it('restores theme defaults when visualStyle font/text overrides are removed', async () => {
    fixture.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('theme', 'light');
    fixture.componentRef.setInput('visualStyle', {
      fontFamily: 'Georgia, serif',
      textColor: '#123456',
      textSecondaryColor: '#654321',
    });
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--ep-font-family').trim()).toBe('Georgia, serif');
    expect(host.style.getPropertyValue('--ep-text').trim()).toBe('#123456');

    fixture.componentRef.setInput('visualStyle', null);
    await render(fixture);

    expect(host.style.getPropertyValue('--ep-font-family')).toBe('');
    expect(host.style.getPropertyValue('--ep-text')).toBe('');
    expect(host.style.getPropertyValue('--ep-text-secondary')).toBe('');
    expect(getComputedStyle(host).getPropertyValue('--ep-font-family').trim()).toContain('Segoe UI');
    expect(getComputedStyle(host).getPropertyValue('--ep-text').trim().toLowerCase()).toBe('#0f172a');
  });

  it('keeps explicit font/text overrides when switching light and dark themes', async () => {
    fixture.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('theme', 'light');
    fixture.componentRef.setInput('visualStyle', {
      fontFamily: "'Roboto', sans-serif",
      textColor: '#0a0a0a',
      textSecondaryColor: '#4a4a4a',
    });
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('ep-theme-light')).toBeTrue();
    expect(host.style.getPropertyValue('--ep-font-family').trim()).toBe("'Roboto', sans-serif");
    expect(host.style.getPropertyValue('--ep-text').trim()).toBe('#0a0a0a');

    fixture.componentRef.setInput('theme', 'dark');
    await render(fixture);

    expect(host.classList.contains('ep-theme-dark')).toBeTrue();
    expect(host.style.getPropertyValue('--ep-font-family').trim()).toBe("'Roboto', sans-serif");
    expect(host.style.getPropertyValue('--ep-text').trim()).toBe('#0a0a0a');
    expect(host.style.getPropertyValue('--ep-text-secondary').trim()).toBe('#4a4a4a');
  });

  it('does not restyle provider-branded mock Google Pay mark font via visualStyle', async () => {
    fixture.componentRef.setInput('methods', ['google-pay']);
    fixture.componentRef.setInput('visualStyle', {
      fontFamily: "'Courier New', monospace",
      textColor: '#ff0000',
    });
    await render(fixture);

    const gPayLabel = fixture.nativeElement.querySelector(
      'easy-google-pay-button span',
    ) as HTMLElement | null;
    // Mock mode may show the mock panel CTA instead of the branded button for some flows;
    // when the branded span is present it must keep Google's font, not the EP override.
    if (gPayLabel) {
      expect(gPayLabel.getAttribute('style') ?? '').toContain('Google Sans');
      expect(getComputedStyle(gPayLabel).fontFamily.toLowerCase()).not.toContain('courier new');
    }

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--ep-font-family').trim()).toBe("'Courier New', monospace");
  });

  it('applies backgroundColor to the host and surfaceColor to the default shell', async () => {
    fixture.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('theme', 'light');
    fixture.componentRef.setInput('appearance', 'default');
    fixture.componentRef.setInput('visualStyle', {
      backgroundColor: '#e2e8f0',
      surfaceColor: '#fff7ed',
    });
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--ep-background').trim()).toBe('#e2e8f0');
    expect(host.style.getPropertyValue('--ep-surface').trim()).toBe('#fff7ed');
    expect(rgbCloseTo(getComputedStyle(host).backgroundColor, 226, 232, 240)).toBeTrue();

    const shell = host.querySelector('.ep-checkout') as HTMLElement;
    expect(rgbCloseTo(getComputedStyle(shell).backgroundColor, 255, 247, 237)).toBeTrue();
  });

  it('keeps transparent shell clear while surfaceColor still styles tiles', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixture.componentRef.setInput('theme', 'light');
    fixture.componentRef.setInput('appearance', 'transparent');
    fixture.componentRef.setInput('visualStyle', {
      backgroundColor: 'transparent',
      surfaceColor: '#fef3c7',
    });
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('ep-appearance-transparent')).toBeTrue();
    expect(host.style.getPropertyValue('--ep-background').trim()).toBe('transparent');
    expect(host.style.getPropertyValue('--ep-surface').trim()).toBe('#fef3c7');

    const shell = host.querySelector('.ep-checkout') as HTMLElement;
    const shellBg = getComputedStyle(shell).backgroundColor;
    expect(shellBg === 'rgba(0, 0, 0, 0)' || shellBg === 'transparent').toBeTrue();

    // Unselected tiles use --ep-surface; the selected tile uses accent-soft.
    const tile = host.querySelector('button.ep-tile[aria-checked="false"]') as HTMLElement;
    expect(tile).toBeTruthy();
    expect(rgbCloseTo(getComputedStyle(tile).backgroundColor, 254, 243, 199)).toBeTrue();
  });

  it('applies accentColor to accent, focus, and soft tokens used by selected tiles', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixture.componentRef.setInput('theme', 'light');
    fixture.componentRef.setInput('visualStyle', { accentColor: '#0b6e4f' });
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--ep-accent').trim()).toBe('#0b6e4f');
    expect(host.style.getPropertyValue('--ep-focus').trim()).toBe('#0b6e4f');
    expect(host.style.getPropertyValue('--ep-accent-soft').trim()).toBe(
      'color-mix(in srgb, #0b6e4f 14%, transparent)',
    );

    const selected = host.querySelector('button.ep-tile[aria-checked="true"]') as HTMLElement;
    expect(selected).toBeTruthy();
    expect(getComputedStyle(selected).borderColor.toLowerCase()).toContain('11, 110, 79');
  });

  it('applies borderRadius and spacing to the default shell without flattening md radius', async () => {
    fixture.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('appearance', 'default');
    fixture.componentRef.setInput('visualStyle', {
      borderRadius: '20px',
      spacing: '24px',
    });
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--ep-radius').trim()).toBe('20px');
    expect(host.style.getPropertyValue('--ep-spacing').trim()).toBe('24px');
    expect(host.style.getPropertyValue('--ep-radius-md')).toBe('');
    expect(getComputedStyle(host).getPropertyValue('--ep-radius-md').trim()).toMatch(
      /calc\(\s*20px\s*\*\s*0\.625\s*\)/,
    );
    expect(getComputedStyle(host).getPropertyValue('--ep-padding').trim()).toMatch(
      /calc\(\s*24px\s*\*\s*1\.25\s*\)/,
    );

    const shell = host.querySelector('.ep-checkout') as HTMLElement;
    const shellStyle = getComputedStyle(shell);
    expect(shellStyle.borderRadius).toBe('20px');
    expect(shellStyle.paddingTop).toBe('30px');
    expect(shellStyle.rowGap || shellStyle.gap).toBe('24px');

    const tile = host.querySelector('button.ep-tile') as HTMLElement;
    expect(tile).toBeTruthy();
    // 20px * 0.625 = 12.5px derived md radius on tiles.
    expect(getComputedStyle(tile).borderRadius).toBe('12.5px');
  });

  it('updates and clears background/accent/radius/spacing dynamically', async () => {
    fixture.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('theme', 'light');
    fixture.componentRef.setInput('visualStyle', {
      backgroundColor: '#ddeeff',
      surfaceColor: '#ccddee',
      accentColor: '#1122aa',
      borderRadius: '8px',
      spacing: '12px',
    });
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--ep-surface').trim()).toBe('#ccddee');
    expect(host.style.getPropertyValue('--ep-accent').trim()).toBe('#1122aa');

    fixture.componentRef.setInput('theme', 'dark');
    await render(fixture);
    expect(host.classList.contains('ep-theme-dark')).toBeTrue();
    expect(host.style.getPropertyValue('--ep-surface').trim()).toBe('#ccddee');
    expect(host.style.getPropertyValue('--ep-accent').trim()).toBe('#1122aa');

    fixture.componentRef.setInput('visualStyle', null);
    await render(fixture);
    expect(host.style.getPropertyValue('--ep-background')).toBe('');
    expect(host.style.getPropertyValue('--ep-surface')).toBe('');
    expect(host.style.getPropertyValue('--ep-accent')).toBe('');
    expect(host.style.getPropertyValue('--ep-radius')).toBe('');
    expect(host.style.getPropertyValue('--ep-spacing')).toBe('');
    expect(getComputedStyle(host).getPropertyValue('--ep-surface').trim().toLowerCase()).toBe(
      '#111827',
    );
  });

  it('does not leak visualStyle CSS variables between checkout instances', async () => {
    const fixtureB = TestBed.createComponent(EasyPaymentsComponent);
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: 'other-plan' });
    fixture.componentRef.setInput('methods', ['card']);
    fixtureB.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('visualStyle', {
      surfaceColor: '#ffeeee',
      accentColor: '#aa0000',
      borderRadius: '4px',
    });
    fixtureB.componentRef.setInput('visualStyle', {
      surfaceColor: '#eeffee',
      accentColor: '#00aa00',
      borderRadius: '24px',
    });
    await render(fixture);
    await render(fixtureB);

    const hostA = fixture.nativeElement as HTMLElement;
    const hostB = fixtureB.nativeElement as HTMLElement;
    expect(hostA.style.getPropertyValue('--ep-surface').trim()).toBe('#ffeeee');
    expect(hostB.style.getPropertyValue('--ep-surface').trim()).toBe('#eeffee');
    expect(hostA.style.getPropertyValue('--ep-accent').trim()).toBe('#aa0000');
    expect(hostB.style.getPropertyValue('--ep-accent').trim()).toBe('#00aa00');
    expect(hostA.style.getPropertyValue('--ep-radius').trim()).toBe('4px');
    expect(hostB.style.getPropertyValue('--ep-radius').trim()).toBe('24px');
  });

  it('emits developer-only contrast warnings without changing colors or buyer UI', async () => {
    if (!isDevMode()) {
      pending('development diagnostics are disabled outside dev mode');
      return;
    }

    const warn = spyOn(console, 'warn');
    fixture.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('theme', 'light');
    fixture.componentRef.setInput('appearance', 'default');
    fixture.componentRef.setInput('visualStyle', {
      textColor: '#dddddd',
      surfaceColor: '#ffffff',
    });
    await render(fixture);

    expect(warn.calls.allArgs().some((args) => String(args[0]).includes('Low contrast'))).toBeTrue();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--ep-text').trim()).toBe('#dddddd');
    expect(host.style.getPropertyValue('--ep-surface').trim()).toBe('#ffffff');
    expect(host.textContent).not.toContain('Low contrast');
    expect(host.textContent).not.toContain('WCAG');
    expect(host.textContent).not.toContain('Recommended minimum');

    warn.calls.reset();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      warn.calls.allArgs().some((args) => String(args[0]).includes('Low contrast')),
    ).toBeFalse();
  });

  it('re-checks contrast when theme or visualStyle changes and skips unknown transparent hosts', async () => {
    if (!isDevMode()) {
      pending('development diagnostics are disabled outside dev mode');
      return;
    }

    const warn = spyOn(console, 'warn');
    const info = spyOn(console, 'info');
    fixture.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('theme', 'light');
    fixture.componentRef.setInput('appearance', 'transparent');
    fixture.componentRef.setInput('visualStyle', {
      textColor: '#000000',
      backgroundColor: 'transparent',
    });
    await render(fixture);

    expect(
      info.calls.allArgs().some((args) => String(args[0]).includes('Contrast check skipped')),
    ).toBeTrue();

    fixture.componentRef.setInput('appearance', 'default');
    fixture.componentRef.setInput('visualStyle', {
      textColor: '#eeeeee',
      surfaceColor: '#ffffff',
    });
    await render(fixture);
    expect(warn.calls.allArgs().some((args) => String(args[0]).includes('Low contrast'))).toBeTrue();
  });

  it('keeps independent themes for concurrent checkout instances', async () => {
    const fixtureB = TestBed.createComponent(EasyPaymentsComponent);
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: 'other-plan' });
    fixture.componentRef.setInput('methods', ['card']);
    fixtureB.componentRef.setInput('methods', ['card']);
    fixture.componentRef.setInput('theme', 'light');
    fixtureB.componentRef.setInput('theme', 'dark');
    fixture.componentRef.setInput('visualStyle', { accentColor: '#1111aa' });
    fixtureB.componentRef.setInput('visualStyle', { accentColor: '#11aa11' });
    await render(fixture);
    await render(fixtureB);

    const hostA = fixture.nativeElement as HTMLElement;
    const hostB = fixtureB.nativeElement as HTMLElement;
    expect(hostA.classList.contains('ep-theme-light')).toBeTrue();
    expect(hostB.classList.contains('ep-theme-dark')).toBeTrue();
    expect(hostA.getAttribute('data-theme')).toBe('light');
    expect(hostB.getAttribute('data-theme')).toBe('dark');
    expect(fixture.componentInstance.resolvedTheme()).toBe('light');
    expect(fixtureB.componentInstance.resolvedTheme()).toBe('dark');
    expect(hostA.style.getPropertyValue('--ep-accent').trim()).toBe('#1111aa');
    expect(hostB.style.getPropertyValue('--ep-accent').trim()).toBe('#11aa11');
  });

  it('keeps independent method allow-lists for concurrent checkout instances', async () => {
    const fixtureB = TestBed.createComponent(EasyPaymentsComponent);
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: 'other-plan' });
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixtureB.componentRef.setInput('methods', ['klarna', 'affirm']);
    await render(fixture);
    await render(fixtureB);

    expect(tileLabels(fixture).map((label) => label.replace(/,.*/, ''))).toEqual([
      'Card',
      'PayPal',
    ]);
    expect(tileLabels(fixtureB).map((label) => label.replace(/,.*/, ''))).toEqual([
      'Klarna',
      'Affirm',
    ]);
    expect(fixture.componentInstance.availableMethods().map((entry) => entry.method)).toEqual([
      'card',
      'paypal',
    ]);
    expect(fixtureB.componentInstance.availableMethods().map((entry) => entry.method)).toEqual([
      'klarna',
      'affirm',
    ]);
  });

  it('keeps independent method order for concurrent checkout instances', async () => {
    const fixtureB = TestBed.createComponent(EasyPaymentsComponent);
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: 'other-plan' });
    fixture.componentRef.setInput('methods', ['paypal', 'card']);
    fixtureB.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);
    await render(fixtureB);

    expect(tileLabels(fixture).map((label) => label.replace(/,.*/, ''))).toEqual([
      'PayPal',
      'Card',
    ]);
    expect(tileLabels(fixtureB).map((label) => label.replace(/,.*/, ''))).toEqual([
      'Card',
      'PayPal',
    ]);
  });

  it('does not clobber a sibling checkout when one instance refreshes methods', async () => {
    const fixtureB = TestBed.createComponent(EasyPaymentsComponent);
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: 'other-plan' });
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixtureB.componentRef.setInput('methods', ['klarna']);
    await render(fixture);
    await render(fixtureB);

    fixture.componentRef.setInput('methods', ['paypal']);
    await render(fixture);
    fixtureB.detectChanges();

    expect(tileLabels(fixture).map((label) => label.replace(/,.*/, ''))).toEqual(['PayPal']);
    expect(tileLabels(fixtureB).map((label) => label.replace(/,.*/, ''))).toEqual(['Klarna']);
    expect(fixtureB.componentInstance.availableMethods().map((entry) => entry.method)).toEqual([
      'klarna',
    ]);
  });

  it('isolates a mock provider failure to the affected checkout methods only', async () => {
    const fixtureB = TestBed.createComponent(EasyPaymentsComponent);
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: 'other-plan' });
    TestBed.inject(MockPaymentController).setUnavailableMethods(['paypal']);

    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixtureB.componentRef.setInput('methods', ['paypal', 'klarna']);
    await render(fixture);
    await render(fixtureB);

    expect(tileLabels(fixture).map((label) => label.replace(/,.*/, ''))).toEqual(['Card']);
    expect(tileLabels(fixtureB).map((label) => label.replace(/,.*/, ''))).toEqual(['Klarna']);
    expect(fixture.componentInstance.availableMethods().find((e) => e.method === 'paypal')?.available).toBeFalse();
    expect(fixtureB.componentInstance.availableMethods().find((e) => e.method === 'paypal')?.available).toBeFalse();
    expect(fixtureB.componentInstance.availableMethods().find((e) => e.method === 'klarna')?.available).toBeTrue();
  });

  it('keeps EasyPaymentsDiagnosticsService as a global last-refresh projection', async () => {
    const fixtureB = TestBed.createComponent(EasyPaymentsComponent);
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: 'other-plan' });
    const diagnostics = TestBed.inject(EasyPaymentsDiagnosticsService);

    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixtureB.componentRef.setInput('methods', ['klarna']);
    await render(fixture);
    await render(fixtureB);

    // Root diagnostics reflect the latest orchestrator refresh (fixtureB), not a merge of both.
    expect(diagnostics.snapshot().published).toBeTrue();
    expect(diagnostics.snapshot().methods.map((entry) => entry.method)).toEqual(['klarna']);
    // Instance tiles remain independent of that global projection.
    expect(fixture.componentInstance.availableMethods().map((entry) => entry.method)).toEqual([
      'card',
      'paypal',
    ]);
  });

  it('preserves transparent shell painting rules with optional background/surface overrides', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixture.componentRef.setInput('theme', 'light');
    fixture.componentRef.setInput('appearance', 'transparent');
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    let shell = host.querySelector('.ep-checkout') as HTMLElement;
    let shellBg = getComputedStyle(shell).backgroundColor;
    expect(shellBg === 'rgba(0, 0, 0, 0)' || shellBg === 'transparent').toBeTrue();

    fixture.componentRef.setInput('visualStyle', {
      backgroundColor: '#e2e8f0',
      surfaceColor: 'transparent',
    });
    await render(fixture);
    expect(host.style.getPropertyValue('--ep-background').trim()).toBe('#e2e8f0');
    expect(rgbCloseTo(getComputedStyle(host).backgroundColor, 226, 232, 240)).toBeTrue();
    shell = host.querySelector('.ep-checkout') as HTMLElement;
    shellBg = getComputedStyle(shell).backgroundColor;
    // Transparent appearance still clears the shell fill even when surface token is set.
    expect(shellBg === 'rgba(0, 0, 0, 0)' || shellBg === 'transparent').toBeTrue();
    expect(host.style.getPropertyValue('--ep-surface').trim()).toBe('transparent');
  });






  it('keeps selected and unselected tiles the same size', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);

    const tiles = fixture.nativeElement.querySelectorAll('button.ep-tile') as NodeListOf<HTMLButtonElement>;
    expect(tiles.length).toBe(2);
    const selected = tiles[0];
    const unselected = tiles[1];
    expect(selected.getAttribute('aria-checked')).toBe('true');
    expect(unselected.getAttribute('aria-checked')).toBe('false');
    expect(getComputedStyle(selected).height).toBe(getComputedStyle(unselected).height);
    expect(Math.abs(selected.getBoundingClientRect().width - unselected.getBoundingClientRect().width)).toBeLessThan(
      1,
    );
  });

  it('applies the light theme class', async () => {
    fixture.componentRef.setInput('theme', 'light');
    fixture.componentRef.setInput('methods', ['card']);
    await render(fixture);

    expect(fixture.nativeElement.classList.contains('ep-theme-light')).toBeTrue();
    expect(fixture.nativeElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies the dark theme class', async () => {
    fixture.componentRef.setInput('theme', 'dark');
    fixture.componentRef.setInput('methods', ['card']);
    await render(fixture);

    expect(fixture.nativeElement.classList.contains('ep-theme-dark')).toBeTrue();
    expect(fixture.nativeElement.getAttribute('data-theme')).toBe('dark');
  });

  it('resolves system theme from prefers-color-scheme', async () => {
    browser.prefersDark = true;
    fixture.componentRef.setInput('theme', 'system');
    fixture.componentRef.setInput('methods', ['card']);
    await render(fixture);

    expect(fixture.nativeElement.classList.contains('ep-theme-dark')).toBeTrue();
  });

  it('updates when the system theme changes', async () => {
    browser.prefersDark = false;
    fixture.componentRef.setInput('theme', 'system');
    fixture.componentRef.setInput('methods', ['card']);
    await render(fixture);
    expect(fixture.nativeElement.classList.contains('ep-theme-light')).toBeTrue();

    browser.setPrefersDark(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.classList.contains('ep-theme-dark')).toBeTrue();
  });

  it('emits success for a mock payment', async () => {
    const successes: PaymentResult[] = [];
    fixture.componentInstance.success.subscribe((result) => successes.push(result));
    fixture.componentRef.setInput('methods', ['card']);
    await render(fixture);

    payCta(fixture)!.click();
    await fixture.whenStable();

    expect(successes.length).toBe(1);
    expect(successes[0].status).toBe('success');
    expect(successes[0].method).toBe('card');
    expect(successes[0].metadata?.['mock']).toBeTrue();
  });

  it('keeps merchant metadata out of public payment events', async () => {
    const successes: PaymentResult[] = [];
    const starts: unknown[] = [];
    fixture.componentInstance.success.subscribe((result) => successes.push(result));
    fixture.componentInstance.started.subscribe((event) => starts.push(event));
    fixture.componentRef.setInput('product', {
      ...SAMPLE_PRODUCT,
      metadata: { orderId: 'ORDER-12345', customerReference: 'CUSTOMER-789' },
    });
    fixture.componentRef.setInput('methods', ['card']);
    await render(fixture);

    payCta(fixture)!.click();
    await fixture.whenStable();

    expect(successes.length).toBe(1);
    expect(JSON.stringify(starts)).not.toContain('ORDER-12345');
    expect(JSON.stringify(successes[0])).not.toContain('ORDER-12345');
    expect(JSON.stringify(successes[0])).not.toContain('CUSTOMER-789');
    expect(successes[0].metadata?.['mock']).toBeTrue();
  });

  it('emits cancel for a mock cancellation', async () => {
    TestBed.inject(MockPaymentController).setOutcome('cancelled');
    const cancellations: PaymentResult[] = [];
    fixture.componentInstance.cancel.subscribe((result) => cancellations.push(result));
    fixture.componentRef.setInput('methods', ['paypal']);
    await render(fixture);

    payCta(fixture)!.click();
    await fixture.whenStable();

    expect(cancellations.length).toBe(1);
    expect(cancellations[0].status).toBe('cancelled');
  });

  it('emits a normalized PaymentError for a mock failure', async () => {
    TestBed.inject(MockPaymentController).setOutcome('failed');
    const errors: PaymentError[] = [];
    fixture.componentInstance.error.subscribe((error) => errors.push(error));
    fixture.componentRef.setInput('methods', ['card']);
    await render(fixture);

    payCta(fixture)!.click();
    await fixture.whenStable();

    expect(errors.length).toBe(1);
    expect(errors[0]).toBeInstanceOf(PaymentError);
    expect(errors[0].code).toBe('PAYMENT_FAILED');
    expect(errors[0].method).toBe('card');
  });

  it('emits PRODUCT_INVALID for an invalid amount', async () => {
    const errors: PaymentError[] = [];
    fixture.componentInstance.error.subscribe((error) => errors.push(error));
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT, amount: 0 });
    fixture.componentRef.setInput('methods', ['card']);
    await render(fixture);

    expect(errors.some((error) => error.code === 'PRODUCT_INVALID')).toBeTrue();
  });

  it('shows a subtle demo indicator on mock method tiles', async () => {
    fixture.componentRef.setInput('methods', ['paypal']);
    await render(fixture);

    const demoBadge = fixture.nativeElement.querySelector('.ep-tile__demo');
    expect(demoBadge?.textContent?.trim()).toBe('Demo');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Demo Mode - No real payment will be processed.',
    );
  });

  describe('checkout view states', () => {
    it('shows success confirmation with product, total, and method after mock success', async () => {
      const successes: PaymentResult[] = [];
      fixture.componentInstance.success.subscribe((result) => successes.push(result));
      fixture.componentRef.setInput('methods', ['google-pay']);
      await render(fixture);

      payCta(fixture)!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(successes.length).toBe(1);
      expect(fixture.componentInstance.viewState()).toBe('success');
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Payment successful');
      expect(text).toContain('Premium Plan');
      expect(text).toMatch(/\$99\.99/);
      expect(text).toContain('Google Pay');
      expect(text).toContain('Continue');
      expect(text).not.toContain('Complete your purchase');
      expect(fixture.nativeElement.querySelector('easy-mock-method-panel')).toBeNull();
    });

    it('emits success exactly once and shows truncated transaction reference', async () => {
      const successes: PaymentResult[] = [];
      fixture.componentInstance.success.subscribe((result) => successes.push(result));
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      payCta(fixture)!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(successes.length).toBe(1);
      const txn = successes[0].transactionId;
      expect(txn).toBeTruthy();
      if (txn && txn.length > 8) {
        expect(fixture.nativeElement.textContent).toContain(`••••${txn.slice(-4)}`);
        expect(fixture.nativeElement.textContent).not.toContain(txn);
      }
    });

    it('does not show confirmation when successBehavior is event-only', async () => {
      const successes: PaymentResult[] = [];
      fixture.componentInstance.success.subscribe((result) => successes.push(result));
      fixture.componentRef.setInput('methods', ['card']);
      fixture.componentRef.setInput('successBehavior', 'event-only');
      await render(fixture);

      payCta(fixture)!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(successes.length).toBe(1);
      expect(fixture.componentInstance.viewState()).toBe('checkout');
      expect(fixture.nativeElement.textContent).toContain('Complete your purchase');
      expect(fixture.nativeElement.textContent).not.toContain('Payment successful');
    });

    it('emits successContinue and resets checkout on Continue', async () => {
      const continues: PaymentResult[] = [];
      fixture.componentInstance.successContinue.subscribe((result) => continues.push(result));
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      payCta(fixture)!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      const continueBtn = fixture.nativeElement.querySelector(
        'button.ep-outcome__action',
      ) as HTMLButtonElement;
      expect(continueBtn?.textContent?.trim()).toBe('Continue');
      continueBtn.click();
      fixture.detectChanges();

      expect(continues.length).toBe(1);
      expect(fixture.componentInstance.viewState()).toBe('checkout');
      expect(fixture.nativeElement.textContent).toContain('Complete your purchase');
      expect(payCta(fixture)).toBeTruthy();
    });

    it('shows processing state and prevents duplicate mock submits', async () => {
      TestBed.inject(MockPaymentController).setDelay(200);
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      const cta = payCta(fixture)!;
      cta.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.viewState()).toBe('processing');
      expect(fixture.nativeElement.textContent).toContain('Processing payment...');
      expect(fixture.nativeElement.textContent).toContain("Please don't close this window.");
      expect(payCta(fixture)).toBeNull();

      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.componentInstance.viewState()).toBe('success');
    });

    it('shows error screen for mock failure and Try again restores checkout', async () => {
      TestBed.inject(MockPaymentController).setOutcome('failed');
      const errors: PaymentError[] = [];
      fixture.componentInstance.error.subscribe((error) => errors.push(error));
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      payCta(fixture)!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(errors.length).toBe(1);
      expect(fixture.componentInstance.viewState()).toBe('error');
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Payment failed');
      expect(text).toContain("We couldn't complete your payment.");
      expect(text).not.toContain('Your payment method was not charged');
      expect(text).not.toContain('{');

      const tryAgain = fixture.nativeElement.querySelector(
        'button.ep-outcome__action',
      ) as HTMLButtonElement;
      expect(tryAgain.textContent?.trim()).toBe('Try again');
      tryAgain.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.viewState()).toBe('checkout');
      expect(payCta(fixture)).toBeTruthy();
    });

    it('shows cancelled screen (not error) and Return to checkout works', async () => {
      TestBed.inject(MockPaymentController).setOutcome('cancelled');
      const cancellations: PaymentResult[] = [];
      fixture.componentInstance.cancel.subscribe((result) => cancellations.push(result));
      fixture.componentRef.setInput('methods', ['paypal']);
      await render(fixture);

      payCta(fixture)!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(cancellations.length).toBe(1);
      expect(fixture.componentInstance.viewState()).toBe('cancelled');
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Payment cancelled');
      expect(text).toContain('No payment was completed.');
      expect(text).not.toContain('Payment failed');

      const back = fixture.nativeElement.querySelector(
        'button.ep-outcome__action',
      ) as HTMLButtonElement;
      expect(back.textContent?.trim()).toBe('Return to checkout');
      back.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.viewState()).toBe('checkout');
      expect(fixture.nativeElement.textContent).toContain('Pay with PayPal');
    });

    it('locks method switching while processing', async () => {
      TestBed.inject(MockPaymentController).setDelay(200);
      fixture.componentRef.setInput('methods', ['card', 'paypal']);
      await render(fixture);

      expect(fixture.componentInstance.selectedMethod()).toBe('card');
      payCta(fixture)!.click();
      fixture.detectChanges();

      fixture.componentInstance.selectMethod('paypal');
      expect(fixture.componentInstance.selectedMethod()).toBe('card');

      await fixture.whenStable();
      fixture.detectChanges();
    });

    it('keeps success/error/cancelled themed with the host theme', async () => {
      fixture.componentRef.setInput('theme', 'dark');
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      payCta(fixture)!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.classList.contains('ep-theme-dark')).toBeTrue();
      expect(fixture.nativeElement.querySelector('easy-checkout-outcome')).toBeTruthy();
    });

    it('Klarna return recovery shows processing then success confirmation once', async () => {
      const successes: PaymentResult[] = [];
      fixture.componentInstance.success.subscribe((result) => successes.push(result));
      fixture.componentRef.setInput('methods', ['card', 'klarna']);
      await render(fixture);

      expect(fixture.componentInstance.selectedMethod()).toBe('card');

      fixture.componentInstance.onKlarnaReturning(true);
      fixture.detectChanges();
      expect(fixture.componentInstance.viewState()).toBe('processing');
      expect(fixture.componentInstance.selectedMethod()).toBe('klarna');
      expect(fixture.nativeElement.textContent).toContain('Processing payment...');

      fixture.componentInstance.onKlarnaSuccess({
        status: 'success',
        method: 'klarna',
        provider: 'klarna',
        transactionId: 'pi_klarna_abc12345',
      });
      fixture.componentInstance.onKlarnaReturning(false);
      fixture.detectChanges();

      expect(successes.length).toBe(1);
      expect(successes[0].method).toBe('klarna');
      expect(fixture.componentInstance.viewState()).toBe('success');
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Payment successful');
      expect(text).toContain('Premium Plan');
      expect(text).toMatch(/\$99\.99/);
      expect(text).toContain('Klarna');
      expect(text).toContain('••••2345');
    });

    it('Klarna parent-owned redirect recovery transitions Processing to Success', async () => {
      setTestLocation(
        '/?payment_intent=pi_parent&payment_intent_client_secret=sec_parent&ep_method=klarna',
      );

      const recovery = TestBed.inject(StripeRedirectRecoveryService);
      spyOn(recovery, 'consumeReturn').and.resolveTo({
        status: 'success',
        method: 'klarna',
        provider: 'klarna',
        transactionId: 'pi_parent_txn',
      });

      const successes: PaymentResult[] = [];
      const fixtureReturn = TestBed.createComponent(EasyPaymentsComponent);
      fixtureReturn.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
      fixtureReturn.componentRef.setInput('methods', ['klarna', 'card']);
      fixtureReturn.componentInstance.success.subscribe((result) => successes.push(result));

      expect(fixtureReturn.componentInstance.viewState()).toBe('processing');

      fixtureReturn.detectChanges();
      await fixtureReturn.whenStable();
      await Promise.resolve();
      await Promise.resolve();
      fixtureReturn.detectChanges();

      expect(recovery.consumeReturn).toHaveBeenCalled();
      expect(successes.length).toBe(1);
      expect(successes[0].method).toBe('klarna');
      expect(successes[0].transactionId).toBe('pi_parent_txn');
      expect(fixtureReturn.componentInstance.viewState()).toBe('success');
      expect(fixtureReturn.nativeElement.textContent).toContain('Payment successful');
      expect(fixtureReturn.nativeElement.textContent).toContain('Klarna');
      expect(
        fixtureReturn.debugElement.injector.get(CheckoutHostContext).returnPhaseFor('klarna'),
      ).toBe('settled');

      resetTestLocation();
      fixtureReturn.destroy();
    });

    it('Klarna parent-owned redirect recovery maps retrieve failure to Error', async () => {
      setTestLocation('/?ep_method=klarna&payment_intent_client_secret=bad');

      const recovery = TestBed.inject(StripeRedirectRecoveryService);
      spyOn(recovery, 'consumeReturn').and.rejectWith(
        new PaymentError({
          code: 'PAYMENT_FAILED',
          message: 'Stripe retrieve failed',
          method: 'klarna',
          provider: 'klarna',
        }),
      );

      const errors: PaymentError[] = [];
      const fixtureReturn = TestBed.createComponent(EasyPaymentsComponent);
      fixtureReturn.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
      fixtureReturn.componentRef.setInput('methods', ['klarna']);
      fixtureReturn.componentInstance.error.subscribe((error) => errors.push(error));

      fixtureReturn.detectChanges();
      await fixtureReturn.whenStable();
      await Promise.resolve();
      await Promise.resolve();
      fixtureReturn.detectChanges();

      expect(errors.length).toBe(1);
      expect(fixtureReturn.componentInstance.viewState()).toBe('error');
      expect(fixtureReturn.nativeElement.textContent).toContain('Payment failed');

      resetTestLocation();
      fixtureReturn.destroy();
    });

    it('Affirm parent-owned redirect recovery transitions Processing to Success', async () => {
      setTestLocation(
        '/?payment_intent=pi_aff&payment_intent_client_secret=sec_aff&ep_method=affirm',
      );

      const recovery = TestBed.inject(StripeRedirectRecoveryService);
      spyOn(recovery, 'consumeReturn').and.resolveTo({
        status: 'success',
        method: 'affirm',
        provider: 'affirm',
        transactionId: 'pi_aff_txn',
      });

      const successes: PaymentResult[] = [];
      const fixtureReturn = TestBed.createComponent(EasyPaymentsComponent);
      fixtureReturn.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
      fixtureReturn.componentRef.setInput('methods', ['affirm', 'card']);
      fixtureReturn.componentInstance.success.subscribe((result) => successes.push(result));

      expect(fixtureReturn.componentInstance.viewState()).toBe('processing');
      expect(fixtureReturn.componentInstance.selectedMethod()).toBe('affirm');

      fixtureReturn.detectChanges();
      await fixtureReturn.whenStable();
      await Promise.resolve();
      await Promise.resolve();
      fixtureReturn.detectChanges();

      expect(recovery.consumeReturn).toHaveBeenCalled();
      expect(successes.length).toBe(1);
      expect(successes[0].method).toBe('affirm');
      expect(fixtureReturn.componentInstance.viewState()).toBe('success');
      expect(fixtureReturn.nativeElement.textContent).toContain('Affirm');
      expect(
        fixtureReturn.debugElement.injector.get(CheckoutHostContext).returnPhaseFor('affirm'),
      ).toBe('settled');

      resetTestLocation();
      fixtureReturn.destroy();
    });

    it('Klarna return respects successBehavior=event-only', async () => {
      const successes: PaymentResult[] = [];
      fixture.componentInstance.success.subscribe((result) => successes.push(result));
      fixture.componentRef.setInput('methods', ['klarna']);
      fixture.componentRef.setInput('successBehavior', 'event-only');
      await render(fixture);

      fixture.componentInstance.onKlarnaReturning(true);
      fixture.componentInstance.onKlarnaSuccess({
        status: 'success',
        method: 'klarna',
        provider: 'klarna',
        transactionId: 'pi_event_only',
      });
      fixture.componentInstance.onKlarnaReturning(false);
      fixture.detectChanges();

      expect(successes.length).toBe(1);
      expect(fixture.componentInstance.viewState()).toBe('checkout');
      expect(fixture.nativeElement.textContent).not.toContain('Payment successful');
    });

    it('Klarna Continue after success resets to fresh checkout', async () => {
      const continues: PaymentResult[] = [];
      fixture.componentInstance.successContinue.subscribe((result) => continues.push(result));
      fixture.componentRef.setInput('methods', ['klarna']);
      await render(fixture);

      fixture.componentInstance.onKlarnaSuccess({
        status: 'success',
        method: 'klarna',
        provider: 'klarna',
        transactionId: 'pi_continue',
      });
      fixture.detectChanges();

      const continueBtn = fixture.nativeElement.querySelector(
        'button.ep-outcome__action',
      ) as HTMLButtonElement;
      continueBtn.click();
      fixture.detectChanges();

      expect(continues.length).toBe(1);
      expect(fixture.componentInstance.viewState()).toBe('checkout');
      expect(fixture.nativeElement.textContent).toContain('Complete your purchase');
    });

    it('Klarna cancelled/failed returns map to cancelled and error states', async () => {
      fixture.componentRef.setInput('methods', ['klarna']);
      await render(fixture);

      fixture.componentInstance.onKlarnaCancel({
        status: 'cancelled',
        method: 'klarna',
        provider: 'klarna',
      });
      fixture.detectChanges();
      expect(fixture.componentInstance.viewState()).toBe('cancelled');

      fixture.componentInstance.resetCheckoutView();
      fixture.componentInstance.onKlarnaError(
        new PaymentError({
          code: 'PAYMENT_FAILED',
          message: 'Klarna failed',
          method: 'klarna',
          provider: 'klarna',
        }),
      );
      fixture.detectChanges();
      expect(fixture.componentInstance.viewState()).toBe('error');
    });
  });

  describe('checkout heading localization', () => {
    it('renders English title and subtitle for locale=en', async () => {
      fixture.componentRef.setInput('locale', 'en');
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Complete your purchase');
      expect(text).toContain('Choose your preferred payment method');
      expect(text).toContain('Premium Plan');
      expect(text).toContain('One year subscription');
    });

    it('renders Spanish title and subtitle for locale=es', async () => {
      fixture.componentRef.setInput('locale', 'es');
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Completa tu compra');
      expect(text).toContain('Elige tu método de pago preferido');
      expect(text).not.toContain('Complete your purchase');
      expect(text).not.toContain('Choose your preferred payment method');
      expect(text).toContain('Premium Plan');
      expect(text).toContain('One year subscription');
    });

    it('renders Portuguese title and subtitle for locale=pt', async () => {
      fixture.componentRef.setInput('locale', 'pt');
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Finalize sua compra');
      expect(text).toContain('Escolha seu método de pagamento preferido');
      expect(text).not.toContain('Complete your purchase');
      expect(text).toContain('Premium Plan');
      expect(text).toContain('One year subscription');
    });

    it('switches checkout headings at runtime en → es → pt → en without reload', async () => {
      fixture.componentRef.setInput('methods', ['card']);
      fixture.componentRef.setInput('locale', 'en');
      await render(fixture);

      let text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Complete your purchase');
      expect(text).toContain('Choose your preferred payment method');
      expect(text).toContain('Premium Plan');

      fixture.componentRef.setInput('locale', 'es');
      await render(fixture);
      text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Completa tu compra');
      expect(text).toContain('Elige tu método de pago preferido');
      expect(text).not.toContain('Complete your purchase');
      expect(text).toContain('Premium Plan');
      expect(text).toContain('One year subscription');

      fixture.componentRef.setInput('locale', 'pt');
      await render(fixture);
      text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Finalize sua compra');
      expect(text).toContain('Escolha seu método de pagamento preferido');
      expect(text).not.toContain('Completa tu compra');
      expect(text).toContain('Premium Plan');

      fixture.componentRef.setInput('locale', 'en');
      await render(fixture);
      text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Complete your purchase');
      expect(text).toContain('Choose your preferred payment method');
      expect(text).not.toContain('Finalize sua compra');
      expect(text).toContain('Premium Plan');
      expect(text).toContain('One year subscription');
    });

    it('does not leak English provider diagnostics into Spanish error UI', async () => {
      fixture.componentRef.setInput('locale', 'es');
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      fixture.componentInstance.onKlarnaError(
        new PaymentError({
          code: 'PAYMENT_FAILED',
          message: 'Klarna payment was not completed. Please try again.',
          method: 'klarna',
          provider: 'klarna',
        }),
      );
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Pago fallido');
      expect(text).toContain('No pudimos completar su pago.');
      expect(text).toContain('Intentar de nuevo');
      expect(text).not.toContain('Klarna payment was not completed');
      expect(text).not.toContain('Please try again.');
    });

    it('shows a localized specific detail for card declined without English leakage', async () => {
      fixture.componentRef.setInput('locale', 'es');
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      fixture.componentInstance.onStripeError(
        new PaymentError({
          code: 'CARD_DECLINED',
          message: 'Your card was declined.',
          method: 'card',
          provider: 'stripe',
        }),
      );
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Pago fallido');
      expect(text).toContain('Su tarjeta fue rechazada');
      expect(text).not.toContain('Your card was declined');
    });
  });

  describe('provider isolation', () => {
    it('keeps other methods usable when PayPal SDK loading fails', async () => {
      resetProviderDiagnosticsForTests();
      const warn = spyOn(console, 'warn');
      fixture.componentRef.setInput('methods', ['card', 'paypal']);
      await render(fixture);

      fixture.componentInstance.onPayPalError(
        new PaymentError({
          code: 'SDK_LOAD_FAILED',
          message:
            'Failed to load SDK: https://www.paypal.com/sdk/js?client-id=SHOULD_NOT_LEAK&currency=USD',
          method: 'paypal',
          provider: 'paypal',
        }),
      );
      fixture.detectChanges();

      expect(fixture.componentInstance.viewState()).toBe('checkout');
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Card');
      expect(text).not.toContain('SHOULD_NOT_LEAK');
      expect(text).not.toContain('Payment failed');
      const logged = warn.calls.allArgs().map((args) => args.join(' ')).join('\n');
      expect(logged).not.toContain('SHOULD_NOT_LEAK');
      expect(logged).not.toContain('client-id=');
    });

    it('keeps Stripe card usable when the PayPal backend endpoint fails', async () => {
      fixture.componentRef.setInput('methods', ['card', 'paypal']);
      await render(fixture);

      fixture.componentInstance.onPayPalError(
        new PaymentError({
          code: 'BACKEND_ERROR',
          message: 'PayPal order endpoint returned 500',
          method: 'paypal',
          provider: 'paypal',
        }),
      );
      fixture.detectChanges();

      expect(fixture.componentInstance.viewState()).toBe('checkout');
      expect(fixture.nativeElement.textContent).toContain('Card');
      expect(payCta(fixture)).toBeTruthy();
    });

    it('returns to checkout after cancellation so another method can be selected', async () => {
      const controller = TestBed.inject(MockPaymentController);
      controller.setOutcome('cancelled');
      fixture.componentRef.setInput('methods', ['paypal', 'card']);
      await render(fixture);

      payCta(fixture)!.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.componentInstance.viewState()).toBe('cancelled');

      (fixture.nativeElement.querySelector('button.ep-outcome__action') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(fixture.componentInstance.viewState()).toBe('checkout');

      const cardTile = fixture.debugElement
        .queryAll(By.css('button.ep-tile'))
        .find((btn) =>
          ((btn.nativeElement as HTMLButtonElement).getAttribute('aria-label') ?? '').includes('Card'),
        );
      cardTile!.nativeElement.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.selectedMethod()).toBe('card');

      controller.setOutcome('success');
      payCta(fixture)!.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.componentInstance.viewState()).toBe('success');
    });

    it('allows another attempt after a recoverable payment error', async () => {
      const controller = TestBed.inject(MockPaymentController);
      controller.setOutcome('failed');
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      payCta(fixture)!.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.componentInstance.viewState()).toBe('error');

      (fixture.nativeElement.querySelector('button.ep-outcome__action') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(fixture.componentInstance.viewState()).toBe('checkout');

      controller.setOutcome('success');
      payCta(fixture)!.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.componentInstance.viewState()).toBe('success');
    });

    it('does not submit a second payment while the first attempt is in progress', async () => {
      const controller = TestBed.inject(MockPaymentController);
      controller.setDelay(300);
      const successes: PaymentResult[] = [];
      fixture.componentInstance.success.subscribe((result) => successes.push(result));
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      const cta = payCta(fixture)!;
      cta.click();
      cta.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.viewState()).toBe('processing');

      await fixture.whenStable();
      fixture.detectChanges();
      expect(successes.length).toBe(1);
    });
  });

  describe('public payment events', () => {
    function listen(): {
      starts: PaymentStartedEvent[];
      successes: PaymentResult[];
      cancels: PaymentResult[];
      errors: PaymentError[];
      changes: PaymentMethodChangeEvent[];
    } {
      const starts: PaymentStartedEvent[] = [];
      const successes: PaymentResult[] = [];
      const cancels: PaymentResult[] = [];
      const errors: PaymentError[] = [];
      const changes: PaymentMethodChangeEvent[] = [];
      fixture.componentInstance.started.subscribe((event) => starts.push(event));
      fixture.componentInstance.success.subscribe((event) => successes.push(event));
      fixture.componentInstance.cancel.subscribe((event) => cancels.push(event));
      fixture.componentInstance.error.subscribe((event) => errors.push(event));
      fixture.componentInstance.methodChange.subscribe((event) => changes.push(event));
      return { starts, successes, cancels, errors, changes };
    }

    it('emits started once and success for a mock card payment', async () => {
      const events = listen();
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      const cta = payCta(fixture)!;
      cta.click();
      cta.click();
      await fixture.whenStable();

      expect(events.starts.length).toBe(1);
      expect(events.starts[0]).toEqual(
        jasmine.objectContaining({
          method: 'card',
          provider: 'stripe',
          amount: SAMPLE_PRODUCT.amount,
          currency: SAMPLE_PRODUCT.currency,
        }),
      );
      expect(events.successes.length).toBe(1);
      expect(events.successes[0].status).toBe('success');
      expect(events.successes[0].method).toBe('card');
      expect(events.successes[0].provider).toBe('stripe');
      expect(events.cancels.length).toBe(0);
      expect(JSON.stringify(events.starts)).not.toContain('clientSecret');
      expect(JSON.stringify(events.successes)).not.toContain('originalError');
    });

    it('emits cancel for an observable mock cancellation and does not also emit error', async () => {
      TestBed.inject(MockPaymentController).setOutcome('cancelled');
      const events = listen();
      fixture.componentRef.setInput('methods', ['paypal']);
      await render(fixture);

      payCta(fixture)!.click();
      await fixture.whenStable();

      expect(events.starts.length).toBe(1);
      expect(events.cancels.length).toBe(1);
      expect(events.cancels[0].status).toBe('cancelled');
      expect(events.cancels[0].method).toBe('paypal');
      expect(events.errors.length).toBe(0);
      expect(events.successes.length).toBe(0);
    });

    it('emits a declined-style failure and a second attempt after retry', async () => {
      const controller = TestBed.inject(MockPaymentController);
      controller.setOutcome('failed');
      const events = listen();
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      payCta(fixture)!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(events.starts.length).toBe(1);
      expect(events.errors.map((error) => error.code)).toEqual(['PAYMENT_FAILED']);
      expect(events.cancels.length).toBe(0);
      expect(events.successes.length).toBe(0);

      const retry = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
      const tryAgain = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
        (button as HTMLButtonElement).textContent?.includes('Try again'),
      ) as HTMLButtonElement;
      expect(tryAgain).toBeTruthy();
      tryAgain.click();
      fixture.detectChanges();
      await fixture.whenStable();

      controller.setOutcome('success');
      payCta(fixture)!.click();
      await fixture.whenStable();

      expect(events.starts.length).toBe(2);
      expect(events.successes.length).toBe(1);
      expect(events.errors.length).toBe(1);
      expect(retry).toBeTruthy();
    });

    it('does not emit started or cancel for a configuration failure', async () => {
      const events = listen();
      fixture.componentRef.setInput('methods', ['card', 'paypal']);
      await render(fixture);
      const startsBefore = events.starts.length;

      fixture.componentInstance.onPayPalError(
        new PaymentError({
          code: 'SDK_LOAD_FAILED',
          message: 'https://example.test/sdk?client-id=SHOULD_NOT_LEAK',
          method: 'paypal',
          provider: 'paypal',
        }),
      );

      expect(events.starts.length).toBe(startsBefore);
      expect(events.cancels.length).toBe(0);
      expect(events.errors.map((error) => error.code)).toEqual(['SDK_LOAD_FAILED']);
      expect(fixture.componentInstance.viewState()).toBe('checkout');
      expect(JSON.stringify(events.errors.map((error) => error.code))).not.toContain('SHOULD_NOT_LEAK');
    });

    it('emits methodChange when the selection changes and not when it is repeated', async () => {
      const events = listen();
      fixture.componentRef.setInput('methods', ['paypal', 'card']);
      await render(fixture);

      expect(events.changes.map((event) => event.method)).toEqual(['paypal']);
      expect(events.changes[0].previousMethod).toBeNull();
      expect(events.changes[0].provider).toBe('paypal');

      const cardTile = fixture.debugElement
        .queryAll(By.css('button.ep-tile'))
        .find((button) =>
          ((button.nativeElement as HTMLButtonElement).getAttribute('aria-label') ?? '').includes(
            'Card',
          ),
        );
      cardTile!.nativeElement.click();
      fixture.detectChanges();
      cardTile!.nativeElement.click();
      fixture.detectChanges();

      expect(events.changes.map((event) => [event.previousMethod, event.method])).toEqual([
        [null, 'paypal'],
        ['paypal', 'card'],
      ]);
    });

    it('emits methodChange when the selected method becomes unavailable', async () => {
      const events = listen();
      fixture.componentRef.setInput('methods', ['card', 'paypal']);
      await render(fixture);
      expect(events.changes.at(-1)?.method).toBe('card');

      fixture.componentRef.setInput('methods', ['paypal']);
      await render(fixture);

      expect(events.changes.at(-1)).toEqual(
        jasmine.objectContaining({
          previousMethod: 'card',
          method: 'paypal',
          provider: 'paypal',
        }),
      );
    });

    it('drops a duplicate success callback for the same attempt', async () => {
      const events = listen();
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);
      const result: PaymentResult = {
        status: 'success',
        method: 'card',
        provider: 'stripe',
        transactionId: 'pi_123',
      };

      fixture.componentInstance.onPaymentStarted('card');
      fixture.componentInstance.onStripeSuccess(result);
      fixture.componentInstance.onStripeSuccess(result);

      expect(events.starts.length).toBe(1);
      expect(events.successes.length).toBe(1);
      expect(events.successes[0].transactionId).toBe('pi_123');
    });

    it('ignores terminal callbacks after the checkout is destroyed', async () => {
      const events = listen();
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);
      fixture.componentInstance.onPaymentStarted('card');
      fixture.destroy();

      fixture.componentInstance.onStripeSuccess({
        status: 'success',
        method: 'card',
        provider: 'stripe',
        transactionId: 'pi_late',
      });
      fixture.componentInstance.onPaymentStarted('paypal');

      expect(events.starts.length).toBe(1);
      expect(events.successes.length).toBe(0);
    });

    it('keeps diagnostics on readiness after a payment failure', async () => {
      TestBed.inject(MockPaymentController).setOutcome('failed');
      const events = listen();
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      payCta(fixture)!.click();
      await fixture.whenStable();

      const card = TestBed.inject(EasyPaymentsDiagnosticsService).method('card');
      expect(events.errors[0].code).toBe('PAYMENT_FAILED');
      expect(card?.readiness).toBe('ready');
      expect(card?.code).toBeUndefined();
    });
  });
});

describe('EasyPaymentsComponent real Stripe Card CTA appearance', () => {
  let fixture: ComponentFixture<EasyPaymentsComponent>;
  let adapter: jasmine.SpyObj<StripeCardAdapter>;

  beforeEach(async () => {
    adapter = jasmine.createSpyObj<StripeCardAdapter>(
      'StripeCardAdapter',
      [
        'initialize',
        'isAvailable',
        'createPayment',
        'ensureStripeLoaded',
        'createPaymentSession',
        'mountPaymentElement',
        'updateAppearance',
        'destroy',
        'confirmPayment',
        'isConfirming',
        'hasMountedElement',
      ],
      {
        provider: 'stripe',
        isMock: false,
      },
    );

    adapter.initialize.and.resolveTo();
    adapter.isAvailable.and.resolveTo(true);
    adapter.ensureStripeLoaded.and.resolveTo({} as never);
    adapter.createPaymentSession.and.resolveTo({ clientSecret: 'pi_secret_checkout_cta' });
    adapter.mountPaymentElement.and.resolveTo();
    adapter.updateAppearance.and.resolveTo();
    adapter.destroy.and.resolveTo();
    adapter.isConfirming.and.returnValue(false);
    adapter.hasMountedElement.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [EasyPaymentsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: { stripe: { publishableKey: 'pk_test_checkout_card_cta' } },
          backend: { createPaymentUrl: '/api/payments/create' },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
        { provide: StripeCardAdapter, useValue: adapter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EasyPaymentsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['card']);
  });

  it('forwards cardButtonAppearance onto the Stripe Card CTA', async () => {
    fixture.componentRef.setInput('cardButtonAppearance', {
      label: 'Checkout with card',
      backgroundColor: '#111827',
      textColor: '#f8fafc',
      borderRadius: '6px',
    });
    await render(fixture);

    const cardHost = fixture.nativeElement.querySelector(
      'easy-stripe-card-payment',
    ) as HTMLElement;
    expect(cardHost).toBeTruthy();
    const cta = cardHost.querySelector('button.ep-stripe-card__pay') as HTMLButtonElement;
    expect(cta.textContent?.trim()).toBe('Checkout with card');
    expect(cardHost.style.getPropertyValue('--ep-card-cta-bg').trim()).toBe('#111827');
    expect(cardHost.style.getPropertyValue('--ep-card-cta-text').trim()).toBe('#f8fafc');
    expect(cardHost.style.getPropertyValue('--ep-card-cta-radius').trim()).toBe('6px');
    expect(adapter.confirmPayment).not.toHaveBeenCalled();
  });

  it('keeps independent cardButtonAppearance per Full Checkout instance', async () => {
    fixture.componentRef.setInput('cardButtonAppearance', {
      label: 'Instance A',
      backgroundColor: '#aa0000',
    });
    await render(fixture);

    const fixtureB = TestBed.createComponent(EasyPaymentsComponent);
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixtureB.componentRef.setInput('methods', ['card']);
    fixtureB.componentRef.setInput('cardButtonAppearance', {
      label: 'Instance B',
      backgroundColor: '#00aa00',
    });
    await render(fixtureB);

    const hostA = fixture.nativeElement.querySelector(
      'easy-stripe-card-payment',
    ) as HTMLElement;
    const hostB = fixtureB.nativeElement.querySelector(
      'easy-stripe-card-payment',
    ) as HTMLElement;
    expect(hostA.style.getPropertyValue('--ep-card-cta-bg').trim()).toBe('#aa0000');
    expect(hostB.style.getPropertyValue('--ep-card-cta-bg').trim()).toBe('#00aa00');
    expect(hostA.querySelector('button.ep-stripe-card__pay')?.textContent?.trim()).toBe(
      'Instance A',
    );
    expect(hostB.querySelector('button.ep-stripe-card__pay')?.textContent?.trim()).toBe(
      'Instance B',
    );
    fixtureB.destroy();
  });
});
