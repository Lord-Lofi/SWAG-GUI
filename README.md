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
      ├── Volume: /mnt/swag-external/proxy-confs  (rw)
      ├── Volume: /mnt/swag-internal/proxy-confs  (rw)
      └── Tecnativa docker-socket-proxy
            └── Docker API (exec + containers endpoints only)
```

The GUI container never holds the raw Docker socket. All Docker API access goes through [Tecnativa docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy), scoped to the `exec` and `containers` endpoints only.

### Self-update

| Layer | Mechanism | Updates |
|---|---|---|
| Base runtime | Watchtower | Node.js, npm, OS packages |
| Application code | `git pull` on entrypoint | React frontend, Express API |
| Dependencies | Conditional `npm ci` | Only when `package-lock.json` changes |

---

## Setup

### 1. Environment variables

```bash
cp .env.example .env
```

Fill in `.env` with your values. See `.env.example` for descriptions. Do not commit `.env`.

### 2. Compose file

```bash
cp docker-compose.example.yml docker-compose.yml
```

Replace all placeholders in `docker-compose.yml` with your actual paths and LAN IP.

### 3. Start

```bash
docker compose up -d
```

Cold start takes ~60s (clone + build). Warm restarts with a cached volume take ~15–20s.

### 4. Authentication

Route the GUI through `swag-internal` with Authelia forward auth. Linuxserver.io ships a ready-made `authelia.conf.sample` snippet. The GUI carries no auth code of its own.

### 5. Break-glass access

A secondary port bound to your LAN IP (set via `BREAKGLASS_PORT` in `.env`) provides direct access independent of SWAG and Authelia. Use it if SWAG is down.

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

- Docker socket is proxied through Tecnativa — only `exec` and `containers` endpoints are permitted
- Volume mounts are scoped to `nginx/proxy-confs/` only — certs and DNS credentials are excluded
- All filename inputs are validated server-side to prevent path traversal
- `nginx -t` runs before every reload — a failing config cannot reach nginx
- `npm ci --ignore-scripts` blocks postinstall script execution at startup

All environment-specific values (container names, paths, IPs, PUID/PGID) belong in `.env`, which is gitignored. See `.env.example` for the full list.

---

## License

MIT
