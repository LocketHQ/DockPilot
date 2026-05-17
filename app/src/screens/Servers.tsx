// Servers list (fleet dashboard) + single server overview.

import { useEffect, useRef, useState } from "react";
import { LhqTopbar } from "../components/Shell";
import { Btn, Tag } from "../components/Primitives";
import { ConfirmModal, Menu } from "../components/Menu";
import { RunnerLogsModal } from "../components/LogsViewer";
import { HealthRing, Sparkline, AreaChart } from "../components/Charts";
import {
  IconChevR,
  IconDots,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconUpload,
  IconX,
} from "../lib/icons";
import { useApp } from "../state";
import type { ContainerSummary, ServerRecord, SystemInfo, SystemStats } from "../lib/types";
import * as api from "../lib/api";

type Live = {
  info?: SystemInfo;
  stats?: SystemStats;
  containers?: ContainerSummary[];
  error?: string;
};

function useLiveServer(id: string | null): Live {
  const [live, setLive] = useState<Live>({});
  useEffect(() => {
    if (!id) return;
    let cancel = false;
    (async () => {
      try {
        const [info, stats, containers] = await Promise.all([
          api.getInfo(id),
          api.getStats(id),
          api.listContainers(id),
        ]);
        if (!cancel) setLive({ info, stats, containers });
      } catch (e: any) {
        if (!cancel) setLive({ error: String(e) });
      }
    })();
    const t = setInterval(async () => {
      try {
        const stats = await api.getStats(id);
        if (!cancel) setLive((l) => ({ ...l, stats }));
      } catch {
        /* swallow */
      }
    }, 3000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, [id]);
  return live;
}

export function ServersListScreen() {
  const { servers, refreshServers, navigate, showToast } = useApp();
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"Grid" | "List">("Grid");
  const [pendingRemove, setPendingRemove] = useState<ServerRecord | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<ServerRecord | null>(null);
  const [logsFor, setLogsFor] = useState<ServerRecord | null>(null);
  const [removing, setRemoving] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);

  const filtered = servers.filter(
    (s) =>
      !filter ||
      s.name.toLowerCase().includes(filter.toLowerCase()) ||
      s.host.toLowerCase().includes(filter.toLowerCase())
  );

  async function doRestartDocker(id: string) {
    try { await api.restartDocker(id); showToast("docker restarted"); }
    catch (e: any) { showToast(String(e)); }
  }
  async function doRestartRunner(id: string) {
    try { await api.restartRunner(id); showToast("runner restarted"); }
    catch (e: any) { showToast(String(e)); }
  }
  async function doUpdateRunner(id: string) {
    showToast("updating runner…");
    try { await api.updateRunner(id); showToast("runner updated"); }
    catch (e: any) { showToast(String(e)); }
  }
  async function doRemove(id: string) {
    setRemoving(true);
    try {
      await api.removeServer(id);
      await refreshServers();
      showToast("server removed");
      setPendingRemove(null);
    } catch (e: any) {
      showToast(String(e));
    } finally {
      setRemoving(false);
    }
  }
  async function doUninstall(id: string) {
    setUninstalling(true);
    try {
      await api.uninstallRunner(id);
      await refreshServers();
      showToast("runner uninstalled");
      setPendingUninstall(null);
    } catch (e: any) {
      showToast(String(e));
    } finally {
      setUninstalling(false);
    }
  }

  return (
    <div className="lhq-main">
      <LhqTopbar
        breadcrumb={["Workspace", "Servers"]}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <IconSearch
                size={13}
                color="var(--muted-2)"
                style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
              />
              <input
                className="lhq-input"
                placeholder="Filter…"
                style={{ width: 220, paddingLeft: 34, height: 34 }}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <Btn
              icon={IconRefresh}
              variant="ghost"
              onClick={() => {
                refreshServers();
                showToast("Refreshed");
              }}
            />
            <Btn variant="primary" icon={IconPlus} onClick={() => navigate({ kind: "onboarding" })}>
              Add server
            </Btn>
          </div>
        }
      />
      <div className="lhq-content">
        <FleetSummary servers={servers} />

        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, marginTop: 28 }}>
          <h3 className="lhq-h3">All servers</h3>
          <span style={{ fontSize: 12, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
            · {servers.length} machines
          </span>
          <div style={{ flex: 1 }} />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: 3,
              borderRadius: 8,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
            }}
          >
            {(["Grid", "List"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  height: 26,
                  padding: "0 12px",
                  borderRadius: 6,
                  border: 0,
                  background: view === v ? "var(--surface)" : "transparent",
                  boxShadow: view === v ? "var(--shadow-sm)" : "none",
                  fontSize: 12,
                  fontFamily: "var(--sans)",
                  color: "var(--ink)",
                  fontWeight: view === v ? 500 : 400,
                  cursor: "default",
                }}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {view === "Grid" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            {filtered.map((s) => (
              <ServerTile
                key={s.id}
                server={s}
                onOpen={() => navigate({ kind: "server", id: s.id })}
                onRestartDocker={() => doRestartDocker(s.id)}
                onRestartRunner={() => doRestartRunner(s.id)}
                onUpdateRunner={() => doUpdateRunner(s.id)}
                onViewLogs={() => setLogsFor(s)}
                onRemove={() => setPendingRemove(s)}
                onUninstall={() => setPendingUninstall(s)}
              />
            ))}

            <button
              onClick={() => navigate({ kind: "onboarding" })}
              style={{
                border: "1px dashed var(--border-strong)",
                borderRadius: 14,
                padding: 20,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                color: "var(--muted)",
                minHeight: 220,
                background: "var(--surface-2)",
                cursor: "default",
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 999,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IconPlus size={16} color="var(--ink)" />
              </div>
              <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>Add server</div>
              <div style={{ fontSize: 11.5, color: "var(--muted-2)" }}>SSH · install runner</div>
            </button>
          </div>
        ) : (
          <ServersList
            servers={filtered}
            onOpen={(id) => navigate({ kind: "server", id })}
            onRestartDocker={doRestartDocker}
            onRestartRunner={doRestartRunner}
            onUpdateRunner={doUpdateRunner}
            onViewLogs={(s) => setLogsFor(s)}
            onRemove={(s) => setPendingRemove(s)}
            onUninstall={(s) => setPendingUninstall(s)}
            onAdd={() => navigate({ kind: "onboarding" })}
          />
        )}

        <ConfirmModal
          open={!!pendingRemove}
          title={`Remove ${pendingRemove?.name}?`}
          body={
            <>
              This forgets credentials locally. The runner stays installed on the box,
              containers keep running. You can re-add the server later via onboarding.
            </>
          }
          confirmLabel="Remove"
          destructive
          busy={removing}
          onConfirm={() => { if (pendingRemove) doRemove(pendingRemove.id); }}
          onClose={() => { if (!removing) setPendingRemove(null); }}
        />

        <ConfirmModal
          open={!!pendingUninstall}
          title={`Uninstall runner from ${pendingUninstall?.name}?`}
          body={
            <>
              <p style={{ margin: "0 0 10px" }}>
                SSH in and remove every trace of DockPilot on the remote box:
              </p>
              <ul style={{ margin: 0, padding: "0 0 0 18px", fontFamily: "var(--mono)", fontSize: 12.5 }}>
                <li>disable + stop <span className="mono">lockethq-runner.service</span></li>
                <li>delete <span className="mono">/usr/local/bin/lockethq-runner</span></li>
                <li>delete <span className="mono">/etc/lockethq/</span></li>
                <li>delete <span className="mono">/etc/systemd/system/lockethq-runner.service</span></li>
              </ul>
              <p style={{ margin: "10px 0 0", color: "var(--muted-2)", fontSize: 12 }}>
                Your existing Docker containers are not touched.
              </p>
            </>
          }
          confirmLabel="Uninstall"
          destructive
          busy={uninstalling}
          onConfirm={() => { if (pendingUninstall) doUninstall(pendingUninstall.id); }}
          onClose={() => { if (!uninstalling) setPendingUninstall(null); }}
        />

        <RunnerLogsModal
          open={!!logsFor}
          serverId={logsFor?.id || ""}
          serverName={logsFor?.name || ""}
          onClose={() => setLogsFor(null)}
        />

        {servers.length === 0 && filtered.length === 0 && (
          <div
            style={{
              marginTop: 40,
              padding: 24,
              textAlign: "center",
              color: "var(--muted)",
              fontSize: 13.5,
              border: "1px dashed var(--border)",
              borderRadius: 14,
            }}
          >
            No servers yet — install the runner on your first box to get started.
          </div>
        )}
      </div>
    </div>
  );
}

