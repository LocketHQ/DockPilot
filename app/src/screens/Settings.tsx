// SSH keys · Team · Preferences.

import { useEffect, useState } from "react";
import { LhqTopbar } from "../components/Shell";
import { Btn, Input, Tag } from "../components/Primitives";
import { IconKey, IconPlus, IconUser } from "../lib/icons";
import { useApp } from "../state";
import * as api from "../lib/api";

type Tab = "keys" | "prefs";

export function SettingsScreen({ tab }: { tab: Tab }) {
  return (
    <div className="lhq-main">
      <LhqTopbar breadcrumb={["Settings", labelFor(tab)]} />
      <div className="lhq-content">
        {tab === "keys" && <KeysTab />}
        {tab === "prefs" && <PrefsTab />}
      </div>
    </div>
  );
}

function KeysTab() {
  const { showToast } = useApp();
  const [keys, setKeys] = useState<api.SshKeyEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newPath, setNewPath] = useState("~/.ssh/lockethq_ed25519");
  const [pass, setPass] = useState("");

  async function refresh() {
    setErr(null);
    try { setKeys(await api.listSshKeys()); }
    catch (e: any) { setErr(String(e)); }
  }
  useEffect(() => { refresh(); }, []);

  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      const p = await api.generateSshKey(newPath, pass || undefined);
      showToast(`generated ${p}`);
      setPass("");
      await refresh();
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="lhq-card">
        <div className="lhq-h3" style={{ marginBottom: 12 }}>Local SSH keys</div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
          DockPilot reads private keys from disk only at install time, never uploads them.
        </p>
        {keys.length === 0 && (
          <div style={{ color: "var(--muted-2)", fontSize: 13 }}>No keys found under ~/.ssh/.</div>
        )}
        {keys.map((k) => (
          <div
            key={k.path}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <IconKey size={14} color="var(--muted)" />
            <div style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12.5 }}>{k.path}</div>
            <Tag>{k.kind}</Tag>
          </div>
        ))}
      </div>

      <div className="lhq-card">
        <div className="lhq-h3" style={{ marginBottom: 12 }}>Generate a new key (ed25519)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Input
            label="Path"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="~/.ssh/lockethq_ed25519"
          />
          <Input
            label="Passphrase (optional)"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </div>
        <Btn style={{ marginTop: 14 }} icon={IconPlus} onClick={generate} disabled={busy || !newPath}>
          {busy ? "Generating…" : "Generate key"}
        </Btn>
        {err && (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              color: "oklch(0.42 0.12 25)",
              fontFamily: "var(--mono)",
              whiteSpace: "pre-wrap",
            }}
          >
            {err}
          </div>
        )}
      </div>
    </div>
  );
}

function TeamTab() {
  return (
    <div className="lhq-card">
      <div className="lhq-h3" style={{ marginBottom: 12 }}>Team</div>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        DockPilot runs entirely on your Mac for now — server records and bearer tokens live in
        your app data directory. Hosted multi-user workspaces aren't in v1.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, padding: "10px 0" }}>
        <IconUser size={16} color="var(--muted)" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>You</div>
          <div style={{ fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>local profile</div>
        </div>
        <Tag tone="accent">Admin</Tag>
      </div>
    </div>
  );
}

const PREFS_KEY = "lockethq.prefs";

function PrefsTab() {
  const { signOut, showToast } = useApp();
  const [defaultUser, setDefaultUser] = useState("");
  const [defaultPort, setDefaultPort] = useState("");
  const [cfToken, setCfToken] = useState("");
  const [cfConnected, setCfConnected] = useState(false);
  const [cfBusy, setCfBusy] = useState(false);
  const [cfErr, setCfErr] = useState<string | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (p.defaultUser) setDefaultUser(p.defaultUser);
        if (p.defaultPort) setDefaultPort(p.defaultPort);
      } catch {}
    }
    import("../lib/api").then((api) => api.cfHasToken().then(setCfConnected).catch(() => {}));
  }, []);

  function save() {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ defaultUser, defaultPort }));
  }

  async function saveCfToken() {
    setCfBusy(true);
    setCfErr(null);
    try {
      const api = await import("../lib/api");
      await api.cfSaveToken(cfToken || null);
      setCfConnected(!!cfToken);
      setCfToken("");
      showToast(cfToken ? "cloudflare connected" : "cloudflare disconnected");
    } catch (e: any) {
      setCfErr(String(e));
    } finally {
      setCfBusy(false);
    }
  }
  async function disconnectCf() {
    setCfBusy(true);
    try {
      const api = await import("../lib/api");
      await api.cfSaveToken(null);
      setCfConnected(false);
      showToast("cloudflare disconnected");
    } catch (e: any) {
      setCfErr(String(e));
    } finally {
      setCfBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="lhq-card">
        <div className="lhq-h3" style={{ marginBottom: 16 }}>SSH defaults</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Input
            label="Default SSH user"
            placeholder="root"
            value={defaultUser}
            onChange={(e) => setDefaultUser(e.target.value)}
            onBlur={save}
          />
          <Input
            label="Default SSH port"
            placeholder="22"
            value={defaultPort}
            onChange={(e) => setDefaultPort(e.target.value)}
            onBlur={save}
          />
        </div>
      </div>

      <div className="lhq-card">
        <div className="lhq-h3" style={{ marginBottom: 8 }}>Cloudflare</div>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>
          Used for the Domains page — auto-creates DNS records when you attach a domain to a
          container. Make a token at{" "}
          <span className="mono">dash.cloudflare.com → My Profile → API Tokens</span> with{" "}
          <span className="mono">Zone:DNS:Edit</span> scope on the zones you want to manage.
        </p>
        {cfConnected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Tag tone="accent">
              <span className="lhq-pulse" style={{ width: 6, height: 6 }} /> Connected
            </Tag>
            <div style={{ flex: 1 }} />
            <Btn variant="danger" onClick={disconnectCf} disabled={cfBusy}>
              Disconnect
            </Btn>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10 }}>
            <input
              className="lhq-input"
              type="password"
              placeholder="Cloudflare API token"
              value={cfToken}
              onChange={(e) => setCfToken(e.target.value)}
              style={{ flex: 1 }}
            />
            <Btn variant="primary" onClick={saveCfToken} disabled={cfBusy || !cfToken}>
              {cfBusy ? "Verifying…" : "Connect"}
            </Btn>
          </div>
        )}
        {cfErr && (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              color: "oklch(0.42 0.12 25)",
              fontFamily: "var(--mono)",
              whiteSpace: "pre-wrap",
            }}
          >
            {cfErr}
          </div>
        )}
      </div>

      <div className="lhq-card">
        <div className="lhq-h3" style={{ marginBottom: 12 }}>Workspace</div>
        <Btn variant="danger" onClick={signOut}>
          Sign out of this workspace
        </Btn>
      </div>
    </div>
  );
}

function labelFor(t: Tab) {
  return t === "keys" ? "SSH keys" : "Preferences";
}
