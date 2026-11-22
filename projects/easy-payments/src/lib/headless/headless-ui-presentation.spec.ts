import { PaymentError } from '../errors/payment-error';
import {
  EN_TRANSLATIONS,
  ES_TRANSLATIONS,
  FR_TRANSLATIONS,
  PT_TRANSLATIONS,
} from '../i18n';
import {
  describeHeadlessUi,
  isHeadlessPaymentRetryAllowed,
  isHeadlessRecoveryRetryable,
} from './headless-ui-presentation';

describe('headless-ui-presentation', () => {
  describe('isHeadlessRecoveryRetryable', () => {
    it('allows only transient recoverReturn verification failures', () => {
      expect(
        isHeadlessRecoveryRetryable(new PaymentError({ code: 'NETWORK_ERROR', message: 'n' })),
      ).toBeTrue();
      expect(
        isHeadlessRecoveryRetryable(new PaymentError({ code: 'SDK_LOAD_FAILED', message: 's' })),
      ).toBeTrue();
      expect(
        isHeadlessRecoveryRetryable(new PaymentError({ code: 'CONFIG_MISSING', message: 'c' })),
      ).toBeFalse();
      expect(
        isHeadlessRecoveryRetryable(
          new PaymentError({ code: 'AUTHENTICATION_REQUIRED', message: 'a' }),
        ),
      ).toBeFalse();
      expect(isHeadlessRecoveryRetryable(null)).toBeFalse();
    });
  });

  describe('isHeadlessPaymentRetryAllowed', () => {
    it('blocks retry for config errors, pending, processing, and success', () => {
      const declined = new PaymentError({ code: 'CARD_DECLINED', message: 'declined' });
      const missing = new PaymentError({ code: 'CONFIG_MISSING', message: 'missing' });

      expect(isHeadlessPaymentRetryAllowed('error', declined)).toBeTrue();
      expect(isHeadlessPaymentRetryAllowed('cancelled', declined)).toBeTrue();
      expect(isHeadlessPaymentRetryAllowed('error', missing)).toBeFalse();
      expect(isHeadlessPaymentRetryAllowed('pending', declined)).toBeFalse();
      expect(isHeadlessPaymentRetryAllowed('processing', declined)).toBeFalse();
      expect(isHeadlessPaymentRetryAllowed('success', declined)).toBeFalse();
      expect(
        isHeadlessPaymentRetryAllowed(
          'error',
          new PaymentError({ code: 'AUTHENTICATION_REQUIRED', message: 'auth' }),
        ),
      ).toBeFalse();
    });
  });

  describe('describeHeadlessUi', () => {
    it('maps loading / ready / processing / pending / cancelled without collapsing pending', () => {
      expect(describeHeadlessUi({ state: 'initializing', messages: EN_TRANSLATIONS }).kind).toBe(
        'loading',
      );
      expect(describeHeadlessUi({ state: 'ready', messages: EN_TRANSLATIONS }).kind).toBe('ready');
      expect(describeHeadlessUi({ state: 'processing', messages: EN_TRANSLATIONS }).kind).toBe(
        'processing',
      );

      const pending = describeHeadlessUi({
        state: 'pending',
        messages: EN_TRANSLATIONS,
        lastResult: {
          status: 'processing',
          method: 'card',
          provider: 'stripe',
        },
      });
      expect(pending.kind).toBe('pending');
      expect(pending.recoveryAction).toBe('reconcile');
      expect(pending.title).toBe(EN_TRANSLATIONS.pendingTitle);
      expect(pending.body).toBe(EN_TRANSLATIONS.pendingBody);

      const cancelled = describeHeadlessUi({ state: 'cancelled', messages: EN_TRANSLATIONS });
      expect(cancelled.kind).toBe('cancelled');
      expect(cancelled.recoveryAction).toBe('retry-payment');
    });

    it('localizes EN / ES / PT / FR without exposing technical messages', () => {
      const error = new PaymentError({
        code: 'CARD_DECLINED',
        message: 'sk_test_secret_must_not_leak',
        method: 'card',
      });

      for (const messages of [EN_TRANSLATIONS, ES_TRANSLATIONS, PT_TRANSLATIONS, FR_TRANSLATIONS]) {
        const ui = describeHeadlessUi({ state: 'error', messages, lastError: error });
        expect(ui.kind).toBe('error');
        expect(ui.body).toBe(messages.errorDetailCardDeclined);
        expect(ui.body).not.toContain('sk_test');
        expect(ui.errorCode).toBe('CARD_DECLINED');
        expect(ui.recoveryAction).toBe('retry-payment');
      }
    });

    it('does not offer payment retry for configuration or availability failures', () => {
      const ui = describeHeadlessUi({
        state: 'error',
        messages: EN_TRANSLATIONS,
        lastError: new PaymentError({
          code: 'CONFIG_MISSING',
          message: 'Set STRIPE_SECRET_KEY',
          method: 'card',
        }),
      });
      expect(ui.kind).toBe('unavailable');
      expect(ui.recoveryAction).toBe('choose-another-method');
      expect(ui.body).toBe(EN_TRANSLATIONS.errorDetailConfig);
      expect(ui.body).not.toContain('STRIPE_SECRET_KEY');

      const unavailable = describeHeadlessUi({
        state: 'error',
        messages: EN_TRANSLATIONS,
        lastError: new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Apple Pay domain not verified',
          method: 'apple-pay',
        }),
      });
      expect(unavailable.kind).toBe('unavailable');
      expect(unavailable.recoveryAction).toBe('choose-another-method');
      expect(isHeadlessPaymentRetryAllowed('error', unavailable.errorCode
        ? new PaymentError({ code: unavailable.errorCode, message: 'x', method: 'apple-pay' })
        : null)).toBeFalse();
    });

    it('is a pure presentation helper — no payment side effects', () => {
      const error = new PaymentError({
        code: 'CARD_DECLINED',
        message: 'declined',
        method: 'card',
      });
      const first = describeHeadlessUi({
        state: 'error',
        messages: ES_TRANSLATIONS,
        lastError: error,
      });
      const second = describeHeadlessUi({
        state: 'error',
        messages: FR_TRANSLATIONS,
        lastError: error,
      });
      expect(first.body).toBe(ES_TRANSLATIONS.errorDetailCardDeclined);
      expect(second.body).toBe(FR_TRANSLATIONS.errorDetailCardDeclined);
      expect(first.recoveryAction).toBe('retry-payment');
      expect(second.recoveryAction).toBe('retry-payment');
      // Locale swap only changes copy; same error code / recovery guidance.
      expect(first.errorCode).toBe(second.errorCode);
    });

    it('marks transient recovery failures as retry-recovery', () => {
      const ui = describeHeadlessUi({
        state: 'error',
        messages: FR_TRANSLATIONS,
        lastError: new PaymentError({ code: 'NETWORK_ERROR', message: 'timeout' }),
      });
      expect(ui.recoveryAction).toBe('retry-recovery');
      expect(ui.body).toBe(FR_TRANSLATIONS.errorDetailNetwork);
    });

    it('surfaces unavailable readiness separately from payment outcome', () => {
      const ui = describeHeadlessUi({
        state: 'ready',
        messages: ES_TRANSLATIONS,
        selectedReadiness: 'unavailable',
      });
      expect(ui.kind).toBe('unavailable');
      expect(ui.recoveryAction).toBe('choose-another-method');
      expect(ui.body).toBe(ES_TRANSLATIONS.errorDetailUnavailable);
    });

    it('keeps AUTHENTICATION_REQUIRED on reconcile (no duplicate charge retry)', () => {
      const ui = describeHeadlessUi({
        state: 'error',
        messages: PT_TRANSLATIONS,
        lastError: new PaymentError({
          code: 'AUTHENTICATION_REQUIRED',
          message: 'requires_action',
        }),
      });
      expect(ui.recoveryAction).toBe('reconcile');
    });
  });
});
