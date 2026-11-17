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

    # enable for Authentik (requires authentik-location.conf in the location block)
    #include /config/nginx/authentik-server.conf;

    location / {
        # enable for Authelia (requires authelia-server.conf in the server block)
        #include /config/nginx/authelia-location.conf;

        # enable for Authentik (requires authentik-server.conf in the server block)
        #include /config/nginx/authentik-location.conf;
        proxy_pass http://plex:32400;
    }
}
`;

const SUBFOLDER = `location ^~ /sonarr {
    #include /config/nginx/authelia-location.conf;
    #include /config/nginx/authentik-location.conf;
    proxy_pass http://sonarr:8989;
}
`;

test('detects the settings', () => {
  assert.deepEqual(features.detect(SUB), { auth: 'none', authOptions: ['authelia', 'authentik'], errorPages: false });
  assert.deepEqual(features.detect(SUBFOLDER), { auth: 'none', authOptions: ['authelia', 'authentik'], errorPages: null }, 'subfolder configs have no server block');
  assert.deepEqual(features.detect('server {\n    server_name x.*;\n}\n'), { auth: null, authOptions: [], errorPages: false });
  const half = SUB.replace('#include /config/nginx/authelia-server.conf;', 'include /config/nginx/authelia-server.conf;');
  assert.equal(features.detect(half).auth, 'mixed', 'one provider half on');
  const both = features.setAuth(SUB, 'authelia').replace(/#include \/config\/nginx\/authentik/g, 'include /config/nginx/authentik');
  assert.equal(features.detect(both).auth, 'mixed', 'both providers on');
});

test('switching sign-in only touches the include lines', () => {
  const authelia = features.apply(SUB, { auth: 'authelia' });
  assert.equal(features.detect(authelia).auth, 'authelia');
  assert.match(authelia, /^    include \/config\/nginx\/authelia-server\.conf;$/m, 'indentation kept');
  assert.match(authelia, /^        include \/config\/nginx\/authelia-location\.conf;$/m);
  assert.match(authelia, /^    #include \/config\/nginx\/authentik-server\.conf;$/m, 'the other provider stays off');

  const authentik = features.apply(authelia, { auth: 'authentik' });
  assert.equal(features.detect(authentik).auth, 'authentik');
  assert.match(authentik, /^    #include \/config\/nginx\/authelia-server\.conf;$/m, 'switching provider turns the old one off');
  assert.match(authentik, /^        include \/config\/nginx\/authentik-location\.conf;$/m);
  assert.match(authentik, /# enable for Authentik/, 'comments stay');

  assert.equal(features.apply(authentik, { auth: 'none' }), SUB, 'none gives back the original');
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
  assert.throws(() => features.apply('server {\n    server_name x.*;\n}\n', { auth: 'authelia' }), { status: 400, field: 'auth' });
  const autheliaOnly = SUB.replace(/\n[^\n]*authentik[^\n]*/gi, '');
  assert.throws(() => features.apply(autheliaOnly, { auth: 'authentik' }), { status: 400, field: 'auth' });
  for (const bad of ['yes', true, 'Authelia', 'tinyauth']) {
    assert.throws(() => features.apply(SUB, { auth: bad }), { status: 400, field: 'auth' });
  }
});
