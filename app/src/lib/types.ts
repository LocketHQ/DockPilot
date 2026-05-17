// Shared types — mirrors the Rust types in shared/src/lib.rs.

export interface ServerRecord {
  id: string;
  name: string;
  host: string;
  ssh_user: string;
  ssh_port: number;
  region: string | null;
  provider: string | null;
  flag: string | null;
  runner_port: number;
  created_at: number;
}

export interface SystemInfo {
  hostname: string;
  os: string;
  kernel: string;
  docker_version: string;
  cpu_cores: number;
  memory_total_mb: number;
  disk_total_gb: number;
  uptime_seconds: number;
}

export interface SystemStats {
  cpu_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_used_gb: number;
  disk_total_gb: number;
  net_rx_bytes_per_sec: number;
  net_tx_bytes_per_sec: number;
}

export type ContainerStatus =
  | "running"
  | "restarting"
  | "stopped"
  | "exited"
  | "paused"
  | "dead"
  | "created";

export interface PortMapping {
  container_port: number;
  host_port: number | null;
  protocol: string;
  public: boolean;
}

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  state: string;
  created: number;
  ports: PortMapping[];
  uptime_seconds: number | null;
  labels: Record<string, string>;
}

export interface EnvVar {
  key: string;
  value: string;
  secret: boolean;
}

export interface Mount {
  source: string;
  destination: string;
  read_only: boolean;
  kind: string;
}

export interface ContainerDetail extends ContainerSummary {
  env: EnvVar[];
  mounts: Mount[];
  networks: string[];
  restart_policy: string;
  digest: string | null;
  command: string | null;
}

export interface ContainerStats {
  id: string;
  cpu_percent: number;
  memory_used_mb: number;
  memory_limit_mb: number;
  net_rx_bytes_per_sec: number;
  net_tx_bytes_per_sec: number;
  block_read_bytes_per_sec: number;
  block_write_bytes_per_sec: number;
}

export interface VolumeSummary {
  name: string;
  driver: string;
  mountpoint: string;
  created: number;
  size_bytes: number | null;
  in_use_by: string[];
}

export interface NetworkSummary {
  id: string;
  name: string;
  driver: string;
  scope: string;
  subnet: string | null;
  containers_attached: number;
}

export interface ImageSummary {
  id: string;
  repo_tags: string[];
  size_bytes: number;
  created: number;
}

export type ContainerSource =
  | { type: "image"; image: string }
  | { type: "github"; repo: string; branch: string; dockerfile_path?: string }
  | { type: "upload"; archive_path: string; dockerfile_path?: string }
  | { type: "compose"; yaml: string };

export interface CreateContainerRequest {
  name: string;
  source: ContainerSource;
  env: EnvVar[];
  ports: PortMapping[];
  mounts: Mount[];
  restart_policy: string;
  command: string | null;
  network: string | null;
  resources: { cpu_shares: number | null; memory_mb: number | null } | null;
}

export interface LogLine {
  timestamp: number;
  stream: "stdout" | "stderr";
  message: string;
}
