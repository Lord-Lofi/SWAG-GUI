import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as templates from '../src/lib/templates.js';

// Shaped like linuxserver.io's plex.subdomain.conf.sample: two locations
// that both point at the same upstream
const PLEX = `## Version 2025/07/18
server {
    listen 443 ssl;
    server_name plex.*;
    include /config/nginx/ssl.conf;

    location / {
        #include /config/nginx/authelia-location.conf;
        set $upstream_app plex;
        set $upstream_port 32400;
        set $upstream_proto http;
        proxy_pass $upstream_proto://$upstream_app:$upstream_port;
    }

    location ~ (/plex)?/api {
        set $upstream_app plex;
        set $upstream_port 32400;
        set $upstream_proto http;
        proxy_pass $upstream_proto://$upstream_app:$upstream_port;
    }
}
`;

const SUBFOLDER = `location ^~ /sonarr {
    set $upstream_app sonarr;
    set $upstream_port 8989;
    set $upstream_proto http;
    proxy_pass $upstream_proto://$upstream_app:$upstream_port;
}
`;

test('reads the template values', () => {
  const info = templates.describe(PLEX, 'plex.subdomain.conf.sample');
  assert.deepEqual(info.upstream, { upstreamApp: 'plex', upstreamPort: '32400', upstreamProto: 'http' });
  assert.equal(info.subdomain, 'plex');
  assert.equal(info.note, null);
});

test('fills in every location and the server_name, nothing else', () => {
  const info = templates.describe(PLEX, 'plex.subdomain.conf.sample');
  const values = templates.validate(info, { subdomain: 'media', upstreamApp: 'plex-server', upstreamPort: '32401', upstreamProto: 'https' });
  const out = templates.apply(PLEX, info, values);
  assert.equal(templates.targetName('plex.subdomain.conf.sample', values), 'media.subdomain.conf');
  assert.equal(out.match(/set \$upstream_app plex-server;/g).length, 2);
  assert.equal(out.match(/set \$upstream_port 32401;/g).length, 2);
  assert.equal(out.match(/set \$upstream_proto https;/g).length, 2);
  assert.match(out, /server_name media\.\*;/);
  // Everything except the changed values is untouched
  const strip = (s) => s.replace(/(set \$upstream_\w+ )[^;]+;/g, '$1;').replace(/server_name [^;]+;/, '');
  assert.equal(strip(out), strip(PLEX));
});

test('subfolder templates keep their name and have no subdomain', () => {
  const info = templates.describe(SUBFOLDER, 'sonarr.subfolder.conf.sample');
  assert.equal(info.subdomain, null);
  const values = templates.validate(info, { subdomain: 'ignored', upstreamApp: 'sonarr', upstreamPort: 8990 });
  assert.equal(templates.targetName('sonarr.subfolder.conf.sample', values), 'sonarr.subfolder.conf');
  assert.match(templates.apply(SUBFOLDER, info, values), /set \$upstream_port 8990;/);
});

test('templates with several upstreams or none are activated as they are', () => {
  const two = PLEX.replace('set $upstream_app plex;\n        set $upstream_port 32400;\n        set $upstream_proto http;\n        proxy_pass $upstream_proto://$upstream_app:$upstream_port;\n    }\n}', 'set $upstream_app plex-api;\n        proxy_pass x;\n    }\n}');
  const multi = templates.describe(two, 'plex.subdomain.conf.sample');
  assert.equal(multi.upstream, null);
  assert.match(multi.note, /more than one upstream/);
  assert.equal(templates.apply(two, multi, templates.validate(multi, {})).includes('plex-api'), true);

  const none = templates.describe('server { server_name x.*; }', 'x.subdomain.conf.sample');
  assert.equal(none.upstream, null);
  assert.match(none.note, /no upstream settings/);
});

const injections = ['plex; include /config/keys/cert.key', 'plex\nserver { }', 'a b', '$host', 'plex}'];
for (const bad of injections) {
  test(`rejects ${JSON.stringify(bad)} in every field`, () => {
    const info = templates.describe(PLEX, 'plex.subdomain.conf.sample');
    const good = { subdomain: 'plex', upstreamApp: 'plex', upstreamPort: 32400, upstreamProto: 'http' };
    for (const field of Object.keys(good)) {
      assert.throws(() => templates.validate(info, { ...good, [field]: bad }), { status: 400, field });
    }
  });
}

test('only .conf.sample files are templates', () => {
  assert.equal(templates.isTemplate('plex.subdomain.conf.sample'), true);
  assert.equal(templates.isTemplate('plex.subdomain.conf'), false);
});
