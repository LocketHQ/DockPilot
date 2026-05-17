// Live log modal shown during deployment (compose up, builds, image pull).
// Subscribes to the runner_stream events and renders NDJSON frames.

import { useEffect, useRef, useState } from "react";
import { Btn } from "./Primitives";
import { IconCheck, IconRefresh, IconX } from "../lib/icons";

export type DeployLogLine =
  | { event: "log"; stream: "stdout" | "stderr" | "meta"; line: string }
  | { event: "done"; ids: string[] }
  | { event: "error"; message: string }
  | { event: "info"; message: string };

type Status = "running" | "done" | "error";

export function DeployLogsModal({
  open,
  title,
  subtitle,
  lines,
  status,
  errorMessage,
  doneHint,
  onClose,
  onPrimary,
  primaryLabel,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  lines: DeployLogLine[];
  status: Status;
  errorMessage?: string | null;
  doneHint?: string;
  onClose: () => void;
  onPrimary?: () => void;
  primaryLabel?: string;
}) {
  const logRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!autoScroll) return;
    requestAnimationFrame(() => {
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [lines.length, autoScroll]);

  if (!open) return null;

  return (
    <div className="lhq-modal-back" onClick={status === "running" ? undefined : onClose}>
      <div
        className="lhq-modal"
        style={{
          width: 920,
          maxWidth: "94vw",
          height: 600,
          maxHeight: "90vh",
          padding: 0,
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <StatusDot status={status} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
              {subtitle || statusHint(status, errorMessage, doneHint, lines.length)}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              color: "var(--muted)",
            }}
          >
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            autoscroll
          </label>
          {status !== "running" && (
            <Btn size="sm" variant="ghost" icon={IconX} onClick={onClose}>
              Close
            </Btn>
          )}
        </div>

        <div
          ref={logRef}
          style={{
            flex: 1,
            overflow: "auto",
            padding: "14px 18px",
            background: "#1a1814",
            color: "#e6e3da",
            fontFamily: "var(--mono)",
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          {lines.length === 0 ? (
            <span style={{ color: "#6b665c" }}>waiting for output…</span>
          ) : (
            lines.map((l, i) => <LineRow key={i} line={l} />)
          )}
        </div>

        {status !== "running" && (
          <div
            style={{
              padding: "12px 18px",
              borderTop: "1px solid var(--border)",
              background: "var(--surface-2)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            {status === "done" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--accent-ink)", fontSize: 12.5 }}>
                <IconCheck size={13} /> {doneHint || "Deploy succeeded"}
              </span>
            )}
            {status === "error" && (
              <span style={{ color: "oklch(0.42 0.12 25)", fontSize: 12.5, fontFamily: "var(--mono)" }}>
                {errorMessage || "Deploy failed"}
              </span>
            )}
            <div style={{ flex: 1 }} />
            {onPrimary && (
              <Btn variant="primary" onClick={onPrimary}>
                {primaryLabel || "Open"}
              </Btn>
            )}
            <Btn onClick={onClose}>Close</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

function LineRow({ line }: { line: DeployLogLine }) {
  if (line.event === "log") {
    const c =
      line.stream === "stderr"
        ? "#f5b2a0"
        : line.stream === "meta"
        ? "#9aa6b4"
        : "#e6e3da";
    return (
      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", color: c }}>{line.line}</div>
    );
  }
  if (line.event === "done") {
    return (
      <div style={{ color: "oklch(0.78 0.14 152)", marginTop: 8 }}>
        ▎ done · {line.ids.length} container{line.ids.length === 1 ? "" : "s"}
      </div>
    );
  }
  if (line.event === "error") {
    return (
      <div style={{ color: "oklch(0.72 0.18 25)", marginTop: 8 }}>
        ▎ error · {line.message}
      </div>
    );
  }
  if (line.event === "info") {
    return <div style={{ color: "#9aa6b4" }}>▎ {line.message}</div>;
  }
  return null;
}

function StatusDot({ status }: { status: Status }) {
  if (status === "running")
    return <span className="lhq-pulse" style={{ width: 10, height: 10 }} />;
  if (status === "done")
    return (
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: "var(--accent)",
          display: "inline-block",
        }}
      />
    );
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: 999,
        background: "var(--danger)",
        display: "inline-block",
      }}
    />
  );
}

function statusHint(status: Status, err: string | null | undefined, doneHint: string | undefined, lines: number) {
  if (status === "running") return `${lines} lines · streaming`;
  if (status === "done") return doneHint || "complete";
  return err || "failed";
}
