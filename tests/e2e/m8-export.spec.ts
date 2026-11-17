import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { analyzeFixture, openTab } from './util';

test('export: Markdown, Notion ZIP and JSON downloads; section selection', async ({ page }) => {
  await analyzeFixture(page, 'express-mongoose');
  await openTab(page, 'export');

  const [md] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-md').click()]);
  expect(md.suggestedFilename()).toBe('express-mongoose-xray.md');
  const text = readFileSync((await md.path())!, 'utf8');
  expect(text).toContain('# express-mongoose');
  expect(text).toContain('## Routes and flows');
  expect(text).toContain('```mermaid');

  await page.getByTestId('section-hotspots').uncheck();
  const [md2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-md').click()]);
  expect(readFileSync((await md2.path())!, 'utf8')).not.toContain('## Hotspots and health');

  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-notion').click()]);
  const files = Object.keys(unzipSync(new Uint8Array(readFileSync((await zip.path())!))));
  expect(files).toContain('express-mongoose X-ray.md');
  expect(files.some((f) => f.startsWith('express-mongoose X-ray/01 Orientation'))).toBe(true);
  expect(files.some((f) => f.includes('Hotspots'))).toBe(false);

  const [json] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
  const data = JSON.parse(readFileSync((await json.path())!, 'utf8'));
  expect(data.name).toBe('express-mongoose');
  expect(data.routes.length).toBe(7);
});

test('print view: report renders, every Mermaid diagram becomes SVG, print stylesheet hides chrome', async ({ page }) => {
  await analyzeFixture(page, 'nestjs-prisma');
  await openTab(page, 'export');
  const report = page.getByTestId('report');
  await expect(report).toContainText('Data model');
  const diagrams = report.getByTestId('report-diagram');
  await expect(diagrams.first()).toHaveAttribute('data-rendered', 'yes');
  const n = await diagrams.count();
  expect(n).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < n; i++) {
    await diagrams.nth(i).scrollIntoViewIfNeeded();
    await expect(diagrams.nth(i), `diagram ${i}`).toHaveAttribute('data-rendered', 'yes');
    await expect(diagrams.nth(i).locator('svg')).toHaveCount(1);
  }
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('tab-export')).toBeHidden();
  await expect(page.getByTestId('export-md')).toBeHidden();
  await expect(report).toBeVisible();
  const pdf = await page.pdf({ format: 'A4' });
  expect(pdf.length).toBeGreaterThan(20_000);
});
