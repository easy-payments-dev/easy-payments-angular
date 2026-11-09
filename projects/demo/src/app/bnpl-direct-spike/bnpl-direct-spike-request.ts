import { HttpErrorResponse } from '@angular/common/http';
import { InjectionToken } from '@angular/core';

export type SpikeBnplProvider = 'klarna' | 'affirm';

/** Demo environment shape used by the BNPL Direct spike (overrideable in unit tests). */
export interface BnplSpikeEnvironment {
  stripePublishableKey: string;
  backendBaseUrl: string;
  klarnaCreatePaymentUrl: string;
  affirmCreatePaymentUrl: string;
}

export const BNPL_SPIKE_ENVIRONMENT = new InjectionToken<BnplSpikeEnvironment>(
  'BNPL_SPIKE_ENVIRONMENT',
);

export interface SpikeCreateBnplPaymentBody {
  provider: SpikeBnplProvider;
  productId: string;
  quantity: number;
  currency: string;
  metadata?: Record<string, string>;
}

/**
 * Builds the Klarna/Affirm create-PaymentIntent body for the demo spike.
 *
 * Must never include reserved merchant-metadata keys (e.g. `source`, `paymentMethod`,
 * `productId`, `amount`). The Nest backend owns those via mergePaymentIntentMetadata.
 */
export function buildCreateBnplPaymentBody(input: {
  provider: SpikeBnplProvider;
  productId: string;
  quantity: number;
  currency: string;
}): SpikeCreateBnplPaymentBody {
  const quantity =
    Number.isFinite(input.quantity) && input.quantity >= 1 ? Math.floor(input.quantity) : 1;

  return {
    provider: input.provider,
    productId: input.productId.trim() || 'premium-plan',
    quantity,
    currency: (input.currency || 'USD').trim().toUpperCase(),
    // Allowed merchant-style keys only (same pattern as the main demo playground).
    metadata: {
      orderId: 'SPIKE-H6241',
      customerReference: 'SPIKE-TEST',
    },
  };
}

/**
 * Formats HttpClient / Nest validation failures for the spike UI.
 * Never echoes client secrets, auth headers, or raw payloads.
 */
export function formatSpikeFailure(err: unknown, phase: 'backend' | 'stripe' | 'spike' = 'spike'): string {
  if (err instanceof HttpErrorResponse) {
    const publicMessage = extractPublicHttpMessage(err);
    return `Backend HTTP ${err.status}: ${publicMessage}`;
  }

  if (err instanceof Error) {
    const message = sanitizePublicText(err.message) || 'Unknown error';
    if (phase === 'stripe') {
      return `Stripe confirm error: ${message}`;
    }
    if (phase === 'backend') {
      return `Backend error: ${message}`;
    }
    return `Spike failed: ${message}`;
  }

  return 'Spike failed: Unknown error';
}

function extractPublicHttpMessage(err: HttpErrorResponse): string {
  const body = err.error;
  if (typeof body === 'string') {
    return sanitizePublicText(body) || statusFallback(err.status);
  }
  if (body && typeof body === 'object') {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') {
      return sanitizePublicText(message) || statusFallback(err.status);
    }
    if (Array.isArray(message)) {
      const joined = message
        .filter((part): part is string => typeof part === 'string')
        .map((part) => sanitizePublicText(part))
        .filter((part): part is string => !!part)
        .join('; ');
      return joined || statusFallback(err.status);
    }
  }
  return statusFallback(err.status);
}

function statusFallback(status: number): string {
  if (status === 400) {
    return 'Bad Request';
  }
  if (status === 0) {
    return 'Network error or backend unreachable.';
  }
  return 'Request failed.';
}

/** Drops obvious secret-like content from operator-facing messages. */
function sanitizePublicText(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (
    /client[_-]?secret|sk_(test|live)_|pk_(test|live)_|Bearer\s|authorization\s*:/i.test(trimmed)
  ) {
    return null;
  }
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

export function describeSpikeConfig(env: BnplSpikeEnvironment): {
  notes: string[];
  blockers: string[];
} {
  const notes: string[] = [];
  const blockers: string[] = [];

  const pk = env.stripePublishableKey?.trim() ?? '';
  if (!pk) {
    const msg = 'Missing stripePublishableKey in demo environment.';
    notes.push(msg);
    blockers.push(msg);
  } else if (!/^pk_test_/i.test(pk)) {
    const msg = 'stripePublishableKey must be a Stripe TEST publishable key (pk_test_...).';
    notes.push(msg);
    blockers.push(msg);
  } else {
    notes.push('Stripe TEST publishable key present (value not shown).');
  }

  const base = env.backendBaseUrl?.trim() ?? '';
  const klarnaUrl = env.klarnaCreatePaymentUrl?.trim() ?? '';
  const affirmUrl = env.affirmCreatePaymentUrl?.trim() ?? '';

  if (!klarnaUrl) {
    const msg = 'klarnaCreatePaymentUrl is missing.';
    notes.push(msg);
    blockers.push(msg);
  }
  if (!affirmUrl) {
    const msg = 'affirmCreatePaymentUrl is missing.';
    notes.push(msg);
    blockers.push(msg);
  }

  if (!base) {
    const klarnaAbsolute = /^https?:\/\//i.test(klarnaUrl);
    const affirmAbsolute = /^https?:\/\//i.test(affirmUrl);
    if (klarnaAbsolute && affirmAbsolute) {
      notes.push('backendBaseUrl empty; using absolute create URLs.');
    } else {
      const msg = 'backendBaseUrl is empty and create URLs are not absolute.';
      notes.push(msg);
      blockers.push(msg);
    }
  } else {
    notes.push(`Backend base: ${base}`);
  }

  notes.push('Catalog product default: premium-plan / USD / qty 1 (server-priced).');
  notes.push('This page never mounts Stripe Payment Element.');
  return { notes, blockers };
}

export function resolveSpikeCreateUrl(path: string, backendBaseUrl: string): string {
  const trimmed = path.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const base = (backendBaseUrl ?? '').replace(/\/$/, '');
  const suffix = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${base}${suffix}`;
}
