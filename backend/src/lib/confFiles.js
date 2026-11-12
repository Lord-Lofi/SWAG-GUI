import { readdir, readFile, writeFile, copyFile, unlink, constants } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// The container runs as FILE_UID:FILE_GID (your SWAG PUID/PGID), so new and
// edited files already belong to SWAG's user. No chown, and no root, needed.

export async function list(confsPath) {
  const entries = await readdir(confsPath, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && (e.name.endsWith('.conf') || e.name.endsWith('.conf.sample')))
    .map(e => ({
      name: e.name,
      enabled: e.name.endsWith('.conf') && !e.name.endsWith('.conf.sample'),
      isSample: e.name.endsWith('.conf.sample'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function read(confsPath, filename) {
  return readFile(safePath(confsPath, filename), 'utf8');
}

export async function write(confsPath, filename, content) {
  const filePath = safePath(confsPath, filename);
  if (typeof content !== 'string') {
    throw Object.assign(new Error('content must be a string'), { status: 400 });
  }
  await writeFile(filePath, content, 'utf8');
}

export async function enableSample(confsPath, sampleName) {
  if (!sampleName.endsWith('.conf.sample')) {
    throw Object.assign(new Error('Target is not a .conf.sample file'), { status: 400 });
  }
  const source = safePath(confsPath, sampleName);
  const targetName = sampleName.replace(/\.sample$/, '');
  const dest = safePath(confsPath, targetName);
  // COPYFILE_EXCL: never overwrite an existing active config
  await copyFile(source, dest, constants.COPYFILE_EXCL).catch((err) => {
    if (err.code === 'EEXIST') {
      throw Object.assign(new Error(`${targetName} already exists`), { status: 409 });
    }
    throw err;
  });
  return targetName;
}

export async function remove(confsPath, filename) {
  if (!filename.endsWith('.conf') || filename.endsWith('.conf.sample')) {
    throw Object.assign(new Error('Only active .conf files can be deleted'), { status: 400 });
  }
  await unlink(safePath(confsPath, filename));
}

// Turns a filename from a request into a path inside confsPath, or rejects it.
//
// Two independent checks against path traversal ("../../etc/passwd"):
//   1. Allowlist: only letters, digits, dots, dashes and underscores, not
//      starting with a dot. SWAG conf names (e.g. app.subdomain.conf) fit.
//   2. The resolved path must still be inside confsPath.
const SAFE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function safePath(confsPath, filename) {
  const invalid = () => Object.assign(new Error('Invalid filename'), { status: 400 });
  if (typeof filename !== 'string' || filename.length > 255 || !SAFE_NAME.test(filename)) {
    throw invalid();
  }
  const root = resolve(confsPath);
  const filePath = resolve(root, filename);
  if (!filePath.startsWith(root + sep)) {
    throw invalid();
  }
  return filePath;
}
