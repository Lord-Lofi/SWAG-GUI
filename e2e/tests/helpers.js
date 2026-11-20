import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { CONFS } from '../harness/paths.mjs';

// A row in the Active Configs list, by file name
export const confRow = (page, name) => page.locator(`[data-conf="${name}"]`);
export const templateRow = (page, name) => page.locator(`[data-template="${name}"]`);
export const deletedRow = (page, name) => page.locator(`[data-deleted="${name}"]`);

// What the GUI actually wrote to disk
export const confFile = (name) => readFileSync(join(CONFS, name), 'utf8');
export const confExists = (name) => existsSync(join(CONFS, name));

// The status bar at the top shows the result of every action
export async function expectStatus(page, text) {
  await expect(page.getByText(text).first()).toBeVisible();
}

// Fills the add/edit host form
export async function fillHost(page, { subdomain, upstreamApp, upstreamPort }) {
  if (subdomain !== undefined) await page.locator('#subdomain').fill(subdomain);
  if (upstreamApp !== undefined) await page.locator('#upstreamApp').fill(upstreamApp);
  if (upstreamPort !== undefined) await page.locator('#upstreamPort').fill(String(upstreamPort));
}
