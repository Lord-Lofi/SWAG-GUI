// Creates the BREAKGLASS_PASSWORD_HASH value for .env.
//
//   npm run hash-password
//
// Type the password when asked (it is not shown). Paste the printed line into
// your .env file. Never commit .env or paste the hash anywhere public.
import { randomBytes, scryptSync } from 'node:crypto';
import { SCRYPT_PARAMS, KEY_LENGTH } from '../src/middleware/breakGlassAuth.js';

const MIN_LENGTH = 16;

function readHidden(prompt) {
  return new Promise((resolve) => {
    const { stdin, stderr } = process;
    stderr.write(prompt);
    let value = '';
    if (!stdin.isTTY) {
      stdin.setEncoding('utf8');
      stdin.on('data', (d) => (value += d));
      stdin.on('end', () => resolve(value.replace(/\r?\n$/, '')));
      return;
    }
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const onData = (ch) => {
      if (ch === '\u0003') process.exit(130); // Ctrl+C
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        stderr.write('\n');
        resolve(value);
      } else if (ch === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const password = await readHidden('Break-glass password: ');
if (password.length < MIN_LENGTH) {
  console.error(`Use at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}
if (process.stdin.isTTY) {
  const again = await readHidden('Type it again: ');
  if (again !== password) {
    console.error('The passwords do not match.');
    process.exit(1);
  }
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
console.log(`BREAKGLASS_PASSWORD_HASH=scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`);
