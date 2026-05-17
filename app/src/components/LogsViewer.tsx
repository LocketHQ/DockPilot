// Modal that fetches + shows runner journalctl output for a server.

import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { Btn } from "./Primitives";
import { IconRefresh, IconX } from "../lib/icons";

export function RunnerLogsModal({
  open,
  serverId,
  serverName,
  onClose,
}: {
  open: boolean;
  serverId: string;
  serverName: string;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<number>(200);
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const t = await api.fetchRunnerLogs(serverId, lines);
      setText(t || "(no output)");
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open, serverId, lines]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="lhq-modal-back" onClick={onClose}>
      <div
        className="lhq-modal"
        style={{ width: 880, maxWidth: "90vw", height: 600, maxHeight: "90vh", padding: 0, display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Runner logs</div>
            <div style={{ fontSize: 11.5, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
              journalctl -u lockethq-runner · {serverName}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <select
            value={lines}
            onChange={(e) => setLines(parseInt(e.target.value))}
            style={{
              height: 28,
              padding: "0 8px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              fontSize: 12.5,
              fontFamily: "var(--mono)",
              color: "var(--ink)",
            }}
          >
            <option value={50}>50 lines</option>
            <option value={200}>200 lines</option>
            <option value={500}>500 lines</option>
            <option value={2000}>2000 lines</option>
          </select>
          <Btn size="sm" variant="ghost" icon={IconRefresh} onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => navigator.clipboard?.writeText(text)}
          >
            Copy
          </Btn>
          <Btn size="sm" variant="ghost" icon={IconX} onClick={onClose} />
        </div>

        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "12px 16px",
            background: "#1a1814",
            color: "#e6e3da",
            fontFamily: "var(--mono)",
            fontSize: 12,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {err ? (
            <span style={{ color: "oklch(0.72 0.18 25)" }}>{err}</span>
          ) : loading && !text ? (
            <span style={{ color: "var(--muted-2)" }}>fetching…</span>
          ) : (
            text || "(no output yet)"
          )}
        </div>
      </div>
    </div>
  );
}
