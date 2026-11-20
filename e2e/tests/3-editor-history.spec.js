import { test, expect } from '@playwright/test';
import { confRow, deletedRow, confFile, confExists, expectStatus } from './helpers.js';

test.describe('editor, history and status', () => {
  test('a broken edit is refused by nginx -t and the file is put back', async ({ page }) => {
    await page.goto('/');
    const before = confFile('media.subdomain.conf');
    await confRow(page, 'media.subdomain.conf').getByRole('button', { name: 'Edit file' }).click();
    const editor = page.locator('.monaco-editor').first();
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nthis is not nginx');
    await page.getByRole('button', { name: 'Save & Reload' }).click();

    await expectStatus(page, 'was put back as it was');
    expect(confFile('media.subdomain.conf')).toBe(before);
    await expect(editor).toBeVisible();
  });

  test('restores an earlier version from the history', async ({ page }) => {
    await page.goto('/');
    await confRow(page, 'jellyfin.subdomain.conf').getByRole('button', { name: 'History' }).click();
    await expect(page.locator('.monaco-diff-editor')).toBeVisible();
    await page.getByRole('button', { name: 'Restore this version' }).click();

    await expectStatus(page, 'Restored jellyfin.subdomain.conf and reloaded nginx.');
    expect(confFile('jellyfin.subdomain.conf')).toContain('set $upstream_port 8096;');
  });

  test('a deleted file can be brought back', async ({ page }) => {
    await page.goto('/');
    page.once('dialog', (d) => d.accept());
    await confRow(page, 'sonarr.subfolder.conf').getByRole('button', { name: 'Delete' }).click();
    await expectStatus(page, 'Deleted sonarr.subfolder.conf and reloaded nginx.');
    expect(confExists('sonarr.subfolder.conf')).toBe(false);

    await deletedRow(page, 'sonarr.subfolder.conf').getByRole('button', { name: 'View / restore' }).click();
    await page.getByRole('button', { name: 'Restore file' }).click();
    await expectStatus(page, 'Restored sonarr.subfolder.conf and reloaded nginx.');
    expect(confExists('sonarr.subfolder.conf')).toBe(true);
    await expect(deletedRow(page, 'sonarr.subfolder.conf')).toHaveCount(0);
  });

  test('the status tab shows the image, protocols and certificate', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Status' }).click();
    await expect(page.getByText('5.10.0-ls501')).toBeVisible();
    await expect(page.getByText('example.test, *.example.test')).toBeVisible();
    await page.getByRole('button', { name: 'Run renewal check' }).click();
    await expect(page.getByText('Certificate not yet due for renewal')).toBeVisible();
  });
});
