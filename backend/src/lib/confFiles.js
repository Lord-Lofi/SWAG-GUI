import { readdir, readFile, writeFile, copyFile, unlink, chown } from 'fs/promises';
import { join } from 'path';

const FILE_UID = parseInt(process.env.FILE_UID ?? '1000', 10);
const FILE_GID = parseInt(process.env.FILE_GID ?? '1000', 10);

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
  await writeFile(filePath, content, 'utf8');
  await chown(filePath, FILE_UID, FILE_GID);
}

export async function enableSample(confsPath, sampleName) {
  if (!sampleName.endsWith('.conf.sample')) {
    throw Object.assign(new Error('Target is not a .conf.sample file'), { status: 400 });
  }
  assertSafeFilename(sampleName);
  const targetName = sampleName.replace(/\.sample$/, '');
  const dest = join(confsPath, targetName);
  await copyFile(join(confsPath, sampleName), dest);
  await chown(dest, FILE_UID, FILE_GID);
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
  if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\0')) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
}
