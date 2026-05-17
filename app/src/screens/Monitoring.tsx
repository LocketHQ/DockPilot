// Fleet monitoring — gauges, stacked CPU chart, latency/error placeholders.

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { LhqTopbar } from "../components/Shell";
import { Btn } from "../components/Primitives";
import { Gauge } from "../components/Charts";
import { IconRefresh } from "../lib/icons";
import { useApp } from "../state";
import * as api from "../lib/api";
import type { ServerRecord, SystemInfo, SystemStats } from "../lib/types";

type Range = "1H" | "6H" | "24H" | "7D" | "30D";

const SERIES_COLORS = [
  "var(--accent)",
  "oklch(0.74 0.14 60)",
  "oklch(0.62 0.18 25)",
  "var(--info)",
  "oklch(0.66 0.16 300)",
  "oklch(0.62 0.04 80)",
  "oklch(0.55 0.04 80)",
  "oklch(0.45 0.04 80)",
];

function colorForIndex(i: number): string {
  return SERIES_COLORS[i] ?? SERIES_COLORS[(i % (SERIES_COLORS.length - 5)) + 5];
}

export function MonitoringScreen() {
  const { servers, showToast } = useApp();
  const [cpuHistory, setCpuHistory] = useState<Record<string, number[]>>({});
  const [memHistory, setMemHistory] = useState<Record<string, number[]>>({});
  const [latest, setLatest] = useState<Record<string, SystemStats>>({});
  const [infos, setInfos] = useState<Record<string, SystemInfo>>({});
  const [netInPeak, setNetInPeak] = useState(0);
  const [range, setRange] = useState<Range>("24H");
  const [tickNonce, setTickNonce] = useState(0);

  useEffect(() => {
    let cancel = false;
    const tick = async () => {
      const next: Record<string, SystemStats> = {};
      const inf: Record<string, SystemInfo> = {};
      for (const s of servers) {
        try {
          next[s.id] = await api.getStats(s.id);
        } catch {}
        try {
          inf[s.id] = await api.getInfo(s.id);
        } catch {}
      }
      if (cancel) return;
      setLatest(next);
      setInfos((prev) => ({ ...prev, ...inf }));
      setCpuHistory((h) => {
        const out: Record<string, number[]> = { ...h };
        for (const s of servers) {
          const v = next[s.id]?.cpu_percent ?? null;
          const prev = out[s.id] || [];
          out[s.id] = v == null ? prev.slice(-119) : [...prev, v].slice(-120);
        }
        return out;
      });
      setMemHistory((h) => {
        const out: Record<string, number[]> = { ...h };
        for (const s of servers) {
          const st = next[s.id];
          const pct =
            st && st.memory_total_mb > 0
              ? Math.min(100, (st.memory_used_mb / st.memory_total_mb) * 100)
              : null;
          const prev = out[s.id] || [];
          out[s.id] = pct == null ? prev.slice(-119) : [...prev, pct].slice(-120);
        }
        return out;
      });
      const sumIn = Object.values(next).reduce(
        (a, b) => a + b.net_rx_bytes_per_sec,
        0
      );
      const mbps = sumIn / 1024 / 1024;
      setNetInPeak((p) => (mbps > p ? mbps : p));
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, [servers, tickNonce]);

  const avgCpu = useMemo(() => {
    const vals = Object.values(latest);
    if (!vals.length) return 0;
    return vals.reduce((a, b) => a + b.cpu_percent, 0) / vals.length;
  }, [latest]);

  const memUsed = useMemo(() => {
    const vals = Object.values(latest);
    return vals.reduce((a, b) => a + b.memory_used_mb, 0);
  }, [latest]);
  const memTotal = useMemo(() => {
    const vals = Object.values(latest);
    return vals.reduce((a, b) => a + b.memory_total_mb, 0);
  }, [latest]);

  const netInMbps = useMemo(() => {
    const vals = Object.values(latest);
    return vals.reduce((a, b) => a + b.net_rx_bytes_per_sec, 0) / 1024 / 1024;
  }, [latest]);

  const totalCores = useMemo(() => {
    return Object.values(infos).reduce((a, b) => a + (b.cpu_cores || 0), 0);
  }, [infos]);
  const activeCoreEquiv = (avgCpu / 100) * totalCores;

  return (
    <div className="lhq-main">
      <LhqTopbar
        breadcrumb={["Workspace", "Monitoring"]}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 10px",
                border: "1px solid var(--border)",
                borderRadius: 999,
                fontSize: 11.5,
                color: "var(--muted)",
                fontFamily: "var(--sans)",
              }}
            >
              <span className="lhq-pulse" />
              Live · 5 s refresh
            </div>
            <RangeSegmented value={range} onChange={setRange} />
            <Btn
              icon={IconRefresh}
              variant="ghost"
              onClick={() => {
                setTickNonce((n) => n + 1);
                showToast("Refreshing…");
              }}
              aria-label="Refresh"
            />
            <Btn variant="ghost" onClick={() => showToast("Coming soon")}>
              Export
            </Btn>
          </div>
        }
      />
      <div className="lhq-content">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          <GaugeCard
            label="FLEET CPU"
            value={Math.min(1, avgCpu / 100)}
            color="var(--accent)"
            big={`${Math.round(avgCpu)}%`}
            sub={`avg · ${servers.length} ${servers.length === 1 ? "host" : "hosts"}`}
          />
          <GaugeCard
            label="MEMORY"
            value={memTotal ? memUsed / memTotal : 0}
            color="var(--info)"
            big={`${memTotal ? Math.round((memUsed / memTotal) * 100) : 0}%`}
            sub={
              memTotal
                ? `${(memUsed / 1024).toFixed(0)} / ${(memTotal / 1024).toFixed(0)} GB`
                : "no samples"
            }
          />
          <GaugeCard
            label="NETWORK IN"
            value={Math.max(0, Math.min(1, netInMbps / 1000))}
            color="oklch(0.66 0.16 300)"
            big={netInMbps >= 10 ? netInMbps.toFixed(0) : netInMbps.toFixed(1)}
            sub={`MB/s · peak ${netInPeak >= 10 ? netInPeak.toFixed(0) : netInPeak.toFixed(1)}`}
          />
          <GaugeCard
            label="DISK IO"
            value={0}
            color="oklch(0.74 0.16 60)"
            big={<span style={{ color: "var(--muted-2)" }}>—</span>}
            sub="not yet wired"
          />
        </div>

        <div style={{ marginTop: 18 }}>
          <StackedCpuCard
            servers={servers}
            cpuHistory={cpuHistory}
            avgCpu={avgCpu}
            totalCores={totalCores}
            activeCoreEquiv={activeCoreEquiv}
            range={range}
          />
        </div>

        <div style={{ marginTop: 18 }}>
          <StackedMemoryCard
            servers={servers}
            memHistory={memHistory}
            latest={latest}
            range={range}
          />
        </div>

      </div>
    </div>
  );
}

