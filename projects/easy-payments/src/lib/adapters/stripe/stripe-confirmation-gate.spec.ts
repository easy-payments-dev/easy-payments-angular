import { StripeConfirmationGate } from './stripe-confirmation-gate';

describe('StripeConfirmationGate', () => {
  let gate: StripeConfirmationGate;
  let visibilityState: DocumentVisibilityState;

  beforeEach(() => {
    gate = new StripeConfirmationGate();
    visibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
  });

  afterEach(() => {
    gate.clear();
  });

  it('rejects a second acquire while held with PROVIDER_UNAVAILABLE', () => {
    gate.acquire('klarna:a', 'klarna', 'klarna');
    expect(() => gate.acquire('card:b', 'card', 'stripe')).toThrowMatching(
      (err) => err?.code === 'PROVIDER_UNAVAILABLE',
    );
  });

  it('does not unlock on document hidden when there is no redirect handoff', () => {
    const release = gate.acquire('card:pending', 'card', 'stripe');
    expect(gate.isHeld()).toBeTrue();

    // App backgrounded / screen off mid-confirm — not an App Link return.
    visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));

    expect(gate.isHeld()).toBeTrue();
    expect(gate.isHeldBy('card:pending')).toBeTrue();
    expect(() => gate.acquire('klarna:other', 'klarna', 'klarna')).toThrowMatching(
      (err) => err?.code === 'PROVIDER_UNAVAILABLE',
    );

    release();
    expect(gate.isHeld()).toBeFalse();
  });

  it('does not let an older releaser unlock after a newer attempt acquired', () => {
    const releaseOld = gate.acquire('card:same-owner', 'card', 'stripe');
    // Simulated App Link / resume recovery of the hung Klarna/card confirm.
    gate.clear();
    const releaseNew = gate.acquire('card:same-owner', 'card', 'stripe');
    expect(gate.isHeldBy('card:same-owner')).toBeTrue();

    // Hung confirmPayment finally runs after the next acquire.
    releaseOld();
    expect(gate.isHeld()).toBeTrue();
    expect(gate.isHeldBy('card:same-owner')).toBeTrue();
    expect(() => gate.acquire('klarna:intruder', 'klarna', 'klarna')).toThrowMatching(
      (err) => err?.code === 'PROVIDER_UNAVAILABLE',
    );

    releaseNew();
    expect(gate.isHeld()).toBeFalse();
  });

  it('clear() after a stale Klarna hold lets Card confirm next (App Link return)', () => {
    gate.acquire('klarna:full-0', 'klarna', 'klarna');
    expect(gate.isHeld()).toBeTrue();

    // Validated App Link return / claimReturn path.
    gate.clear();
    expect(gate.isHeld()).toBeFalse();

    expect(() => gate.acquire('card:full-0', 'card', 'stripe')).not.toThrow();
    expect(gate.isHeldBy('card:full-0')).toBeTrue();
  });
});
