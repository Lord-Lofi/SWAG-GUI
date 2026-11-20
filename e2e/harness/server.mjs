// Test harness for the browser tests.
//
// 1. Builds a throwaway folder that looks like a SWAG instance: the include
//    files SWAG ships, two linuxserver.io-style templates, a self-signed
//    certificate.
// 2. Starts a stand-in for the Docker socket proxy. It answers the same API
//    calls SWAG-GUI makes (exec create/start/inspect, container inspect), but
//    only for the fixed commands SWAG-GUI uses. `nginx -t` / `nginx -T` run
//    the real nginx against a copy of the configs, with SWAG's /config paths
//    pointed at the throwaway folder and port 443 moved to a free port.
// 3. Starts the real SWAG-GUI backend, serving the built frontend.
//
// Needs nginx and openssl on the PATH (CI installs nginx).
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, CONFS } from './paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const NGINX_PORT = 18443;
const DOCKER_PORT = 23750;
const GUI_PORT = 3100;

// -- 1. A SWAG-like folder ----------------------------------------------------
rmSync(ROOT, { recursive: true, force: true });
const cfg = join(ROOT, 'config');
const test = join(ROOT, 'nginx-test');
for (const d of [join(cfg, 'nginx'), CONFS, join(cfg, 'keys', 'letsencrypt'), join(test, 'confs'), join(test, 'tmp')]) {
  mkdirSync(d, { recursive: true });
}

const cert = spawnSync('openssl', [
  'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '60',
  '-keyout', join(cfg, 'keys', 'cert.key'), '-out', join(cfg, 'keys', 'letsencrypt', 'fullchain.pem'),
  '-subj', '/O=E2E Test CA/CN=example.test', '-addext', 'subjectAltName=DNS:example.test,DNS:*.example.test',
]);
if (cert.status !== 0) throw new Error(`openssl failed: ${cert.stderr}`);

const swagFiles = {
  'ssl.conf': `ssl_certificate ${cfg}/keys/letsencrypt/fullchain.pem;\nssl_certificate_key ${cfg}/keys/cert.key;\n`,
  'proxy.conf': 'proxy_set_header Host $host;\n',
  'resolver.conf': 'resolver 127.0.0.11 valid=30s;\n',
  'authelia-server.conf': 'location ^~ /authelia { internal; return 204; }\n',
  'authelia-location.conf': 'set $e2e_authelia 1;\n',
  'authentik-server.conf': 'location ^~ /outpost.goauthentik.io { internal; return 204; }\n',
  'authentik-location.conf': 'set $e2e_authentik 1;\n',
};
for (const [name, body] of Object.entries(swagFiles)) writeFileSync(join(cfg, 'nginx', name), body);
cpSync(join(HERE, 'templates'), CONFS, { recursive: true });

writeFileSync(join(test, 'nginx.conf'), `worker_processes 1;
pid ${test}/nginx.pid;
events {}
http {
  access_log off;
  client_body_temp_path ${test}/tmp/body;
  proxy_temp_path ${test}/tmp/proxy;
  fastcgi_temp_path ${test}/tmp/fastcgi;
  uwsgi_temp_path ${test}/tmp/uwsgi;
  scgi_temp_path ${test}/tmp/scgi;
  server {
    listen 127.0.0.1:${NGINX_PORT} ssl default_server;
    server_name _;
    include ${cfg}/nginx/ssl.conf;
    include ${test}/confs/*.subfolder.conf;
    location / { return 444; }
  }
  include ${test}/confs/*.subdomain.conf;
}
`);

// Copies the active configs for nginx -t: SWAG's /config paths point at the
// throwaway folder, and port 443 (IPv4 and IPv6) becomes a free local port.
function prepareNginxCopy() {
  const out = join(test, 'confs');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);
  for (const e of readdirSync(CONFS, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.conf')) continue;
    const body = readFileSync(join(CONFS, e.name), 'utf8')
      .replaceAll('/config/', `${cfg}/`)
      .replace(/^\s*listen\s+\[::\]:443[^\n]*$/gm, '')
      .replace(/listen\s+443\b/g, `listen 127.0.0.1:${NGINX_PORT}`);
    writeFileSync(join(out, e.name), body);
  }
}