function RangeSegmented({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const ranges: Range[] = ["1H", "6H", "24H", "7D", "30D"];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: 3,
        borderRadius: 8,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
      }}
    >
      {ranges.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            onClick={() => onChange(r)}
            style={{
              height: 24,
              padding: "0 10px",
              borderRadius: 6,
              border: 0,
              background: active ? "var(--surface)" : "transparent",
              boxShadow: active ? "var(--shadow-sm)" : "none",
              fontSize: 11.5,
              fontFamily: "var(--mono)",
              color: active ? "var(--ink)" : "var(--muted-2)",
              fontWeight: active ? 600 : 500,
              cursor: "default",
              letterSpacing: "0.02em",
            }}
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}

function GaugeCard({
  label,
  value,
  color,
  big,
  sub,
}: {
  label: string;
  value: number;
  color: string;
  big: ReactNode;
  sub: ReactNode;
}) {
  return (
    <div
      className="lhq-card"
      style={{
        padding: 24,
        height: 200,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          color: "var(--muted-2)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
        <Gauge value={value} color={color} size={180} label={big} sub={sub} />
      </div>
    </div>
  );
}

type StackedSample = { values: number[]; total: number; t: number };

function StackedMemoryCard({
  servers,
  memHistory,
  latest,
  range,
}: {
  servers: ServerRecord[];
  memHistory: Record<string, number[]>;
  latest: Record<string, SystemStats>;
  range: Range;
}) {
  const samples = useMemo<StackedSample[]>(() => {
    const len = Math.max(0, ...servers.map((s) => (memHistory[s.id] || []).length));
    const out: StackedSample[] = [];
    const now = Date.now();
    const tickMs = 3000;
    for (let i = 0; i < len; i++) {
      const values = servers.map((s) => (memHistory[s.id] || [])[i] ?? 0);
      const total = values.reduce((a, b) => a + b, 0) / Math.max(1, servers.length);
      const t = now - (len - 1 - i) * tickMs;
      out.push({ values, total, t });
    }
    return out;
  }, [servers, memHistory]);

  const totalUsedMb = servers.reduce((a, s) => a + (latest[s.id]?.memory_used_mb || 0), 0);
  const totalCapMb = servers.reduce((a, s) => a + (latest[s.id]?.memory_total_mb || 0), 0);
  const avgPct = totalCapMb > 0 ? (totalUsedMb / totalCapMb) * 100 : 0;
  const fmt = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

  return (
    <div className="lhq-card" style={{ padding: 0 }}>
      <div style={{ padding: "18px 22px 12px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 10.5,
                fontFamily: "var(--mono)",
                color: "var(--muted-2)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              MEMORY ACROSS FLEET · STACKED
            </div>
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: "8px 14px" }}>
              {servers.map((s, i) => (
                <div
                  key={s.id}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5 }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: colorForIndex(i),
                      display: "inline-block",
                    }}
                  />
                  <span style={{ color: "var(--ink-2)", fontFamily: "var(--sans)" }}>{s.name}</span>
                </div>
              ))}
              {servers.length === 0 && (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>No servers connected.</span>
              )}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              className="serif-it"
              style={{ fontSize: 38, lineHeight: 1, color: "var(--ink)" }}
            >
              {avgPct.toFixed(1)}%
            </div>
            {totalCapMb > 0 && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  color: "var(--muted)",
                  fontFamily: "var(--mono)",
                }}
              >
                · {fmt(totalUsedMb)} of {fmt(totalCapMb)} used
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={{ padding: "0 8px 12px" }}>
        <StackedAreaChart
          samples={samples}
          serverNames={servers.map((s) => s.name)}
          height={220}
          range={range}
        />
      </div>
    </div>
  );
}

