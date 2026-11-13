import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import {
  PaymentMethod,
  PAYMENT_METHOD_LABELS,
  PaymentProduct,
  ResolvedPaymentTheme,
} from '../../models';
import { formatMoney } from '../../utils/format-money';
import { EasyPaymentsI18nService, EN_TRANSLATIONS, interpolate } from '../../i18n';
import { PaymentMethodIconComponent } from './payment-method-icon.component';

/**
 * Mock / demo payment chrome.
 *
 * - `panel` — full checkout-style detail (title, hint, amount CTA). Default for `<easy-payments>`.
 * - `strip` — single compact wallet stand-in for Buttons Only (no amount, no description).
 * - `expand` — Buttons Only shared panel: confirm CTA without repeating merchant amount/copy.
 */
export type MockMethodPanelPresentation = 'panel' | 'strip' | 'expand';

/**
 * Detail panel for mock / non-Stripe payment methods after selection,
 * or a compact strip stand-in for wallet methods in Buttons Only mock mode.
 */
@Component({
  selector: 'easy-mock-method-panel',
  standalone: true,
  imports: [PaymentMethodIconComponent],
  template: `
    @if (presentation() === 'strip') {
      <button
        type="button"
        class="ep-mock-panel__strip"
        [disabled]="loading()"
        [attr.aria-busy]="loading()"
        [attr.aria-label]="stripAriaLabel()"
        data-testid="easy-mock-strip-button"
        (click)="pay.emit()"
      >
        <span class="ep-mock-panel__strip-icon" aria-hidden="true">
          <easy-payment-method-icon [method]="method()" [theme]="theme()" />
        </span>
        @if (loading()) {
          <span class="ep-mock-panel__spinner" aria-hidden="true"></span>
        }
      </button>
    } @else if (presentation() === 'expand') {
      <div class="ep-mock-panel ep-mock-panel--expand">
        <button
          type="button"
          class="ep-mock-panel__cta"
          [disabled]="loading()"
          [attr.aria-busy]="loading()"
          [attr.aria-label]="expandAriaLabel()"
          (click)="pay.emit()"
        >
          @if (loading()) {
            <span class="ep-mock-panel__spinner" aria-hidden="true"></span>
            {{ msgs().processingPayment }}
          } @else {
            {{ expandLabel() }}
          }
        </button>
      </div>
    } @else {
      <div class="ep-mock-panel">
        <div class="ep-mock-panel__header">
          <easy-payment-method-icon [method]="method()" [theme]="theme()" />
          <div>
            <h3 class="ep-mock-panel__title">{{ title() }}</h3>
            @if (isMock()) {
              <p class="ep-mock-panel__hint">{{ msgs().demoCheckoutHint }}</p>
            } @else {
              <p class="ep-mock-panel__hint">{{ msgs().continuePaymentHint }}</p>
            }
          </div>
        </div>

        <button
          type="button"
          class="ep-mock-panel__cta"
          [disabled]="loading()"
          [attr.aria-busy]="loading()"
          [attr.aria-label]="ctaAriaLabel()"
          (click)="pay.emit()"
        >
          @if (loading()) {
            <span class="ep-mock-panel__spinner" aria-hidden="true"></span>
            {{ msgs().processingPayment }}
          } @else {
            {{ payLabel() }}
          }
        </button>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        /* Fill the Buttons Only slot — parent __mock is flex; without this the
           host shrink-wraps to the logo and strip width:100% collapses. */
        width: 100%;
        box-sizing: border-box;
        font-family: var(--ep-font-family, inherit);
      }

      .ep-mock-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .ep-mock-panel--expand {
        gap: 10px;
      }

      .ep-mock-panel__header {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .ep-mock-panel__title {
        margin: 0;
        font-size: 1rem;
        font-weight: 650;
        color: var(--ep-text, #0f172a);
      }

      .ep-mock-panel__hint {
        margin: 4px 0 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-mock-panel--expand .ep-mock-panel__hint {
        margin: 0;
      }

      .ep-mock-panel__cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 48px;
        width: 100%;
        border: 0;
        border-radius: var(--ep-radius-md, 10px);
        background: var(--ep-cta-bg, #0f172a);
        color: var(--ep-cta-text, #f8fafc);
        font: inherit;
        font-size: 15px;
        font-weight: 650;
        cursor: pointer;
      }

      .ep-mock-panel__cta:hover:not(:disabled) {
        background: var(--ep-cta-bg-hover, #1e293b);
      }

      .ep-mock-panel__cta:focus-visible {
        outline: 2px solid var(--ep-focus, #2563eb);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--ep-focus, #2563eb) 28%, transparent);
      }

      .ep-mock-panel__cta:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .ep-mock-panel__strip {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        /* Match selector chrome: fill the slot (not logo intrinsic width). */
        width: var(--ep-buttons-width, 100%);
        max-width: 100%;
        min-width: var(--ep-buttons-min-width, 100px);
        height: var(--ep-buttons-height, 40px);
        min-height: var(--ep-buttons-height, 40px);
        padding: 0 12px;
        border: var(--ep-buttons-border-width, 1px) solid
          var(--ep-buttons-border-color, var(--ep-border, #e2e8f0));
        border-radius: var(--ep-buttons-radius, var(--ep-radius-md, 10px));
        background: var(--ep-surface, #fff);
        color: var(--ep-text, #0f172a);
        font: inherit;
        cursor: pointer;
        transition:
          border-color 0.15s ease,
          background-color 0.15s ease,
          box-shadow 0.15s ease;
      }

      .ep-mock-panel__strip:hover:not(:disabled) {
        border-color: var(--ep-border-strong, #cbd5e1);
      }

      .ep-mock-panel__strip:focus-visible {
        outline: 2px solid var(--ep-focus, #2563eb);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--ep-focus, #2563eb) 28%, transparent);
      }

      .ep-mock-panel__strip:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      .ep-mock-panel__strip-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 1 1 auto;
        width: 100%;
        max-width: 100%;
        /* Leave room for 40px strip height + 1px borders; do not crush brand marks. */
        max-height: calc(var(--ep-buttons-height, 40px) - 8px);
        min-height: 0;
      }

      .ep-mock-panel__strip-icon ::ng-deep .ep-mark {
        height: 100%;
        max-height: calc(var(--ep-buttons-height, 40px) - 8px);
      }

      .ep-mock-panel__strip-icon ::ng-deep img,
      .ep-mock-panel__strip-icon ::ng-deep svg {
        /* Defer to payment-method-icon height tokens; only clamp to the strip. */
        max-height: calc(var(--ep-buttons-height, 40px) - 8px);
        width: auto;
      }

      .ep-mock-panel__spinner {
        width: 16px;
        height: 16px;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        animation: ep-spin 0.6s linear infinite;
      }

      @keyframes ep-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ep-mock-panel__spinner {
          animation: none;
          border-right-color: currentColor;
          opacity: 0.7;
        }

        .ep-mock-panel__strip {
          transition: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MockMethodPanelComponent {
  private readonly i18n = inject(EasyPaymentsI18nService, { optional: true });

  readonly msgs = computed(() => this.i18n?.messages() ?? EN_TRANSLATIONS);

  readonly method = input.required<PaymentMethod>();
  readonly product = input.required<PaymentProduct>();
  readonly theme = input<ResolvedPaymentTheme>('light');
  readonly isMock = input(false);
  readonly loading = input(false);
  /** Visual density. Default `panel` preserves full-checkout mock chrome. */
  readonly presentation = input<MockMethodPanelPresentation>('panel');

  readonly pay = output<void>();

  readonly label = computed(() => {
    const method = this.method();
    if (method === 'card') {
      return this.msgs().methodCard;
    }
    if (method === 'us-bank-account') {
      return this.msgs().methodUsBankAccount;
    }
    if (method === 'cash-app-pay') {
      return this.msgs().methodCashAppPay;
    }
    if (method === 'afterpay') {
      return this.msgs().methodAfterpay;
    }
    if (method === 'venmo') {
      return this.msgs().methodVenmo;
    }
    return PAYMENT_METHOD_LABELS[method];
  });
  readonly amountLabel = computed(() =>
    this.i18n
      ? this.i18n.formatMoney(
          this.product().amount,
          this.product().currency,
          this.product().quantity ?? 1,
        )
      : formatMoney(
          this.product().amount,
          this.product().currency,
          this.product().quantity ?? 1,
          'en',
        ),
  );
  readonly title = computed(() =>
    interpolate(this.msgs().payWithMethod, { method: this.label() }),
  );
  readonly payLabel = computed(() =>
    interpolate(this.msgs().payAmount, { amount: this.amountLabel() }),
  );

  ctaAriaLabel(): string {
    return interpolate(this.msgs().payAmountWithMethodAria, {
      amount: this.amountLabel(),
      method: this.label(),
    });
  }

  readonly expandLabel = computed(() =>
    this.isMock() ? this.msgs().completeDemoPayment : this.msgs().confirmPayment,
  );

  expandAriaLabel(): string {
    return interpolate(
      this.isMock()
        ? this.msgs().completeDemoPaymentWithMethodAria
        : this.msgs().confirmPaymentWithMethodAria,
      { method: this.label() },
    );
  }

  stripAriaLabel(): string {
    if (this.isMock()) {
      return interpolate(this.msgs().demoWalletButtonAria, { method: this.label() });
    }
    return interpolate(this.msgs().payWithMethod, { method: this.label() });
  }
}
