// Builds a SWAG proxy config ("<subdomain>.subdomain.conf") from form input.
//
// Every value ends up inside nginx configuration, so each one is checked
// against a strict pattern first. None of them can contain spaces, quotes,
// semicolons, braces or newlines, which means form input can never add extra
// nginx directives (configuration injection).

// One DNS label: lowercase letters, digits and hyphens, no leading or
// trailing hyphen, at most 63 characters (e.g. "plex", "home-assistant").
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// The upstream: a Docker container name, hostname or IPv4 address
// (e.g. "plex", "jellyfin_app", "192.168.1.20", "nas.lan").
const UPSTREAM_APP = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,252})$/;

const PROTOCOLS = new Set(['http', 'https']);

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

  const authelia = input.authelia === undefined ? true : input.authelia;
  if (typeof authelia !== 'boolean') throw invalid('authelia', 'must be true or false');

  const errorPages = input.errorPages === undefined ? true : input.errorPages;
  if (typeof errorPages !== 'boolean') throw invalid('errorPages', 'must be true or false');

  return { subdomain, upstreamApp, upstreamPort, upstreamProto, authelia, errorPages };
}

export function fileNameFor(subdomain) {
  return `${subdomain}.subdomain.conf`;
}

// Renders the config in the same layout as linuxserver.io's own
// *.subdomain.conf.sample files.
export function renderHostConf(host, now = new Date()) {
  const { subdomain, upstreamApp, upstreamPort, upstreamProto, authelia, errorPages } = host;
  const date = now.toISOString().slice(0, 10).replace(/-/g, '/');
  // Disabled lines keep their indentation, like SWAG's samples: "    #include ..."
  const auth = (line) => (authelia ? line : line.replace(/^(\s*)/, '$1#'));

  return `## Version ${date}
# Created by SWAG Config GUI
# ${subdomain}.* -> ${upstreamProto}://${upstreamApp}:${upstreamPort}

server {
    listen 443 ssl;
    listen [::]:443 ssl;

    server_name ${subdomain}.*;

    include /config/nginx/ssl.conf;

    client_max_body_size 0;
${errorPages ? '\n    # Friendly error pages (service down, access denied)\n    ' + ERROR_PAGES_INCLUDE + '\n' : ''}
    ${authelia ? '# Authelia: sign-in required before reaching this service' : '# Authelia: off. Remove the # from both include lines below to turn it on.'}
${auth('    include /config/nginx/authelia-server.conf;')}

    location / {
${auth('        include /config/nginx/authelia-location.conf;')}

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
