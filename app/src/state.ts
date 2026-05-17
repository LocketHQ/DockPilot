// App-wide state: auth status, server list, current route.

import { createContext, useContext } from "react";
import type { ServerRecord } from "./lib/types";

export type Route =
  | { kind: "auth"; mode: "signin" | "signup" }
  | { kind: "onboarding" }
  | { kind: "servers" }
  | { kind: "server"; id: string }
  | { kind: "containers" }
  | { kind: "container"; serverId: string; containerId: string }
  | { kind: "stack"; serverId: string; project: string }
  | { kind: "wizard"; step?: number }
  | { kind: "monitor" }
  | { kind: "volumes" }
  | { kind: "networks" }
  | { kind: "registries" }
  | { kind: "secrets" }
  | { kind: "domains" }
  | { kind: "keys" }
  | { kind: "settings" }
  | { kind: "palette" };

export interface AppCtxValue {
  route: Route;
  navigate: (r: Route) => void;
  servers: ServerRecord[];
  refreshServers: () => Promise<void>;
  signedIn: boolean;
  signIn: (email: string) => void;
  signOut: () => void;
  showToast: (msg: string) => void;
}

export const AppCtx = createContext<AppCtxValue | null>(null);

export function useApp(): AppCtxValue {
  const v = useContext(AppCtx);
  if (!v) throw new Error("AppCtx not mounted");
  return v;
}
