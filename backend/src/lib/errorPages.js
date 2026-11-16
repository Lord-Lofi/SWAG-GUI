// Friendly error pages for SWAG.
//
// Installs three static pages (403, 404, 50x) plus an nginx snippet into an
// instance's proxy-confs folder:
//
//   proxy-confs/errorpages.conf        the snippet a server block includes
//   proxy-confs/errorpages/*.html      the pages
//
// SWAG only loads *.subdomain.conf and *.subfolder.conf automatically, so the
// snippet does nothing until a config includes it with:
//
//   include /config/nginx/proxy-confs/errorpages.conf;
//
// The pages contain no scripts, no outside requests and never echo anything
// from the request, and the snippet only covers errors nginx produces itself
// (an upstream that is down, an allow-list denial). Apps' own error responses
// pass through unchanged, because proxy_intercept_errors stays off.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES_DIR = fileURLToPath(new URL('../errorpages/', import.meta.url));
export const PAGES = ['403.html', '404.html', '50x.html'];

// Path of the snippet as SWAG sees it, inside its container
export const INCLUDE_LINE = 'include /config/nginx/proxy-confs/errorpages.conf;';

export const SNIPPET = `## Friendly error pages, installed by SWAG Config GUI
# Include inside a server block:  ${INCLUDE_LINE}
# Only replaces errors nginx itself produces; apps' own errors pass through.
error_page 403 /__errorpages/403.html;
error_page 404 /__errorpages/404.html;
error_page 502 503 504 /__errorpages/50x.html;

location ^~ /__errorpages/ {
    internal;
    alias /config/nginx/proxy-confs/errorpages/;
    # No cache headers needed: browsers don't cache 403/5xx responses by default.
}
`;

// Fixed file names only: nothing here comes from a request.
function paths(confsPath) {
  const root = resolve(confsPath);
  return {
    snippet: join(root, 'errorpages.conf'),
    dir: join(root, 'errorpages'),
  };
}

async function exists(p) {
  return access(p).then(() => true, () => false);
}

async function bundledPage(name) {
  return readFile(join(PAGES_DIR, name), 'utf8');
}

// Reports whether the snippet and pages are present and identical to the
// bundled versions.
export async function status(confsPath) {
  const { snippet, dir } = paths(confsPath);
  const installed = (await exists(snippet)) && (await Promise.all(PAGES.map((n) => exists(join(dir, n))))).every(Boolean);
  if (!installed) return { installed: false, upToDate: false, includeLine: INCLUDE_LINE };
  const same = async (file, expected) => (await readFile(file, 'utf8')) === expected;
  const checks = [same(snippet, SNIPPET), ...PAGES.map(async (n) => same(join(dir, n), await bundledPage(n)))];
  return { installed: true, upToDate: (await Promise.all(checks)).every(Boolean), includeLine: INCLUDE_LINE };
}

// Writes (or refreshes) the snippet and pages. They are SWAG Config GUI's own
// files, so overwriting them with the bundled versions is intended.
export async function install(confsPath) {
  const { snippet, dir } = paths(confsPath);
  await mkdir(dir, { recursive: true });
  for (const name of PAGES) {
    await writeFile(join(dir, name), await bundledPage(name), 'utf8');
  }
  await writeFile(snippet, SNIPPET, 'utf8');
  return status(confsPath);
}
