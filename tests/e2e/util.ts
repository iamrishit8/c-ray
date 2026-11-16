import { zipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { join } from 'node:path';
import { FIXTURES, readDir } from '../helpers';

export function fixtureZip(name: string, root = name): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (const f of readDir(join(FIXTURES, name))) files[`${root}/${f.path}`] = f.bytes;
  return Buffer.from(zipSync(files));
}

export async function uploadZip(page: Page, name: string, buffer: Buffer) {
  await page.getByTestId('file-input').setInputFiles({ name: `${name}.zip`, mimeType: 'application/zip', buffer });
}

export async function analyzeFixture(page: Page, name: string) {
  await page.goto('/');
  await uploadZip(page, name, fixtureZip(name));
  await expect(page.getByTestId('project-name')).toHaveText(name);
  await expect(page.getByTestId('progress')).toHaveCount(0, { timeout: 90_000 });
}

export async function openTab(page: Page, id: string) {
  await page.getByTestId(`tab-${id}`).click();
}
