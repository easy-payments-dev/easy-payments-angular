import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
} from '@angular/core';
import { PaymentMethod, ResolvedPaymentTheme } from '../../models';
import { getPaymentMethodPresentation } from '../../branding/payment-method-presentation';

@Component({
  selector: 'easy-payment-method-icon',
  standalone: true,
  template: `
    <span class="ep-mark" [attr.data-method]="method()" [attr.data-source]="presentation().source">
      @if (presentation().source === 'generic' && method() === 'us-bank-account') {
        <!-- Decorative bank building; tile aria-label carries the method name. -->
        <svg
          class="ep-mark__generic ep-mark__generic--bank"
          viewBox="0 0 32 24"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M16 2.5 29 10.5H3Z" fill="currentColor" opacity="0.55" />
          <rect x="4" y="10.5" width="24" height="9" fill="currentColor" opacity="0.12" />
          <rect x="7" y="11.5" width="2.5" height="6.5" rx="0.5" fill="currentColor" opacity="0.5" />
          <rect x="12.25" y="11.5" width="2.5" height="6.5" rx="0.5" fill="currentColor" opacity="0.5" />
          <rect x="17.25" y="11.5" width="2.5" height="6.5" rx="0.5" fill="currentColor" opacity="0.5" />
          <rect x="22.5" y="11.5" width="2.5" height="6.5" rx="0.5" fill="currentColor" opacity="0.5" />
          <rect x="2.5" y="19.5" width="27" height="2.5" rx="0.5" fill="currentColor" opacity="0.4" />
        </svg>
      } @else if (presentation().source === 'generic') {
        <svg class="ep-mark__generic" viewBox="0 0 32 24" aria-hidden="true" focusable="false">
          <rect x="1" y="3" width="30" height="18" rx="3" fill="currentColor" opacity="0.12" />
          <rect x="1" y="7" width="30" height="4" fill="currentColor" opacity="0.35" />
          <rect x="4" y="15" width="10" height="2.5" rx="1" fill="currentColor" opacity="0.55" />
          <rect x="22" y="14.5" width="6" height="3.5" rx="1" fill="currentColor" opacity="0.35" />
        </svg>
      } @else if (showMark()) {
        <img
          class="ep-mark__img"
          [src]="presentation().markUrl!"
          [alt]="''"
          decoding="async"
          loading="lazy"
          (error)="onMarkError()"
        />
      } @else {
        <span class="ep-mark__fallback" aria-hidden="true">{{ presentation().label }}</span>
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        color: inherit;
        font-family: var(--ep-font-family, inherit);
      }

      /*
        Fixed visual slot so every provider mark shares the same vertical center,
        while each brand keeps its own aspect ratio (object-fit: contain).
        Height targets follow provider guidance: scale by height, never distort.
      */
      .ep-mark {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 36px;
        max-width: 100%;
      }

      .ep-mark__generic {
        width: 34px;
        height: 26px;
        display: block;
      }

      .ep-mark__img {
        display: block;
        height: 24px;
        width: auto;
        max-width: 88px;
        object-fit: contain;
        object-position: center;
      }

      /* Apple / Google acceptance marks: Google’s SVG has more transparent padding,
         so it needs a larger box to match Apple’s on-screen visual weight. */
      .ep-mark[data-method='apple-pay'] .ep-mark__img {
        height: 28px;
        max-width: 56px;
      }

      .ep-mark[data-method='google-pay'] .ep-mark__img {
        height: 32px;
        max-width: 72px;
      }

      /* Wordmarks — keep contained; Klarna badge is visually dense. */
      .ep-mark[data-method='paypal'] .ep-mark__img {
        height: 26px;
        max-width: 90px;
      }

      .ep-mark[data-method='klarna'] .ep-mark__img {
        height: 22px;
        max-width: 68px;
      }

      .ep-mark[data-method='affirm'] .ep-mark__img {
        height: 24px;
        max-width: 84px;
      }

      .ep-mark__fallback {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 26px;
        padding: 0 2px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: -0.015em;
        line-height: 1.15;
        text-align: center;
        color: var(--ep-text, #0f172a);
        max-width: 92px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentMethodIconComponent {
  readonly method = input.required<PaymentMethod>();
  readonly theme = input<ResolvedPaymentTheme>('light');

  private readonly markFailed = signal(false);
  private lastKey = '';

  readonly presentation = computed(() =>
    getPaymentMethodPresentation(this.method(), this.theme()),
  );

  readonly showMark = computed(
    () => !!this.presentation().markUrl && !this.markFailed(),
  );

  constructor() {
    effect(() => {
      const key = `${this.method()}|${this.theme()}`;
      if (key !== this.lastKey) {
        this.lastKey = key;
        this.markFailed.set(false);
      }
    });
  }

  onMarkError(): void {
    this.markFailed.set(true);
  }
}
