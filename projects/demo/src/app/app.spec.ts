import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PaymentError, provideEasyPayments } from '@easy-payments/angular';
import { App } from './app';
import {
  clearPersistedDemoExperience,
  DEMO_EXPERIENCE_STORAGE_KEY,
  persistDemoExperience,
  readPersistedDemoExperience,
} from './demo-experience-persistence';
import {
  clearPersistedDemoMode,
  DEMO_MODE_STORAGE_KEY,
  persistDemoMode,
  readPersistedDemoMode,
} from './demo-mode-persistence';
import {
  clearPersistedDemoLocale,
  DEMO_LOCALE_STORAGE_KEY,
  persistDemoLocale,
  readPersistedDemoLocale,
} from './demo-locale-persistence';
import { DEMO_BNPL_BUTTONS_STORAGE_KEY } from './demo-bnpl-buttons-persistence';

function createMemoryStorage(): { memory: Record<string, string>; storage: Storage } {
  const memory: Record<string, string> = {};
  const storage: Storage = {
    getItem: (key: string) => (key in memory ? memory[key] : null),
    setItem: (key: string, value: string) => {
      memory[key] = value;
    },
    removeItem: (key: string) => {
      delete memory[key];
    },
    clear: () => {
      for (const key of Object.keys(memory)) {
        delete memory[key];
      }
    },
    key: () => null,
    length: 0,
  };
  return { memory, storage };
}

describe('demo-mode-persistence', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage().storage;
  });

  it('returns null when unset', () => {
    expect(readPersistedDemoMode(storage)).toBeNull();
  });

  it('persists and restores real mode', () => {
    persistDemoMode('real', storage);
    expect(storage.getItem(DEMO_MODE_STORAGE_KEY)).toBe('real');
    expect(readPersistedDemoMode(storage)).toBe('real');
  });

  it('persists demo mode', () => {
    persistDemoMode('demo', storage);
    expect(readPersistedDemoMode(storage)).toBe('demo');
  });
});

describe('demo-locale-persistence', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage().storage;
  });

  it('returns null when unset', () => {
    expect(readPersistedDemoLocale(storage)).toBeNull();
  });

  it('persists and restores es', () => {
    persistDemoLocale('es', storage);
    expect(storage.getItem(DEMO_LOCALE_STORAGE_KEY)).toBe('es');
    expect(readPersistedDemoLocale(storage)).toBe('es');
  });

  it('ignores invalid values', () => {
    storage.setItem(DEMO_LOCALE_STORAGE_KEY, 'fr');
    expect(readPersistedDemoLocale(storage)).toBeNull();
  });

  it('clears persisted locale', () => {
    persistDemoLocale('pt', storage);
    clearPersistedDemoLocale(storage);
    expect(readPersistedDemoLocale(storage)).toBeNull();
  });
});

describe('demo-experience-persistence', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage().storage;
  });

  it('returns null when unset', () => {
    expect(readPersistedDemoExperience(storage)).toBeNull();
  });

  it('persists and restores headless, buttons, and checkout', () => {
    persistDemoExperience('headless', storage);
    expect(storage.getItem(DEMO_EXPERIENCE_STORAGE_KEY)).toBe('headless');
    expect(readPersistedDemoExperience(storage)).toBe('headless');

    persistDemoExperience('buttons', storage);
    expect(readPersistedDemoExperience(storage)).toBe('buttons');

    persistDemoExperience('checkout', storage);
    expect(readPersistedDemoExperience(storage)).toBe('checkout');
  });

  it('ignores invalid stored experience', () => {
    storage.setItem(DEMO_EXPERIENCE_STORAGE_KEY, 'wallet-only');
    expect(readPersistedDemoExperience(storage)).toBeNull();
  });

  it('does not crash when storage read/write throws', () => {
    const broken: Storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
      clear: () => undefined,
      key: () => null,
      length: 0,
    };
    expect(readPersistedDemoExperience(broken)).toBeNull();
    expect(() => persistDemoExperience('headless', broken)).not.toThrow();
    expect(() => clearPersistedDemoExperience(broken)).not.toThrow();
  });

  it('clears persisted experience', () => {
    persistDemoExperience('buttons', storage);
    clearPersistedDemoExperience(storage);
    expect(readPersistedDemoExperience(storage)).toBeNull();
  });
});

