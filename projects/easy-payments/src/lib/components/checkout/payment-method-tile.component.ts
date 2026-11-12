import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { PaymentMethod, PAYMENT_METHOD_LABELS, ResolvedPaymentTheme } from '../../models';
import { getPaymentMethodPresentation } from '../../branding/payment-method-presentation';
import { EasyPaymentsI18nService, EN_TRANSLATIONS } from '../../i18n';
import { PaymentMethodIconComponent } from './payment-method-icon.component';

@Component({
  selector: 'easy-payment-method-tile',
  standalone: true,
  imports: [PaymentMethodIconComponent],
  template: `
    <button
      type="button"
      class="ep-tile"
      role="radio"
      [class.ep-tile--selected]="selected()"
      [class.ep-tile--mock]="isMock()"
      [class.ep-tile--fallback]="presentation().source === 'text-fallback'"
      [attr.aria-checked]="selected()"
      [attr.aria-label]="ariaLabel()"
      [disabled]="disabled()"
      (click)="select.emit()"
      (keydown.enter)="select.emit()"
      (keydown.space)="$event.preventDefault(); select.emit()"
    >
      @if (isMock()) {
        <span class="ep-tile__demo" aria-hidden="true">{{ msgs().demoBadge }}</span>
      }
      @if (selected()) {
        <span class="ep-tile__check" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
            <path
              d="M3.5 8.2 6.4 11l6.1-6.5"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      }
      <span class="ep-tile__icon">
        <easy-payment-method-icon [method]="method()" [theme]="theme()" />
      </span>
      @if (showVisibleLabel()) {
        <span class="ep-tile__label">{{ visibleLabel() }}</span>
      } @else {
        <!-- Reserve label row so mark-only tiles align with Card (icon + label). -->
        <span class="ep-tile__label ep-tile__label--spacer" aria-hidden="true"></span>
      }
    </button>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        font-family: var(--ep-font-family, inherit);
      }

      .ep-tile {
        box-sizing: border-box;
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        width: 100%;
        height: 88px;
        min-height: 88px;
        padding: 18px 8px 12px;
        border: 1px solid var(--ep-border, #e2e8f0);
        border-radius: var(--ep-radius-md, 10px);
        background: var(--ep-surface, #fff);
        color: var(--ep-text, #0f172a);
        box-shadow: var(--ep-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.04));
        cursor: pointer;
        transition:
          border-color 0.15s ease,
          background-color 0.15s ease,
          box-shadow 0.15s ease;
      }

      .ep-tile:hover:not(:disabled) {
        border-color: var(--ep-border-strong, #cbd5e1);
        background: var(--ep-surface-hover, #f8fafc);
      }

      .ep-tile:focus-visible {
        outline: 2px solid var(--ep-focus, #2563eb);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--ep-focus, #2563eb) 28%, transparent);
      }

      .ep-tile--selected {
        border-color: var(--ep-accent, #2563eb);
        background: var(--ep-accent-soft, #eff6ff);
        /* Keep 1px border; inset ring avoids layout shift vs unselected tiles. */
        box-shadow:
          var(--ep-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.04)),
          inset 0 0 0 1px var(--ep-accent, #2563eb);
      }

      .ep-tile:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .ep-tile__demo {
        position: absolute;
        top: 6px;
        left: 6px;
        z-index: 1;
        padding: 1px 5px;
        border-radius: 999px;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        line-height: 1.2;
        background: var(--ep-demo-bg, #f1f5f9);
        color: var(--ep-demo-text, #64748b);
        pointer-events: none;
      }

      .ep-tile__check {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 999px;
        background: var(--ep-accent, #2563eb);
        color: #fff;
        pointer-events: none;
      }

      .ep-tile__icon {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 36px;
        height: 36px;
        width: 100%;
        max-width: 100%;
        color: var(--ep-text, #0f172a);
      }

      .ep-tile__label {
        font-size: 12px;
        font-weight: 600;
        line-height: 1.2;
        text-align: center;
        color: var(--ep-text-secondary, #64748b);
        min-height: 1.2em;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ep-tile__label--spacer {
        visibility: hidden;
      }

      .ep-tile--selected .ep-tile__label {
        color: var(--ep-text, #0f172a);
      }

      @media (prefers-reduced-motion: reduce) {
        .ep-tile {
          transition: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentMethodTileComponent {
  private readonly i18n = inject(EasyPaymentsI18nService, { optional: true });

  readonly msgs = computed(() => this.i18n?.messages() ?? EN_TRANSLATIONS);

  readonly method = input.required<PaymentMethod>();
  readonly theme = input<ResolvedPaymentTheme>('light');
  readonly selected = input(false);
  readonly isMock = input(false);
  readonly disabled = input(false);

  readonly select = output<void>();

  readonly presentation = computed(() =>
    getPaymentMethodPresentation(this.method(), this.theme()),
  );

  /**
   * Show a visible label when the mark does not already include the brand name,
   * or when we are on a text fallback (label IS the mark).
   * For text-fallback, the icon component already renders the name — avoid duplicate.
   */
  readonly showVisibleLabel = computed(() => {
    const p = this.presentation();
    if (p.source === 'text-fallback') {
      return false;
    }
    return !p.markIncludesName;
  });

  /** Localized label for generic methods; brand marks keep presentation.label. */
  readonly visibleLabel = computed(() => {
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
    return this.presentation().label;
  });

  ariaLabel(): string {
    const method = this.method();
    const base =
      method === 'card'
        ? this.msgs().methodCard
        : method === 'us-bank-account'
          ? this.msgs().methodUsBankAccount
          : method === 'cash-app-pay'
            ? this.msgs().methodCashAppPay
            : PAYMENT_METHOD_LABELS[method];
    const demo = this.isMock() ? `, ${this.msgs().demoModeAria}` : '';
    const state = this.selected() ? ', selected' : '';
    return `${base}${demo}${state}`;
  }
}
