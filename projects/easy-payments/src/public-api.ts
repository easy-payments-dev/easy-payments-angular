/*
 * Public API Surface of easy-payments
 */

export { EasyPaymentsComponent } from './lib/components/payments/easy-payments.component';
export { EasyPaymentButtonsComponent } from './lib/components/payment-buttons/easy-payment-buttons.component';
export type {
  EasyPaymentButtonSlot,
  EasyPaymentButtonSlotKind,
  EasyPaymentButtonSlotState,
} from './lib/components/payment-buttons/easy-payment-buttons.component';
export type { EasyPaymentButtonsLayout } from './lib/models/easy-payment-buttons-layout.model';
export type {
  EasyPaymentButtonsAppearance,
  EasyPaymentButtonsSelectorLabels,
  EasyPaymentButtonsSelectorVisibility,
} from './lib/models/easy-payment-buttons-appearance.model';
export type { EasyPaymentsCardButtonAppearance } from './lib/models/easy-payments-card-button-appearance.model';
export {
  resolveCardButtonAppearance,
  type CardButtonAppearanceCssVars,
  type ResolvedCardButtonAppearance,
} from './lib/themes/resolve-card-button-appearance';

export { provideEasyPayments } from './lib/config/provide-easy-payments';
export { EasyPaymentsConfigService } from './lib/config/easy-payments-config.service';
export type {
  AffirmProviderConfig,
  ApplePayProviderConfig,
  CashAppPayProviderConfig,
  EasyPaymentsBackendConfig,
  EasyPaymentsConfig,
  EasyPaymentsProviderConfig,
  GooglePayProviderConfig,
  KlarnaProviderConfig,
  PayPalProviderConfig,
  ProviderConfigStatus,
  ProviderValidationResult,
  StripeProviderConfig,
  UsBankAccountProviderConfig,
} from './lib/config/easy-payments.config';

export type { PaymentProduct, EasyPaymentsMerchantMetadata } from './lib/models/payment-product.model';
export type { PaymentMethod, PaymentProviderName } from './lib/models/payment-method.model';
export { PAYMENT_METHOD_LABELS } from './lib/models/payment-method.model';
export type { PaymentTheme, ResolvedPaymentTheme } from './lib/models/payment-theme.model';
export type {
  PaymentMethodChangeEvent,
  PaymentResult,
  PaymentStartedEvent,
  PaymentStatus,
} from './lib/models/payment-result.model';
export { normalizePaymentResult } from './lib/models/payment-result.model';
export type { EasyPaymentsAddress } from './lib/models/easy-payments-address.model';
export type { BnplConfirmMode } from './lib/models/bnpl-confirm-mode.model';
export type {
  CheckoutCustomerOptions,
  CheckoutOptions,
  CheckoutShippingOptions,
  CheckoutSuccessBehavior,
} from './lib/models/checkout-options.model';
export {
  evaluateBnplDirectReadiness,
} from './lib/bnpl/bnpl-direct-readiness';
export type {
  BnplDirectProvider,
  BnplReadinessFieldPath,
  BnplReadinessReasonCode,
  BnplReadinessResult,
  BnplSelectedFlow,
  EvaluateBnplDirectReadinessInput,
} from './lib/bnpl/bnpl-direct-readiness';
export type { CheckoutViewState } from './lib/components/checkout/checkout-view-state';
export { formatTransactionReference } from './lib/components/checkout/checkout-view-state';
export {
  DEFAULT_CHECKOUT_MAX_WIDTH,
  MAX_CHECKOUT_WIDTH,
  MIN_CHECKOUT_WIDTH,
  resolveCheckoutMaxWidth,
} from './lib/layout/checkout-layout';
export type {
  AffirmCreatePaymentRequest,
  CapturePayPalOrderResponse,
  CashAppPayCreatePaymentRequest,
  CreateAffirmPaymentResponse,
  CreateCashAppPayPaymentResponse,
  CreateKlarnaPaymentResponse,
  CreatePaymentRequest,
  CreatePaymentResponse,
  CreatePayPalOrderResponse,
  CreateStripePaymentResponse,
  CreateUsBankAccountPaymentResponse,
  KlarnaCreatePaymentRequest,
  PayPalCreateOrderRequest,
  UsBankAccountCreatePaymentRequest,
} from './lib/models/create-payment.model';
export {
  toAffirmCreatePaymentRequest,
  toCashAppPayCreatePaymentRequest,
  toKlarnaCreatePaymentRequest,
  toPayPalCreateOrderRequest,
  toUsBankAccountCreatePaymentRequest,
} from './lib/models/create-payment.model';

