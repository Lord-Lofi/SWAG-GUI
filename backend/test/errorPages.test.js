import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, SNIPPET, INCLUDE_LINE, install, status } from '../src/lib/errorPages.js';

const PAGES_DIR = fileURLToPath(new URL('../src/errorpages/', import.meta.url));

for (const name of PAGES) {
  test(`${name} is self-contained and safe`, async () => {
    const html = await readFile(join(PAGES_DIR, name), 'utf8');
    assert.match(html, /^<!doctype html>/i);
    assert.doesNotMatch(html, /<script|javascript:|\son[a-z]+\s*=/i, 'no scripts or inline event handlers');
    assert.doesNotMatch(html, /https?:\/\/|\bsrc\s*=|@import|url\(/i, 'no outside requests');
    assert.doesNotMatch(html, /<!--#|\$\{?[a-z_]/i, 'no server-side includes or nginx variables (nothing echoed)');
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.ok(html.length < 8192, 'stays small');
  });
}

test('snippet only covers nginx-generated errors', () => {
  assert.match(SNIPPET, /error_page 502 503 504 \/__errorpages\/50x\.html;/);
  assert.match(SNIPPET, /^\s+internal;$/m, 'pages are not reachable directly');
  assert.doesNotMatch(SNIPPET, /proxy_intercept_errors\s+on/, 'apps keep their own error responses');
  assert.doesNotMatch(SNIPPET, /=200/, 'real status codes are kept');
  assert.equal(INCLUDE_LINE, 'include /config/nginx/proxy-confs/errorpages.conf;');
});

test('install writes the snippet and pages; status tracks changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'errorpages-'));
  try {
    assert.equal((await status(dir)).installed, false);
    const after = await install(dir);
    assert.deepEqual([after.installed, after.upToDate], [true, true]);
    assert.equal(await readFile(join(dir, 'errorpages.conf'), 'utf8'), SNIPPET);
    assert.deepEqual((await readdir(join(dir, 'errorpages'))).sort(), [...PAGES].sort());

    await writeFile(join(dir, 'errorpages', '404.html'), 'edited', 'utf8');
    assert.deepEqual(Object.values(await status(dir)).slice(0, 2), [true, false], 'edited page is reported as outdated');
    assert.equal((await install(dir)).upToDate, true, 'install refreshes it');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
