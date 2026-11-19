import { expect, test } from '@playwright/test';
import { analyzeFixture, openTab } from './util';

test('data view: ER diagram renders as SVG, entity fields and read/write map', async ({ page }) => {
  await analyzeFixture(page, 'nestjs-prisma');
  await openTab(page, 'data');
  // U3: the in-app diagram is interactive; the Mermaid version (used in exports) is one click away
  await page.getByTestId('er-mermaid-toggle').click();
  const er = page.getByTestId('er-diagram');
  await expect(er).toHaveAttribute('data-rendered', 'yes');
  await expect(er.locator('svg')).toBeVisible();
  await expect(er).toContainText('Comment');
  await page.getByTestId('entity-list').getByRole('button', { name: /Post/ }).click();
  const detail = page.getByTestId('entity-detail');
  await expect(detail).toContainText('authorId');
  await expect(detail).toContainText('→ User');
  await expect(page.getByTestId('entity-access')).toContainText('src/posts/posts.service.ts');
  await expect(page.getByTestId('entity-access')).toContainText('write');
});

test('data view works for SQL-only legacy projects', async ({ page }) => {
  await analyzeFixture(page, 'legacy-php');
  await openTab(page, 'data');
  await page.getByTestId('er-mermaid-toggle').click();
  await expect(page.getByTestId('er-diagram')).toHaveAttribute('data-rendered', 'yes');
  await page.getByTestId('entity-list').getByRole('button', { name: /users/ }).click();
  await expect(page.getByTestId('entity-access')).toContainText('pages/users.php');
});