export { PaymentError, normalizeError } from './lib/errors/payment-error';
export type { PaymentErrorCode } from './lib/errors/payment-error';

export { MockPaymentController } from './lib/adapters/mock/mock-payment.controller';
export type { MockPaymentOutcome } from './lib/adapters/mock/mock-payment.controller';

export {
  isKlarnaReturnAttempt,
  isKlarnaStripeReturn,
  isAnyStripeBnplReturnAttempt,
} from './lib/adapters/klarna/klarna-return';
export {
  detectStripeReturnMethod,
  isStripeReturnAttempt,
} from './lib/adapters/stripe/stripe-redirect-return';
export type { StripeRedirectMethod } from './lib/adapters/stripe/stripe-redirect-return';

export { EasyPaymentsConfigValidator } from './lib/validators/config.validator';
export { validatePaymentProduct } from './lib/validators/product.validator';
export type { ProductValidationResult } from './lib/validators/product.validator';
export {
  MERCHANT_METADATA_LIMITS,
  MERCHANT_METADATA_RESERVED_KEYS,
  PAYPAL_ORDER_REFERENCE_KEY,
  PAYPAL_ORDER_REFERENCE_MAX_LENGTH,
  validateMerchantMetadata,
} from './lib/metadata/merchant-metadata';
export type { MerchantMetadataValidationResult } from './lib/metadata/merchant-metadata';

export { PaymentOrchestratorService } from './lib/services/payment-orchestrator.service';
export type { AvailablePaymentMethod } from './lib/services/payment-orchestrator.service';
export type { MethodReadinessState } from './lib/diagnostics/provider-diagnostics';
export { EasyPaymentsDiagnosticsService } from './lib/diagnostics/easy-payments-diagnostics.service';
export { EASY_PAYMENTS_DIAGNOSTIC_CODES } from './lib/diagnostics/easy-payments-diagnostics.service';
export type {
  EasyPaymentsDiagnosticCode,
  EasyPaymentsDiagnosticsSnapshot,
  PaymentMethodDiagnostic,
} from './lib/diagnostics/easy-payments-diagnostics.service';

export { ApplePayAdapter } from './lib/adapters/apple-pay/apple-pay.adapter';
export type { ApplePayAvailabilityState } from './lib/adapters/apple-pay/apple-pay.types';
export type { EasyPaymentsAppearance } from './lib/models/easy-payments-appearance.model';
export type { EasyPaymentsVisualStyle } from './lib/models/easy-payments-visual-style.model';

export type {
  EasyPaymentsLocale,
  EasyPaymentsResolvedLocale,
  EasyPaymentsTranslationKey,
  EasyPaymentsTranslationOverrides,
  EasyPaymentsTranslations,
} from './lib/i18n';
export {
  EASY_PAYMENTS_DEFAULT_LOCALE,
  EASY_PAYMENTS_SUPPORTED_LOCALES,
  detectBrowserLocale,
  localizePaymentError,
  normalizeLanguageTag,
  resolveEffectiveLocale,
  resolveMessages,
  interpolate,
  toAffirmPreferredLocale,
  toGooglePayButtonLocale,
  toKlarnaPreferredLocale,
  toPayPalSdkLocale,
  toStripeBnplLocale,
  toStripeElementsLocale,
} from './lib/i18n';

/** Headless Checkout (v1.2.0 — H3 providers + H4.3 Klarna/Affirm recoverReturn). */
export {
  EasyPaymentsHeadless,
} from './lib/headless';
export type {
  HeadlessCheckoutEvents,
  HeadlessCheckoutSession,
  HeadlessMethodInteraction,
  HeadlessMethodStatus,
  HeadlessMountHandle,
  HeadlessSessionOptions,
  HeadlessSessionState,
} from './lib/headless';
