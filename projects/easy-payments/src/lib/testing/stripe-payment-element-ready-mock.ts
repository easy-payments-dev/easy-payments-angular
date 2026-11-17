/**
 * Stripe Payment Element mock that fires `ready` synchronously on `on('ready')`.
 * Required wherever adapters await {@link waitForPaymentElementReady}.
 */
export function createReadyPaymentElementMock(mount = jasmine.createSpy('mount'), unmount = jasmine.createSpy('unmount')) {
  const element = {
    mount,
    unmount,
    on: jasmine.createSpy('on').and.callFake((event: string, handler: () => void) => {
      if (event === 'ready') {
        handler();
      }
    }),
    off: jasmine.createSpy('off'),
  };
  return element;
}
