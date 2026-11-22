# Practical payment event examples

Compilable Angular patterns for **Buttons Only** and **Headless** using exported types.
Full Checkout uses the same `(success)` / `(cancel)` / `(error)` / `(pending)` outputs on
`<easy-payments>` (see [api.md](../api.md#payment-lifecycle-events)).

**Host owns** navigation, notifications, and business decisions. Frontend events are **not**
proof of capture or fulfillment — confirm on your backend / webhooks before marking an order paid.

Do not introduce a toast library dependency. Prefer an application-owned banner, dialog, or route.

## Buttons Only

```ts
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  EasyPaymentButtonsComponent,
  PaymentError,
  localizePaymentError,
  resolveEffectiveLocale,
  resolveMessages,
  isHeadlessPaymentRetryAllowed,
  type PaymentProduct,
  type PaymentResult,
} from '@easy-payments/angular';

@Component({
  selector: 'app-buttons-checkout',
  standalone: true,
  imports: [EasyPaymentButtonsComponent],
  template: `
    <easy-payment-buttons
      [product]="product"
      [methods]="['card', 'paypal', 'alipay']"
      [layout]="'horizontal'"
      (success)="onSuccess($event)"
      (cancel)="onCancel($event)"
      (error)="onError($event)"
      (pending)="onPending($event)"
    />

    @if (notice(); as n) {
      <aside role="status" aria-live="polite">
        <strong>{{ n.title }}</strong>
        <p>{{ n.body }}</p>
        @if (n.canRetry) {
          <button type="button" (click)="clearNotice()">Try another method</button>
        }
      </aside>
    }
  `,
})
export class ButtonsCheckoutComponent {
  private readonly router = inject(Router);

  readonly product: PaymentProduct = {
    id: 'sku_1',
    name: 'Plan',
    amount: 29,
    currency: 'USD',
  };

  readonly notice = signal<{
    title: string;
    body: string;
    canRetry: boolean;
  } | null>(null);

  onSuccess(result: PaymentResult): void {
    // UX only — verify capture/fulfillment on your backend before unlocking goods.
    this.notice.set({
      title: 'Payment received',
      body: `${result.method} succeeded. Confirming order…`,
      canRetry: false,
    });
    void this.router.navigateByUrl('/orders/confirm'); // application-owned route
  }

  onCancel(result: PaymentResult): void {
    this.notice.set({
      title: 'Payment cancelled',
      body: `${result.method} was cancelled. You can choose another method.`,
      canRetry: true,
    });
  }

  onError(error: PaymentError): void {
    const messages = resolveMessages(resolveEffectiveLocale('auto'));
    const body = localizePaymentError(error.code, messages, { method: error.method });
    const canRetry = isHeadlessPaymentRetryAllowed('error', error);
    this.notice.set({
      title: messages.errorTitle,
      body: `${error.code} — ${body}`,
      canRetry,
    });
  }

  onPending(result: PaymentResult): void {
    this.notice.set({
      title: 'Payment pending',
      body: `${result.method} is still processing. Do not pay again — await webhook reconciliation.`,
      canRetry: false,
    });
  }

  clearNotice(): void {
    this.notice.set(null);
  }
}
```

Template `(success)` / `(cancel)` / `(error)` / `(pending)` bindings do not allocate RxJS
subscriptions. When you subscribe to Headless `session.events.*` Observables instead, use
`takeUntilDestroyed()` (or unsubscribe in `ngOnDestroy`) as in the Headless example below.

Buttons Only does **not** show an inline library success banner and does **not** navigate for you.

## Headless

Headless does not render checkout chrome. The markup below is **host-owned example UI**
built from optional `describeHeadlessUi` helpers — not a library status panel. Hosts that
prefer raw `session.state()` / `lastError()` / events may skip the helpers entirely.

```ts
import { Component, DestroyRef, OnDestroy, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EasyPaymentsHeadless,
  describeHeadlessUi,
  resolveEffectiveLocale,
  resolveMessages,
  type HeadlessCheckoutSession,
  type PaymentResult,
} from '@easy-payments/angular';

@Component({
  selector: 'app-headless-events',
  template: `
    <!-- Example consumer UI — optional; Headless never injects this -->
    @if (presentation(); as ui) {
      <section [attr.data-kind]="ui.kind">
        <h2>{{ ui.title }}</h2>
        <p>{{ ui.body }}</p>
        <p>Recovery: {{ ui.recoveryAction }}</p>
      </section>
    }
  `,
})
export class HeadlessEventsComponent implements OnDestroy {
  private readonly headless = inject(EasyPaymentsHeadless);
  private readonly destroyRef = inject(DestroyRef);

  private session: HeadlessCheckoutSession | null = null;
  readonly presentation = signal(describeHeadlessUi({
    state: 'idle',
    messages: resolveMessages(resolveEffectiveLocale('auto')),
  }));

  async ngOnInit(): Promise<void> {
    const messages = () => resolveMessages(resolveEffectiveLocale('auto'));
    const session = this.headless.createSession({
      product: { id: 'sku_1', name: 'Plan', amount: 20, currency: 'USD' },
      methods: ['card', 'paypal'],
      checkoutInstanceId: 'merchant-checkout-id',
      locale: 'auto',
    });
    this.session = session;

    const refreshUi = (): void => {
      this.presentation.set(
        describeHeadlessUi({
          state: session.state(),
          messages: messages(),
          lastError: session.lastError(),
          lastResult: session.lastResult(),
        }),
      );
    };

    session.events.success.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      refreshUi();
      void this.onSuccess(result);
    });
    session.events.cancel.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => refreshUi());
    session.events.error.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => refreshUi());
    session.events.pending.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      refreshUi();
      // pending ≠ success — reconcile on backend; do not confirm again for this attempt
    });

    await session.initialize();
    refreshUi();
  }

  private async onSuccess(_result: PaymentResult): Promise<void> {
    // Optional host navigation to an application-owned confirmation page.
    // Still verify webhooks before fulfillment.
  }

  async ngOnDestroy(): Promise<void> {
    await this.session?.destroy();
  }
}
```

### Locale switching

Pass a new `messages` object from `resolveMessages(locale)` into `describeHeadlessUi` /
`localizePaymentError`. That updates buyer copy **without** recreating the session, creating a
payment, or re-emitting outcome events.

### Recovery cheat sheet

| Situation | Safe host action |
|-----------|------------------|
| `pending` / processing | Reconcile via backend; block another charge |
| `CONFIG_MISSING` / `CONFIG_INVALID` | Choose another method — **no** payment retry |
| `NETWORK_ERROR` / `SDK_LOAD_FAILED` on `recoverReturn()` | Call `recoverReturn()` again (no new PaymentIntent) |
| `CARD_DECLINED` / `PAYMENT_FAILED` after confirm | Host may offer another attempt after the failure settles |
| `AUTHENTICATION_REQUIRED` | Continue customer action on the existing Intent — not a duplicate charge |

## Full Checkout (shared events)

`<easy-payments>` exposes the same lifecycle outputs. When `successBehavior` is `confirmation`,
the library may show a built-in success screen and emit `successContinue` when the buyer clicks
Continue. Buttons Only never gains that inline banner; Headless never owns chrome for it.
