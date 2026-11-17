import { PaymentError } from '../../errors/payment-error';
import {
  PAYMENT_ELEMENT_READY_TIMEOUT_MS,
  waitForPaymentElementReady,
} from './wait-for-payment-element-ready';

describe('waitForPaymentElementReady', () => {
  it('resolves when the element fires ready', async () => {
    const handlers = new Map<string, () => void>();
    const element = {
      on: jasmine.createSpy('on').and.callFake((event: string, cb: () => void) => {
        handlers.set(event, cb);
      }),
      off: jasmine.createSpy('off'),
    };

    const wait = waitForPaymentElementReady(element as never);
    handlers.get('ready')?.();
    await expectAsync(wait).toBeResolved();
    expect(element.off).toHaveBeenCalledWith('ready', jasmine.any(Function));
  });

  it('resolves ready even when isCurrent is false so awaits do not hang', async () => {
    const handlers = new Map<string, () => void>();
    const element = {
      on: jasmine.createSpy('on').and.callFake((event: string, cb: () => void) => {
        handlers.set(event, cb);
      }),
      off: jasmine.createSpy('off'),
    };

    const wait = waitForPaymentElementReady(element as never, { isCurrent: () => false });
    handlers.get('ready')?.();
    await expectAsync(wait).toBeResolved();
  });

  it('rejects with SDK_LOAD_FAILED after timeout', async () => {
    jasmine.clock().install();
    try {
      const element = {
        on: jasmine.createSpy('on'),
        off: jasmine.createSpy('off'),
      };
      const wait = waitForPaymentElementReady(element as never, {
        timeoutMs: 100,
        method: 'klarna',
        provider: 'klarna',
      });
      jasmine.clock().tick(100);
      await expectAsync(wait).toBeRejectedWith(
        jasmine.objectContaining({
          code: 'SDK_LOAD_FAILED',
          method: 'klarna',
        } as Partial<PaymentError>),
      );
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('rejects with SDK_LOAD_FAILED on loaderror', async () => {
    const handlers = new Map<string, (event?: { error?: { message?: string } }) => void>();
    const element = {
      on: jasmine.createSpy('on').and.callFake((event: string, cb: (event?: { error?: { message?: string } }) => void) => {
        handlers.set(event, cb);
      }),
      off: jasmine.createSpy('off'),
    };

    const wait = waitForPaymentElementReady(element as never, {
      method: 'afterpay',
      provider: 'afterpay',
      message: 'Afterpay Payment Element failed to become ready.',
    });
    handlers.get('loaderror')?.({ error: { message: 'iframe failed' } });
    await expectAsync(wait).toBeRejectedWith(
      jasmine.objectContaining({
        code: 'SDK_LOAD_FAILED',
        method: 'afterpay',
        message: 'iframe failed',
      } as Partial<PaymentError>),
    );
    expect(element.off).toHaveBeenCalledWith('loaderror', jasmine.any(Function));
  });

  it('exports a finite default timeout', () => {
    expect(PAYMENT_ELEMENT_READY_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
