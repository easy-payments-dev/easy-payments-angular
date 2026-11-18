import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonList,
  IonItem,
  IonSelect,
  IonSelectOption,
  IonNote,
  IonChip,
  IonButton,
} from '@ionic/angular';
import {
  EasyPaymentButtonsComponent,
  EasyPaymentsComponent,
  EasyPaymentsConfigService,
  EasyPaymentsHeadless,
  MockPaymentController,
  PaymentError,
  PaymentMethod,
  PaymentOrchestratorService,
  PaymentResult,
  type EasyPaymentsLocale,
  type HeadlessCheckoutSession,
  type HeadlessMethodStatus,
  type MockPaymentOutcome,
} from '@easy-payments/angular';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Subscription } from 'rxjs';
import {
  SMOKE_METHODS,
  SMOKE_PRODUCT,
  buildSmokePaymentsConfig,
  resolveSmokeCheckoutOptions,
  smokeEnv,
} from '../smoke-payments.config';
import {
  VENMO_FALLBACK_INCOMING_EVENT,
  VENMO_FALLBACK_RETURN_EVENT,
  buildVenmoChromeCheckoutUrl,
  clearVenmoFallbackPending,
  createVenmoFallbackAttemptId,
  isHttpsSandboxCheckoutUrl,
  isVerifiedVenmoCaptureStatus,
  readVenmoFallbackPending,
  type VenmoFallbackReturnDetail,
  writeVenmoFallbackPending,
} from '../venmo-chrome-fallback';

type Surface = 'full' | 'buttons' | 'headless';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonList,
    IonItem,
    IonSelect,
    IonSelectOption,
    IonNote,
    IonChip,
    IonButton,
    EasyPaymentsComponent,
    EasyPaymentButtonsComponent,
  ],
})
export class HomePage implements AfterViewInit, OnDestroy {
  private readonly config = inject(EasyPaymentsConfigService);
  private readonly orchestrator = inject(PaymentOrchestratorService);
  private readonly mock = inject(MockPaymentController);
  private readonly headlessApi = inject(EasyPaymentsHeadless);

  readonly headlessHost = viewChild<ElementRef<HTMLElement>>('headlessHost');

  readonly product = SMOKE_PRODUCT;
  readonly methods = [...SMOKE_METHODS] as PaymentMethod[];
  readonly surface = signal<Surface>('full');
  /** Same public `[locale]` / Headless `locale` as the Angular demo. */
  readonly locale = signal<EasyPaymentsLocale>('auto');
  readonly mockOutcome = signal<MockPaymentOutcome>('success');
  readonly usingMock = signal(smokeEnv.useMockMode !== false);
  readonly platformLabel = `${Capacitor.getPlatform()}${Capacitor.isNativePlatform() ? ' (native)' : ' (web)'}`;
  readonly lastEvent = signal<string>('—');
  readonly eventLog = signal<string[]>([]);
  /** Android Sandbox: Venmo ineligible in WebView + HTTPS checkout URL configured. */
  readonly showVenmoChromeFallback = signal(false);
  readonly venmoFallbackBusy = signal(false);

  private headlessSession: HeadlessCheckoutSession | null = null;
  private headlessSubs = new Subscription();
  private venmoIneligible = false;
  /** Attempts that already emitted success after backend verify — at most one success. */
  private readonly venmoVerifiedSuccessAttempts = new Set<string>();
  private appStateSub: { remove: () => Promise<void> } | null = null;
  private resumeDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onVenmoFallbackIncoming = (): void => {
    if (this.resumeDismissTimer) {
      clearTimeout(this.resumeDismissTimer);
      this.resumeDismissTimer = null;
    }
  };
  private readonly onVenmoFallbackReturn = (event: Event): void => {
    this.onVenmoFallbackIncoming();
    const detail = (event as CustomEvent<VenmoFallbackReturnDetail>).detail;
    if (!detail) {
      return;
    }
    void this.handleVenmoChromeFallbackReturn(detail);
  };

