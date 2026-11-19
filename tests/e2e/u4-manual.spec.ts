// U4: the Home help manual. Structure and navigation, terminology search, keyboard, and every worked example
// replayed on the real app (the examples are data in src/ui/help/content.ts, so the manual cannot drift unnoticed).
import { expect, test, type Page } from '@playwright/test';
import { PAGES, SECTIONS, TERMS, type Action, type PageEntry } from '../../src/ui/help/content';

async function openSample(page: Page) {
  await page.goto('/');
  await page.getByTestId('sample-project').click();
  await expect(page.getByTestId('project-name')).toHaveText('sample-express-api');
  await expect(page.getByTestId('progress')).toHaveCount(0, { timeout: 90_000 });
}

async function run(page: Page, a: Action) {
  if ('tab' in a) await page.getByTestId(`tab-${a.tab}`).click();
  else if ('click' in a) await page.getByTestId(a.click).first().click();
  else if ('clickText' in a) await page.getByTestId(a.within).getByText(a.clickText).first().click();
  else await page.getByTestId(a.fill).fill(a.value);
}

async function replay(page: Page, p: PageEntry) {
  for (const s of p.example.steps) for (const a of s.do ?? []) await run(page, a);
  for (const c of p.example.checks) {
    const el = page.getByTestId(c.testid).first();
    await expect(el, `${p.id}: ${c.testid}`).toBeVisible();
    if (c.text) await expect(el, `${p.id}: ${c.testid} contains "${c.text}"`).toContainText(c.text);
  }
}

test('home: hero, drop zone, stored projects, settings, then the manual', async ({ page }) => {
  await page.goto('/');
  const y = async (id: string) => (await page.getByTestId(id).first().boundingBox())!.y;
  const order = [await y('dropzone'), await y('project-list'), await y('settings-toggle'), await y('help-manual')];
  expect(order).toEqual([...order].sort((a, b) => a - b));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Understand an unfamiliar codebase');
  // the first-time path stays above the fold: the drop zone and the sample button are visible without scrolling
  await expect(page.getByTestId('sample-project')).toBeInViewport();
  for (const s of SECTIONS) await expect(page.getByTestId(`help-section-${s.id}`)).toHaveCount(1);
  await expect(page.getByTestId('help-page')).toHaveCount(PAGES.length);
});

test('manual: contents column on wide screens, section bar on narrow ones; links scroll and open entries', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('help-toc')).toBeVisible();
  await expect(page.getByTestId('help-nav')).toBeHidden();
  // a page link in the contents opens that entry and brings it into view
  await page.getByTestId('help-toc').getByRole('link', { name: 'Impact' }).click();
  const impact = page.locator('[data-testid="help-page"][data-page="impact"]');
  await expect(impact).toHaveJSProperty('open', true);
  await expect(impact).toBeInViewport();
  // scroll-spy marks exactly that entry (not the one above it) as the current location
  await expect(page.getByTestId('help-toc').locator('[aria-current="location"]')).toHaveText('Impact');
  await page.getByTestId('help-toc').getByRole('link', { name: 'Terms' }).click();
  await expect(page.getByTestId('help-section-terms')).toBeInViewport();

  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.getByTestId('help-toc')).toBeHidden();
  const bar = page.getByTestId('help-nav');
  await expect(bar).toBeVisible();
  await bar.getByRole('link', { name: 'Shortcuts' }).click();
  await expect(page.getByTestId('help-section-shortcuts')).toBeInViewport();
  // the bar sticks while the manual is on screen
  await expect(bar).toBeInViewport();
  await expect(bar.locator('[aria-current="location"]')).toHaveText('Shortcuts');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('manual: page entries are keyboard-operable details', async ({ page }) => {
  await page.goto('/');
  const entry = page.locator('[data-testid="help-page"][data-page="flows"]');
  await expect(entry).toHaveJSProperty('open', false);
  await entry.getByTestId('help-page-summary').focus();
  await page.keyboard.press('Enter');
  await expect(entry).toHaveJSProperty('open', true);
  await expect(entry.getByTestId('help-example')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(entry).toHaveJSProperty('open', false);
});

test('manual: terminology filters by term, alias and meaning, and says when nothing matches', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('help-term')).toHaveCount(TERMS.length);
  const search = page.getByTestId('help-term-search');
  await search.fill('bus factor');
  await expect(page.getByTestId('help-term')).toHaveCount(1);
  await expect(page.getByTestId('help-term')).toContainText('fewest people');
  await search.fill('cycle'); // an alias of "circular dependency"
  await expect(page.getByTestId('help-term').first()).toContainText('circular dependency');
  await search.fill('zzzz');
  await expect(page.getByTestId('help-term')).toHaveCount(0);
  await expect(page.getByTestId('help-section-terms')).toContainText('No term matches');
  await search.fill('');
  await expect(page.getByTestId('help-term')).toHaveCount(TERMS.length);
});

test('manual: confidence tooltips in the app use the manual wording; the nav lists exactly the documented pages', async ({ page }) => {
  await openSample(page);
  const tabs = await page.locator('[data-testid^="tab-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(4)));
  expect(tabs.sort()).toEqual(PAGES.filter((p) => p.id !== 'file-mode').map((p) => p.id).sort());
  const resolved = TERMS.find((t) => t.id === 'resolved')!.def;
  await page.getByTestId('tab-flows').click();
  await expect(page.locator('[data-conf="resolved"]').first()).toHaveAttribute('title', resolved);
});

test('manual: every worked example on the sample project does what it says', async ({ page }) => {
  test.setTimeout(240_000);
  await openSample(page);
  for (const p of PAGES.filter((x) => x.example.start === 'sample')) await replay(page, p);
});

test('manual: the File Mode example does what it says', async ({ page }) => {
  const p = PAGES.find((x) => x.id === 'file-mode')!;
  const start = p.example.start;
  if (start === 'sample') throw new Error('file-mode example must start from a single file');
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: start.file, mimeType: 'text/javascript', buffer: Buffer.from(start.text) });
  await expect(page.getByTestId('project-name')).toHaveText(start.file);
  await expect(page.getByTestId('progress')).toHaveCount(0, { timeout: 60_000 });
  await replay(page, p);
});

test('manual: works offline-safe (no requests leave the origin) and in dark mode', async ({ page }) => {
  const external: string[] = [];
  const origin = 'http://localhost:4317';
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  await page.goto('/');
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByTestId('help-toc').getByRole('link', { name: 'Privacy & limits' }).click();
  await expect(page.getByTestId('help-limit').first()).toBeVisible();
  expect(external).toEqual([]);
});
