/**
 * Zip redirect return helpers (confirm / cancel query params + pending storage).
 * Complements the JS SDK `onComplete` path when the popup falls back to a redirect.
 */

export const ZIP_RETURN_METHOD_PARAM = 'ep_zip_return';
export const ZIP_PENDING_STORAGE_KEY = 'easy_payments_zip_pending';
export const ZIP_RETURN_MODE_CONFIRM = 'confirm';
export const ZIP_RETURN_MODE_CANCEL = 'cancel';

export interface ZipPendingReturn {
  method: 'zip';
  productId: string;
  merchantReference: string;
  createdAt: number;
}

export interface ZipReturnParams {
  merchantReference: string | null;
  orderId: string | null;
  success: boolean | null;
  signature: string | null;
  mode: 'confirm' | 'cancel' | null;
  rawQuery: string;
}

function getDefaultStorage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function buildZipReturnUrl(
  mode: 'confirm' | 'cancel',
  baseUrl?: string,
  locationHref?: string,
): string {
  const href =
    baseUrl?.trim() ||
    locationHref?.trim() ||
    (typeof location !== 'undefined' ? location.href : '');
  if (!href) {
    return '';
  }
  try {
    const url = new URL(href);
    url.searchParams.set(ZIP_RETURN_METHOD_PARAM, mode);
    return url.toString();
  } catch {
    return href;
  }
}

export function readZipReturnParams(search?: string): ZipReturnParams {
  const raw =
    search ??
    (typeof location !== 'undefined' ? location.search : '') ??
    '';
  const query = raw.startsWith('?') ? raw.slice(1) : raw;
  const params = new URLSearchParams(query);
  const successRaw = (params.get('success') ?? '').toLowerCase();
  let success: boolean | null = null;
  if (successRaw === 'true' || successRaw === '1') {
    success = true;
  } else if (successRaw === 'false' || successRaw === '0') {
    success = false;
  }
  const modeRaw = params.get(ZIP_RETURN_METHOD_PARAM);
  const mode =
    modeRaw === ZIP_RETURN_MODE_CONFIRM
      ? 'confirm'
      : modeRaw === ZIP_RETURN_MODE_CANCEL
        ? 'cancel'
        : null;

  return {
    merchantReference: params.get('merchantReference'),
    orderId: params.get('orderId'),
    success,
    signature: params.get('X-QP-Signature') ?? params.get('x-qp-signature'),
    mode,
    rawQuery: query,
  };
}

export function markZipPendingReturn(
  productId: string,
  merchantReference: string,
  storage?: Storage | null,
): void {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return;
  }
  const pending: ZipPendingReturn = {
    method: 'zip',
    productId,
    merchantReference,
    createdAt: Date.now(),
  };
  try {
    store.setItem(ZIP_PENDING_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Ignore quota / private mode failures.
  }
}

export function readZipPendingReturn(storage?: Storage | null): ZipPendingReturn | null {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return null;
  }
  try {
    const raw = store.getItem(ZIP_PENDING_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as ZipPendingReturn;
    if (parsed?.method !== 'zip' || !parsed.merchantReference || !parsed.productId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearZipPendingReturn(storage?: Storage | null): void {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return;
  }
  try {
    store.removeItem(ZIP_PENDING_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function clearZipReturnParamsFromUrl(historyApi?: History, locationRef?: Location): void {
  const loc = locationRef ?? (typeof location !== 'undefined' ? location : undefined);
  const hist = historyApi ?? (typeof history !== 'undefined' ? history : undefined);
  if (!loc || !hist?.replaceState) {
    return;
  }
  try {
    const url = new URL(loc.href);
    let changed = false;
    for (const key of [
      ZIP_RETURN_METHOD_PARAM,
      'merchantReference',
      'orderId',
      'success',
      'amount',
      'currency',
      'merchantId',
      'timestamp',
      'X-QP-Signature',
      'test',
    ]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    // Nested customer.* params
    const toDelete: string[] = [];
    url.searchParams.forEach((_v, k) => {
      if (k.startsWith('customer.')) {
        toDelete.push(k);
      }
    });
    for (const k of toDelete) {
      url.searchParams.delete(k);
      changed = true;
    }
    if (changed) {
      hist.replaceState(hist.state, '', url.toString());
    }
  } catch {
    // ignore
  }
}

export function isZipReturnAttempt(search?: string, storage?: Storage | null): boolean {
  const params = readZipReturnParams(search);
  if (params.mode === 'cancel') {
    return true;
  }
  if (params.mode === 'confirm' && (params.signature || params.merchantReference)) {
    return true;
  }
  const pending = readZipPendingReturn(storage);
  return !!pending && (!!params.signature || !!params.merchantReference);
}

export function isZipCancelReturn(search?: string): boolean {
  const params = readZipReturnParams(search);
  return params.mode === 'cancel' || params.success === false;
}
