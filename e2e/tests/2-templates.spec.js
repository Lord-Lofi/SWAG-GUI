import { test, expect } from '@playwright/test';
import { confRow, templateRow, confFile, expectStatus } from './helpers.js';

test.describe('templates and settings', () => {
  test('activates a template with a different subdomain and port', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Templates' }).click();
    await templateRow(page, 'plex.subdomain.conf.sample').getByRole('button', { name: 'Activate…' }).click();

    await expect(page.locator('#upstreamApp')).toHaveValue('plex');
    await page.locator('#subdomain').fill('media');
    await page.locator('#upstreamPort').fill('32401');
    await page.locator('#auth').selectOption('none');
    await expect(page.getByText('Preview: media.subdomain.conf')).toBeVisible();
    await page.getByRole('button', { name: 'Activate & Reload' }).click();

    await expectStatus(page, 'Activated media.subdomain.conf and reloaded nginx.');
    const file = confFile('media.subdomain.conf');
    expect(file).toContain('server_name media.*;');
    expect(file.match(/set \$upstream_port 32401;/g)).toHaveLength(2);
    expect(file).toContain('proxy_set_header X-Plex-Client-Identifier'); // the rest of the template is kept
  });

  test('switches sign-in and error pages on an activated template', async ({ page }) => {
    await page.goto('/');
    const row = confRow(page, 'media.subdomain.conf');
    await row.locator('select').selectOption('authelia');
    await expectStatus(page, 'Sign-in set to Authelia for media.subdomain.conf; nginx reloaded.');
    expect(confFile('media.subdomain.conf')).toMatch(/^    include \/config\/nginx\/authelia-server\.conf;$/m);

    await row.getByRole('switch', { name: 'Error pages' }).click();
    await expectStatus(page, /Error pages switched (on|off) for media\.subdomain\.conf/);
  });

  test('subfolder templates offer no error-pages switch', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Templates' }).click();
    await templateRow(page, 'sonarr.subfolder.conf.sample').getByRole('button', { name: 'Activate…' }).click();
    await expect(page.locator('#subdomain')).toHaveCount(0);
    await page.getByRole('button', { name: 'Activate & Reload' }).click();
    await expectStatus(page, 'Activated sonarr.subfolder.conf and reloaded nginx.');
    await expect(confRow(page, 'sonarr.subfolder.conf').getByRole('switch', { name: 'Error pages' })).toBeDisabled();
  });
});
