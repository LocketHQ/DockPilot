// Container list (grouped by host) + container detail (logs/env/etc).

import { useEffect, useMemo, useRef, useState } from "react";
import { LhqTopbar } from "../components/Shell";
import { Btn, Input, Tag } from "../components/Primitives";
import { Sparkline } from "../components/Charts";
import { FileBrowserModal } from "../components/FileBrowser";
import { ConfirmModal } from "../components/Menu";
import {
  IconChevD,
  IconChevR,
  IconDots,
  IconFolder,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStop,
  IconX,
} from "../lib/icons";
import { useApp } from "../state";
import type {
  ContainerDetail,
  ContainerStats,
  ContainerSummary,
  EnvVar,
  LogLine,
  ServerRecord,
} from "../lib/types";
import * as api from "../lib/api";

type Grouped = Record<string, { server: ServerRecord; items: ContainerSummary[] }>;

function useFleetContainers() {
  const { servers } = useApp();
  const [grouped, setGrouped] = useState<Grouped>({});
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const out: Grouped = {};
      for (const s of servers) {
        try {
          const items = await api.listContainers(s.id);
          out[s.id] = { server: s, items };
        } catch {
          out[s.id] = { server: s, items: [] };
        }
      }
      if (!cancel) setGrouped(out);
    })();
    return () => {
      cancel = true;
    };
  }, [servers, refreshTick]);

  return { grouped, refresh: () => setRefreshTick((x) => x + 1) };
}

export function ContainersListScreen() {
  const { navigate } = useApp();
  const { grouped, refresh } = useFleetContainers();
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Running" | "Restarting" | "Stopped" | "Exited">("All");

  const all = useMemo(() => Object.values(grouped).flatMap((g) => g.items.map((c) => ({ ...c, _host: g.server.name, _serverId: g.server.id }))), [grouped]);
  const counts = {
    All: all.length,
    Running: all.filter((c) => c.status === "running").length,
    Restarting: all.filter((c) => c.status === "restarting").length,
    Stopped: all.filter((c) => c.status === "stopped" || c.status === "exited").length,
    Exited: all.filter((c) => c.status === "exited").length,
  };

  return (
    <div className="lhq-main">
      <LhqTopbar
        breadcrumb={["Workspace", "Containers"]}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <IconSearch size={13} color="var(--muted-2)" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
              <input
                className="lhq-input"
                placeholder="image:tag, name, or host…"
                style={{ width: 260, paddingLeft: 34, height: 34 }}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <Btn icon={IconRefresh} variant="ghost" onClick={refresh} />
            <Btn variant="primary" icon={IconPlus} onClick={() => navigate({ kind: "wizard", step: 0 })}>
              New container
            </Btn>
          </div>
        }
      />
      <div className="lhq-content">
        <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
          {(["All", "Running", "Restarting", "Stopped", "Exited"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setStatusFilter(l)}
              style={{
                height: 30,
                padding: "0 12px",
                border: "1px solid",
                borderColor: statusFilter === l ? "var(--ink)" : "var(--border)",
                background: statusFilter === l ? "var(--ink)" : "var(--surface)",
                color: statusFilter === l ? "#FAFAF7" : "var(--ink)",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 500,
                cursor: "default",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {l}
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: statusFilter === l ? "rgba(250,250,247,0.6)" : "var(--muted-2)" }}>
                {counts[l]}
              </span>
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Group by:</span>
          <button
            style={{
              height: 30,
              padding: "0 12px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--surface)",
              fontSize: 12,
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: "default",
            }}
          >
            Host <IconChevD size={11} />
          </button>
        </div>

        {Object.entries(grouped).map(([sid, g]) => {
          const inferred = inferStackMap(g.items);
          const filtered = g.items.filter((c) => {
            if (statusFilter !== "All") {
              if (statusFilter === "Stopped" && !(c.status === "stopped" || c.status === "exited")) return false;
              if (statusFilter !== "Stopped" && c.status !== statusFilter.toLowerCase()) return false;
            }
            if (filter) {
              const f = filter.toLowerCase();
              const proj = composeProjectOf(c, inferred) || "";
              if (
                !c.name.toLowerCase().includes(f) &&
                !c.image.toLowerCase().includes(f) &&
                !g.server.name.toLowerCase().includes(f) &&
                !proj.toLowerCase().includes(f)
              )
                return false;
            }
            return true;
          });
          if (filtered.length === 0 && filter) return null;

          // Split into stacks + standalone
          const stacks = new Map<string, ContainerSummary[]>();
          const standalone: ContainerSummary[] = [];
          for (const c of filtered) {
            const proj = composeProjectOf(c, inferred);
            if (proj) {
              const arr = stacks.get(proj) || [];
              arr.push(c);
              stacks.set(proj, arr);
            } else {
              standalone.push(c);
            }
          }

          return (
            <div key={sid} style={{ marginBottom: 26 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
                <span className="lhq-h3" style={{ fontSize: 14 }}>
                  {g.server.name}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
                  · {g.server.region || "—"} · {filtered.length} containers
                  {stacks.size > 0 && ` · ${stacks.size} stack${stacks.size === 1 ? "" : "s"}`}
                </span>
              </div>

              {stacks.size > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <StackTable
                    stacks={[...stacks.entries()]}
                    inferred={inferred}
                    onOpen={(project) => navigate({ kind: "stack", serverId: sid, project })}
                  />
                </div>
              )}

              {standalone.length > 0 && (
                <ContainerTable
                  items={standalone}
                  onOpen={(cid) => navigate({ kind: "container", serverId: sid, containerId: cid })}
                />
              )}
            </div>
          );
        })}

        {Object.keys(grouped).length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 14 }}>
            Add a server first — your containers will appear here.
          </div>
        )}
      </div>
    </div>
  );
}