function StackedCpuCard({
  servers,
  cpuHistory,
  avgCpu,
  totalCores,
  activeCoreEquiv,
  range,
}: {
  servers: ServerRecord[];
  cpuHistory: Record<string, number[]>;
  avgCpu: number;
  totalCores: number;
  activeCoreEquiv: number;
  range: Range;
}) {
  const samples = useMemo<StackedSample[]>(() => {
    const len = Math.max(0, ...servers.map((s) => (cpuHistory[s.id] || []).length));
    const out: StackedSample[] = [];
    const now = Date.now();
    const tickMs = 3000;
    for (let i = 0; i < len; i++) {
      const values = servers.map((s) => (cpuHistory[s.id] || [])[i] ?? 0);
      const total = values.reduce((a, b) => a + b, 0) / Math.max(1, servers.length);
      const t = now - (len - 1 - i) * tickMs;
      out.push({ values, total, t });
    }
    return out;
  }, [servers, cpuHistory]);

  return (
    <div className="lhq-card" style={{ padding: 0 }}>
      <div style={{ padding: "18px 22px 12px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 10.5,
                fontFamily: "var(--mono)",
                color: "var(--muted-2)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              CPU ACROSS FLEET · STACKED
            </div>
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: "8px 14px" }}>
              {servers.map((s, i) => (
                <div
                  key={s.id}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5 }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: colorForIndex(i),
                      display: "inline-block",
                    }}
                  />
                  <span style={{ color: "var(--ink-2)", fontFamily: "var(--sans)" }}>{s.name}</span>
                </div>
              ))}
              {servers.length === 0 && (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>No servers connected.</span>
              )}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              className="serif-it"
              style={{ fontSize: 38, lineHeight: 1, color: "var(--ink)" }}
            >
              {avgCpu.toFixed(1)}%
            </div>
            {totalCores > 0 && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  color: "var(--muted)",
                  fontFamily: "var(--mono)",
                }}
              >
                · {activeCoreEquiv.toFixed(1)} vCPU active of {totalCores.toFixed(1)}
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={{ padding: "0 8px 12px" }}>
        <StackedAreaChart
          samples={samples}
          serverNames={servers.map((s) => s.name)}
          height={260}
          range={range}
        />
      </div>
    </div>
  );
}

