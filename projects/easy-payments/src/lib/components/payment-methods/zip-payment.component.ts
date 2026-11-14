import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  CheckoutOptions,
  PaymentProduct,
  PaymentResult,
  ResolvedPaymentTheme,
} from '../../models';
import { PaymentError, normalizeError } from '../../errors/payment-error';
import { validatePaymentProduct } from '../../validators/product.validator';
import { ZipAdapter } from '../../adapters/zip/zip.adapter';
import type { ZipUiState } from '../../adapters/zip/zip.types';
import {
  isZipReturnAttempt,
  readZipPendingReturn,
} from '../../adapters/zip/zip-return';
import { getPaymentMethodPresentation } from '../../branding/payment-method-presentation';
import { warnProviderDiagnostic } from '../../diagnostics/provider-diagnostics';
import {
  EasyPaymentsI18nService,
  EN_TRANSLATIONS,
  localizePaymentError,
} from '../../i18n';
import { CheckoutSecurityMessageComponent } from '../checkout/checkout-security-message.component';
import { PaymentMethodButtonComponent } from './payment-method-button.component';

/**
 * Zip US checkout panel for Full Checkout and Buttons Only (chrome=minimal).
 * Prefetches a signed authorize body, then calls openCheckout synchronously on click.
 */
@Component({
  selector: 'easy-zip-payment',
  standalone: true,
  imports: [CheckoutSecurityMessageComponent, PaymentMethodButtonComponent],
  template: `
    <div
      class="ep-zip"
      [class.ep-zip--minimal]="chrome() === 'minimal'"
      [attr.data-state]="uiState()"
      [attr.data-chrome]="chrome()"
    >
      @if (chrome() === 'full') {
        <div class="ep-zip__header">
          <h3 class="ep-zip__title">{{ msgs().payWithZip }}</h3>
          <easy-checkout-security-message [message]="msgs().secureCheckoutZip" />
        </div>
      } @else {
        <easy-checkout-security-message [message]="msgs().secureCheckoutZip" />
      }

      @if (uiState() === 'preparing') {
        <p class="ep-zip__status" role="status">{{ msgs().preparingZip }}</p>
      }

      @if (inlineError()) {
        <p class="ep-zip__error" role="alert">{{ inlineError() }}</p>
      }

      @if (uiState() === 'success' && chrome() !== 'minimal') {
        <p class="ep-zip__success" role="status">{{ msgs().paymentCompleted }}</p>
      }

      @if (uiState() !== 'success' || chrome() !== 'minimal') {
        <easy-payment-method-button
          method="zip"
          [disabled]="!canPay()"
          [loading]="uiState() === 'open' || uiState() === 'verifying'"
          customLabel="Zip"
          (clicked)="onPay()"
        >
          @if (markUrl()) {
            <img class="ep-zip__mark" [src]="markUrl()!" alt="" aria-hidden="true" />
          }
          <span>{{ msgs().payWithZip }}</span>
        </easy-payment-method-button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        font-family: var(--ep-font-family, inherit);
      }

      .ep-zip {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .ep-zip__header {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ep-zip__title {
        margin: 0;
        font-size: 1rem;
        font-weight: 650;
        color: var(--ep-text, #0f172a);
      }

      .ep-zip__status {
        margin: 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-zip__error {
        margin: 0;
        color: var(--ep-danger, #b91c1c);
        font-size: 13px;
      }

      .ep-zip__success {
        margin: 0;
        color: var(--ep-success, #15803d);
        font-size: 13px;
        font-weight: 600;
      }

      .ep-zip__mark {
        height: 18px;
        width: auto;
        display: block;
      }

      easy-payment-method-button ::ng-deep .ep-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        background: #fff;
        color: #0a0b09;
        border: 1px solid color-mix(in srgb, #0a0b09 16%, transparent);
        border-radius: var(--ep-buttons-radius, var(--ep-radius-md, 10px));
        min-height: var(--ep-buttons-height, 48px);
      }

      .ep-zip--minimal easy-payment-method-button ::ng-deep .ep-button {
        min-height: var(--ep-buttons-height, 44px);
        align-self: flex-start;
        min-width: min(100%, 220px);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZipPaymentComponent implements OnDestroy {
  private readonly zipAdapter = inject(ZipAdapter);
  private readonly i18n = inject(EasyPaymentsI18nService, { optional: true });

  readonly msgs = computed(() => this.i18n?.messages() ?? EN_TRANSLATIONS);

  readonly product = input.required<PaymentProduct>();
  readonly checkout = input<CheckoutOptions>();
  readonly resolvedTheme = input.required<ResolvedPaymentTheme>();
  readonly chrome = input<'full' | 'minimal'>('full');

  readonly success = output<PaymentResult>();
  readonly cancel = output<PaymentResult>();
  readonly error = output<PaymentError>();
  readonly started = output<void>();
  readonly busyChange = output<boolean>();

  readonly uiState = signal<ZipUiState>('idle');
  readonly inlineError = signal<string | null>(null);
  /** Setup failures (missing Zip merchant config) — disable further Pay clicks. */
  private readonly setupBlocked = signal(false);

  readonly markUrl = computed(
    () => getPaymentMethodPresentation('zip', this.resolvedTheme()).markUrl,
  );

  readonly canPay = computed(() => {
    if (this.setupBlocked()) {
      return false;
    }
    const state = this.uiState();
    return state === 'ready' || state === 'cancelled' || state === 'error';
  });

  private prepareGeneration = 0;
  private startedEmitted = false;
  private destroyed = false;

  constructor() {
    this.zipAdapter.setOutcomeHandlers({
      onComplete: (result) => this.onAdapterSuccess(result),
      onCancel: (result) => this.onAdapterCancel(result),
      onError: (err) => this.onAdapterError(err),
    });

    effect(() => {
      const product = this.product();
      untracked(() => void this.prepare(product));
    });

    effect(() => {
      const busy =
        this.uiState() === 'open' ||
        this.uiState() === 'verifying' ||
        this.uiState() === 'preparing';
      this.busyChange.emit(busy);
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.zipAdapter.setOutcomeHandlers({});
  }

  onPay(): void {
    if (!this.canPay()) {
      return;
    }
    this.inlineError.set(null);
    if (!this.startedEmitted) {
      this.startedEmitted = true;
      this.started.emit();
    }
    try {
      // Enter loading before sync openCheckout so the click stack stays intact.
      this.uiState.set('open');
      this.zipAdapter.startCheckout();
    } catch (err) {
      this.onAdapterError(normalizeError(err, { method: 'zip', provider: 'zip' }));
    }
  }

  private async prepare(product: PaymentProduct): Promise<void> {
    const generation = ++this.prepareGeneration;
    this.inlineError.set(null);
    this.setupBlocked.set(false);
    this.startedEmitted = false;

    try {
      validatePaymentProduct(product);
    } catch (err) {
      this.uiState.set('error');
      this.setInlineFromError(normalizeError(err, { method: 'zip', provider: 'zip' }));
      return;
    }

    // Redirect recovery before preparing a new session.
    if (isZipReturnAttempt() || readZipPendingReturn()) {
      this.uiState.set('verifying');
      try {
        const recovered = await this.zipAdapter.recoverReturn();
        if (this.destroyed || generation !== this.prepareGeneration) {
          return;
        }
        if (recovered?.status === 'success') {
          this.uiState.set('success');
          this.success.emit(recovered);
          return;
        }
        if (recovered?.status === 'cancelled') {
          this.uiState.set('cancelled');
          this.cancel.emit(recovered);
          // Fall through to prepare a fresh attempt so Pay is usable again.
        } else {
          // No recoverable return — continue to prepare.
        }
      } catch (err) {
        if (this.destroyed || generation !== this.prepareGeneration) {
          return;
        }
        this.onAdapterError(normalizeError(err, { method: 'zip', provider: 'zip' }));
        return;
      }
    }

    this.uiState.set('preparing');
    try {
      await this.zipAdapter.prepareCheckout(product);
      if (this.destroyed || generation !== this.prepareGeneration) {
        return;
      }
      this.uiState.set('ready');
    } catch (err) {
      if (this.destroyed || generation !== this.prepareGeneration) {
        return;
      }
      this.uiState.set('error');
      const mapped = normalizeError(err, { method: 'zip', provider: 'zip' });
      this.setInlineFromError(mapped);
      this.error.emit(mapped);
    }
  }

  private onAdapterSuccess(result: PaymentResult): void {
    if (this.destroyed) {
      return;
    }
    this.uiState.set('success');
    this.inlineError.set(null);
    this.success.emit(result);
  }

  private onAdapterCancel(result: PaymentResult): void {
    if (this.destroyed) {
      return;
    }
    // Clear spinner immediately on confirmed cancellation.
    this.uiState.set('cancelled');
    this.inlineError.set(null);
    this.cancel.emit(result);
    // Fresh merchantReference for the next click (avoids duplicate-callback hang).
    void this.prepare(this.product());
  }

  private onAdapterError(err: PaymentError): void {
    if (this.destroyed) {
      return;
    }
    // Clear spinner immediately on failure.
    this.uiState.set('error');
    this.setInlineFromError(err);
    this.error.emit(err);
    // Re-prepare when possible so a later click is not stuck on a dead attempt.
    if (
      err.code === 'CONFIG_MISSING' ||
      err.code === 'CONFIG_INVALID' ||
      err.code === 'SDK_LOAD_FAILED'
    ) {
      return;
    }
    void this.prepare(this.product());
  }

  /**
   * Buyers see localized Zip-unavailable copy for setup failures.
   * Technical detail stays on PaymentError.message and developer diagnostics.
   */
  private setInlineFromError(err: PaymentError): void {
    const setupFailure = err.code === 'CONFIG_MISSING' || err.code === 'CONFIG_INVALID';
    if (setupFailure) {
      this.setupBlocked.set(true);
      warnProviderDiagnostic('zip', err.code, err.message);
      this.inlineError.set(this.msgs().zipUnavailable);
      return;
    }
    this.inlineError.set(localizePaymentError(err.code, this.msgs()));
  }
}
