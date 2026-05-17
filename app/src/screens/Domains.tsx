// Domains page — Cloudflare DNS + Traefik reverse proxy.

import { useEffect, useMemo, useRef, useState } from "react";
import { LhqTopbar } from "../components/Shell";
import { Btn, Tag } from "../components/Primitives";
import { ConfirmModal, Menu } from "../components/Menu";
import {
  IconBolt,
  IconCheck,
  IconChevD,
  IconCloud,
  IconDots,
  IconGlobe,
  IconPlus,
  IconRefresh,
  IconSearch,
} from "../lib/icons";
import { useApp } from "../state";
import * as api from "../lib/api";
import type { ContainerSummary, ServerRecord } from "../lib/types";

// ─── shared bits ─────────────────────────────────────────────────────────

function CfLogo({ size = 44, radius = 10, iconSize }: { size?: number; radius?: number; iconSize?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "linear-gradient(180deg, #F38020, #C66510)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <IconCloud size={iconSize ?? Math.round(size * 0.5)} color="#fff" />
    </div>
  );
}

function OrangeCloud({ size = 16 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        background: "linear-gradient(180deg, #F38020, #C66510)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <IconCloud size={Math.round(size * 0.7)} color="#fff" />
    </div>
  );
}

function CheckCircle({ checked, onClick, disabled }: { checked: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 18,
        height: 18,
        borderRadius: 999,
        background: checked ? "var(--accent)" : "var(--surface)",
        border: checked
          ? "1px solid color-mix(in oklch, var(--accent) 60%, black)"
          : "1px solid var(--border-strong)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "default",
        padding: 0,
        flexShrink: 0,
        opacity: disabled ? 0.85 : 1,
      }}
    >
      {checked && <IconCheck size={11} color="#0E1F18" />}
    </button>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────

type ZoneRow = api.CfZone & { recordCount: number; sublabel: string };

