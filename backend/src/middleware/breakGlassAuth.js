// Password protection for the break-glass port.
//
// The break-glass port skips SWAG and Authelia so you can still fix a broken
// config when the proxy is down. It therefore needs its own login: HTTP Basic
// auth, checked against a scrypt hash kept in .env (never the password itself).
//
// Basic auth sends the password with every request, and the break-glass port
// is plain HTTP, so only use it from your own LAN.
import { scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const KEY_LENGTH = 32;

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// Hash format: scrypt:<salt>:<hash>, both base64url. No "$" characters, so
// Docker Compose does not try to expand anything in it.
export function parseHash(value) {
  const parts = (value ?? '').trim().split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return null;
  const salt = Buffer.from(parts[1], 'base64url');
  const hash = Buffer.from(parts[2], 'base64url');
  if (salt.length < 16 || hash.length !== KEY_LENGTH) return null;
  return { salt, hash };
}

export function loadBreakGlassCredential(env) {
  const parsed = parseHash(env.BREAKGLASS_PASSWORD_HASH);
  if (!parsed) return null;
  return { user: env.BREAKGLASS_USER || 'admin', ...parsed };
}

const sha256 = (value) => createHash('sha256').update(value).digest();

export function breakGlassAuth(credential) {
  const expectedUser = sha256(credential.user);
  const failures = new Map(); // ip -> { count, since, lockedUntil }
  let lastGoodHeader = null; // sha256 of the last accepted header, skips re-hashing

  function challenge(res) {
    res.set('WWW-Authenticate', 'Basic realm="SWAG Config break-glass", charset="UTF-8"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  return function breakGlassAuthMiddleware(req, res, next) {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const record = failures.get(ip);
    if (record && record.lockedUntil > now) {
      res.set('Retry-After', String(Math.ceil((record.lockedUntil - now) / 1000)));
      return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    }

    const header = req.get('Authorization') ?? '';
    if (!header.startsWith('Basic ')) return challenge(res);

    const headerDigest = sha256(header);
    if (lastGoodHeader && timingSafeEqual(headerDigest, lastGoodHeader)) return next();

    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    const user = sep >= 0 ? decoded.slice(0, sep) : '';
    const password = sep >= 0 ? decoded.slice(sep + 1) : '';

    const userOk = timingSafeEqual(sha256(user), expectedUser);
    const passwordOk = timingSafeEqual(
      scryptSync(password, credential.salt, KEY_LENGTH, SCRYPT_PARAMS),
      credential.hash
    );

    if (userOk && passwordOk) {
      failures.delete(ip);
      lastGoodHeader = headerDigest;
      return next();
    }

    if (failures.size > 10_000) failures.clear();
    // Count failures within a 15-minute window; the 5th locks the address out.
    const fresh = !record || record.since < now - LOCKOUT_MS || record.lockedUntil;
    const count = fresh ? 1 : record.count + 1;
    const locked = count >= MAX_FAILURES;
    failures.set(ip, {
      count,
      since: fresh ? now : record.since,
      lockedUntil: locked ? now + LOCKOUT_MS : 0,
    });
    console.warn(
      `[break-glass] Failed login from ${ip} (${count}/${MAX_FAILURES})` +
        (locked ? ' - locked out for 15 minutes' : '')
    );
    return challenge(res);
  };
}
