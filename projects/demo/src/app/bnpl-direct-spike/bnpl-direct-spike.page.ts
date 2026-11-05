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

type SpikeProvider = 'klarna' | 'affirm';

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
    this.configNotes.set(this.validateLocalConfig());
    this.handleReturnIfPresent();
  }

  async onTestKlarna(): Promise<void> {
    await this.runDirect('klarna');
  }

  async onTestAffirm(): Promise<void> {
    await this.runDirect('affirm');
  }

  private validateLocalConfig(): string[] {
    const notes: string[] = [];
    const pk = environment.stripePublishableKey?.trim() ?? '';
    if (!pk) {
      notes.push('Missing stripePublishableKey in demo environment.');
    } else if (!/^pk_test_/i.test(pk)) {
      notes.push('stripePublishableKey must be a Stripe TEST publishable key (pk_test_...).');
    } else {
      notes.push('Stripe TEST publishable key present (value not shown).');
    }

    const base = environment.backendBaseUrl?.trim() ?? '';
    if (!base) {
      notes.push('backendBaseUrl is empty — relative create URLs may fail.');
    } else {
      notes.push(`Backend base: ${base}`);
    }

    if (!environment.klarnaCreatePaymentUrl?.trim()) {
      notes.push('klarnaCreatePaymentUrl is missing.');
    }
    if (!environment.affirmCreatePaymentUrl?.trim()) {
      notes.push('affirmCreatePaymentUrl is missing.');
    }

    notes.push('Catalog product default: premium-plan / USD / qty 1 (server-priced).');
    notes.push('This page never mounts Stripe Payment Element.');
    return notes;
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

    const configErrors = this.validateLocalConfig().filter(
      (n) =>
        n.includes('Missing') ||
        n.includes('must be') ||
        n.includes('empty') ||
        n.includes('missing'),
    );
    if (configErrors.length > 0) {
      this.status.set({
        level: 'error',
        message: `Config blocked: ${configErrors.join(' ')}`,
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
        this.status.set({
          level: 'error',
          message: `Stripe confirm error: ${result.error.type ?? 'unknown'} — ${
            result.error.message ?? 'no message'
          } (code=${result.error.code ?? 'n/a'})`,
        });
        return;
      }

      const status = result.paymentIntent?.status ?? 'unknown';
      this.status.set({
        level: 'ok',
        message: `Confirm returned without error. paymentIntent.status=${status}. If a redirect was required, the browser should navigate away.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.status.set({
        level: 'error',
        message: `Spike failed: ${message}`,
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
        ? environment.klarnaCreatePaymentUrl
        : environment.affirmCreatePaymentUrl;
    const url = this.resolveUrl(path);

    const body = {
      provider,
      productId: this.productId.trim() || 'premium-plan',
      quantity: Number(this.quantity) || 1,
      currency: (this.currency || 'USD').trim().toUpperCase(),
      metadata: {
        source: 'ep-bnpl-direct-spike',
        spike: 'H6.2.4.1',
      },
    };

    const response = await firstValueFrom(this.http.post<CreateBnplResponse>(url, body));

    if (
      response?.provider !== provider ||
      typeof response.clientSecret !== 'string' ||
      !response.clientSecret.trim()
    ) {
      throw new Error(`Invalid ${provider} create response (provider/clientSecret).`);
    }

    return response;
  }

  private async ensureStripe(): Promise<Stripe> {
    if (this.stripe) {
      return this.stripe;
    }
    const key = environment.stripePublishableKey.trim();
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

  private resolveUrl(path: string): string {
    const trimmed = path.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    const base = (environment.backendBaseUrl ?? '').replace(/\/$/, '');
    const suffix = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `${base}${suffix}`;
  }
}
