import { expect, test } from '@playwright/test';
import { analyzeFixture, openTab } from './util';

test('tree-sitter (L1) runs in the browser workers: Python symbols, heuristic edges', async ({ page }) => {
  await analyzeFixture(page, 'django-app');
  await openTab(page, 'symbols');
  await expect(page.getByTestId('functions')).toContainText('reserve_stock');
  await expect(page.getByTestId('functions').locator('[data-conf="heuristic"]').first()).toBeVisible();
  await openTab(page, 'map');
  await page.waitForFunction(() => (window as any).__cy?.edges('[conf="heuristic"]').length > 3);
  expect(await page.evaluate(() => (window as any).__cy.edges('[conf="resolved"]').length)).toBe(0);
});

test('Java + PHP parse in the browser; L1 accuracy is reported for TS projects', async ({ page }) => {
  await analyzeFixture(page, 'spring-boot');
  await openTab(page, 'symbols');
  await expect(page.getByTestId('functions')).toContainText('OrderService.placeOrder');
  await analyzeFixture(page, 'legacy-php');
  await openTab(page, 'symbols');
  await expect(page.getByTestId('functions')).toContainText('format_money');
  await analyzeFixture(page, 'nestjs-prisma');
  await expect(page.getByTestId('l1-accuracy')).toContainText('precision');
  await expect(page.getByTestId('parse-errors')).toHaveCount(0);
});