export function DomainsScreen() {
  const { servers, showToast, navigate } = useApp();
  const [cfConnected, setCfConnected] = useState<boolean | null>(null);
  const [zones, setZones] = useState<api.CfZone[]>([]);
  const [zonesErr, setZonesErr] = useState<string | null>(null);
  const [zoneRecords, setZoneRecords] = useState<Record<string, api.CfRecord[]>>({});
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [allBindings, setAllBindings] = useState<Record<string, api.DomainBinding[]>>({});
  const [pendingDelete, setPendingDelete] = useState<{
    record: api.CfRecord;
    zoneId: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [wafOn, setWafOn] = useState<boolean>(() => {
    try { return localStorage.getItem("lockethq.domains.waf") === "true"; } catch { return false; }
  });

  useEffect(() => {
    api.cfHasToken().then(setCfConnected).catch(() => setCfConnected(false));
  }, []);

  async function refreshAll() {
    try {
      const z = await api.cfListZones();
      setZones(z);
      if (z.length && !activeZoneId) setActiveZoneId(z[0].id);
      const recs: Record<string, api.CfRecord[]> = {};
      await Promise.all(
        z.map(async (zone) => {
          try {
            recs[zone.id] = await api.cfListRecords(zone.id);
          } catch {
            recs[zone.id] = [];
          }
        })
      );
      setZoneRecords(recs);
      // load all proxy bindings (per server) to enrich the subdomains table
      const bm: Record<string, api.DomainBinding[]> = {};
      await Promise.all(
        servers.map(async (s) => {
          try {
            const st = await api.proxyStatus(s.id);
            if (st.installed) {
              bm[s.id] = await api.listProxyDomains(s.id);
            } else {
              bm[s.id] = [];
            }
          } catch {
            bm[s.id] = [];
          }
        })
      );
      setAllBindings(bm);
    } catch (e: any) {
      setZonesErr(String(e));
    }
  }

  useEffect(() => {
    if (!cfConnected) return;
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfConnected, servers.length]);

  const zoneRows = useMemo<ZoneRow[]>(() => {
    return zones.map((z, i) => {
      const records = zoneRecords[z.id] || [];
      const subdomains = records.filter((r) => r.type === "A" || r.type === "CNAME");
      const sublabel = i === 0 ? "auto-subdomains" : i === 1 ? "marketing & root" : "storefront";
      return { ...z, recordCount: subdomains.length, sublabel };
    });
  }, [zones, zoneRecords]);

  const totalRecords = zoneRows.reduce((a, z) => a + z.recordCount, 0);

  // Find binding for a given hostname (across all servers)
  function findBinding(host: string): { binding: api.DomainBinding; server: ServerRecord } | null {
    for (const s of servers) {
      const list = allBindings[s.id] || [];
      const b = list.find((x) => x.host === host);
      if (b) return { binding: b, server: s };
    }
    return null;
  }

  function toggleWaf() {
    const next = !wafOn;
    setWafOn(next);
    try {
      if (next) localStorage.setItem("lockethq.domains.waf", "true");
      else localStorage.removeItem("lockethq.domains.waf");
    } catch { /* ignore */ }
  }

  async function deleteRow() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    try {
      const { record, zoneId } = pendingDelete;
      // delete CF record
      try { await api.cfDeleteRecord(zoneId, record.id); } catch { /* ignore */ }
      // remove proxy domain across servers
      const hit = findBinding(record.name);
      if (hit) {
        try { await api.removeProxyDomain(hit.server.id, record.name); } catch { /* ignore */ }
      }
      showToast(`${record.name} removed`);
      setPendingDelete(null);
      await refreshAll();
    } catch (e: any) {
      showToast(String(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  if (cfConnected === null) {
    return (
      <div className="lhq-main">
        <LhqTopbar breadcrumb={["Resources", "Domains"]} />
        <div className="lhq-content">Loading…</div>
      </div>
    );
  }

  if (!cfConnected) {
    return (
      <div className="lhq-main">
        <LhqTopbar breadcrumb={["Resources", "Domains"]} />
        <div className="lhq-content" style={{ maxWidth: 720 }}>
          <div className="lhq-card">
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <CfLogo size={36} radius={9} iconSize={18} />
              <div>
                <div className="lhq-h3" style={{ fontSize: 16 }}>Connect Cloudflare</div>
                <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--mono)" }}>
                  required for automatic DNS provisioning
                </div>
              </div>
            </div>
            <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55 }}>
              Add a Cloudflare API token in Preferences so DockPilot can create DNS records when
              you attach a domain to a container. Token needs{" "}
              <span className="mono">Zone:DNS:Edit</span> on the zones you want to manage.
            </p>
            <Btn variant="primary" style={{ marginTop: 12 }} onClick={() => navigate({ kind: "settings" })}>
              Open Preferences
            </Btn>
          </div>
        </div>
      </div>
    );
  }

  const firstZone = zones[0];
  const exampleZone = firstZone?.name || "example.com";
  const activeZone = zones.find((z) => z.id === activeZoneId) || zones[0];
  const activeRecords = activeZone ? zoneRecords[activeZone.id] || [] : [];
  const subdomainRecords = activeRecords.filter(
    (r) => (r.type === "A" || r.type === "CNAME") && (!filter || r.name.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <div className="lhq-main">
      <LhqTopbar
        breadcrumb={["Resources", "Domains"]}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Btn icon={IconRefresh} variant="ghost" onClick={() => refreshAll()} />
            <Btn variant="primary" icon={IconPlus} onClick={() => setAddOpen(true)} disabled={zones.length === 0}>
              Add domain
            </Btn>
          </div>
        }
      />
      <div className="lhq-content">
        {zonesErr && (
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              border: "1px solid color-mix(in oklch, var(--danger) 30%, transparent)",
              background: "var(--danger-tint)",
              color: "oklch(0.42 0.12 25)",
              borderRadius: 8,
              fontSize: 12.5,
              fontFamily: "var(--mono)",
            }}
          >
            {zonesErr}
          </div>
        )}

        {/* Cloudflare connection card */}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 14,
            background: "var(--surface)",
            overflow: "hidden",
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr",
          }}
        >
          {/* LEFT */}
          <div style={{ padding: 22 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <CfLogo />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>Cloudflare</div>
                <div
                  style={{
                    marginTop: 4,
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    color: "var(--muted)",
                  }}
                >
                  account · lockethq · token scoped to DNS:edit, Zones:read
                </div>
              </div>
              <Tag tone="accent">
                <span className="lhq-pulse" style={{ width: 6, height: 6 }} /> Connected
              </Tag>
            </div>

            <div
              style={{
                marginTop: 22,
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 14,
              }}
            >
              <CfStat label="Zones" value={zones.length} />
              <CfStat label="Records managed" value={totalRecords} />
              <CfStat label="Quota used" value={`${totalRecords} / 5000`} isText />
            </div>
          </div>

          {/* RIGHT */}
          <div
            style={{
              background: "var(--accent-tint)",
              padding: 22,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              borderLeft: "1px solid color-mix(in oklch, var(--accent) 20%, transparent)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconBolt size={14} color="var(--accent-ink)" />
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--accent-ink)" }}>
                Auto-provisioning is on
              </div>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--accent-ink)",
                lineHeight: 1.55,
                opacity: 0.85,
              }}
            >
              Every new container gets a friendly subdomain at{" "}
              <span className="mono">{"{name}"}.{exampleZone}</span> with an automatic
              Let's Encrypt cert and orange-cloud proxying.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              <CheckRow
                checked
                disabled
                label="HTTPS only · auto-redirect 80 → 443"
              />
              <CheckRow
                checked
                disabled
                label="Proxy through Cloudflare (orange cloud)"
              />
              <CheckRow
                checked={wafOn}
                onToggle={toggleWaf}
                label="Add WAF rule set · OWASP core"
              />
            </div>
          </div>
        </div>

        {/* Zones */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 24, marginBottom: 12 }}>
          <h3 className="lhq-h3">Zones</h3>
          <span style={{ fontSize: 12, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
            · {zones.length} zones · {totalRecords} records
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => showToast("Add zones from the Cloudflare dashboard")}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--accent-ink)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "default",
              padding: 0,
              textUnderlineOffset: 3,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.textDecoration = "underline")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.textDecoration = "none")}
          >
            Add zone
          </button>
        </div>

        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 14,
            background: "var(--surface)",
            overflow: "hidden",
          }}
        >
          {zoneRows.length === 0 && (
            <div style={{ padding: 18, color: "var(--muted)", fontSize: 13 }}>
              No zones available — add a zone in the Cloudflare dashboard, then refresh.
            </div>
          )}
          {zoneRows.map((z, i) => {
            const active = z.id === activeZoneId;
            return (
              <div
                key={z.id}
                onClick={() => setActiveZoneId(z.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "16px 1.4fr auto auto auto 80px",
                  gap: 14,
                  padding: "14px 18px",
                  alignItems: "center",
                  borderBottom: i < zoneRows.length - 1 ? "1px solid var(--border)" : "none",
                  background: active ? "var(--accent-tint)" : "transparent",
                  borderLeft: active
                    ? "3px solid var(--accent)"
                    : "3px solid transparent",
                  cursor: "default",
                }}
              >
                <IconGlobe size={14} color={active ? "var(--accent-ink)" : "var(--muted)"} />
                <div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 15, fontWeight: 600 }}>{z.name}</div>
                  <div
                    style={{
                      marginTop: 2,
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      color: "var(--muted)",
                    }}
                  >
                    {z.sublabel}
                  </div>
                </div>
                <Tag>NS</Tag>
                <Tag>cloudflare</Tag>
                <Tag tone="accent">valid</Tag>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 18,
                      color: "var(--ink)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {z.recordCount}
                  </span>
                  {i === 0 ? (
                    <Tag tone="accent">default</Tag>
                  ) : (
                    <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Manage</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Subdomains */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 32, marginBottom: 12 }}>
          <h3 className="lhq-h3">Subdomains</h3>
          <span style={{ fontSize: 12, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
            · {subdomainRecords.length} active · auto-provisioned
          </span>
          <div style={{ flex: 1 }} />
          <div style={{ position: "relative" }}>
            <IconSearch
              size={13}
              color="var(--muted-2)"
              style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
            />
            <input
              className="lhq-input"
              placeholder="Filter hostnames…"
              style={{ width: 200, paddingLeft: 32, height: 34 }}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>

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
              gridTemplateColumns: "2fr 1.4fr 1.2fr 70px 70px 40px",
              gap: 12,
              padding: "11px 18px",
              background: "var(--surface-2)",
              fontSize: 10.5,
              color: "var(--muted-2)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
              fontFamily: "var(--mono)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span>Hostname</span>
            <span>Target</span>
            <span>Container</span>
            <span>Type</span>
            <span>TTL</span>
            <span />
          </div>
          {subdomainRecords.length === 0 && (
            <div style={{ padding: 18, color: "var(--muted)", fontSize: 13 }}>
              {activeZone ? `No subdomains in ${activeZone.name} yet.` : "Pick a zone above."}
            </div>
          )}
          {subdomainRecords.map((r, i) => {
            const hit = findBinding(r.name);
            const target = hit
              ? `${hit.server.host}:${hit.binding.container_port}`
              : r.content;
            const containerName = hit?.binding.container || (r.proxied ? "—" : "—");
            return (
              <SubdomainRow
                key={r.id}
                record={r}
                target={target}
                containerName={containerName}
                certValid={!!hit}
                last={i === subdomainRecords.length - 1}
                onRemove={() => activeZone && setPendingDelete({ record: r, zoneId: activeZone.id })}
              />
            );
          })}
        </div>
      </div>

      <AddDomainModal
        open={addOpen}
        zones={zones}
        servers={servers}
        onClose={() => setAddOpen(false)}
        onDone={(msg) => {
          showToast(msg);
          setAddOpen(false);
          refreshAll();
        }}
      />

      <ConfirmModal
        open={!!pendingDelete}
        title={`Remove ${pendingDelete?.record.name}?`}
        body={
          <>
            Deletes the Cloudflare DNS record and the Traefik proxy binding (if any).
            The target container is not touched.
          </>
        }
        confirmLabel="Remove domain"
        destructive
        busy={deleteBusy}
        onConfirm={deleteRow}
        onClose={() => { if (!deleteBusy) setPendingDelete(null); }}
      />
    </div>
  );
}

// ─── Subdomain row (own component for hover state) ───────────────────────

function SubdomainRow({
  record,
  target,
  containerName,
  certValid,
  last,
  onRemove,
}: {
  record: api.CfRecord;
  target: string;
  containerName: string;
  certValid: boolean;
  last: boolean;
  onRemove: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dotsRef = useRef<HTMLButtonElement | null>(null);
  const ttl = record.ttl === 1 ? "auto" : String(record.ttl);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 1.4fr 1.2fr 70px 70px 40px",
        gap: 12,
        padding: "12px 18px",
        alignItems: "center",
        borderBottom: last ? "none" : "1px solid var(--border)",
        background: hover ? "var(--surface-2)" : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <OrangeCloud size={16} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600 }}>{record.name}</div>
          <div
            style={{
              marginTop: 2,
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--muted)",
            }}
          >
            {certValid ? "cert valid · auto-renews 67 d" : "cloudflare proxied"}
          </div>
        </div>
      </div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--ink-2)" }}>{target}</div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--muted)" }}>{containerName}</div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>{record.type}</div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--muted)" }}>{ttl}</div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          ref={dotsRef}
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          aria-label="Row actions"
          style={{
            width: 24,
            height: 24,
            border: 0,
            background: "transparent",
            borderRadius: 6,
            cursor: "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted-2)",
            opacity: hover || menuOpen ? 1 : 0,
            transition: "opacity .12s",
          }}
        >
          <IconDots size={14} />
        </button>
        <Menu
          anchorRef={dotsRef}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          items={[
            {
              label: "Open in browser",
              onClick: () => { window.open(`https://${record.name}`, "_blank"); },
            },
            { label: "Edit", onClick: () => { /* future */ } },
            { label: "Remove", destructive: true, onClick: onRemove },
          ]}
        />
      </div>
    </div>
  );
}