function FleetSummary({ servers }: { servers: ServerRecord[] }) {
  const [stats, setStats] = useState<Record<string, SystemStats>>({});
  const [containers, setContainers] = useState<Record<string, number>>({});
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);

  useEffect(() => {
    let cancel = false;
    const tick = async () => {
      const out: Record<string, SystemStats> = {};
      const cs: Record<string, number> = {};
      for (const s of servers) {
        try {
          out[s.id] = await api.getStats(s.id);
          cs[s.id] = (await api.listContainers(s.id)).length;
        } catch {
          /* skip */
        }
      }
      if (cancel) return;
      setStats(out);
      setContainers(cs);
      const vals = Object.values(out);
      if (vals.length) {
        const avg = vals.reduce((a, b) => a + b.cpu_percent, 0) / vals.length;
        setCpuHistory((h) => [...h, avg].slice(-40));
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, [servers]);

  const avgCpu = (() => {
    const vals = Object.values(stats);
    if (!vals.length) return 0;
    return Math.round(vals.reduce((a, b) => a + b.cpu_percent, 0) / vals.length);
  })();
  const avgMem = (() => {
    const vals = Object.values(stats);
    if (!vals.length) return 0;
    return Math.round(
      vals.reduce((a, b) => a + (b.memory_used_mb / Math.max(1, b.memory_total_mb)) * 100, 0) /
        vals.length
    );
  })();
  const totalContainers = Object.values(containers).reduce((a, b) => a + b, 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
      <div className="lhq-metric">
        <div className="label">Active servers</div>
        <div>
          <span className="value">{servers.length}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
          <span className="lhq-pulse" /> All regions
        </div>
      </div>
      <div className="lhq-metric">
        <div className="label">Total containers</div>
        <div>
          <span className="value">{totalContainers}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>across the fleet</div>
      </div>
      <div className="lhq-metric">
        <div className="label">Fleet CPU</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="value">{avgCpu}</span>
          <span className="unit">% avg</span>
        </div>
        {cpuHistory.length > 1 ? (
          <Sparkline data={cpuHistory} width={240} height={28} />
        ) : (
          <div style={{ height: 28 }} />
        )}
      </div>
      <div className="lhq-metric">
        <div className="label">Avg memory</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="value">{avgMem || "—"}</span>
          <span className="unit">% avg</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          across {servers.length} {servers.length === 1 ? "server" : "servers"}
        </div>
      </div>
    </div>
  );
}

type TileProps = {
  server: ServerRecord;
  onOpen: () => void;
  onRestartDocker: () => void;
  onRestartRunner: () => void;
  onUpdateRunner: () => void;
  onViewLogs: () => void;
  onRemove: () => void;
  onUninstall: () => void;
};

export function ServerTile({ server, onOpen, onRestartDocker, onRestartRunner, onUpdateRunner, onViewLogs, onRemove, onUninstall }: TileProps) {
  const live = useLiveServer(server.id);
  const dotsRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const cpu = Math.round(live.stats?.cpu_percent ?? 0);
  const mem = live.stats
    ? Math.round((live.stats.memory_used_mb / Math.max(1, live.stats.memory_total_mb)) * 100)
    : 0;
  const disk = live.stats
    ? Math.round((live.stats.disk_used_gb / Math.max(1, live.stats.disk_total_gb)) * 100)
    : 0;

  const tone = cpu > 85 ? "var(--danger)" : cpu > 70 ? "var(--warn)" : live.error ? "var(--faint)" : "var(--accent)";
  const status = live.error
    ? "Offline"
    : cpu > 85
    ? "Critical"
    : cpu > 70
    ? "High load"
    : "Healthy";

  return (
    <div
      onClick={onOpen}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 18,
        background: "var(--surface)",
        textAlign: "left",
        cursor: "default",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <HealthRing
          size={48}
          value={cpu / 100}
          color={tone}
          label={<span style={{ fontFamily: "var(--mono)", fontStyle: "normal", fontSize: 11, color: "var(--ink)" }}>{cpu}%</span>}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: "-0.005em" }}>{server.name}</div>
          <div style={{ fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--mono)", marginTop: 2 }}>
            {server.flag || ""} {server.region || "—"} · {server.provider || "—"} · {server.host}
          </div>
          <div style={{ marginTop: 6 }}>
            {status === "Healthy" && (
              <Tag tone="accent">
                <span className="lhq-pulse" style={{ width: 6, height: 6 }} /> Healthy
              </Tag>
            )}
            {status === "High load" && (
              <Tag tone="warn">
                <span className="lhq-pulse warn" style={{ width: 6, height: 6 }} /> High load
              </Tag>
            )}
            {status === "Critical" && (
              <Tag tone="danger">
                <span className="lhq-pulse danger" style={{ width: 6, height: 6 }} /> Critical
              </Tag>
            )}
            {status === "Offline" && <Tag>Offline</Tag>}
          </div>
        </div>
        <button
          ref={dotsRef}
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          aria-label="Server actions"
          style={{
            width: 24, height: 24,
            border: 0, background: "transparent",
            borderRadius: 6, cursor: "default",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--muted-2)",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--surface-2)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
        >
          <IconDots size={14} />
        </button>
        <Menu
          anchorRef={dotsRef}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          items={[
            { label: "Open", hint: "→", onClick: onOpen },
            { label: "Inspect runner logs", onClick: onViewLogs },
            { label: "Update runner", onClick: onUpdateRunner },
            { label: "Restart Docker", onClick: onRestartDocker },
            { label: "Restart runner", onClick: onRestartRunner },
            { label: "Remove server (local only)", onClick: onRemove },
            { label: "Uninstall runner from remote", destructive: true, onClick: onUninstall },
          ]}
        />
      </div>

      <div
        style={{
          marginTop: 14,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
        }}
      >
        <Mini label="mem" value={`${mem}%`} color="var(--ink)" />
        <Mini label="disk" value={`${disk}%`} color="var(--muted)" />
        <Mini label="ctr" value={`${live.containers?.length ?? "—"}`} color="var(--info)" />
      </div>

      <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          uptime <span className="mono">{live.info ? Math.round(live.info.uptime_seconds / 86400) + " d" : "—"}</span>
        </div>
        <IconChevR size={14} color="var(--muted-2)" />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// List view
// ──────────────────────────────────────────────────────────────────────

function ServersList({
  servers,
  onOpen,
  onRestartDocker,
  onRestartRunner,
  onUpdateRunner,
  onViewLogs,
  onRemove,
  onUninstall,
  onAdd,
}: {
  servers: ServerRecord[];
  onOpen: (id: string) => void;
  onRestartDocker: (id: string) => void;
  onRestartRunner: (id: string) => void;
  onUpdateRunner: (id: string) => void;
  onViewLogs: (s: ServerRecord) => void;
  onRemove: (s: ServerRecord) => void;
  onUninstall: (s: ServerRecord) => void;
  onAdd: () => void;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--surface)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "32px 1.6fr 1.2fr 90px 90px 90px 32px",
          gap: 12,
          padding: "11px 18px",
          background: "var(--surface-2)",
          fontSize: 10.5,
          color: "var(--muted-2)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span />
        <span>Server</span>
        <span>Host</span>
        <span style={{ textAlign: "right" }}>CPU</span>
        <span style={{ textAlign: "right" }}>Mem</span>
        <span style={{ textAlign: "right" }}>Containers</span>
        <span />
      </div>
      {servers.map((s, i) => (
        <ServerListRow
          key={s.id}
          server={s}
          last={i === servers.length - 1}
          onOpen={() => onOpen(s.id)}
          onRestartDocker={() => onRestartDocker(s.id)}
          onRestartRunner={() => onRestartRunner(s.id)}
          onUpdateRunner={() => onUpdateRunner(s.id)}
          onViewLogs={() => onViewLogs(s)}
          onRemove={() => onRemove(s)}
          onUninstall={() => onUninstall(s)}
        />
      ))}
      <button
        onClick={onAdd}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "14px 18px",
          border: 0,
          borderTop: servers.length ? "1px solid var(--border)" : "none",
          background: "transparent",
          color: "var(--muted)",
          fontSize: 13,
          cursor: "default",
        }}
      >
        <IconPlus size={14} color="var(--ink)" />
        <span>Add server</span>
      </button>
    </div>
  );
}

function ServerListRow({
  server,
  last,
  onOpen,
  onRestartDocker,
  onRestartRunner,
  onUpdateRunner,
  onViewLogs,
  onRemove,
  onUninstall,
}: {
  server: ServerRecord;
  last: boolean;
  onOpen: () => void;
  onRestartDocker: () => void;
  onRestartRunner: () => void;
  onUpdateRunner: () => void;
  onViewLogs: () => void;
  onRemove: () => void;
  onUninstall: () => void;
}) {
  const live = useLiveServer(server.id);
  const dotsRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const cpu = Math.round(live.stats?.cpu_percent ?? 0);
  const mem = live.stats
    ? Math.round((live.stats.memory_used_mb / Math.max(1, live.stats.memory_total_mb)) * 100)
    : 0;
  const tone = cpu > 85 ? "danger" : cpu > 70 ? "warn" : live.error ? undefined : "accent";

  return (
    <div
      onClick={onOpen}
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1.6fr 1.2fr 90px 90px 90px 32px",
        gap: 12,
        padding: "12px 18px",
        borderBottom: last ? "none" : "1px solid var(--border)",
        alignItems: "center",
        cursor: "default",
      }}
    >
      <span
        className={`lhq-pulse${live.error ? " idle" : tone === "warn" ? " warn" : tone === "danger" ? " danger" : ""}`}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{server.name}</div>
        <div style={{ fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
          {server.region || "—"} · {server.provider || "—"}
        </div>
      </div>
      <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--ink-2)" }}>{server.host}</div>
      <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12.5 }}>
        {live.stats ? `${cpu}%` : "—"}
      </div>
      <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12.5 }}>
        {live.stats ? `${mem}%` : "—"}
      </div>
      <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12.5 }}>
        {live.containers?.length ?? "—"}
      </div>
      <button
        ref={dotsRef}
        onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
        aria-label="Server actions"
        style={{
          width: 24, height: 24, border: 0, background: "transparent",
          borderRadius: 6, cursor: "default",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--muted-2)", justifySelf: "end",
        }}
      >
        <IconDots size={14} />
      </button>
      <Menu
        anchorRef={dotsRef}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={[
          { label: "Open", hint: "→", onClick: onOpen },
          { label: "Inspect runner logs", onClick: onViewLogs },
          { label: "Update runner", onClick: onUpdateRunner },
          { label: "Restart Docker", onClick: onRestartDocker },
          { label: "Restart runner", onClick: onRestartRunner },
          { label: "Remove server (local only)", onClick: onRemove },
          { label: "Uninstall runner from remote", destructive: true, onClick: onUninstall },
        ]}
      />
    </div>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div className="lhq-stat" style={{ fontSize: 14, marginTop: 4, color }}>
        {value}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Server overview
