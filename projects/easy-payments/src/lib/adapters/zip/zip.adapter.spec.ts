import { TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { PaymentError } from '../../errors/payment-error';
import { BackendService } from '../../services/backend.service';
import { SdkLoaderService } from '../../loaders/sdk-loader.service';
import { BrowserGuard } from '../../utils/browser-guard';
import { ZipAdapter } from './zip.adapter';
import type { ZipApiCheckout, ZipCheckoutCompleteResult } from './zip.types';

describe('ZipAdapter', () => {
  let adapter: ZipAdapter;
  let backend: jasmine.SpyObj<BackendService>;
  let api: ZipApiCheckout;
  let onCompleteCb: ((result: ZipCheckoutCompleteResult) => void) | null;
  let onCloseCb: ((message: string) => void) | null;
  let winDoc: { hasFocus: jasmine.Spy };

  function configure(opts: { enableMockMode?: boolean } = {}): void {
    onCompleteCb = null;
    onCloseCb = null;
    winDoc = { hasFocus: jasmine.createSpy('hasFocus').and.returnValue(true) };
    api = {
      openCheckout: jasmine.createSpy('openCheckout'),
      onComplete: (cb) => {
        onCompleteCb = cb;
      },
      onClose: (cb) => {
        onCloseCb = cb;
      },
      onError: () => undefined,
    };

    backend = jasmine.createSpyObj<BackendService>('BackendService', [
      'createZipCheckout',
      'verifyZipReturn',
    ]);

    const enableMockMode = opts.enableMockMode === true;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          enableMockMode,
          providers: enableMockMode ? {} : { zip: {} },
          backend: enableMockMode
            ? undefined
            : {
                zipCreateCheckoutUrl: '/api/payments/zip/create',
                zipVerifyReturnUrl: '/api/payments/zip/verify',
              },
        }),
        { provide: BackendService, useValue: backend },
        {
          provide: SdkLoaderService,
          useValue: {
            loadScript: jasmine.createSpy('loadScript').and.resolveTo(undefined),
          },
        },
        {
          provide: BrowserGuard,
          useValue: {
            isBrowser: true,
            getWindow: () => ({
              quadpay: { apiCheckout: api },
              document: winDoc,
              addEventListener: jasmine.createSpy('addEventListener'),
              removeEventListener: jasmine.createSpy('removeEventListener'),
            }),
            getDocument: () => document,
          },
        },
        ZipAdapter,
      ],
    });

    adapter = TestBed.inject(ZipAdapter);
  }

  beforeEach(() => {
    configure();
  });

  it('is available for USD when opted in with backend URLs', async () => {
    await adapter.initialize();
    expect(
      await adapter.isAvailable({
        product: { id: 'premium-plan', name: 'P', amount: 99, currency: 'USD' },
        theme: 'light',
      } as never),
    ).toBe(true);
    expect(
      await adapter.isAvailable({
        product: { id: 'premium-plan', name: 'P', amount: 99, currency: 'EUR' },
        theme: 'light',
      } as never),
    ).toBe(false);
  });

  it('prepares checkout then opens synchronously on startCheckout', async () => {
    backend.createZipCheckout.and.resolveTo({
      provider: 'zip',
      merchantReference: 'ref-1',
      merchantId: 'mid',
      amount: 99,
      currency: 'USD',
      requestBody: { merchantReference: 'ref-1' },
      signature: 'sig-1',
      sdkScriptUrl: 'https://cdn.sand.us.zip.co/v1/zip.js',
    });

    await adapter.initialize();
    await adapter.prepareCheckout({
      id: 'premium-plan',
      name: 'Premium',
      amount: 99,
      currency: 'USD',
    });
    adapter.startCheckout();
    expect(api.openCheckout).toHaveBeenCalledWith(
      { merchantReference: 'ref-1' },
      'sig-1',
    );
  });

  it('verifies approval via onComplete and emits success once', async () => {
    backend.createZipCheckout.and.resolveTo({
      provider: 'zip',
      merchantReference: 'ref-ok',
      merchantId: 'mid',
      amount: 29.99,
      currency: 'USD',
      requestBody: { merchantReference: 'ref-ok' },
      signature: 'sig',
      sdkScriptUrl: 'https://cdn.sand.us.zip.co/v1/zip.js',
    });
    backend.verifyZipReturn.and.resolveTo({
      provider: 'zip',
      merchantReference: 'ref-ok',
      orderId: 'ord-1',
      status: 'confirmed',
      success: true,
      amount: 29.99,
      currency: 'USD',
    });

    const successes: string[] = [];
    adapter.setOutcomeHandlers({
      onComplete: (r) => successes.push(r.transactionId ?? ''),
    });

    await adapter.initialize();
    await adapter.prepareCheckout({
      id: 'basic-plan',
      name: 'Basic',
      amount: 29.99,
      currency: 'USD',
    });

    onCompleteCb?.({
      success: true,
      order: {
        orderId: 'ord-1',
        merchantReference: 'ref-ok',
        isSuccess: true,
      },
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(successes).toEqual(['ord-1']);

    // Duplicate callback must not emit again.
    backend.verifyZipReturn.and.resolveTo({
      provider: 'zip',
      merchantReference: 'ref-ok',
      orderId: 'ord-1',
      status: 'confirmed',
      success: true,
      amount: 29.99,
      currency: 'USD',
      alreadyReported: true,
    });
    onCompleteCb?.({
      success: true,
      order: { orderId: 'ord-1', merchantReference: 'ref-ok', isSuccess: true },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(successes).toEqual(['ord-1']);
  });

  it('emits cancel on onClose', async () => {
    backend.createZipCheckout.and.resolveTo({
      provider: 'zip',
      merchantReference: 'ref-cancel',
      merchantId: 'mid',
      amount: 29.99,
      currency: 'USD',
      requestBody: { merchantReference: 'ref-cancel' },
      signature: 'sig',
      sdkScriptUrl: 'https://cdn.sand.us.zip.co/v1/zip.js',
    });

    const cancels: string[] = [];
    adapter.setOutcomeHandlers({
      onCancel: (r) => cancels.push(r.status),
    });

    await adapter.initialize();
    await adapter.prepareCheckout({
      id: 'basic-plan',
      name: 'Basic',
      amount: 29.99,
      currency: 'USD',
    });
    adapter.startCheckout();
    onCloseCb?.('closed by user');
    expect(cancels).toEqual(['cancelled']);
    expect(adapter.isCheckoutOpen()).toBe(false);
  });

  it('surfaces verify failures as errors', async () => {
    backend.createZipCheckout.and.resolveTo({
      provider: 'zip',
      merchantReference: 'ref-bad',
      merchantId: 'mid',
      amount: 29.99,
      currency: 'USD',
      requestBody: { merchantReference: 'ref-bad' },
      signature: 'sig',
      sdkScriptUrl: 'https://cdn.sand.us.zip.co/v1/zip.js',
    });
    backend.verifyZipReturn.and.rejectWith(
      new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Invalid Zip return signature.',
        method: 'zip',
        provider: 'zip',
      }),
    );

    const errors: string[] = [];
    adapter.setOutcomeHandlers({
      onError: (e) => errors.push(e.message),
    });

    await adapter.initialize();
    await adapter.prepareCheckout({
      id: 'basic-plan',
      name: 'Basic',
      amount: 29.99,
      currency: 'USD',
    });
    onCompleteCb?.({
      success: true,
      order: { orderId: 'ord-x', merchantReference: 'ref-bad', isSuccess: true },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(errors[0]).toContain('Invalid Zip return signature');
  });

  describe('hang regression (spinner stuck on open)', () => {
    /**
     * Reproduces the demo hang: first cancel marks the merchantReference as reported;
     * a second openCheckout + onClose used to early-return without notifying the UI,
     * leaving checkoutOpen / the button spinner stuck forever.
     */
    it('clears open state and notifies cancel when onClose fires after a prior cancel on the same ref', async () => {
      backend.createZipCheckout.and.resolveTo({
        provider: 'zip',
        merchantReference: 'ref-hang',
        merchantId: 'mid',
        amount: 29.99,
        currency: 'USD',
        requestBody: { merchantReference: 'ref-hang' },
        signature: 'sig',
        sdkScriptUrl: 'https://cdn.sand.us.zip.co/v1/zip.js',
      });

      const cancels: string[] = [];
      adapter.setOutcomeHandlers({
        onCancel: (r) => cancels.push(r.status),
      });

      await adapter.initialize();
      await adapter.prepareCheckout({
        id: 'basic-plan',
        name: 'Basic',
        amount: 29.99,
        currency: 'USD',
      });

      adapter.startCheckout();
      expect(adapter.isCheckoutOpen()).toBe(true);
      onCloseCb?.('first close');
      expect(cancels).toEqual(['cancelled']);
      expect(adapter.isCheckoutOpen()).toBe(false);

      // Second click without re-prepare (same signed body) — must not hang.
      adapter.startCheckout();
      expect(adapter.isCheckoutOpen()).toBe(true);
      onCloseCb?.('second close');
      expect(cancels).toEqual(['cancelled', 'cancelled']);
      expect(adapter.isCheckoutOpen()).toBe(false);
    });

    it('Mock mode completes from startCheckout without merchant credentials or SDK openCheckout', async () => {
      configure({ enableMockMode: true });

      const successes: string[] = [];
      adapter.setOutcomeHandlers({
        onComplete: (r) => successes.push(r.status),
      });

      await adapter.initialize();
      await adapter.prepareCheckout({
        id: 'basic-plan',
        name: 'Basic',
        amount: 29.99,
        currency: 'USD',
      });
      expect(backend.createZipCheckout).not.toHaveBeenCalled();

      adapter.startCheckout();
      expect(adapter.isCheckoutOpen()).toBe(true);
      expect(api.openCheckout).not.toHaveBeenCalled();

      await new Promise((r) => setTimeout(r, 0));
      expect(successes).toEqual(['success']);
      expect(adapter.isCheckoutOpen()).toBe(false);
    });

    it('Real mode rejects server mock:true create responses with an actionable CONFIG_MISSING error', async () => {
      backend.createZipCheckout.and.resolveTo({
        provider: 'zip',
        merchantReference: 'mock_ref',
        merchantId: 'mock-merchant',
        amount: 29.99,
        currency: 'USD',
        requestBody: { merchantReference: 'mock_ref' },
        signature: 'mock-sig',
        sdkScriptUrl: 'https://cdn.sand.us.zip.co/v1/zip.js',
        mock: true,
      });

      await adapter.initialize();
      try {
        await adapter.prepareCheckout({
          id: 'basic-plan',
          name: 'Basic',
          amount: 29.99,
          currency: 'USD',
        });
        fail('expected CONFIG_MISSING');
      } catch (err) {
        expect(err).toBeInstanceOf(PaymentError);
        expect((err as PaymentError).code).toBe('CONFIG_MISSING');
        expect((err as PaymentError).message).toContain('ZIP_MERCHANT_ID');
      }
      expect(api.openCheckout).not.toHaveBeenCalled();
      expect(adapter.isCheckoutOpen()).toBe(false);
    });
  });
});
