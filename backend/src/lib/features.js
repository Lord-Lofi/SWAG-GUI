// On/off switches for any proxy config, not only the ones the form made:
//
//   authelia    the Authelia include lines that linuxserver.io's templates
//               ship commented out ("#include /config/nginx/authelia-...")
//   errorPages  the include line for the friendly error pages
//
// Switching only comments, uncomments, adds or removes those exact lines;
// nothing else in the file changes. A switch is null when a file has no
// place for it (e.g. no Authelia lines, or a subfolder config, which has no
// server block of its own).
import { INCLUDE_LINE } from './errorPages.js';

// "    #include /config/nginx/authelia-location.conf;" -> indent, "#", kind
const AUTHELIA_LINE = /^([ \t]*)(#?)[ \t]*include \/config\/nginx\/authelia-(server|location)\.conf;[ \t]*$/gm;

const ERROR_PAGES_LINE = /^[ \t]*include \/config\/nginx\/proxy-confs\/errorpages\.conf;[ \t]*$/m;
const ERROR_PAGES_COMMENT = '# Friendly error pages (service down, access denied)';

const SERVER_NAME = /^([ \t]*)server_name\s[^\n]*;[^\n]*$/m;
const SSL_INCLUDE = /^([ \t]*)include \/config\/nginx\/ssl\.conf;[^\n]*$/m;

// Current state: true, false, 'mixed' (Authelia lines disagree) or null
export function detect(content) {
  const lines = [...content.matchAll(AUTHELIA_LINE)];
  let authelia = null;
  if (lines.length > 0) {
    const on = lines.filter((m) => m[2] === '').length;
    authelia = on === lines.length ? true : on === 0 ? false : 'mixed';
  }
  const errorPages = SERVER_NAME.test(content) ? ERROR_PAGES_LINE.test(content) : null;
  return { authelia, errorPages };
}

export function setAuthelia(content, on) {
  return content.replace(AUTHELIA_LINE, (_line, indent, _hash, kind) =>
    `${indent}${on ? '' : '#'}include /config/nginx/authelia-${kind}.conf;`);
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

// Applies the requested switches. Throws a 400 error for a switch the file
// doesn't support or a value that isn't true or false.
export function apply(content, changes = {}) {
  const current = detect(content);
  let out = content;
  for (const key of ['authelia', 'errorPages']) {
    if (changes[key] === undefined) continue;
    if (typeof changes[key] !== 'boolean') {
      throw Object.assign(new Error(`${key}: must be true or false`), { status: 400, field: key });
    }
    if (current[key] === null) {
      throw Object.assign(new Error(`${key}: this config has no place for that setting`), { status: 400, field: key });
    }
    out = key === 'authelia' ? setAuthelia(out, changes[key]) : setErrorPages(out, changes[key]);
  }
  return out;
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
