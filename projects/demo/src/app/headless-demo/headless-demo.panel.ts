import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  EasyPaymentsHeadless,
  PAYMENT_METHOD_LABELS,
  PaymentError,
  isAnyStripeBnplReturnAttempt,
  type EasyPaymentsLocale,
  type EasyPaymentsTranslationOverrides,
  type HeadlessCheckoutSession,
  type HeadlessMethodStatus,
  type HeadlessMountHandle,
  type PaymentMethod,
  type PaymentProduct,
  type PaymentResult,
  type PaymentTheme,
} from '@easy-payments/angular';
import { DEMO_HEADLESS_CHECKOUT_INSTANCE_ID } from './demo-headless-checkout-id';
import {
  isHeadlessDemoOfficialButtonMethod,
  isHeadlessDemoRecoveryRetryable,
  isHeadlessDemoStripeElementMethod,
} from './headless-demo-mount-policy';

type MountPhase = 'idle' | 'mounting' | 'mounted' | 'failed';
type RecoveryPhase = 'idle' | 'checking' | 'recovering' | 'settled' | 'retryable';

/**
 * H5.3 Headless Checkout playground — payment execution + redirect recovery.
 *
 * Card/Klarna/Affirm: Payment Element + merchant `confirm()`.
 * PayPal/Google Pay/Apple Pay: official provider buttons (no `confirm()`).
 * Klarna/Affirm returns: `recoverReturn()` before any new mount/payment attempt.
 */
