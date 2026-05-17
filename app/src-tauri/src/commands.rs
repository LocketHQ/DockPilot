//! Tauri command handlers exposed to the React frontend.

use crate::error::{AppError, AppResult};
use crate::runner_client;
use crate::ssh_install::{self, SshAuth, SshConfig};
use crate::storage::{Storage, StoredSshAuth};
use crate::tunnel::TunnelManager;
use lockethq_shared::ServerRecord;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{watch, Mutex};

fn candidate_binary_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = app.path().resource_dir() {
        out.push(rd.join("binaries"));
    }
    out.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    if let Ok(cwd) = std::env::current_dir() {
        out.push(cwd.join("binaries"));
        out.push(cwd.join("src-tauri").join("binaries"));
        out.push(cwd.join("app").join("src-tauri").join("binaries"));
    }
    out
}

async fn read_runner_binaries(dirs: &[PathBuf]) -> (Vec<u8>, Vec<u8>, PathBuf) {
    for d in dirs {
        let x = tokio::fs::read(d.join("lockethq-runner-x86_64")).await.unwrap_or_default();
        let a = tokio::fs::read(d.join("lockethq-runner-aarch64")).await.unwrap_or_default();
        if !x.is_empty() || !a.is_empty() {
            return (x, a, d.clone());
        }
    }
    (Vec::new(), Vec::new(), PathBuf::new())
}

pub struct AppState {
    pub storage: Storage,
    pub tunnels: TunnelManager,
    pub streams: Mutex<HashMap<String, watch::Sender<bool>>>,
    pub app: AppHandle,
}

impl AppState {
    pub fn new(app: AppHandle) -> AppResult<Self> {
        Ok(Self {
            storage: Storage::new(&app)?,
            tunnels: TunnelManager::new(),
            streams: Mutex::new(HashMap::new()),
            app,
        })
    }
}

// ─── Server registry ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_servers(state: State<'_, AppState>) -> AppResult<Vec<ServerRecord>> {
    state.storage.list().await
}

#[derive(Deserialize)]
pub struct AddServerArgs {
    pub name: String,
    pub host: String,
    pub ssh_port: Option<u16>,
    pub ssh_user: String,
    pub auth_mode: String,
    pub private_key_path: Option<String>,
    pub passphrase: Option<String>,
    pub password: Option<String>,
    pub region: Option<String>,
    pub provider: Option<String>,
    pub flag: Option<String>,
    #[serde(default)]
    pub install_docker: bool,
}

fn build_auth(
    mode: &str,
    private_key_path: Option<String>,
    passphrase: Option<String>,
    password: Option<String>,
) -> AppResult<SshAuth> {
    match mode {
        "password" => {
            let p = password.ok_or_else(|| AppError::Other("password required".into()))?;
            Ok(SshAuth::Password { password: p })
        }
        _ => {
            let path = private_key_path
                .ok_or_else(|| AppError::Other("private_key_path required".into()))?;
            Ok(SshAuth::Key { private_key_path: path, passphrase })
        }
    }
}

fn build_stored(
    mode: &str,
    private_key_path: Option<String>,
    passphrase: Option<String>,
    password: Option<String>,
) -> AppResult<StoredSshAuth> {
    match mode {
        "password" => {
            let p = password.ok_or_else(|| AppError::Other("password required".into()))?;
            Ok(StoredSshAuth::Password { password: p })
        }
        _ => {
            let path = private_key_path
                .ok_or_else(|| AppError::Other("private_key_path required".into()))?;
            Ok(StoredSshAuth::Key { private_key_path: path, passphrase })
        }
    }
}

#[tauri::command]
pub async fn add_server(args: AddServerArgs, state: State<'_, AppState>) -> AppResult<ServerRecord> {
    let cfg = SshConfig {
        host: args.host.clone(),
        port: args.ssh_port.unwrap_or(22),
        user: args.ssh_user.clone(),
        auth: build_auth(
            &args.auth_mode,
            args.private_key_path.clone(),
            args.passphrase.clone(),
            args.password.clone(),
        )?,
    };

    let candidates = candidate_binary_dirs(&state.app);
    let (x, a, used) = read_runner_binaries(&candidates).await;
    if x.is_empty() && a.is_empty() {
        return Err(AppError::Other(format!(
            "runner binaries not found. Looked in:\n  {}\nExpected files: lockethq-runner-x86_64 and/or lockethq-runner-aarch64",
            candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join("\n  ")
        )));
    }
    tracing::info!("using runner binaries from {}", used.display());

    let remote_port = 8765u16;
    let install = ssh_install::install(&cfg, &x, &a, remote_port, args.install_docker).await?;

    let id = uuid::Uuid::new_v4().to_string();
    let record = ServerRecord {
        id: id.clone(),
        name: args.name,
        host: args.host,
        ssh_user: args.ssh_user,
        ssh_port: args.ssh_port.unwrap_or(22),
        region: args.region,
        provider: args.provider,
        flag: args.flag,
        runner_port: install.remote_port,
        created_at: chrono::Utc::now().timestamp(),
    };
    let mut all = state.storage.list().await?;
    all.push(record.clone());
    state.storage.save(&all).await?;
    state.storage.put_token(&id, &install.token).await?;
    state.storage.put_ssh(
        &id,
        build_stored(
            &args.auth_mode,
            args.private_key_path,
            args.passphrase,
            args.password,
        )?,
    ).await?;
    Ok(record)
}

