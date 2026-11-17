// Activates linuxserver.io's *.conf.sample templates with form input.
//
// Most templates assume a container name and port (for example
// "set $upstream_app plex;" and "set $upstream_port 32400;"). Instead of
// copying the file and editing it by hand, the activation form fills in:
//
//   - the subdomain (server_name), for *.subdomain.conf.sample templates
//   - the upstream container or host, port and protocol
//
// Only the values on those lines change; the rest of the template is kept
// exactly as linuxserver.io wrote it. Every value is checked by the same
// strict patterns as the add-host form, so it can't add nginx directives.
import { validateUpstream, validateSubdomain } from './proxyHost.js';

// "    set $upstream_app plex;" -> prefix, key, value, suffix
const SET_LINE = /^(\s*set\s+\$upstream_(app|port|proto)\s+)([^\s;]+)(\s*;)/gm;

// "    server_name plex.*;" (the form every subdomain template uses)
const SERVER_NAME = /^(\s*server_name\s+)([a-z0-9-]+)(\.\*\s*;)/gm;

const KEYS = { app: 'upstreamApp', port: 'upstreamPort', proto: 'upstreamProto' };

export function isTemplate(name) {
  return typeof name === 'string' && name.endsWith('.conf.sample');
}

// What the form can change in a template, and its current values.
//
// `upstream` is null when the template has no "set $upstream_..." lines, or
// when it points to more than one upstream (e.g. separate app and API
// containers). Such templates are activated as they are.
export function describe(content, name) {
  const values = { app: new Set(), port: new Set(), proto: new Set() };
  for (const m of content.matchAll(SET_LINE)) values[m[2]].add(m[3]);

  const single = Object.values(values).every((v) => v.size <= 1);
  const hasApp = values.app.size > 0;
  const first = (key) => [...values[key]][0];

  let upstream = null;
  let note = null;
  if (!hasApp) {
    note = 'This template has no upstream settings, so it is activated as it is.';
  } else if (!single) {
    note = 'This template points to more than one upstream, so it is activated as it is. Adjust it afterwards if needed.';
  } else {
    upstream = {
      upstreamApp: first('app'),
      upstreamPort: first('port') ?? '',
      upstreamProto: first('proto') ?? 'http',
    };
  }

  // Only subdomain templates with one plain "server_name x.*;" can be renamed
  const names = [...content.matchAll(SERVER_NAME)].map((m) => m[2]);
  const subdomain = name.endsWith('.subdomain.conf.sample') && names.length === 1 ? names[0] : null;

  return { upstream, subdomain, note };
}

// Checks the form input for a template. Fields the template doesn't support
// are ignored.
export function validate(info, input = {}) {
  const result = {};
  if (info.upstream) Object.assign(result, validateUpstream(input));
  if (info.subdomain) {
    result.subdomain = validateSubdomain(input.subdomain ?? info.subdomain);
  }
  return result;
}

// The active file name: "plex.subdomain.conf.sample" -> "plex.subdomain.conf",
// or "<new subdomain>.subdomain.conf" when the subdomain was changed.
export function targetName(sampleName, values = {}) {
  if (values.subdomain) return `${values.subdomain}.subdomain.conf`;
  return sampleName.replace(/\.sample$/, '');
}

// Returns the template with the form values filled in.
export function apply(content, info, values) {
  let out = content;
  if (info.upstream) {
    out = out.replace(SET_LINE, (_all, prefix, key, _old, suffix) => `${prefix}${values[KEYS[key]]}${suffix}`);
  }
  if (info.subdomain && values.subdomain) {
    out = out.replace(SERVER_NAME, (_all, prefix, _old, suffix) => `${prefix}${values.subdomain}${suffix}`);
  }
  return out;
}
