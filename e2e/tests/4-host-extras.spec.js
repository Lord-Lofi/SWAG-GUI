import { test, expect } from '@playwright/test';
import { confRow, deletedRow, confFile, confExists, expectStatus, fillHost } from './helpers.js';

test.describe('upload size, duplicate and rename', () => {
  test('sets a custom upload size limit', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '+ Add host' }).click();
    await fillHost(page, { subdomain: 'nextcloud', upstreamApp: 'nextcloud', upstreamPort: 443 });
    await page.locator('#upstreamProto').selectOption('https');
    await page.locator('#upload').selectOption('custom');
    await page.getByLabel('Upload size', { exact: true }).fill('16');
    await page.getByLabel('Upload size unit').selectOption('g');
    await expect(page.getByText('client_max_body_size 16g;')).toBeVisible();
    await page.getByRole('button', { name: 'Create & Reload' }).click();

    await expectStatus(page, 'Created nextcloud.subdomain.conf and reloaded nginx.');
    expect(confFile('nextcloud.subdomain.conf')).toContain('client_max_body_size 16g;');

    // Reopening shows the same custom value
    await confRow(page, 'nextcloud.subdomain.conf').getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.locator('#upload')).toHaveValue('custom');
    await expect(page.getByLabel('Upload size', { exact: true })).toHaveValue('16');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('duplicates a host with all its settings under a new subdomain', async ({ page }) => {
    await page.goto('/');
    await confRow(page, 'nextcloud.subdomain.conf').getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.locator('#subdomain')).toHaveValue('');
    await expect(page.locator('#upstreamProto')).toHaveValue('https');
    await expect(page.locator('#upload')).toHaveValue('custom');
    await fillHost(page, { subdomain: 'cloud2', upstreamApp: 'nextcloud2' });
    await page.getByRole('button', { name: 'Create & Reload' }).click();

    await expectStatus(page, 'Created cloud2.subdomain.conf and reloaded nginx.');
    const copy = confFile('cloud2.subdomain.conf');
    expect(copy).toContain('server_name cloud2.*;');
    expect(copy).toContain('client_max_body_size 16g;');
    expect(confExists('nextcloud.subdomain.conf')).toBe(true);
  });

  test('renames a host by changing its subdomain', async ({ page }) => {
    await page.goto('/');
    await confRow(page, 'cloud2.subdomain.conf').getByRole('button', { name: 'Edit', exact: true }).click();
    await fillHost(page, { subdomain: 'files' });
    await expect(page.getByText(/Renames the host/)).toBeVisible();
    await page.getByRole('button', { name: 'Save & Reload' }).click();

    await expectStatus(page, 'Renamed cloud2.subdomain.conf to files.subdomain.conf and reloaded nginx.');
    expect(confExists('cloud2.subdomain.conf')).toBe(false);
    expect(confFile('files.subdomain.conf')).toContain('server_name files.*;');
    await expect(confRow(page, 'files.subdomain.conf').getByText('form')).toBeVisible();
    // The old name can still be brought back from the history
    await expect(deletedRow(page, 'cloud2.subdomain.conf')).toBeVisible();
  });

  test('refuses to rename onto an existing host', async ({ page }) => {
    await page.goto('/');
    await confRow(page, 'files.subdomain.conf').getByRole('button', { name: 'Edit', exact: true }).click();
    await fillHost(page, { subdomain: 'nextcloud' });
    await page.getByRole('button', { name: 'Save & Reload' }).click();
    await expect(page.getByText('nextcloud.subdomain.conf already exists')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(confExists('files.subdomain.conf')).toBe(true);
    expect(confFile('nextcloud.subdomain.conf')).toContain('server_name nextcloud.*;');
  });
});
