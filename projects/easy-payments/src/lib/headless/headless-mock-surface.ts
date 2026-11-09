import type { PaymentMethod } from '../models/payment-method.model';
import { PAYMENT_METHOD_LABELS } from '../models/payment-method.model';
import type { ResolvedPaymentTheme } from '../models/payment-theme.model';
import { interpolate, type EasyPaymentsTranslations } from '../i18n';
import type { HeadlessMethodStatus } from './headless.types';

/**
 * True when the Headless availability projection says this method runs on a mock adapter
 * (`enableMockMode`). Mock methods never touch Stripe.js, the PayPal SDK, wallet SDKs,
 * or any backend URL — see {@link renderHeadlessMockSurface}.
 */
export function isMockHeadlessStatus(status: HeadlessMethodStatus | undefined): boolean {
  return !!status && (status.mock === true || status.interaction === 'mock');
}

/** Wallet-style mock methods start payment from the mounted DEMO control (buyer click). */
export function isMockWalletMethod(method: PaymentMethod): boolean {
  return method === 'paypal' || method === 'google-pay' || method === 'apple-pay';
}

export interface HeadlessMockSurface {
  /** Root element appended to the merchant container. */
  readonly element: HTMLElement;
  /** Toggle the in-flight state on the DEMO control (wallet methods only). */
  setBusy(busy: boolean): void;
  /** Remove the surface from the container. Idempotent. */
  destroy(): void;
}

export interface HeadlessMockSurfaceOptions {
  method: PaymentMethod;
  theme: ResolvedPaymentTheme;
  messages: EasyPaymentsTranslations;
  /**
   * Buyer activation for wallet-style methods (PayPal / Google Pay / Apple Pay).
   * Omitted for confirm-style methods (card / klarna / affirm), which the merchant
   * confirms through `session.confirm()`.
   */
  onActivate?: () => void;
}

/**
 * Renders a DEMO consumer surface into a merchant-owned container.
 *
 * - Confirm-style methods: a non-interactive DEMO panel (merchant CTA calls `confirm()`).
 * - Wallet-style methods: a compact DEMO button with the same default sizing tokens as the
 *   Buttons Only mock strip (`--ep-buttons-height` / `--ep-buttons-width`, 40px default).
 *
 * Uses DOM APIs with `textContent` only. No SDKs, no network.
 */
export function renderHeadlessMockSurface(
  container: HTMLElement,
  options: HeadlessMockSurfaceOptions,
): HeadlessMockSurface {
  const { method, theme, messages, onActivate } = options;
  const doc = container.ownerDocument;
  const label = method === 'card' ? messages.methodCard : PAYMENT_METHOD_LABELS[method];
  const dark = theme === 'dark';
  const text = dark ? '#f8fafc' : '#0f172a';
  const secondary = dark ? '#94a3b8' : '#64748b';
  const surface = dark ? '#1e293b' : '#ffffff';
  const border = dark ? '#334155' : '#e2e8f0';

  const root = doc.createElement('div');
  root.setAttribute('data-easy-headless-mock', method);
  root.setAttribute('data-testid', 'easy-headless-mock');
  root.style.cssText = [
    'box-sizing:border-box',
    'font-family:var(--ep-font-family, inherit)',
    `color:var(--ep-text, ${text})`,
  ].join(';');

  let button: HTMLButtonElement | null = null;
  let busyLabel: HTMLSpanElement | null = null;
  let idleNodes: HTMLElement[] = [];

  const badge = (): HTMLSpanElement => {
    const el = doc.createElement('span');
    el.textContent = 'DEMO';
    el.setAttribute('data-testid', 'easy-headless-mock-badge');
    el.style.cssText = [
      'display:inline-block',
      'padding:1px 6px',
      'border-radius:999px',
      'font-size:10px',
      'font-weight:700',
      'letter-spacing:0.06em',
      `color:var(--ep-text-secondary, ${secondary})`,
      `border:1px solid var(--ep-border, ${border})`,
    ].join(';');
    return el;
  };

  if (onActivate && isMockWalletMethod(method)) {
    button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('data-testid', 'easy-headless-mock-pay');
    button.setAttribute('aria-label', interpolate(messages.demoWalletButtonAria, { method: label }));
    button.style.cssText = [
      'box-sizing:border-box',
      'display:inline-flex',
      'align-items:center',
      'justify-content:center',
      'gap:8px',
      'width:var(--ep-buttons-width, 100%)',
      'min-width:var(--ep-buttons-min-width, 100px)',
      'height:var(--ep-buttons-height, 40px)',
      'min-height:var(--ep-buttons-height, 40px)',
      'padding:0 12px',
      `border:var(--ep-buttons-border-width, 1px) solid var(--ep-buttons-border-color, var(--ep-border, ${border}))`,
      `border-radius:var(--ep-buttons-radius, var(--ep-radius-md, 10px))`,
      `background:var(--ep-surface, ${surface})`,
      `color:var(--ep-text, ${text})`,
      'font:inherit',
      'font-weight:600',
      'cursor:pointer',
    ].join(';');

    const name = doc.createElement('span');
    name.textContent = label;
    idleNodes = [name, badge()];
    for (const node of idleNodes) {
      button.appendChild(node);
    }

    busyLabel = doc.createElement('span');
    busyLabel.textContent = messages.processingPayment;
    busyLabel.hidden = true;
    button.appendChild(busyLabel);

    button.addEventListener('click', () => {
      if (button?.disabled) {
        return;
      }
      onActivate();
    });
    root.appendChild(button);
  } else {
    root.style.cssText += [
      ';display:flex',
      'flex-direction:column',
      'gap:6px',
      'padding:12px 14px',
      `border:1px solid var(--ep-border, ${border})`,
      `border-radius:var(--ep-radius-md, 10px)`,
      `background:var(--ep-surface, ${surface})`,
    ].join(';');

    const header = doc.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;font-weight:650';
    const title = doc.createElement('span');
    title.textContent = interpolate(messages.payWithMethod, { method: label });
    header.append(title, badge());

    const hint = doc.createElement('p');
    hint.textContent = messages.demoCheckoutHint;
    hint.style.cssText = `margin:0;font-size:13px;color:var(--ep-text-secondary, ${secondary})`;

    root.append(header, hint);
  }

  container.appendChild(root);

  let destroyed = false;
  return {
    element: root,
    setBusy(busy: boolean): void {
      if (!button || destroyed) {
        return;
      }
      button.disabled = busy;
      button.setAttribute('aria-busy', String(busy));
      button.style.opacity = busy ? '0.6' : '';
      button.style.cursor = busy ? 'not-allowed' : 'pointer';
      for (const node of idleNodes) {
        node.hidden = busy;
      }
      if (busyLabel) {
        busyLabel.hidden = !busy;
      }
    },
    destroy(): void {
      if (destroyed) {
        return;
      }
      destroyed = true;
      root.remove();
    },
  };
}
