//! Types shared between the DockPilot desktop app and the DockPilot Runner agent.

use serde::{Deserialize, Serialize};

/// System information reported by the runner.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub hostname: String,
    pub os: String,
    pub kernel: String,
    pub docker_version: String,
    pub cpu_cores: u32,
    pub memory_total_mb: u64,
    pub disk_total_gb: u64,
    pub uptime_seconds: u64,
}

/// Live system stats. Streamed continuously from the runner.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStats {
    pub cpu_percent: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub disk_used_gb: u64,
    pub disk_total_gb: u64,
    pub net_rx_bytes_per_sec: u64,
    pub net_tx_bytes_per_sec: u64,
}

/// Container summary as returned by GET /v1/containers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerSummary {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: ContainerStatus,
    pub state: String,
    pub created: i64,
    pub ports: Vec<PortMapping>,
    pub uptime_seconds: Option<u64>,
    #[serde(default)]
    pub labels: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContainerStatus {
    Running,
    Restarting,
    Stopped,
    Exited,
    Paused,
    Dead,
    Created,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortMapping {
    pub container_port: u16,
    pub host_port: Option<u16>,
    pub protocol: String,
    pub public: bool,
}

/// Detailed container view (for the container detail screen).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerDetail {
    #[serde(flatten)]
    pub summary: ContainerSummary,
    pub env: Vec<EnvVar>,
    pub mounts: Vec<Mount>,
    pub networks: Vec<String>,
    pub restart_policy: String,
    pub digest: Option<String>,
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
    pub secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mount {
    pub source: String,
    pub destination: String,
    pub read_only: bool,
    pub kind: String, // volume | bind | tmpfs
}

/// Container live stats — streamed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerStats {
    pub id: String,
    pub cpu_percent: f32,
    pub memory_used_mb: u64,
    pub memory_limit_mb: u64,
    pub net_rx_bytes_per_sec: u64,
    pub net_tx_bytes_per_sec: u64,
    pub block_read_bytes_per_sec: u64,
    pub block_write_bytes_per_sec: u64,
}

/// Volume summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeSummary {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub created: i64,
    pub size_bytes: Option<u64>,
    pub in_use_by: Vec<String>,
}

/// Network summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkSummary {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    pub subnet: Option<String>,
    pub containers_attached: u32,
}

/// Image summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSummary {
    pub id: String,
    pub repo_tags: Vec<String>,
    pub size_bytes: u64,
    pub created: i64,
}

/// Request to create a new container (the wizard payload).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateContainerRequest {
    pub name: String,
    pub source: ContainerSource,
    pub env: Vec<EnvVar>,
    pub ports: Vec<PortMapping>,
    pub mounts: Vec<Mount>,
    pub restart_policy: String, // no | always | unless-stopped | on-failure
    pub command: Option<String>,
    pub network: Option<String>,
    pub resources: Option<ResourceLimits>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContainerSource {
    Image { image: String },
    Github { repo: String, branch: String, dockerfile_path: Option<String> },
    Upload { archive_path: String, dockerfile_path: Option<String> },
    Compose { yaml: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    pub cpu_shares: Option<i64>,
    pub memory_mb: Option<u64>,
}

/// Log line streamed from the runner.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogLine {
    pub timestamp: i64,
    pub stream: LogStream,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

/// Server record stored locally in the desktop app.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerRecord {
    pub id: String,
    pub name: String,
    pub host: String,
    pub ssh_user: String,
    pub ssh_port: u16,
    pub region: Option<String>,
    pub provider: Option<String>,
    pub flag: Option<String>,
    pub runner_port: u16,
    pub created_at: i64,
}
