import { expect, test } from '@playwright/test';
import { analyzeFixture, openTab } from './util';

test('flow tracer: pick a route, see ordered steps linked to source', async ({ page }) => {
  await analyzeFixture(page, 'express-mongoose');
  await expect(page.getByTestId('frameworks')).toContainText('Express');
  await openTab(page, 'flows');
  await page.getByTestId('entry-filter').fill('POST /api/orders');
  await page.getByTestId('entry-list').getByRole('button').first().click();
  await expect(page.getByTestId('flow-title')).toHaveText('POST /api/orders');
  const steps = page.getByTestId('flow-steps');
  await expect(steps.locator('[data-kind="middleware"]').first()).toContainText('logger');
  await expect(steps.locator('[data-kind="handler"]')).toContainText('create');
  await expect(steps).toContainText('placeOrder');
  await expect(steps.locator('[data-kind="db"]').filter({ hasText: 'write Order' }).first()).toBeVisible();
  await expect(steps.locator('[data-kind="http"]')).toContainText('axios');
  await steps.locator('[data-kind="handler"] [data-ref]').first().click();
  await expect(page.getByTestId('source-panel')).toContainText('exports.create');
  await expect(page.getByTestId('flow-graph')).toBeVisible();
});

test('flows for Spring (heuristic) show dashed-confidence steps and Kafka publish', async ({ page }) => {
  await analyzeFixture(page, 'spring-boot');
  await openTab(page, 'flows');
  await page.getByTestId('entry-filter').fill('POST /api/orders');
  await page.getByTestId('entry-list').getByRole('button').first().click();
  const steps = page.getByTestId('flow-steps');
  await expect(steps).toContainText('OrderService.placeOrder');
  await expect(steps.locator('[data-kind="queue"]')).toContainText('orders.placed');
  await expect(steps.locator('[data-conf="heuristic"]').first()).toBeVisible();
});
