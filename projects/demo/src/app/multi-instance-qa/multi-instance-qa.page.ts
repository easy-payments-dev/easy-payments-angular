import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  EasyPaymentButtonsComponent,
  EasyPaymentsComponent,
  MockPaymentController,
  PaymentError,
  PaymentMethod,
  PaymentProduct,
  PaymentResult,
  PaymentTheme,
  type EasyPaymentButtonsAppearance,
  type EasyPaymentButtonsLayout,
  type EasyPaymentsLocale,
} from '@easy-payments/angular';

type QaScenario =
  | 'one-checkout'
  | 'one-buttons'
  | 'ten-buttons'
  | 'ten-checkouts'
  | 'five-plus-five'
  | 'mixed-methods'
  | 'layouts-themes'
  | 'buttons-style'
  | 'buttons-locale'
  | 'destroy-recreate'
  | 'unavailable';

interface QaHostSpec {
  readonly id: string;
  readonly kind: 'checkout' | 'buttons';
  readonly product: PaymentProduct;
  readonly methods: PaymentMethod[];
  readonly theme: PaymentTheme;
  readonly layout?: EasyPaymentButtonsLayout;
  readonly locale?: EasyPaymentsLocale;
  readonly buttonsAppearance?: EasyPaymentButtonsAppearance;
  readonly checkoutInstanceId: string;
}

const ALL_METHODS: PaymentMethod[] = [
  'apple-pay',
  'google-pay',
  'paypal',
  'card',
  'klarna',
  'affirm',
];

function product(i: number): PaymentProduct {
  return {
    id: `qa-plan-${i}`,
    name: `QA Plan ${i}`,
    description: 'Multi-instance visual QA product',
    amount: 10 + i,
    currency: 'USD',
    quantity: 1,
  };
}

