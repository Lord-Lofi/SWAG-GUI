// Earlier versions of config files, so a change made in the GUI can be
// compared and undone.
//
// Before the GUI changes or deletes a file, the old content is kept in a
// hidden folder next to the configs:
//
//   <proxy-confs>/.swag-gui-history/<file name>/<time>__<action>.conf
//
// SWAG only loads *.subdomain.conf and *.subfolder.conf from proxy-confs
// itself, never from subfolders, so nginx ignores this folder. It lives on
// the same volume as the configs, so it's included in whatever backs them up.
//
// The newest MAX_VERSIONS versions per file are kept; older ones are removed.
// History of deleted files is kept too, so they can be restored.
import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export const HISTORY_DIR = '.swag-gui-history';
export const MAX_VERSIONS = 20;

// What caused the change, shown in the history list
export const ACTIONS = new Set(['edit', 'form', 'setting', 'delete', 'restore', 'rename']);

// Same rule as config file names (see confFiles.js)
const SAFE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
// "2026-11-19T05-30-12-123Z__edit.conf"
const VERSION_ID = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)__([a-z]+)\.conf$/;

function invalid(message = 'Invalid file or version') {
  return Object.assign(new Error(message), { status: 400 });
}

// The history folder for one file, checked to stay inside the history root
function fileDir(confsPath, filename) {
  if (typeof filename !== 'string' || filename.length > 255 || !SAFE_NAME.test(filename)) throw invalid();
  const root = resolve(confsPath, HISTORY_DIR);
  const dir = resolve(root, filename);
  if (!dir.startsWith(root + sep)) throw invalid();
  return dir;
}

function parseVersion(id) {
  const m = typeof id === 'string' ? id.match(VERSION_ID) : null;
  if (!m) return null;
  const [date, time] = m[1].split('T');
  const iso = `${date}T${time.slice(0, 8).replace(/-/g, ':')}.${time.slice(9, 12)}Z`;
  return { id, time: iso, action: m[2] };
}

// Keeps `content` as a version of `filename`. Never throws: a history
// problem must not block the change itself, so it is only logged.
export async function record(confsPath, filename, content, action, now = new Date()) {
  try {
    if (!ACTIONS.has(action)) throw invalid('Unknown history action');
    const dir = fileDir(confsPath, filename);
    await mkdir(dir, { recursive: true });
    const stamp = now.toISOString().replace(/:/g, '-').replace('.', '-');
    await writeFile(resolve(dir, `${stamp}__${action}.conf`), content, { encoding: 'utf8', flag: 'wx' });
    await prune(dir);
  } catch (err) {
    console.error(`[history] could not save a version of ${filename}: ${err.message}`);
  }
}

async function prune(dir) {
  const versions = (await readdir(dir)).filter((n) => VERSION_ID.test(n)).sort();
  for (const old of versions.slice(0, Math.max(0, versions.length - MAX_VERSIONS))) {
    await unlink(resolve(dir, old));
  }
}

// Versions of one file, newest first
export async function versions(confsPath, filename) {
  const dir = fileDir(confsPath, filename);
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return names.map(parseVersion).filter(Boolean).sort((a, b) => b.id.localeCompare(a.id));
}

export async function read(confsPath, filename, versionId) {
  if (!parseVersion(versionId)) throw invalid();
  const path = resolve(fileDir(confsPath, filename), versionId);
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw Object.assign(new Error('That version no longer exists'), { status: 404 });
    throw err;
  }
}

// Every file that has history, with its newest version
export async function files(confsPath) {
  const root = resolve(confsPath, HISTORY_DIR);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || !SAFE_NAME.test(e.name)) continue;
    const list = await versions(confsPath, e.name);
    if (list.length === 0) continue;
    out.push({ name: e.name, count: list.length, latest: list[0] });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
