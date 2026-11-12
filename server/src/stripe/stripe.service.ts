import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { getCatalogProduct, resolveUnitAmount } from '../catalog/product-catalog';
import { mergePaymentIntentMetadata } from '../metadata/merchant-metadata';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { CreateKlarnaPaymentIntentDto } from './dto/create-klarna-payment-intent.dto';
import { CreateAffirmPaymentIntentDto } from './dto/create-affirm-payment-intent.dto';
import { CreateUsBankAccountPaymentIntentDto } from './dto/create-us-bank-account-payment-intent.dto';
import { CreateCashAppPayPaymentIntentDto } from './dto/create-cash-app-pay-payment-intent.dto';

export interface CreatePaymentIntentResult {
  provider: 'stripe';
  clientSecret: string;
  paymentIntentId: string;
}

export interface CreateKlarnaPaymentIntentResult {
  provider: 'klarna';
  clientSecret: string;
  paymentIntentId: string;
}

export interface CreateAffirmPaymentIntentResult {
  provider: 'affirm';
  clientSecret: string;
  paymentIntentId: string;
}

export interface CreateUsBankAccountPaymentIntentResult {
  provider: 'usBankAccount';
  clientSecret: string;
  paymentIntentId: string;
}

export interface CreateCashAppPayPaymentIntentResult {
  provider: 'cashAppPay';
  clientSecret: string;
  paymentIntentId: string;
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY')?.trim() ?? '';

    if (!secretKey) {
      this.stripe = null;
      this.logger.warn('STRIPE_SECRET_KEY is not configured. PaymentIntent creation will fail.');
      return;
    }

    if (!/^sk_test_/i.test(secretKey)) {
      this.stripe = null;
      this.logger.error(
        'STRIPE_SECRET_KEY must be a Stripe TEST secret key (sk_test_...). Live keys are blocked in this demo server.',
      );
      return;
    }

