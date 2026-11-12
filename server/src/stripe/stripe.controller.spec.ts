import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';

describe('StripeController', () => {
  let controller: StripeController;
  let service: {
    createPaymentIntent: jest.Mock;
    createKlarnaPaymentIntent: jest.Mock;
    createAffirmPaymentIntent: jest.Mock;
    createUsBankAccountPaymentIntent: jest.Mock;
    createCashAppPayPaymentIntent: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      createPaymentIntent: jest.fn(),
      createKlarnaPaymentIntent: jest.fn(),
      createAffirmPaymentIntent: jest.fn(),
      createUsBankAccountPaymentIntent: jest.fn(),
      createCashAppPayPaymentIntent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeController],
      providers: [{ provide: StripeService, useValue: service }],
    }).compile();

    controller = module.get(StripeController);
  });

  it('returns the PaymentIntent client secret on success', async () => {
    service.createPaymentIntent.mockResolvedValue({
      provider: 'stripe',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_1',
    });

    await expect(
      controller.createPaymentIntent({
        provider: 'stripe',
        productId: 'premium-plan',
        quantity: 1,
        currency: 'USD',
        amount: 99.99,
      }),
    ).resolves.toEqual({
      provider: 'stripe',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_1',
    });
  });

  it('propagates service failures', async () => {
    service.createPaymentIntent.mockRejectedValue(
      new InternalServerErrorException('Failed to create Stripe PaymentIntent.'),
    );

    await expect(
      controller.createPaymentIntent({
        provider: 'stripe',
        productId: 'premium-plan',
        quantity: 1,
        currency: 'USD',
        amount: 99.99,
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('propagates invalid request failures from the service', async () => {
    service.createPaymentIntent.mockRejectedValue(new BadRequestException('invalid amount'));

    await expect(
      controller.createPaymentIntent({
        provider: 'stripe',
        productId: 'premium-plan',
        quantity: 1,
        currency: 'USD',
        amount: -1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a Klarna PaymentIntent via the dedicated endpoint', async () => {
    service.createKlarnaPaymentIntent.mockResolvedValue({
      provider: 'klarna',
      clientSecret: 'pi_klarna_secret',
      paymentIntentId: 'pi_klarna_1',
    });

    await expect(
      controller.createKlarnaPaymentIntent({
        provider: 'klarna',
        productId: 'premium-plan',
        quantity: 1,
        currency: 'USD',
      }),
    ).resolves.toEqual({
      provider: 'klarna',
      clientSecret: 'pi_klarna_secret',
      paymentIntentId: 'pi_klarna_1',
    });
  });

  it('creates an Affirm PaymentIntent via the dedicated endpoint', async () => {
    service.createAffirmPaymentIntent.mockResolvedValue({
      provider: 'affirm',
      clientSecret: 'pi_affirm_secret',
      paymentIntentId: 'pi_affirm_1',
    });

    await expect(
      controller.createAffirmPaymentIntent({
        provider: 'affirm',
        productId: 'premium-plan',
        quantity: 1,
        currency: 'USD',
      }),
    ).resolves.toEqual({
      provider: 'affirm',
      clientSecret: 'pi_affirm_secret',
      paymentIntentId: 'pi_affirm_1',
    });
  });

  it('creates a Cash App Pay PaymentIntent via the dedicated endpoint', async () => {
    service.createCashAppPayPaymentIntent.mockResolvedValue({
      provider: 'cashAppPay',
      clientSecret: 'pi_cash_secret',
      paymentIntentId: 'pi_cash_1',
    });

    await expect(
      controller.createCashAppPayPaymentIntent({
        provider: 'cashAppPay',
        productId: 'premium-plan',
        quantity: 1,
        currency: 'USD',
      }),
    ).resolves.toEqual({
      provider: 'cashAppPay',
      clientSecret: 'pi_cash_secret',
      paymentIntentId: 'pi_cash_1',
    });
  });
});