describe('App', () => {
  beforeEach(async () => {
    clearPersistedDemoMode();
    clearPersistedDemoLocale();
    clearPersistedDemoExperience();
    sessionStorage.removeItem(DEMO_BNPL_BUTTONS_STORAGE_KEY);
    history.replaceState({}, '', '/');

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        provideEasyPayments({ enableMockMode: true, providers: {} }),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    clearPersistedDemoMode();
    clearPersistedDemoLocale();
    clearPersistedDemoExperience();
    sessionStorage.removeItem(DEMO_BNPL_BUTTONS_STORAGE_KEY);
    history.replaceState({}, '', '/');
  });

  async function flushCatalogIfPending(): Promise<void> {
    const http = TestBed.inject(HttpTestingController);
    const catalogReqs = http.match((req) => req.url.includes('/api/catalog/products'));
    for (const req of catalogReqs) {
      req.flush({
        id: 'premium-plan',
        name: 'Premium Plan',
        description: 'One year subscription',
        unitAmount: 99.99,
        currency: 'USD',
      });
    }
  }

  async function settle(fixture: ReturnType<typeof TestBed.createComponent<App>>): Promise<void> {
    fixture.detectChanges();
    const deadline = Date.now() + 5000;

    while (!fixture.componentInstance.checkoutReady() && Date.now() < deadline) {
      // Flush catalog before whenStable — pending HttpClientTesting requests can
      // otherwise stall whenStable and prevent the flush loop from progressing.
      await flushCatalogIfPending();
      fixture.detectChanges();
      await Promise.resolve();
      if (fixture.componentInstance.checkoutReady()) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    await flushCatalogIfPending();
    expect(fixture.componentInstance.checkoutReady()).toBeTrue();
    // Avoid fixture.whenStable() here: Real mode mounts Stripe ECE for Apple Pay
    // availability and can keep the zone unstable indefinitely in Karma.
    fixture.detectChanges();
  }

  it('should create the demo playground', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the Easy Payments demo and default to Demo Mode', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Payment playground');
    expect(compiled.textContent).toContain('Demo Mode');
    expect(fixture.componentInstance.mode()).toBe('demo');
    expect(fixture.componentInstance.playgroundExperience()).toBe('checkout');
    expect(compiled.querySelector('easy-payments')).toBeTruthy();
    expect(compiled.querySelector('easy-payment-buttons')).toBeNull();
    expect(fixture.componentInstance.product().metadata).toEqual({
      orderId: 'ORDER-12345',
      customerReference: 'CUSTOMER-789',
    });
    const metadataExample = compiled.querySelector('[data-testid="merchant-metadata-example"]');
    expect(metadataExample?.textContent).toContain('ORDER-12345');
    expect(
      compiled.querySelector('[data-testid="developer-diagnostics"]')?.textContent,
    ).not.toContain('ORDER-12345');
  });

  it('shows developer diagnostics separately from the checkout', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    const section = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="developer-diagnostics"]',
    );
    expect(section).toBeTruthy();
    expect(section?.textContent).toContain('card · stripe · ready');
    expect(section?.textContent).toContain('paypal · paypal · ready');
    expect(section?.textContent).not.toContain('sk_');
    expect(section?.textContent).not.toContain('client_secret');
    expect((fixture.nativeElement as HTMLElement).querySelector('easy-payments')).toBeTruthy();
  });

  it('switches to Payment Buttons Only with live config and generated example', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    const app = fixture.componentInstance;
    app.setPlaygroundExperience('buttons');
    app.setButtonsLayout('vertical');
    app.setButtonsSeparators('line');
    app.setButtonsBorder('none');
    app.buttonsGap.set(16);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(app.playgroundExperience()).toBe('buttons');
    expect(compiled.querySelector('easy-payments')).toBeNull();
    expect(compiled.querySelector('easy-payment-buttons')).toBeTruthy();
    expect(compiled.querySelector('app-headless-demo')).toBeNull();
    expect(compiled.querySelector('[data-testid="config-section-buttons-bnpl-direct"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="buttons-bnpl-confirm-mode"]')).toBeTruthy();
    expect(app.buttonsBnplConfirmMode()).toBe('element');
    expect(
      (compiled.querySelector('easy-payment-buttons') as HTMLElement).getAttribute(
        'data-bnpl-confirm-mode',
      ),
    ).toBe('element');
    expect(compiled.querySelector('[data-testid="easy-payment-buttons-demo-notice"]')).toBeTruthy();
    expect(compiled.querySelector('.ep-payment-buttons__demo')).toBeNull();
    expect(compiled.querySelector('.buttons-code__pre')?.textContent).toContain(
      'easy-payment-buttons',
    );
    expect(compiled.querySelector('.buttons-code__pre')?.textContent).toContain("layout=\"vertical\"");
    expect(compiled.querySelector('.buttons-code__pre')?.textContent).toContain('separators');
    expect(app.buttonsAppearance().border).toBe('none');
    expect(app.buttonsAppearance().gap).toBe('16px');
    expect(compiled.querySelector('[data-testid="demo-buttons-styled-library"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="demo-buttons-merchant-owned"]')).toBeTruthy();
    expect(
      compiled.querySelector('[data-testid="demo-buttons-merchant-owned"] easy-payment-buttons')
        ?.getAttribute('data-selector-visibility'),
    ).toBe('merchant');
    expect(compiled.querySelector('[data-testid="demo-merchant-status"]')?.textContent).toContain(
      'Idle',
    );
    expect(compiled.querySelector('[data-testid="demo-merchant-klarna"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="demo-merchant-affirm"]')).toBeTruthy();
  });

  it('does not start a payment when Buttons BNPL mode or customer fields change', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);
    const app = fixture.componentInstance;
    app.setPlaygroundExperience('buttons');
    fixture.detectChanges();

    const host = () =>
      (fixture.nativeElement as HTMLElement).querySelector(
        'easy-payment-buttons',
      ) as HTMLElement | null;
    expect(host()?.getAttribute('data-bnpl-direct-active')).toBe('false');

    app.setButtonsBnplConfirmMode('auto');
    app.fillButtonsBnplTestSample();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(app.buttonsBnplConfirmMode()).toBe('auto');
    expect(app.buttonsCheckout()?.customer?.email).toBe('jenny.rosen@example.com');
    expect(host()?.getAttribute('data-bnpl-direct-active')).toBe('false');
    expect(host()?.getAttribute('data-bnpl-confirm-mode')).toBe('auto');
  });

  it('switches to Headless Checkout with merchant-owned panel and mount host', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    const app = fixture.componentInstance;
    app.setPlaygroundExperience('headless');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(app.playgroundExperience()).toBe('headless');
    expect(compiled.querySelector('easy-payments')).toBeNull();
    expect(compiled.querySelector('easy-payment-buttons')).toBeNull();
    expect(compiled.querySelector('app-headless-demo')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="headless-demo-panel"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="headless-demo-identity"]')?.textContent).toContain(
      'demo-headless-1',
    );
    expect(compiled.querySelector('[data-testid="headless-demo-availability"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="headless-demo-product"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="headless-demo-mount-host"]')).toBeTruthy();
    expect(compiled.textContent).toContain('recoverReturn');
    expect(compiled.querySelector('[data-testid="headless-demo-pay"], [data-testid="headless-demo-mount-idle"]')).toBeTruthy();
    expect(compiled.textContent).not.toContain('client_secret');
  });

  it('destroys Headless when leaving and creates a fresh session on return', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    const app = fixture.componentInstance;
    app.setPlaygroundExperience('headless');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const firstId = (
      fixture.nativeElement as HTMLElement
    ).querySelector('[data-testid="headless-demo-identity"]')?.textContent;
    expect(firstId).toContain('demo-headless-1');

    app.setPlaygroundExperience('checkout');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('app-headless-demo')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('easy-payments')).toBeTruthy();

    app.setPlaygroundExperience('headless');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-headless-demo')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="headless-demo-identity"]')?.textContent).toContain(
      'demo-headless-1',
    );
    expect(compiled.querySelector('easy-payments')).toBeNull();
  });

  it('keeps theme controls compatible with Headless mode', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    const app = fixture.componentInstance;
    app.setPlaygroundExperience('headless');
    app.theme.set('dark');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(app.theme()).toBe('dark');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-headless-demo')).toBeTruthy();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="config-section-theme"]'),
    ).toBeTruthy();
  });

  it('shows host-owned Buttons Only outcomes outside the library component', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    const app = fixture.componentInstance;
    app.setPlaygroundExperience('buttons');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="demo-buttons-host-outcome"]')).toBeNull();

    app.onPaymentSuccess({
      status: 'success',
      method: 'card',
      provider: 'stripe',
      transactionId: 'pi_demo_host',
    });
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector(
      '[data-testid="demo-buttons-host-outcome"]',
    ) as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('data-kind')).toBe('success');
    expect(banner.textContent).toContain('Demo application (not library UI)');
    expect(banner.textContent).toContain('pi_demo_host');
    expect(fixture.nativeElement.querySelector('easy-payment-buttons')?.textContent).not.toContain(
      'Demo application (not library UI)',
    );
    expect(app.lastEvent()).toContain('success · card · pi_demo_host');

    app.onPaymentPending({
      status: 'processing',
      method: 'klarna',
      provider: 'klarna',
    });
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="demo-buttons-host-outcome"]')
        ?.getAttribute('data-kind'),
    ).toBe('pending');
    expect(app.lastEvent()).toContain('pending · klarna');

    app.onPaymentCancel({
      status: 'cancelled',
      method: 'paypal',
      provider: 'paypal',
      sessionId: 'ORDER-CANCEL-DEMO',
    });
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="demo-buttons-host-outcome"]')
        ?.getAttribute('data-kind'),
    ).toBe('cancel');
    expect(app.lastEvent()).toContain('cancel · paypal');
    expect(fixture.nativeElement.querySelector('easy-payment-buttons')?.textContent).not.toContain(
      'Payment cancelled',
    );

    app.onPaymentError(
      new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Instrument declined',
        method: 'paypal',
        provider: 'paypal',
      }),
    );
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="demo-buttons-host-outcome"]')
        ?.getAttribute('data-kind'),
    ).toBe('error');
    expect(app.lastEvent()).toContain('error · paypal');
    expect(fixture.nativeElement.querySelector('easy-payment-buttons')?.textContent).not.toContain(
      'Payment failed',
    );
  });

  it('defaults payment methods with Card first in a six-method order', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.setPlaygroundExperience('checkout');

    expect(app.methods()).toEqual([
      'card',
      'paypal',
      'apple-pay',
      'google-pay',
      'klarna',
      'affirm',
    ]);
    expect(app.checkoutMaxWidth()).toBe(640);

    await settle(fixture);

    // Availability publish is async; wait briefly for method tiles.
    for (let i = 0; i < 20; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      if (fixture.nativeElement.querySelectorAll('button.ep-tile').length >= 6) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(fixture.nativeElement.querySelector('easy-payments')).toBeTruthy();
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('button.ep-tile') as NodeListOf<HTMLButtonElement>,
    ).map((button) => (button.getAttribute('aria-label') ?? '').replace(/,.*/, ''));

    expect(labels).toEqual(['Card', 'PayPal', 'Apple Pay', 'Google Pay', 'Klarna', 'Affirm']);
    expect(labels[0]).toBe('Card');
    expect(
      (fixture.nativeElement.querySelector('button.ep-tile[aria-checked="true"]') as HTMLButtonElement)
        ?.getAttribute('aria-label') ?? '',
    ).toContain('Card');
  });

  it('updates the checkout maxWidth control live', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await settle(fixture);
    app.setCheckoutMaxWidth(1100);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement.querySelector('easy-payments') as HTMLElement;
    expect(app.checkoutMaxWidth()).toBe(1100);
    expect(host.style.maxWidth).toBe('1100px');
  });

  it('organizes playground controls into labeled collapsible sections', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    const root = fixture.nativeElement as HTMLElement;
    const sectionIds = [
      'config-section-experience',
      'config-section-providers',
      'config-section-checkout-product',
      'config-section-payment-methods',
      'config-section-card-cta',
      'config-section-theme',
      'config-section-locale',
      'config-section-testing',
    ];
    for (const id of sectionIds) {
      expect(root.querySelector(`[data-testid="${id}"]`)).toBeTruthy();
    }

    const cardCta = root.querySelector(
      '[data-testid="config-section-card-cta"]',
    ) as HTMLDetailsElement;
    expect(cardCta.open).toBeFalse();
    expect(cardCta.textContent).toContain('Stripe Card payment button appearance');
    expect(cardCta.textContent).toContain('Both components');
    expect(cardCta.textContent).toContain('confirmation');

    const methods = root.querySelector(
      '[data-testid="config-section-payment-methods"]',
    ) as HTMLDetailsElement;
    expect(methods.open).toBeTrue();
    expect(methods.textContent).toContain('not the Card confirmation CTA');

    cardCta.open = true;
    fixture.detectChanges();
    expect(cardCta.open).toBeTrue();
    expect(root.querySelector('[data-testid="card-cta-label"]')).toBeTruthy();

    expect(root.querySelector('[data-testid="config-section-buttons-appearance"]')).toBeNull();
    fixture.componentInstance.setPlaygroundExperience('buttons');
    fixture.detectChanges();
    const buttonsSection = root.querySelector(
      '[data-testid="config-section-buttons-appearance"]',
    ) as HTMLDetailsElement;
    expect(buttonsSection).toBeTruthy();
    expect(buttonsSection.open).toBeTrue();
    expect(buttonsSection.textContent).toContain('Payment method buttons appearance');
    expect(buttonsSection.textContent).toContain('not the Stripe Card');
  });

  it('applies and resets Stripe Card CTA appearance for both hosts', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await settle(fixture);

    expect(app.cardButtonAppearance()).toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="card-cta-active"]')
        ?.textContent,
    ).toContain('null (theme defaults)');

    app.applyCardCtaSample();
    fixture.detectChanges();
    expect(app.cardButtonAppearance()?.label).toBe('Complete card payment');
    expect(app.cardButtonAppearance()?.backgroundColor).toBe('#0b6e4f');
    expect(app.cardButtonAppearance()?.border).toBe('none');

    const checkout = fixture.nativeElement.querySelector('easy-payments') as HTMLElement;
    expect(checkout).toBeTruthy();

    app.setPlaygroundExperience('buttons');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('easy-payment-buttons')).toBeTruthy();
    expect(app.buttonsCodeExample()).toContain('cardButtonAppearance');
    expect(app.buttonsCodeExample()).toContain('Complete card payment');

    app.resetCardButtonAppearance();
    fixture.detectChanges();
    expect(app.cardButtonAppearance()).toBeNull();
  });

  it('exposes Phase 3 visualStyle QA controls and applies presets live', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await settle(fixture);

    const panel = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="phase3-visual-qa"]',
    );
    expect(panel).toBeTruthy();
    expect(app.visualStyle()).toBeNull();
    expect(app.showMultiInstanceQa()).toBeFalse();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="multi-instance-qa"]'),
    ).toBeNull();

    app.applyVisualQaPreset('custom-light');
    fixture.detectChanges();

    expect(app.theme()).toBe('light');
    expect(app.appearance()).toBe('default');
    expect(app.visualStyle()?.accentColor).toBe('#c2410c');
    expect(app.visualStyleSummary()).toContain('#c2410c');

    const host = fixture.nativeElement.querySelector('easy-payments') as HTMLElement;
    expect(host.style.getPropertyValue('--ep-accent').trim()).toBe('#c2410c');
    expect(host.style.getPropertyValue('--ep-surface').trim()).toBe('#fff7ed');

    app.applyVisualQaPreset('low-contrast');
    fixture.detectChanges();
    expect(app.visualQaPresetId()).toBe('low-contrast');
    expect(app.visualStyle()?.textColor).toBe('#cccccc');
    expect(panel?.textContent).toContain('DevTools');

    app.resetVisualStyle();
    fixture.detectChanges();
    expect(app.visualStyle()).toBeNull();
    expect(app.visualQaPresetId()).toBe('default');
    expect(host.style.getPropertyValue('--ep-accent').trim()).toBe('');
  });

  it('applies transparent visual QA preset without clearing tile surface token', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await settle(fixture);

    app.applyVisualQaPreset('transparent');
    fixture.detectChanges();

    expect(app.appearance()).toBe('transparent');
    expect(app.transparentPreviewBackdrop()).toBe('dark');
    expect(app.visualStyle()?.backgroundColor).toBe('transparent');
    expect(app.visualStyle()?.surfaceColor).toBe('#ffffff');

    const host = fixture.nativeElement.querySelector('easy-payments') as HTMLElement;
    expect(host.classList.contains('ep-appearance-transparent')).toBeTrue();
    expect(host.style.getPropertyValue('--ep-background').trim()).toBe('transparent');
    expect(host.style.getPropertyValue('--ep-surface').trim()).toBe('#ffffff');
  });

  it('mounts dual-instance theme QA only when enabled', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await settle(fixture);

    expect(fixture.nativeElement.querySelectorAll('easy-payments').length).toBe(1);

    app.setShowMultiInstanceQa(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const section = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="multi-instance-qa"]',
    );
    expect(section).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('easy-payments').length).toBe(3);

    const [primary, instanceA, instanceB] = Array.from(
      fixture.nativeElement.querySelectorAll('easy-payments') as NodeListOf<HTMLElement>,
    );
    expect(instanceA.classList.contains('ep-theme-dark')).toBeFalse();
    expect(instanceB.classList.contains('ep-theme-dark')).toBeTrue();
    expect(instanceA.style.getPropertyValue('--ep-accent').trim()).toBe('#2563eb');
    expect(instanceB.style.getPropertyValue('--ep-accent').trim()).toBe('#34d399');
    expect(primary).toBeTruthy();

    app.setShowMultiInstanceQa(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('easy-payments').length).toBe(1);
  });

  it('marks field edits as a custom visual QA preset', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await settle(fixture);

    app.updateVisualStyleField('accentColor', '#1111aa');
    fixture.detectChanges();

    expect(app.visualQaPresetId()).toBe('custom');
    expect(app.visualStyle()).toEqual({ accentColor: '#1111aa' });

    const host = fixture.nativeElement.querySelector('easy-payments') as HTMLElement;
    expect(host.style.getPropertyValue('--ep-accent').trim()).toBe('#1111aa');
  });

  it('keeps product pricing editable in Real mode', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    expect(app.product().amount).toBe(99);

    app.mode.set('real');
    app.trustedCatalogProduct.set({
      id: 'premium-plan',
      name: 'Premium Plan',
      description: 'One year subscription',
      unitAmount: 99,
      currency: 'USD',
    });

    expect(app.productFieldsLocked()).toBeFalse();
    expect(app.product().id).toBe('premium-plan');
    expect(app.product().amount).toBe(99);
    expect(app.product().currency).toBe('USD');

    // Edits in Real mode reach the product the checkout renders and charges.
    app.productAmount.set('2.5');
    expect(app.product().amount).toBe(2.5);
  });

  it('persists Real mode when selected', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    if (!fixture.componentInstance.realProvidersReady()) {
      persistDemoMode('real');
      expect(readPersistedDemoMode()).toBe('real');
      return;
    }

    const switchPromise = fixture.componentInstance.setMode('real');
    await flushCatalogIfPending();
    await switchPromise;
    fixture.detectChanges();

    expect(fixture.componentInstance.mode()).toBe('real');
    expect(readPersistedDemoMode()).toBe('real');
    expect(fixture.nativeElement.textContent).toContain('Real / Test Providers');
  });

  it('forces Real recovery mode when Klarna return URL is present', async () => {
    history.replaceState(
      {},
      '',
      '/?payment_intent=pi_x&payment_intent_client_secret=sec_x&ep_method=klarna',
    );

    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    if (fixture.componentInstance.realProvidersReady()) {
      expect(fixture.componentInstance.mode()).toBe('real');
      expect(readPersistedDemoMode()).toBe('real');
    } else {
      expect(fixture.componentInstance.checkoutReady()).toBeTrue();
    }
  });

  it('Continue after success preserves Real mode when already real', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);
    const app = fixture.componentInstance;

    app.mode.set('real');
    persistDemoMode('real');
    app.onSuccessContinue({
      status: 'success',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_continue',
    });

    expect(app.mode()).toBe('real');
    expect(readPersistedDemoMode()).toBe('real');
    expect(app.lastEvent()).toContain('Continue after success');
  });

  it('persists Demo when selecting Demo Mode', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);
    await fixture.componentInstance.setMode('demo');
    expect(readPersistedDemoMode()).toBe('demo');
    expect(fixture.componentInstance.mode()).toBe('demo');
  });

  it('defaults to Full Checkout when no saved experience exists', async () => {
    clearPersistedDemoExperience();
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    expect(fixture.componentInstance.playgroundExperience()).toBe('checkout');
    expect((fixture.nativeElement as HTMLElement).querySelector('easy-payments')).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('app-headless-demo')).toBeNull();
  });

  it('persists experience changes and restores Headless / Buttons / Full Checkout', async () => {
    const fixture = TestBed.createComponent(App);
    await settle(fixture);
    const app = fixture.componentInstance;

    app.setPlaygroundExperience('headless');
    expect(readPersistedDemoExperience()).toBe('headless');
    app.setPlaygroundExperience('buttons');
    expect(readPersistedDemoExperience()).toBe('buttons');
    app.setPlaygroundExperience('checkout');
    expect(readPersistedDemoExperience()).toBe('checkout');
  });

  it('restores saved Headless Checkout on bootstrap', async () => {
    persistDemoExperience('headless');
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    expect(fixture.componentInstance.playgroundExperience()).toBe('headless');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-headless-demo')).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('easy-payments')).toBeNull();
  });

  it('restores saved Payment Buttons Only on bootstrap', async () => {
    persistDemoExperience('buttons');
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    expect(fixture.componentInstance.playgroundExperience()).toBe('buttons');
    expect((fixture.nativeElement as HTMLElement).querySelector('easy-payment-buttons')).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('easy-payments')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('app-headless-demo')).toBeNull();
  });

  it('restores saved Full Checkout on bootstrap', async () => {
    persistDemoExperience('checkout');
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    expect(fixture.componentInstance.playgroundExperience()).toBe('checkout');
    expect((fixture.nativeElement as HTMLElement).querySelector('easy-payments')).toBeTruthy();
  });

  it('falls back to Full Checkout when stored experience is invalid', async () => {
    sessionStorage.setItem(DEMO_EXPERIENCE_STORAGE_KEY, 'not-a-valid-experience');
    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    expect(readPersistedDemoExperience()).toBeNull();
    expect(fixture.componentInstance.playgroundExperience()).toBe('checkout');
    expect((fixture.nativeElement as HTMLElement).querySelector('easy-payments')).toBeTruthy();
  });

  it('restores Headless before recovery init when BNPL return URL is present', async () => {
    persistDemoExperience('headless');
    history.replaceState(
      {},
      '',
      '/?payment_intent=pi_x&payment_intent_client_secret=sec_x&ep_method=klarna',
    );

    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    expect(fixture.componentInstance.playgroundExperience()).toBe('headless');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-headless-demo')).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('easy-payments')).toBeNull();
    // Experience restore must not fabricate a successful payment result.
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-last-result"]'),
    ).toBeNull();
  });

  it('restores Full Checkout on BNPL return when that experience was selected', async () => {
    persistDemoExperience('checkout');
    history.replaceState(
      {},
      '',
      '/?payment_intent=pi_y&payment_intent_client_secret=sec_y&ep_method=affirm',
    );

    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    expect(fixture.componentInstance.playgroundExperience()).toBe('checkout');
    expect((fixture.nativeElement as HTMLElement).querySelector('easy-payments')).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('app-headless-demo')).toBeNull();
  });

  it('does not change experience merely because a BNPL return URL exists', async () => {
    persistDemoExperience('buttons');
    history.replaceState(
      {},
      '',
      '/?payment_intent=pi_z&payment_intent_client_secret=sec_z&ep_method=klarna',
    );

    const fixture = TestBed.createComponent(App);
    await settle(fixture);

    expect(fixture.componentInstance.playgroundExperience()).toBe('buttons');
    expect((fixture.nativeElement as HTMLElement).querySelector('easy-payment-buttons')).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('app-headless-demo')).toBeNull();
  });
});
