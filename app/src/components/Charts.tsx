// Sparkline, AreaChart, HealthRing, Gauge — ported from the design's shell.jsx.

import { ReactNode, useId } from "react";

type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  strokeWidth?: number;
};
export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "var(--accent)",
  fill = true,
  strokeWidth = 1.5,
}: SparklineProps) {
  if (!data.length) return <svg width={width} height={height} />;
  const min = Math.min(...data),
    max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1 || 1);
  const pts = data.map<[number, number]>((v, i) => [
    i * stepX,
    height - ((v - min) / range) * (height - 4) - 2,
  ]);
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${d} L${width},${height} L0,${height} Z`;
  const id = useId().replace(/:/g, "");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      {fill && (
        <>
          <defs>
            <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#sp-${id})`} />
        </>
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type AreaChartProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  yMax?: number;
  xLabels?: string[];
  gridY?: number;
  tooltipIdx?: number | null;
  unit?: string;
};
export function AreaChart({
  data,
  width = 700,
  height = 220,
  color = "var(--accent)",
  yMax,
  xLabels = [],
  gridY = 4,
  tooltipIdx = null,
  unit = "%",
}: AreaChartProps) {
  const pad = { l: 38, r: 12, t: 12, b: 24 };
  const w = width - pad.l - pad.r,
    h = height - pad.t - pad.b;
  const max = yMax ?? (Math.ceil(Math.max(...(data.length ? data : [0])) / 10) * 10 || 100);
  const stepX = w / (data.length - 1 || 1);
  const toY = (v: number) => pad.t + h - (v / max) * h;
  const pts = data.map<[number, number]>((v, i) => [pad.l + i * stepX, toY(v)]);
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${d} L${pad.l + w},${pad.t + h} L${pad.l},${pad.t + h} Z`;
  const id = useId().replace(/:/g, "");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: gridY + 1 }, (_, i) => {
        const y = pad.t + (h / gridY) * i;
        const val = Math.round(max - (max / gridY) * i);
        return (
          <g key={i}>
            <line
              x1={pad.l}
              y1={y}
              x2={pad.l + w}
              y2={y}
              stroke="var(--border)"
              strokeDasharray={i === gridY ? "0" : "2 4"}
            />
            <text x={pad.l - 8} y={y + 3} textAnchor="end" fontSize="10" fill="var(--muted-2)" fontFamily="var(--mono)">
              {val}
              {unit}
            </text>
          </g>
        );
      })}
      {xLabels.map((l, i) => {
        const x = pad.l + (w / (xLabels.length - 1 || 1)) * i;
        return (
          <text key={i} x={x} y={pad.t + h + 16} textAnchor="middle" fontSize="10" fill="var(--muted-2)" fontFamily="var(--mono)">
            {l}
          </text>
        );
      })}
      <path d={area} fill={`url(#grad-${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {tooltipIdx !== null && pts[tooltipIdx] && (
        <g>
          <line
            x1={pts[tooltipIdx][0]}
            x2={pts[tooltipIdx][0]}
            y1={pad.t}
            y2={pad.t + h}
            stroke={color}
            strokeOpacity="0.4"
            strokeDasharray="3 3"
          />
          <circle
            cx={pts[tooltipIdx][0]}
            cy={pts[tooltipIdx][1]}
            r="5"
            fill="var(--surface)"
            stroke={color}
            strokeWidth="2"
          />
        </g>
      )}
    </svg>
  );
}

type HealthRingProps = {
  size?: number;
  value: number;
  color?: string;
  label?: ReactNode;
};
export function HealthRing({ size = 56, value, color = "var(--accent)", label }: HealthRingProps) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const dash = C * Math.max(0, Math.min(1, value));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-3)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${C}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {label && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--sans)",
            fontSize: size * 0.28,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: "-0.01em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

type GaugeProps = { value: number; label: ReactNode; sub?: ReactNode; size?: number; color?: string };
export function Gauge({ value, label, sub, size = 180, color = "var(--accent)" }: GaugeProps) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const C = Math.PI * r;
  const dash = C * Math.max(0, Math.min(1, value));
  return (
    <div style={{ position: "relative", width: size, height: size / 2 + 20 }}>
      <svg width={size} height={size / 2 + 10} viewBox={`0 0 ${size} ${size / 2 + 10}`}>
        <path
          d={`M${stroke / 2},${size / 2} A${r},${r} 0 0 1 ${size - stroke / 2},${size / 2}`}
          stroke="var(--surface-3)"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M${stroke / 2},${size / 2} A${r},${r} 0 0 1 ${size - stroke / 2},${size / 2}`}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${C}`}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, top: 30, textAlign: "center" }}>
        <div className="serif-it" style={{ fontSize: 38, lineHeight: 1 }}>
          {label}
        </div>
        {sub && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, fontFamily: "var(--mono)" }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}
