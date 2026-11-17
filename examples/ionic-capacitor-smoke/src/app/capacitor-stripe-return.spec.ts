import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  applySmokeStripeReturnSearch,
  evaluateSmokeStripeReturnUrl,
  formatSmokeStripeReturnLog,
  parseSmokeNativeReturnConfig,
  resetSmokeStripeReturnDedupeForTests,
  stripSensitiveSmokeReturnParams,
} from './capacitor-stripe-return';

const NATIVE = 'https://smoke-return.example.com/capacitor-return';

describe('capacitor-stripe-return', () => {
  beforeEach(() => {
    resetSmokeStripeReturnDedupeForTests();
  });

  it('parses a valid https native return URL', () => {
    expect(parseSmokeNativeReturnConfig(NATIVE)).toEqual({
      origin: 'https://smoke-return.example.com',
      pathname: '/capacitor-return',
      href: 'https://smoke-return.example.com/capacitor-return',
    });
  });

  it('rejects non-https native return URLs', () => {
    expect(parseSmokeNativeReturnConfig('http://smoke-return.example.com/return')).toBeNull();
  });

  it('applies a warm Stripe App Link return', () => {
    const url =
      `${NATIVE}?payment_intent=pi_1` +
      `&payment_intent_client_secret=pi_1_secret_abc` +
      `&redirect_status=succeeded&ep_method=klarna&ep_attempt=abcdef1234567890`;
    const decision = evaluateSmokeStripeReturnUrl(
      url,
      { nativeReturnUrl: NATIVE },
      { pendingAttemptId: 'abcdef1234567890' },
    );
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      expect(decision.method).toBe('klarna');
      expect(decision.attemptId).toBe('abcdef1234567890');
      expect(decision.search).toContain('ep_method=klarna');
      expect(formatSmokeStripeReturnLog(decision, url)).not.toContain('secret');
    }
  });

  it('applies a cold-start launch URL with Stripe markers', () => {
    const url =
      `${NATIVE}?payment_intent=pi_cold` +
      `&payment_intent_client_secret=pi_cold_secret&ep_method=affirm&ep_attempt=coldstartattempt01`;
    const decision = evaluateSmokeStripeReturnUrl(url, { nativeReturnUrl: NATIVE });
    expect(decision).toMatchObject({
      kind: 'apply',
      method: 'affirm',
      attemptId: 'coldstartattempt01',
    });
  });

  it('deduplicates a second callback for the same attempt', () => {
    const url =
      `${NATIVE}?payment_intent=pi_1&payment_intent_client_secret=sec` +
      `&ep_method=klarna&ep_attempt=dupattempt0000001`;
    expect(evaluateSmokeStripeReturnUrl(url, { nativeReturnUrl: NATIVE }).kind).toBe('apply');
    expect(evaluateSmokeStripeReturnUrl(url, { nativeReturnUrl: NATIVE })).toEqual({
      kind: 'ignore',
      reason: 'duplicate',
    });
  });

  it('ignores an unrelated App Link path or host', () => {
    expect(
      evaluateSmokeStripeReturnUrl('https://smoke-return.example.com/other?ep_method=klarna', {
        nativeReturnUrl: NATIVE,
      }),
    ).toEqual({ kind: 'ignore', reason: 'unrelated' });

    expect(
      evaluateSmokeStripeReturnUrl(
        'https://evil.example/capacitor-return?payment_intent=pi_1&ep_method=klarna',
        { nativeReturnUrl: NATIVE },
      ),
    ).toEqual({ kind: 'ignore', reason: 'unrelated' });
  });

  it('ignores a mismatched pending attempt id', () => {
    const url = `${NATIVE}?ep_method=klarna&ep_attempt=aaaaaaaaaaaaaaaa&payment_intent=pi_1`;
    expect(
      evaluateSmokeStripeReturnUrl(url, { nativeReturnUrl: NATIVE }, {
        pendingAttemptId: 'bbbbbbbbbbbbbbbb',
      }),
    ).toEqual({ kind: 'ignore', reason: 'unrelated' });
  });

  it('merges search onto the WebView location and strips secrets', () => {
    const hrefStore = { value: 'https://localhost/home' };
    const replaceState = vi.fn((_s: unknown, _t: unknown, url: string) => {
      hrefStore.value = `https://localhost${url}`;
    });
    const dispatchEvent = vi.fn();
    const timeouts: Array<() => void> = [];
    const fakeWin = {
      location: {
        get href() {
          return hrefStore.value;
        },
      },
      history: { replaceState },
      dispatchEvent,
      setTimeout: (fn: () => void) => {
        timeouts.push(fn);
        return 1;
      },
    } as unknown as Window;

    applySmokeStripeReturnSearch(
      '?payment_intent=pi_1&payment_intent_client_secret=sec_x&ep_method=klarna&ep_attempt=abc',
      fakeWin,
      { stripDelayMs: 0 },
    );

    expect(replaceState).toHaveBeenCalled();
    expect(String(replaceState.mock.calls[0]?.[2])).toContain('payment_intent_client_secret=sec_x');
    expect(dispatchEvent).toHaveBeenCalled();
    timeouts[0]?.();
    const lastUrl = String(replaceState.mock.calls.at(-1)?.[2] ?? '');
    expect(lastUrl).not.toContain('client_secret');
    expect(lastUrl).not.toContain('ep_method');
  });

  it('stripSensitiveSmokeReturnParams removes Stripe return query keys', () => {
    const hrefStore = {
      value:
        'https://localhost/home?payment_intent=pi_1&payment_intent_client_secret=sec&redirect_status=succeeded&ep_method=klarna&ep_attempt=a1&keep=1',
    };
    const fakeWin = {
      location: {
        get href() {
          return hrefStore.value;
        },
      },
      history: {
        replaceState: (_s: unknown, _t: unknown, url: string) => {
          hrefStore.value = `https://localhost${url}`;
        },
      },
    } as unknown as Window;
    stripSensitiveSmokeReturnParams(fakeWin);
    expect(hrefStore.value).toContain('keep=1');
    expect(hrefStore.value).not.toContain('client_secret');
    expect(hrefStore.value).not.toContain('redirect_status');
    expect(hrefStore.value).not.toContain('ep_method');
  });
});