#[tauri::command]
pub async fn remove_server(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let mut all = state.storage.list().await?;
    all.retain(|s| s.id != id);
    state.storage.save(&all).await?;
    let _ = state.storage.delete_secret(&id).await;
    state.tunnels.drop_one(&id).await;
    Ok(())
}

#[derive(Deserialize)]
pub struct TestSshArgs {
    pub host: String,
    pub ssh_port: Option<u16>,
    pub ssh_user: String,
    pub auth_mode: String,
    pub private_key_path: Option<String>,
    pub passphrase: Option<String>,
    pub password: Option<String>,
}

#[tauri::command]
pub async fn test_ssh(args: TestSshArgs) -> AppResult<String> {
    let cfg = SshConfig {
        host: args.host,
        port: args.ssh_port.unwrap_or(22),
        user: args.ssh_user,
        auth: build_auth(
            &args.auth_mode,
            args.private_key_path,
            args.passphrase,
            args.password,
        )?,
    };
    ssh_install::test(&cfg).await
}

// ─── Runner request proxy (via SSH tunnel) ────────────────────────────────

async fn lookup(state: &AppState, id: &str) -> AppResult<(ServerRecord, String, u16)> {
    let all = state.storage.list().await?;
    let rec = all
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| AppError::NotFound(format!("server {id}")))?;
    let token = state.storage.get_token(id).await?;
    let creds = state.storage.get_ssh(id).await?;
    let port = state.tunnels.ensure(&rec, creds).await?;
    Ok((rec, token, port))
}

#[tauri::command]
pub async fn runner_get(
    server_id: String,
    path: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let (_, token, port) = lookup(&state, &server_id).await?;
    runner_client::get_json::<serde_json::Value>(port, &token, &path).await
}

#[tauri::command]
pub async fn runner_post(
    server_id: String,
    path: String,
    body: serde_json::Value,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let (_, token, port) = lookup(&state, &server_id).await?;
    runner_client::post_json::<serde_json::Value>(port, &token, &path, body).await
}

#[tauri::command]
pub async fn runner_delete(
    server_id: String,
    path: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let (_, token, port) = lookup(&state, &server_id).await?;
    runner_client::delete_json::<serde_json::Value>(port, &token, &path).await
}

#[derive(Serialize, Clone)]
struct StreamLine {
    stream_id: String,
    line: serde_json::Value,
}

