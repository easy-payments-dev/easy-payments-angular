import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  ElementRef,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  EasyPaymentsHeadless,
  PAYMENT_METHOD_LABELS,
  PaymentError,
  type EasyPaymentsLocale,
  type EasyPaymentsTranslationOverrides,
  type HeadlessCheckoutSession,
  type HeadlessMethodStatus,
  type HeadlessMountHandle,
  type PaymentMethod,
  type PaymentProduct,
  type PaymentTheme,
} from '@easy-payments/angular';
import { DEMO_HEADLESS_CHECKOUT_INSTANCE_ID } from './demo-headless-checkout-id';
import {
  isHeadlessDemoMountDeferred,
  isHeadlessDemoStripeElementMethod,
} from './headless-demo-mount-policy';

type MountPhase = 'idle' | 'mounting' | 'mounted' | 'deferred' | 'failed';

/**
 * H5.2 Headless Checkout playground — merchant-owned UI + safe provider mounts.
 *
 * Mounts Stripe Card / Klarna / Affirm Payment Elements. Defers PayPal / Google Pay /
 * Apple Pay interactive mounts until H5.3 (official buttons initiate payment on click).
 * Does not call confirm() or recoverReturn().
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
  readonly uiSelectedMethod = signal<PaymentMethod | null>(null);

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

  readonly showConfirmPlaceholder = computed(() => {
    const method = this.uiSelectedMethod();
    return (
      this.mountPhase() === 'mounted' &&
      method !== null &&
      isHeadlessDemoStripeElementMethod(method)
    );
  });

  readonly paymentLocked = computed(() => {
    const state = this.sessionState();
    return state === 'processing' || state === 'pending';
  });

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

  /** Safe initialize retry after a failed boot (public API supports re-initialize). */
  async retryInitialize(): Promise<void> {
    if (this.bootStatus() === 'starting') {
      return;
    }
    this.appliedFingerprint = null;
    await this.applyCheckoutConfig(this.configFingerprint());
  }

  isDeferredMethod(method: PaymentMethod): boolean {
    return isHeadlessDemoMountDeferred(method);
  }

  isStripeElementMethod(method: PaymentMethod): boolean {
    return isHeadlessDemoStripeElementMethod(method);
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
      return 'Still checking provider availability.';
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
    this.uiSelectedMethod.set(method);

    try {
      await this.clearMountHandle();
      if (op !== this.mountGeneration) {
        return;
      }

      session.selectMethod(method);

      if (isHeadlessDemoMountDeferred(method)) {
        this.mountPhase.set('deferred');
        this.mountNotice.set(
          'Interactive provider mounting will be enabled in H5.3. Official PayPal / Google Pay / Apple Pay controls start payment on click, so H5.2 only shows verified availability.',
        );
        return;
      }

      this.mountPhase.set('mounting');
      if (op !== this.mountGeneration) {
        return;
      }

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
    } catch (error) {
      if (op !== this.mountGeneration) {
        return;
      }
      this.mountHandle = null;
      this.mountPhase.set('failed');
      this.mountError.set(formatPublicError(error));
    }
  }

  private async applyCheckoutConfig(fingerprint: string): Promise<void> {
    if (fingerprint === this.appliedFingerprint && this.activeSession()) {
      return;
    }

    const state = this.sessionState();
    if (
      this.appliedFingerprint !== null &&
      (state === 'processing' || state === 'pending')
    ) {
      this.configSkipMessage.set(
        'Checkout configuration changed while a payment is processing or pending. Finish that attempt or leave Headless before applying updates.',
      );
      return;
    }

    this.configSkipMessage.set(null);
    this.appliedFingerprint = fingerprint;
    await this.startSession();
  }

  private async startSession(): Promise<void> {
    const generation = ++this.bootGeneration;
    this.mountGeneration += 1;
    this.bootStatus.set('starting');
    this.bootError.set(null);
    this.lifecycleEvents.set([]);
    this.uiSelectedMethod.set(null);
    this.mountPhase.set('idle');
    this.mountError.set(null);
    this.mountNotice.set(null);

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

  private bindLifecycleEvents(session: HeadlessCheckoutSession): void {
    this.eventSubscriptions.unsubscribe();
    this.eventSubscriptions = new Subscription();

    const push = (line: string): void => {
      if (this.activeSession() !== session) {
        return;
      }
      this.lifecycleEvents.update((entries) => [line, ...entries].slice(0, 12));
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
        push(`success · ${result.method} · ${result.transactionId ?? 'n/a'}`);
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
    await this.clearMountHandle();
    await this.destroyActiveSession();
    this.bootStatus.set('idle');
    this.bootError.set(null);
    this.lifecycleEvents.set([]);
    this.mountPhase.set('idle');
    this.mountError.set(null);
    this.mountNotice.set(null);
    this.uiSelectedMethod.set(null);
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
