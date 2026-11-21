import { resolveSelectorLabelOverride, sanitizeSelectorLabel } from './selector-label';

describe('selector-label helpers', () => {
  it('accepts plain text and rejects blank / markup / overlong values', () => {
    expect(sanitizeSelectorLabel('Credit / Debit')).toBe('Credit / Debit');
    expect(sanitizeSelectorLabel('  Bank account  ')).toBe('Bank account');
    // Host punctuation is preserved (demo may omit a trailing period; hosts may keep one).
    expect(sanitizeSelectorLabel('Bank account.')).toBe('Bank account.');
    expect(sanitizeSelectorLabel('')).toBeNull();
    expect(sanitizeSelectorLabel('   ')).toBeNull();
    expect(sanitizeSelectorLabel('<b>Card</b>')).toBeNull();
    expect(sanitizeSelectorLabel('x'.repeat(65))).toBeNull();
  });

  it('resolves Card and US bank account overrides independently', () => {
    expect(
      resolveSelectorLabelOverride({ card: 'Credit / Debit' }, 'card'),
    ).toBe('Credit / Debit');
    expect(
      resolveSelectorLabelOverride({ card: 'Credit / Debit' }, 'us-bank-account'),
    ).toBeNull();
    expect(
      resolveSelectorLabelOverride(
        { usBankAccount: 'Bank account' },
        'us-bank-account',
      ),
    ).toBe('Bank account');
    expect(
      resolveSelectorLabelOverride(
        { card: 'Credit / Debit', usBankAccount: '' },
        'us-bank-account',
      ),
    ).toBeNull();
  });

  it('resolves Link selector overrides with blank fallback', () => {
    expect(resolveSelectorLabelOverride({ link: 'Pay with Link' }, 'link')).toBe('Pay with Link');
    expect(resolveSelectorLabelOverride({ link: 'Checkout with Link' }, 'link')).toBe(
      'Checkout with Link',
    );
    expect(resolveSelectorLabelOverride({ link: '' }, 'link')).toBeNull();
    expect(resolveSelectorLabelOverride({ link: '   ' }, 'link')).toBeNull();
    expect(resolveSelectorLabelOverride({ card: 'Credit / Debit' }, 'link')).toBeNull();
  });
});
