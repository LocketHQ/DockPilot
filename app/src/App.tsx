import { useCallback, useEffect, useMemo, useState } from "react";
import { AppCtx, type Route } from "./state";
import type { ServerRecord } from "./lib/types";
import * as api from "./lib/api";

import { LhqSidebar, type NavId } from "./components/Shell";
import { SignInScreen, SignUpScreen } from "./screens/Auth";
import { OnboardingScreen } from "./screens/Onboarding";
import { ServersListScreen, ServerOverviewScreen } from "./screens/Servers";
import { ContainersListScreen, ContainerDetailScreen, StackDetailScreen } from "./screens/Containers";
import { WizardScreen } from "./screens/Wizard";
import { MonitoringScreen } from "./screens/Monitoring";
import { ResourcesScreen } from "./screens/Resources";
import { SettingsScreen } from "./screens/Settings";
import { DomainsScreen } from "./screens/Domains";
import { CommandPaletteOverlay } from "./screens/Palette";

const PROFILE_KEY = "lockethq.profile";

export default function App() {
  const [route, setRoute] = useState<Route>(() => {
    const p = localStorage.getItem(PROFILE_KEY);
    return p ? { kind: "servers" } : { kind: "auth", mode: "signin" };
  });
  const [signedIn, setSignedIn] = useState<boolean>(!!localStorage.getItem(PROFILE_KEY));
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const refreshServers = useCallback(async () => {
    try {
      const s = await api.listServers();
      setServers(s);
    } catch (e) {
      console.warn("listServers failed", e);
    }
  }, []);

  useEffect(() => {
    if (signedIn) refreshServers();
  }, [signedIn, refreshServers]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((p) => !p);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctx = useMemo(
    () => ({
      route,
      navigate: setRoute,
      servers,
      refreshServers,
      signedIn,
      signIn: (email: string) => {
        localStorage.setItem(PROFILE_KEY, JSON.stringify({ email }));
        setSignedIn(true);
        // Send the user to onboarding if there are no servers, else fleet.
        api
          .listServers()
          .then((s) => {
            setServers(s);
            setRoute(s.length === 0 ? { kind: "onboarding" } : { kind: "servers" });
          })
          .catch(() => setRoute({ kind: "onboarding" }));
      },
      signOut: () => {
        localStorage.removeItem(PROFILE_KEY);
        setSignedIn(false);
        setRoute({ kind: "auth", mode: "signin" });
      },
      showToast: (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 2400);
      },
    }),
    [route, servers, signedIn, refreshServers]
  );

  // map NavId → route
  const onNavigate = (id: NavId) => {
    const map: Record<NavId, Route> = {
      servers: { kind: "servers" },
      containers: { kind: "containers" },
      monitor: { kind: "monitor" },
      volumes: { kind: "volumes" },
      networks: { kind: "networks" },
      domains: { kind: "domains" },
      keys: { kind: "keys" },
      settings: { kind: "settings" },
    };
    setRoute(map[id]);
  };

  const activeNav: NavId = (() => {
    switch (route.kind) {
      case "servers":
      case "server":
        return "servers";
      case "containers":
      case "container":
      case "stack":
      case "wizard":
        return "containers";
      case "monitor":
        return "monitor";
      case "volumes":
        return "volumes";
      case "networks":
        return "networks";
      case "registries":
        return "volumes";
      case "secrets":
        return "volumes";
      case "domains":
        return "domains";
      case "keys":
        return "keys";
      case "settings":
        return "settings";
      default:
        return "servers";
    }
  })();

  // Auth + onboarding render without the sidebar chrome.
  if (!signedIn || route.kind === "auth") {
    return (
      <AppCtx.Provider value={ctx}>
        <div className="lhq-root">
          <div className="lhq-titlebar-pad" />
          {route.kind === "auth" && route.mode === "signup" ? <SignUpScreen /> : <SignInScreen />}
        </div>
      </AppCtx.Provider>
    );
  }

  if (route.kind === "onboarding") {
    return (
      <AppCtx.Provider value={ctx}>
        <div className="lhq-root">
          <div className="lhq-titlebar-pad" />
          <OnboardingScreen />
        </div>
      </AppCtx.Provider>
    );
  }

  return (
    <AppCtx.Provider value={ctx}>
      <div className="lhq-root">
        <div className="lhq-titlebar-pad" />
        <div className="lhq-app">
          <LhqSidebar
            active={activeNav}
            onNavigate={onNavigate}
            serverCount={servers.length}
          />
          <Routed route={route} />
        </div>
        {paletteOpen && <CommandPaletteOverlay onClose={() => setPaletteOpen(false)} />}
        {toast && <div className="lhq-toast">{toast}</div>}
      </div>
    </AppCtx.Provider>
  );
}

function Routed({ route }: { route: Route }) {
  switch (route.kind) {
    case "servers":      return <ServersListScreen />;
    case "server":       return <ServerOverviewScreen serverId={route.id} />;
    case "containers":   return <ContainersListScreen />;
    case "container":    return <ContainerDetailScreen serverId={route.serverId} containerId={route.containerId} />;
    case "stack":        return <StackDetailScreen serverId={route.serverId} project={route.project} />;
    case "wizard":       return <WizardScreen step={route.step} />;
    case "monitor":      return <MonitoringScreen />;
    case "volumes":      return <ResourcesScreen tab="volumes" />;
    case "networks":     return <ResourcesScreen tab="networks" />;
    case "registries":   return <ResourcesScreen tab="registries" />;
    case "secrets":      return <ResourcesScreen tab="secrets" />;
    case "domains":      return <DomainsScreen />;
    case "keys":         return <SettingsScreen tab="keys" />;
    case "settings":     return <SettingsScreen tab="prefs" />;
    default:             return <ServersListScreen />;
  }
}
