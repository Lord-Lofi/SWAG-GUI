# SWAG Config GUI

A self-updating, browser-based configuration manager for [Linuxserver.io SWAG](https://docs.linuxserver.io/general/swag/). Manages nginx proxy conf files across multiple SWAG instances without SSH access.

---

## Features

- **Proxy conf manager** — list, switch and delete active `.conf` files per instance; everyday changes go through forms, not file editing
- **Add and edit proxy hosts** — a form for `<name>.subdomain.conf` files (upstream, port, sign-in with Authelia or Authentik, allow list) with a live preview. Hosts made with the form open in the form again for changes, as long as nobody edited the file by hand. A failed `nginx -t` undoes the change
- **Settings per config** — choose the sign-in (Authelia, Authentik or none) and switch the friendly error pages on or off for any active config, including ones activated from templates; only those include lines change
- **Status panel** — per instance: nginx and PHP versions checked against known security fixes, whether HTTP/2 and HTTP/3 are on, and the certificate's domains and expiry, with a button to run SWAG's renewal check
- **Allow lists** — limit a host to your local network or to a list of IP addresses and ranges; everyone else gets a 403 (with the friendly page if error pages are on)
- **Friendly error pages** — matching 403 / 404 / service-down pages (no scripts, no outside requests); one click installs them, and new hosts include them by default
- **Template browser** — browse Linuxserver.io's `.conf.sample` library; activating one asks for the container name, port and subdomain (filled in with the template's defaults) and shows the resulting file first
- **Advanced: edit file** — for anything the forms don't cover, edit any config by hand in Monaco with nginx syntax highlighting. It downloads only when opened, and a failed `nginx -t` puts the file back as it was
- **Nginx validation gate** — every change runs `nginx -t` before reload; a failing change is undone and the error is shown inline
- **Dual-instance support** — manages `swag-external` and `swag-internal` from a single interface

---

## Architecture

```
Browser (LAN)
  → swag-internal (TLS termination)
  → Authelia or Authentik (SSO / forward auth)
  → swag-gui container
      ├── Express API + React frontend
      ├── Runs as your SWAG PUID:PGID (not root), no capabilities
      ├── Volume: /mnt/swag-external/proxy-confs  (rw)
      ├── Volume: /mnt/swag-internal/proxy-confs  (rw)
      └── LinuxServer.io socket-proxy  (internal network, no internet)
            └── Docker API (exec + containers endpoints only)
```

