import { expect, test } from '@playwright/test';
import { analyzeFixture, fixtureZip, uploadZip } from './util';

test('analyse → orientation appears → survives refresh → reopen', async ({ page }) => {
  await analyzeFixture(page, 'express-mongoose');
  await expect(page.getByTestId('summary')).toContainText('express-mongoose');
  await expect(page.getByTestId('stack')).toContainText('Express');
  await expect(page.getByTestId('read-first')).toContainText('src/');
  await expect(page.getByTestId('git-message')).toContainText('.git folder');

  await page.reload();
  const row = page.getByTestId('project-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('express-mongoose');
  await expect(page.getByTestId('storage-used')).toContainText('Storage used');
  await row.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('summary')).toContainText('express-mongoose');

  // source preview comes from IndexedDB after a reload
  await page.getByTestId('read-first').locator('[data-ref]').nth(1).click();
  await expect(page.getByTestId('source-panel').locator('[data-line]').first()).toBeVisible();
  await expect(page.getByTestId('source-missing')).toHaveCount(0);
});

test('expired projects are purged on start; "clear all" empties storage', async ({ page }) => {
  await analyzeFixture(page, 'django-app');
  await page.goto('/');
  await uploadZip(page, 'legacy-php', fixtureZip('legacy-php'));
  await expect(page.getByTestId('project-name')).toHaveText('legacy-php');
  await expect(page.getByTestId('progress')).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByTestId('project-row')).toHaveCount(2);

  // age one project past its expiry
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('c-ray'); // DB name kept across the rename to imex (D33)
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('projects', 'readwrite');
        const store = tx.objectStore('projects');
        const all = store.getAll();
        all.onsuccess = () => {
          const p = all.result.find((x: { name: string }) => x.name === 'django-app');
          p.expiresAt = Date.now() - 1000;
          store.put(p);
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(page.getByTestId('project-row')).toHaveCount(1);
  await expect(page.getByTestId('project-row')).toContainText('legacy-php');
  await expect(page.getByTestId('notice-banner')).toContainText('expired');

  page.once('dialog', (d) => d.accept());
  await page.getByTestId('clear-all').click();
  await expect(page.getByTestId('project-row')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('project-row')).toHaveCount(0);
});

test('retention setting changes expiry; theme toggle works', async ({ page }) => {
  await analyzeFixture(page, 'legacy-php');
  await page.goto('/');
  await page.getByTestId('retention').selectOption('forever');
  await expect(page.getByTestId('project-row')).toContainText('never');
  const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.getByTestId('theme-toggle').click();
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!before);
});
