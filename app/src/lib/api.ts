// Tauri invoke wrappers + streaming helpers.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ContainerDetail,
  ContainerStats,
  ContainerSummary,
  CreateContainerRequest,
  EnvVar,
  ImageSummary,
  LogLine,
  NetworkSummary,
  ServerRecord,
  SystemInfo,
  SystemStats,
  VolumeSummary,
} from "./types";

// ─── Server registry ─────────────────────────────────────────────────────

export const listServers = () => invoke<ServerRecord[]>("list_servers");

export type SshAuthInput =
  | { mode: "key"; privateKeyPath: string; passphrase?: string }
  | { mode: "password"; password: string };

export const addServer = (args: {
  name: string;
  host: string;
  sshPort?: number;
  sshUser: string;
  auth: SshAuthInput;
  region?: string;
  provider?: string;
  flag?: string;
  installDocker?: boolean;
}) =>
  invoke<ServerRecord>("add_server", {
    args: {
      name: args.name,
      host: args.host,
      ssh_port: args.sshPort ?? 22,
      ssh_user: args.sshUser,
      auth_mode: args.auth.mode,
      private_key_path: args.auth.mode === "key" ? args.auth.privateKeyPath : null,
      passphrase: args.auth.mode === "key" ? args.auth.passphrase ?? null : null,
      password: args.auth.mode === "password" ? args.auth.password : null,
      region: args.region ?? null,
      provider: args.provider ?? null,
      flag: args.flag ?? null,
      install_docker: args.installDocker ?? false,
    },
  });

export const removeServer = (id: string) => invoke<void>("remove_server", { id });

export const testSsh = (args: {
  host: string;
  sshPort?: number;
  sshUser: string;
  auth: SshAuthInput;
}) =>
  invoke<string>("test_ssh", {
    args: {
      host: args.host,
      ssh_port: args.sshPort ?? 22,
      ssh_user: args.sshUser,
      auth_mode: args.auth.mode,
      private_key_path: args.auth.mode === "key" ? args.auth.privateKeyPath : null,
      passphrase: args.auth.mode === "key" ? args.auth.passphrase ?? null : null,
      password: args.auth.mode === "password" ? args.auth.password : null,
    },
  });

// ─── Runner proxy ─────────────────────────────────────────────────────────

const runnerGet = <T,>(serverId: string, path: string) =>
  invoke<T>("runner_get", { serverId, path });

const runnerPost = <T,>(serverId: string, path: string, body: unknown = {}) =>
  invoke<T>("runner_post", { serverId, path, body });

export const getInfo = (id: string) => runnerGet<SystemInfo>(id, "/v1/info");
export const getStats = (id: string) => runnerGet<SystemStats>(id, "/v1/stats");

export const listContainers = (id: string) =>
  runnerGet<ContainerSummary[]>(id, "/v1/containers");

export const getContainer = (id: string, cid: string) =>
  runnerGet<ContainerDetail>(id, `/v1/containers/${cid}`);

export const startContainer = (id: string, cid: string) =>
  runnerPost<{ ok: boolean }>(id, `/v1/containers/${cid}/start`);

export const stopContainer = (id: string, cid: string) =>
  runnerPost<{ ok: boolean }>(id, `/v1/containers/${cid}/stop`);

export const restartContainer = (id: string, cid: string) =>
  runnerPost<{ ok: boolean }>(id, `/v1/containers/${cid}/restart`);

export const composeAction = (
  serverId: string,
  project: string,
  action: "restart" | "stop" | "start" | "down"
) => runnerPost<{ ok: boolean; output: string }>(serverId, `/v1/compose/${encodeURIComponent(project)}/${action}`);

export const removeContainer = (id: string, cid: string) =>
  invoke<{ ok: boolean }>("runner_delete", { serverId: id, path: `/v1/containers/${cid}?force=true` });

export const createContainer = (id: string, req: CreateContainerRequest) =>
  runnerPost<{ id: string }>(id, "/v1/containers", req);

export const createContainerFromUpload = (
  id: string,
  req: CreateContainerRequest,
  tarballB64: string
) =>
  runnerPost<{ id: string }>(id, "/v1/containers/from-upload", {
    spec: req,
    tarball_b64: tarballB64,
  });

export const createContainerFromCompose = (
  id: string,
  name: string,
  yaml: string,
  env: Record<string, string> = {}
) =>
  runnerPost<{ ids: string[] }>(id, "/v1/containers/from-compose", { name, yaml, env });