The GUI container never holds the raw Docker socket. All Docker API access goes through [LinuxServer.io's socket-proxy](https://github.com/linuxserver/docker-socket-proxy) (from the team behind SWAG), which only allows the `containers` and `exec` endpoints. File copies out of containers, logs and exports stay blocked.

### Updates

| Layer | Mechanism | Updates |
|---|---|---|
| Application code | Entrypoint fetches `REPO_REF` (a release tag, optionally signature-checked) on every start | React frontend, Express API |
| Dependencies | Conditional `npm ci` | Only when `package-lock.json` changes |
| Base image | Dependabot pull request, then `docker compose build --pull` | Node.js, npm, Alpine packages |

With `REPO_REF` set to a release tag, the GUI only changes version when you change `REPO_REF`. If GitHub is unreachable, or a tag fails its signature check, the last good version keeps running.

---

## Setup

### 1. Environment variables

```bash
cp .env.example .env
```

Fill in `.env` with your values. See `.env.example` for descriptions. Do not commit `.env`.

Set `REPO_REF` to the release tag you want to run, for example `0.2.0`.

### 2. Compose file

```bash
cp docker-compose.example.yml docker-compose.yml
```

Replace all placeholders in `docker-compose.yml` with your actual paths. `docker-compose.yml` is gitignored.

### 3. Start

```bash
docker compose up -d
```

Cold start takes ~60s (clone + build). Warm restarts with a cached volume take ~15–20s.

To update Node.js and Alpine packages in the base image (after merging a Dependabot pull request):

```bash
git pull
docker compose build --pull
docker compose up -d
```

### 4. Authentication

Route the GUI through `swag-internal` with Authelia forward auth. Linuxserver.io ships a ready-made `authelia.conf.sample` snippet. The GUI carries no auth code of its own.

### 5. Break-glass access (optional, off by default)

A secondary port bound to your LAN IP provides direct access independent of SWAG and Authelia, for when SWAG is down. Because it skips Authelia, it has its own password.

1. Create a password hash (the password is never stored):
   ```bash
   npm run hash-password
   ```
2. In `.env`, paste the printed `BREAKGLASS_PASSWORD_HASH=...` line and set `BREAKGLASS_PORT=8080`.
3. In `docker-compose.yml`, uncomment the break-glass port line and put in your LAN IP.

The break-glass port is plain HTTP, so only use it on your own network. After 5 wrong passwords, that address is locked out for 15 minutes. If the hash is missing or invalid, the break-glass port does not start.

### 6. Signature verification (optional)

The entrypoint can refuse to run any release tag that you didn't sign with your own GPG key:

1. Sign release tags: `git tag -s 0.2.0 -m "0.2.0"` and `git push origin 0.2.0`.
2. Export your public key next to `docker-compose.yml`: `gpg --armor --export YOUR_KEY_ID > trusted-signing-key.asc`.
3. Uncomment the `trusted-signing-key.asc` volume line in `docker-compose.yml`.
4. In `.env`, set `VERIFY_SIGNATURES=true` and `REPO_REF` to the signed tag.

Branches can't be verified this way, because commits merged on GitHub are signed with GitHub's key rather than yours.

### Switching to LinuxServer.io's socket proxy

Your `docker-compose.yml` is your own copy, so pulling doesn't change it. Replace its `socket-proxy` service with the one in `docker-compose.example.yml` (new image, the extra `EVENTS`/`PING`/`VERSION` lines, `read_only` and `tmpfs`), then:

```bash
docker compose pull socket-proxy
docker compose up -d socket-proxy
docker compose logs socket-proxy     # should show the LinuxServer.io banner and no errors
```

Then press **Validate** in the GUI to confirm `nginx -t` still runs through the new proxy. The service name and port stay the same, so nothing else changes.

### Upgrading from 0.1.0

0.2.0 runs as your PUID/PGID instead of root, so the old cache volume (created by root) must be removed once:

```bash
docker compose down
docker volume rm swag-gui_swag-gui-cache   # name may differ: docker volume ls
docker compose build --pull
docker compose up -d
```

Also remove the old `watchtower` service from your `docker-compose.yml` if it is still there.

---

## Error pages

**Error pages** (or a new host with "Use friendly error pages") installs into the selected instance's `proxy-confs`:

- `errorpages/403.html`, `404.html`, `50x.html`: self-contained static pages that follow the visitor's dark or light setting
- `errorpages.conf`: the nginx snippet. SWAG doesn't load it on its own; a config opts in with:
  ```nginx
  include /config/nginx/proxy-confs/errorpages.conf;
  ```

Only errors nginx itself produces are replaced (an upstream that is down, an allow-list denial). Apps' own error responses pass through unchanged, and the real status codes are kept.

### Unknown subdomains

Requests for a subdomain with no config fall through to SWAG's default site (`nginx/site-confs/default.conf`), which SWAG Config GUI doesn't manage. Recommended, once per instance:

- **External SWAG:** drop them silently, so scanners learn nothing. In `default.conf`'s HTTPS `server` block, replace the `location / { ... }` contents with `return 444;`.
- **Internal SWAG:** show the friendly 404 instead. Add `include /config/nginx/proxy-confs/errorpages.conf;` to that server block and replace the `location / { ... }` contents with `return 404;`.

Check with **Validate** before reloading.

---

## Sign-in: Authelia or Authentik

Hosts, templates and existing configs can require **Authelia** or **Authentik** sign-in. Either way, SWAG Config GUI only switches on SWAG's own include files (`/config/nginx/authelia-*.conf` or `authentik-*.conf`); it never changes them. Set up the one you use once, as in [SWAG's docs](https://docs.linuxserver.io/general/swag/):

- **Authelia:** check that the container name and port in `/config/nginx/authelia-server.conf` match your Authelia container.
- **Authentik:** check that the container name and port in `/config/nginx/authentik-server.conf` match your Authentik server container.

Only one provider is on at a time: choosing one comments out the other's lines. For subfolder configs (like `sonarr.subfolder.conf`), the matching `*-server.conf` line must also be switched on in SWAG's `site-confs/default.conf`, which SWAG Config GUI doesn't manage.

## Status panel

The **Status** tab reads each instance's health by running fixed commands inside the SWAG container (`nginx -v`, `php -v`, `nginx -T`, and reading `/config/keys/letsencrypt/fullchain.pem`):

- **nginx / PHP** turn red when the version is older than the latest security fix SWAG Config GUI knows about. That list lives in `backend/src/lib/status.js` (`SECURITY_FLOORS`) with the date it was last checked, and is updated with releases, so keep SWAG Config GUI itself up to date. Green means "no known issue as of that date", not "safe forever".
- **Protocols** shows whether HTTP/2 or HTTP/3 is switched on anywhere, which matters when an nginx flaw only affects one of them.
- **Certificate** shows the domains, issuer and expiry. Certbot renews with 30 days left, so under 21 days it turns amber: renewal is probably failing. **Run renewal check** runs SWAG's own `/app/le-renew.sh`; it only renews when due, so it's safe to press any time.

## Allow lists

A host's **Who can connect** setting adds `allow` lines and `deny all;` to its server block. Everyone else gets a 403, shown with the friendly page when error pages are on. (The error-pages snippet has its own `allow all;`, so blocked visitors can still see that page. If you installed the error pages before allow lists existed, press **Error pages** once to update them; saving a host with error pages on also updates them.)

The check uses the address nginx sees, so make sure that is the visitor's real address:

- **Behind Cloudflare or another proxy:** nginx sees the proxy's address unless SWAG's real-IP settings are configured. Until then, "Local network only" blocks everyone and a custom list matches the proxy, not the visitor.
- **Docker networking:** with Docker's default iptables port publishing, SWAG sees real client addresses. If your setup shows a Docker gateway address (172.x) for outside visitors instead, "Local network only" would let everyone in, because 172.16.0.0/12 is a private range. Check SWAG's access log for the addresses it records before relying on an allow list.

---

## Development

```bash
cp .env.example .env
# fill in .env
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to the Express backend on port 3000.

---

## Security

- Docker socket is proxied through LinuxServer.io's socket-proxy (pinned release, read-only container): only the `exec` and `containers` endpoints are permitted, file copies out of containers are blocked, and it sits on an internal network with no internet access
- The GUI container runs as your SWAG PUID/PGID, not root, with all Linux capabilities dropped and `no-new-privileges`
- Volume mounts are scoped to `nginx/proxy-confs/` only — certs and DNS credentials are excluded
- All filenames are checked against an allowlist and must resolve inside the proxy-confs folder, which prevents path traversal
- Requests are rate-limited (300 per minute per client address)
- `nginx -t` runs before every reload — a failing config cannot reach nginx
- Changes through the API require a custom header and a same-site origin, which blocks cross-site request forgery
- Security headers on every response: a strict Content-Security-Policy (no third-party code), no framing, no referrer
- Monaco Editor is bundled from npm, not loaded from a CDN, and used directly without a wrapper package
- The break-glass port is off by default and requires its own password (scrypt hash, lockout after 5 failures)
- The app runs a pinned release tag, optionally checked against your GPG signature before it runs
- `npm ci --ignore-scripts` blocks postinstall script execution at startup

All environment-specific values (container names, paths, IPs, PUID/PGID) belong in `.env`, which is gitignored. See `.env.example` for the full list.

---

## License

MIT