function nginx(flag) {
  prepareNginxCopy();
  const r = spawnSync('nginx', [flag, '-c', join(test, 'nginx.conf'), '-e', join(test, 'error.log')], { encoding: 'utf8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error ?? ''), exitCode: r.status ?? 127 };
}

// The only commands SWAG-GUI runs inside SWAG, and what the stand-in does
function runCommand(cmd) {
  const key = cmd.join(' ');
  if (key === 'nginx -t' || key === 'nginx -s reload') return nginx('-t');
  if (key === 'nginx -T') return nginx('-T');
  if (key === 'nginx -v') return { stdout: '', stderr: 'nginx version: nginx/1.30.7\n', exitCode: 0 };
  if (key === 'php -v') return { stdout: 'PHP 8.4.27 (cli) (built: Oct 21 2026) (NTS)\n', stderr: '', exitCode: 0 };
  if (key === 'cat /config/keys/letsencrypt/fullchain.pem') {
    return { stdout: readFileSync(join(cfg, 'keys', 'letsencrypt', 'fullchain.pem'), 'utf8'), stderr: '', exitCode: 0 };
  }
  if (key === 'test -x /app/le-renew.sh') return { stdout: '', stderr: '', exitCode: 0 };
  if (key === '/app/le-renew.sh') return { stdout: 'cronjob running\nCertificate not yet due for renewal\n', stderr: '', exitCode: 0 };
  return { stdout: '', stderr: `e2e harness: unexpected command: ${key}\n`, exitCode: 127 };
}

// -- 2. Docker socket proxy stand-in ----------------------------------------
function frame(type, text) {
  const body = Buffer.from(text);
  const head = Buffer.alloc(8);
  head[0] = type;
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

const execs = new Map();
createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const json = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    let m;
    if (req.method === 'GET' && (m = req.url.match(/^\/containers\/([^/]+)\/json$/))) {
      return json(200, { Config: { Image: 'lscr.io/linuxserver/swag:latest', Labels: {
        'org.opencontainers.image.version': '5.10.0-ls501',
        'org.opencontainers.image.created': new Date(Date.now() - 2 * 86_400_000).toISOString(),
      } } });
    }
    if (req.method === 'POST' && (m = req.url.match(/^\/containers\/([^/]+)\/exec$/))) {
      const id = randomBytes(32).toString('hex');
      execs.set(id, { cmd: JSON.parse(body).Cmd });
      return json(201, { Id: id });
    }
    if (req.method === 'POST' && (m = req.url.match(/^\/exec\/([a-f0-9]{64})\/start$/)) && execs.has(m[1])) {
      const e = execs.get(m[1]);
      Object.assign(e, runCommand(e.cmd));
      res.writeHead(200);
      return res.end(Buffer.concat([frame(1, e.stdout), frame(2, e.stderr)]));
    }
    if (req.method === 'GET' && (m = req.url.match(/^\/exec\/([a-f0-9]{64})\/json$/)) && execs.has(m[1])) {
      return json(200, { ExitCode: execs.get(m[1]).exitCode });
    }
    json(404, { message: 'not handled by the e2e harness' });
  });
}).listen(DOCKER_PORT, '127.0.0.1');

// -- 3. The real backend ------------------------------------------------------
const gui = spawn(process.execPath, [join(REPO, 'backend', 'src', 'server.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(GUI_PORT),
    SWAG_EXTERNAL_CONTAINER: 'swag-e2e',
    SWAG_EXTERNAL_CONFS_PATH: CONFS,
    DOCKER_SOCKET_PROXY_URL: `http://127.0.0.1:${DOCKER_PORT}`,
  },
});
const stop = () => { gui.kill(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
gui.on('exit', (code) => process.exit(code ?? 1));
