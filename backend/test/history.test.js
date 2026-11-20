import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as history from '../src/lib/history.js';
import * as confFiles from '../src/lib/confFiles.js';

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'swag-gui-history-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const at = (s) => new Date(`2026-11-19T10:00:${String(s).padStart(2, '0')}.000Z`);

test('keeps versions newest first, with time and action', () => withDir(async (dir) => {
  await history.record(dir, 'plex.subdomain.conf', 'one', 'edit', at(1));
  await history.record(dir, 'plex.subdomain.conf', 'two', 'form', at(2));
  const list = await history.versions(dir, 'plex.subdomain.conf');
  assert.deepEqual(list.map((v) => [v.time, v.action]), [
    ['2026-11-19T10:00:02.000Z', 'form'],
    ['2026-11-19T10:00:01.000Z', 'edit'],
  ]);
  assert.equal(await history.read(dir, 'plex.subdomain.conf', list[1].id), 'one');
}));

test(`keeps only the newest ${history.MAX_VERSIONS} versions per file`, () => withDir(async (dir) => {
  for (let i = 0; i < history.MAX_VERSIONS + 5; i++) {
    await history.record(dir, 'a.subdomain.conf', `v${i}`, 'edit', at(i));
  }
  const list = await history.versions(dir, 'a.subdomain.conf');
  assert.equal(list.length, history.MAX_VERSIONS);
  assert.equal(await history.read(dir, 'a.subdomain.conf', list.at(-1).id), 'v5', 'oldest ones removed');
}));

test('lists files with history, including deleted ones', () => withDir(async (dir) => {
  await history.record(dir, 'b.subdomain.conf', 'x', 'delete', at(1));
  await history.record(dir, 'a.subdomain.conf', 'y', 'edit', at(2));
  const files = await history.files(dir);
  assert.deepEqual(files.map((f) => [f.name, f.count, f.latest.action]), [
    ['a.subdomain.conf', 1, 'edit'],
    ['b.subdomain.conf', 1, 'delete'],
  ]);
  assert.deepEqual(await history.files(join(dir, 'nothing-here')), [], 'no history yet');
}));

test('the history folder is invisible to the config list and to nginx', () => withDir(async (dir) => {
  await history.record(dir, 'a.subdomain.conf', 'y', 'edit', at(1));
  assert.deepEqual(await confFiles.list(dir), [], 'not listed as a config');
  assert.deepEqual(await readdir(dir), [history.HISTORY_DIR], 'only a hidden folder; SWAG loads *.subdomain.conf files, not folders');
  await assert.rejects(confFiles.read(dir, history.HISTORY_DIR), { status: 400 }, 'not reachable through the config API');
}));

test('rejects unsafe file names and version ids', () => withDir(async (dir) => {
  for (const bad of ['../x.conf', '.swag-gui-history', 'a/b.conf', '', 'x'.repeat(300)]) {
    await assert.rejects(history.versions(dir, bad), { status: 400 });
  }
  for (const bad of ['../../etc/passwd', '2026__edit.conf', 'x.conf', '2026-11-19T10-00-01-000Z__edit.conf/../../a']) {
    await assert.rejects(history.read(dir, 'a.subdomain.conf', bad), { status: 400 });
  }
  await assert.rejects(history.read(dir, 'a.subdomain.conf', '2026-11-19T10-00-01-000Z__edit.conf'), { status: 404 });
}));

test('a history problem never throws', () => withDir(async (dir) => {
  // A file where the history folder should be: the folder can't be created
  await writeFile(join(dir, history.HISTORY_DIR), 'in the way');
  await history.record(dir, 'a.subdomain.conf', 'x', 'edit');
  await history.record(dir, 'a.subdomain.conf', 'x', 'not-an-action');
}));