// ──────────────────────────────────────────────────────────────────────

export function ServerOverviewScreen({ serverId }: { serverId: string }) {
  const { servers, navigate, showToast, refreshServers } = useApp();
  const server = servers.find((s) => s.id === serverId);
  const live = useLiveServer(serverId);
  const tabs = ["Overview", "Containers", "Volumes", "Networks"];
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  async function doRestartDocker() {
    setBusy("docker");
    try { await api.restartDocker(serverId); showToast("docker restarted"); }
    catch (e: any) { showToast(String(e)); }
    finally { setBusy(null); }
  }
  async function doRestartRunner() {
    setBusy("runner");
    try { await api.restartRunner(serverId); showToast("runner restarted"); }
    catch (e: any) { showToast(String(e)); }
    finally { setBusy(null); }
  }
  async function doUpdateRunnerBinary() {
    setBusy("update");
    try { await api.updateRunner(serverId); showToast("runner updated"); }
    catch (e: any) { showToast(String(e)); }
    finally { setBusy(null); }
  }
  async function doRemoveServer() {
    setBusy("remove");
    try {
      await api.removeServer(serverId);
      await refreshServers();
      showToast("server removed");
      navigate({ kind: "servers" });
    } catch (e: any) {
      showToast(String(e));
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  }
  async function doUninstallRunner() {
    setBusy("uninstall");
    try {
      await api.uninstallRunner(serverId);
      await refreshServers();
      showToast("runner uninstalled");
      navigate({ kind: "servers" });
    } catch (e: any) {
      showToast(String(e));
    } finally {
      setBusy(null);
      setConfirmUninstall(false);
    }
  }

  // Track a CPU history for the area chart.
  const [history, setHistory] = useState<number[]>([]);
  useEffect(() => {
    if (live.stats) setHistory((h) => [...h.slice(-47), live.stats!.cpu_percent]);
  }, [live.stats]);

  if (!server) return <div className="lhq-content">Server not found.</div>;

  return (
    <div className="lhq-main">
      <LhqTopbar
        breadcrumb={["Servers", server.name]}
        kicker={`${server.provider || "—"} · ${server.region || "—"} · ${server.host}`}
        status={live.error ? "Offline" : "Live"}
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="primary" icon={IconPlus} onClick={() => navigate({ kind: "wizard", step: 0 })}>
              New container
            </Btn>
          </div>
        }
      />
      <div className="lhq-content" style={{ padding: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "0 32px",
            borderBottom: "1px solid var(--border)",
            position: "sticky",
            top: 0,
            background: "var(--surface)",
            zIndex: 1,
          }}
        >
          {tabs.map((t, i) => (
            <button
              key={t}
              onClick={() => setTab(i)}
              style={{
                padding: "14px 12px",
                fontSize: 13,
                color: i === tab ? "var(--ink)" : "var(--muted)",
                fontWeight: i === tab ? 500 : 400,
                borderBottom: "2px solid",
                borderBottomColor: i === tab ? "var(--ink)" : "transparent",
                marginBottom: -1,
                background: "none",
                border: 0,
                cursor: "default",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <div style={{ padding: "24px 32px" }}>
          {tab === 0 && (
          <>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>
            <div className="lhq-card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: 20, borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
                  <HealthRing
                    size={86}
                    value={(live.stats?.cpu_percent ?? 0) / 100}
                    label={
                      <span className="lhq-stat" style={{ fontSize: 22, fontWeight: 600 }}>
                        {Math.round(live.stats?.cpu_percent ?? 0)}
                        <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>%</span>
                      </span>
                    }
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontFamily: "var(--sans)", fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>
                        {server.name}
                      </span>
                      <Tag tone={live.error ? "danger" : "accent"}>
                        <span className={`lhq-pulse${live.error ? " danger" : ""}`} style={{ width: 6, height: 6 }} />{" "}
                        {live.error ? "Offline" : "Healthy"}
                      </Tag>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--mono)", marginTop: 6 }}>
                      {live.info ? `${live.info.os} · kernel ${live.info.kernel} · Docker ${live.info.docker_version}` : "fetching…"}
                    </div>
                    <div style={{ display: "flex", gap: 20, marginTop: 14 }}>
                      <Field label="CPU" value={`${Math.round(live.stats?.cpu_percent ?? 0)}%`} />
                      <Field
                        label="Memory"
                        value={
                          live.stats
                            ? `${(live.stats.memory_used_mb / 1024).toFixed(1)} / ${(live.stats.memory_total_mb / 1024).toFixed(0)} GB`
                            : "—"
                        }
                      />
                      <Field
                        label="Disk"
                        value={live.stats ? `${live.stats.disk_used_gb} / ${live.stats.disk_total_gb} GB` : "—"}
                      />
                      <Field
                        label="Uptime"
                        value={live.info ? `${Math.round(live.info.uptime_seconds / 86400)} d` : "—"}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 16 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted-2)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  CPU · last samples
                </div>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, fontFamily: "var(--mono)", color: "var(--ink)", fontWeight: 600 }}>LIVE</span>
              </div>
              <div style={{ padding: "0 12px 12px" }}>
                {history.length > 1 ? (
                  <AreaChart
                    data={history}
                    width={620}
                    height={200}
                    xLabels={["t-47", "t-36", "t-24", "t-12", "now"]}
                    unit="%"
                  />
                ) : (
                  <div
                    style={{
                      height: 200,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--muted-2)",
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                    }}
                  >
                    waiting for first sample…
                  </div>
                )}
              </div>
            </div>

            <div className="lhq-card" style={{ padding: 0 }}>
              <div
                style={{
                  padding: "16px 18px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <span className="lhq-h3" style={{ fontSize: 14 }}>
                  Quick actions
                </span>
              </div>
              <div style={{ padding: 8 }}>
                {[
                  {
                    icon: IconPlus,
                    label: "Deploy a container",
                    sub: "image · github · upload · compose",
                    accent: true,
                    onClick: () => navigate({ kind: "wizard", step: 0 }),
                    disabled: false,
                  },
                  {
                    icon: IconRefresh,
                    label: "Restart Docker daemon",
                    sub: busy === "docker" ? "running…" : "systemctl restart docker",
                    onClick: doRestartDocker,
                    disabled: busy === "docker",
                  },
                  {
                    icon: IconRefresh,
                    label: "Inspect runner logs",
                    sub: "journalctl -u lockethq-runner -n 200",
                    onClick: () => setLogsOpen(true),
                    disabled: false,
                  },
                  {
                    icon: IconRefresh,
                    label: "Restart DockPilot runner",
                    sub: busy === "runner" ? "running…" : "systemctl restart lockethq-runner",
                    onClick: doRestartRunner,
                    disabled: busy === "runner",
                  },
                  {
                    icon: IconUpload,
                    label: "Update runner binary",
                    sub: busy === "update" ? "uploading…" : "push the bundled binary, restart service",
                    onClick: doUpdateRunnerBinary,
                    disabled: busy === "update",
                  },
                  {
                    icon: IconDots,
                    label: "Remove server (local only)",
                    sub: "forgets credentials; containers keep running",
                    onClick: () => setConfirmRemove(true),
                    disabled: busy === "remove",
                  },
                  {
                    icon: IconX,
                    label: "Uninstall runner from remote",
                    sub: busy === "uninstall" ? "running…" : "ssh in, remove all runner files",
                    onClick: () => setConfirmUninstall(true),
                    disabled: busy === "uninstall",
                  },
                ].map((a, i) => {
                  const Icon = a.icon as any;
                  return (
                    <button
                      key={i}
                      onClick={a.onClick}
                      disabled={a.disabled}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: (a as any).accent ? "var(--accent-tint)" : "transparent",
                        border: 0,
                        width: "100%",
                        textAlign: "left",
                        cursor: "default",
                        opacity: a.disabled ? 0.5 : 1,
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 7,
                          background: (a as any).accent ? "var(--accent)" : "var(--surface-2)",
                          color: (a as any).accent ? "#0E1F18" : "var(--ink)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: (a as any).accent ? "none" : "1px solid var(--border)",
                        }}
                      >
                        <Icon size={14} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{a.label}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>{a.sub}</div>
                      </div>
                      <IconChevR size={13} color="var(--muted-2)" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
              <span className="lhq-h3">Containers</span>
              <span style={{ fontSize: 12, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
                · {live.containers?.length ?? "—"} on this host
              </span>
              <div style={{ flex: 1 }} />
              <Btn size="sm" variant="ghost" onClick={() => navigate({ kind: "containers" })}>
                View all <IconChevR size={12} />
              </Btn>
            </div>
            <ContainerInlineList
              containers={(live.containers || []).slice(0, 6)}
              onOpen={(cid) => navigate({ kind: "container", serverId: serverId, containerId: cid })}
            />
          </div>
          </>
          )}

          {tab === 1 && (
            <ServerContainersTab
              containers={live.containers || []}
              onOpen={(cid) => navigate({ kind: "container", serverId, containerId: cid })}
              onDeploy={() => navigate({ kind: "wizard", step: 0 })}
            />
          )}
          {tab === 2 && <ServerVolumesTab serverId={serverId} />}
          {tab === 3 && <ServerNetworksTab serverId={serverId} />}
        </div>
      </div>
      <ConfirmModal
        open={confirmRemove}
        title={`Remove ${server.name}?`}
        body={
          <>
            This forgets credentials locally. The runner stays installed on the box and
            containers keep running. You can re-add the server later from onboarding.
          </>
        }
        confirmLabel="Remove"
        destructive
        busy={busy === "remove"}
        onConfirm={doRemoveServer}
        onClose={() => { if (busy !== "remove") setConfirmRemove(false); }}
      />
      <RunnerLogsModal
        open={logsOpen}
        serverId={serverId}
        serverName={server.name}
        onClose={() => setLogsOpen(false)}
      />
      <ConfirmModal
        open={confirmUninstall}
        title={`Uninstall runner from ${server.name}?`}
        body={
          <>
            <p style={{ margin: "0 0 10px" }}>
              SSH in and remove every trace of DockPilot on the remote box:
            </p>
            <ul style={{ margin: 0, padding: "0 0 0 18px", fontFamily: "var(--mono)", fontSize: 12.5 }}>
              <li>disable + stop <span className="mono">lockethq-runner.service</span></li>
              <li>delete <span className="mono">/usr/local/bin/lockethq-runner</span></li>
              <li>delete <span className="mono">/etc/lockethq/</span></li>
              <li>delete <span className="mono">/etc/systemd/system/lockethq-runner.service</span></li>
            </ul>
            <p style={{ margin: "10px 0 0", color: "var(--muted-2)", fontSize: 12 }}>
              Existing Docker containers are not touched.
            </p>
          </>
        }
        confirmLabel="Uninstall"
        destructive
        busy={busy === "uninstall"}
        onConfirm={doUninstallRunner}
        onClose={() => { if (busy !== "uninstall") setConfirmUninstall(false); }}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div className="lhq-stat" style={{ fontSize: 16 }}>
        {value}
      </div>
    </div>
  );
}

function ContainerInlineList({
  containers,
  onOpen,
}: {
  containers: ContainerSummary[];
  onOpen: (id: string) => void;
}) {
  if (!containers.length) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          border: "1px dashed var(--border)",
          borderRadius: 14,
          color: "var(--muted)",
          fontSize: 13,
        }}
      >
        No containers yet — kick off the wizard above.
      </div>
    );
  }
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 14,
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      {containers.map((c, i) => (
        <button
          key={c.id}
          onClick={() => onOpen(c.id)}
          style={{
            display: "grid",
            gridTemplateColumns: "16px 1.6fr 1.6fr 1fr 32px",
            gap: 12,
            padding: "12px 18px",
            alignItems: "center",
            background: "transparent",
            border: 0,
            borderBottom: i < containers.length - 1 ? "1px solid var(--border)" : "none",
            width: "100%",
            textAlign: "left",
            cursor: "default",
          }}
        >
          <span
            className={`lhq-pulse${c.status === "running" ? "" : c.status === "restarting" ? " warn" : " idle"}`}
            style={{ width: 8, height: 8 }}
          />
          <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
          <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--ink-2)" }}>{c.image}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.state}</div>
          <IconChevR size={14} color="var(--muted-2)" />
        </button>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Server overview tabs: Containers / Volumes / Networks
// ──────────────────────────────────────────────────────────────────────

function ServerContainersTab({
  containers,
  onOpen,
  onDeploy,
}: {
  containers: import("../lib/types").ContainerSummary[];
  onOpen: (id: string) => void;
  onDeploy: () => void;
}) {
  if (containers.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 14, color: "var(--muted)" }}>
        No containers running on this host. <a onClick={onDeploy} style={{ color: "var(--accent-ink)", textDecoration: "underline" }}>Deploy one</a>.
      </div>
    );
  }
  return <ContainerInlineList containers={containers} onOpen={onOpen} />;
}

function ServerVolumesTab({ serverId }: { serverId: string }) {
  const [vols, setVols] = useState<import("../lib/types").VolumeSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.listVolumes(serverId).then(setVols).catch((e) => setErr(String(e)));
  }, [serverId]);
  if (err) return <div style={{ color: "var(--danger)", fontFamily: "var(--mono)", fontSize: 12 }}>{err}</div>;
  if (!vols) return <div style={{ color: "var(--muted)" }}>Loading volumes…</div>;
  if (vols.length === 0)
    return <div style={{ padding: 24, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 14, color: "var(--muted)" }}>No volumes on this server.</div>;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--surface)" }}>
      <div
        style={{
          display: "grid", gridTemplateColumns: "1.6fr 1fr 2fr 1fr", gap: 12, padding: "11px 18px",
          background: "var(--surface-2)", fontSize: 10.5, color: "var(--muted-2)", textTransform: "uppercase",
          letterSpacing: "0.08em", fontWeight: 600, borderBottom: "1px solid var(--border)",
        }}
      >
        <span>Name</span><span>Driver</span><span>Mountpoint</span><span>Created</span>
      </div>
      {vols.map((v, i) => (
        <div
          key={v.name}
          style={{
            display: "grid", gridTemplateColumns: "1.6fr 1fr 2fr 1fr", gap: 12, padding: "12px 18px",
            alignItems: "center", borderBottom: i < vols.length - 1 ? "1px solid var(--border)" : "none",
            fontSize: 12.5, fontFamily: "var(--mono)",
          }}
        >
          <span>{v.name}</span>
          <span style={{ color: "var(--muted)" }}>{v.driver}</span>
          <span style={{ color: "var(--muted)" }}>{v.mountpoint}</span>
          <span style={{ color: "var(--muted-2)" }}>{v.created ? new Date(v.created * 1000).toISOString().slice(0, 10) : "—"}</span>
        </div>
      ))}
    </div>
  );
}

