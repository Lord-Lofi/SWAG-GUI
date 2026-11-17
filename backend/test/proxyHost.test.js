import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHost, fileNameFor, renderHostConf, parseHostConf } from '../src/lib/proxyHost.js';

const good = { subdomain: 'plex', upstreamApp: 'plex', upstreamPort: 32400, upstreamProto: 'http', authelia: false, errorPages: false, allowList: [] };

test('accepts a normal host and fills defaults', () => {
  assert.deepEqual(validateHost(good), good);
  const d = validateHost({ subdomain: 'Home-Assistant ', upstreamApp: '192.168.1.20', upstreamPort: '8123' });
  assert.equal(d.subdomain, 'home-assistant');
  assert.equal(d.upstreamPort, 8123);
  assert.equal(d.upstreamProto, 'http');
  assert.equal(d.authelia, true, 'Authelia is on unless switched off');
  assert.equal(d.errorPages, true, 'error pages are on unless switched off');
});

test('builds the SWAG file name', () => {
  assert.equal(fileNameFor('plex'), 'plex.subdomain.conf');
});

// Anything that could break out of the nginx value and add directives
const injections = [
  'plex; include /config/keys/cert.key',
  'plex\nserver { }',
  'plex }',
  'a b',
  '"plex"',
  "plex'",
  '$host',
  'plex#',
  '../plex',
  '-plex',
  '',
];

for (const bad of injections) {
  test(`rejects subdomain ${JSON.stringify(bad)}`, () => {
    assert.throws(() => validateHost({ ...good, subdomain: bad }), { status: 400, field: 'subdomain' });
  });
  test(`rejects upstreamApp ${JSON.stringify(bad)}`, () => {
    assert.throws(() => validateHost({ ...good, upstreamApp: bad }), { status: 400, field: 'upstreamApp' });
  });
}

test('rejects bad ports, protocols and toggles', () => {
  for (const p of [0, 65536, -1, 1.5, 'abc', '80; x', null]) {
    assert.throws(() => validateHost({ ...good, upstreamPort: p }), { field: 'upstreamPort' });
  }
  for (const p of ['ftp', 'HTTP', 'http;', '']) {
    assert.throws(() => validateHost({ ...good, upstreamProto: p }), { field: 'upstreamProto' });
  }
  assert.throws(() => validateHost({ ...good, authelia: 'yes' }), { field: 'authelia' });
  assert.throws(() => validateHost({ ...good, errorPages: 'on' }), { field: 'errorPages' });
  assert.throws(() => validateHost(null), { field: 'body' });
});

test('renders a config with Authelia on', () => {
  const conf = renderHostConf(validateHost({ ...good, authelia: true }), new Date('2026-11-16T00:00:00Z'));
  assert.match(conf, /^## Version 2026\/11\/16$/m);
  assert.match(conf, /^    server_name plex\.\*;$/m);
  assert.match(conf, /^    include \/config\/nginx\/authelia-server\.conf;$/m);
  assert.match(conf, /^        include \/config\/nginx\/authelia-location\.conf;$/m);
  assert.match(conf, /^        set \$upstream_port 32400;$/m);
  assert.equal((conf.match(/{/g) || []).length, (conf.match(/}/g) || []).length, 'balanced braces');
});

test('renders a config with Authelia off (commented out)', () => {
  const conf = renderHostConf(validateHost(good));
  assert.match(conf, /^    #include \/config\/nginx\/authelia-server\.conf;$/m);
  assert.match(conf, /^        #include \/config\/nginx\/authelia-location\.conf;$/m);
  assert.doesNotMatch(conf, /^\s+include \/config\/nginx\/authelia/m);
  assert.match(conf, /# Authelia: off\./);
});

test('includes the error-pages snippet only when switched on', () => {
  const on = renderHostConf(validateHost({ ...good, errorPages: true }));
  const off = renderHostConf(validateHost(good));
  const line = /^    include \/config\/nginx\/proxy-confs\/errorpages\.conf;$/m;
  assert.match(on, line);
  assert.doesNotMatch(off, /errorpages/);
});

test('reads every form option back from a generated host', () => {
  for (const authelia of [true, false]) {
    for (const errorPages of [true, false]) {
      const host = { ...good, upstreamProto: 'https', authelia, errorPages };
      assert.deepEqual(parseHostConf(renderHostConf(host, new Date('2026-01-02T12:00:00Z'))), host);
    }
  }
});

test('refuses files changed by hand or not made by the form', () => {
  const conf = renderHostConf(good);
  assert.equal(parseHostConf(conf.replace('client_max_body_size 0;', 'client_max_body_size 0;\n    add_header X-Test 1;')), null);
  assert.equal(parseHostConf(conf.replace('# Created by SWAG Config GUI\n', '')), null);
  assert.equal(parseHostConf(conf + '\n'), null);
  assert.equal(parseHostConf('server { }'), null);
  assert.equal(parseHostConf(undefined), null);
});

test('accepts addresses and ranges for the allow list', () => {
  const list = [' 192.168.1.20 ', '10.0.0.0/8', '172.16.0.0/12', 'fd00::/8', '::1', '2001:db8::/32', '', '10.0.0.0/8'];
  assert.deepEqual(validateHost({ ...good, allowList: list }).allowList,
    ['192.168.1.20', '10.0.0.0/8', '172.16.0.0/12', 'fd00::/8', '::1', '2001:db8::/32'], 'trimmed, blanks and repeats dropped');
});

const badAllow = ['all', 'any', '192.168.1.0/33', '::/129', '1.2.3.4/', '1.2.3.4/8/8', '300.1.1.1', '01.2.3.4',
  'fe80::1%eth0', '10.0.0.0/8; include /etc/passwd', '10.0.0.0/8\nallow all', 'unix:', '$remote_addr', 'localhost'];
for (const bad of badAllow) {
  test(`rejects allow list entry ${JSON.stringify(bad)}`, () => {
    assert.throws(() => validateHost({ ...good, allowList: [bad] }), { status: 400, field: 'allowList' });
  });
}

test('rejects a non-list allow list and too many entries', () => {
  assert.throws(() => validateHost({ ...good, allowList: '10.0.0.0/8' }), { field: 'allowList' });
  const many = Array.from({ length: 51 }, (_, i) => `10.0.0.${i}`);
  assert.throws(() => validateHost({ ...good, allowList: many }), { field: 'allowList' });
});

test('renders the allow list and reads it back', () => {
  const host = { ...good, errorPages: true, allowList: ['192.168.0.0/16', 'fd00::/8'] };
  const conf = renderHostConf(host);
  assert.match(conf, /    allow 192\.168\.0\.0\/16;\n    allow fd00::\/8;\n    deny all;\n/);
  assert.deepEqual(parseHostConf(conf), host);
  assert.doesNotMatch(renderHostConf(good), /deny all/, 'no allow list means anyone may connect');
});