// ─── small helpers ───────────────────────────────────────────────────────

function CfStat({ label, value, isText }: { label: string; value: number | string; isText?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          fontWeight: 500,
          color: "var(--muted-2)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div
        className="lhq-bignum"
        style={{
          fontSize: isText ? 26 : 32,
          color: "var(--ink)",
          marginTop: 6,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function CheckRow({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onToggle?: () => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 12.5,
        color: "var(--accent-ink)",
        cursor: disabled ? "default" : "default",
      }}
    >
      <CheckCircle checked={checked} disabled={disabled} onClick={disabled ? undefined : onToggle} />
      <span>{label}</span>
    </label>
  );
}

// ─── Add Domain modal ────────────────────────────────────────────────────

type ContainerOption = {
  container: ContainerSummary;
  server: ServerRecord;
};

function AddDomainModal({
  open,
  zones,
  servers,
  onClose,
  onDone,
}: {
  open: boolean;
  zones: api.CfZone[];
  servers: ServerRecord[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [zoneId, setZoneId] = useState(zones[0]?.id || "");
  const [hostname, setHostname] = useState("");
  const [containerOpts, setContainerOpts] = useState<ContainerOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [containerPort, setContainerPort] = useState<number>(80);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (zones[0] && !zoneId) setZoneId(zones[0].id);
  }, [zones, zoneId]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const opts: ContainerOption[] = [];
      for (const s of servers) {
        try {
          const cs = await api.listContainers(s.id);
          for (const c of cs) opts.push({ container: c, server: s });
        } catch {
          /* skip */
        }
      }
      setContainerOpts(opts);
      if (opts[0] && !selectedKey) {
        const first = opts[0];
        setSelectedKey(`${first.server.id}|${first.container.id}`);
        const port = first.container.ports.find((p) => p.container_port)?.container_port ?? 80;
        setContainerPort(port);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const zone = useMemo(() => zones.find((z) => z.id === zoneId), [zones, zoneId]);
  const fqdn = hostname && zone ? `${hostname}.${zone.name}` : "";

  const selected = useMemo(() => {
    if (!selectedKey) return null;
    return containerOpts.find((o) => `${o.server.id}|${o.container.id}` === selectedKey) || null;
  }, [containerOpts, selectedKey]);

  function pickContainer(o: ContainerOption) {
    setSelectedKey(`${o.server.id}|${o.container.id}`);
    const port = o.container.ports.find((p) => p.container_port)?.container_port ?? 80;
    setContainerPort(port);
    setPickerOpen(false);
  }

  async function submit() {
    if (!zone) { setErr("Pick a zone"); return; }
    if (!hostname) { setErr("Enter a hostname"); return; }
    if (!selected) { setErr("Pick a container"); return; }
    setBusy(true);
    setErr(null);
    try {
      // 1) Cloudflare A record → server.host
      await api.cfCreateRecord(zone.id, fqdn, selected.server.host, true);
      // 2) Traefik proxy domain
      await api.addProxyDomain(selected.server.id, fqdn, selected.container.name, containerPort);
      onDone(`${fqdn} attached`);
      // reset
      setHostname("");
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="lhq-modal-back" onClick={onClose}>
      <div
        className="lhq-modal"
        style={{ width: 580, padding: 28, maxWidth: 580, borderRadius: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 22 }}>
          <CfLogo />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
              Provision a new domain
            </div>
            <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
              Cloudflare creates the DNS record and Let's Encrypt issues a cert.
            </div>
          </div>
        </div>

        {/* Hostname + zone */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
          <div>
            <span className="lhq-label">Hostname</span>
            <div style={{ position: "relative" }}>
              <span
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--muted)",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  padding: "2px 6px",
                }}
              >
                https://
              </span>
              <input
                className="lhq-input"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="checkout"
                style={{ paddingLeft: 76, fontFamily: "var(--mono)" }}
              />
            </div>
          </div>
          <div>
            <span className="lhq-label">Zone</span>
            <div style={{ position: "relative" }}>
              <select
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
                className="lhq-input"
                style={{ paddingLeft: 10, fontFamily: "var(--mono)", appearance: "none", paddingRight: 28 }}
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>.{z.name}</option>
                ))}
              </select>
              <IconChevD
                size={13}
                color="var(--muted-2)"
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
              />
            </div>
          </div>
        </div>

        {/* Routes to */}
        <div style={{ marginBottom: 18 }}>
          <span className="lhq-label">Routes to</span>
          <button
            onClick={() => setPickerOpen((o) => !o)}
            disabled={containerOpts.length === 0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              width: "100%",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--surface)",
              cursor: "default",
              textAlign: "left",
            }}
          >
            <span className="lhq-pulse" style={{ width: 8, height: 8 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {selected ? (
                <>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 14, fontWeight: 600 }}>
                    {selected.container.name}
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                    {selected.server.name} · :{containerPort}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  {containerOpts.length === 0 ? "No containers found" : "Pick a container"}
                </div>
              )}
            </div>
            <Tag tone="accent">Container</Tag>
            <IconChevD size={14} color="var(--muted)" />
          </button>

          {pickerOpen && (
            <div
              style={{
                marginTop: 6,
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--surface)",
                boxShadow: "var(--shadow-md)",
                maxHeight: 240,
                overflowY: "auto",
              }}
            >
              {servers.map((s) => {
                const list = containerOpts.filter((o) => o.server.id === s.id);
                if (list.length === 0) return null;
                return (
                  <div key={s.id}>
                    <div
                      style={{
                        padding: "8px 14px",
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "var(--muted-2)",
                        fontFamily: "var(--mono)",
                        background: "var(--surface-2)",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      {s.name} · {s.host}
                    </div>
                    {list.map((o) => {
                      const key = `${o.server.id}|${o.container.id}`;
                      const active = key === selectedKey;
                      return (
                        <button
                          key={key}
                          onClick={() => pickContainer(o)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 14px",
                            width: "100%",
                            border: 0,
                            background: active ? "var(--accent-tint)" : "transparent",
                            cursor: "default",
                            textAlign: "left",
                            borderBottom: "1px solid var(--border)",
                          }}
                          onMouseEnter={(e) => {
                            if (!active) (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-2)";
                          }}
                          onMouseLeave={(e) => {
                            if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                          }}
                        >
                          <span
                            className={`lhq-pulse${o.container.status === "running" ? "" : " idle"}`}
                            style={{ width: 7, height: 7 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 500 }}>
                              {o.container.name}
                            </div>
                            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted-2)" }}>
                              {o.container.image}
                            </div>
                          </div>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted)" }}>
                            :{o.container.ports.find((p) => p.container_port)?.container_port ?? 80}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* We'll create */}
        <div
          style={{
            background: "var(--accent-tint)",
            border: "1px solid color-mix(in oklch, var(--accent) 30%, transparent)",
            borderRadius: 8,
            padding: 14,
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--accent-ink)", marginBottom: 10 }}>
            We'll create:
          </div>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontFamily: "var(--mono)",
              fontSize: 12.5,
              color: "var(--accent-ink)",
            }}
          >
            <li style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconCheck size={12} color="var(--accent-ink)" />
              A · {fqdn || "{hostname}.{zone}"} → {selected ? selected.server.host : "{server}"}
            </li>
            <li style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconCheck size={12} color="var(--accent-ink)" />
              Cloudflare proxy · orange cloud · WAF off
            </li>
            <li style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconCheck size={12} color="var(--accent-ink)" />
              Let's Encrypt cert · auto-renew
            </li>
            <li style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconCheck size={12} color="var(--accent-ink)" />
              HTTP → HTTPS redirect at the edge
            </li>
          </ul>
        </div>

        {err && (
          <div
            style={{
              marginBottom: 12,
              padding: 10,
              border: "1px solid color-mix(in oklch, var(--danger) 30%, transparent)",
              background: "var(--danger-tint)",
              color: "oklch(0.42 0.12 25)",
              borderRadius: 8,
              fontSize: 12,
              fontFamily: "var(--mono)",
              whiteSpace: "pre-wrap",
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted)" }}>
            Estimated time · ~24 s
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
            <Btn
              variant="primary"
              onClick={submit}
              disabled={busy || !hostname || !zoneId || !selected}
            >
              {busy ? "Provisioning…" : "Provision domain"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