    this.stripe = new Stripe(secretKey);
  }

  async createPaymentIntent(dto: CreatePaymentIntentDto): Promise<CreatePaymentIntentResult> {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY=sk_test_... in server/.env',
      );
    }

    const catalogProduct = getCatalogProduct(dto.productId);
    if (!catalogProduct) {
      throw new BadRequestException(
        `Unknown productId "${dto.productId}". Use a catalog product (e.g. premium-plan).`,
      );
    }

    if (dto.currency.toUpperCase() !== catalogProduct.currency) {
      throw new BadRequestException(
        `Currency mismatch: catalog product uses ${catalogProduct.currency}, got ${dto.currency}.`,
      );
    }

    const unitAmount = resolveUnitAmount(catalogProduct, dto.amount);
    const unitAmountCents = Math.round(unitAmount * 100);
    if (!Number.isFinite(unitAmountCents) || unitAmountCents < 50) {
      throw new BadRequestException('Amount is too small for Stripe (minimum ~0.50).');
    }

    const totalAmount = unitAmountCents * dto.quantity;
    if (totalAmount > 99_999_999) {
      throw new BadRequestException('Total charge amount is too large.');
    }

    const description =
      dto.description?.trim() ||
      catalogProduct.name ||
      (typeof dto.metadata?.['productName'] === 'string'
        ? String(dto.metadata['productName'])
        : `Easy Payments demo: ${dto.productId}`);

    const safeMetadata = mergePaymentIntentMetadata(dto.metadata, {
      productId: dto.productId,
      quantity: String(dto.quantity),
      source: 'easy-payments-demo',
      unitAmount: String(unitAmount),
      catalogUnitAmount: String(catalogProduct.unitAmount),
    });

    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: totalAmount,
        currency: catalogProduct.currency.toLowerCase(),
        description,
        metadata: safeMetadata,
        // Easy Payments `card` must only collect cards — not Klarna/Cash App/bank, etc.
        payment_method_types: ['card'],
      });

      if (!intent.client_secret) {
        throw new InternalServerErrorException('Stripe did not return a client_secret.');
      }

      return {
        provider: 'stripe',
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      const stripeMessage =
        error instanceof Stripe.errors.StripeError
          ? error.message
          : 'Failed to create Stripe PaymentIntent.';

      this.logger.error(`PaymentIntent creation failed: ${stripeMessage}`);

      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        throw new BadRequestException(stripeMessage);
      }

      throw new InternalServerErrorException('Failed to create Stripe PaymentIntent.');
    }
  }

  /**
   * Klarna via Stripe PaymentIntent (official Stripe Klarna payment method).
   * Trusted catalog pricing — same product catalog as card payments.
   */
  async createKlarnaPaymentIntent(
    dto: CreateKlarnaPaymentIntentDto,
  ): Promise<CreateKlarnaPaymentIntentResult> {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY=sk_test_... in server/.env',
      );
    }

    const catalogProduct = getCatalogProduct(dto.productId);
    if (!catalogProduct) {
      throw new BadRequestException(
        `Unknown productId "${dto.productId}". Use a catalog product (e.g. premium-plan).`,
      );
    }

    if (dto.currency.toUpperCase() !== catalogProduct.currency) {
      throw new BadRequestException(
        `Currency mismatch: catalog product uses ${catalogProduct.currency}, got ${dto.currency}.`,
      );
    }

    // Klarna requests carry no client amount by contract: catalog price only.
    const unitAmountCents = Math.round(catalogProduct.unitAmount * 100);
    if (!Number.isFinite(unitAmountCents) || unitAmountCents < 50) {
      throw new BadRequestException('Catalog amount is too small for Stripe (minimum ~0.50).');
    }

    const totalAmount = unitAmountCents * dto.quantity;
    if (totalAmount > 99_999_999) {
      throw new BadRequestException('Total charge amount is too large.');
    }

    const description =
      dto.description?.trim() || catalogProduct.name || `Easy Payments Klarna: ${dto.productId}`;

    const safeMetadata = mergePaymentIntentMetadata(dto.metadata, {
      productId: dto.productId,
      quantity: String(dto.quantity),
      source: 'easy-payments-demo',
      paymentMethod: 'klarna',
      trustedUnitAmount: String(catalogProduct.unitAmount),
    });

    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: totalAmount,
        currency: catalogProduct.currency.toLowerCase(),
        description,
        metadata: safeMetadata,
        // Klarna-only PaymentIntent — keeps Card/Google Pay flows isolated.
        payment_method_types: ['klarna'],
        ...(dto.preferredLocale
          ? {
              payment_method_options: {
                klarna: {
                  preferred_locale:
                    dto.preferredLocale as Stripe.PaymentIntentCreateParams.PaymentMethodOptions.Klarna['preferred_locale'],
                },
              },
            }
          : {}),
      });

      if (!intent.client_secret) {
        throw new InternalServerErrorException('Stripe did not return a client_secret.');
      }

      return {
        provider: 'klarna',
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      const stripeMessage =
        error instanceof Stripe.errors.StripeError
          ? error.message
          : 'Failed to create Klarna PaymentIntent.';

      this.logger.error(`Klarna PaymentIntent creation failed: ${stripeMessage}`);

      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        throw new BadRequestException(stripeMessage);
      }

      throw new InternalServerErrorException('Failed to create Klarna PaymentIntent.');
    }
  }

  /**
   * Affirm via Stripe PaymentIntent (official Stripe Affirm payment method).
   * Trusted catalog pricing — same product catalog as card/Klarna payments.
   * Affirm US/CAD presentment: minimum typically $35 USD (see Stripe Affirm docs).
   */
  async createAffirmPaymentIntent(
    dto: CreateAffirmPaymentIntentDto,
  ): Promise<CreateAffirmPaymentIntentResult> {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY=sk_test_... in server/.env',
      );
    }

    const catalogProduct = getCatalogProduct(dto.productId);
    if (!catalogProduct) {
      throw new BadRequestException(
        `Unknown productId "${dto.productId}". Use a catalog product (e.g. premium-plan).`,
      );
    }

    const currency = dto.currency.toUpperCase();
    if (currency !== catalogProduct.currency) {
      throw new BadRequestException(
        `Currency mismatch: catalog product uses ${catalogProduct.currency}, got ${dto.currency}.`,
      );
    }

    // Affirm presentment currencies supported for Easy Payments demo target markets.
    if (currency !== 'USD' && currency !== 'CAD') {
      throw new BadRequestException(
        `Affirm via Stripe supports USD and CAD presentment in this demo (got ${currency}).`,
      );
    }

    // Affirm requests carry no client amount by contract: catalog price only.
    const unitAmountCents = Math.round(catalogProduct.unitAmount * 100);
    if (!Number.isFinite(unitAmountCents) || unitAmountCents < 50) {
      throw new BadRequestException('Catalog amount is too small for Stripe (minimum ~0.50).');
    }

    const totalAmount = unitAmountCents * dto.quantity;
    // Stripe Affirm docs: minimum about 35.00 USD / CAD presentment.
    const affirmMinCents = 3500;
    if (totalAmount < affirmMinCents) {
      throw new BadRequestException(
        `Affirm requires a minimum of about $35.00 (got ${(totalAmount / 100).toFixed(2)} ${currency}).`,
      );
    }
    // Stripe Affirm docs: maximum about 30,000.00 USD / CAD.
    const affirmMaxCents = 3_000_000;
    if (totalAmount > affirmMaxCents) {
      throw new BadRequestException(
        `Affirm maximum is about $30,000.00 (got ${(totalAmount / 100).toFixed(2)} ${currency}).`,
      );
    }

    const description =
      dto.description?.trim() || catalogProduct.name || `Easy Payments Affirm: ${dto.productId}`;

    const safeMetadata = mergePaymentIntentMetadata(dto.metadata, {
      productId: dto.productId,
      quantity: String(dto.quantity),
      source: 'easy-payments-demo',
      paymentMethod: 'affirm',
      trustedUnitAmount: String(catalogProduct.unitAmount),
    });

    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: totalAmount,
        currency: catalogProduct.currency.toLowerCase(),
        description,
        metadata: safeMetadata,
        // Affirm-only PaymentIntent — keeps Card/Klarna/Google Pay flows isolated.
        payment_method_types: ['affirm'],
        ...(dto.preferredLocale
          ? {
              payment_method_options: {
                affirm: {
                  preferred_locale: dto.preferredLocale,
                },
              },
            }
          : {}),
      });

      if (!intent.client_secret) {
        throw new InternalServerErrorException('Stripe did not return a client_secret.');
      }

      return {
        provider: 'affirm',
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      const stripeMessage =
        error instanceof Stripe.errors.StripeError
          ? error.message
          : 'Failed to create Affirm PaymentIntent.';

      this.logger.error(`Affirm PaymentIntent creation failed: ${stripeMessage}`);

      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        throw new BadRequestException(stripeMessage);
      }

      throw new InternalServerErrorException('Failed to create Affirm PaymentIntent.');
    }
  }

  /**
   * ACH Direct Debit (US bank account) via Stripe PaymentIntent.
   * Trusted catalog pricing — never trusts a client amount.
   * USD presentment only for this demo milestone.
   */
  async createUsBankAccountPaymentIntent(
    dto: CreateUsBankAccountPaymentIntentDto,
  ): Promise<CreateUsBankAccountPaymentIntentResult> {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY=sk_test_... in server/.env',
      );
    }

    const catalogProduct = getCatalogProduct(dto.productId);
    if (!catalogProduct) {
      throw new BadRequestException(
        `Unknown productId "${dto.productId}". Use a catalog product (e.g. premium-plan).`,
      );
    }

    const currency = dto.currency.toUpperCase();
    if (currency !== catalogProduct.currency) {
      throw new BadRequestException(
        `Currency mismatch: catalog product uses ${catalogProduct.currency}, got ${dto.currency}.`,
      );
    }

    if (currency !== 'USD') {
      throw new BadRequestException(
        `US bank account (ACH) supports USD presentment in this demo (got ${currency}).`,
      );
    }

    const unitAmountCents = Math.round(catalogProduct.unitAmount * 100);
    if (!Number.isFinite(unitAmountCents) || unitAmountCents < 50) {
      throw new BadRequestException('Catalog amount is too small for Stripe (minimum ~0.50).');
    }

    const totalAmount = unitAmountCents * dto.quantity;
    if (totalAmount > 99_999_999) {
      throw new BadRequestException('Total charge amount is too large.');
    }

    const description =
      dto.description?.trim() ||
      catalogProduct.name ||
      `Easy Payments US bank account: ${dto.productId}`;

    const safeMetadata = mergePaymentIntentMetadata(dto.metadata, {
      productId: dto.productId,
      quantity: String(dto.quantity),
      source: 'easy-payments-demo',
      paymentMethod: 'us-bank-account',
      trustedUnitAmount: String(catalogProduct.unitAmount),
    });

    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: totalAmount,
        currency: catalogProduct.currency.toLowerCase(),
        description,
        metadata: safeMetadata,
        // ACH-only PaymentIntent — keeps Card / Klarna / Affirm flows isolated.
        payment_method_types: ['us_bank_account'],
        payment_method_options: {
          us_bank_account: {
            verification_method: 'automatic',
            financial_connections: {
              permissions: ['payment_method'],
            },
          },
        },
      });

      if (!intent.client_secret) {
        throw new InternalServerErrorException('Stripe did not return a client_secret.');
      }

      return {
        provider: 'usBankAccount',
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      const stripeMessage =
        error instanceof Stripe.errors.StripeError
          ? error.message
          : 'Failed to create US bank account PaymentIntent.';

      this.logger.error(`US bank account PaymentIntent creation failed: ${stripeMessage}`);

      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        throw new BadRequestException(stripeMessage);
      }

      throw new InternalServerErrorException('Failed to create US bank account PaymentIntent.');
    }
  }

  /**
   * Cash App Pay via Stripe PaymentIntent (official Stripe cashapp payment method).
   * Trusted catalog pricing — never trusts a client amount.
   * US / USD only; Stripe minimum ~$0.50.
   */
  async createCashAppPayPaymentIntent(
    dto: CreateCashAppPayPaymentIntentDto,
  ): Promise<CreateCashAppPayPaymentIntentResult> {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY=sk_test_... in server/.env',
      );
    }

    const catalogProduct = getCatalogProduct(dto.productId);
    if (!catalogProduct) {
      throw new BadRequestException(
        `Unknown productId "${dto.productId}". Use a catalog product (e.g. premium-plan).`,
      );
    }

    const currency = dto.currency.toUpperCase();
    if (currency !== catalogProduct.currency) {
      throw new BadRequestException(
        `Currency mismatch: catalog product uses ${catalogProduct.currency}, got ${dto.currency}.`,
      );
    }

    if (currency !== 'USD') {
      throw new BadRequestException(
        `Cash App Pay supports USD presentment only (got ${currency}).`,
      );
    }

    const unitAmountCents = Math.round(catalogProduct.unitAmount * 100);
    if (!Number.isFinite(unitAmountCents) || unitAmountCents < 50) {
      throw new BadRequestException('Catalog amount is too small for Cash App Pay (minimum ~0.50).');
    }

    const totalAmount = unitAmountCents * dto.quantity;
    if (totalAmount > 99_999_999) {
      throw new BadRequestException('Total charge amount is too large.');
    }

    const description =
      dto.description?.trim() ||
      catalogProduct.name ||
      `Easy Payments Cash App Pay: ${dto.productId}`;

    const safeMetadata = mergePaymentIntentMetadata(dto.metadata, {
      productId: dto.productId,
      quantity: String(dto.quantity),
      source: 'easy-payments-demo',
      paymentMethod: 'cash-app-pay',
      trustedUnitAmount: String(catalogProduct.unitAmount),
    });

    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: totalAmount,
        currency: catalogProduct.currency.toLowerCase(),
        description,
        metadata: safeMetadata,
        // Cash App Pay-only PaymentIntent — keeps Card / Klarna / Affirm / ACH isolated.
        payment_method_types: ['cashapp'],
      });

      if (!intent.client_secret) {
        throw new InternalServerErrorException('Stripe did not return a client_secret.');
      }

      return {
        provider: 'cashAppPay',
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      const stripeMessage =
        error instanceof Stripe.errors.StripeError
          ? error.message
          : 'Failed to create Cash App Pay PaymentIntent.';

      this.logger.error(`Cash App Pay PaymentIntent creation failed: ${stripeMessage}`);

      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        throw new BadRequestException(stripeMessage);
      }

      throw new InternalServerErrorException('Failed to create Cash App Pay PaymentIntent.');
    }
  }
}
