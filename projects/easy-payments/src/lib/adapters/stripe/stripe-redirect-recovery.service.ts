import { inject, Injectable, isDevMode } from '@angular/core';
import type { Stripe } from '@stripe/stripe-js';
import { PaymentMethod, PaymentResult, normalizePaymentResult } from '../../models';
import { PaymentError } from '../../errors/payment-error';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import { BrowserGuard } from '../../utils/browser-guard';
import { mapStripeError } from './stripe-error.mapper';
import { StripeSdkLoader } from './stripe-sdk.loader';
import {
  clearStripePendingReturn,
  clearStripeReturnParamsFromUrl,
  detectStripeReturnMethod,
  isStripePendingReturnExpired,
  isStripeReturnAttempt,
  readStripePendingReturn,
  readStripeReturnParams,
  STRIPE_PROCESSING_DELAY_MS,
  STRIPE_PROCESSING_MAX_ATTEMPTS,
  STRIPE_RETRIEVE_RETRY_ATTEMPTS,
  STRIPE_RETRIEVE_RETRY_DELAY_MS,
  type StripePendingReturn,
  type StripeRedirectMethod,
  type StripeReturnHostKind,
  type StripeReturnOrigin,
  type StripeReturnParams,
} from './stripe-redirect-return';

/** A checkout host (`<easy-payments>` / `<easy-payment-buttons>`) that can own a redirect return. */
export interface StripeReturnHost {
  readonly kind: StripeReturnHostKind;
  productId(): string | null;
  /** Stable id for this host (merchant `[checkoutInstanceId]` or auto-generated). */
  instanceId(): string;
}

export type StripeReturnClaim = 'owner' | 'not-owner';

export type StripeReturnUnattributedReason =
  | 'STALE_ATTEMPT'
  | 'AMBIGUOUS_HOSTS'
  | 'MISSING_METHOD';

export type StripeReturnDecision<T> =
  | { kind: 'owner'; owner: T }
  | { kind: 'wait' }
  | { kind: 'unattributed'; reason: StripeReturnUnattributedReason };

export interface StripeReturnCandidate<T> {
  host: T;
  kind: StripeReturnHostKind;
  productId: string | null;
  instanceId: string;
  /** Legacy render-order index; used only when the marker has no checkoutInstanceId. */
  ordinal: number;
  methods: readonly PaymentMethod[];
}

/**
 * Pure ownership rule for a Stripe redirect return. Never guesses.
 *
 * Preference order when `ep_attempt` matches a live (non-expired) pending marker:
 * 1. Headless markers — only `hostKind: 'headless'` candidates with matching instance/attempt
 * 2. `checkoutInstanceId` + host kind (stable across reorder / remount)
 * 3. Legacy kind + productId + hostOrdinal (markers from before stable ids)
 * 4. Single eligible non-headless host — only for true legacy returns with no `ep_attempt`
 * 5. Otherwise wait (owner not mounted) or AMBIGUOUS_HOSTS / STALE_ATTEMPT
 *
 * Headless returns and any URL with `ep_attempt` never fall through to the
 * single-host legacy shortcut (prevents Full Checkout / Buttons claiming Headless).
 */
