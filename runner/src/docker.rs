//! Thin wrapper around `bollard` shaped to DockPilot's shared types.

use anyhow::{Context, Result};
use bollard::container::{
    Config, CreateContainerOptions, ListContainersOptions, LogsOptions,
    RemoveContainerOptions, StartContainerOptions, StatsOptions, StopContainerOptions,
};
use bollard::image::{CreateImageOptions, ListImagesOptions};
use bollard::network::ListNetworksOptions;
use bollard::volume::ListVolumesOptions;
use bollard::Docker;
use futures_util::stream::StreamExt;
use lockethq_shared::{
    ContainerDetail, ContainerSource, ContainerStats, ContainerStatus, ContainerSummary,
    CreateContainerRequest, EnvVar, ImageSummary, LogLine, LogStream, Mount, NetworkSummary,
    PortMapping, VolumeSummary,
};
use std::collections::HashMap;
use tokio::sync::mpsc;

/// Persistent root for runner-owned state. Lives under `/var/lib` (not `/tmp`)
/// so compose files, `.env` files, and other deploy artifacts survive a runner
/// restart — a private `/tmp` is wiped on every restart. Mirrors the location
/// used by the proxy module (`/var/lib/lockethq/traefik`).
pub const STATE_ROOT: &str = "/var/lib/lockethq";

/// Directory holding the compose project for `project` (compose YAML + `.env`).
/// Persisted under [`STATE_ROOT`] so it is never destroyed on restart.
fn compose_project_dir(project: &str) -> std::path::PathBuf {
    std::path::Path::new(STATE_ROOT)
        .join("compose")
        .join(project)
}

/// One-time migration for boxes upgraded from a build that stored compose
/// projects in `/tmp` (`lockethq-compose-<project>`). Older runners ran with
/// `PrivateTmp=true`, so those dirs were already wiped on restart — but if the
/// runner is updated *without* a restart in between, the files may still be
/// present. Move any survivors into the persistent location so a later
/// `compose down`/recreate can still find the compose file. Best-effort: logs
/// and continues on any error so a bad entry never blocks startup.
pub async fn migrate_legacy_compose_dirs() {
    let tmp = std::env::temp_dir();
    let mut entries = match tokio::fs::read_dir(&tmp).await {
        Ok(e) => e,
        Err(_) => return, // no /tmp to scan — nothing to do
    };
    let dest_base = std::path::Path::new(STATE_ROOT).join("compose");
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some(project) = name.strip_prefix("lockethq-compose-") else {
            continue;
        };
        if !entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let dest = dest_base.join(project);
        if tokio::fs::try_exists(&dest).await.unwrap_or(false) {
            // Already migrated (or a newer deploy recreated it) — leave the
            // canonical copy in place and drop the stale /tmp one.
            let _ = tokio::fs::remove_dir_all(entry.path()).await;
            continue;
        }
        if let Err(e) = tokio::fs::create_dir_all(&dest_base).await {
            tracing::warn!("compose migration: mkdir {dest_base:?} failed: {e}");
            return;
        }
        // `rename` fails with EXDEV across filesystems (/tmp tmpfs →
        // /var/lib disk), so fall back to a recursive copy + delete.
        let moved = match tokio::fs::rename(entry.path(), &dest).await {
            Ok(()) => true,
            Err(_) => match copy_dir_recursive(&entry.path(), &dest).await {
                Ok(()) => {
                    let _ = tokio::fs::remove_dir_all(entry.path()).await;
                    true
                }
                Err(e) => {
                    tracing::warn!(
                        "compose migration: copying '{project}' to {dest:?} failed: {e}"
                    );
                    false
                }
            },
        };
        if moved {
            tracing::info!("migrated legacy compose project '{project}' to {dest:?}");
        }
    }
}

/// Recursively copy `src` into `dst` (creating `dst`). Used by the legacy
/// compose migration when a cross-filesystem `rename` isn't possible.
fn copy_dir_recursive<'a>(
    src: &'a std::path::Path,
    dst: &'a std::path::Path,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = std::io::Result<()>> + Send + 'a>> {
    Box::pin(async move {
        tokio::fs::create_dir_all(dst).await?;
        let mut rd = tokio::fs::read_dir(src).await?;
        while let Some(entry) = rd.next_entry().await? {
            let from = entry.path();
            let to = dst.join(entry.file_name());
            if entry.file_type().await?.is_dir() {
                copy_dir_recursive(&from, &to).await?;
            } else {
                tokio::fs::copy(&from, &to).await?;
            }
        }
        Ok(())
    })
}

