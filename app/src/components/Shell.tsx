// LhqLogo, LhqSidebar, LhqTopbar — the app chrome.

import { ReactNode } from "react";
import {
  IconBox,
  IconChevR,
  IconCommand,
  IconDisk,
  IconGear,
  IconGlobe,
  IconHeart,
  IconKey,
  IconNet,
  IconServer,
} from "../lib/icons";

export function LhqLogo({ size = 22 }: { size?: number }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9.2" stroke="var(--ink)" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="4.2" fill="var(--accent)" />
        <circle cx="12" cy="12" r="4.2" stroke="var(--accent-ink)" strokeWidth="1" strokeOpacity="0.3" />
      </svg>
      <span
        style={{
          fontFamily: "var(--sans)",
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: "var(--ink)",
        }}
      >
        Dock<span style={{ color: "var(--accent-ink)" }}>Pilot</span>
      </span>
    </div>
  );
}

export type NavId =
  | "servers"
  | "containers"
  | "monitor"
  | "volumes"
  | "networks"
  | "domains"
  | "keys"
  | "settings";

type Props = {
  active: NavId;
  onNavigate: (id: NavId) => void;
  serverCount?: number;
  containerCount?: number;
};

export function LhqSidebar({ active, onNavigate, serverCount, containerCount }: Props) {
  const nav: { id: NavId; label: string; icon: any; group: string; badge?: string }[] = [
    { id: "servers", label: "Servers", icon: IconServer, group: "Workspace", badge: serverCount?.toString() },
    { id: "containers", label: "Containers", icon: IconBox, group: "Workspace", badge: containerCount?.toString() },
    { id: "monitor", label: "Monitoring", icon: IconHeart, group: "Workspace" },
    { id: "volumes", label: "Volumes", icon: IconDisk, group: "Resources" },
    { id: "networks", label: "Networks", icon: IconNet, group: "Resources" },
    { id: "domains", label: "Domains", icon: IconGlobe, group: "Resources" },
    { id: "keys", label: "SSH keys", icon: IconKey, group: "Settings" },
    { id: "settings", label: "Preferences", icon: IconGear, group: "Settings" },
  ];

  const groups = ["Workspace", "Resources", "Settings"];

  return (
    <aside className="lhq-sidebar">
      <div style={{ padding: "4px 8px 14px" }}>
        <LhqLogo />
      </div>

      {groups.map((g) => (
        <div key={g}>
          <div className="lhq-side-section">{g}</div>
          {nav
            .filter((n) => n.group === g)
            .map((n) => {
              const Icon = n.icon;
              return (
                <button
                  key={n.id}
                  className="lhq-side-item"
                  data-active={active === n.id}
                  onClick={() => onNavigate(n.id)}
                >
                  <Icon size={15} className="lhq-side-icon" />
                  <span style={{ flex: 1 }}>{n.label}</span>
                  {n.badge && (
                    <span
                      style={{
                        fontSize: 10.5,
                        color: "var(--muted-2)",
                        fontFamily: "var(--mono)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {n.badge}
                    </span>
                  )}
                </button>
              );
            })}
        </div>
      ))}

      <div style={{ flex: 1 }} />

      <div
        style={{
          margin: "12px 4px 0",
          padding: "10px 12px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          fontSize: 11.5,
          color: "var(--muted)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <IconCommand size={13} color="var(--muted)" />
        <span style={{ flex: 1 }}>Quick actions</span>
        <span className="kbd">⌘</span>
        <span className="kbd">K</span>
      </div>
    </aside>
  );
}

type TopbarProps = {
  title?: string;
  kicker?: string;
  breadcrumb?: string[];
  status?: ReactNode;
  actions?: ReactNode;
};
export function LhqTopbar({ title, kicker, breadcrumb, status, actions }: TopbarProps) {
  return (
    <header className="lhq-topbar">
      <div style={{ flex: 1, minWidth: 0 }}>
        {kicker && (
          <div
            style={{
              fontSize: 10.5,
              color: "var(--muted-2)",
              fontFamily: "var(--mono)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            {kicker}
          </div>
        )}
        {breadcrumb ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {breadcrumb.map((b, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {i > 0 && <IconChevR size={12} color="var(--muted-2)" />}
                <span
                  style={{
                    fontFamily: "var(--sans)",
                    fontSize: i === breadcrumb.length - 1 ? 18 : 13,
                    fontWeight: i === breadcrumb.length - 1 ? 600 : 500,
                    color: i === breadcrumb.length - 1 ? "var(--ink)" : "var(--muted)",
                    letterSpacing: "-0.005em",
                  }}
                >
                  {b}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <h1>{title}</h1>
        )}
      </div>
      {status && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            border: "1px solid var(--border)",
            borderRadius: 999,
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          <span className="lhq-pulse" /> {status}
        </div>
      )}
      {actions}
    </header>
  );
}
