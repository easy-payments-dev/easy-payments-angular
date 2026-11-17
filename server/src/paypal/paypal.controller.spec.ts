import { Test, TestingModule } from '@nestjs/testing';
import { CapturePayPalOrderDto } from './dto/capture-paypal-order.dto';
import { CreatePayPalOrderDto } from './dto/create-paypal-order.dto';
import { PayPalController } from './paypal.controller';
import { PayPalService } from './paypal.service';

describe('PayPalController', () => {
  it('delegates create and capture', async () => {
    const paypalService = {
      createOrder: jest.fn().mockResolvedValue({ provider: 'paypal', orderId: 'O-1' }),
      captureOrder: jest.fn().mockResolvedValue({
        provider: 'paypal',
        orderId: 'O-1',
        captureId: 'C-1',
        status: 'COMPLETED',
      }),
      getOrderStatus: jest.fn().mockResolvedValue({
        provider: 'paypal',
        orderId: 'O-1',
        status: 'COMPLETED',
        captureId: 'C-1',
      }),
      createVenmoHandoff: jest.fn().mockResolvedValue({
        provider: 'paypal',
        funding: 'venmo',
        attemptId: 'attempt00000001',
        orderId: 'O-V',
        status: 'PAYER_ACTION_REQUIRED',
        links: [{ rel: 'self', href: 'https://api.sandbox.paypal.com/v2/checkout/orders/O-V' }],
        approvalUrl: null,
        handoff: 'official_button',
        product: {
          productId: 'premium-plan',
          name: 'Premium Plan',
          quantity: 1,
          amount: '99.00',
          currency: 'USD',
        },
      }),
      completeVenmoHandoff: jest.fn().mockResolvedValue({
        provider: 'paypal',
        funding: 'venmo',
        attemptId: 'attempt00000001',
        orderId: 'O-V',
        status: 'COMPLETED',
        captureId: 'C-V',
        idempotent: false,
      }),
      getVenmoAttempt: jest.fn().mockResolvedValue({
        provider: 'paypal',
        funding: 'venmo',
        attemptId: 'attempt00000001',
        orderId: 'O-V',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayPalController],
      providers: [{ provide: PayPalService, useValue: paypalService }],
    }).compile();

    const controller = module.get(PayPalController);

    const createDto: CreatePayPalOrderDto = {
      provider: 'paypal',
      productId: 'premium-plan',
      quantity: 1,
    };
    await expect(controller.createOrder(createDto)).resolves.toEqual({
      provider: 'paypal',
      orderId: 'O-1',
    });
    expect(paypalService.createOrder).toHaveBeenCalledWith(createDto);

    const captureDto: CapturePayPalOrderDto = { orderId: 'O-1' };
    await expect(controller.captureOrder(captureDto)).resolves.toEqual(
      expect.objectContaining({ captureId: 'C-1' }),
    );
    expect(paypalService.captureOrder).toHaveBeenCalledWith('O-1');

    await expect(controller.getOrderStatus({ orderId: 'O-1' })).resolves.toEqual(
      expect.objectContaining({ status: 'COMPLETED', captureId: 'C-1' }),
    );
    expect(paypalService.getOrderStatus).toHaveBeenCalledWith('O-1');

    await expect(
      controller.createVenmoHandoff({
        attemptId: 'attempt00000001',
        productId: 'premium-plan',
        returnUrl: 'https://www.easy-payments.dev/capacitor-return',
        cancelUrl: 'https://www.easy-payments.dev/capacitor-return',
      }),
    ).resolves.toEqual(expect.objectContaining({ handoff: 'official_button', approvalUrl: null }));
    expect(paypalService.createVenmoHandoff).toHaveBeenCalled();

    await expect(
      controller.completeVenmoHandoff({ attemptId: 'attempt00000001', orderId: 'O-V' }),
    ).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED', captureId: 'C-V' }));
  });
});