/// Streaming variant of createContainerFromCompose. Returns the stream_id;
/// caller listens to "runner_stream" Tauri events filtered by stream_id and
/// "runner_stream_end" / "runner_stream_error".
export async function streamComposeUp(
  serverId: string,
  name: string,
  yaml: string,
  env: Record<string, string>,
  onLine: (line: any) => void,
  onError?: (msg: string) => void,
  onEnd?: () => void
): Promise<{ streamId: string; cancel: () => Promise<void> }> {
  const streamId = `deploy-${Math.random().toString(36).slice(2, 10)}`;
  const unlistens: UnlistenFn[] = [];
  unlistens.push(
    await listen<{ stream_id: string; line: any }>("runner_stream", (e) => {
      if (e.payload.stream_id === streamId) onLine(e.payload.line);
    })
  );
  unlistens.push(
    await listen<string>("runner_stream_end", (e) => {
      if (e.payload === streamId) onEnd?.();
    })
  );
  unlistens.push(
    await listen<string>("runner_stream_error", (e) => {
      if (typeof e.payload === "string" && e.payload.startsWith(streamId)) onError?.(e.payload);
    })
  );
  await invoke("runner_stream_post", {
    serverId,
    path: "/v1/containers/from-compose/stream",
    body: { name, yaml, env },
    streamId,
  });
  return {
    streamId,
    cancel: async () => {
      for (const u of unlistens) u();
      await invoke("cancel_stream", { streamId }).catch(() => {});
    },
  };
}

export const recreateContainerEnv = (id: string, containerId: string, env: EnvVar[]) =>
  runnerPost<{ id: string }>(id, `/v1/containers/${containerId}/recreate-env`, { env });

// ─── Database editor ─────────────────────────────────────────────────────

export type DbEngine = "postgres" | "mysql" | "mariadb";

export interface DbInfo {
  engine: DbEngine;
  version: string | null;
  default_db: string;
  default_user: string;
  databases: { name: string; size_bytes: number | null }[];
}

export interface DbTable {
  schema: string;
  name: string;
  rows: number;
  size_bytes: number;
}

export interface DbQueryResult {
  columns: string[];
  rows: (string | null)[][];
  elapsed_ms: number;
  row_count: number;
  truncated: boolean;
  command: string | null;
}

export const dbInfo = (serverId: string, containerId: string) =>
  runnerGet<DbInfo>(serverId, `/v1/containers/${containerId}/db/info`);

export const dbTables = (serverId: string, containerId: string, db: string) =>
  runnerGet<DbTable[]>(serverId, `/v1/containers/${containerId}/db/tables?db=${encodeURIComponent(db)}`);

export const dbQuery = (
  serverId: string,
  containerId: string,
  args: { db: string; sql: string; limit?: number }
) =>
  runnerPost<DbQueryResult>(serverId, `/v1/containers/${containerId}/db/query`, args);

export type FsView =
  | { kind: "dir"; path: string; entries: FsEntry[]; root: string; read_only: boolean }
  | { kind: "file"; path: string; content: string; size: number; read_only: boolean; truncated: boolean };

export interface FsEntry {
  name: string;
  kind: "file" | "dir" | "link" | "other";
  size: number | null;
  modified: number | null;
  read_only_view: boolean;
}

export const fsRead = (id: string, containerId: string, path: string) =>
  invoke<FsView>("runner_get", {
    serverId: id,
    path: `/v1/containers/${containerId}/fs?path=${encodeURIComponent(path)}`,
  });

export const fsWrite = (id: string, containerId: string, path: string, content: string) =>
  runnerPost<{ ok: boolean }>(id, `/v1/containers/${containerId}/fs?path=${encodeURIComponent(path)}`, { content });

export const listImages = (id: string) => runnerGet<ImageSummary[]>(id, "/v1/images");
export const listVolumes = (id: string) => runnerGet<VolumeSummary[]>(id, "/v1/volumes");
export const listNetworks = (id: string) => runnerGet<NetworkSummary[]>(id, "/v1/networks");

export const pullImage = (id: string, image: string) =>
  runnerPost<unknown>(id, "/v1/images/pull", { image });

// Server-level SSH actions

export const restartDocker = (serverId: string) =>
  invoke<string>("restart_docker", { serverId });

export const restartRunner = (serverId: string) =>
  invoke<string>("restart_runner", { serverId });

export const updateRunner = (serverId: string) =>
  invoke<string>("update_runner_binary", { serverId });

export const uninstallRunner = (serverId: string) =>
  invoke<string>("uninstall_runner", { serverId });

export const fetchRunnerLogs = (serverId: string, lines = 200) =>
  invoke<string>("fetch_runner_logs", { args: { server_id: serverId, lines } });

export const generateSshKey = (path: string, passphrase?: string) =>
  invoke<string>("generate_ssh_key", { args: { path, passphrase: passphrase ?? null } });

export interface SshKeyEntry { path: string; kind: string }
export const listSshKeys = () => invoke<SshKeyEntry[]>("list_ssh_keys");

