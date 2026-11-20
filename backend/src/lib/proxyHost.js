// Builds a SWAG proxy config ("<subdomain>.subdomain.conf") from form input.
//
// Every value ends up inside nginx configuration, so each one is checked
// against a strict pattern first. None of them can contain spaces, quotes,
// semicolons, braces or newlines, which means form input can never add extra
// nginx directives (configuration injection).

import { isIP } from 'node:net';

// One DNS label: lowercase letters, digits and hyphens, no leading or
// trailing hyphen, at most 63 characters (e.g. "plex", "home-assistant").
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// The upstream: a Docker container name, hostname or IPv4 address
// (e.g. "plex", "jellyfin_app", "192.168.1.20", "nas.lan").
const UPSTREAM_APP = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,252})$/;

const PROTOCOLS = new Set(['http', 'https']);

// Sign-in in front of a host: SWAG ships include files for both Authelia and
// Authentik (/config/nginx/authelia-*.conf and authentik-*.conf)
export const AUTH_PROVIDERS = ['authelia', 'authentik'];
const AUTH_CHOICES = new Set(['none', ...AUTH_PROVIDERS]);

// Upload size limit (nginx client_max_body_size): "0" means unlimited, as in
// SWAG's own templates; otherwise a whole number of megabytes or gigabytes,
// e.g. "100m" or "1g". Capped at 100000 (about 100 TB, i.e. effectively none).
const BODY_SIZE = /^(0|[1-9][0-9]{0,4}[mg])$/;

// Allow lists: at most this many addresses or ranges per host
const MAX_ALLOW = 50;

const ERROR_PAGES_INCLUDE = 'include /config/nginx/proxy-confs/errorpages.conf;';

function invalid(field, message) {
  return Object.assign(new Error(`${field}: ${message}`), { status: 400, field });
}

export function validateSubdomain(value) {
  const subdomain = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SUBDOMAIN.test(subdomain)) {
    throw invalid('subdomain', 'use lowercase letters, digits and hyphens (e.g. "plex")');
  }
  return subdomain;
}

// Checks the upstream fields (where nginx forwards requests to). Shared by
// the add-host form and template activation.
export function validateUpstream(input) {
  if (!input || typeof input !== 'object') throw invalid('body', 'expected a JSON object');

  const upstreamApp = typeof input.upstreamApp === 'string' ? input.upstreamApp.trim() : '';
  if (!UPSTREAM_APP.test(upstreamApp)) {
    throw invalid('upstreamApp', 'use a container name, hostname or IP address');
  }

  const upstreamPort = Number(input.upstreamPort);
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
    throw invalid('upstreamPort', 'use a port number from 1 to 65535');
  }

  const upstreamProto = input.upstreamProto ?? 'http';
  if (!PROTOCOLS.has(upstreamProto)) {
    throw invalid('upstreamProto', 'use http or https');
  }

  return { upstreamApp, upstreamPort, upstreamProto };
}

// Checks and normalises the form fields. Throws a 400 error naming the
// first field that is wrong.
export function validateHost(input) {
  if (!input || typeof input !== 'object') throw invalid('body', 'expected a JSON object');

  const subdomain = validateSubdomain(input.subdomain);
  const { upstreamApp, upstreamPort, upstreamProto } = validateUpstream(input);

  // "auth" is 'authelia', 'authentik' or 'none'. Older clients sent
  // authelia: true/false, which still works. Default: Authelia.
  let auth = input.auth;
  if (auth === undefined) {
    if (input.authelia !== undefined && typeof input.authelia !== 'boolean') {
      throw invalid('authelia', 'must be true or false');
    }
    auth = input.authelia === false ? 'none' : 'authelia';
  }
  if (!AUTH_CHOICES.has(auth)) throw invalid('auth', 'use authelia, authentik or none');

  const errorPages = input.errorPages === undefined ? true : input.errorPages;
  if (typeof errorPages !== 'boolean') throw invalid('errorPages', 'must be true or false');

  const allowList = validateAllowList(input.allowList);

  const maxBodySize = input.maxBodySize === undefined ? '0' : String(input.maxBodySize).trim().toLowerCase();
  if (!BODY_SIZE.test(maxBodySize)) {
    throw invalid('maxBodySize', 'use unlimited, or a whole number of MB or GB (e.g. 100m, 1g)');
  }

  return { subdomain, upstreamApp, upstreamPort, upstreamProto, auth, errorPages, allowList, maxBodySize };
}