@Component({
  selector: 'app-multi-instance-qa',
  standalone: true,
  imports: [EasyPaymentsComponent, EasyPaymentButtonsComponent],
  templateUrl: './multi-instance-qa.page.html',
  styleUrl: './multi-instance-qa.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiInstanceQaPage {
  private readonly mock = inject(MockPaymentController);

  readonly scenario = signal<QaScenario>('one-checkout');
  readonly remountToken = signal(0);
  readonly log = signal<string[]>([]);

  readonly scenarios: { id: QaScenario; label: string }[] = [
    { id: 'one-checkout', label: '1. One full checkout' },
    { id: 'one-buttons', label: '2. One Buttons Only' },
    { id: 'ten-buttons', label: '3. Ten Buttons Only' },
    { id: 'ten-checkouts', label: '4. Ten full checkouts' },
    { id: 'five-plus-five', label: '5. Five + five mixed' },
    { id: 'mixed-methods', label: '6. Mixed methods / order' },
    { id: 'layouts-themes', label: '7. Layouts & themes' },
    { id: 'buttons-style', label: '8. Strip styles / separators' },
    { id: 'buttons-locale', label: '9. EN / ES Buttons Only' },
    { id: 'destroy-recreate', label: '10. Destroy / recreate' },
    { id: 'unavailable', label: '11. Provider unavailable' },
  ];

  readonly hosts = computed<QaHostSpec[]>(() => {
    // remountToken forces a fresh host list after destroy/recreate.
    void this.remountToken();
    return this.buildHosts(this.scenario());
  });

  constructor() {
    this.mock.reset();
    this.mock.setOutcome('success');
    this.mock.setUnavailableMethods([]);
  }

  setScenario(id: QaScenario): void {
    this.mock.reset();
    this.mock.setOutcome('success');
    if (id === 'unavailable') {
      this.mock.setUnavailableMethods(['card', 'apple-pay']);
    } else {
      this.mock.setUnavailableMethods([]);
    }
    this.scenario.set(id);
    this.pushLog(`Scenario → ${id}`);
  }

  remount(): void {
    this.remountToken.update((n) => n + 1);
    this.pushLog('Hosts remounted');
  }

  setMockOutcome(outcome: 'success' | 'failed' | 'cancelled'): void {
    this.mock.setOutcome(outcome);
    this.pushLog(`Mock outcome → ${outcome}`);
  }

  onSuccess(hostId: string, result: PaymentResult): void {
    this.pushLog(`[${hostId}] success ${result.method} ${result.transactionId ?? ''}`.trim());
  }

  onPending(hostId: string, result: PaymentResult): void {
    this.pushLog(`[${hostId}] pending ${result.method}`);
  }

  onCancel(hostId: string, result: PaymentResult): void {
    this.pushLog(`[${hostId}] cancel ${result.method}`);
  }

  onError(hostId: string, error: PaymentError): void {
    this.pushLog(`[${hostId}] error ${error.code}`);
  }

  private pushLog(line: string): void {
    const stamp = new Date().toISOString().slice(11, 19);
    this.log.update((rows) => [`${stamp} ${line}`, ...rows].slice(0, 40));
  }

  private buildHosts(scenario: QaScenario): QaHostSpec[] {
    switch (scenario) {
      case 'one-checkout':
        return [this.checkoutHost(0, ALL_METHODS, 'light')];
      case 'one-buttons':
        return [this.buttonsHost(0, ALL_METHODS, 'light', 'horizontal')];
      case 'ten-buttons':
        return Array.from({ length: 10 }, (_, i) =>
          this.buttonsHost(
            i,
            ALL_METHODS,
            i % 2 ? 'dark' : 'light',
            i % 2 ? 'horizontal' : 'vertical',
          ),
        );
      case 'ten-checkouts':
        return Array.from({ length: 10 }, (_, i) =>
          this.checkoutHost(i, ALL_METHODS, i % 2 ? 'dark' : 'light'),
        );
      case 'five-plus-five':
        return Array.from({ length: 10 }, (_, i) =>
          i % 2
            ? this.buttonsHost(i, ALL_METHODS, 'light', 'vertical')
            : this.checkoutHost(i, ALL_METHODS, 'light'),
        );
      case 'mixed-methods':
        return [
          this.buttonsHost(0, ['card', 'paypal'], 'light', 'vertical'),
          this.buttonsHost(1, ['klarna', 'affirm', 'card'], 'dark', 'horizontal'),
          this.checkoutHost(2, ['paypal', 'google-pay', 'apple-pay'], 'light'),
          this.buttonsHost(3, ['google-pay', 'card', 'paypal', 'klarna'], 'light', 'vertical'),
          this.checkoutHost(4, ALL_METHODS, 'dark'),
        ];
      case 'layouts-themes':
        return [
          this.buttonsHost(0, ALL_METHODS, 'light', 'vertical'),
          this.buttonsHost(1, ALL_METHODS, 'dark', 'horizontal'),
          this.buttonsHost(2, ALL_METHODS, 'system', 'horizontal'),
          this.checkoutHost(3, ALL_METHODS, 'dark'),
          this.checkoutHost(4, ALL_METHODS, 'light'),
        ];
      case 'buttons-style':
        return [
          this.buttonsHost(0, ALL_METHODS, 'light', 'horizontal', 'en', {
            separators: 'line',
            gap: '16px',
            background: 'transparent',
          }),
          this.buttonsHost(1, ALL_METHODS, 'light', 'horizontal', 'en', {
            border: 'none',
            borderRadius: '999px',
            background: '#f8fafc',
            gap: '10px',
          }),
          this.buttonsHost(2, ALL_METHODS, 'dark', 'vertical', 'en', {
            separators: 'line',
            separatorColor: '#475569',
            borderRadius: '8px',
            buttonHeight: '44px',
          }),
          this.buttonsHost(3, ALL_METHODS, 'light', 'vertical', 'en', {
            border: 'default',
            borderColor: '#2563eb',
            borderWidth: '2px',
            borderRadius: '0',
          }),
        ];
      case 'buttons-locale':
        return [
          this.buttonsHost(0, ALL_METHODS, 'light', 'horizontal', 'en'),
          this.buttonsHost(1, ALL_METHODS, 'light', 'horizontal', 'es'),
        ];
      case 'destroy-recreate':
        return [
          this.checkoutHost(0, ['card', 'paypal'], 'light'),
          this.buttonsHost(1, ALL_METHODS, 'dark', 'vertical'),
        ];
      case 'unavailable':
        return [
          this.buttonsHost(0, ALL_METHODS, 'light', 'vertical'),
          this.checkoutHost(1, ALL_METHODS, 'light'),
        ];
    }
  }

  private checkoutHost(i: number, methods: PaymentMethod[], theme: PaymentTheme): QaHostSpec {
    return {
      id: `checkout-${i}`,
      kind: 'checkout',
      product: product(i),
      methods,
      theme,
      checkoutInstanceId: `qa-checkout-${i}`,
    };
  }

  private buttonsHost(
    i: number,
    methods: PaymentMethod[],
    theme: PaymentTheme,
    layout: EasyPaymentButtonsLayout,
    locale: EasyPaymentsLocale = 'en',
    buttonsAppearance?: EasyPaymentButtonsAppearance,
  ): QaHostSpec {
    return {
      id: `buttons-${i}`,
      kind: 'buttons',
      product: product(i),
      methods,
      theme,
      layout,
      locale,
      buttonsAppearance,
      checkoutInstanceId: `qa-buttons-${i}`,
    };
  }
}
