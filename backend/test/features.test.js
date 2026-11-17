import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as features from '../src/lib/features.js';

// Shaped like linuxserver.io's templates, Authelia off as they ship
const SUB = `server {
    listen 443 ssl;
    server_name plex.*;

    include /config/nginx/ssl.conf;

    client_max_body_size 0;

    # enable for Authelia (requires authelia-location.conf in the location block)
    #include /config/nginx/authelia-server.conf;

    location / {
        # enable for Authelia (requires authelia-server.conf in the server block)
        #include /config/nginx/authelia-location.conf;
        proxy_pass http://plex:32400;
    }
}
`;

const SUBFOLDER = `location ^~ /sonarr {
    #include /config/nginx/authelia-location.conf;
    proxy_pass http://sonarr:8989;
}
`;

test('detects the switches', () => {
  assert.deepEqual(features.detect(SUB), { authelia: false, errorPages: false });
  assert.deepEqual(features.detect(SUBFOLDER), { authelia: false, errorPages: null }, 'subfolder configs have no server block');
  assert.deepEqual(features.detect('server {\n    server_name x.*;\n}\n'), { authelia: null, errorPages: false });
  const mixed = SUB.replace('#include /config/nginx/authelia-server.conf;', 'include /config/nginx/authelia-server.conf;');
  assert.equal(features.detect(mixed).authelia, 'mixed');
});

test('Authelia on and off only touch the include lines', () => {
  const on = features.apply(SUB, { authelia: true });
  assert.deepEqual(features.detect(on), { authelia: true, errorPages: false });
  assert.match(on, /^    include \/config\/nginx\/authelia-server\.conf;$/m, 'indentation kept');
  assert.match(on, /^        include \/config\/nginx\/authelia-location\.conf;$/m);
  assert.match(on, /# enable for Authelia/, 'comments stay');
  assert.equal(features.apply(on, { authelia: false }), SUB, 'off gives back the original');
});

test('error pages on and off', () => {
  const on = features.apply(SUB, { errorPages: true });
  assert.match(on, /include \/config\/nginx\/ssl\.conf;\n\n    # Friendly error pages[^\n]*\n    include \/config\/nginx\/proxy-confs\/errorpages\.conf;\n/);
  assert.equal(features.detect(on).errorPages, true);
  assert.equal(features.apply(on, { errorPages: true }), on, 'turning on twice adds one line');
  assert.equal(features.apply(on, { errorPages: false }), SUB, 'off gives back the original');
  const noSsl = 'server {\n    server_name x.*;\n}\n';
  assert.match(features.apply(noSsl, { errorPages: true }), /server_name x\.\*;\n\n    # Friendly/);
});

test('refuses switches a config has no place for, and non-booleans', () => {
  assert.throws(() => features.apply(SUBFOLDER, { errorPages: true }), { status: 400, field: 'errorPages' });
  assert.throws(() => features.apply('server {\n    server_name x.*;\n}\n', { authelia: true }), { status: 400, field: 'authelia' });
  assert.throws(() => features.apply(SUB, { authelia: 'yes' }), { status: 400, field: 'authelia' });
});