// ─── Proxy (Traefik) ─────────────────────────────────────────────────────

export interface ProxyStatus {
  installed: boolean;
  running: boolean;
  network: string;
  container_id: string | null;
  acme_email: string | null;
}

export const proxyStatus = (serverId: string) =>
  invoke<ProxyStatus>("runner_get", { serverId, path: "/v1/proxy/status" });

export const proxySetup = (serverId: string, acmeEmail: string) =>
  invoke<ProxyStatus>("runner_post", {
    serverId,
    path: "/v1/proxy/setup",
    body: { acme_email: acmeEmail },
  });

export interface DomainBinding {
  host: string;
  container: string;
  container_port: number;
  config_path: string;
}

export const listProxyDomains = (serverId: string) =>
  invoke<DomainBinding[]>("runner_get", { serverId, path: "/v1/proxy/domains" });

export const addProxyDomain = (
  serverId: string,
  host: string,
  container: string,
  containerPort: number
) =>
  invoke<DomainBinding>("runner_post", {
    serverId,
    path: "/v1/proxy/domains",
    body: { host, container, container_port: containerPort },
  });

export const removeProxyDomain = (serverId: string, host: string) =>
  invoke<{ ok: boolean }>("runner_delete", {
    serverId,
    path: `/v1/proxy/domains/${encodeURIComponent(host)}`,
  });

// ─── Docker Hub (proxied through Tauri for CORS) ─────────────────────────

export interface DhSearchResult {
  repo_name: string;
  repo_owner: string;
  short_description?: string;
  star_count?: number;
  pull_count?: number;
  is_official?: boolean;
}
export interface DhImageInfo {
  namespace: string;
  name: string;
  info: any | null;
  tag: any | null;
}

export const dockerhubSearch = (query: string) =>
  invoke<{ results: DhSearchResult[]; count?: number }>("dockerhub_search", { query });

export const dockerhubImageInfo = (image: string) =>
  invoke<DhImageInfo>("dockerhub_image_info", { image });

// ─── Cloudflare ──────────────────────────────────────────────────────────

export interface CfZone { id: string; name: string; status: string }
export interface CfRecord { id: string; type: string; name: string; content: string; proxied: boolean; ttl: number }

export const cfSaveToken = (token: string | null) =>
  invoke<boolean>("cf_save_token", { args: { token } });
export const cfHasToken = () => invoke<boolean>("cf_has_token");
export const cfListZones = () => invoke<CfZone[]>("cf_list_zones");
export const cfListRecords = (zoneId: string) =>
  invoke<CfRecord[]>("cf_list_records", { zoneId });
export const cfCreateRecord = (
  zoneId: string,
  name: string,
  content: string,
  proxied = true
) =>
  invoke<CfRecord>("cf_create_record", {
    args: { zone_id: zoneId, name, content, proxied },
  });
export const cfDeleteRecord = (zoneId: string, recordId: string) =>
  invoke<void>("cf_delete_record", { args: { zone_id: zoneId, record_id: recordId } });

// ─── Streams ─────────────────────────────────────────────────────────────

type StreamMsg<T> = { stream_id: string; line: T };

function rand() { return Math.random().toString(36).slice(2, 10); }

export async function streamLogs(
  serverId: string,
  containerId: string,
  onLine: (line: LogLine) => void,
  onError?: (msg: string) => void
): Promise<() => Promise<void>> {
  const streamId = `logs-${rand()}`;
  const unlistens: UnlistenFn[] = [];
  unlistens.push(
    await listen<StreamMsg<LogLine>>("runner_stream", (e) => {
      if (e.payload.stream_id === streamId) onLine(e.payload.line);
    })
  );
  unlistens.push(
    await listen<string>("runner_stream_error", (e) => {
      if (typeof e.payload === "string" && e.payload.startsWith(streamId) && onError) {
        onError(e.payload);
      }
    })
  );
  await invoke("runner_stream_logs", { serverId, containerId, streamId });
  return async () => {
    for (const u of unlistens) u();
    await invoke("cancel_stream", { streamId }).catch(() => {});
  };
}

export async function streamStats(
  serverId: string,
  containerId: string | null,
  onLine: (stats: ContainerStats | SystemStats) => void
): Promise<() => Promise<void>> {
  const streamId = `stats-${rand()}`;
  const unlisten = await listen<StreamMsg<ContainerStats | SystemStats>>(
    "runner_stream",
    (e) => {
      if (e.payload.stream_id === streamId) onLine(e.payload.line);
    }
  );
  await invoke("runner_stream_stats", { serverId, containerId, streamId });
  return async () => {
    unlisten();
    await invoke("cancel_stream", { streamId }).catch(() => {});
  };
}
