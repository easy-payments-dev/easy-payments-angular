import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { EasyPaymentsConfigService } from '../config/easy-payments-config.service';
import {
  backendEndpointUrl,
  resolveBackendUrl,
  warnBackendUrlIssue,
} from '../config/resolve-backend-url';
import { PaymentError } from '../errors/payment-error';
import {
  assertMerchantMetadata,
  assertPayPalOrderReference,
} from '../metadata/merchant-metadata';
import { PaymentMethod, PaymentProviderName } from '../models';
import {
  AffirmCreatePaymentRequest,
  CapturePayPalOrderResponse,
  CreateAffirmPaymentResponse,
  CreateKlarnaPaymentResponse,
  CreatePaymentRequest,
  CreatePayPalOrderResponse,
  CreateStripePaymentResponse,
  CreateUsBankAccountPaymentResponse,
  KlarnaCreatePaymentRequest,
  PayPalCreateOrderRequest,
  UsBankAccountCreatePaymentRequest,
  toAffirmCreatePaymentRequest,
  toKlarnaCreatePaymentRequest,
  toPayPalCreateOrderRequest,
  toUsBankAccountCreatePaymentRequest,
} from '../models/create-payment.model';

@Injectable({ providedIn: 'root' })
export class BackendService {
  private readonly http = inject(HttpClient, { optional: true });
  private readonly configService = inject(EasyPaymentsConfigService);

  get createPaymentUrl(): string | undefined {
    return this.endpointUrl('createPaymentUrl');
  }

  get paypalCreateOrderUrl(): string | undefined {
    return this.endpointUrl('paypalCreateOrderUrl');
  }

  get paypalCaptureOrderUrl(): string | undefined {
    return this.endpointUrl('paypalCaptureOrderUrl');
  }

  get klarnaCreatePaymentUrl(): string | undefined {
    return this.endpointUrl('klarnaCreatePaymentUrl');
  }

  get affirmCreatePaymentUrl(): string | undefined {
    return this.endpointUrl('affirmCreatePaymentUrl');
  }

  get createUsBankAccountPaymentUrl(): string | undefined {
    return this.endpointUrl('createUsBankAccountPaymentUrl');
  }

  /** @deprecated Prefer createPaymentUrl. Kept optional for future provider flows. */
  get confirmPaymentUrl(): string | undefined {
    return this.endpointUrl('confirmPaymentUrl');
  }

  async createStripePayment(payload: CreatePaymentRequest): Promise<CreateStripePaymentResponse> {
    const url = this.requireEndpoint(
      'createPaymentUrl',
      'Backend createPaymentUrl is not configured.',
      'card',
      'stripe',
    );

    const { metadata, ...rest } = payload;
    const validatedMetadata = assertMerchantMetadata(metadata, 'card', 'stripe');
    return this.postJson<CreateStripePaymentResponse>(
      url,
      validatedMetadata ? { ...rest, metadata: validatedMetadata } : rest,
      'card',
      'stripe',
      {
        successMessage: 'Failed to create payment on backend.',
        networkMessage: 'A network error occurred while creating the payment session.',
        validate: (response) => {
          if (
            response?.provider !== 'stripe' ||
            typeof response.clientSecret !== 'string' ||
            !response.clientSecret.trim()
          ) {
            throw new PaymentError({
              code: 'BACKEND_ERROR',
              message: 'Invalid Stripe create-payment response from backend.',
              method: 'card',
              provider: 'stripe',
            });
          }
        },
      },
    );
  }

  /**
   * Posts the PayPal create-order wire contract.
   * Forwards `orderReference` only. Never forwards a metadata map or a client amount.
   */
  async createPayPalOrder(
    payload: PayPalCreateOrderRequest | { productId: string; quantity: number; currency: string },
  ): Promise<CreatePayPalOrderResponse> {
    const url = this.requireEndpoint(
      'paypalCreateOrderUrl',
      'Backend paypalCreateOrderUrl is not configured.',
      'paypal',
      'paypal',
    );

    const body = toPayPalCreateOrderRequest(payload);
    if (body.orderReference) {
      body.orderReference = assertPayPalOrderReference(body.orderReference);
    }

    return this.postJson<CreatePayPalOrderResponse>(url, body, 'paypal', 'paypal', {
      successMessage: 'Failed to create PayPal order on backend.',
      networkMessage: 'A network error occurred while creating the PayPal order.',
      validate: (response) => {
        if (
          response?.provider !== 'paypal' ||
          typeof response.orderId !== 'string' ||
          !response.orderId.trim()
        ) {
          throw new PaymentError({
            code: 'BACKEND_ERROR',
            message: 'Invalid PayPal create-order response from backend.',
            method: 'paypal',
            provider: 'paypal',
          });
        }
      },
    });
  }

