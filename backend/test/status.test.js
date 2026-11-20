import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as status from '../src/lib/status.js';

// Self-signed test certificate for example.test and *.example.test,
// valid until 18 Feb 2027 04:09:26 UTC
const PEM = `-----BEGIN CERTIFICATE-----
MIIB0TCCAXagAwIBAgIUV/NyPs4P0GKz14x3hfoXk2Dx8lQwCgYIKoZIzj0EAwIw
KTEQMA4GA1UECgwHVGVzdCBDQTEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MB4XDTI2
MTEyMDA0MDkyNloXDTI3MDIxODA0MDkyNlowKTEQMA4GA1UECgwHVGVzdCBDQTEV
MBMGA1UEAwwMZXhhbXBsZS50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE
ftOmUfsYpJv0XyvFxqTRCvAHWgkD/n7MBSWPeh/EFiK2jo+bDK0T6k4X5+Wj7FqG
PAxowGqJOielCuA1R3PH06N8MHowHQYDVR0OBBYEFKkFbTdV7779oaWS62hPjAjM
QaTwMB8GA1UdIwQYMBaAFKkFbTdV7779oaWS62hPjAjMQaTwMA8GA1UdEwEB/wQF
MAMBAf8wJwYDVR0RBCAwHoIMZXhhbXBsZS50ZXN0gg4qLmV4YW1wbGUudGVzdDAK
BggqhkjOPQQDAgNJADBGAiEAjgZseWsRbkNQORYZ4YrEur4IEVwdNMaX71YMmQLL
184CIQD+oX8AJ01JXT49D2Dbq81okbpcexfq/5tGmzvCNNHMMw==
-----END CERTIFICATE-----`;

test('reads the SWAG image version and age from its labels', () => {
  const now = new Date('2026-11-20T00:00:00Z');
  const oci = { Config: { Image: 'lscr.io/linuxserver/swag:latest', Labels: {
    'org.opencontainers.image.version': '5.10.0-ls501',
    'org.opencontainers.image.created': '2026-11-18T18:05:00+00:00',
  } } };
  assert.deepEqual(status.parseImage(oci, now), {
    reference: 'lscr.io/linuxserver/swag:latest', version: '5.10.0-ls501',
    built: '2026-11-18T18:05:00.000Z', ageDays: 1, state: 'ok',
  });
  const legacy = { Config: { Image: 'swag', Labels: { build_version: 'Linuxserver.io version:- 5.2.2-ls425 Build-date:- 2026-08-01T00:00:00+00:00' } } };
  const old = status.parseImage(legacy, now);
  assert.equal(old.version, '5.2.2-ls425');
  assert.equal(old.state, 'old', 'over 30 days old');
  assert.deepEqual(status.parseImage(null, now), { reference: null, version: null, built: null, ageDays: null, state: 'unknown' });
});

test('reads versions from command output', () => {
  assert.equal(status.parseNginxVersion('nginx version: nginx/1.30.7\n'), '1.30.7');
  assert.equal(status.parsePhpVersion('PHP 8.4.27 (cli) (built: Oct 21 2026)\nCopyright'), '8.4.27');
  assert.equal(status.parseNginxVersion('sh: nginx: not found'), null);
});

test('detects HTTP/2 and HTTP/3 and ignores comments', () => {
  const off = '# configuration file /config/nginx/ssl.conf:\n#http2 on;\nlisten 443 ssl;\n# listen 443 quic;\n';
  assert.deepEqual(status.parseProtocols(off), { http2: false, http3: false });
  assert.deepEqual(status.parseProtocols('server {\n    http2 on;\n}\n'), { http2: true, http3: false });
  assert.deepEqual(status.parseProtocols('    listen 443 ssl http2;\n'), { http2: true, http3: false });
  assert.deepEqual(status.parseProtocols('    listen 443 quic reuseport;\n'), { http2: false, http3: true });
  assert.deepEqual(status.parseProtocols('    http3 on;\n'), { http2: false, http3: true });
});

test('reads the certificate and warns before it expires', () => {
  const c = status.parseCertificate(PEM, new Date('2026-12-01T00:00:00Z'));
  assert.deepEqual(c.domains, ['example.test', '*.example.test']);
  assert.equal(c.issuer, 'Test CA');
  assert.equal(c.state, 'ok');
  assert.equal(status.parseCertificate(PEM, new Date('2027-02-01T00:00:00Z')).state, 'warning');
  assert.equal(status.parseCertificate(PEM, new Date('2027-03-01T00:00:00Z')).state, 'expired');
  assert.equal(status.parseCertificate('not a certificate'), null);
});

test('collects everything with fixed commands only', async () => {
  const seen = [];
  const run = async (cmd) => {
    seen.push(cmd.join(' '));
    if (cmd[0] === 'nginx' && cmd[1] === '-v') return { stdout: '', stderr: 'nginx version: nginx/1.30.6', exitCode: 0 };
    if (cmd[0] === 'php') return { stdout: 'PHP 8.4.27 (cli)', stderr: '', exitCode: 0 };
    if (cmd[0] === 'nginx') return { stdout: 'http2 on;', stderr: '', exitCode: 0 };
    if (cmd[0] === 'cat') return { stdout: PEM, stderr: '', exitCode: 0 };
    throw new Error('exec failed');
  };
  const s = await status.collect(run, async () => ({ Config: { Image: 'swag', Labels: { 'org.opencontainers.image.version': '5.10.0-ls501' } } }));
  assert.deepEqual(seen.sort(), ['cat /config/keys/letsencrypt/fullchain.pem', 'nginx -T', 'nginx -v', 'php -v', 'test -x /app/le-renew.sh']);
  assert.equal(s.image.version, '5.10.0-ls501');
  assert.equal(s.nginx, '1.30.6');
  assert.equal(s.php, '8.4.27');
  assert.deepEqual(s.protocols, { http2: true, http3: false });
  assert.equal(s.certificate.domains[0], 'example.test');
  assert.equal(s.canRenew, false, 'a failing exec is reported, not thrown');
});
