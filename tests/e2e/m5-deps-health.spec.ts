import { expect, test } from '@playwright/test';
import { analyzeFixture, openTab } from './util';

test('dependencies view: cycle with edges, layering violation, packages', async ({ page }) => {
  await analyzeFixture(page, 'nestjs-prisma');
  await openTab(page, 'deps');
  const cycles = page.getByTestId('cycles');
  await expect(cycles).toContainText('src/users/users.service.ts');
  await expect(cycles).toContainText('src/posts/posts.service.ts');
  await expect(page.getByTestId('violations')).toContainText('src/posts/posts.controller.ts');
  await expect(page.getByTestId('packages')).toContainText('@nestjs/common');
  await expect(page.getByTestId('metrics')).toContainText('src/prisma/prisma.service.ts');
});

test('health view: secret, clone, dead export, TODO all link to source', async ({ page }) => {
  await analyzeFixture(page, 'nestjs-prisma');
  await openTab(page, 'health');
  await expect(page.getByTestId('findings-secret')).toContainText('src/auth/constants.ts');
  await expect(page.getByTestId('findings-clone')).toContainText('Duplicated block');
  await expect(page.getByTestId('findings-dead-export')).toContainText('unusedHelper');
  await expect(page.getByTestId('findings-todo')).toContainText('HACK');
  await page.getByTestId('findings-secret').locator('[data-ref]').first().click();
  await expect(page.getByTestId('source-panel')).toContainText('API_KEY');
});
