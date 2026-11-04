/**
 * Demo playground experience persistence (session-scoped).
 * Survives reloads and Klarna/Affirm redirect round-trips in the same tab.
 * Does not store secrets, PaymentIntents, ownership markers, or provider tokens.
 */

export const DEMO_EXPERIENCE_STORAGE_KEY = 'easy-payments-demo-experience';

export type DemoPlaygroundExperience = 'checkout' | 'buttons' | 'headless';

const ALLOWED: readonly DemoPlaygroundExperience[] = ['checkout', 'buttons', 'headless'];

export function readPersistedDemoExperience(storage?: Storage): DemoPlaygroundExperience | null {
  const store =
    storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!store || typeof store.getItem !== 'function') {
    return null;
  }
  try {
    const value = store.getItem(DEMO_EXPERIENCE_STORAGE_KEY);
    return value && (ALLOWED as readonly string[]).includes(value)
      ? (value as DemoPlaygroundExperience)
      : null;
  } catch {
    return null;
  }
}

export function persistDemoExperience(
  experience: DemoPlaygroundExperience,
  storage?: Storage,
): void {
  const store =
    storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!store || typeof store.setItem !== 'function') {
    return;
  }
  try {
    store.setItem(DEMO_EXPERIENCE_STORAGE_KEY, experience);
  } catch {
    // Ignore quota / private-mode failures — experience still works in-memory.
  }
}

export function clearPersistedDemoExperience(storage?: Storage): void {
  const store =
    storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!store || typeof store.removeItem !== 'function') {
    return;
  }
  try {
    store.removeItem(DEMO_EXPERIENCE_STORAGE_KEY);
  } catch {
    // ignore
  }
}