export function decideStripeReturnOwner<T>(
  candidates: readonly StripeReturnCandidate<T>[],
  params: StripeReturnParams,
  marker: StripePendingReturn | null,
  now: number = Date.now(),
): StripeReturnDecision<T> {
  const method = params.method ?? marker?.method ?? null;
  if (!method) {
    return { kind: 'unattributed', reason: 'MISSING_METHOD' };
  }

  const markerExpired = !!marker && isStripePendingReturnExpired(marker, now);
  const liveMarker = marker && !markerExpired ? marker : null;

  // Headless-shaped markers never grant checkout/buttons ownership — including when expired.
  if (marker?.hostKind === 'headless') {
    if (!liveMarker) {
      return { kind: 'unattributed', reason: 'STALE_ATTEMPT' };
    }
    return decideHeadlessReturnOwner(candidates, params, liveMarker, method);
  }

  // Checkout / Buttons path — never select a Headless candidate.
  const eligible = candidates.filter(
    (c) => c.methods.includes(method) && c.kind !== 'headless',
  );

  if (params.attemptId && liveMarker?.attemptId && params.attemptId !== liveMarker.attemptId) {
    return { kind: 'unattributed', reason: 'STALE_ATTEMPT' };
  }

  // Attempt token without a matching live marker: could be Headless or stale — fail closed.
  if (params.attemptId && (!liveMarker || !liveMarker.attemptId)) {
    return { kind: 'unattributed', reason: 'STALE_ATTEMPT' };
  }

  if (params.method && liveMarker?.method && params.method !== liveMarker.method) {
    return { kind: 'unattributed', reason: 'STALE_ATTEMPT' };
  }

  const attemptMatches =
    !!params.attemptId && !!liveMarker?.attemptId && params.attemptId === liveMarker.attemptId;

  if (attemptMatches && liveMarker.checkoutInstanceId) {
    const match = eligible.find(
      (c) =>
        c.instanceId === liveMarker.checkoutInstanceId &&
        (!liveMarker.hostKind || c.kind === liveMarker.hostKind),
    );
    return match ? { kind: 'owner', owner: match.host } : { kind: 'wait' };
  }

  if (
    attemptMatches &&
    liveMarker.hostKind &&
    typeof liveMarker.hostOrdinal === 'number' &&
    !liveMarker.checkoutInstanceId
  ) {
    const match = eligible.find(
      (c) =>
        c.kind === liveMarker.hostKind &&
        c.productId === liveMarker.productId &&
        c.ordinal === liveMarker.hostOrdinal,
    );
    return match ? { kind: 'owner', owner: match.host } : { kind: 'wait' };
  }

  // Incomplete marker with ep_attempt (matched attempt but no stable/ordinal path) — fail closed.
  if (params.attemptId) {
    return { kind: 'unattributed', reason: 'AMBIGUOUS_HOSTS' };
  }

  // True legacy (no ep_attempt): single eligible non-headless host only.
  const pool = liveMarker ? eligible.filter((c) => c.productId === liveMarker.productId) : eligible;
  if (pool.length === 1) {
    return { kind: 'owner', owner: pool[0].host };
  }
  if (pool.length === 0) {
    return { kind: 'wait' };
  }
  return { kind: 'unattributed', reason: 'AMBIGUOUS_HOSTS' };
}

function decideHeadlessReturnOwner<T>(
  candidates: readonly StripeReturnCandidate<T>[],
  params: StripeReturnParams,
  marker: StripePendingReturn,
  method: StripeRedirectMethod,
): StripeReturnDecision<T> {
  if (!marker.attemptId || !marker.checkoutInstanceId || marker.hostKind !== 'headless') {
    return { kind: 'unattributed', reason: 'AMBIGUOUS_HOSTS' };
  }

  if (params.method && params.method !== marker.method) {
    return { kind: 'unattributed', reason: 'STALE_ATTEMPT' };
  }

  if (!params.attemptId || params.attemptId !== marker.attemptId) {
    return { kind: 'unattributed', reason: 'STALE_ATTEMPT' };
  }

  if (method !== marker.method) {
    return { kind: 'unattributed', reason: 'STALE_ATTEMPT' };
  }

  const eligible = candidates.filter(
    (c) =>
      c.kind === 'headless' &&
      c.methods.includes(method) &&
      c.instanceId === marker.checkoutInstanceId &&
      (!marker.productId || c.productId === marker.productId),
  );

  if (eligible.length === 1) {
    return { kind: 'owner', owner: eligible[0].host };
  }
  if (eligible.length === 0) {
    // Matching Headless host not registered yet (or wrong instance among claimants).
    // Always wait — never let Checkout/Buttons close a Headless return.
    return { kind: 'wait' };
  }
  return { kind: 'unattributed', reason: 'AMBIGUOUS_HOSTS' };
}

interface PendingClaim {
  host: StripeReturnHost;
  methods: readonly PaymentMethod[];
  resolve: (claim: StripeReturnClaim) => void;
}

