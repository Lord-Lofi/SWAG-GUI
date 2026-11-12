# SWAG Config GUI

A self-updating, browser-based configuration manager for [Linuxserver.io SWAG](https://docs.linuxserver.io/general/swag/). Manages nginx proxy conf files across multiple SWAG instances without SSH access.

---

## Features

- **Proxy conf manager** — list, enable, disable, and edit active `.conf` files per instance
- **Template browser** — browse Linuxserver.io's `.conf.sample` library and activate with one click
- **Monaco editor** — syntax-highlighted in-browser conf editing
- **Nginx validation gate** — every save runs `nginx -t` before reload; broken configs are blocked and the error is shown inline
- **Dual-instance support** — manages `swag-external` and `swag-internal` from a single interface

---

## Architecture

```
Browser (LAN)
  → swag-internal (TLS termination)
  → Authelia (SSO / forward auth)
  → swag-gui container
      ├── Express API + React frontend
      ├── Runs as your SWAG PUID:PGID (not root), no capabilities
      ├── Volume: /mnt/swag-external/proxy-confs  (rw)
      ├── Volume: /mnt/swag-internal/proxy-confs  (rw)
      └── Tecnativa docker-socket-proxy  (internal network, no internet)
            └── Docker API (exec + containers endpoints only)
```

The GUI container never holds the raw Docker socket. All Docker API access goes through [Tecnativa docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy), scoped to the `exec` and `containers` endpoints only.

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

- Docker socket is proxied through Tecnativa (pinned release) — only `exec` and `containers` endpoints are permitted, on an internal network with no internet access
- The GUI container runs as your SWAG PUID/PGID, not root, with all Linux capabilities dropped and `no-new-privileges`
- Volume mounts are scoped to `nginx/proxy-confs/` only — certs and DNS credentials are excluded
- All filenames are checked against an allowlist and must resolve inside the proxy-confs folder, which prevents path traversal
- Requests are rate-limited (300 per minute per client address)
- `nginx -t` runs before every reload — a failing config cannot reach nginx
- Changes through the API require a custom header and a same-site origin, which blocks cross-site request forgery
- Security headers on every response: a strict Content-Security-Policy (no third-party code), no framing, no referrer
- Monaco Editor is bundled from npm, not loaded from a CDN
- The break-glass port is off by default and requires its own password (scrypt hash, lockout after 5 failures)
- The app runs a pinned release tag, optionally checked against your GPG signature before it runs
- `npm ci --ignore-scripts` blocks postinstall script execution at startup

All environment-specific values (container names, paths, IPs, PUID/PGID) belong in `.env`, which is gitignored. See `.env.example` for the full list.

---

## License

MIT
