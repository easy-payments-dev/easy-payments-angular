import { expect, test } from '@playwright/test';

/**
 * Browser smoke for Full Checkout / Buttons Only / Headless under Mock mode.
 * Start the app with: npx ng serve --port 4201
 */
const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4201';

async function selectSurface(page: import('@playwright/test').Page, label: 'Full' | 'Buttons' | 'Headless') {
  await page.locator('ion-segment-button', { hasText: label }).click();
}

async function setMockOutcome(
  page: import('@playwright/test').Page,
  outcome: 'success' | 'cancelled' | 'failed',
) {
  await page.locator('ion-select').click();
  await page.locator('ion-item.select-interface-option', { hasText: new RegExp(`^${outcome}$`) }).click();
}

async function payMockCard(page: import('@playwright/test').Page) {
  const cardTile = page.getByRole('button', { name: /^card$/i }).first();
  if (await cardTile.isVisible().catch(() => false)) {
    await cardTile.click();
  }
  const pay = page
    .getByRole('button', { name: /pay \$|complete demo payment|pay with card/i })
    .first();
  await pay.click({ timeout: 15_000 });
}

test.describe('Ionic smoke — Mock surfaces', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText('EP Ionic Smoke')).toBeVisible({ timeout: 30_000 });
  });

  test('Full Checkout renders and mock success completes', async ({ page }) => {
    await selectSurface(page, 'Full');
    await expect(page.locator('easy-payments')).toBeVisible({ timeout: 15_000 });
    await payMockCard(page);
    await expect(page.locator('ion-chip', { hasText: /last:\s*success/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Mock cancellation is reported', async ({ page }) => {
    await setMockOutcome(page, 'cancelled');
    await selectSurface(page, 'Full');
    await payMockCard(page);
    await expect(page.locator('.log')).toContainText(/cancel/i, { timeout: 15_000 });
  });

  test('Mock failure is reported', async ({ page }) => {
    await setMockOutcome(page, 'failed');
    await selectSurface(page, 'Full');
    await payMockCard(page);
    await expect(page.locator('.log')).toContainText(/error/i, { timeout: 15_000 });
  });

  test('Buttons Only surface mounts', async ({ page }) => {
    await selectSurface(page, 'Buttons');
    await expect(page.locator('easy-payment-buttons')).toBeVisible({ timeout: 15_000 });
  });

  test('Headless surface mounts a method', async ({ page }) => {
    await selectSurface(page, 'Headless');
    await expect(page.getByTestId('headless-host')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.log')).toContainText(/headless mounted/i, { timeout: 20_000 });
  });
});
