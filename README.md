# SWAG Config GUI

A self-updating, browser-based configuration manager for [Linuxserver.io SWAG](https://docs.linuxserver.io/general/swag/) (Secure Web Application Gateway). Manages nginx proxy conf files across multiple SWAG instances without SSH access.

---

## CRITICAL SECURITY RULE — READ FIRST

**This repository is public. It must never contain information that identifies your network or infrastructure.**

The following are permanently banned from this codebase — in source files, comments, commit messages, branch names, and issue descriptions:

| Banned | Instead |
|---|---|
| Internal domain names or hostnames | Use environment variables |
| Internal IP addresses (LAN or otherwise) | Use environment variables |
| Docker container names specific to your deployment | Use environment variables |
| PUID / PGID values | Use environment variables |
| File system paths that reveal your machine layout | Use environment variables |
| Usernames, passwords, tokens, or API keys | Use `.env` (gitignored) |

**All environment-specific values live in `.env`, which is gitignored.**  
Use `.env.example` (placeholder values only) to document what is required.  
Never commit `.env`. Never commit `docker-compose.yml` if it contains real values.

This rule exists because the repository is public and a single slip can permanently expose your internal network topology. Once committed and pushed, data is public — even if later deleted, it may have been indexed or cached.

---

## What it does

- **Proxy conf manager** — list, enable, disable, and edit `.conf` files for both SWAG instances
- **Template browser** — browse Linuxserver.io's `.conf.sample` library and activate with one click
- **Monaco editor** — syntax-highlighted in-browser conf editing
- **Nginx validation gate** — every save runs `nginx -t` before reload; if validation fails, the reload is blocked and the error is shown inline
- **Dual-instance support** — manages `swag-external` and `swag-internal` from a single interface

## What it does not do

- Expose any port to the internet (proxied through `swag-internal` only)
- Touch SSL certificates, DNS credentials, or any SWAG config outside `nginx/proxy-confs/`
- Require a Docker registry — application code self-updates via `git pull` on startup

---

## Architecture

```
Browser (LAN)
  → swag-internal (TLS termination)
  → Authelia (SSO / forward auth)
  → swag-gui container
      ├── Express API + React frontend
      ├── Volume: /mnt/swag-external/proxy-confs  (rw)
      ├── Volume: /mnt/swag-internal/proxy-confs  (rw)
      └── Tecnativa docker-socket-proxy
            └── Docker API (exec + containers endpoints only)
```

The GUI container never holds the raw Docker socket. All Docker API access is proxied through [Tecnativa docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy), which limits exposure to exactly the two endpoints required: `exec` and `containers`.

### Self-update mechanism

| Layer | Mechanism | Updates |
|---|---|---|
| Base runtime | Watchtower | Node.js, npm, OS packages in the image |
| Application code | `git pull` on entrypoint | React frontend, Express API |
| Dependencies | Conditional `npm ci` | Only runs when `package-lock.json` changes |

---

## Setup

### 1. Copy and fill in environment variables

```bash
cp .env.example .env
```

Edit `.env` with your actual values. See `.env.example` for descriptions of each variable. Do not commit `.env`.

### 2. Copy and fill in the compose file

```bash
cp docker-compose.example.yml docker-compose.yml
```

Replace all placeholders in `docker-compose.yml`:
- `/path/to/swag-external/nginx/proxy-confs` → your actual host path
- `/path/to/swag-internal/nginx/proxy-confs` → your actual host path
- `YOUR_LAN_IP` → your LAN IP address for the break-glass port

Do not commit `docker-compose.yml` if it contains real values.

### 3. Start

```bash
docker compose up -d
```

On first start, the entrypoint clones the repository and builds the frontend (~60s). Subsequent warm restarts complete in ~15–20s using the cached volume.

### 4. Wire up authentication

Route the GUI through `swag-internal` with Authelia forward auth. Linuxserver.io provides a ready-made `authelia.conf.sample` snippet. The GUI carries no auth code of its own — Authelia is the auth layer.

### 5. Break-glass access

The GUI exposes a secondary port bound to your LAN IP (configured in `.env` as `BREAKGLASS_PORT`). This port bypasses `swag-internal` and Authelia entirely. Use it to recover when SWAG is down. Document the URL in a private runbook.

---

## Development

```bash
cp .env.example .env
# fill in .env with your values
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to the Express backend on port 3000.

---

## Security notes

- **Docker socket proxy** — the Tecnativa proxy allows only `CONTAINERS=1` and `EXEC=1`. All other Docker API endpoints are denied by default. The raw socket is never mounted into the GUI container.
- **Volume mounts** — only `nginx/proxy-confs/` is mounted. SSL certificates, DNS credentials, and all other SWAG config directories are excluded.
- **Path traversal** — all filename parameters are validated server-side before any file operation.
- **Nginx validation gate** — `nginx -t` runs before every reload. A failing config cannot reach nginx.
- **Supply chain** — `npm ci --ignore-scripts` blocks postinstall script execution during the entrypoint update.

---

## License

MIT