#[tauri::command]
pub async fn runner_stream_post(
    server_id: String,
    path: String,
    body: serde_json::Value,
    stream_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let (_, token, port) = lookup(&state, &server_id).await?;
    let (tx, rx) = watch::channel(false);
    state.streams.lock().await.insert(stream_id.clone(), tx);

    let app = state.app.clone();
    let sid = stream_id.clone();
    tokio::spawn(async move {
        let sid_inner = sid.clone();
        let result = runner_client::stream_post(port, &token, &path, body, rx, |line| {
            let parsed: serde_json::Value = serde_json::from_str(line)
                .unwrap_or_else(|_| serde_json::Value::String(line.into()));
            let _ = app.emit(
                "runner_stream",
                StreamLine {
                    stream_id: sid_inner.clone(),
                    line: parsed,
                },
            );
        })
        .await;
        let _ = app.emit("runner_stream_end", &sid);
        if let Err(e) = result {
            let _ = app.emit("runner_stream_error", format!("{sid}: {e}"));
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn runner_stream_logs(
    server_id: String,
    container_id: String,
    stream_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let path = format!("/v1/containers/{container_id}/logs?follow=true&tail=200");
    spawn_stream(&state, server_id, stream_id, path).await
}

#[tauri::command]
pub async fn runner_stream_stats(
    server_id: String,
    container_id: Option<String>,
    stream_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let path = match container_id {
        Some(id) => format!("/v1/containers/{id}/stats"),
        None => "/v1/stats/stream".to_string(),
    };
    spawn_stream(&state, server_id, stream_id, path).await
}

async fn spawn_stream(
    state: &AppState,
    server_id: String,
    stream_id: String,
    path: String,
) -> AppResult<()> {
    let (_, token, port) = lookup(state, &server_id).await?;
    let (tx, rx) = watch::channel(false);
    state.streams.lock().await.insert(stream_id.clone(), tx);

    let app = state.app.clone();
    let sid = stream_id.clone();
    tokio::spawn(async move {
        let sid_inner = sid.clone();
        let result = runner_client::stream(port, &token, &path, rx, |line| {
            let parsed: serde_json::Value = serde_json::from_str(line)
                .unwrap_or_else(|_| serde_json::Value::String(line.into()));
            let _ = app.emit(
                "runner_stream",
                StreamLine {
                    stream_id: sid_inner.clone(),
                    line: parsed,
                },
            );
        })
        .await;
        let _ = app.emit("runner_stream_end", &sid);
        if let Err(e) = result {
            let _ = app.emit("runner_stream_error", format!("{sid}: {e}"));
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn cancel_stream(stream_id: String, state: State<'_, AppState>) -> AppResult<()> {
    if let Some(tx) = state.streams.lock().await.remove(&stream_id) {
        let _ = tx.send(true);
    }
    Ok(())
}

// ─── Real actions wired to SSH ────────────────────────────────────────────

#[tauri::command]
pub async fn restart_docker(server_id: String, state: State<'_, AppState>) -> AppResult<String> {
    let all = state.storage.list().await?;
    let rec = all.into_iter().find(|s| s.id == server_id)
        .ok_or_else(|| AppError::NotFound(format!("server {server_id}")))?;
    let creds = state.storage.get_ssh(&server_id).await?;
    let auth = match creds {
        StoredSshAuth::Key { private_key_path, passphrase } =>
            SshAuth::Key { private_key_path, passphrase },
        StoredSshAuth::Password { password } => SshAuth::Password { password },
    };
    let cfg = SshConfig {
        host: rec.host, port: rec.ssh_port, user: rec.ssh_user, auth,
    };
    ssh_install::run_remote_command(
        &cfg,
        "if [ \"$(id -u)\" = 0 ]; then SUDO=; else SUDO='sudo -n'; fi; \
         $SUDO systemctl restart docker && echo restarted",
    ).await
}

#[derive(Deserialize)]
pub struct FetchLogsArgs {
    pub server_id: String,
    /// number of lines to fetch (default 200)
    pub lines: Option<u32>,
}

#[tauri::command]
pub async fn fetch_runner_logs(args: FetchLogsArgs, state: State<'_, AppState>) -> AppResult<String> {
    let all = state.storage.list().await?;
    let rec = all.into_iter().find(|s| s.id == args.server_id)
        .ok_or_else(|| AppError::NotFound(format!("server {}", args.server_id)))?;
    let creds = state.storage.get_ssh(&args.server_id).await?;
    let auth = match creds {
        StoredSshAuth::Key { private_key_path, passphrase } =>
            SshAuth::Key { private_key_path, passphrase },
        StoredSshAuth::Password { password } => SshAuth::Password { password },
    };
    let cfg = SshConfig {
        host: rec.host, port: rec.ssh_port, user: rec.ssh_user, auth,
    };
    let lines = args.lines.unwrap_or(200);
    // journalctl needs to be readable by the user. On most systems any user can
    // read service logs, but if not, fall back to sudo.
    let cmd = format!(
        "if [ \"$(id -u)\" = 0 ]; then SUDO=; else SUDO='sudo -n'; fi; \
         $SUDO journalctl -u lockethq-runner -n {lines} --no-pager 2>&1 || \
         journalctl -u lockethq-runner -n {lines} --no-pager 2>&1"
    );
    ssh_install::run_remote_command(&cfg, &cmd).await
}

#[tauri::command]
pub async fn uninstall_runner(server_id: String, state: State<'_, AppState>) -> AppResult<String> {
    let all = state.storage.list().await?;
    let rec = all.into_iter().find(|s| s.id == server_id)
        .ok_or_else(|| AppError::NotFound(format!("server {server_id}")))?;
    let creds = state.storage.get_ssh(&server_id).await?;
    let auth = match creds {
        StoredSshAuth::Key { private_key_path, passphrase } =>
            SshAuth::Key { private_key_path, passphrase },
        StoredSshAuth::Password { password } => SshAuth::Password { password },
    };
    let cfg = SshConfig {
        host: rec.host.clone(), port: rec.ssh_port, user: rec.ssh_user.clone(), auth,
    };

    // Tear down the tunnel so we're not holding the SSH session.
    state.tunnels.drop_one(&server_id).await;

    let out = ssh_install::run_remote_command(
        &cfg,
        "set -e; \
         if [ \"$(id -u)\" = 0 ]; then SUDO=; else SUDO='sudo -n'; fi; \
         $SUDO systemctl disable --now lockethq-runner 2>/dev/null || true; \
         $SUDO rm -f /etc/systemd/system/lockethq-runner.service; \
         $SUDO systemctl daemon-reload; \
         $SUDO rm -f /usr/local/bin/lockethq-runner; \
         $SUDO rm -rf /etc/lockethq; \
         echo done",
    ).await?;

    // Now drop the local record + credentials.
    let mut all = state.storage.list().await?;
    all.retain(|s| s.id != server_id);
    state.storage.save(&all).await?;
    let _ = state.storage.delete_secret(&server_id).await;

    Ok(out)
}

#[tauri::command]
pub async fn update_runner_binary(server_id: String, state: State<'_, AppState>) -> AppResult<String> {
    let all = state.storage.list().await?;
    let rec = all.into_iter().find(|s| s.id == server_id)
        .ok_or_else(|| AppError::NotFound(format!("server {server_id}")))?;
    let creds = state.storage.get_ssh(&server_id).await?;
    let auth = match creds {
        StoredSshAuth::Key { private_key_path, passphrase } =>
            SshAuth::Key { private_key_path, passphrase },
        StoredSshAuth::Password { password } => SshAuth::Password { password },
    };
    let cfg = SshConfig {
        host: rec.host, port: rec.ssh_port, user: rec.ssh_user, auth,
    };

    let candidates = candidate_binary_dirs(&state.app);
    let (x, a, _) = read_runner_binaries(&candidates).await;
    if x.is_empty() && a.is_empty() {
        return Err(AppError::Other("no runner binaries available locally".into()));
    }
    state.tunnels.drop_one(&server_id).await;
    ssh_install::update_runner(&cfg, &x, &a).await
}

#[tauri::command]
pub async fn restart_runner(server_id: String, state: State<'_, AppState>) -> AppResult<String> {
    let all = state.storage.list().await?;
    let rec = all.into_iter().find(|s| s.id == server_id)
        .ok_or_else(|| AppError::NotFound(format!("server {server_id}")))?;
    let creds = state.storage.get_ssh(&server_id).await?;
    let auth = match creds {
        StoredSshAuth::Key { private_key_path, passphrase } =>
            SshAuth::Key { private_key_path, passphrase },
        StoredSshAuth::Password { password } => SshAuth::Password { password },
    };
    let cfg = SshConfig {
        host: rec.host, port: rec.ssh_port, user: rec.ssh_user, auth,
    };
    state.tunnels.drop_one(&server_id).await;
    ssh_install::run_remote_command(
        &cfg,
        "if [ \"$(id -u)\" = 0 ]; then SUDO=; else SUDO='sudo -n'; fi; \
         $SUDO systemctl restart lockethq-runner && echo restarted",
    ).await
}

#[derive(Deserialize)]
pub struct GenerateKeyArgs {
    pub path: String,
    pub passphrase: Option<String>,
}

#[tauri::command]
pub async fn generate_ssh_key(args: GenerateKeyArgs) -> AppResult<String> {
    let expanded = shellexpand_home(&args.path);
    // Ensure parent dir
    if let Some(parent) = std::path::Path::new(&expanded).parent() {
        std::fs::create_dir_all(parent)?;
    }
    let pass = args.passphrase.unwrap_or_default();
    let output = tokio::process::Command::new("ssh-keygen")
        .args(["-t", "ed25519", "-f", &expanded, "-N", &pass, "-C", "lockethq"])
        .output()
        .await?;
    if !output.status.success() {
        return Err(AppError::Other(format!(
            "ssh-keygen failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    Ok(expanded)
}

#[tauri::command]
pub async fn list_ssh_keys() -> AppResult<Vec<SshKeyEntry>> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Other("no home dir".into()))?;
    let ssh = home.join(".ssh");
    if !ssh.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    let mut rd = tokio::fs::read_dir(&ssh).await?;
    while let Some(entry) = rd.next_entry().await? {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip pub keys, known_hosts, config, etc.
        if name.ends_with(".pub") || name == "known_hosts" || name == "known_hosts.old" || name == "config" || name == "authorized_keys" {
            continue;
        }
        // Heuristic: read first line and check for OPENSSH PRIVATE KEY or RSA/EC/DSA marker.
        if let Ok(buf) = tokio::fs::read(&p).await {
            let head = String::from_utf8_lossy(&buf[..buf.len().min(200)]).to_string();
            let kind = if head.contains("OPENSSH PRIVATE KEY") {
                "ed25519/openssh"
            } else if head.contains("RSA PRIVATE KEY") {
                "rsa"
            } else if head.contains("EC PRIVATE KEY") {
                "ecdsa"
            } else if head.contains("PRIVATE KEY") {
                "unknown"
            } else {
                continue;
            };
            out.push(SshKeyEntry { path: p.display().to_string(), kind: kind.into() });
        }
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct SshKeyEntry { pub path: String, pub kind: String }

// ─── Docker Hub ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dockerhub_search(query: String) -> AppResult<serde_json::Value> {
    crate::dockerhub::search(&query).await
}

#[tauri::command]
pub async fn dockerhub_image_info(image: String) -> AppResult<serde_json::Value> {
    let (ns, name, tag) = crate::dockerhub::parse_image(&image);
    let repo = crate::dockerhub::repo_info(&ns, &name).await?;
    let tag = crate::dockerhub::tag_info(&ns, &name, &tag).await.unwrap_or(serde_json::Value::Null);
    Ok(serde_json::json!({
        "namespace": ns,
        "name": name,
        "info": repo,
        "tag": tag,
    }))
}

// ─── Cloudflare ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SetCfArgs { pub token: Option<String> }

#[tauri::command]
pub async fn cf_save_token(args: SetCfArgs, state: State<'_, AppState>) -> AppResult<bool> {
    if let Some(t) = &args.token {
        if !crate::cloudflare::verify_token(t).await? {
            return Err(AppError::Other("cloudflare token did not verify".into()));
        }
    }
    state.storage.put_cloudflare_token(args.token).await?;
    Ok(true)
}

#[tauri::command]
pub async fn cf_has_token(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(state.storage.get_cloudflare_token().await?.is_some())
}

#[tauri::command]
pub async fn cf_list_zones(state: State<'_, AppState>) -> AppResult<Vec<crate::cloudflare::Zone>> {
    let t = state.storage.get_cloudflare_token().await?
        .ok_or_else(|| AppError::Other("no cloudflare token configured".into()))?;
    crate::cloudflare::list_zones(&t).await
}

#[tauri::command]
pub async fn cf_list_records(zone_id: String, state: State<'_, AppState>) -> AppResult<Vec<crate::cloudflare::DnsRecord>> {
    let t = state.storage.get_cloudflare_token().await?
        .ok_or_else(|| AppError::Other("no cloudflare token configured".into()))?;
    crate::cloudflare::list_records(&t, &zone_id).await
}

#[derive(Deserialize)]
pub struct CfCreateArgs {
    pub zone_id: String,
    pub name: String,
    pub content: String,
    #[serde(default = "default_proxied")]
    pub proxied: bool,
}
fn default_proxied() -> bool { true }

#[tauri::command]
pub async fn cf_create_record(args: CfCreateArgs, state: State<'_, AppState>) -> AppResult<crate::cloudflare::DnsRecord> {
    let t = state.storage.get_cloudflare_token().await?
        .ok_or_else(|| AppError::Other("no cloudflare token configured".into()))?;
    crate::cloudflare::create_record(
        &t,
        &args.zone_id,
        crate::cloudflare::NewRecord {
            kind: "A",
            name: &args.name,
            content: &args.content,
            proxied: args.proxied,
            ttl: 1,
        },
    ).await
}

#[derive(Deserialize)]
pub struct CfDeleteArgs { pub zone_id: String, pub record_id: String }

#[tauri::command]
pub async fn cf_delete_record(args: CfDeleteArgs, state: State<'_, AppState>) -> AppResult<()> {
    let t = state.storage.get_cloudflare_token().await?
        .ok_or_else(|| AppError::Other("no cloudflare token configured".into()))?;
    crate::cloudflare::delete_record(&t, &args.zone_id, &args.record_id).await
}

fn shellexpand_home(path: &str) -> String {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped).display().to_string();
        }
    }
    if path == "~" {
        if let Some(home) = dirs::home_dir() { return home.display().to_string(); }
    }
    path.to_string()
}