pub async fn connect() -> Result<Docker> {
    Docker::connect_with_local_defaults()
        .context("connecting to docker daemon (is /var/run/docker.sock accessible?)")
}

fn map_status(state: &str) -> ContainerStatus {
    match state {
        "running" => ContainerStatus::Running,
        "restarting" => ContainerStatus::Restarting,
        "exited" => ContainerStatus::Exited,
        "paused" => ContainerStatus::Paused,
        "dead" => ContainerStatus::Dead,
        "created" => ContainerStatus::Created,
        _ => ContainerStatus::Stopped,
    }
}

pub async fn list_containers(docker: &Docker) -> Result<Vec<ContainerSummary>> {
    let opts = ListContainersOptions::<String> {
        all: true,
        ..Default::default()
    };
    let raw = docker.list_containers(Some(opts)).await?;
    Ok(raw
        .into_iter()
        .map(|c| {
            let name = c
                .names
                .as_ref()
                .and_then(|n| n.first().map(|s| s.trim_start_matches('/').to_string()))
                .unwrap_or_else(|| c.id.clone().unwrap_or_default());
            let ports = c
                .ports
                .as_ref()
                .map(|ps| {
                    ps.iter()
                        .map(|p| PortMapping {
                            container_port: p.private_port,
                            host_port: p.public_port,
                            protocol: p.typ.as_ref().map(|t| format!("{:?}", t).to_lowercase())
                                .unwrap_or_else(|| "tcp".into()),
                            public: p.public_port.is_some(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            ContainerSummary {
                id: c.id.unwrap_or_default(),
                name,
                image: c.image.unwrap_or_default(),
                status: map_status(c.state.as_deref().unwrap_or("")),
                state: c.status.unwrap_or_default(),
                created: c.created.unwrap_or(0),
                ports,
                uptime_seconds: None,
                labels: c.labels.unwrap_or_default(),
            }
        })
        .collect())
}

pub async fn inspect_container(docker: &Docker, id: &str) -> Result<ContainerDetail> {
    let det = docker.inspect_container(id, None).await?;

    let ports: Vec<PortMapping> = det
        .network_settings
        .as_ref()
        .and_then(|ns| ns.ports.as_ref())
        .map(|pmap| {
            pmap.iter()
                .filter_map(|(k, v)| {
                    // k is e.g. "80/tcp"
                    let mut parts = k.splitn(2, '/');
                    let container_port = parts.next()?.parse::<u16>().ok()?;
                    let protocol = parts.next().unwrap_or("tcp").to_string();
                    let host_port = v
                        .as_ref()
                        .and_then(|bindings| bindings.first())
                        .and_then(|b| b.host_port.as_ref())
                        .and_then(|s| s.parse::<u16>().ok());
                    Some(PortMapping {
                        container_port,
                        host_port,
                        protocol,
                        public: host_port.is_some(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let summary = ContainerSummary {
        id: det.id.clone().unwrap_or_default(),
        name: det.name.clone().unwrap_or_default().trim_start_matches('/').to_string(),
        image: det.config.as_ref().and_then(|c| c.image.clone()).unwrap_or_default(),
        status: map_status(det.state.as_ref().and_then(|s| s.status.as_ref()).map(|s| format!("{:?}", s).to_lowercase()).as_deref().unwrap_or("")),
        state: det.state.as_ref().and_then(|s| s.status.as_ref()).map(|s| format!("{:?}", s)).unwrap_or_default(),
        created: det.created.as_ref().and_then(|c| c.parse::<i64>().ok()).unwrap_or(0),
        ports,
        uptime_seconds: None,
        labels: det.config.as_ref().and_then(|c| c.labels.clone()).unwrap_or_default(),
    };
    let env = det
        .config
        .as_ref()
        .and_then(|c| c.env.clone())
        .unwrap_or_default()
        .into_iter()
        .map(|kv| {
            let mut s = kv.splitn(2, '=');
            let k = s.next().unwrap_or("").to_string();
            let v = s.next().unwrap_or("").to_string();
            let secret = k.to_lowercase().contains("secret")
                || k.to_lowercase().contains("password")
                || k.to_lowercase().contains("token")
                || k.to_lowercase().contains("key");
            EnvVar { key: k, value: v, secret }
        })
        .collect();
    let mounts = det
        .mounts
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|m| Mount {
            source: m.source.unwrap_or_default(),
            destination: m.destination.unwrap_or_default(),
            read_only: !m.rw.unwrap_or(true),
            kind: m.typ.map(|t| format!("{:?}", t).to_lowercase()).unwrap_or_else(|| "bind".into()),
        })
        .collect();
    let networks = det
        .network_settings
        .as_ref()
        .and_then(|n| n.networks.as_ref())
        .map(|nets| nets.keys().cloned().collect())
        .unwrap_or_default();
    let restart_policy = det
        .host_config
        .as_ref()
        .and_then(|h| h.restart_policy.as_ref())
        .and_then(|r| r.name.as_ref())
        .map(|n| format!("{:?}", n).to_lowercase())
        .unwrap_or_else(|| "no".into());
    let digest = det
        .image
        .clone();
    let command = det
        .config
        .as_ref()
        .and_then(|c| c.cmd.clone())
        .map(|cmds| cmds.join(" "));

    Ok(ContainerDetail {
        summary,
        env,
        mounts,
        networks,
        restart_policy,
        digest,
        command,
    })
}

pub async fn start(docker: &Docker, id: &str) -> Result<()> {
    docker
        .start_container(id, None::<StartContainerOptions<String>>)
        .await?;
    Ok(())
}

pub async fn stop(docker: &Docker, id: &str) -> Result<()> {
    docker
        .stop_container(id, Some(StopContainerOptions { t: 10 }))
        .await?;
    Ok(())
}

pub async fn restart(docker: &Docker, id: &str) -> Result<()> {
    docker.restart_container(id, None).await?;
    Ok(())
}

pub async fn remove(docker: &Docker, id: &str, force: bool) -> Result<()> {
    docker
        .remove_container(
            id,
            Some(RemoveContainerOptions {
                force,
                v: true,
                link: false,
            }),
        )
        .await?;
    Ok(())
}

pub async fn list_images(docker: &Docker) -> Result<Vec<ImageSummary>> {
    let opts = ListImagesOptions::<String> {
        all: false,
        ..Default::default()
    };
    let raw = docker.list_images(Some(opts)).await?;
    Ok(raw
        .into_iter()
        .map(|i| ImageSummary {
            id: i.id,
            repo_tags: i.repo_tags,
            size_bytes: i.size as u64,
            created: i.created,
        })
        .collect())
}

pub async fn list_volumes(docker: &Docker) -> Result<Vec<VolumeSummary>> {
    let raw = docker.list_volumes(None::<ListVolumesOptions<String>>).await?;
    let mut volumes: Vec<VolumeSummary> = raw
        .volumes
        .unwrap_or_default()
        .into_iter()
        .map(|v| VolumeSummary {
            name: v.name,
            driver: v.driver,
            mountpoint: v.mountpoint,
            created: v
                .created_at
                .and_then(|c| chrono::DateTime::parse_from_rfc3339(&c).ok())
                .map(|d| d.timestamp())
                .unwrap_or(0),
            size_bytes: None,
            in_use_by: vec![],
        })
        .collect();

    // Populate size_bytes from `docker system df -v --format json` — it's the
    // only built-in way to get accurate per-volume size without scanning
    // mountpoints (which would need root + can be slow on big volumes).
    if let Ok(out) = tokio::process::Command::new("docker")
        .args(["system", "df", "-v", "--format", "{{json .}}"])
        .output()
        .await
    {
        if out.status.success() {
            // df -v with json gives one big object containing Volumes: [...]
            if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                if let Some(arr) = parsed.get("Volumes").and_then(|v| v.as_array()) {
                    let mut size_map: std::collections::HashMap<String, u64> = Default::default();
                    let mut users_map: std::collections::HashMap<String, Vec<String>> = Default::default();
                    for v in arr {
                        let name = v.get("Name").and_then(|x| x.as_str()).unwrap_or("");
                        if name.is_empty() { continue; }
                        // Size comes as a string like "1.2GB" — convert.
                        if let Some(s) = v.get("Size").and_then(|x| x.as_str()) {
                            if let Some(b) = parse_size(s) {
                                size_map.insert(name.into(), b);
                            }
                        }
                        // Links is the count of containers using it; we still
                        // fill in_use_by from container inspect below if needed.
                        let _ = users_map; // unused but kept for clarity
                    }
                    for vol in volumes.iter_mut() {
                        if let Some(s) = size_map.get(&vol.name) {
                            vol.size_bytes = Some(*s);
                        }
                    }
                }
            }
        }
    }

    // Fill in_use_by by listing containers and inspecting mounts.
    let containers = match docker
        .list_containers(Some(bollard::container::ListContainersOptions::<String> {
            all: true,
            ..Default::default()
        }))
        .await
    {
        Ok(cs) => cs,
        Err(_) => Vec::new(),
    };
    let mut users: std::collections::HashMap<String, Vec<String>> = Default::default();
    for c in &containers {
        let name = c.names.as_ref().and_then(|n| n.first().cloned())
            .map(|n| n.trim_start_matches('/').to_string())
            .unwrap_or_default();
        if let Some(mounts) = &c.mounts {
            for m in mounts {
                if m.typ == Some(bollard::service::MountPointTypeEnum::VOLUME) {
                    if let Some(vname) = &m.name {
                        users.entry(vname.clone()).or_default().push(name.clone());
                    }
                }
            }
        }
    }
    for v in volumes.iter_mut() {
        if let Some(list) = users.get(&v.name) {
            v.in_use_by = list.clone();
        }
    }

    Ok(volumes)
}

/// Parse docker's human-readable size strings (e.g. "1.234GB", "500.5MB").
fn parse_size(s: &str) -> Option<u64> {
    let s = s.trim();
    if s.is_empty() || s == "0B" { return Some(0); }
    let (num, unit) = s.trim_end_matches(|c: char| c.is_ascii_alphabetic()).len()
        .pipe(|n| (&s[..n], &s[n..]));
    let n: f64 = num.parse().ok()?;
    let mult: f64 = match unit {
        "B" | "" => 1.0,
        "kB" | "KB" | "K" => 1024.0,
        "MB" | "M" => 1024.0 * 1024.0,
        "GB" | "G" => 1024.0 * 1024.0 * 1024.0,
        "TB" | "T" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((n * mult) as u64)
}

trait Pipe: Sized {
    fn pipe<R, F: FnOnce(Self) -> R>(self, f: F) -> R { f(self) }
}
impl<T> Pipe for T {}

pub async fn list_networks(docker: &Docker) -> Result<Vec<NetworkSummary>> {
    let raw = docker
        .list_networks(None::<ListNetworksOptions<String>>)
        .await?;
    Ok(raw
        .into_iter()
        .map(|n| NetworkSummary {
            id: n.id.unwrap_or_default(),
            name: n.name.unwrap_or_default(),
            driver: n.driver.unwrap_or_default(),
            scope: n.scope.unwrap_or_default(),
            subnet: n
                .ipam
                .and_then(|i| i.config)
                .and_then(|cs| cs.into_iter().next())
                .and_then(|c| c.subnet),
            containers_attached: n.containers.map(|c| c.len() as u32).unwrap_or(0),
        })
        .collect())
}

/// Pull an image. Streams progress lines as JSON to `tx`.
pub async fn pull_image(docker: &Docker, image: &str, tx: mpsc::Sender<String>) -> Result<()> {
    let opts = CreateImageOptions {
        from_image: image.to_string(),
        ..Default::default()
    };
    let mut s = docker.create_image(Some(opts), None, None);
    while let Some(item) = s.next().await {
        match item {
            Ok(info) => {
                let _ = tx.send(serde_json::to_string(&info)?).await;
            }
            Err(e) => {
                let _ = tx
                    .send(serde_json::json!({"error": e.to_string()}).to_string())
                    .await;
                return Err(e.into());
            }
        }
    }
    Ok(())
}

/// Resolve a `ContainerSource` to a concrete image tag, building from
/// GitHub or an uploaded tarball if needed. (Compose is handled by a
/// separate code path because it can create multiple containers.)
pub async fn resolve_source(
    docker: &Docker,
    source: &ContainerSource,
    name_hint: &str,
    uploaded_body: Option<Vec<u8>>,
) -> Result<String> {
    match source {
        ContainerSource::Image { image } => Ok(image.clone()),
        ContainerSource::Github { repo, branch, dockerfile_path } => {
            let tag = format!("lockethq/{}:latest", sanitize_tag(name_hint));
            let remote = format!("https://github.com/{}.git#{}", repo, branch);
            let opts = bollard::image::BuildImageOptions {
                dockerfile: dockerfile_path.clone().unwrap_or_else(|| "Dockerfile".into()),
                t: tag.clone(),
                remote,
                rm: true,
                ..Default::default()
            };
            run_build(docker, opts, None).await?;
            Ok(tag)
        }
        ContainerSource::Upload { archive_path: _, dockerfile_path } => {
            let body = uploaded_body
                .ok_or_else(|| anyhow::anyhow!("upload source requires tarball body"))?;
            let tag = format!("lockethq/{}:latest", sanitize_tag(name_hint));
            let opts = bollard::image::BuildImageOptions {
                dockerfile: dockerfile_path.clone().unwrap_or_else(|| "Dockerfile".into()),
                t: tag.clone(),
                rm: true,
                ..Default::default()
            };
            run_build(docker, opts, Some(body)).await?;
            Ok(tag)
        }
        ContainerSource::Compose { .. } => {
            anyhow::bail!("compose handled by separate endpoint")
        }
    }
}

fn sanitize_tag(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// True when a compose project of this name already owns containers (running
/// or stopped). Used as a collision check before `compose up` so a new stack
/// can never recreate or remove an existing stack's services.
async fn project_has_containers(project: &str) -> bool {
    match tokio::process::Command::new("docker")
        .args(["compose", "-p", project, "ps", "-aq"])
        .output()
        .await
    {
        Ok(out) => !String::from_utf8_lossy(&out.stdout).trim().is_empty(),
        // If we can't tell, assume yes — refusing to reuse the name is the
        // safe failure mode here (we'll just pick the next suffix).
        Err(_) => true,
    }
}

/// Resolve a free compose project name. If `base` is already in use, returns
/// `base-2`, `base-3`, … until an unused one is found. Honors the project
/// rule: never destroy an existing stack — give up the grouping name instead.
async fn find_free_project_name(base: &str) -> String {
    if !project_has_containers(base).await {
        return base.to_string();
    }
    for i in 2..1000 {
        let candidate = format!("{base}-{i}");
        if !project_has_containers(&candidate).await {
            return candidate;
        }
    }
    // Pathological fallback — collision-free via pid + nanos.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!("{base}-{}-{}", std::process::id(), nanos)
}

async fn run_build(
    docker: &Docker,
    opts: bollard::image::BuildImageOptions<String>,
    body: Option<Vec<u8>>,
) -> Result<()> {
    let mut stream = match body {
        Some(b) => docker.build_image(opts, None, Some(b.into())),
        None => docker.build_image(opts, None, None),
    };
    let mut last_err: Option<String> = None;
    while let Some(item) = stream.next().await {
        match item {
            Ok(info) => {
                if let Some(err) = info.error {
                    last_err = Some(err);
                } else if let Some(stream) = info.stream {
                    tracing::debug!("build: {}", stream.trim_end());
                }
            }
            Err(e) => return Err(e.into()),
        }
    }
    if let Some(e) = last_err {
        anyhow::bail!("docker build failed: {e}");
    }
    Ok(())
}

/// Create a container. Accepts an optional tarball body for the Upload source.
pub async fn create_container(
    docker: &Docker,
    req: &CreateContainerRequest,
    uploaded_body: Option<Vec<u8>>,
) -> Result<String> {
    let image = resolve_source(docker, &req.source, &req.name, uploaded_body).await?;

    let env: Vec<String> = req.env.iter().map(|e| format!("{}={}", e.key, e.value)).collect();

    let mut exposed_ports: HashMap<String, HashMap<(), ()>> = HashMap::new();
    let mut port_bindings: HashMap<String, Option<Vec<bollard::service::PortBinding>>> = HashMap::new();
    for p in &req.ports {
        let key = format!("{}/{}", p.container_port, p.protocol);
        exposed_ports.insert(key.clone(), HashMap::new());
        if let Some(hp) = p.host_port {
            port_bindings.insert(
                key,
                Some(vec![bollard::service::PortBinding {
                    host_ip: None,
                    host_port: Some(hp.to_string()),
                }]),
            );
        }
    }

    let cmd = req
        .command
        .as_ref()
        .map(|c| c.split_whitespace().map(String::from).collect::<Vec<_>>());

    let host_config = bollard::service::HostConfig {
        port_bindings: if port_bindings.is_empty() { None } else { Some(port_bindings) },
        restart_policy: Some(bollard::service::RestartPolicy {
            name: Some(match req.restart_policy.as_str() {
                "always" => bollard::service::RestartPolicyNameEnum::ALWAYS,
                "unless-stopped" => bollard::service::RestartPolicyNameEnum::UNLESS_STOPPED,
                "on-failure" => bollard::service::RestartPolicyNameEnum::ON_FAILURE,
                _ => bollard::service::RestartPolicyNameEnum::NO,
            }),
            maximum_retry_count: None,
        }),
        memory: req.resources.as_ref().and_then(|r| r.memory_mb).map(|m| (m * 1024 * 1024) as i64),
        cpu_shares: req.resources.as_ref().and_then(|r| r.cpu_shares),
        ..Default::default()
    };

    let config = Config::<String> {
        image: Some(image.clone()),
        env: if env.is_empty() { None } else { Some(env) },
        exposed_ports: if exposed_ports.is_empty() { None } else { Some(exposed_ports) },
        cmd,
        host_config: Some(host_config),
        ..Default::default()
    };

    // Image source still needs a pull (build-based sources already produced the tag).
    if matches!(req.source, ContainerSource::Image { .. }) {
        let (tx, _rx) = mpsc::channel::<String>(32);
        let _ = pull_image(docker, &image, tx).await;
    }

    let opts = CreateContainerOptions {
        name: req.name.clone(),
        platform: None,
    };
    let resp = docker.create_container(Some(opts), config).await?;

    docker
        .start_container(&resp.id, None::<StartContainerOptions<String>>)
        .await?;
    Ok(resp.id)
}

/// Run `docker compose -p <project> -f <file> up -d`. Shells out because
/// the compose spec is too complex to reimplement; the docker CLI plugin
/// is included in modern Docker installs.
///
/// `env_vars` are values for `${VAR}` interpolation — written to a `.env`
/// file alongside the YAML so `docker compose` auto-loads them.
/// Streaming version of `compose_up`. Pipes stdout/stderr line-by-line as
/// NDJSON `{"event": "log", ...}` frames, and emits a final
/// `{"event": "done", "ids": [...]}` or `{"event": "error", "message": "..."}`.
pub async fn compose_up_stream(
    project: &str,
    yaml: &str,
    env_vars: &[(String, String)],
    tx: mpsc::Sender<String>,
) -> Result<()> {
    use std::io::Write;
    use tokio::io::{AsyncBufReadExt, BufReader};
    let requested = sanitize_tag(project);
    let safe = find_free_project_name(&requested).await;
    if safe != requested {
        let _ = tx
            .send(serde_json::json!({
                "event":"log","stream":"meta",
                "line":format!(
                    "project name '{requested}' is already in use — deploying as '{safe}' to avoid clobbering existing containers"
                )
            }).to_string())
            .await;
    }
    let dir = compose_project_dir(&safe);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        let _ = tx.send(serde_json::json!({"event":"error","message":format!("mkdir: {e}")}).to_string()).await;
        return Ok(());
    }
    let yaml_path = dir.join("docker-compose.yml");
    if let Err(e) = std::fs::File::create(&yaml_path).and_then(|mut f| f.write_all(yaml.as_bytes())) {
        let _ = tx.send(serde_json::json!({"event":"error","message":format!("write yaml: {e}")}).to_string()).await;
        return Ok(());
    }
    let env_path = dir.join(".env");
    {
        match std::fs::File::create(&env_path) {
            Ok(mut f) => {
                for (k, v) in env_vars {
                    let escaped = v.replace('\\', "\\\\").replace('"', "\\\"");
                    let _ = writeln!(f, "{k}=\"{escaped}\"");
                }
            }
            Err(e) => {
                let _ = tx.send(serde_json::json!({"event":"error","message":format!("write env: {e}")}).to_string()).await;
                return Ok(());
            }
        }
    }

    let _ = tx
        .send(serde_json::json!({"event":"log","stream":"meta","line":format!("running: docker compose -p {} --env-file .env -f docker-compose.yml up -d", safe)}).to_string())
        .await;

    let mut child = match tokio::process::Command::new("docker")
        .arg("compose")
        .arg("-p").arg(&safe)
        .arg("--env-file").arg(&env_path)
        .arg("-f").arg(&yaml_path)
        .arg("--ansi").arg("never")
        .arg("--progress").arg("plain")
        .arg("up").arg("-d")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let _ = tx.send(serde_json::json!({"event":"error","message":format!("spawn: {e}")}).to_string()).await;
            return Ok(());
        }
    };

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let tx_out = tx.clone();
    let tx_err = tx.clone();
    let out_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = tx_out
                .send(serde_json::json!({"event":"log","stream":"stdout","line":line}).to_string())
                .await;
        }
    });
    let err_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = tx_err
                .send(serde_json::json!({"event":"log","stream":"stderr","line":line}).to_string())
                .await;
        }
    });

    let status = match child.wait().await {
        Ok(s) => s,
        Err(e) => {
            let _ = tx.send(serde_json::json!({"event":"error","message":format!("wait: {e}")}).to_string()).await;
            return Ok(());
        }
    };
    let _ = out_task.await;
    let _ = err_task.await;

    if !status.success() {
        let _ = tx
            .send(serde_json::json!({"event":"error","message":format!("docker compose exited {:?}", status.code())}).to_string())
            .await;
        return Ok(());
    }

    let ps = tokio::process::Command::new("docker")
        .args(["compose", "-p", &safe, "ps", "-q"])
        .output()
        .await
        .unwrap_or_else(|_| std::process::Output {
            status: std::process::ExitStatus::default(),
            stdout: Vec::new(),
            stderr: Vec::new(),
        });
    let ids: Vec<String> = String::from_utf8_lossy(&ps.stdout)
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let _ = tx
        .send(serde_json::json!({"event":"done","ids":ids,"project":safe}).to_string())
        .await;
    Ok(())
}

/// Run a compose-project subcommand (restart / stop / down) using existing
/// container labels — no compose file needed for these subcommands because
/// docker resolves services from the project label on running containers.
pub async fn compose_action(project: &str, action: &str) -> Result<String> {
    let safe = sanitize_tag(project);
    let mut cmd = tokio::process::Command::new("docker");
    cmd.arg("compose").arg("-p").arg(&safe);
    match action {
        "restart" => { cmd.arg("restart"); }
        "stop" => { cmd.arg("stop"); }
        "start" => { cmd.arg("start"); }
        "down" => { cmd.args(["down", "--remove-orphans"]); }
        _ => anyhow::bail!("unsupported compose action: {action}"),
    }
    let out = cmd.output().await?;
    if !out.status.success() {
        anyhow::bail!(
            "compose {action} failed (exit {:?}): {}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub async fn compose_up(
    project: &str,
    yaml: &str,
    env_vars: &[(String, String)],
) -> Result<Vec<String>> {
    use std::io::Write;
    let requested = sanitize_tag(project);
    let safe = find_free_project_name(&requested).await;
    if safe != requested {
        tracing::warn!(
            "compose project '{requested}' already in use; deploying as '{safe}' to avoid clobbering existing containers"
        );
    }
    let dir = compose_project_dir(&safe);
    tokio::fs::create_dir_all(&dir).await?;
    let yaml_path = dir.join("docker-compose.yml");
    {
        let mut f = std::fs::File::create(&yaml_path)?;
        f.write_all(yaml.as_bytes())?;
    }
    // Write .env file in the same directory so compose interpolates correctly.
    let env_path = dir.join(".env");
    {
        let mut f = std::fs::File::create(&env_path)?;
        for (k, v) in env_vars {
            // Use double-quoted form; escape backslashes and double quotes.
            let escaped = v.replace('\\', "\\\\").replace('"', "\\\"");
            writeln!(f, "{k}=\"{escaped}\"")?;
        }
    }
    let out = tokio::process::Command::new("docker")
        .arg("compose")
        .arg("-p").arg(&safe)
        .arg("--env-file").arg(&env_path)
        .arg("-f").arg(&yaml_path)
        .arg("up").arg("-d")
        .output()
        .await?;
    if !out.status.success() {
        anyhow::bail!(
            "docker compose up -d failed (exit {:?}): {}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr)
        );
    }
    // List containers in this project.
    let ps = tokio::process::Command::new("docker")
        .args(["compose", "-p", &safe, "ps", "-q"])
        .output()
        .await?;
    let ids = String::from_utf8_lossy(&ps.stdout)
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    Ok(ids)
}

/// Tail container logs as newline-delimited JSON `LogLine`s.
pub async fn logs_stream(
    docker: &Docker,
    id: &str,
    follow: bool,
    tail: u64,
    tx: mpsc::Sender<String>,
) -> Result<()> {
    let opts = LogsOptions::<String> {
        follow,
        stdout: true,
        stderr: true,
        timestamps: true,
        tail: tail.to_string(),
        ..Default::default()
    };
    let mut s = docker.logs(id, Some(opts));
    while let Some(item) = s.next().await {
        match item {
            Ok(log) => {
                let (stream, raw) = match log {
                    bollard::container::LogOutput::StdOut { message } => (LogStream::Stdout, message),
                    bollard::container::LogOutput::StdErr { message } => (LogStream::Stderr, message),
                    bollard::container::LogOutput::Console { message } => (LogStream::Stdout, message),
                    bollard::container::LogOutput::StdIn { message } => (LogStream::Stdout, message),
                };
                let text = String::from_utf8_lossy(&raw).to_string();
                // Docker prepends `<rfc3339-timestamp> ` when timestamps=true.
                let (ts, msg) = match text.split_once(' ') {
                    Some((t, m)) => (
                        chrono::DateTime::parse_from_rfc3339(t)
                            .map(|d| d.timestamp_millis())
                            .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis()),
                        m.to_string(),
                    ),
                    None => (chrono::Utc::now().timestamp_millis(), text),
                };
                let line = LogLine { timestamp: ts, stream, message: msg.trim_end().to_string() };
                let _ = tx.send(serde_json::to_string(&line)?).await;
            }
            Err(e) => {
                let _ = tx
                    .send(serde_json::json!({"error": e.to_string()}).to_string())
                    .await;
                break;
            }
        }
    }
    Ok(())
}

/// Stream container stats as newline-delimited JSON `ContainerStats`.
/// Recreate a container preserving image, network/port/volume config, but
/// applying a new env-var list. Docker can't mutate env on a running container,
/// so we stop+remove+create+start.
pub async fn recreate_with_env(docker: &Docker, id: &str, env_pairs: &[EnvVar]) -> Result<String> {
    let det = docker.inspect_container(id, None).await?;

    let name = det.name.clone().unwrap_or_default().trim_start_matches('/').to_string();
    let image = det.config.as_ref().and_then(|c| c.image.clone())
        .ok_or_else(|| anyhow::anyhow!("container has no image"))?;
    let cmd = det.config.as_ref().and_then(|c| c.cmd.clone());
    let exposed = det.config.as_ref().and_then(|c| c.exposed_ports.clone());
    let labels = det.config.as_ref().and_then(|c| c.labels.clone());
    let working_dir = det.config.as_ref().and_then(|c| c.working_dir.clone());

    // Preserve host config (port bindings, mounts, restart policy, etc.)
    let host_config = det.host_config.clone();

    // Build new env
    let new_env: Vec<String> = env_pairs.iter().map(|e| format!("{}={}", e.key, e.value)).collect();

    let config = Config::<String> {
        image: Some(image),
        env: Some(new_env),
        exposed_ports: exposed,
        cmd,
        host_config,
        labels,
        working_dir,
        ..Default::default()
    };

    // Stop & remove the old container (keep volumes).
    let _ = docker
        .stop_container(id, Some(StopContainerOptions { t: 10 }))
        .await;
    docker
        .remove_container(id, Some(RemoveContainerOptions { force: true, v: false, link: false }))
        .await?;

    let resp = docker
        .create_container(
            Some(CreateContainerOptions { name: name.clone(), platform: None }),
            config,
        )
        .await?;
    docker
        .start_container(&resp.id, None::<StartContainerOptions<String>>)
        .await?;
    Ok(resp.id)
}

pub async fn stats_stream(docker: &Docker, id: &str, tx: mpsc::Sender<String>) -> Result<()> {
    let mut s = docker.stats(
        id,
        Some(StatsOptions {
            stream: true,
            one_shot: false,
        }),
    );
    while let Some(item) = s.next().await {
        match item {
            Ok(st) => {
                let cpu_delta = (st.cpu_stats.cpu_usage.total_usage as f64)
                    - (st.precpu_stats.cpu_usage.total_usage as f64);
                let sys_delta = (st.cpu_stats.system_cpu_usage.unwrap_or(0) as f64)
                    - (st.precpu_stats.system_cpu_usage.unwrap_or(0) as f64);
                let cores = st.cpu_stats.online_cpus.unwrap_or(1) as f64;
                let cpu_pct = if sys_delta > 0.0 && cpu_delta > 0.0 {
                    (cpu_delta / sys_delta) * cores * 100.0
                } else {
                    0.0
                };

                let mem_used = st.memory_stats.usage.unwrap_or(0);
                let mem_limit = st.memory_stats.limit.unwrap_or(0);

                let (rx, txn) = st
                    .networks
                    .map(|nets| {
                        nets.values().fold((0u64, 0u64), |(r, t), n| {
                            (r + n.rx_bytes, t + n.tx_bytes)
                        })
                    })
                    .unwrap_or((0, 0));

                let out = ContainerStats {
                    id: id.to_string(),
                    cpu_percent: cpu_pct as f32,
                    memory_used_mb: mem_used / 1024 / 1024,
                    memory_limit_mb: mem_limit / 1024 / 1024,
                    net_rx_bytes_per_sec: rx,
                    net_tx_bytes_per_sec: txn,
                    block_read_bytes_per_sec: 0,
                    block_write_bytes_per_sec: 0,
                };
                let _ = tx.send(serde_json::to_string(&out)?).await;
            }
            Err(e) => {
                let _ = tx
                    .send(serde_json::json!({"error": e.to_string()}).to_string())
                    .await;
                break;
            }
        }
    }
    Ok(())
}