function looksLikeSecretKey(value: string): boolean {
  return /^sk_(test|live)_/i.test(value.trim());
}

function looksLikePublishableKey(value: string): boolean {
  return /^pk_(test|live)_/i.test(value.trim());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared Stripe redirect recovery for Klarna / Affirm (and future BNPL methods).
 * Single source of truth so Easy Payments does not duplicate retrieve flows.
 */
@Injectable({ providedIn: 'root' })
export class StripeRedirectRecoveryService {
  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly browser = inject(BrowserGuard);
  private readonly sdkLoader = inject(StripeSdkLoader);

  private stripe: Stripe | null = null;
  private loadPromise: Promise<Stripe> | null = null;
  private consumePromise: Promise<PaymentResult | null> | null = null;
  private consumed = false;

  /** Live hosts in registration (render) order — used for return ownership ordinals. */
  private readonly hosts: StripeReturnHost[] = [];
  private pendingClaims: PendingClaim[] = [];
  private claimScheduled = false;
  /** Bumped by {@link resetForTests} so a queued claim microtask cannot clear a later test's URL. */
  private claimEpoch = 0;
  private returnOwner: StripeReturnHost | null = null;
  private returnClosed = false;
  private waitWarned = false;

  wasReturnConsumed(): boolean {
    return this.consumed;
  }

  /** Test helper — clears consume/claim state between Karma specs (root singleton). */
  resetForTests(): void {
    this.consumed = false;
    this.consumePromise = null;
    this.returnOwner = null;
    this.returnClosed = false;
    this.waitWarned = false;
    const abandoned = this.pendingClaims;
    this.pendingClaims = [];
    this.claimScheduled = false;
    this.claimEpoch += 1;
    abandoned.forEach((claim) => claim.resolve('not-owner'));
    this.hosts.length = 0;
    this.stripe = null;
    this.loadPromise = null;
  }

  registerHost(host: StripeReturnHost): void {
    if (!this.hosts.includes(host)) {
      this.hosts.push(host);
    }
  }

  unregisterHost(host: StripeReturnHost): void {
    const index = this.hosts.indexOf(host);
    if (index >= 0) {
      this.hosts.splice(index, 1);
    }
    // An owner destroyed before it started recovery hands the return back to a remount.
    if (this.returnOwner === host && !this.consumed) {
      this.returnOwner = null;
    }
  }

  /** Non-secret origin stamp stored before a redirect so only this host recovers it. */
  describeReturnOrigin(host: StripeReturnHost, attemptId: string): StripeReturnOrigin {
    return {
      attemptId,
      hostKind: host.kind,
      checkoutInstanceId: host.instanceId(),
      hostOrdinal: this.ordinalOf(host),
    };
  }

  /**
   * Asks whether `host` owns the current Stripe redirect return. Claims made in
   * the same render pass are decided together, so sibling hosts are all visible.
   */
  claimReturn(host: StripeReturnHost, methods: readonly PaymentMethod[]): Promise<StripeReturnClaim> {
    if (!this.browser.isBrowser) {
      return Promise.resolve('not-owner');
    }
    const epoch = this.claimEpoch;
    return new Promise((resolve) => {
      this.pendingClaims.push({ host, methods, resolve });
      if (!this.claimScheduled) {
        this.claimScheduled = true;
        queueMicrotask(() => {
          if (epoch !== this.claimEpoch) {
            return;
          }
          this.resolveClaims();
        });
      }
    });
  }

  private ordinalOf(host: StripeReturnHost): number {
    const productId = host.productId();
    return this.hosts
      .filter((h) => h.kind === host.kind && h.productId() === productId)
      .indexOf(host);
  }

  private resolveClaims(): void {
    this.claimScheduled = false;
    const batch = this.pendingClaims;
    this.pendingClaims = [];
    const live = batch.filter((claim) => this.hosts.includes(claim.host));
    const rejectAll = () => batch.forEach((claim) => claim.resolve('not-owner'));

    if (this.returnClosed || !isStripeReturnAttempt()) {
      rejectAll();
      return;
    }

    // Owner claimed earlier but verification did not finish (transient retrieve failure).
    // Only that host may retry consume — never hand the return to a sibling.
    if (this.returnOwner && !this.consumed) {
      batch.forEach((claim) =>
        claim.resolve(claim.host === this.returnOwner ? 'owner' : 'not-owner'),
      );
      return;
    }

    if (this.returnOwner && this.consumed) {
      rejectAll();
      return;
    }

    const decision = decideStripeReturnOwner(
      live.map((claim) => ({
        host: claim.host,
        kind: claim.host.kind,
        productId: claim.host.productId(),
        instanceId: claim.host.instanceId(),
        ordinal: this.ordinalOf(claim.host),
        methods: claim.methods,
      })),
      readStripeReturnParams(),
      readStripePendingReturn(),
    );

    if (decision.kind === 'owner') {
      this.returnOwner = decision.owner;
      batch.forEach((claim) => claim.resolve(claim.host === decision.owner ? 'owner' : 'not-owner'));
      return;
    }

    if (decision.kind === 'wait') {
      // The originating host is not mounted (yet). Leave the return in place for it.
      if (!this.waitWarned) {
        this.waitWarned = true;
        warnReturnDiagnostic('STRIPE_RETURN_OWNER_NOT_MOUNTED');
      }
      rejectAll();
      return;
    }

    this.returnClosed = true;
    warnReturnDiagnostic(`STRIPE_RETURN_UNATTRIBUTED (${decision.reason})`);
    if (decision.reason !== 'STALE_ATTEMPT') {
      clearStripePendingReturn();
    }
    clearStripeReturnParamsFromUrl();
    rejectAll();
  }

  /**
   * Idempotent for a successful or definitive consume.
   * Transient verification failures (network / SDK) do not mark the return consumed
   * and preserve marker + URL so the owner may retry verification (not confirmation).
   */
  consumeReturn(): Promise<PaymentResult | null> {
    if (!this.consumePromise) {
      this.consumePromise = this.doConsumeReturn().catch((error) => {
        if (isTransientStripeVerificationError(error)) {
          // Allow a later consumeReturn() to retry verification.
          this.consumePromise = null;
        }
        throw error;
      });
    }
    return this.consumePromise;
  }

  private async doConsumeReturn(): Promise<PaymentResult | null> {
    if (!this.browser.isBrowser || !isStripeReturnAttempt()) {
      return null;
    }

    if (this.consumed) {
      return null;
    }

    const method = detectStripeReturnMethod() ?? readStripeReturnParams().method;
    const { clientSecret, redirectStatus } = readStripeReturnParams();

    try {
      if (!method) {
        throw new PaymentError({
          code: 'PAYMENT_FAILED',
          message: 'Payment return is missing method context. Please try again.',
          method: 'klarna',
          provider: 'klarna',
        });
      }

      if (redirectStatus === 'failed') {
        throw new PaymentError({
          code: 'PAYMENT_FAILED',
          message: `${methodLabel(method)} payment was not completed.`,
          method,
          provider: method,
        });
      }

      if (!clientSecret?.trim()) {
        throw new PaymentError({
          code: 'PAYMENT_FAILED',
          message: `${methodLabel(method)} return is missing payment details. Please try the payment again.`,
          method,
          provider: method,
        });
      }

      const result = await this.retrieveReturningPayment(method, clientSecret);
      this.finishConsumeCleanup();
      return result;
    } catch (error) {
      if (isTransientStripeVerificationError(error)) {
        // Outcome uncertain — keep correlation data for a bounded verification retry.
        throw error;
      }
      this.finishConsumeCleanup();
      throw error;
    }
  }

  private finishConsumeCleanup(): void {
    this.consumed = true;
    clearStripePendingReturn();
    clearStripeReturnParamsFromUrl();
  }

  async retrieveReturningPayment(
    method: StripeRedirectMethod,
    clientSecret: string,
  ): Promise<PaymentResult> {
    if (!clientSecret?.trim()) {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: `Missing payment_intent_client_secret after ${methodLabel(method)} return.`,
        method,
        provider: method,
      });
    }

    const stripe = await this.ensureStripeLoaded();
    const secret = clientSecret.trim();
    let lastIntent: { id?: string; status?: string } | undefined;
    let lastTransient: PaymentError | null = null;

    for (let attempt = 0; attempt < STRIPE_PROCESSING_MAX_ATTEMPTS; attempt++) {
      let paymentIntent: { id?: string; status?: string } | undefined;
      try {
        const retrieved = await this.retrievePaymentIntentWithRetry(stripe, method, secret);
        paymentIntent = retrieved ?? undefined;
        lastTransient = null;
      } catch (error) {
        if (isTransientStripeVerificationError(error)) {
          lastTransient = error instanceof PaymentError ? error : mapMethodError(method, error);
          if (attempt < STRIPE_PROCESSING_MAX_ATTEMPTS - 1) {
            await delay(STRIPE_PROCESSING_DELAY_MS);
            continue;
          }
          throw lastTransient;
        }
        throw error;
      }

      lastIntent = paymentIntent;
      const status = paymentIntent?.status;

      if (status === 'succeeded' || status === 'requires_capture' || status === 'canceled') {
        return this.normalizeIntent(method, paymentIntent);
      }

      if (
        status === 'requires_payment_method' ||
        status === 'requires_action' ||
        status === 'requires_confirmation'
      ) {
        return this.normalizeIntent(method, paymentIntent);
      }

      if (status === 'processing') {
        if (attempt < STRIPE_PROCESSING_MAX_ATTEMPTS - 1) {
          await delay(STRIPE_PROCESSING_DELAY_MS);
          continue;
        }
        return this.normalizeIntent(method, paymentIntent);
      }

      return this.normalizeIntent(method, paymentIntent);
    }

    if (lastTransient) {
      throw lastTransient;
    }
    return this.normalizeIntent(method, lastIntent);
  }

  /**
   * Bounded retries for a single retrievePaymentIntent call on transient network/SDK errors.
   * Never confirms or creates a PaymentIntent.
   */
  private async retrievePaymentIntentWithRetry(
    stripe: Stripe,
    method: StripeRedirectMethod,
    clientSecret: string,
  ): Promise<{ id?: string; status?: string } | undefined> {
    let lastError: PaymentError | null = null;
    for (let attempt = 0; attempt < STRIPE_RETRIEVE_RETRY_ATTEMPTS; attempt++) {
      try {
        const { paymentIntent, error } = await stripe.retrievePaymentIntent(clientSecret);
        if (error) {
          const mapped = mapMethodError(method, error);
          if (!isTransientStripeVerificationError(mapped) || attempt === STRIPE_RETRIEVE_RETRY_ATTEMPTS - 1) {
            throw mapped;
          }
          lastError = mapped;
          await delay(STRIPE_RETRIEVE_RETRY_DELAY_MS);
          continue;
        }
        return paymentIntent ?? undefined;
      } catch (error) {
        if (error instanceof PaymentError && !isTransientStripeVerificationError(error)) {
          throw error;
        }
        lastError =
          error instanceof PaymentError ? error : mapMethodError(method, error);
        if (attempt === STRIPE_RETRIEVE_RETRY_ATTEMPTS - 1) {
          throw lastError;
        }
        await delay(STRIPE_RETRIEVE_RETRY_DELAY_MS);
      }
    }
    throw (
      lastError ??
      new PaymentError({
        code: 'NETWORK_ERROR',
        message: `Unable to verify ${methodLabel(method)} payment status.`,
        method,
        provider: method,
      })
    );
  }

  private normalizeIntent(
    method: StripeRedirectMethod,
    paymentIntent: { id?: string; status?: string } | undefined,
  ): PaymentResult {
    const status = paymentIntent?.status;

    if (status === 'succeeded') {
      return normalizePaymentResult({
        status: 'success',
        method,
        provider: method,
        transactionId: paymentIntent?.id,
        message: `${methodLabel(method)} payment completed successfully.`,
        metadata: {
          stripeStatus: status,
          gateway: 'stripe',
        },
      });
    }

    if (status === 'requires_capture') {
      // Public contract keeps status "success" for compatibility; metadata clarifies authorization-only.
      return normalizePaymentResult({
        status: 'success',
        method,
        provider: method,
        transactionId: paymentIntent?.id,
        message: `${methodLabel(method)} payment is authorized and requires capture. Confirm capture and fulfillment on your backend — this is not proof of captured funds.`,
        metadata: {
          stripeStatus: status,
          gateway: 'stripe',
          authorizationOnly: true,
        },
      });
    }

    if (status === 'canceled') {
      return normalizePaymentResult({
        status: 'cancelled',
        method,
        provider: method,
        transactionId: paymentIntent?.id,
        message: `${methodLabel(method)} payment was cancelled.`,
        metadata: { gateway: 'stripe' },
      });
    }

    if (status === 'requires_payment_method') {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: `${methodLabel(method)} payment was not completed. Please try again.`,
        method,
        provider: method,
        originalError: paymentIntent,
      });
    }

    if (status === 'requires_action' || status === 'requires_confirmation') {
      throw new PaymentError({
        code: 'AUTHENTICATION_REQUIRED',
        message: `${methodLabel(method)} payment still requires additional customer action.`,
        method,
        provider: method,
        originalError: paymentIntent,
      });
    }

    if (status === 'processing') {
      return normalizePaymentResult({
        status: 'processing',
        method,
        provider: method,
        transactionId: paymentIntent?.id,
        message: `${methodLabel(method)} payment is still processing. Do not retry — confirm the final status on your backend.`,
        metadata: { stripeStatus: status, gateway: 'stripe' },
      });
    }

    throw new PaymentError({
      code: 'PAYMENT_FAILED',
      message: `Unexpected PaymentIntent status: ${status ?? 'unknown'}.`,
      method,
      provider: method,
      originalError: paymentIntent,
    });
  }

  private async ensureStripeLoaded(): Promise<Stripe> {
    if (this.stripe) {
      return this.stripe;
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }

    const key = this.configService.getSnapshot().providers?.stripe?.publishableKey?.trim() ?? '';
    if (!key || looksLikeSecretKey(key) || !looksLikePublishableKey(key)) {
      throw new PaymentError({
        code: 'CONFIG_MISSING',
        message: 'Stripe publishableKey is missing or invalid (required for redirect recovery).',
        method: 'klarna',
        provider: 'klarna',
      });
    }

    this.loadPromise = (async () => {
      try {
        const stripe = await this.sdkLoader.load(key);
        if (!stripe) {
          throw new PaymentError({
            code: 'SDK_LOAD_FAILED',
            message: 'Stripe.js failed to initialize.',
            method: 'klarna',
            provider: 'klarna',
          });
        }
        this.stripe = stripe;
        return stripe;
      } catch (error) {
        // Allow a later verification retry to reload Stripe.js after a transient failure.
        this.loadPromise = null;
        throw error;
      }
    })();

    return this.loadPromise;
  }
}

function warnReturnDiagnostic(code: string): void {
  if (!isDevMode()) {
    return;
  }
  console.warn(
    `[Easy Payments] Stripe redirect return was not recovered.\nCode: ${code}\n` +
      'No success/cancel/error event was emitted. Confirm the payment status on your backend.',
  );
}

function methodLabel(method: StripeRedirectMethod): string {
  return method === 'affirm' ? 'Affirm' : 'Klarna';
}

function mapMethodError(method: StripeRedirectMethod, error: unknown): PaymentError {
  const mapped = mapStripeError(error);
  return new PaymentError({
    code: mapped.code,
    message: mapped.message,
    method,
    provider: method,
    originalError: mapped.originalError ?? error,
  });
}

/**
 * Transient verification failures are not payment outcomes.
 * Marker/URL must stay so the owning host can retry retrieve — never confirm again.
 */
export function isTransientStripeVerificationError(error: unknown): boolean {
  if (!(error instanceof PaymentError)) {
    return false;
  }
  return error.code === 'NETWORK_ERROR' || error.code === 'SDK_LOAD_FAILED';
}
