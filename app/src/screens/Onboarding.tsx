// First-server flow. Live SSH handshake panel while you fill the form.

import { useState } from "react";
import { LhqLogo } from "../components/Shell";
import { Btn, Input, Tag } from "../components/Primitives";
import { ConfirmModal } from "../components/Menu";
import { IconKey, IconRegion, IconServer, IconShield } from "../lib/icons";
import { useApp } from "../state";
import * as api from "../lib/api";

export function OnboardingScreen() {
  const { showToast, navigate, refreshServers } = useApp();
  const prefs = (() => {
    try { return JSON.parse(localStorage.getItem("lockethq.prefs") || "{}"); }
    catch { return {}; }
  })();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [user, setUser] = useState(prefs.defaultUser || "root");
  const [port, setPort] = useState(prefs.defaultPort || "22");
  const [authMode, setAuthMode] = useState<"key" | "password">("password");
  const [keyPath, setKeyPath] = useState("~/.ssh/id_ed25519");
  const [passphrase, setPassphrase] = useState("");
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState<"idle" | "testing" | "installing" | "done" | "error">("idle");
  const [log, setLog] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [needsDocker, setNeedsDocker] = useState(false);

  function buildAuth(): import("../lib/api").SshAuthInput {
    return authMode === "key"
      ? { mode: "key", privateKeyPath: keyPath, passphrase: passphrase || undefined }
      : { mode: "password", password };
  }

  async function test() {
    setStatus("testing");
    setErr(null);
    setLog((l) => [...l, "→ opening ssh session…"]);
    try {
      const out = await api.testSsh({
        host,
        sshPort: parseInt(port) || 22,
        sshUser: user,
        auth: buildAuth(),
      });
      setLog((l) => [...l, ...out.split("\n").filter(Boolean)]);
      setStatus("idle");
    } catch (e: any) {
      setErr(String(e));
      setStatus("error");
    }
  }

  async function install(installDocker = false) {
    setStatus("installing");
    setErr(null);
    setLog((l) => [
      ...l,
      installDocker ? "→ installing docker (get.docker.com)…" : "→ checking docker…",
      "→ uploading lockethq-runner…",
      "→ generating bearer token…",
      "→ writing /etc/lockethq/runner.toml…",
      "→ installing systemd unit…",
      "→ starting lockethq-runner.service…",
    ]);
    try {
      await api.addServer({
        name: name || host,
        host,
        sshPort: parseInt(port) || 22,
        sshUser: user,
        auth: buildAuth(),
        region: region || undefined,
        provider: provider || undefined,
        installDocker,
      });
      setLog((l) => [...l, "✓ runner online"]);
      setStatus("done");
      await refreshServers();
      showToast("Server added. Welcome to the fleet.");
      setTimeout(() => navigate({ kind: "servers" }), 800);
    } catch (e: any) {
      const msg = String(e);
      if (msg.includes("DOCKER_MISSING")) {
        setLog((l) => [...l, "✕ docker not found on this server"]);
        setStatus("idle");
        setNeedsDocker(true);
        return;
      }
      setErr(msg);
      setStatus("error");
    }
  }

  return (
    <div className="lhq-app">
      <div className="lhq-main" style={{ flex: "1 1 60%" }}>
        <div className="lhq-content" style={{ maxWidth: 640, margin: "0 auto", paddingTop: 56 }}>
          <LhqLogo />
          <h1
            className="serif-it"
            style={{ fontSize: 44, margin: "32px 0 8px", letterSpacing: "-0.02em", lineHeight: 1 }}
          >
            Add your first server.
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.5, marginTop: 8 }}>
            DockPilot SSH's in once — password or key, your call — to install the DockPilot
            Runner, then talks to it for everything else. Your containers keep running with or
            without this app open.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 36 }}>
            <Input label="Friendly name" placeholder="evergreen-prod-1" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="Hostname or IP" placeholder="65.108.42.171" value={host} onChange={(e) => setHost(e.target.value)} />
            <Input label="SSH user" value={user} onChange={(e) => setUser(e.target.value)} />
            <Input label="SSH port" value={port} onChange={(e) => setPort(e.target.value)} />
          </div>

          <div style={{ marginTop: 16 }}>
            <span className="lhq-label">Authentication</span>
            <div
              style={{
                display: "inline-flex",
                gap: 4,
                padding: 3,
                borderRadius: 8,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                marginTop: 4,
              }}
            >
              {(["password", "key"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setAuthMode(m)}
                  style={{
                    height: 28,
                    padding: "0 14px",
                    borderRadius: 6,
                    border: 0,
                    background: authMode === m ? "var(--surface)" : "transparent",
                    boxShadow: authMode === m ? "var(--shadow-sm)" : "none",
                    fontSize: 12.5,
                    fontFamily: "var(--sans)",
                    color: "var(--ink)",
                    fontWeight: authMode === m ? 500 : 400,
                    cursor: "default",
                  }}
                >
                  {m === "password" ? "Password" : "SSH key"}
                </button>
              ))}
            </div>
          </div>

          {authMode === "password" ? (
            <div style={{ marginTop: 12 }}>
              <Input
                label="SSH password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="off"
              />
            </div>
          ) : (
            <>
              <div style={{ marginTop: 12 }}>
                <Input
                  label="Private key path"
                  placeholder="~/.ssh/id_ed25519"
                  value={keyPath}
                  onChange={(e) => setKeyPath(e.target.value)}
                />
              </div>
              <div style={{ marginTop: 12 }}>
                <Input
                  label="Passphrase (if any)"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </div>
            </>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <Input label="Region (optional)" placeholder="fra-1" value={region} onChange={(e) => setRegion(e.target.value)} />
            <Input label="Provider (optional)" placeholder="Hetzner" value={provider} onChange={(e) => setProvider(e.target.value)} />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
            <Btn onClick={test} disabled={!host || status === "testing" || status === "installing"}>
              Test SSH
            </Btn>
            <Btn
              variant="primary"
              size="lg"
              onClick={() => install(false)}
              disabled={!host || status === "installing"}
            >
              {status === "installing" ? "Installing…" : "Install runner"}
            </Btn>
          </div>

          {err && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                border: "1px solid color-mix(in oklch, var(--danger) 30%, transparent)",
                background: "var(--danger-tint)",
                color: "oklch(0.42 0.12 25)",
                borderRadius: 8,
                fontSize: 12.5,
                fontFamily: "var(--mono)",
                whiteSpace: "pre-wrap",
              }}
            >
              {err}
            </div>
          )}
        </div>
      </div>

      {/* Side panel: live handshake log */}
      <aside
        style={{
          flex: "0 0 360px",
          background: "var(--surface-2)",
          borderLeft: "1px solid var(--border)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`lhq-pulse ${status === "error" ? "danger" : status === "idle" ? "idle" : ""}`} />
          <span className="lhq-h3" style={{ fontSize: 14 }}>
            {status === "installing" ? "Installing runner" : status === "testing" ? "Testing SSH" : status === "done" ? "Runner online" : "Idle"}
          </span>
        </div>

        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 14,
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            color: "var(--ink-2)",
            minHeight: 220,
            lineHeight: 1.7,
            overflow: "auto",
          }}
        >
          {log.length === 0 ? (
            <span style={{ color: "var(--muted-2)" }}>SSH handshake will appear here…</span>
          ) : (
            log.map((l, i) => <div key={i}>{l}</div>)
          )}
        </div>

        <div className="lhq-card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
            What gets installed
          </div>
          {[
            { icon: IconServer, label: "lockethq-runner", sub: "/usr/local/bin/lockethq-runner" },
            { icon: IconKey, label: "Bearer token", sub: "/etc/lockethq/runner.toml" },
            { icon: IconShield, label: "systemd service", sub: "lockethq-runner.service" },
            { icon: IconRegion, label: "Bound to 127.0.0.1", sub: "reached via SSH tunnel" },
          ].map((x) => {
            const Icon = x.icon as any;
            return (
              <div key={x.label} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0" }}>
                <Icon size={14} color="var(--muted)" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: "var(--ink)" }}>{x.label}</div>
                  <div style={{ fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>{x.sub}</div>
                </div>
              </div>
            );
          })}
        </div>

        <Tag tone="accent" style={{ alignSelf: "flex-start" }}>
          <span className="lhq-pulse" style={{ width: 6, height: 6 }} /> Containers run regardless of this app
        </Tag>
      </aside>

      <ConfirmModal
        open={needsDocker}
        title="Docker not installed"
        body={
          <>
            <p style={{ margin: "0 0 10px" }}>
              <b>{host}</b> doesn't have Docker yet. DockPilot can install it for you using the
              official <span className="mono">get.docker.com</span> script — supports
              Ubuntu/Debian/Fedora/Alpine/RHEL/CentOS.
            </p>
            <p style={{ margin: 0, color: "var(--muted-2)", fontSize: 12 }}>
              This will install Docker Engine + start the daemon. Takes 30–90 seconds depending
              on connection speed. After that DockPilot will finish installing the runner.
            </p>
          </>
        }
        confirmLabel="Install Docker + runner"
        busy={status === "installing"}
        onConfirm={() => {
          setNeedsDocker(false);
          install(true);
        }}
        onClose={() => {
          if (status !== "installing") setNeedsDocker(false);
        }}
      />
    </div>
  );
}
