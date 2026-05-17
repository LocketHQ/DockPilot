// Modal that browses a container's bind/volume mounts and lets you edit
// files. The runner enforces that we never escape the mount root.

import { useEffect, useState } from "react";
import { Btn } from "./Primitives";
import { IconChevL, IconChevR, IconFolder, IconLogs, IconRefresh, IconX } from "../lib/icons";
import * as api from "../lib/api";

export function FileBrowserModal({
  open,
  onClose,
  serverId,
  containerId,
  rootPath,
  readOnly,
  title,
}: {
  open: boolean;
  onClose: () => void;
  serverId: string;
  containerId: string;
  rootPath: string;
  readOnly: boolean;
  title: string;
}) {
  const [path, setPath] = useState(rootPath);
  const [view, setView] = useState<api.FsView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load(p = path) {
    setLoading(true);
    setErr(null);
    setDirty(false);
    try {
      const v = await api.fsRead(serverId, containerId, p);
      setView(v);
      setPath(v.path);
      if (v.kind === "file") setEdit(v.content);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      setPath(rootPath);
      load(rootPath);
    }
  }, [open, rootPath]);

  async function save() {
    if (!view || view.kind !== "file") return;
    setSaving(true);
    try {
      await api.fsWrite(serverId, containerId, view.path, edit);
      setDirty(false);
      await load(view.path);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const crumbs = path.split("/").filter(Boolean);
  function goUp() {
    const parts = path.split("/").filter(Boolean);
    if (parts.length <= 1) return;
    parts.pop();
    load("/" + parts.join("/"));
  }
  function goTo(idx: number) {
    const parts = path.split("/").filter(Boolean).slice(0, idx + 1);
    load("/" + parts.join("/"));
  }

  return (
    <div className="lhq-modal-back" onClick={onClose}>
      <div
        className="lhq-modal"
        style={{
          width: 960,
          maxWidth: "94vw",
          height: 640,
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
          <IconFolder size={16} color="var(--muted)" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
              {readOnly ? "read-only mount" : "read/write mount"}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <Btn size="sm" variant="ghost" icon={IconRefresh} onClick={() => load(path)} disabled={loading}>
            Refresh
          </Btn>
          <Btn size="sm" variant="ghost" icon={IconX} onClick={onClose} />
        </div>

        {/* Breadcrumbs */}
        <div
          style={{
            padding: "10px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface-2)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            fontFamily: "var(--mono)",
            fontSize: 12,
          }}
        >
          <button
            onClick={goUp}
            disabled={crumbs.length <= 1}
            style={{
              border: 0,
              background: "transparent",
              cursor: "default",
              padding: "2px 6px",
              fontSize: 12,
              color: "var(--muted)",
              borderRadius: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            <IconChevL size={11} /> up
          </button>
          <span style={{ color: "var(--muted-2)" }}>/</span>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={() => goTo(i)}
                style={{
                  border: 0,
                  background: "transparent",
                  cursor: "default",
                  padding: "2px 4px",
                  color: i === crumbs.length - 1 ? "var(--ink)" : "var(--muted)",
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                }}
              >
                {c}
              </button>
              {i < crumbs.length - 1 && <span style={{ color: "var(--muted-2)" }}>/</span>}
            </span>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
          {err && (
            <div style={{ padding: 18, color: "oklch(0.42 0.12 25)", fontFamily: "var(--mono)", fontSize: 12.5 }}>
              {err}
            </div>
          )}
          {!err && view?.kind === "dir" && (
            <div style={{ flex: 1, overflow: "auto" }}>
              {view.entries.length === 0 && (
                <div style={{ padding: 24, color: "var(--muted)", fontSize: 13 }}>(empty directory)</div>
              )}
              {view.entries.map((e) => (
                <button
                  key={e.name}
                  onClick={() => {
                    if (e.kind === "dir") load(path.replace(/\/$/, "") + "/" + e.name);
                    else if (e.kind === "file") load(path.replace(/\/$/, "") + "/" + e.name);
                  }}
                  style={{
                    width: "100%",
                    display: "grid",
                    gridTemplateColumns: "20px 1fr 100px 140px",
                    gap: 12,
                    padding: "10px 18px",
                    border: 0,
                    borderBottom: "1px solid var(--border)",
                    background: "transparent",
                    textAlign: "left",
                    cursor: "default",
                    alignItems: "center",
                  }}
                >
                  {e.kind === "dir" ? (
                    <IconFolder size={14} color="var(--muted)" />
                  ) : (
                    <IconLogs size={14} color="var(--muted)" />
                  )}
                  <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--ink-2)" }}>
                    {e.name}
                    {e.kind === "dir" ? "/" : ""}
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted)", textAlign: "right" }}>
                    {e.size != null ? formatSize(e.size) : "—"}
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted-2)" }}>
                    {e.modified ? new Date(e.modified * 1000).toISOString().slice(0, 16).replace("T", " ") : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
          {!err && view?.kind === "file" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <textarea
                value={edit}
                onChange={(e) => {
                  setEdit(e.target.value);
                  setDirty(true);
                }}
                disabled={readOnly}
                style={{
                  flex: 1,
                  width: "100%",
                  padding: 16,
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  border: 0,
                  outline: 0,
                  background: "#fcfbf7",
                  color: "var(--ink-2)",
                  resize: "none",
                  lineHeight: 1.55,
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 18px",
                  borderTop: "1px solid var(--border)",
                  background: "var(--surface-2)",
                }}
              >
                <span style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--mono)" }}>
                  {view.size} bytes
                  {view.truncated && <span style={{ color: "oklch(0.42 0.10 70)", marginLeft: 8 }}>truncated</span>}
                  {readOnly && <span style={{ color: "var(--muted-2)", marginLeft: 8 }}>read-only</span>}
                </span>
                <div style={{ flex: 1 }} />
                {!readOnly && (
                  <Btn variant="primary" onClick={save} disabled={!dirty || saving || view.truncated}>
                    {saving ? "Saving…" : "Save"}
                  </Btn>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
