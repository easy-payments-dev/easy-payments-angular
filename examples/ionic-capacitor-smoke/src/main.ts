import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  RouteReuseStrategy,
  provideRouter,
  withComponentInputBinding,
  withPreloading,
  PreloadAllModules,
} from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { provideSmokeEasyPayments, smokeEnv } from './app/smoke-payments.config';
import {
  applySmokeStripeReturnSearch,
  evaluateSmokeStripeReturnUrl,
  formatSmokeStripeReturnLog,
  parseSmokeNativeReturnConfig,
} from './app/capacitor-stripe-return';
import {
  VENMO_FALLBACK_INCOMING_EVENT,
  dispatchVenmoFallbackReturn,
  evaluateVenmoChromeFallbackReturn,
  formatVenmoFallbackReturnLog,
  readVenmoFallbackPending,
} from './app/venmo-chrome-fallback';

function pendingStripeAttemptIdFromStorage(): string | null {
  try {
    const raw = sessionStorage.getItem('ep.stripe.redirect.pending');
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { attemptId?: string };
    return typeof parsed.attemptId === 'string' ? parsed.attemptId : null;
  } catch {
    return null;
  }
}

function handleIncomingVenmoFallbackReturn(url: string, source: 'appUrlOpen' | 'getLaunchUrl'): boolean {
  const nativeReturnUrl = smokeEnv.nativeStripeReturnUrl?.trim() ?? '';
  if (!nativeReturnUrl) {
    return false;
  }

  // Stop resume-dismiss before we touch pending / evaluate.
  window.dispatchEvent(new CustomEvent(VENMO_FALLBACK_INCOMING_EVENT));

  const pending = readVenmoFallbackPending();
  const decision = evaluateVenmoChromeFallbackReturn(
    url,
    { nativeReturnUrl },
    { pendingAttemptId: pending?.attemptId ?? null },
  );
  console.info(`[ep-smoke] ${formatVenmoFallbackReturnLog(decision, url)} (${source})`);

  if (decision.kind !== 'handle') {
    return decision.reason !== 'unrelated';
  }

  // Keep pending until Home finishes verify/cancel so attempt correlation stays intact.
  dispatchVenmoFallbackReturn(decision.detail);
  return true;
}

function handleIncomingStripeReturn(url: string, source: 'appUrlOpen' | 'getLaunchUrl'): void {
  const nativeReturnUrl = smokeEnv.nativeStripeReturnUrl?.trim() ?? '';
  if (!nativeReturnUrl) {
    console.info(`[ep-smoke] ${source}: nativeStripeReturnUrl not configured — ignoring deep link`);
    return;
  }

  const decision = evaluateSmokeStripeReturnUrl(
    url,
    { nativeReturnUrl },
    { pendingAttemptId: pendingStripeAttemptIdFromStorage() },
  );
  console.info(`[ep-smoke] ${formatSmokeStripeReturnLog(decision, url)} (${source})`);

  if (decision.kind !== 'apply') {
    return;
  }
  applySmokeStripeReturnSearch(decision.search);
}

function handleIncomingAppLink(url: string, source: 'appUrlOpen' | 'getLaunchUrl'): void {
  // Venmo Chrome fallback shares the App Link host — try it before Stripe merge.
  if (handleIncomingVenmoFallbackReturn(url, source)) {
    return;
  }
  handleIncomingStripeReturn(url, source);
}

/**
 * Capacitor App Links (warm) + cold start via getLaunchUrl.
 * Browser checkout is unchanged — this path is native-only.
 */
async function wireCapacitorReturnHandling(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  const parsed = parseSmokeNativeReturnConfig(smokeEnv.nativeStripeReturnUrl);
  if (!parsed) {
    console.info(
      '[ep-smoke] Set environment.nativeStripeReturnUrl to a public https App Link before leave-app BNPL tests',
    );
  }

  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) {
      handleIncomingAppLink(launch.url, 'getLaunchUrl');
    }
  } catch {
    // Older plugins / web shim — ignore.
  }

  await App.addListener('appUrlOpen', ({ url }) => {
    handleIncomingAppLink(url, 'appUrlOpen');
  });
}

void wireCapacitorReturnHandling();

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideZonelessChangeDetection(),
    provideHttpClient(),
    provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
    provideSmokeEasyPayments(),
  ],
}).catch((err) => console.error(err));
