// M9: upload a ZIP that includes .git and walk the History view end to end.
import { expect, test } from '@playwright/test';
import { zipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { gitHistoryFiles, gitMovesFiles } from '../git-fixture';
import { analyzeFixture, openTab, uploadZip } from './util';

async function gitHistoryZip(): Promise<Buffer> {
  const files: Record<string, Uint8Array> = {};
  for (const f of await gitHistoryFiles()) files[`git-history/${f.path}`] = f.bytes;
  return Buffer.from(zipSync(files));
}

test('history: churn, co-change, bus factor, time-travel, hotspots and export', async ({ page }) => {
  await page.goto('/');
  await uploadZip(page, 'git-history', await gitHistoryZip());
  await expect(page.getByTestId('project-name')).toHaveText('git-history');
  await expect(page.getByTestId('progress')).toHaveCount(0, { timeout: 90_000 });

  await openTab(page, 'history');
  await expect(page.getByTestId('history-stats')).toContainText('12');
  await expect(page.getByTestId('bus-factor')).toHaveText('1');

  const churn = page.getByTestId('history-churn');
  await expect(churn.locator('tbody tr').first()).toContainText('src/');
  await expect(churn).toContainText('src/services/pricing.ts');

  const cochange = page.getByTestId('history-cochange');
  await expect(cochange.locator('tbody tr')).toHaveCount(1);
  await expect(cochange).toContainText('src/services/pricing.ts');
  await expect(cochange).toContainText('src/services/tax.ts');
  await expect(cochange).toContainText('hidden coupling');

  await expect(page.getByTestId('history-risky')).toContainText('src/legacy/report.ts');
  await expect(page.getByTestId('history-risky')).toContainText('Carol');
  await expect(page.getByTestId('history-types').locator('[data-type="feat"]')).toContainText('3');

  // time-travel: oldest snapshot → HEAD
  await expect(page.getByTestId('history-timeline').locator('li')).toHaveCount(10);
  const modules = page.getByTestId('snap-modules');
  await expect(modules.locator('[data-change="added"]')).toHaveCount(3);
  await expect(modules).toContainText('src/billing');
  await expect(modules).toContainText('src/legacy');
  await expect(page.getByTestId('snap-edges')).toContainText('src/billing → src/services');

  // from the v1.0 release instead: the legacy module already existed then
  const fromSelect = page.getByTestId('snap-from');
  const v1 = await fromSelect.locator('option', { hasText: 'v1.0' }).getAttribute('value');
  await fromSelect.selectOption(v1!);
  await expect(modules).toContainText('src/billing');
  await expect(modules.locator('[data-change="added"]', { hasText: 'src/legacy' })).toHaveCount(0);

  // the source link opens the preview
  await churn.getByRole('button', { name: 'src/legacy/report.ts', exact: true }).click();
  await expect(page.getByTestId('source-panel')).toContainText('salesReport');

  // churn × complexity hotspots now appear in Health
  await openTab(page, 'health');
  await expect(page.getByTestId('findings-hotspot')).toContainText('src/services/pricing.ts');

  // and the export has a History section
  await openTab(page, 'export');
  const [md] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-md').click()]);
  const text = readFileSync((await md.path())!, 'utf8');
  expect(text).toContain('## History');
  expect(text).toContain('no: hidden coupling');
});

test('history: a project without .git shows an explanation', async ({ page }) => {
  await analyzeFixture(page, 'express-mongoose');
  await openTab(page, 'history');
  await expect(page.getByTestId('history-empty')).toContainText('.git');
});

test('history: renamed files keep their history and are listed with confidence', async ({ page }) => {
  const files: Record<string, Uint8Array> = {};
  for (const f of await gitMovesFiles()) files[`git-moves/${f.path}`] = f.bytes;
  await page.goto('/');
  await uploadZip(page, 'git-moves', Buffer.from(zipSync(files)));
  await expect(page.getByTestId('progress')).toHaveCount(0, { timeout: 90_000 });
  await openTab(page, 'history');

  const renames = page.getByTestId('history-renames');
  await expect(renames.locator('tbody tr')).toHaveCount(2);
  await expect(renames.locator('tbody tr').first()).toContainText('lib/fmt.js');
  await expect(renames.locator('tbody tr').first().locator('[data-conf]')).toHaveText('heuristic');
  await expect(renames.locator('tbody tr').nth(1).locator('[data-conf]')).toHaveText('resolved');
  // churn for the renamed file includes the commits made under its old name (5, not 2)
  const row = page.getByTestId('history-churn').locator('tbody tr', { hasText: 'lib/helpers.js' });
  await expect(row.locator('td').nth(1)).toHaveText('5');
});