function ServerNetworksTab({ serverId }: { serverId: string }) {
  const [nets, setNets] = useState<import("../lib/types").NetworkSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.listNetworks(serverId).then(setNets).catch((e) => setErr(String(e)));
  }, [serverId]);
  if (err) return <div style={{ color: "var(--danger)", fontFamily: "var(--mono)", fontSize: 12 }}>{err}</div>;
  if (!nets) return <div style={{ color: "var(--muted)" }}>Loading networks…</div>;
  if (nets.length === 0)
    return <div style={{ padding: 24, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 14, color: "var(--muted)" }}>No networks on this server.</div>;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--surface)" }}>
      <div
        style={{
          display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1.4fr 1fr", gap: 12, padding: "11px 18px",
          background: "var(--surface-2)", fontSize: 10.5, color: "var(--muted-2)", textTransform: "uppercase",
          letterSpacing: "0.08em", fontWeight: 600, borderBottom: "1px solid var(--border)",
        }}
      >
        <span>Name</span><span>Driver</span><span>Scope</span><span>Subnet</span><span>Containers</span>
      </div>
      {nets.map((n, i) => (
        <div
          key={n.id}
          style={{
            display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1.4fr 1fr", gap: 12, padding: "12px 18px",
            alignItems: "center", borderBottom: i < nets.length - 1 ? "1px solid var(--border)" : "none",
            fontSize: 12.5, fontFamily: "var(--mono)",
          }}
        >
          <span>{n.name}</span>
          <span style={{ color: "var(--muted)" }}>{n.driver}</span>
          <span style={{ color: "var(--muted)" }}>{n.scope}</span>
          <span style={{ color: "var(--muted)" }}>{n.subnet ?? "—"}</span>
          <span>{n.containers_attached}</span>
        </div>
      ))}
    </div>
  );
}

