import { InjectionToken } from '@angular/core';
import type { EasyPaymentsConfig } from './easy-payments.config';

export const EASY_PAYMENTS_CONFIG = new InjectionToken<EasyPaymentsConfig>('EASY_PAYMENTS_CONFIG');
