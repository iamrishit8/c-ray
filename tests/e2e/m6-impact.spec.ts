import { expect, test } from '@playwright/test';
import { analyzeFixture, openTab } from './util';

test('impact analysis: pick a symbol, see dependents, affected routes and risk', async ({ page }) => {
  await analyzeFixture(page, 'monorepo');
  await openTab(page, 'impact');
  await page.getByTestId('impact-input').fill('formatMoney');
  await page.getByTestId('impact-suggestions').getByRole('button').first().click();
  await expect(page.getByTestId('impact-risk')).toContainText('/100');
  await expect(page.getByTestId('impact-files')).toContainText('packages/api/src/services/invoiceService.ts');
  await expect(page.getByTestId('impact-files')).toContainText('packages/web/src/components/InvoiceList.tsx');
  await expect(page.getByTestId('impact-entries')).toContainText('POST /api/invoices');
  await page.getByTestId('impact-entries').getByRole('button', { name: 'POST /api/invoices' }).click();
  await expect(page.getByTestId('flow-title')).toHaveText('POST /api/invoices');
});
