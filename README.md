# DockPilot — macOS Server Manager

A calm, Tauri-based desktop app for managing Docker containers across a fleet of remote servers. Built from the Claude Design handoff bundle in `lockethq-server-manager/`.

![lockethq logo](app/src-tauri/icons/icon.png)

## What's in this repo

```
container-management/
├── app/                  Tauri desktop app
│   ├── src/             React + TypeScript frontend
│   └── src-tauri/       Rust backend (SSH, runner client, storage)
├── runner/              DockPilot Runner — Rust agent installed on each remote server
└── shared/              Types shared between app and runner
```

## How it works (architecture)

```
┌──────────────────┐         SSH (one-time install)        ┌─────────────────┐
│  Mac (Tauri app) │ ─────────────────────────────────────►│ remote server   │
│                  │                                        │                 │
│  ┌────────────┐  │   bearer-token HTTP (always-on)        │ ┌─────────────┐ │
│  │ React UI   │◄─┼────────────────────────────────────────┼─┤ lockethq-   │ │
│  └────────────┘  │                                        │ │  runner     │ │
│  ┌────────────┐  │                                        │ │  (systemd)  │ │
│  │ Rust core: │  │                                        │ └──────┬──────┘ │
│  │  storage   │  │                                        │        │        │
│  │  ssh inst  │  │                                        │  /var/run/      │
│  │  http      │  │                                        │  docker.sock    │
│  └────────────┘  │                                        │                 │
└──────────────────┘                                        └─────────────────┘
```

1. From the app, you add a remote server: hostname, SSH user, and your SSH key.
2. The app SSH's into the server **once** and installs `lockethq-runner` — a small Rust binary that runs as a systemd service. It generates a 32-byte random bearer token and writes `/etc/lockethq/runner.toml`.
3. The Runner talks to the local Docker daemon (via `/var/run/docker.sock`) and exposes a token-protected HTTP API. **Once installed, it keeps running with or without the app open** — your containers don't depend on your Mac being awake.
4. The desktop app calls the Runner over plain HTTP, authenticating with the bearer token saved at install time.

### Security model (v1)

- **Auth**: 32-byte random bearer token, generated per-server, kept in app data dir (chmod 600) on the Mac and `/etc/lockethq/runner.toml` (chmod 640) on the server.
- **Transport**: plain HTTP over the public internet — **firewall the runner port** (default `8765`) to your laptop's IP, or to a VPN.
- **v1.1 roadmap**: bind the runner to `127.0.0.1` only and tunnel through an always-on SSH local-port-forward managed by the app. Switch to TLS for the rare case where SSH-tunneling isn't viable.

## Scope of v1

In: auth (local profile), onboarding, fleet/servers, containers (list + detail w/ streaming logs), new-container wizard (image · github · upload · compose), monitoring (fleet CPU + per-server + per-container), resources (volumes/networks), settings (SSH keys/team/prefs), ⌘K command palette.

Out (deferred to v1.1): Cloudflare domain provisioning, database editor for postgres/mysql/redis containers.

## Local dev

Prereqs:
- Rust 1.74+ (`rustup`)
- Node 20+, `pnpm`
- Docker (for cross-compiling the Linux runner binaries)

```bash
# Install JS deps
cd app && pnpm install

# Build the runner for Linux x86_64 + ARM64 (uses docker buildx)
cd ../runner && ./build.sh
# → puts binaries in app/src-tauri/binaries/

# Run the app in dev mode (opens the .app window with HMR)
cd ../app && pnpm tauri dev
```

The compiled runner binaries live under `app/src-tauri/binaries/lockethq-runner-{x86_64,aarch64}` and are SCP'd to remote servers during the "Add server" flow.

## Releasing

```bash
cd app && pnpm tauri build
# Produces app/src-tauri/target/release/bundle/{dmg,macos}/DockPilot.{dmg,app}
```

## Configuration

Most settings are stored locally (no cloud). Environment variables that affect the app at runtime:

| Var | Default | Purpose |
|----|----|----|
| `RUST_LOG` | `lockethq_app_lib=info` | Tauri-side log verbosity |
| `LOCKETHQ_RUNNER_PORT` | `8765` | Default port the runner listens on (override per-server in `/etc/lockethq/runner.toml`) |

App data: `~/Library/Application Support/co.lockethq.app/`
- `servers.json` — registered servers
- `secrets.json` — bearer tokens (chmod 600)

## Tauri commands (Rust → React)

The frontend talks to the backend via `@tauri-apps/api`. The available commands:

- `list_servers()` → `ServerRecord[]`
- `add_server(args)` → `ServerRecord` (does the SSH install)
- `remove_server(id)`
- `test_ssh(args)` → host info
- `runner_get(server_id, path)` → JSON
- `runner_post(server_id, path, body)` → JSON
- `runner_stream_logs(server_id, container_id, stream_id)` — streams `runner_stream` Tauri events
- `runner_stream_stats(server_id, container_id, stream_id)`
- `cancel_stream(stream_id)`

## Runner HTTP API

All endpoints require `Authorization: Bearer <token>`.

```
GET  /v1/health
GET  /v1/info               → SystemInfo
GET  /v1/stats              → SystemStats
GET  /v1/stats/stream       → NDJSON stream of SystemStats
GET  /v1/containers         → ContainerSummary[]
POST /v1/containers         → { id }    (CreateContainerRequest body)
GET  /v1/containers/:id     → ContainerDetail
DEL  /v1/containers/:id     → { ok }
POST /v1/containers/:id/{start,stop,restart}
GET  /v1/containers/:id/logs?follow=true&tail=200 → NDJSON LogLine
GET  /v1/containers/:id/stats → NDJSON ContainerStats
GET  /v1/images             → ImageSummary[]
POST /v1/images/pull        → NDJSON pull progress
GET  /v1/volumes            → VolumeSummary[]
GET  /v1/networks           → NetworkSummary[]
```

## Manual end-to-end test

You'll need a Linux box with Docker installed and SSH access via key.

```bash
# 1. Build runner binaries (one-time)
cd runner && ./build.sh

# 2. Launch the app
cd ../app && pnpm tauri dev

# 3. In the app:
#    - Sign in (local profile, anything works)
#    - Add your server (host, user, path to ~/.ssh/id_*)
#    - The handshake log shows: upload → token → systemd → online
#    - Hit "Install runner". Inside ~10 seconds the server should appear in the fleet.
#    - Click into it to see live CPU stats.
#    - Click "New container" → image → enter `nginx:alpine` → deploy.
#    - The new container appears in the containers list with streaming logs.
```

## License

MIT
