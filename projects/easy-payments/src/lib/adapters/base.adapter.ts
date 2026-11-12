import { inject } from '@angular/core';
import {
  PaymentContext,
  PaymentMethod,
  PaymentProviderName,
  PaymentRequest,
  PaymentResult,
  normalizePaymentResult,
} from '../models';
import { PaymentError } from '../errors/payment-error';
import { PaymentProviderAdapter } from '../core/payment-provider.adapter';
import { MockPaymentController } from './mock/mock-payment.controller';

export function realPaymentsNotImplemented(
  method: PaymentMethod,
  provider: PaymentProviderName,
): PaymentError {
  return new PaymentError({
    code: 'PROVIDER_NOT_IMPLEMENTED',
    message: `Real ${method} payments are not implemented yet. Use enableMockMode for development. No real payment was processed.`,
    method,
    provider,
  });
}

export abstract class BaseMockAdapter implements PaymentProviderAdapter {
  abstract readonly provider: PaymentProviderName;
  abstract readonly method: PaymentMethod;
  readonly isMock = true;

  protected readonly mockController = inject(MockPaymentController);

  async initialize(): Promise<void> {
    // Mock adapters require no SDK initialization.
  }

  async isAvailable(_context: PaymentContext): Promise<boolean> {
    return this.mockController.isMethodAvailable(this.method);
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    const delay = this.mockController.delayMs();
    if (delay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }

    const outcome = this.mockController.outcome();
    const demoNotice = 'No real payment was processed.';

    if (outcome === 'cancelled') {
      return normalizePaymentResult({
        status: 'cancelled',
        method: request.method,
        provider: this.provider,
        message: `[DEMO] Mock ${this.method} payment was cancelled. ${demoNotice}`,
        metadata: {
          mock: true,
          productId: request.context.product.id,
        },
      });
    }

    if (outcome === 'failed') {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: `[DEMO] Mock ${this.method} payment failed. ${demoNotice}`,
        method: request.method,
        provider: this.provider,
      });
    }

    if (outcome === 'processing') {
      return normalizePaymentResult({
        status: 'processing',
        method: request.method,
        provider: this.provider,
        transactionId: `mock_${this.provider}_${Date.now()}`,
        message: `[DEMO] Mock ${this.method} payment is still processing. Do not treat this as success — confirm the final status on your backend. ${demoNotice}`,
        metadata: {
          mock: true,
          productId: request.context.product.id,
          amount: request.context.product.amount,
          currency: request.context.product.currency,
        },
      });
    }

    return normalizePaymentResult({
      status: 'success',
      method: request.method,
      provider: this.provider,
      transactionId: `mock_${this.provider}_${Date.now()}`,
      message: `[DEMO] Mock ${this.method} payment completed. This is not a real transaction. ${demoNotice}`,
      metadata: {
        mock: true,
        productId: request.context.product.id,
        amount: request.context.product.amount,
        currency: request.context.product.currency,
      },
    });
  }
}

export abstract class BaseProviderAdapter implements PaymentProviderAdapter {
  abstract readonly provider: PaymentProviderName;
  readonly isMock = false;
  protected initialized = false;

  abstract initialize(): Promise<void>;
  abstract isAvailable(context: PaymentContext): Promise<boolean>;
  abstract createPayment(request: PaymentRequest): Promise<PaymentResult>;

  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`${this.provider} adapter is not initialized.`);
    }
  }
}
