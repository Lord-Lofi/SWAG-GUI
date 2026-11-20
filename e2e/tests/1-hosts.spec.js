import { test, expect } from '@playwright/test';
import { confRow, confFile, confExists, expectStatus, fillHost } from './helpers.js';

test.describe('proxy hosts', () => {
  test('adds a host with the form; nginx accepts it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '+ Add host' }).click();
    await fillHost(page, { subdomain: 'jellyfin', upstreamApp: 'jellyfin', upstreamPort: 8096 });
    await expect(page.getByText('Preview: jellyfin.subdomain.conf')).toBeVisible();
    await page.getByRole('button', { name: 'Create & Reload' }).click();

    await expectStatus(page, 'Created jellyfin.subdomain.conf and reloaded nginx.');
    await expect(confRow(page, 'jellyfin.subdomain.conf').getByText('form')).toBeVisible();
    const file = confFile('jellyfin.subdomain.conf');
    expect(file).toContain('set $upstream_port 8096;');
    expect(file).toMatch(/^    include \/config\/nginx\/authelia-server\.conf;$/m);
  });

  test('refuses bad input before anything is written', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '+ Add host' }).click();
    await fillHost(page, { subdomain: 'bad', upstreamApp: 'bad', upstreamPort: 99999 });
    await expect(page.getByText('upstreamPort: use a port number from 1 to 65535')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create & Reload' })).toBeDisabled();

    await fillHost(page, { upstreamPort: 80, upstreamApp: 'bad; include /etc/passwd' });
    await expect(page.getByText(/upstreamApp: use a container name/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(confExists('bad.subdomain.conf')).toBe(false);
  });

  test('edits a form-made host with the form, including sign-in and allow list', async ({ page }) => {
    await page.goto('/');
    await confRow(page, 'jellyfin.subdomain.conf').getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.locator('#subdomain')).toHaveValue('jellyfin');
    await expect(page.locator('#upstreamPort')).toHaveValue('8096');

    await fillHost(page, { upstreamPort: 8920 });
    await page.locator('#auth').selectOption('authentik');
    await page.locator('#access').selectOption('lan');
    await expect(page.getByText('allow 192.168.0.0/16;')).toBeVisible();
    await page.getByRole('button', { name: 'Save & Reload' }).click();

    await expectStatus(page, 'Saved jellyfin.subdomain.conf and reloaded nginx.');
    const file = confFile('jellyfin.subdomain.conf');
    expect(file).toContain('set $upstream_port 8920;');
    expect(file).toMatch(/^    include \/config\/nginx\/authentik-server\.conf;$/m);
    expect(file).toContain('    deny all;');
    await expect(confRow(page, 'jellyfin.subdomain.conf').locator('select')).toHaveValue('authentik');
  });
});
