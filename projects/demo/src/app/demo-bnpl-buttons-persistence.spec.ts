import {
  DEMO_BNPL_BUTTONS_STORAGE_KEY,
  DEMO_BNPL_TEST_SAMPLE,
  defaultDemoBnplButtonsState,
  persistDemoBnplButtons,
  readPersistedDemoBnplButtons,
} from './demo-bnpl-buttons-persistence';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}

describe('demo-bnpl-buttons-persistence', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it('defaults to element mode with empty customer fields', () => {
    const state = readPersistedDemoBnplButtons(storage);
    expect(state.bnplConfirmMode).toBe('element');
    expect(state.customerEmail).toBe('');
    expect(state).toEqual(defaultDemoBnplButtonsState());
  });

  it('persists and restores mode + TEST customer fields without secrets', () => {
    persistDemoBnplButtons(
      {
        bnplConfirmMode: 'auto',
        ...DEMO_BNPL_TEST_SAMPLE,
      },
      storage,
    );
    const raw = storage.getItem(DEMO_BNPL_BUTTONS_STORAGE_KEY) ?? '';
    expect(raw).not.toContain('sk_');
    expect(raw).not.toContain('client_secret');
    expect(raw).not.toContain('pi_');

    const restored = readPersistedDemoBnplButtons(storage);
    expect(restored.bnplConfirmMode).toBe('auto');
    expect(restored.customerEmail).toBe(DEMO_BNPL_TEST_SAMPLE.customerEmail);
    expect(restored.billingCountry).toBe('US');
  });

  it('falls back to element for invalid stored mode', () => {
    storage.setItem(
      DEMO_BNPL_BUTTONS_STORAGE_KEY,
      JSON.stringify({ bnplConfirmMode: 'instant', customerEmail: 'x@example.com' }),
    );
    const state = readPersistedDemoBnplButtons(storage);
    expect(state.bnplConfirmMode).toBe('element');
    expect(state.customerEmail).toBe('x@example.com');
  });
});