  /**
   * Native App Link return only; undefined in browser preserves same-origin checkout.
   * Resolved via a cached options object — a fresh object every CD would remount
   * Stripe Elements and leave Klarna stuck on “Preparing…”.
   */
  get checkout() {
    return resolveSmokeCheckoutOptions();
  }

  constructor() {
    // CDP / emulator automation hook (smoke app only).
    (globalThis as unknown as { __epSmoke?: object }).__epSmoke = {
      setSurface: (value: Surface) => this.onSurfaceChange(value),
      setLocale: (value: EasyPaymentsLocale) => this.onLocaleChange(value),
      setOutcome: (value: MockPaymentOutcome) => this.onMockOutcomeChange(value),
      toggleMode: () => this.toggleMode(),
      /** Confirm-style Headless mock (card / klarna / affirm) — wallets use DEMO button click. */
      confirmHeadless: () => this.confirmHeadlessIfReady(),
      openVenmoChromeFallback: () => this.openVenmoInChrome(),
      getState: () => {
        const checkout = this.checkout;
        let checkoutSuccessOrigin: string | null = null;
        try {
          checkoutSuccessOrigin = checkout?.successUrl
            ? new URL(checkout.successUrl).origin
            : null;
        } catch {
          checkoutSuccessOrigin = null;
        }
        return {
          surface: this.surface(),
          locale: this.locale(),
          outcome: this.mockOutcome(),
          usingMock: this.usingMock(),
          lastEvent: this.lastEvent(),
          eventLog: this.eventLog(),
          headlessCanConfirm: this.canConfirmHeadless(),
          /** Origin only — never the full return URL with Stripe secrets. */
          checkoutSuccessOrigin,
          allowExternalHttpsReturnUrl: checkout?.allowExternalHttpsReturnUrl === true,
          isNative: Capacitor.isNativePlatform(),
          showVenmoChromeFallback: this.showVenmoChromeFallback(),
        };
      },
    };
  }

