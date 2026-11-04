import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  EasyPaymentsHeadless,
  PAYMENT_METHOD_LABELS,
  PaymentError,
  type EasyPaymentsLocale,
  type EasyPaymentsTranslationOverrides,
  type HeadlessCheckoutSession,
  type PaymentMethod,
  type PaymentProduct,
  type PaymentTheme,
} from '@easy-payments/angular';
import { DEMO_HEADLESS_CHECKOUT_INSTANCE_ID } from './demo-headless-checkout-id';

/**
 * H5.1 Headless Checkout playground foundation.
 *
 * Creates and initializes a public Headless session, surfaces availability and
 * lifecycle state, and destroys the session on teardown. Provider mount,
 * confirm, and recoverReturn belong to later H5 milestones.
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

  private eventSubscriptions = new Subscription();
  private bootGeneration = 0;

  readonly bootStatus = signal<'idle' | 'starting' | 'ready' | 'failed'>('idle');
  readonly bootError = signal<string | null>(null);
  readonly activeSession = signal<HeadlessCheckoutSession | null>(null);
  readonly lifecycleEvents = signal<string[]>([]);

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

  constructor() {
    void this.startSession();
    this.destroyRef.onDestroy(() => {
      void this.teardown();
    });
  }

  /** Safe initialize retry after a failed boot (public API supports re-initialize). */
  async retryInitialize(): Promise<void> {
    if (this.bootStatus() === 'starting') {
      return;
    }
    await this.startSession();
  }

  private async startSession(): Promise<void> {
    const generation = ++this.bootGeneration;
    this.bootStatus.set('starting');
    this.bootError.set(null);
    this.lifecycleEvents.set([]);

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
      const message =
        error instanceof PaymentError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : 'Headless session failed to initialize.';
      this.bootError.set(message);
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
    await this.destroyActiveSession();
    this.bootStatus.set('idle');
    this.bootError.set(null);
    this.lifecycleEvents.set([]);
  }
}
