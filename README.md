<div align="center">

# DockPilot — The Local-First Docker GUI & Self-Hosted PaaS for Your VPS

**Manage Docker containers, deploy apps, and monitor servers from a beautiful native desktop app — no cloud account, no public dashboard, no agent exposed to the internet.**

[![Release](https://img.shields.io/github/v/release/LocketHQ/DockPilot?style=flat-square)](https://github.com/LocketHQ/DockPilot/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri-24C8DB?style=flat-square)](https://tauri.app)
[![Built with Rust](https://img.shields.io/badge/built%20with-Rust-orange?style=flat-square)](https://www.rust-lang.org)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)](https://github.com/LocketHQ/DockPilot/releases)

[**Download**](https://github.com/LocketHQ/DockPilot/releases) ·
[**Quick Start**](#-quick-start) ·
[**Features**](#-features) ·
[**Comparison**](#-dockpilot-vs-portainer-vs-coolify-vs-dokploy) ·
[**FAQ**](#-frequently-asked-questions)

</div>

---

## What is DockPilot?

**DockPilot is an open-source, local-first Docker container management app and lightweight self-hosted PaaS** for developers and indie hackers running their own VPS fleet. It's the missing **Docker Desktop alternative for remote servers** — a fast native client (built with Tauri + Rust + React) that connects to your Linux boxes over SSH and gives you a clean GUI for **deploying apps, managing containers, viewing logs, browsing files, attaching shells, configuring domains, and watching real-time stats** across all of your servers.

No SaaS account. No telemetry. No public web panel waiting to get pwned. Your control plane lives on your laptop.

> If you've been searching for a **Portainer alternative**, **Coolify alternative**, **Dokploy alternative**, **CapRover alternative**, or just a **modern Docker GUI for VPS management** — DockPilot is built for you.

---

## Why DockPilot?

Most "container management platforms" force you into one of two bad choices:

- **A cloud SaaS** that demands you hand over SSH keys to a third party, OR
- **A self-hosted web dashboard** that exposes a juicy admin panel on your server's public IP.

DockPilot rejects both. The desktop app on **your machine** is the dashboard. A tiny Rust agent (the **Runner**) on each server binds to **localhost only** and is reached exclusively through an SSH port-forward initiated by the app. Nothing about your fleet is internet-reachable that wasn't already.

This is **Docker management the way it should be**: native, fast, offline-capable, multi-server, and yours.

---

## ✨ Features

### 🐳 Docker container management, done right
- **Fleet view** — every container across every server in one searchable list
- **Stacks** — group containers by Compose project with one-click up/down/restart
- **Live logs** with regex filtering, follow-mode, and download
- **Interactive shell** — `docker exec` from the desktop, no SSH gymnastics
- **Stats & resource charts** — CPU, memory, network, and disk per container, streamed in real time
- **One-click pull, restart, recreate, prune** — the boring stuff, made boring

### 🚀 Deploy apps like a PaaS
- **Guided wizard** for deploying from a Git repo, Docker image, or `docker-compose.yml`
- Built-in support for **environment variables, secrets, volumes, and networks**
- **Database executors** for Postgres, MySQL, and Redis — open a query console in two clicks
- **File browser** with upload/download/edit on the remote host

### 🌐 Domains, Cloudflare & reverse proxy
- **First-class Cloudflare integration** — drop in your Cloudflare API token once and DockPilot will **create, update, and delete DNS records automatically** every time you attach or detach a domain
- **Zero-config HTTPS** — DockPilot spins up **Traefik** behind the scenes and issues Let's Encrypt certificates the moment a record goes live (HTTP-01 or Cloudflare DNS-01 challenge)
- **Cloudflare proxy mode toggle** — flip the orange cloud on/off per record from the GUI; configure caching, "Always Use HTTPS", and SSL mode without leaving DockPilot
- **Wildcard subdomains** for staging and PR-preview deploys, fully automated through the Cloudflare DNS-01 flow
- Manage DNS records, redirects, and per-app routing from one screen — no more bouncing between your registrar, Cloudflare, and the server

### 📊 Monitoring & observability
- Per-server CPU, RAM, disk, and uptime dashboards
- Container health checks, restart counts, exit codes
- Historical metrics without setting up a Prometheus stack

### 🔐 Security model that doesn't suck
- Runner binds to **127.0.0.1 only** — never exposed to the internet
- All traffic is tunneled through **your existing SSH connection** using your existing keys
- Static bearer token written by the installer, scoped to the runner
- No public admin panel. No phone-home. No third-party API in the hot path.

### 🪶 Absurdly low memory footprint
**DockPilot is the lightest container manager you can install.** Because the dashboard lives on your laptop instead of running as a hosted web app on your VPS, the only thing actually sitting on your server is a **tiny Rust binary** — the DockPilot Runner.

- **~8 MB resident memory** for the runner agent — yes, megabytes, not gigabytes
- **Zero web dashboard, zero Node.js, zero Postgres, zero Redis, zero Docker sidecar containers** running on your box just to manage Docker
- **No background JavaScript runtime** burning RAM 24/7 — there's literally no web server to host
- **Single static Rust binary** with no runtime dependencies — drops in, runs forever
- Compare to Portainer (~200 MB), Coolify (~500 MB + Postgres + Redis + Soketi), Dokploy (~300 MB + Postgres + Redis) — **DockPilot's footprint is ~25× to ~60× smaller**
- Run it comfortably on a **$4/month VPS, a Raspberry Pi, or the cheapest Hetzner CX11** — every MB of RAM stays available for the apps you're actually trying to run
- **Traefik** is the only other moving piece, and it's optional (only spun up the first time you attach a domain)

### 💻 Native, fast, gorgeous desktop app
- Built with **Tauri 2 + Rust + React** — single-digit MB install, sub-second cold start
- The desktop app itself uses ~80 MB on your laptop (vs Electron-based tools that easily hit 500 MB+)
- Native menubar, command palette (`⌘K`), keyboard-driven
- macOS, Windows, and Linux builds — universal binaries on Apple Silicon
- Works **offline** for everything that doesn't strictly need the server

---

## 🚀 Quick Start

### 1. Install the desktop app

Grab the latest build for your OS from **[GitHub Releases](https://github.com/LocketHQ/DockPilot/releases)**:

| Platform | Download |
|---|---|
| 🍎 macOS (Apple Silicon + Intel) | `DockPilot_*.dmg` |
| 🪟 Windows 10/11 | `DockPilot_*-setup.exe` |
| 🐧 Linux (Debian/Ubuntu) | `dockpilot_*.deb` |
| 🐧 Linux (AppImage) | `DockPilot_*.AppImage` |

### 2. Add your first server

Open DockPilot → **Add Server** → paste an SSH connection string (or pick a host from your `~/.ssh/config`). DockPilot will:

1. Connect over SSH using your existing keys
2. Install the **DockPilot Runner** as a systemd service
3. Install Docker if it's not already there
4. Verify the loopback-only socket and bearer token

Total time: ~30 seconds on a fresh Ubuntu droplet.

### 3. Deploy something

Hit **Deploy → From Git Repo**, paste a URL, pick a domain, and ship it. Or import an existing `docker-compose.yml`. Or run the file browser to drop in a binary.

---

## 🆚 DockPilot vs Portainer vs Coolify vs Dokploy

|  | **DockPilot** | Portainer | Coolify | Dokploy | CapRover |
|---|---|---|---|---|---|
| Native desktop app | ✅ | ❌ web only | ❌ web only | ❌ web only | ❌ web only |
| Public admin panel required | ❌ none | ✅ exposed | ✅ exposed | ✅ exposed | ✅ exposed |
| Multi-server fleet from day one | ✅ | 💰 paid tier | ✅ | ✅ | ⚠️ limited |
| SSH-tunneled, loopback-only agent | ✅ | ❌ | ❌ | ❌ | ❌ |
| Built-in reverse proxy + HTTPS | ✅ | ❌ | ✅ | ✅ | ✅ |
| Deploy from Git / Compose / Image | ✅ | ⚠️ partial | ✅ | ✅ | ✅ |
| Local-first (works offline) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Open source | ✅ MIT | ⚠️ split | ✅ | ✅ | ✅ |
| Memory footprint **on the server** | **~8 MB** (Rust runner) | 200 MB+ | 500 MB+ (+ Postgres + Redis) | 300 MB+ (+ Postgres + Redis) | 400 MB+ |
| Runs on a $4 VPS / Raspberry Pi | ✅ trivially | ⚠️ tight | ❌ no | ❌ no | ⚠️ tight |
| Cloudflare DNS automation | ✅ built in | ❌ | ⚠️ partial | ⚠️ partial | ❌ |

---

## 🧰 Architecture

```
┌────────────────────────────┐         SSH (your keys)        ┌──────────────────────────┐
│   DockPilot Desktop App    │  ───────  port-forward  ──────▶│  127.0.0.1:RUNNER_PORT   │
│   (Tauri + React + Rust)   │                                │  DockPilot Runner (Rust) │
│   runs on YOUR machine     │                                │  systemd service         │
└────────────────────────────┘                                │  Talks to Docker socket  │
                                                              └──────────────────────────┘
                                                                          │
                                                                          ▼
                                                                  /var/run/docker.sock
```

- **`app/`** — Tauri 2 desktop client, React UI, Rust backend for SSH and process management
- **`runner/`** — Axum HTTP service on each managed server, loopback-bound, bearer-token auth
- **`shared/`** — Wire types shared by app and runner

---

## 🛠️ Build from source

```bash
# Prereqs: Rust 1.75+, Node 20+, pnpm
git clone https://github.com/LocketHQ/DockPilot.git
cd DockPilot
pnpm --dir app install
pnpm --dir app tauri dev      # run the desktop app
cargo build -p lockethq-runner --release   # build the runner agent
```

See [TESTING.md](TESTING.md) for the test plan.

---

## 🗺️ Roadmap

- [ ] Kubernetes context support (k3s / k0s first)
- [ ] Built-in object-storage browser (S3 / R2 / B2)
- [ ] Scheduled backups with point-in-time DB snapshots
- [ ] Team mode with end-to-end-encrypted credential sharing
- [ ] Tauri mobile companion for on-call alerts
- [ ] Plugin API for custom deploy templates

Open an issue to vote or propose features.

---

## ❓ Frequently Asked Questions

### Is DockPilot a replacement for Docker Desktop?
**For remote servers, yes.** Docker Desktop manages containers on *your* machine. DockPilot manages containers on *your servers* — VPSes, homelab boxes, bare metal — with a similar native-feel UX.

### Is DockPilot a Heroku alternative or a self-hosted PaaS?
Both. DockPilot gives you the **deploy-from-git, attach-a-domain, get-HTTPS-automatically** workflow of Heroku/Render/Fly.io, but you bring your own VPS and you own everything end-to-end. It's a self-hosted PaaS without the self-hosted dashboard.

### How is this different from Portainer?
Portainer is a web app that runs *on* your server, which means you either expose its admin panel to the public internet or set up your own bastion. DockPilot runs on your laptop and reaches the runner through SSH. There's no public surface area to attack.

### How is this different from Coolify, Dokploy, or CapRover?
Those are excellent self-hosted PaaS web dashboards — but they're still web dashboards. DockPilot is a native desktop client with no public web UI, no Postgres for the dashboard itself, and no "what if my admin panel gets owned" failure mode.

### Does DockPilot integrate with Cloudflare?
Yes — **first-class Cloudflare DNS integration is built in.** Add a Cloudflare API token in Settings → Domains, and DockPilot will automatically create/update/delete A, AAAA, and CNAME records every time you attach a domain to a container. It also handles the **Cloudflare DNS-01 ACME challenge** for wildcard Let's Encrypt certs and lets you toggle the orange-cloud proxy per record.

### How does DockPilot use so little memory on my server?
Because **there is no hosted web dashboard on your server**. Everything that other tools run server-side as a Node.js app + Postgres + Redis + websocket gateway, DockPilot runs *on your laptop* as a native Tauri app. The only thing installed on your VPS is a **single static Rust binary (~8 MB resident)** that talks to the local Docker socket — plus Traefik when you actually want a domain. That's it. No browser-based admin panel competing with your real workloads for RAM.

### Does DockPilot work with my existing `docker-compose.yml`?
Yes. Import any Compose file. DockPilot will deploy it, track the stack, expose its containers in the fleet view, and let you manage env vars, volumes, and networks from the GUI.

### What about Kubernetes?
On the roadmap (k3s/k0s first). DockPilot's design — a thin per-host agent reached via SSH — maps cleanly to Kubernetes contexts. Not in v0.1 though.

### Is the runner safe to install?
The runner binds to `127.0.0.1` only, authenticates every request with a bearer token written to `/etc/lockethq/runner.toml` at install time, and ships as a systemd unit you can audit at [`runner/`](runner/). The desktop app reaches it via SSH port-forward — same trust boundary as `ssh` itself.

### Is it really free?
Yes. **MIT licensed**, no paid tier, no "open core" trick. If DockPilot saves you time, [star the repo](https://github.com/LocketHQ/DockPilot) ⭐ — it's the only currency we accept.

### What platforms does DockPilot run on?
**macOS 12+** (Apple Silicon and Intel), **Windows 10/11**, and **Linux** (Debian/Ubuntu `.deb` and universal `.AppImage`). Managed servers can be any Linux distro with systemd and a recent kernel.

### Does DockPilot phone home or collect telemetry?
**No.** Zero analytics, zero telemetry, zero outbound calls from either the desktop app or the runner.

---

## 🤝 Contributing

Pull requests are welcome. For larger changes, open an issue first to discuss the direction.

- [Open issues](https://github.com/LocketHQ/DockPilot/issues)
- [Discussions](https://github.com/LocketHQ/DockPilot/discussions)
- [Release notes](https://github.com/LocketHQ/DockPilot/releases)

---

## 📜 License

DockPilot is released under the [MIT License](LICENSE). Use it, fork it, ship it.

---

<div align="center">

**Built by [LocketHQ](https://github.com/LocketHQ)** — for developers who want their servers back.

If DockPilot is useful to you, please **[⭐ star the repo](https://github.com/LocketHQ/DockPilot)** — it genuinely helps others discover the project.

</div>

<!--
Keywords: docker gui, docker desktop alternative, docker manager, docker container management, docker dashboard, self-hosted paas, heroku alternative, render alternative, fly.io alternative, portainer alternative, coolify alternative, dokploy alternative, caprover alternative, dokku alternative, vps management, vps dashboard, server management tool, ssh tunnel docker, tauri docker, rust docker manager, container orchestration desktop app, devops desktop app, indie hacker tools, homelab dashboard, docker compose gui, docker swarm alternative, native docker client, remote docker management, local first paas, open source paas, mit license docker tool, lightweight docker dashboard, low memory docker manager, raspberry pi docker manager, tiny docker agent, rust runner, traefik gui, traefik dashboard alternative, cloudflare dns automation, cloudflare api docker, cloudflare dns docker, automatic https docker, lets encrypt docker manager, wildcard ssl docker
-->
