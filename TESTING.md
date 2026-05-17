# End-to-end testing

I built and unit-checked the system to the point where:

- ✅ `cargo check --workspace` passes (shared + app + runner all compile)
- ✅ `cargo build -p lockethq-app` produces a working `.dylib` (debug)
- ✅ Frontend bundles with Vite and passes `tsc -b` strict typecheck
- ✅ Frontend screens are wired to real Tauri commands (no mock data left in the wired paths — see `app/src/lib/api.ts`)

What I could **not** test in this session because it requires user-supplied infrastructure:

- ❌ Adding a real remote server (needs a host + SSH key)
- ❌ The actual SSH install flow (needs sudo on a real Linux box)
- ❌ Streaming live logs from a real container

## Manual smoke test you can run

You'll need a Linux box with Docker installed and an SSH key set up. A cheap Hetzner CX11 (€4/mo) or any local VM works.

### 1. Build the Linux runner binaries

```bash
cd runner && ./build.sh
```

Requires Docker (with buildx). Drops `lockethq-runner-{x86_64,aarch64}` into `app/src-tauri/binaries/`.

### 2. Launch the app

```bash
cd app && pnpm tauri dev
```

The window opens to the sign-in screen.

### 3. Sign in (local profile)

Type anything for email and password — v1 keeps a local profile (no cloud signup). The app jumps to onboarding if you have no servers, or the fleet screen if you do.

### 4. Add a server

In onboarding:
- **Friendly name**: `my-test-box`
- **Hostname**: the IP of your Linux box
- **SSH user**: usually `root` or a user with passwordless sudo
- **SSH port**: `22`
- **Private key path**: e.g. `/Users/you/.ssh/id_ed25519`

Click **Test SSH** first — the side panel should show `uname -a` output.

Click **Install runner**. The side panel streams:
```
→ opening ssh session…
→ uploading lockethq-runner…
→ generating bearer token…
→ writing /etc/lockethq/runner.toml…
→ installing systemd unit…
→ starting lockethq-runner.service…
✓ runner online
```

You're redirected to the fleet view; your server appears with live CPU/memory metrics.

### 5. Deploy a container

- Click into the server, then **New container** in the top-right.
- Step 0 (Server): your server is preselected.
- Step 1 (Source): pick **From image**, enter `nginx:alpine`, name it `hello-nginx`.
- Step 2 (Configure): add port mapping `8080 → 80/tcp`. Restart `unless-stopped`.
- Step 3 (Review): confirm and **Deploy container**.

You should be redirected to the container detail view. The **Logs** tab streams nginx's startup output. Open `http://<your-server-ip>:8080/` in a browser — you'll see the nginx welcome page.

### 6. Stop / restart / remove

In container detail, the top-right has **Restart** and **Stop**. Then in the containers list, hover any row for the **…** menu (TODO: wire up to a context menu — currently the UI uses the row click to open detail).

### 7. Verify "runs without app open"

Quit DockPilot. SSH into the server. Run `docker ps` — your `hello-nginx` container should still be running. The runner is also still up (`systemctl status lockethq-runner`).

Re-open the app — everything reappears from local state.

## What's still rough in v1

- **No SSH tunnel**: runner binds to `0.0.0.0:8765`. You must firewall this port to your IP, or run on a private network. v1.1 will tunnel through SSH.
- **No TLS**: bearer token over plain HTTP. See above.
- **GitHub / upload / compose sources**: the wizard accepts them but the runner currently only deploys from `image`. The other source types return a "not yet implemented" error — TODO in `runner/src/docker.rs::create_container`.
- **Exec shell**: button shows but isn't wired yet. PTY-over-WebSocket is a v1.1 feature.
- **Domains** + **Database editor**: explicitly out of scope per session brief.
- **Container actions in list rows**: hover-menu (`…`) is visual only.
- **Volume size**: not populated (bollard doesn't return it by default; needs a separate inspect call).

## Useful inspection commands

On the remote server:

```bash
sudo systemctl status lockethq-runner
sudo journalctl -u lockethq-runner -f
sudo cat /etc/lockethq/runner.toml
curl -H "Authorization: Bearer $(sudo grep token /etc/lockethq/runner.toml | cut -d'"' -f2)" \
     http://localhost:8765/v1/info
```

On the Mac:

```bash
ls -la ~/Library/Application\ Support/co.lockethq.app/
cat ~/Library/Application\ Support/co.lockethq.app/servers.json
RUST_LOG=lockethq_app_lib=debug pnpm tauri dev
```
