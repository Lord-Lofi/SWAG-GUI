// Health of one SWAG instance: which SWAG image it runs and how old it is,
// the nginx and PHP versions inside it, whether HTTP/2 and HTTP/3 are on,
// and the certificate's domains and expiry.
//
// nginx, PHP and certbot are only updated by pulling a newer SWAG image, so
// the image's age is the thing to watch: linuxserver.io rebuilds SWAG at
// least weekly, and security fixes arrive that way.
//
// Everything is read by running fixed commands inside the SWAG container
// and by reading the container's details through the socket proxy (the
// same access the GUI already uses for nginx -t). No value from the browser
// ever becomes part of a command.
import { X509Certificate } from 'node:crypto';

// linuxserver.io rebuilds SWAG at least weekly. An image older than this
// means the container hasn't been updated for a while.
const IMAGE_WARN_DAYS = 30;

// Where SWAG keeps its certificate (a link to the current Let's Encrypt or
// ZeroSSL certificate)
export const CERT_PATH = '/config/keys/letsencrypt/fullchain.pem';
// SWAG's own renewal script, run by its daily cron job
export const RENEW_SCRIPT = '/app/le-renew.sh';

// Certbot renews when fewer than 30 days are left. Below this, renewals
// have probably been failing for a while.
const CERT_WARN_DAYS = 21;

// The SWAG image a container runs, from its details (docker inspect).
// linuxserver.io images carry their version and build date as labels.
export function parseImage(details, now = new Date()) {
  const labels = details?.Config?.Labels ?? {};
  const version = labels['org.opencontainers.image.version']
    ?? labels.build_version?.match(/version:-\s*(\S+)/)?.[1]
    ?? null;
  const builtRaw = labels['org.opencontainers.image.created']
    ?? labels.build_version?.match(/Build-date:-\s*(\S+)/)?.[1]
    ?? null;
  const built = builtRaw && !Number.isNaN(Date.parse(builtRaw)) ? new Date(builtRaw) : null;
  const ageDays = built ? Math.floor((now - built) / 86_400_000) : null;
  return {
    reference: details?.Config?.Image ?? null,
    version,
    built: built?.toISOString() ?? null,
    ageDays,
    state: ageDays === null ? 'unknown' : ageDays > IMAGE_WARN_DAYS ? 'old' : 'ok',
  };
}

export function parseNginxVersion(output) {
  return output.match(/nginx version: nginx\/(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

export function parsePhpVersion(output) {
  return output.match(/^PHP (\d+\.\d+\.\d+)/m)?.[1] ?? null;
}

// Whether HTTP/2 and HTTP/3 are switched on anywhere, from `nginx -T`
// (which prints the full configuration, comments included)
export function parseProtocols(config) {
  const active = config
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n');
  return {
    http2: /^\s*http2\s+on\s*;/m.test(active) || /^\s*listen\s[^;]*\bhttp2\b/m.test(active),
    http3: /^\s*http3\s+on\s*;/m.test(active) || /^\s*listen\s[^;]*\bquic\b/m.test(active),
  };
}

// Domains, issuer and expiry of the first certificate in a PEM chain
export function parseCertificate(pem, now = new Date()) {
  const first = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
  if (!first) return null;
  const cert = new X509Certificate(first);
  const expires = new Date(cert.validTo);
  const daysLeft = Math.floor((expires - now) / 86_400_000);
  const domains = (cert.subjectAltName ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('DNS:'))
    .map((s) => s.slice(4));
  const issuer = cert.issuer.match(/(?:^|\n)O=([^\n]+)/)?.[1] ?? cert.issuer.match(/CN=([^\n]+)/)?.[1] ?? null;
  return {
    domains,
    issuer,
    expires: expires.toISOString(),
    daysLeft,
    state: daysLeft < 0 ? 'expired' : daysLeft < CERT_WARN_DAYS ? 'warning' : 'ok',
  };
}

// Collects everything with fixed commands. `run(cmd)` resolves to
// { stdout, stderr, exitCode } (docker exec in the SWAG container);
// `inspect()` resolves to the container's details.
export async function collect(run, inspect = async () => null) {
  const safe = async (cmd) => {
    try {
      return await run(cmd);
    } catch (err) {
      return { stdout: '', stderr: err.message, exitCode: -1 };
    }
  };

  const [details, nginxV, phpV, nginxT, cert, renew] = await Promise.all([
    inspect().catch(() => null),
    safe(['nginx', '-v']),
    safe(['php', '-v']),
    safe(['nginx', '-T']),
    safe(['cat', CERT_PATH]),
    safe(['test', '-x', RENEW_SCRIPT]),
  ]);

  let certificate = null;
  let certError = null;
  if (cert.exitCode === 0) {
    try {
      certificate = parseCertificate(cert.stdout);
    } catch {
      certError = 'The certificate file could not be read';
    }
  } else {
    certError = `No certificate found at ${CERT_PATH}`;
  }

  return {
    image: parseImage(details),
    nginx: parseNginxVersion(nginxV.stdout + nginxV.stderr),
    php: parsePhpVersion(phpV.stdout),
    protocols: nginxT.exitCode === 0 ? parseProtocols(nginxT.stdout + nginxT.stderr) : null,
    certificate,
    certError,
    canRenew: renew.exitCode === 0,
  };
}