function StackedAreaChart({
  samples,
  serverNames,
  height,
  range,
}: {
  samples: StackedSample[];
  serverNames: string[];
  height: number;
  range: Range;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(900);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 44, r: 18, t: 14, b: 30 };
  const w = Math.max(120, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const seriesCount = serverNames.length;
  const max = 100;
  const stepX = w / Math.max(1, samples.length - 1);

  const stackedSeries: number[][][] = [];
  for (let s = 0; s < seriesCount; s++) {
    const pts: number[][] = [];
    for (let i = 0; i < samples.length; i++) {
      const cum = samples[i].values
        .slice(0, s + 1)
        .reduce((a, b) => a + b, 0) / Math.max(1, seriesCount);
      const cumPrev = samples[i].values
        .slice(0, s)
        .reduce((a, b) => a + b, 0) / Math.max(1, seriesCount);
      const x = pad.l + i * stepX;
      const yTop = pad.t + h - (cum / max) * h;
      const yBot = pad.t + h - (cumPrev / max) * h;
      pts.push([x, yTop, yBot]);
    }
    stackedSeries.push(pts);
  }

  const xLabels = (() => {
    if (range === "7D") return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    if (range === "30D") return ["−30d", "−24d", "−18d", "−12d", "−6d", "now"];
    if (range === "1H") return ["−60m", "−45m", "−30m", "−15m", "now"];
    if (range === "6H") return ["−6h", "−4h", "−2h", "now"];
    return ["−24h", "−18h", "−12h", "−6h", "−3h", "now"];
  })();

  function handleMove(e: React.MouseEvent<SVGRectElement>) {
    if (samples.length === 0) return;
    const svg = (e.currentTarget.ownerSVGElement as SVGSVGElement) || null;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const i = Math.max(
      0,
      Math.min(samples.length - 1, Math.round((localX - pad.l) / stepX))
    );
    setHoverIdx(i);
    setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }
  function handleLeave() {
    setHoverIdx(null);
    setHoverPos(null);
  }

  const empty = samples.length < 2;
  const hovered =
    hoverIdx !== null && samples[hoverIdx] ? samples[hoverIdx] : null;

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      {empty ? (
        <div
          style={{
            height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted-2)",
            fontFamily: "var(--mono)",
            fontSize: 12,
          }}
        >
          waiting for samples…
        </div>
      ) : (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: "block", overflow: "visible" }}
        >
          {[0, 25, 50, 75, 100].map((v, i) => {
            const y = pad.t + h - (v / 100) * h;
            return (
              <g key={i}>
                <line
                  x1={pad.l}
                  y1={y}
                  x2={pad.l + w}
                  y2={y}
                  stroke="var(--border)"
                  strokeDasharray={v === 0 ? "0" : "2 4"}
                />
                <text
                  x={pad.l - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--muted-2)"
                  fontFamily="var(--mono)"
                >
                  {v}%
                </text>
              </g>
            );
          })}
          {xLabels.map((l, i) => {
            const x = pad.l + (w / Math.max(1, xLabels.length - 1)) * i;
            return (
              <text
                key={i}
                x={x}
                y={pad.t + h + 18}
                textAnchor="middle"
                fontSize="10"
                fill="var(--muted-2)"
                fontFamily="var(--mono)"
              >
                {l}
              </text>
            );
          })}

          {stackedSeries.map((pts, s) => {
            const color = colorForIndex(s);
            const top = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
            const bottomRev = pts
              .slice()
              .reverse()
              .map((p) => `L${p[0]},${p[2]}`)
              .join(" ");
            const area = `${top} ${bottomRev} Z`;
            return (
              <g key={s}>
                <path d={area} fill={color} fillOpacity={0.55} />
                <path
                  d={top}
                  fill="none"
                  stroke={color}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}

          {hoverIdx !== null && stackedSeries[0]?.[hoverIdx] && (
            <line
              x1={stackedSeries[0][hoverIdx][0]}
              x2={stackedSeries[0][hoverIdx][0]}
              y1={pad.t}
              y2={pad.t + h}
              stroke="var(--ink)"
              strokeOpacity="0.3"
              strokeDasharray="3 3"
            />
          )}

          <rect
            x={pad.l}
            y={pad.t}
            width={w}
            height={h}
            fill="transparent"
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
          />
        </svg>
      )}

      {hovered && hoverPos && (
        <StackedTooltip
          sample={hovered}
          serverNames={serverNames}
          x={hoverPos.x}
          y={hoverPos.y}
          containerWidth={width}
        />
      )}
    </div>
  );
}

function StackedTooltip({
  sample,
  serverNames,
  x,
  y,
  containerWidth,
}: {
  sample: StackedSample;
  serverNames: string[];
  x: number;
  y: number;
  containerWidth: number;
}) {
  const date = new Date(sample.t);
  const day = date.toLocaleDateString(undefined, { weekday: "short" });
  const time = `${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes()
  ).padStart(2, "0")}`;
  const total =
    sample.values.reduce((a, b) => a + b, 0) / Math.max(1, serverNames.length);

  const rows = sample.values
    .map((v, i) => ({ name: serverNames[i] || `srv${i}`, value: v, color: colorForIndex(i) }))
    .sort((a, b) => b.value - a.value);

  const w = 220;
  const left = Math.max(8, Math.min(containerWidth - w - 8, x + 14));
  const top = Math.max(8, y - 16);

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: w,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "var(--shadow-md)",
        padding: 12,
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          color: "var(--muted-2)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {day} · {time} UTC
      </div>
      <div
        className="serif-it"
        style={{ fontSize: 22, marginTop: 4, color: "var(--ink)", lineHeight: 1.1 }}
      >
        {total.toFixed(1)} % total
      </div>
      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 5,
        }}
      >
        {rows.map((r) => (
          <div
            key={r.name}
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: r.color,
                display: "inline-block",
              }}
            />
            <span style={{ flex: 1, color: "var(--ink-2)" }}>{r.name}</span>
            <span
              style={{
                fontFamily: "var(--mono)",
                color: "var(--ink)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {r.value.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

