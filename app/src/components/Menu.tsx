// Tiny anchored menu + confirm modal. No external deps.

import { ReactNode, useEffect, useRef, useState } from "react";

export type MenuItem = {
  label: string;
  hint?: string;
  destructive?: boolean;
  onClick: () => void | Promise<void>;
};

export function Menu({
  anchorRef,
  open,
  onClose,
  items,
}: {
  anchorRef: React.RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  items: MenuItem[];
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      if (anchorRef.current && anchorRef.current.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchorRef, onClose]);

  if (!open || !anchorRef.current) return null;
  const r = anchorRef.current.getBoundingClientRect();
  const top = r.bottom + 6;
  const right = window.innerWidth - r.right;

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top,
        right,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "var(--shadow-lg)",
        padding: 6,
        minWidth: 200,
        zIndex: 80,
      }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          onClick={async (e) => {
            e.stopPropagation();
            onClose();
            await it.onClick();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            textAlign: "left",
            padding: "8px 10px",
            borderRadius: 6,
            border: 0,
            background: "transparent",
            color: it.destructive ? "oklch(0.42 0.12 25)" : "var(--ink)",
            fontSize: 13,
            cursor: "default",
            fontFamily: "var(--sans)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-2)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          }}
        >
          <span style={{ flex: 1 }}>{it.label}</span>
          {it.hint && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted-2)" }}>
              {it.hint}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
  onClose,
  busy,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  busy?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="lhq-modal-back" onClick={onClose}>
      <div className="lhq-modal" style={{ padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 22, lineHeight: 1.5 }}>
          {body}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="lhq-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="lhq-btn"
            data-variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
