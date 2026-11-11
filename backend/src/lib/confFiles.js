import { readdir, readFile, writeFile, copyFile, unlink, constants } from 'node:fs/promises';
import { join } from 'node:path';

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
  assertSafeFilename(filename);
  return readFile(join(confsPath, filename), 'utf8');
}

export async function write(confsPath, filename, content) {
  assertSafeFilename(filename);
  const filePath = join(confsPath, filename);
  if (typeof content !== 'string') {
    throw Object.assign(new Error('content must be a string'), { status: 400 });
  }
  await writeFile(filePath, content, 'utf8');
}

export async function enableSample(confsPath, sampleName) {
  if (!sampleName.endsWith('.conf.sample')) {
    throw Object.assign(new Error('Target is not a .conf.sample file'), { status: 400 });
  }
  assertSafeFilename(sampleName);
  const targetName = sampleName.replace(/\.sample$/, '');
  const dest = join(confsPath, targetName);
  // COPYFILE_EXCL: never overwrite an existing active config
  await copyFile(join(confsPath, sampleName), dest, constants.COPYFILE_EXCL).catch((err) => {
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
  assertSafeFilename(filename);
  await unlink(join(confsPath, filename));
}

// Reject any filename that could be used for path traversal
function assertSafeFilename(filename) {
  if (
    typeof filename !== 'string' ||
    !filename ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..') ||
    filename.includes('\0')
  ) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
}
