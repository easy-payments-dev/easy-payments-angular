import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { PaymentError } from '../../errors/payment-error';
import { PaymentMethod, PAYMENT_METHOD_LABELS, PaymentProduct, PaymentResult } from '../../models';
import { formatMoney } from '../../utils/format-money';
import { EasyPaymentsI18nService, EN_TRANSLATIONS, localizePaymentError } from '../../i18n';
import { CheckoutViewState, formatTransactionReference } from './checkout-view-state';

@Component({
  selector: 'easy-checkout-outcome',
  standalone: true,
  template: `
    <div
      class="ep-outcome"
      [attr.data-state]="state()"
      [attr.aria-live]="state() === 'processing' ? 'assertive' : 'polite'"
      role="status"
    >
      <div class="ep-outcome__icon" aria-hidden="true">
        @switch (state()) {
          @case ('processing') {
            <span class="ep-outcome__spinner"></span>
          }
          @case ('success') {
            <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
              <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="2" />
              <path
                d="M14 24.5 20.5 31 34 17"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          }
          @case ('error') {
            <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
              <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="2" />
              <path
                d="M24 14v14M24 34h.01"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
              />
            </svg>
          }
          @case ('cancelled') {
            <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
              <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="2" />
              <path
                d="M16 24h16"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
              />
            </svg>
          }
        }
      </div>

      <h2 #heading class="ep-outcome__title" tabindex="-1">{{ title() }}</h2>
      <p class="ep-outcome__body">{{ body() }}</p>

      @if (state() === 'success' && product(); as item) {
        <p class="ep-outcome__product">{{ item.name }}</p>
        <dl class="ep-outcome__details">
          <div class="ep-outcome__row">
            <dt>{{ msgs().successTotal }}</dt>
            <dd>{{ totalLabel() }}</dd>
          </div>
          @if (methodLabel()) {
            <div class="ep-outcome__row">
              <dt>{{ msgs().successPaidWith }}</dt>
              <dd>{{ methodLabel() }}</dd>
            </div>
          }
          @if (transactionRef()) {
            <div class="ep-outcome__row">
              <dt>{{ msgs().successTransaction }}</dt>
              <dd class="ep-outcome__mono">{{ transactionRef() }}</dd>
            </div>
          }
        </dl>
      }

      @if (state() === 'error' && safeErrorMessage()) {
        <p class="ep-outcome__detail-message">{{ safeErrorMessage() }}</p>
      }

      @if (state() !== 'processing') {
        <button type="button" class="ep-outcome__action" (click)="onAction()">
          {{ actionLabel() }}
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        font-family: var(--ep-font-family, inherit);
      }

      .ep-outcome {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 12px;
        padding: 12px 4px 4px;
        animation: ep-outcome-in 180ms ease-out;
      }

      .ep-outcome__icon {
        display: inline-flex;
        color: var(--ep-text-secondary, #64748b);
        margin-bottom: 4px;
      }

      .ep-outcome[data-state='success'] .ep-outcome__icon {
        color: var(--ep-success, #15803d);
      }

      .ep-outcome[data-state='error'] .ep-outcome__icon {
        color: var(--ep-danger, #b91c1c);
      }

      .ep-outcome[data-state='cancelled'] .ep-outcome__icon {
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-outcome[data-state='processing'] .ep-outcome__icon {
        color: var(--ep-accent, #2563eb);
      }

      .ep-outcome__spinner {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 3px solid var(--ep-border, #e2e8f0);
        border-top-color: var(--ep-accent, #2563eb);
        animation: ep-spin 0.8s linear infinite;
      }

      .ep-outcome__title {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: var(--ep-text, #0f172a);
      }

      .ep-outcome__title:focus {
        outline: none;
      }

      .ep-outcome__title:focus-visible {
        outline: 2px solid var(--ep-focus, #2563eb);
        outline-offset: 2px;
      }

      .ep-outcome__body {
        margin: 0;
        max-width: 28rem;
        font-size: 14px;
        line-height: 1.45;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-outcome__product {
        margin: 4px 0 0;
        font-size: 15px;
        font-weight: 650;
        color: var(--ep-text, #0f172a);
      }

      .ep-outcome__details {
        width: 100%;
        margin: 8px 0 0;
        padding: 12px 14px;
        border: 1px solid var(--ep-border, #e2e8f0);
        border-radius: var(--ep-radius-md, 10px);
        background: var(--ep-surface-muted, #f8fafc);
        text-align: left;
      }

      .ep-outcome__row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 0;
      }

      .ep-outcome__row + .ep-outcome__row {
        border-top: 1px solid var(--ep-border, #e2e8f0);
      }

      .ep-outcome__row dt {
        margin: 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-outcome__row dd {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        color: var(--ep-text, #0f172a);
        text-align: right;
        overflow-wrap: anywhere;
      }

      .ep-outcome__mono {
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.02em;
      }

      .ep-outcome__detail-message {
        margin: 0;
        max-width: 28rem;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-outcome__action {
        margin-top: 8px;
        min-height: 48px;
        min-width: 160px;
        padding: 0 20px;
        border: 0;
        border-radius: var(--ep-radius-md, 10px);
        background: var(--ep-cta-bg, #0f172a);
        color: var(--ep-cta-text, #f8fafc);
        font: inherit;
        font-size: 15px;
        font-weight: 650;
        cursor: pointer;
      }

      .ep-outcome__action:hover {
        background: var(--ep-cta-bg-hover, #1e293b);
      }

      .ep-outcome__action:focus-visible {
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--ep-focus, #2563eb) 28%, transparent);
        outline: 2px solid var(--ep-focus, #2563eb);
        outline-offset: 2px;
      }

      @keyframes ep-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes ep-outcome-in {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ep-outcome,
        .ep-outcome__spinner {
          animation: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckoutOutcomeComponent {
  private readonly i18n = inject(EasyPaymentsI18nService, { optional: true });

  readonly msgs = computed(() => this.i18n?.messages() ?? EN_TRANSLATIONS);

  readonly state = input.required<Exclude<CheckoutViewState, 'checkout'>>();
  readonly product = input<PaymentProduct | null>(null);
  readonly result = input<PaymentResult | null>(null);
  readonly paymentError = input<PaymentError | null>(null);

  readonly action = output<void>();

  private readonly heading = viewChild<ElementRef<HTMLHeadingElement>>('heading');

  constructor() {
    effect(() => {
      // Re-focus the heading whenever the outcome state changes.
      void this.state();
      queueMicrotask(() => this.heading()?.nativeElement.focus());
    });
  }

  readonly title = computed(() => {
    const copy = this.msgs();
    switch (this.state()) {
      case 'processing':
        return copy.processingTitle;
      case 'success':
        return copy.successTitle;
      case 'error':
        return copy.errorTitle;
      case 'cancelled':
        return copy.cancelledTitle;
    }
  });

  readonly body = computed(() => {
    const copy = this.msgs();
    switch (this.state()) {
      case 'processing':
        return copy.processingHint;
      case 'success':
        return copy.successBody;
      case 'error':
        return copy.errorBody;
      case 'cancelled':
        return copy.cancelledBody;
    }
  });

  readonly actionLabel = computed(() => {
    const copy = this.msgs();
    switch (this.state()) {
      case 'success':
        return copy.successContinue;
      case 'error':
        return copy.errorTryAgain;
      case 'cancelled':
        return copy.cancelledReturn;
      default:
        return '';
    }
  });

  readonly methodLabel = computed(() => {
    const method = this.result()?.method as PaymentMethod | undefined;
    if (!method) {
      return null;
    }
    if (method === 'card') {
      return this.msgs().methodCard;
    }
    return PAYMENT_METHOD_LABELS[method];
  });

  readonly transactionRef = computed(() =>
    formatTransactionReference(this.result()?.transactionId),
  );

  readonly totalLabel = computed(() => {
    const item = this.product();
    if (!item) {
      return '';
    }
    const amount = this.i18n
      ? this.i18n.formatMoney(item.amount, item.currency, item.quantity ?? 1)
      : formatMoney(item.amount, item.currency, item.quantity ?? 1, 'en');
    return `${amount} ${item.currency.trim().toUpperCase()}`;
  });

  readonly safeErrorMessage = computed(() => {
    if (this.state() !== 'error') {
      return null;
    }
    const code = this.paymentError()?.code;
    if (!code) {
      return null;
    }
    const localized = localizePaymentError(code, this.msgs());
    // Avoid repeating the same sentence as the generic error body.
    if (localized === this.msgs().errorBody) {
      return null;
    }
    return localized;
  });

  onAction(): void {
    this.action.emit();
  }
}
