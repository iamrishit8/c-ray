// M10: Decisions view, Onboarding guide and their export sections, end to end on planted fixtures.
import { expect, test } from '@playwright/test';
import { analyzeFixture, openTab } from './util';

test('decisions: the team’s ADR first, evidence, honest reasons, category filter, keyboard', async ({ page }) => {
  await analyzeFixture(page, 'monorepo');
  await expect(page.getByTestId('tab-decisions')).toContainText('13');
  await openTab(page, 'decisions');

  const items = page.getByTestId('decision-item');
  await expect(items).toHaveCount(13);
  // the team's own record comes first and is selected by default
  await expect(items.first()).toContainText('Use a monorepo with shared types');
  const detail = page.getByTestId('decision-detail');
  await expect(detail).toContainText('Accepted');
  await expect(detail).toContainText('2023-03-14');
  await expect(page.getByTestId('decision-text')).toContainText('one repository');
  await expect(page.getByTestId('decision-why')).toContainText('drifting apart');
  await expect(page.getByTestId('decision-tradeoffs')).toContainText('compile errors');
  await expect(page.getByTestId('decision-observed')).toContainText('not checked that the code still follows it');

  // an inferred decision: evidence links open the source; no documented reason is claimed
  await page.getByTestId('decision-cat-Security').click();
  await expect(items).toHaveCount(1);
  await expect(detail).toContainText('requireAdmin');
  await expect(page.getByTestId('decision-why')).toContainText('The repository does not say why');
  await expect(page.getByTestId('decision-observed')).toContainText('1 of 4 routes');
  await page.getByTestId('decision-evidence').locator('.file').first().click();
  await expect(page.getByTestId('source-panel')).toBeVisible();

  // arrow keys move through the list
  await page.getByTestId('decision-cat-all').click();
  await items.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toHaveAttribute('aria-current', 'true');
});

test('decisions: an unresolved decision says so', async ({ page }) => {
  await analyzeFixture(page, 'spring-boot');
  await openTab(page, 'decisions');
  await page.getByTestId('decision-cat-Security').click();
  await expect(page.getByTestId('decision-detail')).toContainText('No authentication mechanism was recognised.');
  await expect(page.getByTestId('decision-detail')).toContainText('unresolved');
  await expect(page.getByTestId('decision-detail')).toContainText('Either the API is open');
});

test('decision rationale quoted from the README is shown as the project’s own words', async ({ page }) => {
  await analyzeFixture(page, 'express-mongoose');
  await openTab(page, 'decisions');
  await page.getByTestId('decision-cat-Stack').click();
  await page.getByTestId('decision-item').filter({ hasText: 'Application framework' }).click();
  await expect(page.getByTestId('decision-why')).toContainText('We chose Express because the team already knew it');
  await expect(page.getByTestId('decision-why')).toContainText('README.md');
});

test('onboarding: checklist, reading path, how to run, glossary, and Open-in-imex', async ({ page }) => {
  await analyzeFixture(page, 'express-mongoose');
  await openTab(page, 'onboarding');

  const checklist = page.getByTestId('onboarding-checklist');
  await expect(page.getByTestId('checklist-progress')).toHaveText('0 of 11 done');
  await expect(page.getByTestId('check-run')).toContainText('npm install');
  await expect(page.getByTestId('check-run')).toContainText('npm start');
  await expect(page.getByTestId('check-env')).toContainText('MONGO_URL, PORT, PAYMENT_URL');
  await checklist.getByLabel('Done: Get it running locally').check();
  await expect(page.getByTestId('checklist-progress')).toHaveText('1 of 11 done');
  // ticks survive a reload of the page (per-viewer, local)
  await page.reload();
  // the stored analysis (with its onboarding guide) opens from IndexedDB
  await page.getByTestId('project-row').getByRole('button', { name: 'Open' }).click();
  await openTab(page, 'onboarding');
  await expect(page.getByTestId('checklist-progress')).toHaveText('1 of 11 done');

  // reading path: docs first, rough edges last
  const steps = page.getByTestId('onboarding-path').locator('li[data-testid^="path-"]');
  await expect(steps.first()).toHaveAttribute('data-testid', 'path-docs');
  await expect(steps.last()).toHaveAttribute('data-testid', 'path-rough');

  // how to run: commands carry their confidence; env examples come from the template only
  const run = page.getByTestId('onboarding-run');
  await expect(run.getByTestId('run-command').filter({ hasText: 'npm start' })).toContainText('resolved');
  await expect(run.getByTestId('run-command').filter({ hasText: 'npm install' })).toContainText('heuristic');
  await expect(page.getByTestId('run-env')).toContainText('mongodb://localhost:27017/shop');
  await expect(run).toContainText('Node.js 20');

  // glossary: filter
  await page.getByTestId('onboarding-glossary').getByLabel('Filter glossary').fill('passwordHash');
  await expect(page.getByTestId('glossary-term')).toHaveCount(1);
  await expect(page.getByTestId('glossary-term')).toHaveAttribute('data-term', 'User');

  // a checklist action jumps to the right view with the right focus
  await page.getByTestId('check-trace').getByText('Open in imex').click();
  await expect(page.getByTestId('flow-title')).toContainText('POST /api/orders');
});

test('export: decisions and onboarding are sections, and appear in the report', async ({ page }) => {
  await analyzeFixture(page, 'monorepo');
  await openTab(page, 'export');
  await expect(page.getByTestId('section-decisions')).toBeChecked();
  await expect(page.getByTestId('section-onboarding')).toBeChecked();
  const report = page.getByTestId('report');
  await expect(report.locator('[data-section="onboarding"]')).toContainText('First-week checklist');
  await expect(report.locator('[data-section="decisions"]')).toContainText('Use a monorepo with shared types');
  await page.getByTestId('section-decisions').uncheck();
  await expect(report.locator('[data-section="decisions"]')).toHaveCount(0);
});

test('a File Mode project has no decisions or onboarding tabs', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: 'solo.py', mimeType: 'text/x-python', buffer: Buffer.from('def f():\n    return 1\n') });
  await expect(page.getByTestId('project-name')).toBeVisible();
  await expect(page.getByTestId('progress')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('tab-decisions')).toHaveCount(0);
  await expect(page.getByTestId('tab-onboarding')).toHaveCount(0);
});
