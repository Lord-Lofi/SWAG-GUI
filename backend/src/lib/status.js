// Health of one SWAG instance: nginx and PHP versions (flagged when they are
// older than a known security fix), whether HTTP/2 and HTTP/3 are on, and
// the certificate's domains and expiry.
//
// Everything is read by running fixed commands inside the SWAG container
// through the socket proxy (the same access the GUI already uses for
// nginx -t). No value from the browser ever becomes part of a command.
import { X509Certificate } from 'node:crypto';

// Lowest safe version per release line, from published security advisories.
// A version on a line not listed here is older than every line that has a
// fix, so it is flagged too. Update this table when new advisories appear.
export const SECURITY_FLOORS = {
  checkedOn: '2026-11-19',
  nginx: {
    // NGINX2Root, CVE-2026-123007 and others (18 Nov 2026)
    lines: { '1.30': '1.30.7', '1.31': '1.31.9' },
    advisory: 'NGINX2Root (CVE-2026-123007 and related), fixed in 1.30.7 / 1.31.9',
  },
  php: {
    // CVE-2026-109618 / CVE-2026-109619 (21 Oct 2026)
    lines: { '8.2': '8.2.35', '8.3': '8.3.36', '8.4': '8.4.27', '8.5': '8.5.12' },
    advisory: 'CVE-2026-109618 / CVE-2026-109619, fixed in 8.2.35 / 8.3.36 / 8.4.27 / 8.5.12',
  },
};

// Where SWAG keeps its certificate (a link to the current Let's Encrypt or
// ZeroSSL certificate)
export const CERT_PATH = '/config/keys/letsencrypt/fullchain.pem';
// SWAG's own renewal script, run by its daily cron job
export const RENEW_SCRIPT = '/app/le-renew.sh';

// Certbot renews when fewer than 30 days are left. Below this, renewals
// have probably been failing for a while.
const CERT_WARN_DAYS = 21;

export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

// { version, ok, fixedIn } for a version string, judged against the floors
export function judgeVersion(kind, version) {
  if (!version) return { version: null, ok: null, fixedIn: null };
  const floors = SECURITY_FLOORS[kind].lines;
  const line = version.split('.').slice(0, 2).join('.');
  const fixedIn = floors[line];
  if (fixedIn) return { version, ok: compareVersions(version, fixedIn) >= 0, fixedIn };
  // A line newer than every listed one is fine. An older one is not; the
  // oldest fixed version is the smallest upgrade that fixes it.
  const lines = Object.keys(floors).sort(compareVersions);
  const ok = compareVersions(line, lines.at(-1)) > 0;
  return { version, ok, fixedIn: ok ? null : floors[lines[0]] };
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
// { stdout, stderr, exitCode } (docker exec in the SWAG container).
export async function collect(run) {
  const safe = async (cmd) => {
    try {
      return await run(cmd);
    } catch (err) {
      return { stdout: '', stderr: err.message, exitCode: -1 };
    }
  };

  const [nginxV, phpV, nginxT, cert, renew] = await Promise.all([
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
    checkedAgainst: SECURITY_FLOORS.checkedOn,
    nginx: { ...judgeVersion('nginx', parseNginxVersion(nginxV.stdout + nginxV.stderr)), advisory: SECURITY_FLOORS.nginx.advisory },
    php: { ...judgeVersion('php', parsePhpVersion(phpV.stdout)), advisory: SECURITY_FLOORS.php.advisory },
    protocols: nginxT.exitCode === 0 ? parseProtocols(nginxT.stdout + nginxT.stderr) : null,
    certificate,
    certError,
    canRenew: renew.exitCode === 0,
  };
}
