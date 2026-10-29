import { CheckoutAvailabilitySession } from './checkout-availability-session';
import type { AvailablePaymentMethod } from './payment-orchestrator.service';

describe('CheckoutAvailabilitySession', () => {
  it('starts unpublished with an empty method list', () => {
    const session = new CheckoutAvailabilitySession();
    expect(session.availabilityPublished()).toBeFalse();
    expect(session.availableMethods()).toEqual([]);
  });

  it('applies an independent snapshot copy', () => {
    const session = new CheckoutAvailabilitySession();
    const results: AvailablePaymentMethod[] = [
      { method: 'card', isMock: true, available: true, status: 'available' },
      { method: 'paypal', isMock: true, available: true, status: 'available' },
    ];

    session.apply(results);
    results[0] = {
      method: 'klarna',
      isMock: true,
      available: false,
      status: 'unavailable',
    };

    expect(session.availabilityPublished()).toBeTrue();
    expect(session.availableMethods().map((entry) => entry.method)).toEqual(['card', 'paypal']);
    expect(session.availableMethods()[0].available).toBeTrue();
  });

  it('does not share state with another session instance', () => {
    const a = new CheckoutAvailabilitySession();
    const b = new CheckoutAvailabilitySession();

    a.apply([{ method: 'card', isMock: true, available: true, status: 'available' }]);
    b.apply([
      { method: 'paypal', isMock: true, available: true, status: 'available' },
      { method: 'klarna', isMock: true, available: true, status: 'available' },
    ]);

    expect(a.availableMethods().map((entry) => entry.method)).toEqual(['card']);
    expect(b.availableMethods().map((entry) => entry.method)).toEqual(['paypal', 'klarna']);

    a.clear();
    expect(a.availabilityPublished()).toBeFalse();
    expect(a.availableMethods()).toEqual([]);
    expect(b.availabilityPublished()).toBeTrue();
    expect(b.availableMethods().map((entry) => entry.method)).toEqual(['paypal', 'klarna']);
  });
});
