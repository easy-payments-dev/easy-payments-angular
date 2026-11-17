import { Module } from '@nestjs/common';
import { PayPalController } from './paypal.controller';
import { PayPalService } from './paypal.service';
import { VenmoAttemptStore } from './venmo-attempt.store';

@Module({
  controllers: [PayPalController],
  providers: [VenmoAttemptStore, PayPalService],
  exports: [PayPalService, VenmoAttemptStore],
})
export class PayPalModule {}
