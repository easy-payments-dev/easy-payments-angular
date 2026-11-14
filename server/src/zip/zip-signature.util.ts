import { createHmac, timingSafeEqual } from 'crypto';

export const ZIP_SIGNATURE_HEADER = 'X-QP-Signature';

/** HMAC-SHA256 (Base64) over a UTF-8 JSON body string — Zip POST JSON signing. */
export function signZipJsonBody(secret: string, jsonBody: string): string {
  return createHmac('sha256', secret).update(jsonBody, 'utf8').digest('base64');
}

/**
 * HMAC-SHA256 (Base64) for GET / form params: sort keys alphabetically,
 * concatenate key+value, exclude X-QP-Signature.
 */
export function signZipKeyValues(
  secret: string,
  values: Record<string, string>,
): string {
  const keys = Object.keys(values).sort((a, b) => a.localeCompare(b));
  let data = '';
  for (const key of keys) {
    if (key.toLowerCase() === ZIP_SIGNATURE_HEADER.toLowerCase()) {
      continue;
    }
    data += key;
    data += values[key] ?? '';
  }
  return createHmac('sha256', secret).update(data, 'utf8').digest('base64');
}

/** Parse a query string (with or without leading `?`) into a flat string map. */
export function parseZipQueryParams(query: string): Record<string, string> {
  const raw = query.startsWith('?') ? query.slice(1) : query;
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}

export function verifyZipSignature(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyZipJsonBody(
  secret: string,
  jsonBody: string,
  providedSignature: string,
): boolean {
  const expected = signZipJsonBody(secret, jsonBody);
  return verifyZipSignature(expected, providedSignature.trim());
}

export function verifyZipQueryString(
  secret: string,
  query: string,
): { valid: boolean; params: Record<string, string>; signature: string } {
  const params = parseZipQueryParams(query);
  const signature =
    params[ZIP_SIGNATURE_HEADER] ??
    params['x-qp-signature'] ??
    params['X-Qp-Signature'] ??
    '';
  if (!signature) {
    return { valid: false, params, signature: '' };
  }
  const expected = signZipKeyValues(secret, params);
  return {
    valid: verifyZipSignature(expected, signature),
    params,
    signature,
  };
}
