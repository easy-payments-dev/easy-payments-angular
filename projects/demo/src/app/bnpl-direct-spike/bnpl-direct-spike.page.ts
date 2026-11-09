import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  loadStripe,
  type ConfirmAffirmPaymentData,
  type ConfirmKlarnaPaymentData,
  type Stripe,
} from '@stripe/stripe-js';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  BNPL_SPIKE_ENVIRONMENT,
  buildCreateBnplPaymentBody,
  describeSpikeConfig,
  formatSpikeFailure,
  resolveSpikeCreateUrl,
  type SpikeBnplProvider,
} from './bnpl-direct-spike-request';

/**
 * H6.2.4.1 — Development-only Stripe Direct confirmation spike.
 *
 * Open: `/?ep_qa=bnpl-direct`
 *
 * Isolated from `@easy-payments/angular` adapters and production checkout UX.
 * Never included in the published library package.
 *
 * SAFETY:
 * - No payment on page load.
 * - No auto-confirm after redirect return.
 * - Create + confirm run only after an explicit button click.
 * - Client secrets are never rendered or logged.
 */

type SpikeProvider = SpikeBnplProvider;

interface SpikeStatus {
  level: 'info' | 'ok' | 'warn' | 'error';
  message: string;
}

interface CreateBnplResponse {
  provider: string;
  clientSecret: string;
  paymentIntentId?: string;
}

const SPIKE_RETURN_FLAG = 'ep_spike';
const SPIKE_RETURN_VALUE = 'return';
const SPIKE_PROVIDER_PARAM = 'ep_spike_method';

