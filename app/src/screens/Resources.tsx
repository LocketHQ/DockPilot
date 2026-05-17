// Volumes · Networks · Registries · Secrets — unified resources screen.

import { useEffect, useMemo, useState } from "react";
import { LhqTopbar } from "../components/Shell";
import { Btn, Tag } from "../components/Primitives";
import {
  IconCloud,
  IconDisk,
  IconNet,
  IconPlus,
  IconShield,
} from "../lib/icons";
import { useApp } from "../state";
import * as api from "../lib/api";
import type {
  NetworkSummary,
  ServerRecord,
  VolumeSummary,
} from "../lib/types";

type Tab = "volumes" | "networks" | "registries" | "secrets";

type VolumeRow = VolumeSummary & { server: ServerRecord };
type NetworkRow = NetworkSummary & { server: ServerRecord };

const TABS: { id: Tab; label: string }[] = [
  { id: "volumes", label: "Volumes" },
  { id: "networks", label: "Networks" },
  { id: "registries", label: "Registries" },
  { id: "secrets", label: "Secrets" },
];

function fmtGB(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(0)} GB`;
}

export function ResourcesScreen({ tab }: { tab: Tab }) {
  const { servers, navigate, showToast } = useApp();
  const [volumes, setVolumes] = useState<VolumeRow[] | null>(null);
  const [networks, setNetworks] = useState<NetworkRow[] | null>(null);

  const wantsVolumes = tab === "volumes";
  const wantsNetworks = tab === "volumes" || tab === "networks";

  useEffect(() => {
    let cancel = false;
    if (!wantsVolumes) {
      setVolumes(null);
      return;
    }
    if (servers.length === 0) {
      setVolumes([]);
      return;
    }
    setVolumes(null);
    (async () => {
      const all: VolumeRow[] = [];
      for (const s of servers) {
        try {
          const list = await api.listVolumes(s.id);
          for (const v of list) all.push({ ...v, server: s });
        } catch {
          /* skip server */
        }
      }
      if (!cancel) setVolumes(all);
    })();
    return () => {
      cancel = true;
    };
  }, [servers, wantsVolumes]);

  useEffect(() => {
    let cancel = false;
    if (!wantsNetworks) {
      setNetworks(null);
      return;
    }
    if (servers.length === 0) {
      setNetworks([]);
      return;
    }
    setNetworks(null);
    (async () => {
      const all: NetworkRow[] = [];
      for (const s of servers) {
        try {
          const list = await api.listNetworks(s.id);
          for (const n of list) all.push({ ...n, server: s });
        } catch {
          /* skip server */
        }
      }
      if (!cancel) setNetworks(all);
    })();
    return () => {
      cancel = true;
    };
  }, [servers, wantsNetworks]);

  return (
    <div className="lhq-main">
      <LhqTopbar
        breadcrumb={["Resources", labelFor(tab)]}
        actions={
          <Btn
            variant="primary"
            icon={IconPlus}
            onClick={() => showToast(`Create ${tab.replace(/s$/, "")} — coming soon`)}
          >
            Create
          </Btn>
        }
      />
      <div className="lhq-content" style={{ padding: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 28,
            padding: "0 32px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface)",
          }}
        >
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => navigate({ kind: t.id })}
                style={{
                  padding: "14px 0",
                  fontSize: 13,
                  color: active ? "var(--ink)" : "var(--muted)",
                  fontWeight: active ? 600 : 500,
                  border: 0,
                  borderBottom: active
                    ? "4px solid var(--accent)"
                    : "4px solid transparent",
                  marginBottom: -1,
                  background: "none",
                  borderRadius: 0,
                  cursor: "default",
                  fontFamily: "var(--sans)",
                  letterSpacing: "-0.005em",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div style={{ padding: "28px 32px" }}>
          {servers.length === 0 ? (
            <EmptyNoServers onAdd={() => navigate({ kind: "onboarding" })} />
          ) : (
            <>
              {tab === "volumes" && <VolumesSection rows={volumes} />}
              {wantsNetworks && <NetworksSection rows={networks} stacked={tab === "volumes"} />}
              {tab === "registries" && <ComingSoon kind="registries" />}
              {tab === "secrets" && <ComingSoon kind="secrets" />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Volumes
// ──────────────────────────────────────────────────────────────────────

function VolumesSection({ rows }: { rows: VolumeRow[] | null }) {
  const totalBytes = useMemo(
    () => (rows || []).reduce((acc, v) => acc + (v.size_bytes || 0), 0),
    [rows]
  );
  const maxBytes = useMemo(
    () => (rows || []).reduce((m, v) => Math.max(m, v.size_bytes || 0), 0),
    [rows]
  );

  return (
    <section style={{ marginBottom: 32 }}>
      <SectionHeader
        title="Volumes"
        meta={
          rows === null
            ? "· loading…"
            : rows.length === 0
            ? "· 0 volumes"
            : `· ${rows.length} ${rows.length === 1 ? "volume" : "volumes"} · ${fmtGB(totalBytes)} used`
        }
      />
      {rows === null ? (
        <LoadingPlaceholder height={160} />
      ) : rows.length === 0 ? (
        <EmptyCard
          icon={IconDisk}
          title="No volumes yet"
          subtitle="Create a volume to persist container data across restarts."
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 18 }}>
          {rows.map((v) => (
            <VolumeCard key={`${v.server.id}/${v.name}`} v={v} maxBytes={maxBytes} />
          ))}
        </div>
      )}
    </section>
  );
}

function VolumeCard({ v, maxBytes }: { v: VolumeRow; maxBytes: number }) {
  const size = v.size_bytes || 0;
  const pct = maxBytes > 0 && size > 0 ? Math.round((size / maxBytes) * 100) : 0;
  const fillColor =
    pct >= 85 ? "var(--danger)" : pct >= 60 ? "var(--warn)" : "var(--accent)";

  const driverTone: "accent" | undefined =
    v.driver && v.driver !== "local" ? "accent" : undefined;

  const sizeLabel = v.size_bytes != null ? fmtGB(v.size_bytes) : "—";
  const mountedBy = v.in_use_by[0];

  return (
    <div className="lhq-card" style={{ padding: 22 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: "var(--accent-tint)",
            color: "var(--accent-ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <IconDisk size={20} color="var(--accent-ink)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 15,
                fontWeight: 700,
                color: "var(--ink)",
                letterSpacing: "-0.005em",
                wordBreak: "break-all",
              }}
            >
              {v.name}
            </span>
            <Tag tone={driverTone}>{v.driver || "local"}</Tag>
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: "var(--muted)",
              fontFamily: "var(--mono)",
            }}
          >
            {v.server.name}
            {mountedBy ? ` · mounted by ${mountedBy}` : " · no mounts"}
          </div>
        </div>
        <div
          className="lhq-bignum"
          style={{
            fontSize: 32,
            color: "var(--ink)",
            flexShrink: 0,
            lineHeight: 1,
            marginTop: 2,
          }}
        >
          {sizeLabel}
        </div>
      </div>

      <div
        style={{
          marginTop: 18,
          height: 6,
          borderRadius: 999,
          background: "var(--surface-3)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, pct)}%`,
            height: "100%",
            background: fillColor,
            borderRadius: 999,
          }}
        />
      </div>

      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          color: "var(--muted)",
        }}
      >
        <span>{v.size_bytes != null ? `${pct}% used` : "size unknown"}</span>
        <span style={{ color: "var(--muted-2)" }}>backed up · —</span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Networks
