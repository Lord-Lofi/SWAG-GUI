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

test('compares version numbers', () => {
  assert.equal(status.compareVersions('1.30.7', '1.30.7'), 0);
  assert.equal(status.compareVersions('1.30.10', '1.30.7'), 1);
  assert.equal(status.compareVersions('1.29.9', '1.30.0'), -1);
});

test('flags nginx versions older than the security fix', () => {
  assert.deepEqual(status.judgeVersion('nginx', '1.30.6'), { version: '1.30.6', ok: false, fixedIn: '1.30.7' });
  assert.equal(status.judgeVersion('nginx', '1.30.7').ok, true);
  assert.equal(status.judgeVersion('nginx', '1.31.8').ok, false);
  assert.equal(status.judgeVersion('nginx', '1.31.9').ok, true);
  assert.deepEqual(status.judgeVersion('nginx', '1.28.0'), { version: '1.28.0', ok: false, fixedIn: '1.30.7' }, 'older lines are flagged, with the smallest fixing upgrade');
  assert.equal(status.judgeVersion('nginx', '1.32.0').ok, true, 'newer lines are fine');
  assert.deepEqual(status.judgeVersion('nginx', null), { version: null, ok: null, fixedIn: null });
});

test('flags PHP versions older than the security fix', () => {
  assert.equal(status.judgeVersion('php', '8.4.26').ok, false);
  assert.equal(status.judgeVersion('php', '8.4.27').ok, true);
  assert.equal(status.judgeVersion('php', '8.3.40').ok, true);
  assert.equal(status.judgeVersion('php', '8.1.31').ok, false);
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
  const s = await status.collect(run);
  assert.deepEqual(seen.sort(), ['cat /config/keys/letsencrypt/fullchain.pem', 'nginx -T', 'nginx -v', 'php -v', 'test -x /app/le-renew.sh']);
  assert.equal(s.nginx.ok, false);
  assert.equal(s.nginx.fixedIn, '1.30.7');
  assert.equal(s.php.ok, true);
  assert.deepEqual(s.protocols, { http2: true, http3: false });
  assert.equal(s.certificate.domains[0], 'example.test');
  assert.equal(s.canRenew, false, 'a failing exec is reported, not thrown');
});