@Component({
  selector: 'app-bnpl-direct-spike',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './bnpl-direct-spike.page.html',
  styleUrl: './bnpl-direct-spike.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BnplDirectSpikePage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly env = inject(BNPL_SPIKE_ENVIRONMENT, { optional: true }) ?? {
    stripePublishableKey: environment.stripePublishableKey,
    backendBaseUrl: environment.backendBaseUrl,
    klarnaCreatePaymentUrl: environment.klarnaCreatePaymentUrl,
    affirmCreatePaymentUrl: environment.affirmCreatePaymentUrl,
  };

  readonly busy = signal(false);
  readonly status = signal<SpikeStatus>({
    level: 'info',
    message: 'Idle. No payment has been started. Fill TEST fields, then click a button.',
  });
  readonly configNotes = signal<string[]>([]);
  readonly returnSummary = signal<string | null>(null);

  /** Form model — empty by default; user supplies Stripe TEST identities. */
  email = '';
  name = '';
  phone = '';
  line1 = '';
  city = '';
  state = '';
  postalCode = '';
  country = 'US';
  productId = 'premium-plan';
  currency = 'USD';
  quantity = 1;
  includeBilling = true;
  includeShipping = true;

  private stripe: Stripe | null = null;
  private inFlight = false;

  ngOnInit(): void {
    this.configNotes.set(describeSpikeConfig(this.env).notes);
    this.handleReturnIfPresent();
  }

  async onTestKlarna(): Promise<void> {
    await this.runDirect('klarna');
  }

  async onTestAffirm(): Promise<void> {
    await this.runDirect('affirm');
  }

  /**
   * After Stripe redirects back, show a non-sensitive summary and stop.
   * Does not confirm again. Does not display client secrets.
   */
  private handleReturnIfPresent(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get(SPIKE_RETURN_FLAG) !== SPIKE_RETURN_VALUE) {
      return;
    }

    const method = params.get(SPIKE_PROVIDER_PARAM) ?? 'unknown';
    const paymentIntentId = params.get('payment_intent');
    const hasClientSecret = !!params.get('payment_intent_client_secret');
    const redirectStatus = params.get('redirect_status');

    const bits = [
      `Returned from Stripe TEST redirect (${method}).`,
      paymentIntentId ? `payment_intent=${paymentIntentId}` : 'payment_intent missing',
      redirectStatus ? `redirect_status=${redirectStatus}` : 'redirect_status missing',
      hasClientSecret
        ? 'payment_intent_client_secret present (not displayed).'
        : 'payment_intent_client_secret missing.',
      'No automatic confirmation was run on return.',
    ];
    this.returnSummary.set(bits.join(' '));
    this.status.set({
      level: 'ok',
      message:
        'Redirect return detected. Review redirect_status above. Do not click Test again unless starting a new intentional attempt.',
    });
  }

  private async runDirect(provider: SpikeProvider): Promise<void> {
    if (this.inFlight || this.busy()) {
      this.status.set({
        level: 'warn',
        message: 'Ignored: a confirmation attempt is already in progress.',
      });
      return;
    }

    const { blockers } = describeSpikeConfig(this.env);
    if (blockers.length > 0) {
      this.status.set({
        level: 'error',
        message: `Config blocked: ${blockers.join(' ')}`,
      });
      return;
    }

    this.inFlight = true;
    this.busy.set(true);
    this.status.set({
      level: 'info',
      message: `Creating server-priced TEST PaymentIntent for ${provider}…`,
    });

    let clientSecret: string | null = null;

    try {
      const created = await this.createPaymentIntent(provider);
      clientSecret = created.clientSecret;
      const piHint = created.paymentIntentId
        ? `paymentIntentId=${created.paymentIntentId}`
        : 'paymentIntentId omitted by server';

      this.status.set({
        level: 'info',
        message: `PaymentIntent created (${piHint}). Calling stripe.confirm${
          provider === 'klarna' ? 'Klarna' : 'Affirm'
        }Payment…`,
      });

      const stripe = await this.ensureStripe();
      const returnUrl = this.buildReturnUrl(provider);

      const result =
        provider === 'klarna'
          ? await stripe.confirmKlarnaPayment(
              clientSecret,
              this.buildKlarnaConfirmData(returnUrl),
            )
          : await stripe.confirmAffirmPayment(
              clientSecret,
              this.buildAffirmConfirmData(returnUrl),
            );

      if (result.error) {
        const detail = [
          result.error.type ?? 'unknown',
          result.error.message ?? 'no message',
          `code=${result.error.code ?? 'n/a'}`,
        ].join(' — ');
        this.status.set({
          level: 'error',
          message: formatSpikeFailure(new Error(detail), 'stripe'),
        });
        return;
      }

      const status = result.paymentIntent?.status ?? 'unknown';
      this.status.set({
        level: 'ok',
        message: `Confirm returned without error. paymentIntent.status=${status}. If a redirect was required, the browser should navigate away.`,
      });
    } catch (err) {
      this.status.set({
        level: 'error',
        message: formatSpikeFailure(err),
      });
    } finally {
      // Drop secret from local scope intentionally; never assign to signals.
      clientSecret = null;
      this.inFlight = false;
      this.busy.set(false);
    }
  }

  private async createPaymentIntent(provider: SpikeProvider): Promise<CreateBnplResponse> {
    const path =
      provider === 'klarna'
        ? this.env.klarnaCreatePaymentUrl
        : this.env.affirmCreatePaymentUrl;
    const url = resolveSpikeCreateUrl(path, this.env.backendBaseUrl);

    const body = buildCreateBnplPaymentBody({
      provider,
      productId: this.productId,
      quantity: Number(this.quantity),
      currency: this.currency,
    });

    const response = await firstValueFrom(this.http.post<CreateBnplResponse>(url, body));

    if (
      response?.provider !== provider ||
      typeof response.clientSecret !== 'string' ||
      !response.clientSecret.trim()
    ) {
      throw new Error(`Invalid ${provider} create response (provider/clientSecret check failed).`);
    }

    return response;
  }

  private async ensureStripe(): Promise<Stripe> {
    if (this.stripe) {
      return this.stripe;
    }
    const key = this.env.stripePublishableKey.trim();
    const stripe = await loadStripe(key);
    if (!stripe) {
      throw new Error('Stripe.js failed to initialize.');
    }
    this.stripe = stripe;
    return stripe;
  }

  /**
   * Installed @stripe/stripe-js types still require billing_details.address.country
   * when payment_method is supplied for Klarna (docs/changelog say email/country are
   * optional at API level). This spike keeps a typed happy path and an intentional
   * under-specified path via cast for missing-field experiments.
   */
  private buildKlarnaConfirmData(returnUrl: string): ConfirmKlarnaPaymentData {
    const data: ConfirmKlarnaPaymentData = { return_url: returnUrl };
    this.applyShipping(data);

    if (!this.includeBilling) {
      return data;
    }

    const country = this.country.trim().toUpperCase();
    if (country) {
      data.payment_method = {
        billing_details: {
          ...(this.email.trim() ? { email: this.email.trim() } : {}),
          ...(this.name.trim() ? { name: this.name.trim() } : {}),
          ...(this.phone.trim() ? { phone: this.phone.trim() } : {}),
          address: {
            country,
            ...(this.line1.trim() ? { line1: this.line1.trim() } : {}),
            ...(this.city.trim() ? { city: this.city.trim() } : {}),
            ...(this.state.trim() ? { state: this.state.trim() } : {}),
            ...(this.postalCode.trim() ? { postal_code: this.postalCode.trim() } : {}),
          },
        },
      };
      return data;
    }

    // Missing-country experiment — docs allow omit; local typedefs disagree.
    return {
      ...data,
      payment_method: {
        billing_details: {
          ...(this.email.trim() ? { email: this.email.trim() } : {}),
          ...(this.name.trim() ? { name: this.name.trim() } : {}),
          ...(this.phone.trim() ? { phone: this.phone.trim() } : {}),
        },
      },
    } as ConfirmKlarnaPaymentData;
  }

  private buildAffirmConfirmData(returnUrl: string): ConfirmAffirmPaymentData {
    const data: ConfirmAffirmPaymentData = { return_url: returnUrl };
    this.applyShipping(data);

    if (!this.includeBilling) {
      return data;
    }

    data.payment_method = {
      billing_details: {
        ...(this.email.trim() ? { email: this.email.trim() } : {}),
        ...(this.name.trim() ? { name: this.name.trim() } : {}),
        ...(this.phone.trim() ? { phone: this.phone.trim() } : {}),
        ...(this.line1.trim() || this.city.trim() || this.country.trim()
          ? {
              address: {
                ...(this.line1.trim() ? { line1: this.line1.trim() } : {}),
                ...(this.city.trim() ? { city: this.city.trim() } : {}),
                ...(this.state.trim() ? { state: this.state.trim() } : {}),
                ...(this.postalCode.trim() ? { postal_code: this.postalCode.trim() } : {}),
                ...(this.country.trim()
                  ? { country: this.country.trim().toUpperCase() }
                  : {}),
              },
            }
          : {}),
      },
    };
    return data;
  }

  private applyShipping(data: ConfirmKlarnaPaymentData | ConfirmAffirmPaymentData): void {
    if (
      !this.includeShipping ||
      !this.name.trim() ||
      !this.line1.trim() ||
      !this.city.trim() ||
      !this.postalCode.trim() ||
      !this.country.trim()
    ) {
      return;
    }
    data.shipping = {
      name: this.name.trim(),
      address: {
        line1: this.line1.trim(),
        city: this.city.trim(),
        ...(this.state.trim() ? { state: this.state.trim() } : {}),
        postal_code: this.postalCode.trim(),
        country: this.country.trim().toUpperCase(),
      },
    };
  }

  private buildReturnUrl(provider: SpikeProvider): string {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('ep_qa', 'bnpl-direct');
    url.searchParams.set(SPIKE_RETURN_FLAG, SPIKE_RETURN_VALUE);
    url.searchParams.set(SPIKE_PROVIDER_PARAM, provider);
    return url.toString();
  }

}
