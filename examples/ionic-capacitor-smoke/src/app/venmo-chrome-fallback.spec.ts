import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildVenmoChromeCheckoutUrl,
  buildVenmoFallbackAppLink,
  createVenmoFallbackAttemptId,
  evaluateVenmoChromeFallbackReturn,
  isHttpsSandboxCheckoutUrl,
  isVerifiedVenmoCaptureStatus,
  resetVenmoFallbackDedupeForTests,
  writeVenmoFallbackPending,
  readVenmoFallbackPending,
  clearVenmoFallbackPending,
} from './venmo-chrome-fallback';

const RETURN = 'https://www.easy-payments.dev/capacitor-return';
const CHECKOUT = 'https://direction-statistics-anna-smoke.trycloudflare.com/';

describe('venmo-chrome-fallback', () => {
  beforeEach(() => {
    resetVenmoFallbackDedupeForTests();
  });

  it('accepts only https sandbox checkout URLs', () => {
    expect(isHttpsSandboxCheckoutUrl(CHECKOUT)).toBe(true);
    expect(isHttpsSandboxCheckoutUrl('http://127.0.0.1:4200')).toBe(false);
    expect(isHttpsSandboxCheckoutUrl('')).toBe(false);
  });

  it('builds Chrome checkout URL with attempt + return bridge params', () => {
    const attempt = createVenmoFallbackAttemptId(() => 0.1);
    const url = buildVenmoChromeCheckoutUrl({
      checkoutBaseUrl: CHECKOUT,
      attemptId: attempt,
      nativeReturnUrl: RETURN,
      orderId: '5O190127TN364715T',
      productName: 'Premium Plan',
      amount: '99.00',
      currency: 'USD',
    });
    expect(url).toBeTruthy();
    const parsed = new URL(url!);
    expect(parsed.origin).toBe('https://direction-statistics-anna-smoke.trycloudflare.com');
    expect(parsed.searchParams.get('ep_smoke_venmo')).toBe('1');
    expect(parsed.searchParams.get('ep_smoke_attempt')).toBe(attempt);
    expect(parsed.searchParams.get('ep_smoke_return')).toBe(RETURN);
    expect(parsed.searchParams.get('ep_smoke_paypal_order')).toBe('5O190127TN364715T');
    expect(parsed.searchParams.get('ep_smoke_amount')).toBe('99.00');
  });

  it('builds App Link for approved/cancelled without treating link as success', () => {
    const approved = buildVenmoFallbackAppLink({
      nativeReturnUrl: RETURN,
      attemptId: 'abcdefghijklmnop',
      result: 'approved',
      orderId: 'ORDER-1',
    });
    expect(approved).toContain('ep_method=venmo');
    expect(approved).toContain('ep_result=approved');
    expect(approved).toContain('ep_paypal_order=ORDER-1');

    const cancelled = buildVenmoFallbackAppLink({
      nativeReturnUrl: RETURN,
      attemptId: 'abcdefghijklmnop',
      result: 'cancelled',
    });
    expect(cancelled).toContain('ep_result=cancelled');
    expect(cancelled).not.toContain('ep_paypal_order');
  });

  it('handles App Link returns and dedupes repeats for the same attempt', () => {
    const attempt = 'venmoattempt0001';
    const url = `${RETURN}?ep_method=venmo&ep_attempt=${attempt}&ep_result=approved&ep_paypal_order=5O190127TN364715T`;
    const first = evaluateVenmoChromeFallbackReturn(url, { nativeReturnUrl: RETURN }, {
      pendingAttemptId: attempt,
    });
    expect(first.kind).toBe('handle');
    if (first.kind === 'handle') {
      expect(first.detail.orderId).toBe('5O190127TN364715T');
      expect(first.detail.result).toBe('approved');
    }
    const second = evaluateVenmoChromeFallbackReturn(url, { nativeReturnUrl: RETURN }, {
      pendingAttemptId: attempt,
    });
    expect(second).toEqual({ kind: 'ignore', reason: 'duplicate' });
    const cancelAfter = evaluateVenmoChromeFallbackReturn(
      `${RETURN}?ep_method=venmo&ep_attempt=${attempt}&ep_result=cancelled`,
      { nativeReturnUrl: RETURN },
      { pendingAttemptId: attempt },
    );
    expect(cancelAfter).toEqual({ kind: 'ignore', reason: 'duplicate' });
  });

  it('rejects approved returns without an order id', () => {
    const decision = evaluateVenmoChromeFallbackReturn(
      `${RETURN}?ep_method=venmo&ep_attempt=venmoattempt0002&ep_result=approved`,
      { nativeReturnUrl: RETURN },
      { pendingAttemptId: 'venmoattempt0002' },
    );
    expect(decision).toEqual({ kind: 'ignore', reason: 'invalid' });
  });

  it('ignores mismatched or missing pending attempt ids', () => {
    const mismatched = evaluateVenmoChromeFallbackReturn(
      `${RETURN}?ep_method=venmo&ep_attempt=venmoattempt0003&ep_result=cancelled`,
      { nativeReturnUrl: RETURN },
      { pendingAttemptId: 'differentattempt01' },
    );
    expect(mismatched).toEqual({ kind: 'ignore', reason: 'stale' });
    const orphan = evaluateVenmoChromeFallbackReturn(
      `${RETURN}?ep_method=venmo&ep_attempt=venmoattempt0003&ep_result=cancelled`,
      { nativeReturnUrl: RETURN },
    );
    expect(orphan).toEqual({ kind: 'ignore', reason: 'stale' });
  });

  it('only treats COMPLETED as verified capture status', () => {
    expect(isVerifiedVenmoCaptureStatus('COMPLETED')).toBe(true);
    expect(isVerifiedVenmoCaptureStatus('APPROVED')).toBe(false);
    expect(isVerifiedVenmoCaptureStatus('CREATED')).toBe(false);
  });

  it('persists pending attempt markers', () => {
    const data = new Map<string, string>();
    const store = {
      getItem(key: string) {
        return data.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        data.set(key, value);
      },
      removeItem(key: string) {
        data.delete(key);
      },
    } as unknown as Storage;

    writeVenmoFallbackPending(
      { attemptId: 'venmoattempt0004', openedAt: 1, checkoutUrl: CHECKOUT },
      store,
    );
    expect(readVenmoFallbackPending(store)?.attemptId).toBe('venmoattempt0004');
    clearVenmoFallbackPending(store);
    expect(readVenmoFallbackPending(store)).toBeNull();
  });
});