// ──────────────────────────────────────────────────────────────────────

function NetworksSection({ rows, stacked }: { rows: NetworkRow[] | null; stacked: boolean }) {
  return (
    <section style={{ marginTop: stacked ? 8 : 0 }}>
      <SectionHeader
        title="Networks"
        meta={
          rows === null
            ? "· loading…"
            : `· ${rows.length} ${rows.length === 1 ? "network" : "networks"}`
        }
      />
      {rows === null ? (
        <LoadingPlaceholder height={180} />
      ) : rows.length === 0 ? (
        <EmptyCard
          icon={IconNet}
          title="No networks yet"
          subtitle="Networks let containers talk to each other on the same host."
        />
      ) : (
        <NetworksTable rows={rows} />
      )}
    </section>
  );
}

function NetworksTable({ rows }: { rows: NetworkRow[] }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 14,
        overflow: "hidden",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1.4fr 100px 100px",
          gap: 12,
          padding: "11px 18px",
          background: "var(--surface-2)",
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--muted-2)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span>Network</span>
        <span>Driver</span>
        <span>Subnet</span>
        <span style={{ textAlign: "right" }}>Containers</span>
        <span style={{ textAlign: "right" }}>&nbsp;</span>
      </div>
      {rows.map((n, i) => (
        <div
          key={`${n.server.id}/${n.id}`}
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1.4fr 100px 100px",
            gap: 12,
            padding: "14px 18px",
            alignItems: "center",
            borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <IconNet size={15} color="var(--muted)" />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ink)",
                  letterSpacing: "-0.005em",
                }}
              >
                {n.name}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--muted)",
                  fontFamily: "var(--mono)",
                  marginTop: 2,
                }}
              >
                scope · {n.scope}
              </div>
            </div>
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--ink-2)" }}>
            {n.driver}
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--ink-2)" }}>
            {n.subnet || "—"}
          </div>
          <div
            className="lhq-stat"
            style={{
              textAlign: "right",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink)",
            }}
          >
            {n.containers_attached}
          </div>
          <button
            style={{
              justifySelf: "end",
              background: "transparent",
              border: 0,
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              color: "var(--muted-2)",
              cursor: "default",
              padding: "4px 6px",
            }}
          >
            Inspect
          </button>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Empty / loading / coming soon