function ContainerTable({
  items,
  onOpen,
}: {
  items: ContainerSummary[];
  onOpen: (id: string) => void;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "24px 1.6fr 1.6fr 1fr 100px 100px 80px 32px",
          gap: 12,
          padding: "11px 18px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-2)",
          fontSize: 10.5,
          color: "var(--muted-2)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        <span />
        <span>Container</span>
        <span>Image</span>
        <span>State</span>
        <span style={{ textAlign: "right" }}>CPU</span>
        <span style={{ textAlign: "right" }}>Memory</span>
        <span style={{ textAlign: "right" }}>Port</span>
        <span />
      </div>
      {items.map((c, i) => (
        <button
          key={c.id}
          onClick={() => onOpen(c.id)}
          style={{
            display: "grid",
            gridTemplateColumns: "24px 1.6fr 1.6fr 1fr 100px 100px 80px 32px",
            gap: 12,
            padding: "14px 18px",
            borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none",
            alignItems: "center",
            background: "transparent",
            border: 0,
            width: "100%",
            textAlign: "left",
            cursor: "default",
          }}
        >
          <span
            className={`lhq-pulse${c.status === "running" ? "" : c.status === "restarting" ? " warn" : " idle"}`}
            style={{ width: 8, height: 8 }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.005em" }}>{c.name}</div>
            <div style={{ fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>{c.state}</div>
          </div>
          <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.image}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.status}</div>
          <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted-2)" }}>—</div>
          <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted-2)" }}>—</div>
          <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted)" }}>
            {c.ports.map((p) => `${p.host_port || p.container_port}`).join(", ") || "—"}
          </div>
          <IconDots size={14} color="var(--muted-2)" />
        </button>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Container detail — logs streaming
// ──────────────────────────────────────────────────────────────────────

export function ContainerDetailScreen({ serverId, containerId }: { serverId: string; containerId: string }) {
  const { servers, navigate, showToast } = useApp();
  const server = servers.find((s) => s.id === serverId);
  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [tab, setTab] = useState<"Overview" | "Logs" | "Environment" | "Volumes" | "Network" | "Data">("Logs");
  const logsRef = useRef<HTMLDivElement | null>(null);

  // Live CPU/mem
  const [stats, setStats] = useState<{ cpu: number; memMb: number; memLimitMb: number } | null>(null);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);

  // Env editing
  const [envDraft, setEnvDraft] = useState<EnvVar[] | null>(null);
  const [savingEnv, setSavingEnv] = useState(false);

  // Mount browser
  const [browseMount, setBrowseMount] = useState<{ path: string; readOnly: boolean; title: string } | null>(null);

  async function reloadDetail() {
    try {
      const d = await api.getContainer(serverId, containerId);
      setDetail(d);
      setEnvDraft(d.env.map((e) => ({ ...e })));
    } catch (e) { console.warn(e); }
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const d = await api.getContainer(serverId, containerId);
        if (!cancel) {
          setDetail(d);
          setEnvDraft(d.env.map((e) => ({ ...e })));
        }
      } catch (e) {
        console.warn(e);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [serverId, containerId]);

  // Subscribe to live container stats.
  useEffect(() => {
    if (!detail || detail.status !== "running") return;
    let unsub: (() => Promise<void>) | null = null;
    let killed = false;
    (async () => {
      try {
        unsub = await api.streamStats(serverId, containerId, (line) => {
          if (killed) return;
          const s = line as ContainerStats;
          if (!s || typeof s !== "object" || !("cpu_percent" in s)) return;
          setStats({
            cpu: s.cpu_percent,
            memMb: s.memory_used_mb,
            memLimitMb: s.memory_limit_mb,
          });
          setCpuHistory((h) => [...h.slice(-39), s.cpu_percent]);
        });
      } catch (e) { console.warn(e); }
    })();
    return () => { killed = true; if (unsub) unsub(); };
  }, [serverId, containerId, detail?.id, detail?.status]);

  useEffect(() => {
    let unsub: (() => Promise<void>) | null = null;
    let killed = false;
    (async () => {
      try {
        unsub = await api.streamLogs(
          serverId,
          containerId,
          (line) => {
            if (killed) return;
            setLogs((l) => [...l.slice(-499), line]);
            // autoscroll
            requestAnimationFrame(() => {
              const el = logsRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            });
          },
          (msg) => {
            console.warn("log stream error", msg);
          }
        );
      } catch (e) {
        console.warn("streamLogs failed", e);
      }
    })();
    return () => {
      killed = true;
      if (unsub) unsub();
    };
  }, [serverId, containerId]);

  if (!detail) {
    return (
      <div className="lhq-main">
        <LhqTopbar breadcrumb={["Containers", containerId]} />
        <div className="lhq-content">Loading…</div>
      </div>
    );
  }

  return (
    <div className="lhq-main">
      <LhqTopbar
        breadcrumb={["Containers", detail.name]}
        kicker={`${server?.name || "?"} · ${detail.image}`}
        status={detail.status === "running" ? `Running` : detail.status}
        actions={
          <div style={{ display: "flex", gap: 6 }}>
            {detail.status === "running" ? (
              <Btn
                size="sm"
                icon={IconStop}
                onClick={async () => {
                  try {
                    await api.stopContainer(serverId, containerId);
                    showToast("container stopped");
                    const d = await api.getContainer(serverId, containerId);
                    setDetail(d);
                  } catch (e: any) {
                    showToast(String(e));
                  }
                }}
              >
                Stop
              </Btn>
            ) : (
              <Btn
                size="sm"
                icon={IconPlay}
                onClick={async () => {
                  try {
                    await api.startContainer(serverId, containerId);
                    showToast("container started");
                    const d = await api.getContainer(serverId, containerId);
                    setDetail(d);
                  } catch (e: any) {
                    showToast(String(e));
                  }
                }}
              >
                Start
              </Btn>
            )}
            <Btn
              size="sm"
              icon={IconRefresh}
              onClick={async () => {
                try {
                  await api.restartContainer(serverId, containerId);
                  showToast("container restarted");
                } catch (e: any) {
                  showToast(String(e));
                }
              }}
            >
              Restart
            </Btn>
            <Btn
              size="sm"
              variant="danger"
              icon={IconX}
              onClick={async () => {
                if (!confirm(`Remove ${detail.name}? This deletes the container.`)) return;
                try {
                  await api.removeContainer(serverId, containerId);
                  showToast("container removed");
                  navigate({ kind: "containers" });
                } catch (e: any) {
                  showToast(String(e));
                }
              }}
            >
              Remove
            </Btn>
          </div>
        }
      />

      <div className="lhq-content" style={{ padding: 0 }}>
        <div style={{ display: "flex", gap: 0, padding: "0 32px", borderBottom: "1px solid var(--border)" }}>
          {(detectDbEngine(detail.image)
            ? (["Overview", "Logs", "Environment", "Volumes", "Network", "Data"] as const)
            : (["Overview", "Logs", "Environment", "Volumes", "Network"] as const)
          ).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "14px 14px",
                fontSize: 13,
                color: tab === t ? "var(--ink)" : "var(--muted)",
                fontWeight: tab === t ? 500 : 400,
                borderBottom: "2px solid",
                borderBottomColor: tab === t ? "var(--ink)" : "transparent",
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

        <div
          style={{
            padding: "24px 32px",
            display: "grid",
            gridTemplateColumns: tab === "Data" ? "1fr" : "1fr 320px",
            gap: 18,
          }}
        >
          {tab === "Data" && (
            <DataEditor serverId={serverId} containerId={containerId} image={detail.image} />
          )}
          {tab === "Logs" && (
            <div className="lhq-card" style={{ padding: 0, overflow: "hidden" }}>
              <div
                style={{
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  borderBottom: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  fontSize: 11.5,
                  color: "var(--muted)",
                }}
              >
                <span className="lhq-pulse" />
                <span style={{ fontFamily: "var(--mono)" }}>
                  tail · {logs.length} lines · streaming
                </span>
                <div style={{ flex: 1 }} />
                <Btn size="sm" variant="ghost" onClick={() => setLogs([])}>
                  Clear
                </Btn>
              </div>
              <div
                ref={logsRef}
                style={{
                  padding: "12px 16px",
                  background: "#fcfbf7",
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  lineHeight: 1.7,
                  color: "var(--ink-2)",
                  height: 460,
                  overflowY: "auto",
                }}
              >
                {logs.length === 0 ? (
                  <span style={{ color: "var(--muted-2)" }}>waiting for output…</span>
                ) : (
                  logs.map((l, i) => (
                    <div key={i} style={{ display: "flex", gap: 12 }}>
                      <span style={{ color: "var(--muted-2)" }}>
                        {new Date(l.timestamp).toISOString().slice(11, 23)}
                      </span>
                      {(() => {
                        const tag = classifyLogLine(l);
                        return (
                          <span
                            style={{
                              color: tag.color,
                              fontWeight: 600,
                              width: 48,
                              flexShrink: 0,
                            }}
                          >
                            {tag.level}
                          </span>
                        );
                      })()}
                      <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{l.message}</span>
                    </div>
                  ))
                )}
                <div style={{ marginTop: 8, color: "var(--muted-2)" }}>▎ streaming…</div>
              </div>
            </div>
          )}

          {tab === "Environment" && envDraft && (
            <EnvEditor
              env={envDraft}
              setEnv={setEnvDraft}
              original={detail.env}
              saving={savingEnv}
              onSave={async () => {
                setSavingEnv(true);
                try {
                  const res = await api.recreateContainerEnv(serverId, containerId, envDraft);
                  showToast("container recreated with new env");
                  // navigate to the new container ID (recreate creates a new one)
                  if (res.id && res.id !== containerId) {
                    navigate({ kind: "container", serverId, containerId: res.id });
                  } else {
                    await reloadDetail();
                  }
                } catch (e: any) {
                  showToast(String(e));
                } finally {
                  setSavingEnv(false);
                }
              }}
              onReset={() => setEnvDraft(detail.env.map((e) => ({ ...e })))}
            />
          )}

          {tab === "Volumes" && (
            <div className="lhq-card">
              <div className="lhq-h3" style={{ marginBottom: 12 }}>Mounts</div>
              {detail.mounts.length === 0 && <div style={{ color: "var(--muted)" }}>No mounts.</div>}
              {detail.mounts.map((m) => (
                <div
                  key={m.destination}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 24px 1fr 90px 90px",
                    gap: 10,
                    padding: "10px 0",
                    borderBottom: "1px solid var(--border)",
                    alignItems: "center",
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "var(--ink-2)" }}>{m.source}</span>
                  <span style={{ color: "var(--muted-2)", textAlign: "center" }}>→</span>
                  <span style={{ color: "var(--ink-2)" }}>{m.destination}</span>
                  <span>
                    <Tag tone={m.read_only ? "warn" : "accent"}>{m.read_only ? "ro" : "rw"}</Tag>
                  </span>
                  <Btn
                    size="sm"
                    icon={IconFolder}
                    onClick={() =>
                      setBrowseMount({
                        path: m.source,
                        readOnly: m.read_only,
                        title: `${m.source} → ${m.destination}`,
                      })
                    }
                  >
                    Browse
                  </Btn>
                </div>
              ))}
              {detail.mounts.some((m) => !m.read_only) && (
                <p style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted)" }}>
                  Tip: only paths within a mount source are readable/editable. The runner refuses
                  any path that escapes the mount root.
                </p>
              )}
            </div>
          )}

          {tab === "Network" && (
            <div className="lhq-card">
              <div className="lhq-h3" style={{ marginBottom: 12 }}>
                Networks
              </div>
              {detail.networks.map((n) => (
                <div key={n} style={{ fontSize: 12.5, fontFamily: "var(--mono)" }}>
                  {n}
                </div>
              ))}
            </div>
          )}

          {tab === "Overview" && (
            <div className="lhq-card">
              <div className="lhq-h3" style={{ marginBottom: 12 }}>Overview</div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                Restart policy: {detail.restart_policy}<br />
                Digest: <span className="mono">{detail.digest ?? "—"}</span><br />
                Command: <span className="mono">{detail.command ?? "—"}</span>
              </div>
            </div>
          )}

          {/* right rail */}
          {tab !== "Data" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="lhq-card">
              <div style={{ fontSize: 11, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                Live
              </div>
              {detail.status !== "running" ? (
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Container is {detail.status}.</div>
              ) : !stats ? (
                <div style={{ fontSize: 12.5, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>waiting…</div>
              ) : (
                <div style={{ display: "flex", gap: 18 }}>
                  <div>
                    <div className="lhq-stat" style={{ fontSize: 20 }}>
                      {stats.cpu.toFixed(1)}<span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>%</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>CPU</div>
                    {cpuHistory.length > 1 && (
                      <Sparkline data={cpuHistory} width={120} height={24} />
                    )}
                  </div>
                  <div>
                    <div className="lhq-stat" style={{ fontSize: 20 }}>
                      {stats.memMb}<span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}> MB</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      Memory
                      {stats.memLimitMb > 0 && (
                        <span style={{ color: "var(--muted-2)" }}> / {stats.memLimitMb} MB</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="lhq-card">
              <div style={{ fontSize: 11, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                Image
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-2)" }}>{detail.image}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                digest · {(detail.digest || "—").slice(0, 24)}
              </div>
            </div>
            <div className="lhq-card">
              <div style={{ fontSize: 11, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                Ports
              </div>
              {detail.ports.length === 0 && <div style={{ color: "var(--muted)" }}>—</div>}
              {detail.ports.map((p) => (
                <div key={`${p.container_port}/${p.protocol}`} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 12 }}>
                  <span>{p.host_port ?? "—"}</span>
                  <span style={{ color: "var(--muted-2)" }}>→</span>
                  <span>
                    {p.container_port}/{p.protocol}
                  </span>
                  {p.public && <Tag tone="accent">public</Tag>}
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      </div>

      <FileBrowserModal
        open={!!browseMount}
        serverId={serverId}
        containerId={containerId}
        rootPath={browseMount?.path || "/"}
        readOnly={browseMount?.readOnly || false}
        title={browseMount?.title || ""}
        onClose={() => setBrowseMount(null)}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Env editor — recreates the container with new env on save
// ──────────────────────────────────────────────────────────────────────

function EnvEditor({
  env,
  setEnv,
  original,
  saving,
  onSave,
  onReset,
}: {
  env: EnvVar[];
  setEnv: (e: EnvVar[]) => void;
  original: EnvVar[];
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const dirty =
    env.length !== original.length ||
    env.some(
      (e, i) =>
        e.key !== original[i]?.key ||
        e.value !== original[i]?.value ||
        e.secret !== original[i]?.secret
    );
  return (
    <div className="lhq-card">
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <div className="lhq-h3">Environment ({env.length})</div>
        <div style={{ flex: 1 }} />
        {dirty && (
          <Btn size="sm" variant="ghost" onClick={onReset}>Reset</Btn>
        )}
        <Btn
          size="sm"
          variant="primary"
          onClick={() => setConfirm(true)}
          disabled={!dirty || saving}
          style={{ marginLeft: 6 }}
        >
          {saving ? "Recreating…" : "Save (recreates)"}
        </Btn>
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Docker can't change env on a running container — saving stops the existing container and
        starts a fresh one with the same image, ports, volumes, and restart policy. Volumes are
        preserved.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {env.map((e, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 90px 28px",
              gap: 6,
              alignItems: "center",
            }}
          >
            <input
              className="lhq-input"
              placeholder="KEY"
              value={e.key}
              onChange={(ev) => {
                const next = [...env];
                next[i] = { ...e, key: ev.target.value };
                setEnv(next);
              }}
              style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}
            />
            <input
              className="lhq-input"
              placeholder="value"
              type={e.secret ? "password" : "text"}
              value={e.value}
              onChange={(ev) => {
                const next = [...env];
                next[i] = { ...e, value: ev.target.value };
                setEnv(next);
              }}
              style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}
            />
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                color: "var(--muted)",
                fontFamily: "var(--mono)",
              }}
            >
              <input
                type="checkbox"
                checked={e.secret}
                onChange={(ev) => {
                  const next = [...env];
                  next[i] = { ...e, secret: ev.target.checked };
                  setEnv(next);
                }}
              />
              secret
            </label>
            <Btn variant="ghost" icon={IconX} onClick={() => setEnv(env.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Btn
          size="sm"
          icon={IconPlus}
          style={{ alignSelf: "flex-start", marginTop: 6 }}
          onClick={() => setEnv([...env, { key: "", value: "", secret: false }])}
        >
          Add env var
        </Btn>
      </div>

      <ConfirmModal
        open={confirm}
        title="Recreate container with new environment?"
        body={
          <>
            The container will stop, be removed, and start fresh with the updated env vars.
            Volumes and named volumes are preserved. Brief downtime (a few seconds).
          </>
        }
        confirmLabel="Recreate"
        busy={saving}
        onConfirm={() => { setConfirm(false); onSave(); }}
        onClose={() => { if (!saving) setConfirm(false); }}
      />
    </div>
  );
}

// ─── Log-line classifier ──────────────────────────────────────────────────
// Many containers log everything to stderr (e.g. Authentik, Caddy, k8s-style
// JSON loggers). Labeling by stream is misleading. We try to find the actual
// level: parse a JSON envelope first, then look for level keywords in plain
// text, and only fall back to the stream as a last resort.

function classifyLogLine(l: LogLine): { level: string; color: string } {
  const text = l.message;
  // 1. JSON envelope — common in modern apps (structlog, slog, etc.)
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed);
      const lvl = (obj.level ?? obj.severity ?? obj.lvl ?? obj.LEVEL ?? "").toString();
      if (lvl) return tagFromLevel(lvl);
    } catch { /* not JSON */ }
  }
  // 2. logfmt-ish: "level=info" or "lvl=warning"
  const lvlMatch = text.match(/\b(?:level|lvl|severity)\s*[=:]\s*"?([A-Za-z]+)/i);
  if (lvlMatch) return tagFromLevel(lvlMatch[1]);
  // 3. Token at line start: "INFO ...", "[INFO] ...", "WARN: ...", "ERROR ..."
  const tokenMatch = text.match(/^\[?\s*(TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERR(?:OR)?|FATAL|PANIC|CRIT(?:ICAL)?)\b/i);
  if (tokenMatch) return tagFromLevel(tokenMatch[1]);
  // 4. Anywhere in text — but only for high-signal patterns
  if (/\b(FATAL|PANIC|CRIT(?:ICAL)?)\b/i.test(text)) return tagFromLevel("FATAL");
  if (/\b(ERROR)\b/i.test(text)) return tagFromLevel("ERROR");
  if (/\b(WARN(?:ING)?)\b/i.test(text)) return tagFromLevel("WARN");
  // 5. Fallback — INFO regardless of stream (don't paint stderr red by default)
  return { level: "INFO", color: "var(--muted)" };
}

function tagFromLevel(lvl: string): { level: string; color: string } {
  const u = lvl.toUpperCase();
  if (u === "FATAL" || u === "PANIC" || u === "CRIT" || u === "CRITICAL")
    return { level: "FTL", color: "var(--danger)" };
  if (u === "ERR" || u === "ERROR") return { level: "ERR", color: "var(--danger)" };
  if (u === "WARN" || u === "WARNING") return { level: "WRN", color: "oklch(0.5 0.13 70)" };
  if (u === "DEBUG") return { level: "DBG", color: "var(--muted-2)" };
  if (u === "TRACE") return { level: "TRC", color: "var(--muted-2)" };
  if (u === "NOTICE") return { level: "NTC", color: "var(--accent-ink)" };
  return { level: "INF", color: "var(--muted)" };
}

// ─── Compose stack helpers ────────────────────────────────────────────────

function composeLabelProject(c: ContainerSummary): string | null {
  return c.labels?.["com.docker.compose.project"] || null;
}
function composeLabelService(c: ContainerSummary): string | null {
  return c.labels?.["com.docker.compose.service"] || null;
}

// Parse a docker compose default container name into project/service.
//   v2:  <project>-<service>-<index>
//   v1:  <project>_<service>_<index>
// The separator between segments is consistent within a name.
function parseComposeName(
  name: string
): { project: string; service: string; sep: "-" | "_" } | null {
  let m = name.match(/^(.+)-([^-_]+)-(\d+)$/);
  if (m) return { project: m[1], service: m[2], sep: "-" };
  m = name.match(/^(.+)_([^_]+)_(\d+)$/);
  if (m) return { project: m[1], service: m[2], sep: "_" };
  return null;
}

// Build a fallback project/service map for containers missing the compose
// labels. Only infers a stack when 2+ unlabeled containers share a project
// prefix, OR when the inferred project matches an existing labeled stack.
function inferStackMap(items: ContainerSummary[]): Map<string, { project: string; service: string }> {
  const result = new Map<string, { project: string; service: string }>();
  const labeled = new Set<string>();
  for (const c of items) {
    const p = composeLabelProject(c);
    if (p) labeled.add(p);
  }
  const candidates: { id: string; project: string; service: string }[] = [];
  for (const c of items) {
    if (composeLabelProject(c)) continue;
    const parsed = parseComposeName(c.name);
    if (parsed) candidates.push({ id: c.id, project: parsed.project, service: parsed.service });
  }
  const counts = new Map<string, number>();
  for (const cand of candidates) counts.set(cand.project, (counts.get(cand.project) || 0) + 1);
  for (const cand of candidates) {
    if ((counts.get(cand.project) ?? 0) >= 2 || labeled.has(cand.project)) {
      result.set(cand.id, { project: cand.project, service: cand.service });
    }
  }
  return result;
}

// Resolve a container's compose project — label first, name-inference fallback.
function composeProjectOf(
  c: ContainerSummary,
  inferred?: Map<string, { project: string; service: string }>
): string | null {
  return composeLabelProject(c) || inferred?.get(c.id)?.project || null;
}
function composeServiceOf(
  c: ContainerSummary,
  inferred?: Map<string, { project: string; service: string }>
): string | null {
  return composeLabelService(c) || inferred?.get(c.id)?.service || null;
}

function aggregateStackStatus(items: ContainerSummary[]): {
  label: string;
  tone: "accent" | "warn" | "danger" | undefined;
} {
  if (items.length === 0) return { label: "empty", tone: undefined };
  const allRunning = items.every((c) => c.status === "running");
  const anyRunning = items.some((c) => c.status === "running");
  const anyRestart = items.some((c) => c.status === "restarting");
  if (anyRestart) return { label: `restarting`, tone: "warn" };
  if (allRunning) return { label: `running`, tone: "accent" };
  if (anyRunning) return { label: `partial`, tone: "warn" };
  return { label: `stopped`, tone: "danger" };
}

function StackTable({
  stacks,
  inferred,
  onOpen,
}: {
  stacks: [string, ContainerSummary[]][];
  inferred?: Map<string, { project: string; service: string }>;
  onOpen: (project: string) => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 14,
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "32px 1.6fr 1.6fr 110px 32px",
          gap: 12,
          padding: "11px 18px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-2)",
          fontSize: 10.5,
          color: "var(--muted-2)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        <span />
        <span>Stack (compose project)</span>
        <span>Services</span>
        <span style={{ textAlign: "right" }}>Status</span>
        <span />
      </div>
      {stacks.map(([project, items], i) => {
        const agg = aggregateStackStatus(items);
        const services = items
          .map((c) => composeServiceOf(c, inferred) || c.name)
          .filter((v, idx, arr) => arr.indexOf(v) === idx);
        return (
          <button
            key={project}
            onClick={() => onOpen(project)}
            style={{
              display: "grid",
              gridTemplateColumns: "32px 1.6fr 1.6fr 110px 32px",
              gap: 12,
              padding: "14px 18px",
              alignItems: "center",
              background: "transparent",
              border: 0,
              width: "100%",
              textAlign: "left",
              cursor: "default",
              borderBottom: i < stacks.length - 1 ? "1px solid var(--border)" : "none",
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: "var(--accent-tint)",
                color: "var(--accent-ink)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="8" height="8" rx="1.5" />
                <rect x="13" y="3" width="8" height="8" rx="1.5" />
                <rect x="3" y="13" width="8" height="8" rx="1.5" />
                <rect x="13" y="13" width="8" height="8" rx="1.5" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.005em" }}>
                {project}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--mono)", marginTop: 2 }}>
                {items.length} container{items.length === 1 ? "" : "s"}
              </div>
            </div>
            <div
              style={{
                fontSize: 12,
                fontFamily: "var(--mono)",
                color: "var(--muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {services.join(", ")}
            </div>
            <div style={{ textAlign: "right" }}>
              <Tag tone={agg.tone}>
                {agg.tone === "accent" && <span className="lhq-pulse" style={{ width: 6, height: 6 }} />}
                {agg.tone === "warn" && <span className="lhq-pulse warn" style={{ width: 6, height: 6 }} />}
                {agg.tone === "danger" && <span className="lhq-pulse danger" style={{ width: 6, height: 6 }} />}
                {agg.label}
              </Tag>
            </div>
            <IconChevR size={14} color="var(--muted-2)" />
          </button>
        );
      })}
    </div>
  );
}

// ─── Stack detail screen ──────────────────────────────────────────────────

export function StackDetailScreen({
  serverId,
  project,
}: {
  serverId: string;
  project: string;
}) {
  const { servers, navigate, showToast } = useApp();
  const server = servers.find((s) => s.id === serverId);
  const [items, setItems] = useState<ContainerSummary[] | null>(null);
  const [inferred, setInferred] = useState<Map<string, { project: string; service: string }>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // True if no container in this stack carries the docker compose project
  // label (e.g. created by an older toolchain or by hand). Compose CLI actions
  // need the label to find services, so we fall back to per-container ops.
  const isLegacy = (items?.length ?? 0) > 0 && items!.every((c) => !composeLabelProject(c));

  async function reload() {
    try {
      const list = await api.listContainers(serverId);
      const inf = inferStackMap(list);
      setInferred(inf);
      setItems(list.filter((c) => composeProjectOf(c, inf) === project));
    } catch (e: any) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    reload();
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, project, tick]);

  async function act(action: "restart" | "stop" | "start" | "down") {
    setBusy(action);
    try {
      if (isLegacy && items) {
        // Legacy stack: no compose labels means `docker compose` can't find
        // the services. Apply the action to each container individually.
        if (action === "down") {
          for (const c of items) {
            try { await api.removeContainer(serverId, c.id); } catch (e) { console.warn(e); }
          }
        } else {
          for (const c of items) {
            try {
              if (action === "start") await api.startContainer(serverId, c.id);
              else if (action === "stop") await api.stopContainer(serverId, c.id);
              else if (action === "restart") await api.restartContainer(serverId, c.id);
            } catch (e) { console.warn(e); }
          }
        }
        showToast(`${action} applied to ${items.length} container${items.length === 1 ? "" : "s"}`);
      } else {
        await api.composeAction(serverId, project, action);
        showToast(`compose ${action} sent`);
      }
      if (action === "down") {
        navigate({ kind: "containers" });
      } else {
        setTick((x) => x + 1);
      }
    } catch (e: any) {
      showToast(String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!server) return <div className="lhq-content">Server not found.</div>;

  const agg = aggregateStackStatus(items || []);

  return (
    <div className="lhq-main">
      <LhqTopbar
        breadcrumb={["Containers", `Stack · ${project}`]}
        kicker={`${server.name} · docker compose project`}
        status={items ? agg.label : "loading"}
        actions={
          <div style={{ display: "flex", gap: 6 }}>
            <Btn
              size="sm"
              icon={IconRefresh}
              onClick={() => act("restart")}
              disabled={busy === "restart"}
            >
              Restart stack
            </Btn>
            {agg.label === "stopped" ? (
              <Btn
                size="sm"
                icon={IconPlay}
                onClick={() => act("start")}
                disabled={busy === "start"}
              >
                Start stack
              </Btn>
            ) : (
              <Btn
                size="sm"
                icon={IconStop}
                onClick={() => act("stop")}
                disabled={busy === "stop"}
              >
                Stop stack
              </Btn>
            )}
            <Btn
              size="sm"
              variant="danger"
              icon={IconX}
              onClick={() => act("down")}
              disabled={busy === "down"}
            >
              Tear down
            </Btn>
          </div>
        }
      />
      <div className="lhq-content">
        {err && (
          <div
            style={{
              marginBottom: 14,
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
        <div className="lhq-card" style={{ marginBottom: 18, padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div className="lhq-h3" style={{ fontSize: 18 }}>{project}</div>
            <Tag tone={agg.tone}>
              {agg.tone === "accent" && <span className="lhq-pulse" style={{ width: 6, height: 6 }} />}
              {agg.tone === "warn" && <span className="lhq-pulse warn" style={{ width: 6, height: 6 }} />}
              {agg.tone === "danger" && <span className="lhq-pulse danger" style={{ width: 6, height: 6 }} />}
              {agg.label}
            </Tag>
            {isLegacy && <Tag tone="warn">legacy</Tag>}
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--mono)" }}>
              {items?.length ?? "—"} container{(items?.length ?? 0) === 1 ? "" : "s"}
            </div>
          </div>
          {isLegacy && (
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
              Grouped by name pattern — these containers don't carry the docker
              compose project label. Stack actions are applied to each container
              individually instead of via <span className="mono">docker compose</span>.
            </p>
          )}
        </div>

        <div className="lhq-h3" style={{ fontSize: 14, marginBottom: 10 }}>Services</div>
        {!items ? (
          <div style={{ color: "var(--muted)" }}>Loading…</div>
        ) : items.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--muted)",
              border: "1px dashed var(--border)",
              borderRadius: 14,
            }}
          >
            No containers in this stack.
          </div>
        ) : (
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 14,
              background: "var(--surface)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "24px 160px 1.5fr 1fr 1fr 120px 32px",
                gap: 12,
                padding: "11px 18px",
                borderBottom: "1px solid var(--border)",
                background: "var(--surface-2)",
                fontSize: 10.5,
                color: "var(--muted-2)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 600,
              }}
            >
              <span />
              <span>Service</span>
              <span>Container</span>
              <span>Image</span>
              <span>State</span>
              <span style={{ textAlign: "right" }}>Ports</span>
              <span />
            </div>
            {items.map((c, i) => (
              <button
                key={c.id}
                onClick={() => navigate({ kind: "container", serverId, containerId: c.id })}
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px 160px 1.5fr 1fr 1fr 120px 32px",
                  gap: 12,
                  padding: "14px 18px",
                  alignItems: "center",
                  background: "transparent",
                  border: 0,
                  width: "100%",
                  textAlign: "left",
                  cursor: "default",
                  borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none",
                }}
              >
                <span
                  className={`lhq-pulse${
                    c.status === "running"
                      ? ""
                      : c.status === "restarting"
                      ? " warn"
                      : " idle"
                  }`}
                  style={{ width: 8, height: 8 }}
                />
                <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, fontWeight: 500 }}>
                  {composeServiceOf(c, inferred) || "—"}
                </div>
                <div style={{ fontSize: 12.5, fontFamily: "var(--mono)", color: "var(--ink-2)" }}>
                  {c.name}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    fontFamily: "var(--mono)",
                    color: "var(--muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.image}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.status}</div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    color: "var(--muted)",
                  }}
                >
                  {c.ports.map((p) => `${p.host_port || p.container_port}`).join(", ") || "—"}
                </div>
                <IconChevR size={14} color="var(--muted-2)" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Database editor ──────────────────────────────────────────────────────

function detectDbEngine(image: string): "postgres" | "mysql" | "mariadb" | null {
  const img = image.toLowerCase();
  const bare = img.split("/").pop() || img;
  const name = bare.split(":")[0];
  if (name === "postgres" || name === "postgresql" || name.includes("postgis")) return "postgres";
  if (name === "mariadb" || name.startsWith("mariadb")) return "mariadb";
  if (name === "mysql" || name.startsWith("mysql")) return "mysql";
  return null;
}

function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

function formatCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

function DataEditor({
  serverId,
  containerId,
  image,
}: {
  serverId: string;
  containerId: string;
  image: string;
}) {
  const { showToast } = useApp();
  const engine = detectDbEngine(image);
  const [info, setInfo] = useState<api.DbInfo | null>(null);
  const [infoErr, setInfoErr] = useState<string | null>(null);
  const [db, setDb] = useState<string>("");
  const [tables, setTables] = useState<api.DbTable[] | null>(null);
  const [tableFilter, setTableFilter] = useState("");
  const [selectedTable, setSelectedTable] = useState<api.DbTable | null>(null);
  const [mode, setMode] = useState<"browse" | "sql">("browse");
  const [result, setResult] = useState<api.DbQueryResult | null>(null);
  const [queryErr, setQueryErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sqlText, setSqlText] = useState("SELECT 1");

  // Load info once.
  useEffect(() => {
    let cancel = false;
    setInfoErr(null);
    (async () => {
      try {
        const i = await api.dbInfo(serverId, containerId);
        if (cancel) return;
        setInfo(i);
        setDb(i.default_db || i.databases[0]?.name || "");
      } catch (e: any) {
        if (!cancel) setInfoErr(String(e));
      }
    })();
    return () => { cancel = true; };
  }, [serverId, containerId]);

  // Load tables when db changes.
  useEffect(() => {
    if (!db) return;
    let cancel = false;
    setTables(null);
    setSelectedTable(null);
    (async () => {
      try {
        const t = await api.dbTables(serverId, containerId, db);
        if (!cancel) setTables(t);
      } catch (e: any) {
        if (!cancel) { setTables([]); showToast(String(e)); }
      }
    })();
    return () => { cancel = true; };
  }, [serverId, containerId, db, showToast]);

  async function runBrowse(t: api.DbTable) {
    setSelectedTable(t);
    setMode("browse");
    setRunning(true);
    setQueryErr(null);
    try {
      const quoted = engine === "postgres"
        ? `"${t.schema}"."${t.name}"`
        : `\`${t.name}\``;
      const sql = `SELECT * FROM ${quoted}`;
      setSqlText(sql);
      const r = await api.dbQuery(serverId, containerId, { db, sql, limit: 100 });
      setResult(r);
    } catch (e: any) {
      setQueryErr(String(e));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  async function runSql() {
    setRunning(true);
    setQueryErr(null);
    setMode("sql");
    try {
      const r = await api.dbQuery(serverId, containerId, { db, sql: sqlText, limit: 1000 });
      setResult(r);
    } catch (e: any) {
      setQueryErr(String(e));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  if (infoErr) {
    return (
      <div className="lhq-card">
        <div className="lhq-h3" style={{ marginBottom: 8 }}>Data</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
          Couldn't connect to the database inside this container.
        </div>
        <pre style={{ fontSize: 11.5, fontFamily: "var(--mono)", whiteSpace: "pre-wrap", color: "var(--ink-2)", margin: 0 }}>{infoErr}</pre>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="lhq-card">
        <div style={{ color: "var(--muted)" }}>Connecting to {engine}…</div>
      </div>
    );
  }

  const filteredTables = (tables || []).filter((t) =>
    !tableFilter || t.name.toLowerCase().includes(tableFilter.toLowerCase())
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 14, minHeight: 540 }}>
      {/* Left: db + table list */}
      <div className="lhq-card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <div style={{ fontSize: 10.5, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 6 }}>
            {info.engine} {info.version ? `· ${info.version.split(" ")[1] || ""}` : ""}
          </div>
          <select
            value={db}
            onChange={(e) => setDb(e.target.value)}
            className="lhq-input"
            style={{ width: "100%", height: 30, fontFamily: "var(--mono)", fontSize: 12.5 }}
          >
            {info.databases.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name} {d.size_bytes != null ? `(${formatBytes(d.size_bytes)})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          <Input
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            placeholder="Filter tables…"
            style={{ width: "100%", height: 28, fontSize: 12 }}
          />
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {tables === null ? (
            <div style={{ padding: 14, color: "var(--muted-2)", fontSize: 12 }}>Loading tables…</div>
          ) : filteredTables.length === 0 ? (
            <div style={{ padding: 14, color: "var(--muted-2)", fontSize: 12 }}>No tables.</div>
          ) : (
            filteredTables.map((t) => {
              const sel = selectedTable && selectedTable.schema === t.schema && selectedTable.name === t.name;
              return (
                <button
                  key={`${t.schema}.${t.name}`}
                  onClick={() => runBrowse(t)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 8,
                    width: "100%",
                    padding: "8px 14px",
                    background: sel ? "var(--accent-tint)" : "transparent",
                    border: 0,
                    borderBottom: "1px solid var(--border)",
                    textAlign: "left",
                    cursor: "default",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: sel ? "var(--accent-ink)" : "var(--ink)" }}>
                    {t.name}
                  </span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted-2)" }}>
                    {formatCount(t.rows)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right: query header + result */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <div className="lhq-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)" }}>
            <button
              onClick={() => setMode("browse")}
              style={{
                padding: "10px 16px", fontSize: 12, fontWeight: mode === "browse" ? 500 : 400,
                background: "none", border: 0,
                color: mode === "browse" ? "var(--ink)" : "var(--muted)",
                borderBottom: "2px solid", borderBottomColor: mode === "browse" ? "var(--ink)" : "transparent",
                cursor: "default",
              }}
            >Browse</button>
            <button
              onClick={() => setMode("sql")}
              style={{
                padding: "10px 16px", fontSize: 12, fontWeight: mode === "sql" ? 500 : 400,
                background: "none", border: 0,
                color: mode === "sql" ? "var(--ink)" : "var(--muted)",
                borderBottom: "2px solid", borderBottomColor: mode === "sql" ? "var(--ink)" : "transparent",
                cursor: "default",
              }}
            >SQL</button>
            <div style={{ flex: 1 }} />
            <div style={{ padding: "10px 14px", fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
              {selectedTable ? `${selectedTable.schema}.${selectedTable.name}` : db}
            </div>
          </div>
          {mode === "sql" && (
            <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
              <textarea
                value={sqlText}
                onChange={(e) => setSqlText(e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%",
                  minHeight: 100,
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 10,
                  background: "#fcfbf7",
                  color: "var(--ink)",
                  resize: "vertical",
                  outline: "none",
                }}
              />
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <Btn size="sm" variant="primary" onClick={runSql} disabled={running}>
                  {running ? "Running…" : "Run query"}
                </Btn>
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  Reads are wrapped in a row limit (1000). Writes execute as-is.
                </span>
              </div>
            </div>
          )}
          <ResultGrid result={result} error={queryErr} running={running} />
        </div>
      </div>
    </div>
  );
}

function ResultGrid({
  result,
  error,
  running,
}: {
  result: api.DbQueryResult | null;
  error: string | null;
  running: boolean;
}) {
  if (running && !result) {
    return <div style={{ padding: 18, color: "var(--muted-2)", fontFamily: "var(--mono)", fontSize: 12 }}>running…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 14 }}>
        <pre
          style={{
            margin: 0,
            padding: 12,
            background: "var(--danger-tint)",
            border: "1px solid color-mix(in oklch, var(--danger) 30%, transparent)",
            borderRadius: 8,
            color: "oklch(0.42 0.12 25)",
            fontFamily: "var(--mono)",
            fontSize: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </pre>
      </div>
    );
  }
  if (!result) {
    return <div style={{ padding: 18, color: "var(--muted-2)", fontSize: 12 }}>Pick a table or run a query.</div>;
  }
  if (result.command && result.columns.length === 0) {
    return (
      <div style={{ padding: 14, fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-2)" }}>
        {result.command} · {result.elapsed_ms} ms
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          padding: "10px 14px",
          fontSize: 11.5,
          color: "var(--muted)",
          fontFamily: "var(--mono)",
          background: "var(--surface-2)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {result.row_count} row{result.row_count === 1 ? "" : "s"}
        {" · "}{result.columns.length} column{result.columns.length === 1 ? "" : "s"}
        {" · "}{result.elapsed_ms} ms
        {result.truncated && <span style={{ color: "var(--accent-ink)" }}> · truncated</span>}
      </div>
      <div style={{ overflow: "auto", maxHeight: 540 }}>
        <table
          style={{
            borderCollapse: "collapse",
            width: "max-content",
            minWidth: "100%",
            fontFamily: "var(--mono)",
            fontSize: 12,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  position: "sticky",
                  top: 0,
                  background: "var(--surface-2)",
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  borderRight: "1px solid var(--border)",
                  textAlign: "right",
                  color: "var(--muted-2)",
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                #
              </th>
              {result.columns.map((c) => (
                <th
                  key={c}
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "var(--surface-2)",
                    padding: "8px 14px",
                    borderBottom: "1px solid var(--border)",
                    textAlign: "left",
                    color: "var(--muted-2)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    fontSize: 10.5,
                    fontWeight: 600,
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, ri) => (
              <tr key={ri}>
                <td
                  style={{
                    padding: "6px 12px",
                    color: "var(--muted-2)",
                    borderBottom: "1px solid var(--border)",
                    borderRight: "1px solid var(--border)",
                    textAlign: "right",
                    background: "var(--surface)",
                  }}
                >
                  {ri + 1}
                </td>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: "6px 14px",
                      borderBottom: "1px solid var(--border)",
                      color: cell == null ? "var(--muted-2)" : "var(--ink)",
                      fontStyle: cell == null ? "italic" : "normal",
                      maxWidth: 360,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={cell ?? "NULL"}
                  >
                    {cell == null ? "NULL" : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