@Component({
  selector: 'app-headless-demo',
  templateUrl: './headless-demo.panel.html',
  styleUrl: './headless-demo.panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeadlessDemoPanel {
  readonly product = input.required<PaymentProduct>();
  readonly methods = input.required<readonly PaymentMethod[]>();
  readonly theme = input<PaymentTheme>('system');
  readonly locale = input<EasyPaymentsLocale>('auto');
  readonly translations = input<EasyPaymentsTranslationOverrides>({});

  /** Merchant-stable checkout identity (not the runtime session id). */
  readonly checkoutInstanceId = DEMO_HEADLESS_CHECKOUT_INSTANCE_ID;

  private readonly headless = inject(EasyPaymentsHeadless);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mountHost = viewChild<ElementRef<HTMLElement>>('mountHost');

  private eventSubscriptions = new Subscription();
  private bootGeneration = 0;
  private mountGeneration = 0;
  private confirmGeneration = 0;
  private recoveryGeneration = 0;
  private mountHandle: HeadlessMountHandle | null = null;
  private appliedFingerprint: string | null = null;

  readonly bootStatus = signal<'idle' | 'starting' | 'ready' | 'failed'>('idle');
  readonly bootError = signal<string | null>(null);
  readonly activeSession = signal<HeadlessCheckoutSession | null>(null);
  readonly lifecycleEvents = signal<string[]>([]);
  readonly mountPhase = signal<MountPhase>('idle');
  readonly mountError = signal<string | null>(null);
  readonly mountNotice = signal<string | null>(null);
  readonly configSkipMessage = signal<string | null>(null);
  readonly pendingConfigFingerprint = signal<string | null>(null);
  readonly uiSelectedMethod = signal<PaymentMethod | null>(null);
  readonly confirmInFlight = signal(false);
  readonly recoveryPhase = signal<RecoveryPhase>('idle');
  readonly recoveryMessage = signal<string | null>(null);
  readonly lastActionError = signal<string | null>(null);

  readonly methodLabels = PAYMENT_METHOD_LABELS;

  readonly sessionId = computed(() => this.activeSession()?.id ?? null);
  readonly sessionState = computed(() => this.activeSession()?.state() ?? null);
  readonly selectedMethod = computed(() => this.activeSession()?.selectedMethod() ?? null);
  readonly availableMethods = computed(() => this.activeSession()?.availableMethods() ?? []);
  readonly lastError = computed(() => this.activeSession()?.lastError() ?? null);
  readonly lastResult = computed(() => this.activeSession()?.lastResult() ?? null);

  readonly isInitializing = computed(
    () => this.bootStatus() === 'starting' || this.sessionState() === 'initializing',
  );

  readonly availabilityEmpty = computed(
    () => this.bootStatus() === 'ready' && this.availableMethods().length === 0,
  );

  readonly priceLabel = computed(() => {
    const product = this.product();
    const quantity = product.quantity ?? 1;
    const total = Number(product.amount) * (Number.isFinite(quantity) ? quantity : 1);
    return `${total.toFixed(2)} ${product.currency}`;
  });

  readonly paymentLocked = computed(() => {
    const state = this.sessionState();
    return (
      this.confirmInFlight() ||
      this.recoveryPhase() === 'checking' ||
      this.recoveryPhase() === 'recovering' ||
      state === 'processing' ||
      state === 'pending'
    );
  });

  readonly canConfirmPayment = computed(() => {
    const method = this.uiSelectedMethod();
    const state = this.sessionState();
    return (
      this.mountPhase() === 'mounted' &&
      method !== null &&
      isHeadlessDemoStripeElementMethod(method) &&
      this.selectedMethod() === method &&
      (state === 'ready' || state === 'error') &&
      !this.confirmInFlight() &&
      this.recoveryPhase() !== 'recovering' &&
      this.recoveryPhase() !== 'checking'
    );
  });

  readonly showConfirmControl = computed(() => {
    const method = this.uiSelectedMethod();
    return (
      this.mountPhase() === 'mounted' &&
      method !== null &&
      isHeadlessDemoStripeElementMethod(method)
    );
  });

  readonly showOfficialButtonHint = computed(() => {
    const method = this.uiSelectedMethod();
    return (
      this.mountPhase() === 'mounted' &&
      method !== null &&
      isHeadlessDemoOfficialButtonMethod(method)
    );
  });

  readonly authorizationOnly = computed(() => {
    const result = this.lastResult();
    return result?.metadata?.['authorizationOnly'] === true;
  });

  readonly resultIsPending = computed(() => {
    const result = this.lastResult();
    return result?.status === 'processing' || this.sessionState() === 'pending';
  });

  readonly canApplyPendingConfig = computed(() => {
    return (
      this.pendingConfigFingerprint() !== null &&
      !this.paymentLocked() &&
      this.bootStatus() === 'ready'
    );
  });

  readonly canRetryRecovery = computed(() => this.recoveryPhase() === 'retryable');

  private readonly configFingerprint = computed(() => {
    const product = this.product();
    return JSON.stringify({
      id: product.id,
      name: product.name,
      description: product.description ?? '',
      amount: product.amount,
      currency: product.currency,
      quantity: product.quantity ?? 1,
      methods: [...this.methods()],
      theme: this.theme(),
      locale: this.locale(),
      translations: this.translations(),
    });
  });

  constructor() {
    effect(() => {
      const fingerprint = this.configFingerprint();
      untracked(() => {
        void this.applyCheckoutConfig(fingerprint);
      });
    });

    this.destroyRef.onDestroy(() => {
      void this.teardown();
    });
  }

  async retryInitialize(): Promise<void> {
    if (this.bootStatus() === 'starting' || this.paymentLocked()) {
      return;
    }
    this.appliedFingerprint = null;
    await this.applyCheckoutConfig(this.configFingerprint());
  }

  async applyPendingConfiguration(): Promise<void> {
    const pending = this.pendingConfigFingerprint();
    if (!pending || this.paymentLocked()) {
      return;
    }
    this.pendingConfigFingerprint.set(null);
    this.configSkipMessage.set(null);
    this.appliedFingerprint = null;
    await this.applyCheckoutConfig(pending);
  }

  async retryRecoverReturn(): Promise<void> {
    const session = this.activeSession();
    if (!session || !this.canRetryRecovery()) {
      return;
    }
    await this.runRecoverReturn(session, this.bootGeneration);
  }

  isStripeElementMethod(method: PaymentMethod): boolean {
    return isHeadlessDemoStripeElementMethod(method);
  }

  isOfficialButtonMethod(method: PaymentMethod): boolean {
    return isHeadlessDemoOfficialButtonMethod(method);
  }

  methodStatus(method: PaymentMethod): HeadlessMethodStatus | undefined {
    return this.availableMethods().find((entry) => entry.method === method);
  }

  unavailableReason(entry: HeadlessMethodStatus): string {
    if (entry.available && entry.readiness === 'ready') {
      return '';
    }
    if (entry.readinessNote?.trim()) {
      return entry.readinessNote.trim();
    }
    if (entry.diagnosticCode?.trim()) {
      return entry.diagnosticCode.trim();
    }
    if (entry.readiness === 'loading') {
      return entry.method === 'apple-pay'
        ? 'Apple Pay eligibility is confirmed after mounting the Express Checkout Element.'
        : 'Still checking provider availability.';
    }
    if (entry.readiness === 'misconfigured') {
      return 'Provider configuration is incomplete for this method.';
    }
    return 'Not available in the current browser / provider configuration.';
  }

  canSelectMethod(entry: HeadlessMethodStatus): boolean {
    if (this.paymentLocked() || this.isInitializing() || this.bootStatus() !== 'ready') {
      return false;
    }
    if (entry.readiness === 'unavailable' || entry.readiness === 'misconfigured') {
      return false;
    }
    if (entry.method === 'apple-pay') {
      return (
        entry.readiness === 'loading' ||
        entry.readiness === 'ready' ||
        entry.available === true
      );
    }
    if (entry.readiness === 'loading') {
      return false;
    }
    return entry.available || entry.readiness === 'ready';
  }

  async onSelectMethod(method: PaymentMethod): Promise<void> {
    const session = this.activeSession();
    const entry = this.methodStatus(method);
    if (!session || !entry || !this.canSelectMethod(entry)) {
      return;
    }

    const op = ++this.mountGeneration;
    this.mountError.set(null);
    this.mountNotice.set(null);
    this.lastActionError.set(null);
    this.uiSelectedMethod.set(method);

    try {
      await this.clearMountHandle();
      if (op !== this.mountGeneration) {
        return;
      }

      session.selectMethod(method);
      this.mountPhase.set('mounting');

      const container = this.mountHost()?.nativeElement;
      if (!container) {
        throw new PaymentError({
          code: 'CONFIG_INVALID',
          message: 'Mount container is not ready.',
          method,
        });
      }

      container.replaceChildren();
      const handle = await session.mount(method, container);
      if (op !== this.mountGeneration || this.activeSession() !== session) {
        try {
          await handle.unmount();
        } catch {
          // Ignore stale unmount failures.
        }
        return;
      }

      this.mountHandle = handle;
      this.mountPhase.set('mounted');

      if (isHeadlessDemoOfficialButtonMethod(method)) {
        this.mountNotice.set(
          'Use the official provider control above to pay. The demo never calls confirm() for PayPal, Google Pay, or Apple Pay.',
        );
      }
    } catch (error) {
      if (op !== this.mountGeneration) {
        return;
      }
      this.mountHandle = null;
      this.mountPhase.set('failed');
      this.mountError.set(formatPublicError(error));
    }
  }

  async onConfirmPayment(): Promise<void> {
    const session = this.activeSession();
    const method = this.uiSelectedMethod();
    if (!session || !method || !this.canConfirmPayment()) {
      return;
    }
    if (!isHeadlessDemoStripeElementMethod(method)) {
      return;
    }

    const op = ++this.confirmGeneration;
    this.confirmInFlight.set(true);
    this.lastActionError.set(null);

    try {
      await session.confirm();
    } catch (error) {
      if (op !== this.confirmGeneration) {
        return;
      }
      this.lastActionError.set(formatPublicError(error));
    } finally {
      if (op === this.confirmGeneration) {
        this.confirmInFlight.set(false);
      }
    }
  }

  private async applyCheckoutConfig(fingerprint: string): Promise<void> {
    if (fingerprint === this.appliedFingerprint && this.activeSession()) {
      if (this.pendingConfigFingerprint() === fingerprint) {
        this.pendingConfigFingerprint.set(null);
        this.configSkipMessage.set(null);
      }
      return;
    }

    if (this.appliedFingerprint !== null && this.paymentLocked()) {
      this.pendingConfigFingerprint.set(fingerprint);
      this.configSkipMessage.set(
        'Checkout configuration changed while a payment or return recovery is in progress. Apply the pending update after this attempt settles — do not replace an active payment.',
      );
      return;
    }

    this.configSkipMessage.set(null);
    this.pendingConfigFingerprint.set(null);
    this.appliedFingerprint = fingerprint;
    await this.startSession();
  }

  private async startSession(): Promise<void> {
    const generation = ++this.bootGeneration;
    this.mountGeneration += 1;
    this.confirmGeneration += 1;
    this.recoveryGeneration += 1;
    this.bootStatus.set('starting');
    this.bootError.set(null);
    this.lifecycleEvents.set([]);
    this.uiSelectedMethod.set(null);
    this.mountPhase.set('idle');
    this.mountError.set(null);
    this.mountNotice.set(null);
    this.lastActionError.set(null);
    this.confirmInFlight.set(false);
    this.recoveryPhase.set('idle');
    this.recoveryMessage.set(null);

    await this.clearMountHandle();
    await this.destroyActiveSession();

    if (generation !== this.bootGeneration) {
      return;
    }

    let created: HeadlessCheckoutSession | null = null;
    try {
      created = this.headless.createSession({
        product: this.product(),
        methods: [...this.methods()],
        checkoutInstanceId: this.checkoutInstanceId,
        theme: this.theme(),
        locale: this.locale(),
        translations: this.translations(),
      });

      if (generation !== this.bootGeneration) {
        await created.destroy().catch(() => undefined);
        return;
      }

      this.activeSession.set(created);
      this.bindLifecycleEvents(created);

      await created.initialize();

      if (generation !== this.bootGeneration || this.activeSession() !== created) {
        return;
      }

      // Recover Klarna/Affirm returns before any mount or new payment attempt.
      await this.runRecoverReturn(created, generation);

      if (generation !== this.bootGeneration || this.activeSession() !== created) {
        return;
      }

      this.bootStatus.set('ready');
    } catch (error) {
      if (generation !== this.bootGeneration) {
        return;
      }
      this.bootError.set(formatPublicError(error, 'Headless session failed to initialize.'));
      this.bootStatus.set('failed');
      if (created && this.activeSession() !== created) {
        this.activeSession.set(created);
      }
    }
  }

  private async runRecoverReturn(
    session: HeadlessCheckoutSession,
    bootGeneration: number,
  ): Promise<void> {
    const op = ++this.recoveryGeneration;
    const maybeReturn =
      typeof window !== 'undefined' ? isAnyStripeBnplReturnAttempt() : false;

    if (!maybeReturn) {
      this.recoveryPhase.set('idle');
      this.recoveryMessage.set(null);
      // Still probe once — returns null for non-owners / absent returns without claiming.
      try {
        const result = await session.recoverReturn();
        if (bootGeneration !== this.bootGeneration || op !== this.recoveryGeneration) {
          return;
        }
        if (result) {
          this.recoveryPhase.set('settled');
          this.recoveryMessage.set(formatRecoveryResult(result));
          this.pushLifecycleLine(
            `recoverReturn · ${result.status} · ${result.method}${
              result.metadata?.['authorizationOnly'] === true ? ' · authorizationOnly' : ''
            }`,
          );
        }
      } catch (error) {
        if (bootGeneration !== this.bootGeneration || op !== this.recoveryGeneration) {
          return;
        }
        this.handleRecoveryFailure(error);
      }
      return;
    }

    this.recoveryPhase.set('recovering');
    this.recoveryMessage.set('Verifying Klarna/Affirm return with Stripe…');

    try {
      const result = await session.recoverReturn();
      if (bootGeneration !== this.bootGeneration || op !== this.recoveryGeneration) {
        return;
      }

      if (!result) {
        this.recoveryPhase.set('settled');
        this.recoveryMessage.set(
          'No Headless-owned return for this checkout identity (unrelated or absent). Other checkout modes were not claimed.',
        );
        return;
      }

      this.recoveryPhase.set('settled');
      this.recoveryMessage.set(formatRecoveryResult(result));
      this.pushLifecycleLine(
        `recoverReturn · ${result.status} · ${result.method}${
          result.metadata?.['authorizationOnly'] === true ? ' · authorizationOnly' : ''
        }`,
      );
    } catch (error) {
      if (bootGeneration !== this.bootGeneration || op !== this.recoveryGeneration) {
        return;
      }
      this.handleRecoveryFailure(error);
    }
  }

  private handleRecoveryFailure(error: unknown): void {
    const message = formatPublicError(error, 'Return recovery failed.');
    this.lastActionError.set(message);
    this.pushLifecycleLine(`recoverReturn · error · ${message}`);

    if (isHeadlessDemoRecoveryRetryable(error)) {
      this.recoveryPhase.set('retryable');
      this.recoveryMessage.set(
        'Transient verification failure. Pending return data was preserved — retry recoverReturn() without confirming again or creating a new PaymentIntent.',
      );
      return;
    }

    this.recoveryPhase.set('settled');
    this.recoveryMessage.set(message);
  }

  private pushLifecycleLine(line: string): void {
    this.lifecycleEvents.update((entries) => [line, ...entries].slice(0, 12));
  }

  private bindLifecycleEvents(session: HeadlessCheckoutSession): void {
    this.eventSubscriptions.unsubscribe();
    this.eventSubscriptions = new Subscription();

    const push = (line: string): void => {
      if (this.activeSession() !== session) {
        return;
      }
      this.pushLifecycleLine(line);
    };

    this.eventSubscriptions.add(
      session.events.started.subscribe((event) => {
        push(`started · ${event.method} · ${event.provider}`);
      }),
    );
    this.eventSubscriptions.add(
      session.events.methodChange.subscribe((event) => {
        push(
          `methodChange · ${event.previousMethod ?? 'none'} → ${event.method ?? 'none'}`,
        );
      }),
    );
    this.eventSubscriptions.add(
      session.events.pending.subscribe((result) => {
        push(`pending · ${result.method} · ${result.status}`);
      }),
    );
    this.eventSubscriptions.add(
      session.events.success.subscribe((result) => {
        const auth =
          result.metadata?.['authorizationOnly'] === true ? ' · authorizationOnly' : '';
        push(`success · ${result.method} · ${result.transactionId ?? 'n/a'}${auth}`);
      }),
    );
    this.eventSubscriptions.add(
      session.events.cancel.subscribe((result) => {
        push(`cancel · ${result.method}`);
      }),
    );
    this.eventSubscriptions.add(
      session.events.error.subscribe((error) => {
        push(`error · ${error.code}: ${error.message}`);
      }),
    );
  }

  private async clearMountHandle(): Promise<void> {
    const handle = this.mountHandle;
    this.mountHandle = null;
    if (!handle) {
      return;
    }
    try {
      await handle.unmount();
    } catch {
      // Unmount failures must not block session teardown.
    }
    const host = this.mountHost()?.nativeElement;
    host?.replaceChildren();
  }

  private async destroyActiveSession(): Promise<void> {
    this.eventSubscriptions.unsubscribe();
    this.eventSubscriptions = new Subscription();

    const active = this.activeSession();
    this.activeSession.set(null);
    if (!active) {
      return;
    }
    try {
      await active.destroy();
    } catch {
      // Teardown must not throw into Angular lifecycle.
    }
  }

  private async teardown(): Promise<void> {
    this.bootGeneration += 1;
    this.mountGeneration += 1;
    this.confirmGeneration += 1;
    this.recoveryGeneration += 1;
    await this.clearMountHandle();
    await this.destroyActiveSession();
    this.bootStatus.set('idle');
    this.bootError.set(null);
    this.lifecycleEvents.set([]);
    this.mountPhase.set('idle');
    this.mountError.set(null);
    this.mountNotice.set(null);
    this.uiSelectedMethod.set(null);
    this.confirmInFlight.set(false);
    this.recoveryPhase.set('idle');
    this.recoveryMessage.set(null);
    this.lastActionError.set(null);
    this.pendingConfigFingerprint.set(null);
    this.configSkipMessage.set(null);
    this.appliedFingerprint = null;
  }
}

function formatPublicError(error: unknown, fallback = 'Operation failed.'): string {
  if (error instanceof PaymentError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function formatRecoveryResult(result: PaymentResult): string {
  const auth =
    result.metadata?.['authorizationOnly'] === true
      ? ' Authorization only — not captured funds; fulfill via backend/webhooks.'
      : '';
  if (result.status === 'processing') {
    return `Return recovered as pending/processing for ${result.method}. Confirm final fulfillment on your backend.${auth}`;
  }
  if (result.status === 'success') {
    return `Return recovered as success for ${result.method}.${auth} Frontend results are not authoritative fulfillment.`;
  }
  if (result.status === 'cancelled') {
    return `Return recovered as cancelled for ${result.method}.`;
  }
  return `Return recovered: ${result.status} · ${result.method}.${auth}`;
}
