// ⌘K Command palette.

import { useEffect, useMemo, useState } from "react";
import {
  IconBox,
  IconCommand,
  IconGear,
  IconPlus,
  IconRefresh,
  IconServer,
  IconTerm,
} from "../lib/icons";
import { useApp } from "../state";

type Item = {
  id: string;
  label: string;
  hint?: string;
  icon: any;
  action: () => void;
};

export function CommandPaletteOverlay({ onClose }: { onClose: () => void }) {
  const { navigate, servers, showToast } = useApp();
  const [q, setQ] = useState("");

  const items: Item[] = useMemo(
    () => [
      { id: "add-server", label: "Add server", hint: "ssh install runner", icon: IconPlus, action: () => navigate({ kind: "onboarding" }) },
      { id: "new-container", label: "New container", hint: "wizard", icon: IconPlus, action: () => navigate({ kind: "wizard", step: 0 }) },
      { id: "fleet", label: "Fleet", hint: "all servers", icon: IconServer, action: () => navigate({ kind: "servers" }) },
      { id: "containers", label: "Containers", hint: "all hosts", icon: IconBox, action: () => navigate({ kind: "containers" }) },
      { id: "monitor", label: "Monitoring", hint: "live charts", icon: IconRefresh, action: () => navigate({ kind: "monitor" }) },
      { id: "settings", label: "Preferences", icon: IconGear, action: () => navigate({ kind: "settings" }) },
      ...servers.map((s) => ({
        id: `srv-${s.id}`,
        label: s.name,
        hint: `${s.host} · open server`,
        icon: IconTerm,
        action: () => navigate({ kind: "server", id: s.id }),
      })),
    ],
    [navigate, servers]
  );

  const matches = items.filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()) || (i.hint || "").toLowerCase().includes(q.toLowerCase()));
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(matches.length - 1, s + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(0, s - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const m = matches[sel];
        if (m) {
          m.action();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [matches, sel, onClose]);

  return (
    <div className="lhq-modal-back" onClick={onClose}>
      <div
        className="lhq-modal"
        style={{ width: 540, padding: 0, overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <IconCommand size={14} color="var(--muted)" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search actions, servers, containers…"
            style={{ flex: 1, border: 0, outline: 0, background: "transparent", fontSize: 15, color: "var(--ink)", fontFamily: "var(--sans)" }}
          />
          <span className="kbd">esc</span>
        </div>
        <div style={{ maxHeight: 360, overflowY: "auto", padding: 6 }}>
          {matches.length === 0 && <div style={{ padding: 18, color: "var(--muted)" }}>No matches.</div>}
          {matches.map((m, i) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                onMouseEnter={() => setSel(i)}
                onClick={() => {
                  m.action();
                  onClose();
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: 0,
                  background: i === sel ? "var(--accent-tint)" : "transparent",
                  color: "var(--ink)",
                  fontSize: 13,
                  cursor: "default",
                  textAlign: "left",
                }}
              >
                <Icon size={14} color={i === sel ? "var(--accent-ink)" : "var(--muted)"} />
                <span style={{ flex: 1 }}>{m.label}</span>
                {m.hint && <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted-2)" }}>{m.hint}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