// ──────────────────────────────────────────────────────────────────────

function SectionHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16 }}>
      <h2
        style={{
          fontFamily: "var(--sans)",
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: "var(--ink)",
          margin: 0,
          lineHeight: 1.2,
        }}
      >
        {title}
      </h2>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 12,
          color: "var(--muted-2)",
        }}
      >
        {meta}
      </span>
    </div>
  );
}

function LoadingPlaceholder({ height }: { height: number }) {
  return (
    <div
      className="lhq-card"
      style={{
        minHeight: height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--muted-2)",
        fontFamily: "var(--mono)",
        fontSize: 12,
      }}
    >
      Loading…
    </div>
  );
}

function EmptyCard({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: (p: { size?: number; color?: string }) => JSX.Element;
  title: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        border: "1px dashed var(--border-strong)",
        borderRadius: 14,
        padding: "32px 24px",
        background: "var(--surface-2)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 999,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
        }}
      >
        <Icon size={18} color="var(--muted)" />
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", maxWidth: 360 }}>{subtitle}</div>
    </div>
  );
}

function EmptyNoServers({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      style={{
        border: "1px dashed var(--border-strong)",
        borderRadius: 14,
        padding: "40px 24px",
        background: "var(--surface-2)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 999,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconPlus size={18} color="var(--ink)" />
      </div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>No servers connected</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", maxWidth: 360 }}>
        Add a server to inspect its volumes and networks.
      </div>
      <div style={{ marginTop: 6 }}>
        <Btn variant="primary" icon={IconPlus} onClick={onAdd}>
          Add server
        </Btn>
      </div>
    </div>
  );
}

function ComingSoon({ kind }: { kind: "registries" | "secrets" }) {
  const cfg =
    kind === "registries"
      ? {
          icon: IconCloud,
          title: "Registries",
          blurb:
            "Connect Docker Hub, GHCR or a private registry so pulls and deploys authenticate automatically.",
        }
      : {
          icon: IconShield,
          title: "Secrets",
          blurb:
            "Encrypted values you can mount into containers at runtime — API keys, tokens, DB passwords.",
        };
  const Icon = cfg.icon;
  return (
    <section>
      <SectionHeader title={cfg.title} meta="· coming in v1.1" />
      <div
        className="lhq-card"
        style={{
          padding: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          textAlign: "center",
          background: "var(--surface-2)",
          borderStyle: "dashed",
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 12,
            background: "var(--accent-tint)",
            color: "var(--accent-ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={24} color="var(--accent-ink)" />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Coming in v1.1</div>
        <div style={{ fontSize: 13, color: "var(--muted)", maxWidth: 420, lineHeight: 1.5 }}>
          {cfg.blurb}
        </div>
      </div>
    </section>
  );
}

function labelFor(t: Tab) {
  if (t === "volumes" || t === "networks") return "Volumes & networks";
  if (t === "registries") return "Registries";
  return "Secrets";
}