  ngAfterViewInit(): void {
    window.addEventListener(VENMO_FALLBACK_INCOMING_EVENT, this.onVenmoFallbackIncoming);
    window.addEventListener(VENMO_FALLBACK_RETURN_EVENT, this.onVenmoFallbackReturn);
    void this.wireAppResumeForVenmoDismiss();
    this.refreshVenmoChromeFallbackVisibility();
    void this.probeVenmoWebViewEligibility();
    if (this.surface() === 'headless') {
      void this.mountHeadless();
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener(VENMO_FALLBACK_INCOMING_EVENT, this.onVenmoFallbackIncoming);
    window.removeEventListener(VENMO_FALLBACK_RETURN_EVENT, this.onVenmoFallbackReturn);
    if (this.resumeDismissTimer) {
      clearTimeout(this.resumeDismissTimer);
      this.resumeDismissTimer = null;
    }
    void this.appStateSub?.remove();
    this.appStateSub = null;
    this.teardownHeadless();
    delete (globalThis as unknown as { __epSmoke?: object }).__epSmoke;
  }

  async onSurfaceChange(value: string | number | undefined): Promise<void> {
    const next = (value as Surface) || 'full';
    this.surface.set(next);
    if (next === 'headless') {
      await this.mountHeadless();
    } else {
      this.teardownHeadless();
    }
  }

  async onMockOutcomeChange(value: string | number | undefined): Promise<void> {
    const outcome = (value as MockPaymentOutcome) || 'success';
    this.mockOutcome.set(outcome);
    this.mock.setOutcome(outcome);
    this.pushLog(`mock outcome → ${outcome}`);
  }

  async onLocaleChange(value: string | number | undefined): Promise<void> {
    const next = (value as EasyPaymentsLocale) || 'auto';
    const allowed: readonly EasyPaymentsLocale[] = ['auto', 'en', 'es', 'pt', 'fr'];
    if (!(allowed as readonly string[]).includes(next)) {
      return;
    }
    this.locale.set(next);
    this.pushLog(`locale → ${next}`);
    if (this.surface() === 'headless') {
      await this.mountHeadless();
    }
  }

  async toggleMode(): Promise<void> {
    const nextMock = !this.usingMock();
    this.usingMock.set(nextMock);
    this.config.replace(buildSmokePaymentsConfig(nextMock));
    await this.orchestrator.reinitialize();
    await this.orchestrator.refreshAvailability(this.methods, this.product);
    this.pushLog(nextMock ? 'switched to Mock' : 'switched to Sandbox/Real config');
    this.venmoIneligible = false;
    this.refreshVenmoChromeFallbackVisibility();
    if (!nextMock) {
      void this.probeVenmoWebViewEligibility();
    }
    if (this.surface() === 'headless') {
      await this.mountHeadless();
    }
  }

  onSuccess(result: PaymentResult): void {
    this.lastEvent.set(`success:${result.method}`);
    this.pushLog(`success ${result.method} ${result.transactionId ?? ''}`.trim());
  }

  onCancel(result: PaymentResult): void {
    this.lastEvent.set(`cancel:${result.method}`);
    this.pushLog(`cancel ${result.method}`);
  }

  onError(error: PaymentError): void {
    this.lastEvent.set(`error:${error.code}`);
    this.pushLog(`error ${error.code} ${error.message}`);
    if (
      error.method === 'venmo' &&
      (error.code === 'PROVIDER_UNAVAILABLE' || /not eligible|ineligible/i.test(error.message))
    ) {
      this.venmoIneligible = true;
      this.refreshVenmoChromeFallbackVisibility();
    }
  }

  onStarted(event: { method: PaymentMethod }): void {
    this.pushLog(`started ${event.method}`);
  }

  async openVenmoInChrome(): Promise<void> {
    if (!this.showVenmoChromeFallback() || this.venmoFallbackBusy()) {
      return;
    }
    const checkoutBase = smokeEnv.venmoSandboxCheckoutUrl?.trim() ?? '';
    const nativeReturn = smokeEnv.nativeStripeReturnUrl?.trim() ?? '';
    if (!isHttpsSandboxCheckoutUrl(checkoutBase) || !nativeReturn.trim()) {
      this.pushLog('venmo chrome fallback: invalid checkout/return URL');
      return;
    }

    const attemptId = createVenmoFallbackAttemptId();
    this.venmoFallbackBusy.set(true);
    this.pushLog(`venmo handoff create attempt=${attemptId}`);
    this.lastEvent.set('venmo:handoff-create');

    try {
      const handoff = await this.createVenmoHandoff(attemptId, nativeReturn);
      const linkRels = (handoff.links ?? []).map((l) => l.rel).join(',') || 'none';
      this.pushLog(
        `venmo handoff order=${handoff.orderId} status=${handoff.status} links=${linkRels} mode=${handoff.handoff}`,
      );

      // Prefer PayPal-returned buyer approval URL only — never invent a Venmo URL.
      const chromeUrl =
        handoff.approvalUrl?.trim() ||
        buildVenmoChromeCheckoutUrl({
          checkoutBaseUrl: checkoutBase,
          attemptId,
          nativeReturnUrl: nativeReturn,
          orderId: handoff.orderId,
          productName: handoff.product.name,
          amount: handoff.product.amount,
          currency: handoff.product.currency,
        });
      if (!chromeUrl) {
        this.pushLog('venmo chrome fallback: could not build Chrome URL');
        this.lastEvent.set('error:venmo-handoff-url');
        return;
      }

      writeVenmoFallbackPending({
        attemptId,
        openedAt: Date.now(),
        checkoutUrl: chromeUrl.split('?')[0] ?? chromeUrl,
        orderId: handoff.orderId,
      });
      this.pushLog(
        `venmo chrome open mode=${handoff.approvalUrl ? 'approval_url' : 'official_button'} attempt=${attemptId}`,
      );
      this.lastEvent.set('venmo:chrome-open');

      // Capacitor Android hands http(s) window.open to the external browser (Chrome).
      const opened = window.open(chromeUrl, '_blank');
      if (!opened) {
        this.pushLog('venmo chrome fallback: window.open blocked');
        clearVenmoFallbackPending();
        this.lastEvent.set('venmo:chrome-blocked');
      }
    } catch (error) {
      clearVenmoFallbackPending();
      const message = error instanceof Error ? error.message : 'handoff failed';
      this.pushLog(`venmo handoff failed: ${message}`);
      this.lastEvent.set('error:venmo-handoff');
    } finally {
      this.venmoFallbackBusy.set(false);
    }
  }

  private refreshVenmoChromeFallbackVisibility(): void {
    const enabled =
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === 'android' &&
      !this.usingMock() &&
      isHttpsSandboxCheckoutUrl(smokeEnv.venmoSandboxCheckoutUrl) &&
      !!smokeEnv.nativeStripeReturnUrl?.trim() &&
      this.venmoIneligible;
    this.showVenmoChromeFallback.set(enabled);
  }

  /**
   * PayPal SDK reports Venmo ineligible in this WebView even when Chrome on the
   * same device can pay. Probe after Sandbox mounts so the CTA appears without
   * requiring the buyer to open the Venmo tile first.
   */
  private async probeVenmoWebViewEligibility(): Promise<void> {
    if (
      !Capacitor.isNativePlatform() ||
      Capacitor.getPlatform() !== 'android' ||
      this.usingMock() ||
      !isHttpsSandboxCheckoutUrl(smokeEnv.venmoSandboxCheckoutUrl)
    ) {
      return;
    }

    for (let i = 0; i < 20; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, i === 0 ? 800 : 500));
      const paypal = (
        globalThis as unknown as {
          paypal?: {
            Buttons?: (options: Record<string, unknown>) => { isEligible?: () => boolean };
          };
        }
      ).paypal;
      if (!paypal?.Buttons) {
        continue;
      }
      try {
        const buttons = paypal.Buttons({
          fundingSource: 'venmo',
          createOrder: async () => '',
          onApprove: async () => undefined,
        });
        if (typeof buttons.isEligible === 'function' && !buttons.isEligible()) {
          this.venmoIneligible = true;
          this.refreshVenmoChromeFallbackVisibility();
          this.pushLog('venmo WebView isEligible=false — Chrome fallback available');
        } else {
          this.pushLog('venmo WebView isEligible=true — Chrome fallback not needed');
        }
        return;
      } catch {
        // SDK may throw before full init; keep polling.
      }
    }
  }

  private async wireAppResumeForVenmoDismiss(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      this.appStateSub = await App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          return;
        }
        // App Link may arrive slightly after resume — wait before treating as dismiss.
        if (this.resumeDismissTimer) {
          clearTimeout(this.resumeDismissTimer);
        }
        this.resumeDismissTimer = setTimeout(() => {
          this.resumeDismissTimer = null;
          this.maybeDismissVenmoChromeFallback();
        }, 5000);
      });
    } catch {
      // Web shim / older plugin
    }
  }

  private maybeDismissVenmoChromeFallback(): void {
    const pending = readVenmoFallbackPending();
    if (!pending) {
      return;
    }
    // Ignore very fresh opens — App Link / Chrome handoff can resume the app briefly.
    if (Date.now() - pending.openedAt < 3_000) {
      return;
    }
    // Still pending after resume and no App Link consumed it → buyer closed Chrome.
    this.pushLog(`venmo chrome fallback dismissed attempt=${pending.attemptId}`);
    this.lastEvent.set('venmo:chrome-dismissed');
    clearVenmoFallbackPending();
  }

  private async handleVenmoChromeFallbackReturn(detail: VenmoFallbackReturnDetail): Promise<void> {
    if (this.resumeDismissTimer) {
      clearTimeout(this.resumeDismissTimer);
      this.resumeDismissTimer = null;
    }

    const pending = readVenmoFallbackPending();
    if (pending && pending.attemptId !== detail.attemptId) {
      this.pushLog(`venmo fallback stale return attempt=${detail.attemptId}`);
      return;
    }

    if (detail.result === 'cancelled') {
      clearVenmoFallbackPending();
      this.lastEvent.set('cancel:venmo');
      this.pushLog(`venmo chrome fallback cancelled attempt=${detail.attemptId}`);
      return;
    }

    // Approved path — App Link is not proof. Reconcile attempt↔order via Nest complete
    // (server-side capture when needed, idempotent), then require COMPLETED.
    const orderId = detail.orderId ?? pending?.orderId ?? null;
    if (!orderId) {
      clearVenmoFallbackPending();
      this.lastEvent.set('error:venmo-missing-order');
      this.pushLog('venmo chrome fallback approved without order id — ignored');
      return;
    }

    const attemptKey = detail.attemptId.toLowerCase();
    if (this.venmoVerifiedSuccessAttempts.has(attemptKey)) {
      this.pushLog(`venmo chrome fallback duplicate success ignored attempt=${detail.attemptId}`);
      clearVenmoFallbackPending();
      return;
    }

    this.pushLog(`venmo handoff complete+verify attempt=${detail.attemptId}`);
    try {
      const completed = await this.completeVenmoHandoff(detail.attemptId, orderId);
      if (!isVerifiedVenmoCaptureStatus(completed.status)) {
        this.lastEvent.set('error:venmo-unverified');
        this.pushLog(
          `venmo handoff unverified status=${completed.status} (App Link ignored)`,
        );
        clearVenmoFallbackPending();
        return;
      }
      // Mark before UI update so a repeated App Link cannot emit a second success.
      this.venmoVerifiedSuccessAttempts.add(attemptKey);
      clearVenmoFallbackPending();
      this.lastEvent.set('success:venmo');
      this.pushLog(
        `success venmo ${completed.captureId ?? orderId} (verified ${completed.status}${completed.idempotent ? ', idempotent' : ''})`,
      );
    } catch (error) {
      clearVenmoFallbackPending();
      this.lastEvent.set('error:venmo-verify');
      const message = error instanceof Error ? error.message : 'verify failed';
      this.pushLog(`venmo handoff complete failed: ${message}`);
    }
  }

  private async createVenmoHandoff(
    attemptId: string,
    nativeReturn: string,
  ): Promise<{
    orderId: string;
    status: string;
    approvalUrl: string | null;
    handoff: 'approval_url' | 'official_button';
    links: Array<{ rel: string; href: string }>;
    product: { name: string; amount: string; currency: string };
  }> {
    const base = this.resolveSmokeBackendBaseUrl().replace(/\/$/, '');
    const url = `${base}/api/payments/paypal/venmo/handoff`;
    const returnUrl = new URL(nativeReturn.trim());
    returnUrl.search = '';
    returnUrl.hash = '';
    returnUrl.searchParams.set('ep_method', 'venmo');
    returnUrl.searchParams.set('ep_attempt', attemptId);
    returnUrl.searchParams.set('ep_result', 'approved');
    const cancelUrl = new URL(returnUrl.toString());
    cancelUrl.searchParams.set('ep_result', 'cancelled');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        attemptId,
        productId: SMOKE_PRODUCT.id,
        quantity: SMOKE_PRODUCT.quantity ?? 1,
        returnUrl: returnUrl.toString(),
        cancelUrl: cancelUrl.toString(),
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`handoff HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
    }
    return (await response.json()) as {
      orderId: string;
      status: string;
      approvalUrl: string | null;
      handoff: 'approval_url' | 'official_button';
      links: Array<{ rel: string; href: string }>;
      product: { name: string; amount: string; currency: string };
    };
  }

  private async completeVenmoHandoff(
    attemptId: string,
    orderId: string,
  ): Promise<{ status: string; captureId?: string; idempotent?: boolean }> {
    const base = this.resolveSmokeBackendBaseUrl().replace(/\/$/, '');
    const url = `${base}/api/payments/paypal/venmo/complete`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ attemptId, orderId }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`complete HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
    }
    const body = (await response.json()) as {
      status?: string;
      captureId?: string;
      idempotent?: boolean;
    };
    return {
      status: body.status ?? 'UNKNOWN',
      captureId: body.captureId,
      idempotent: body.idempotent,
    };
  }

  private resolveSmokeBackendBaseUrl(): string {
    const configured = smokeEnv.backendBaseUrl?.trim() ?? '';
    if (
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === 'android' &&
      (configured.includes('127.0.0.1') || configured.includes('localhost'))
    ) {
      return configured.replace('127.0.0.1', '10.0.2.2').replace('localhost', '10.0.2.2');
    }
    if (configured) {
      return configured;
    }
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
      ? 'http://10.0.2.2:3001'
      : 'http://127.0.0.1:3001';
  }

  private async mountHeadless(): Promise<void> {
    this.teardownHeadless();
    // Surface switch + viewChild need a paint before #headlessHost exists.
    let host: HTMLElement | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, attempt === 0 ? 0 : 50));
      host = this.headlessHost()?.nativeElement;
      if (host) {
        break;
      }
    }
    if (!host) {
      this.pushLog('headless: host not ready');
      return;
    }
    host.replaceChildren();
    const session = this.headlessApi.createSession({
      product: this.product,
      methods: this.methods,
      checkout: this.checkout,
      checkoutInstanceId: 'ionic-smoke-headless',
      locale: this.locale(),
    });
    this.headlessSession = session;
    this.headlessSubs.add(session.events.success.subscribe((r: PaymentResult) => this.onSuccess(r)));
    this.headlessSubs.add(session.events.cancel.subscribe((r: PaymentResult) => this.onCancel(r)));
    this.headlessSubs.add(session.events.error.subscribe((e: PaymentError) => this.onError(e)));
    await session.initialize();
    const statuses = session.availableMethods();
    // Prefer wallet-style mock methods (clickable DEMO control). Card/Klarna/Affirm
    // are confirm()-style panels without a buyer button.
    const walletMock = new Set(['paypal', 'venmo', 'google-pay', 'apple-pay']);
    const preferred =
      statuses.find(
        (s: HeadlessMethodStatus) => s.available && walletMock.has(s.method),
      )?.method ??
      statuses.find((s: HeadlessMethodStatus) => s.method === 'card' && s.available)?.method ??
      statuses.find((s: HeadlessMethodStatus) => s.available)?.method;
    if (!preferred) {
      this.pushLog('headless: no available methods');
      return;
    }
    await session.mount(preferred, host);
    this.pushLog(`headless mounted ${preferred}`);
  }

  private teardownHeadless(): void {
    this.headlessSubs.unsubscribe();
    this.headlessSubs = new Subscription();
    if (this.headlessSession) {
      void this.headlessSession.destroy();
      this.headlessSession = null;
    }
  }

  /**
   * Hosts must gate confirm on selected-method readiness + session state.
   * Wallet methods use SDK/DEMO buttons — not `confirm()`.
   */
  private canConfirmHeadless(): boolean {
    const session = this.headlessSession;
    if (!session) {
      return false;
    }
    const state = session.state();
    if (state !== 'ready' && state !== 'error') {
      return false;
    }
    const method = session.selectedMethod();
    if (!method) {
      return false;
    }
    if (method === 'paypal' || method === 'google-pay' || method === 'apple-pay' || method === 'venmo') {
      return false;
    }
    const status = session.availableMethods().find((entry: HeadlessMethodStatus) => entry.method === method);
    return status?.readiness === 'ready';
  }

  private async confirmHeadlessIfReady(): Promise<void> {
    if (!this.canConfirmHeadless()) {
      this.pushLog('headless confirm blocked — method/session not ready');
      return;
    }
    await this.headlessSession?.confirm();
  }

  private pushLog(line: string): void {
    const stamp = new Date().toISOString().slice(11, 19);
    this.eventLog.update((rows) => [`${stamp} ${line}`, ...rows].slice(0, 40));
  }
}
