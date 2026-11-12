// Cross-site request forgery (CSRF) protection for the API.
//
// Authelia signs you in with a cookie, and browsers send that cookie with
// every request to the GUI, even one started by another website. Without this
// check, a page you visit could make your browser reload nginx or enable a
// config here.
//
// Every request that changes something must:
//   1. carry the X-SWAG-GUI header. Browsers will not let another site add a
//      custom header to a cross-site request without the server's permission
//      (a CORS preflight), and this server never grants it.
//   2. come from this same site, when the browser says where it came from
//      (the Sec-Fetch-Site and Origin headers).
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSRF_HEADER = 'X-SWAG-GUI';

function reject(res) {
  return res.status(403).json({ error: 'Cross-site request blocked' });
}

export function requireSameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  if (req.get(CSRF_HEADER) !== '1') return reject(res);

  const site = req.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return reject(res);

  const origin = req.get('Origin');
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      return reject(res);
    }
    if (originHost !== req.get('Host')) return reject(res);
  }

  next();
}