// An allow list is a list of IPv4/IPv6 addresses or CIDR ranges
// ("192.168.1.20", "192.168.0.0/16", "fd00::/8"). Empty means anyone may
// connect. node:net's isIP does the address check, so nothing but a valid
// address and prefix length can reach the config.
export function validateAllowList(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid('allowList', 'must be a list of addresses');
  const list = [];
  for (const raw of value) {
    const entry = typeof raw === 'string' ? raw.trim() : '';
    if (entry === '') continue;
    // Digits, hex letters, dots, colons and one slash only (this also rules
    // out IPv6 zone names like "fe80::1%eth0", which isIP would accept)
    const [addr, prefix, extra] = /^[0-9A-Fa-f:.\/]+$/.test(entry) ? entry.split('/') : [''];
    const version = isIP(addr);
    const maxPrefix = version === 6 ? 128 : 32;
    const prefixOk = prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) <= maxPrefix);
    if (!version || !prefixOk || extra !== undefined) {
      throw invalid('allowList', `"${entry.slice(0, 50)}" is not an IP address or range (e.g. 192.168.1.0/24)`);
    }
    if (!list.includes(entry)) list.push(entry);
  }
  if (list.length > MAX_ALLOW) throw invalid('allowList', `use at most ${MAX_ALLOW} entries`);
  return list;
}

export function fileNameFor(subdomain) {
  return `${subdomain}.subdomain.conf`;
}

// Renders the config in the same layout as linuxserver.io's own
// *.subdomain.conf.sample files.
export function renderHostConf(host, now = new Date()) {
  const { subdomain, upstreamApp, upstreamPort, upstreamProto, auth: signIn, errorPages, allowList = [], maxBodySize = '0' } = host;
  // With no sign-in, the Authelia lines are written commented out, as before
  const provider = signIn === 'authentik' ? 'authentik' : 'authelia';
  const name = provider === 'authentik' ? 'Authentik' : 'Authelia';
  const date = now.toISOString().slice(0, 10).replace(/-/g, '/');
  // Disabled lines keep their indentation, like SWAG's samples: "    #include ..."
  const toggle = (line) => (signIn !== 'none' ? line : line.replace(/^(\s*)/, '$1#'));

  return `## Version ${date}
# Created by SWAG Config GUI
# ${subdomain}.* -> ${upstreamProto}://${upstreamApp}:${upstreamPort}

server {
    listen 443 ssl;
    listen [::]:443 ssl;

    server_name ${subdomain}.*;

    include /config/nginx/ssl.conf;

    client_max_body_size ${maxBodySize};
${errorPages ? '\n    # Friendly error pages (service down, access denied)\n    ' + ERROR_PAGES_INCLUDE + '\n' : ''}${allowList.length ? '\n    # Allow list: only these addresses may connect; everyone else gets 403\n' + allowList.map((a) => `    allow ${a};\n`).join('') + '    deny all;\n' : ''}
    ${signIn !== 'none' ? `# ${name}: sign-in required before reaching this service` : '# Authelia: off. Remove the # from both include lines below to turn it on.'}
${toggle(`    include /config/nginx/${provider}-server.conf;`)}

    location / {
${toggle(`        include /config/nginx/${provider}-location.conf;`)}

        include /config/nginx/proxy.conf;
        include /config/nginx/resolver.conf;
        set $upstream_app ${upstreamApp};
        set $upstream_port ${upstreamPort};
        set $upstream_proto ${upstreamProto};
        proxy_pass $upstream_proto://$upstream_app:$upstream_port;
    }
}
`;
}

// Reads a config back into form values, so the form can edit it later.
//
// Only works for files this GUI created and nobody has changed by hand:
// the values are read out, the file is rendered again from them, and the
// two must match exactly. Returns null otherwise, so a form save can never
// throw away hand-made changes; those files are edited in the editor.
export function parseHostConf(content) {
  if (typeof content !== 'string' || !content.includes('\n# Created by SWAG Config GUI\n')) return null;

  const pick = (re) => content.match(re)?.[1];
  const date = pick(/^## Version (\d{4}\/\d{2}\/\d{2})\n/);
  const values = {
    subdomain: pick(/^\s*server_name ([a-z0-9-]+)\.\*;$/m),
    upstreamApp: pick(/^\s*set \$upstream_app (\S+);$/m),
    upstreamPort: pick(/^\s*set \$upstream_port (\d+);$/m),
    upstreamProto: pick(/^\s*set \$upstream_proto (\S+);$/m),
    auth: content.match(/^\s*include \/config\/nginx\/(authelia|authentik)-server\.conf;$/m)?.[1] ?? 'none',
    errorPages: content.includes(`    ${ERROR_PAGES_INCLUDE}\n`),
    allowList: [...content.matchAll(/^    allow (\S+);$/gm)].map((m) => m[1]),
    maxBodySize: pick(/^    client_max_body_size (\S+);$/m),
  };
  if (!date || !values.subdomain) return null;

  let host;
  try {
    host = validateHost(values);
  } catch {
    return null;
  }
  const now = new Date(`${date.replace(/\//g, '-')}T00:00:00Z`);
  return renderHostConf(host, now) === content ? host : null;
}
