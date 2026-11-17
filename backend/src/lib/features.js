// Settings for any proxy config, not only the ones the form made:
//
//   auth        which sign-in is switched on: 'authelia', 'authentik' or
//               'none'. linuxserver.io's templates ship include lines for
//               both, commented out ("#include /config/nginx/authentik-...").
//               authOptions lists the providers a file has lines for.
//   errorPages  the include line for the friendly error pages
//
// Changing them only comments, uncomments, adds or removes those exact
// lines; nothing else in the file changes. A setting is null when a file has
// no place for it (e.g. no sign-in lines, or a subfolder config, which has
// no server block of its own).
import { INCLUDE_LINE } from './errorPages.js';

// "    #include /config/nginx/authentik-location.conf;" -> indent, "#", provider, part
const AUTH_LINE = /^([ \t]*)(#?)[ \t]*include \/config\/nginx\/(authelia|authentik)-(server|location)\.conf;[ \t]*$/gm;

export const AUTH_CHOICES = ['none', 'authelia', 'authentik'];

const ERROR_PAGES_LINE = /^[ \t]*include \/config\/nginx\/proxy-confs\/errorpages\.conf;[ \t]*$/m;
const ERROR_PAGES_COMMENT = '# Friendly error pages (service down, access denied)';

const SERVER_NAME = /^([ \t]*)server_name\s[^\n]*;[^\n]*$/m;
const SSL_INCLUDE = /^([ \t]*)include \/config\/nginx\/ssl\.conf;[^\n]*$/m;

// Current state. auth: 'none', 'authelia', 'authentik', 'mixed' (lines
// disagree, or both providers are on) or null (no sign-in lines)
export function detect(content) {
  const lines = [...content.matchAll(AUTH_LINE)];
  let auth = null;
  const authOptions = [...new Set(lines.map((m) => m[3]))];
  if (lines.length > 0) {
    const states = authOptions.map((provider) => {
      const mine = lines.filter((m) => m[3] === provider);
      const on = mine.filter((m) => m[2] === '').length;
      return on === mine.length ? 'on' : on === 0 ? 'off' : 'mixed';
    });
    const on = authOptions.filter((_, i) => states[i] === 'on');
    auth = states.includes('mixed') || on.length > 1 ? 'mixed' : on[0] ?? 'none';
  }
  const errorPages = SERVER_NAME.test(content) ? ERROR_PAGES_LINE.test(content) : null;
  return { auth, authOptions, errorPages };
}

// Switches on one provider's lines and comments out every other's
export function setAuth(content, choice) {
  return content.replace(AUTH_LINE, (_line, indent, _hash, provider, part) =>
    `${indent}${provider === choice ? '' : '#'}include /config/nginx/${provider}-${part}.conf;`);
}

export function setErrorPages(content, on) {
  const present = ERROR_PAGES_LINE.test(content);
  if (on && !present) {
    // Right after "include /config/nginx/ssl.conf;", or else after server_name
    const anchor = content.match(SSL_INCLUDE) ?? content.match(SERVER_NAME);
    const indent = anchor[1];
    const at = anchor.index + anchor[0].length;
    return `${content.slice(0, at)}\n\n${indent}${ERROR_PAGES_COMMENT}\n${indent}${INCLUDE_LINE}${content.slice(at)}`;
  }
  if (!on && present) {
    // Remove the line, plus the comment and blank line added with it
    return content
      .replace(new RegExp(`\\n\\n[ \\t]*${escape(ERROR_PAGES_COMMENT)}\\n[ \\t]*${escape(INCLUDE_LINE)}[ \\t]*(?=\\n)`), '')
      .replace(new RegExp(`^[ \\t]*${escape(INCLUDE_LINE)}[ \\t]*\\n`, 'm'), '');
  }
  return content;
}

// Applies the requested changes, e.g. { auth: 'authentik', errorPages: true }.
// Throws a 400 error for a setting the file has no place for, or a bad value.
export function apply(content, changes = {}) {
  const current = detect(content);
  const fail = (field, message) => Object.assign(new Error(`${field}: ${message}`), { status: 400, field });
  let out = content;
  if (changes.auth !== undefined) {
    if (!AUTH_CHOICES.includes(changes.auth)) throw fail('auth', 'use authelia, authentik or none');
    if (current.auth === null) throw fail('auth', 'this config has no sign-in lines');
    if (changes.auth !== 'none' && !current.authOptions.includes(changes.auth)) {
      throw fail('auth', `this config has no ${changes.auth} lines`);
    }
    out = setAuth(out, changes.auth);
  }
  if (changes.errorPages !== undefined) {
    if (typeof changes.errorPages !== 'boolean') throw fail('errorPages', 'must be true or false');
    if (current.errorPages === null) throw fail('errorPages', 'this config has no place for that setting');
    out = setErrorPages(out, changes.errorPages);
  }
  return out;
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
