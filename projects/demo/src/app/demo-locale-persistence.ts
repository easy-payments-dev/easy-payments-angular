/**
 * Demo playground locale persistence (session-scoped).
 * Survives reloads and provider redirect round-trips in the same tab.
 * Does not store secrets. Not part of the core library public API.
 */

import type { EasyPaymentsLocale } from '@easy-payments/angular';

export const DEMO_LOCALE_STORAGE_KEY = 'easy-payments-demo-locale';

const ALLOWED: readonly EasyPaymentsLocale[] = ['auto', 'en', 'es', 'pt', 'fr'];

export function readPersistedDemoLocale(storage?: Storage): EasyPaymentsLocale | null {
  const store =
    storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!store || typeof store.getItem !== 'function') {
    return null;
  }
  try {
    const value = store.getItem(DEMO_LOCALE_STORAGE_KEY);
    return value && (ALLOWED as readonly string[]).includes(value)
      ? (value as EasyPaymentsLocale)
      : null;
  } catch {
    return null;
  }
}

export function persistDemoLocale(locale: EasyPaymentsLocale, storage?: Storage): void {
  const store =
    storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!store || typeof store.setItem !== 'function') {
    return;
  }
  try {
    store.setItem(DEMO_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore quota / private-mode failures — locale still works in-memory.
  }
}

export function clearPersistedDemoLocale(storage?: Storage): void {
  const store =
    storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!store || typeof store.removeItem !== 'function') {
    return;
  }
  try {
    store.removeItem(DEMO_LOCALE_STORAGE_KEY);
  } catch {
    // ignore
  }
}