  async capturePayPalOrder(orderId: string): Promise<CapturePayPalOrderResponse> {
    const url = this.requireEndpoint(
      'paypalCaptureOrderUrl',
      'Backend paypalCaptureOrderUrl is not configured.',
      'paypal',
      'paypal',
    );

    const id = orderId?.trim();
    if (!id) {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'PayPal orderId is required to capture payment.',
        method: 'paypal',
        provider: 'paypal',
      });
    }

    return this.postJson<CapturePayPalOrderResponse>(
      url,
      { orderId: id },
      'paypal',
      'paypal',
      {
        successMessage: 'Failed to capture PayPal order on backend.',
        networkMessage: 'A network error occurred while capturing the PayPal payment.',
        validate: (response) => {
          if (
            response?.provider !== 'paypal' ||
            typeof response.orderId !== 'string' ||
            !response.orderId.trim() ||
            typeof response.captureId !== 'string' ||
            !response.captureId.trim()
          ) {
            throw new PaymentError({
              code: 'BACKEND_ERROR',
              message: 'Invalid PayPal capture response from backend.',
              method: 'paypal',
              provider: 'paypal',
            });
          }
        },
      },
    );
  }

  /**
   * Posts the Klarna create-payment wire contract.
   * Forwards validated merchant metadata only. Never forwards a client amount.
   */
  async createKlarnaPayment(
    payload: KlarnaCreatePaymentRequest | { productId: string; quantity: number; currency: string },
  ): Promise<CreateKlarnaPaymentResponse> {
    const url = this.requireEndpoint(
      'klarnaCreatePaymentUrl',
      'Backend klarnaCreatePaymentUrl is not configured.',
      'klarna',
      'klarna',
    );

    const body = toKlarnaCreatePaymentRequest(payload);
    if (body.metadata) {
      body.metadata = assertMerchantMetadata(body.metadata, 'klarna', 'klarna');
    }

    return this.postJson<CreateKlarnaPaymentResponse>(url, body, 'klarna', 'klarna', {
      successMessage: 'Failed to create Klarna payment on backend.',
      networkMessage: 'A network error occurred while creating the Klarna payment session.',
      validate: (response) => {
        if (
          response?.provider !== 'klarna' ||
          typeof response.clientSecret !== 'string' ||
          !response.clientSecret.trim()
        ) {
          throw new PaymentError({
            code: 'BACKEND_ERROR',
            message: 'Invalid Klarna create-payment response from backend.',
            method: 'klarna',
            provider: 'klarna',
          });
        }
      },
    });
  }

  /**
   * Posts the Affirm create-payment wire contract.
   * Forwards validated merchant metadata only. Never forwards a client amount.
   */
  async createAffirmPayment(
    payload: AffirmCreatePaymentRequest | { productId: string; quantity: number; currency: string },
  ): Promise<CreateAffirmPaymentResponse> {
    const url = this.requireEndpoint(
      'affirmCreatePaymentUrl',
      'Backend affirmCreatePaymentUrl is not configured.',
      'affirm',
      'affirm',
    );

    const body = toAffirmCreatePaymentRequest(payload);
    if (body.metadata) {
      body.metadata = assertMerchantMetadata(body.metadata, 'affirm', 'affirm');
    }

    return this.postJson<CreateAffirmPaymentResponse>(url, body, 'affirm', 'affirm', {
      successMessage: 'Failed to create Affirm payment on backend.',
      networkMessage: 'A network error occurred while creating the Affirm payment session.',
      validate: (response) => {
        if (
          response?.provider !== 'affirm' ||
          typeof response.clientSecret !== 'string' ||
          !response.clientSecret.trim()
        ) {
          throw new PaymentError({
            code: 'BACKEND_ERROR',
            message: 'Invalid Affirm create-payment response from backend.',
            method: 'affirm',
            provider: 'affirm',
          });
        }
      },
    });
  }

  /**
   * Posts the ACH (US bank account) create-payment wire contract.
   * Forwards validated merchant metadata only. Never forwards a client amount.
   */
  async createUsBankAccountPayment(
    payload:
      | UsBankAccountCreatePaymentRequest
      | { productId: string; quantity: number; currency: string },
  ): Promise<CreateUsBankAccountPaymentResponse> {
    const url = this.requireEndpoint(
      'createUsBankAccountPaymentUrl',
      'Backend createUsBankAccountPaymentUrl is not configured.',
      'us-bank-account',
      'usBankAccount',
    );

    const body = toUsBankAccountCreatePaymentRequest(payload);
    if (body.metadata) {
      body.metadata = assertMerchantMetadata(body.metadata, 'us-bank-account', 'usBankAccount');
    }

    return this.postJson<CreateUsBankAccountPaymentResponse>(
      url,
      body,
      'us-bank-account',
      'usBankAccount',
      {
        successMessage: 'Failed to create US bank account payment on backend.',
        networkMessage:
          'A network error occurred while creating the US bank account payment session.',
        validate: (response) => {
          if (
            response?.provider !== 'usBankAccount' ||
            typeof response.clientSecret !== 'string' ||
            !response.clientSecret.trim()
          ) {
            throw new PaymentError({
              code: 'BACKEND_ERROR',
              message: 'Invalid US bank account create-payment response from backend.',
              method: 'us-bank-account',
              provider: 'usBankAccount',
            });
          }
        },
      },
    );
  }

  private endpointUrl(
    key:
      | 'createPaymentUrl'
      | 'paypalCreateOrderUrl'
      | 'paypalCaptureOrderUrl'
      | 'klarnaCreatePaymentUrl'
      | 'affirmCreatePaymentUrl'
      | 'createUsBankAccountPaymentUrl'
      | 'confirmPaymentUrl',
  ): string | undefined {
    const backend = this.configService.getSnapshot().backend;
    return backendEndpointUrl(backend, backend?.[key]);
  }

  private requireEndpoint(
    key:
      | 'createPaymentUrl'
      | 'paypalCreateOrderUrl'
      | 'paypalCaptureOrderUrl'
      | 'klarnaCreatePaymentUrl'
      | 'affirmCreatePaymentUrl'
      | 'createUsBankAccountPaymentUrl'
      | 'confirmPaymentUrl',
    missingMessage: string,
    method: PaymentMethod,
    provider: PaymentProviderName,
  ): string {
    const backend = this.configService.getSnapshot().backend;
    const result = resolveBackendUrl(backend?.baseUrl, backend?.[key]);
    if (result.ok) {
      return result.url;
    }
    if (result.code === 'missing-endpoint') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: missingMessage,
        method,
        provider,
      });
    }
    warnBackendUrlIssue(result.code);
    throw new PaymentError({
      code: 'CONFIG_INVALID',
      message:
        result.code === 'invalid-base-url'
          ? 'backend.baseUrl must be an absolute http or https URL.'
          : `${missingMessage.replace(' is not configured.', '')} must be a relative path or an absolute http(s) URL.`,
      method,
      provider,
    });
  }

  private async postJson<T>(
    url: string,
    payload: unknown,
    method: PaymentMethod,
    provider: PaymentProviderName,
    options: {
      successMessage: string;
      networkMessage: string;
      validate: (response: T) => void;
    },
  ): Promise<T> {
    if (!this.http) {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message:
          'HttpClient is required for backend integration. Call provideHttpClient() in your app config.',
        method,
        provider,
      });
    }

    try {
      const response = await firstValueFrom(this.http.post<T>(url, payload));
      options.validate(response);
      return response;
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }

      const network =
        error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500);

      let message = network ? options.networkMessage : options.successMessage;
      if (error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500) {
        const body = error.error as { message?: string | string[] } | string | null;
        if (body && typeof body === 'object' && body.message) {
          message = Array.isArray(body.message) ? body.message.join('; ') : String(body.message);
        } else if (typeof body === 'string' && body.trim()) {
          message = body;
        }
      }

      throw new PaymentError({
        code: network ? 'NETWORK_ERROR' : 'BACKEND_ERROR',
        message,
        method,
        provider,
        originalError: error,
      });
    }
  }
}
