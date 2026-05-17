//! SSH client used to (a) test connectivity and (b) install + start the
//! DockPilot Runner agent on a remote server.
//!
//! Install flow:
//!   1. SSH in with the user-supplied private key.
//!   2. Detect remote arch (uname -m) — pick the matching runner binary.
//!   3. SCP the binary to /usr/local/bin/lockethq-runner.
//!   4. Generate a fresh bearer token, write /etc/lockethq/runner.toml.
//!   5. Write the systemd unit, enable + start it.
//!   6. Return the (host, port, token) so the desktop can talk to it.
//!
//! In production we'd also pin the self-signed TLS cert here; the runner
//! generates one on first launch and writes it under /etc/lockethq/.

use crate::error::{AppError, AppResult};
use rand::RngCore;
use russh::{client, ChannelMsg};
use russh_keys::key::PrivateKeyWithHashAlg;
use russh::keys::HashAlg;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuth,
}

pub enum SshAuth {
    Key { private_key_path: String, passphrase: Option<String> },
    Password { password: String },
}

pub struct Handler;
#[async_trait::async_trait]
impl client::Handler for Handler {
    type Error = russh::Error;
    async fn check_server_key(
        &mut self,
        _key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // v1: trust on first use — frontend prompts the user to confirm fingerprint.
        // Production: pin the fingerprint and verify on subsequent connections.
        Ok(true)
    }
}

async fn connect(cfg: &SshConfig) -> AppResult<client::Handle<Handler>> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(45)),
        ..<_>::default()
    });
    let mut session = client::connect(config, (cfg.host.as_str(), cfg.port), Handler).await?;
    let ok = match &cfg.auth {
        SshAuth::Key { private_key_path, passphrase } => {
            let key = russh::keys::load_secret_key(private_key_path, passphrase.as_deref())?;
            let auth = PrivateKeyWithHashAlg::new(Arc::new(key), Some(HashAlg::Sha256))?;
            session.authenticate_publickey(&cfg.user, auth).await?
        }
        SshAuth::Password { password } => {
            session.authenticate_password(&cfg.user, password).await?
        }
    };
    if !ok {
        return Err(AppError::Ssh(format!("ssh auth refused for {}", cfg.user)));
    }
    Ok(session)
}

async fn exec(session: &client::Handle<Handler>, cmd: &str) -> AppResult<(i32, String, String)> {
    let mut channel = session.channel_open_session().await?;
    channel.exec(true, cmd).await?;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut code: i32 = -1;
    // Wait for `Close` rather than the first `Eof` — data can still arrive
    // between Eof and Close, and ExitStatus can arrive before the final
    // Data chunk. Breaking too early gives us empty stdout.
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { ref data } => stdout.extend_from_slice(data),
            ChannelMsg::ExtendedData { ref data, ext } => {
                if ext == 1 { stderr.extend_from_slice(data); }
            }
            ChannelMsg::ExitStatus { exit_status } => code = exit_status as i32,
            ChannelMsg::Close => break,
            _ => {}
        }
    }
    let out = String::from_utf8_lossy(&stdout).into_owned();
    let err = String::from_utf8_lossy(&stderr).into_owned();
    tracing::debug!(cmd, code, stdout_len = out.len(), stderr_len = err.len(), "ssh exec");
    Ok((code, out, err))
}

async fn upload(
    session: &client::Handle<Handler>,
    remote_path: &str,
    payload: &[u8],
    mode: &str,
    sudo: &str,
) -> AppResult<()> {
    // Pipe binary in via stdin, capture into /tmp, then move into place.
    // We split the work into two steps to avoid making sudo consume stdin.
    let tmp = format!("/tmp/lockethq-upload-{}", rand_suffix());

    // Step 1: write payload to a user-writable tmp file via cat.
    let mut channel = session.channel_open_session().await?;
    let cmd = format!("cat > {tmp}");
    channel.exec(true, cmd).await?;
    channel.data(payload).await?;
    channel.eof().await?;
    let mut code: i32 = -1;
    let mut stderr = Vec::new();
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::ExtendedData { ref data, ext } if ext == 1 => stderr.extend_from_slice(data),
            ChannelMsg::ExitStatus { exit_status } => code = exit_status as i32,
            ChannelMsg::Close => break,
            _ => {}
        }
    }
    if code != 0 {
        return Err(AppError::Ssh(format!(
            "writing tmp file failed (exit {code}): {}",
            String::from_utf8_lossy(&stderr)
        )));
    }

    // Step 2: move into place + chmod, with sudo (or not).
    let mv = format!(
        "{sudo} mkdir -p $(dirname {remote_path}) && \
         {sudo} mv {tmp} {remote_path} && \
         {sudo} chmod {mode} {remote_path}"
    );
    let (mvc, _, mverr) = exec(session, &mv).await?;
    if mvc != 0 {
        return Err(AppError::Ssh(format!("install of {remote_path} failed (exit {mvc}): {mverr}")));
    }
    Ok(())
}

fn rand_suffix() -> String {
    use rand::Rng;
    let n: u64 = rand::thread_rng().gen();
    format!("{n:016x}")
}

/// Returns "sudo -n" if we are not root, or "" if we are. Probes the remote.
async fn detect_sudo(session: &client::Handle<Handler>) -> AppResult<&'static str> {
    let (_, who, _) = exec(session, "id -u").await?;
    if who.trim() == "0" {
        Ok("")
    } else {
        // Make sure passwordless sudo works.
        let (code, _, err) = exec(session, "sudo -n true").await?;
        if code != 0 {
            return Err(AppError::Ssh(format!(
                "this user is not root and passwordless sudo is not configured. \
                 Either log in as root, run `visudo` to add `{user} ALL=(ALL) NOPASSWD: ALL`, \
                 or use a root account. sudo said: {err}",
                user = "<your-user>"
            )));
        }
        Ok("sudo -n")
    }
}

pub async fn test(cfg: &SshConfig) -> AppResult<String> {
    let session = connect(cfg).await?;
    let (_, out, _) = exec(&session, "uname -a && docker --version || true").await?;
    Ok(out)
}

/// Run `get.docker.com` (the official one-liner) to install Docker on the
/// remote box. Works on Ubuntu/Debian/Fedora/Alpine/CentOS/RHEL because the
/// script auto-detects the distro and uses the right package manager.
async fn install_docker(session: &client::Handle<Handler>, sudo: &str) -> AppResult<()> {
    // Make sure we have curl OR wget. Try to install one if neither is there.
    let (_, has, _) = exec(session, "command -v curl || command -v wget || true").await?;
    let fetcher = if !has.trim().is_empty() {
        if has.contains("curl") { "curl" } else { "wget" }
    } else {
        // Best-effort: apt or apk to grab curl.
        let bootstrap = format!(
            "{sudo} sh -c 'apt-get update -qq && apt-get install -y curl' 2>/dev/null || \
             {sudo} sh -c 'apk add --no-cache curl' 2>/dev/null || \
             {sudo} sh -c 'yum install -y curl' 2>/dev/null || true"
        );
        let _ = exec(session, &bootstrap).await?;
        "curl"
    };

    // Run the official install script — universal across distros.
    let pull = if fetcher == "curl" {
        "curl -fsSL https://get.docker.com -o /tmp/get-docker.sh"
    } else {
        "wget -qO /tmp/get-docker.sh https://get.docker.com"
    };
    let cmd = format!(
        "{pull} && {sudo} sh /tmp/get-docker.sh && rm -f /tmp/get-docker.sh && \
         {sudo} systemctl enable --now docker"
    );
    let (code, _, err) = exec(session, &cmd).await?;
    if code != 0 {
        return Err(AppError::Ssh(format!("docker install failed (exit {code}): {err}")));
    }
    // Verify it actually came up.
    let (_, dout, derr) = exec(session, "docker --version 2>&1").await?;
    if dout.trim().is_empty() {
        return Err(AppError::Ssh(format!("docker reported as installed but `docker --version` is empty: {derr}")));
    }
    Ok(())
}

/// Replace the runner binary on a remote box (no full reinstall) and
/// restart the service. Used by the "Update runner" menu action.
pub async fn update_runner(
    cfg: &SshConfig,
    runner_x86_64: &[u8],
    runner_aarch64: &[u8],
) -> AppResult<String> {
    let session = connect(cfg).await?;
    let sudo = detect_sudo(&session).await?;
    let (_, arch_out, _) = exec(&session, "uname -m").await?;
    let arch = arch_out.trim().to_string();
    let binary: &[u8] = match arch.as_str() {
        "x86_64" | "amd64" => {
            if runner_x86_64.is_empty() {
                return Err(AppError::Ssh("no x86_64 runner binary bundled".into()));
            }
            runner_x86_64
        }
        "aarch64" | "arm64" => {
            if runner_aarch64.is_empty() {
                return Err(AppError::Ssh("no aarch64 runner binary bundled".into()));
            }
            runner_aarch64
        }
        other => return Err(AppError::Ssh(format!("unsupported arch: {other}"))),
    };
    upload(&session, "/usr/local/bin/lockethq-runner", binary, "0755", sudo).await?;
    let (code, _, err) = exec(
        &session,
        &format!("{sudo} systemctl restart lockethq-runner && echo updated"),
    ).await?;
    if code != 0 {
        return Err(AppError::Ssh(format!("restart failed: {err}")));
    }
    Ok(format!("runner updated to {} bytes ({arch})", binary.len()))
}

/// One-shot remote command. Opens a new SSH session, runs the command,
/// returns combined stdout (or error). Used for management actions that
/// happen rarely — for hot-path traffic we use the tunnel manager.
pub async fn run_remote_command(cfg: &SshConfig, cmd: &str) -> AppResult<String> {
    let session = connect(cfg).await?;
    let (code, out, err) = exec(&session, cmd).await?;
    if code != 0 {
        return Err(AppError::Ssh(format!("exit {code}: {err}")));
    }
    Ok(out)
}

#[derive(Debug)]
pub struct InstallResult {
    pub token: String,
    pub remote_port: u16,
    pub arch: String,
}

/// Install the runner. `runner_x86_64` and `runner_aarch64` are the
/// pre-built static Linux binaries embedded in the Tauri app.
pub async fn install(
    cfg: &SshConfig,
    runner_x86_64: &[u8],
    runner_aarch64: &[u8],
    remote_port: u16,
    install_docker_if_missing: bool,
) -> AppResult<InstallResult> {
    let session = connect(cfg).await?;
    let sudo = detect_sudo(&session).await?;

    // 0. preflight — make sure Docker is installed.
    let (dc, dout, _) = exec(&session, "command -v docker || true").await?;
    let _ = dc;
    let has_docker = !dout.trim().is_empty();
    if !has_docker {
        if !install_docker_if_missing {
            return Err(AppError::Ssh("DOCKER_MISSING".into()));
        }
        install_docker(&session, sudo).await?;
    }

    // 1. detect arch
    let (code, arch_out, arch_err) = exec(&session, "uname -m").await?;
    let arch = arch_out.trim().to_string();
    if arch.is_empty() {
        return Err(AppError::Ssh(format!(
            "could not detect remote arch (uname -m exit={code}, stdout={arch_out:?}, stderr={arch_err:?})"
        )));
    }
    let binary: &[u8] = match arch.as_str() {
        "x86_64" | "amd64" => {
            if runner_x86_64.is_empty() {
                return Err(AppError::Ssh("remote is x86_64 but no x86_64 runner binary is bundled".into()));
            }
            runner_x86_64
        }
        "aarch64" | "arm64" => {
            if runner_aarch64.is_empty() {
                return Err(AppError::Ssh("remote is aarch64 but no aarch64 runner binary is bundled".into()));
            }
            runner_aarch64
        }
        other => return Err(AppError::Ssh(format!("unsupported arch: {other}"))),
    };

    // 2. upload runner
    upload(&session, "/usr/local/bin/lockethq-runner", binary, "0755", sudo).await?;

    // 3. create /etc/lockethq and config + generate token
    let mut tok_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut tok_bytes);
    let token = hex::encode(tok_bytes);

    let config_toml = format!(
        "# DockPilot Runner config\nbind = \"0.0.0.0:{port}\"\ntoken = \"{token}\"\n",
        port = remote_port, token = token
    );

    let (code, _, err) = exec(
        &session,
        &format!("{sudo} mkdir -p /etc/lockethq && {sudo} chmod 0755 /etc/lockethq"),
    ).await?;
    if code != 0 { return Err(AppError::Ssh(format!("mkdir /etc/lockethq: {err}"))); }

    upload(&session, "/etc/lockethq/runner.toml", config_toml.as_bytes(), "0640", sudo).await?;

    // 4. systemd unit
    let unit = include_str!("../../../runner/lockethq-runner.service");
    upload(
        &session,
        "/etc/systemd/system/lockethq-runner.service",
        unit.as_bytes(),
        "0644",
        sudo,
    ).await?;

    // 5. reload + enable + start
    let (code, _, err) = exec(
        &session,
        &format!(
            "{sudo} systemctl daemon-reload && \
             {sudo} systemctl enable --now lockethq-runner.service && \
             {sudo} systemctl is-active lockethq-runner.service"
        ),
    ).await?;
    if code != 0 { return Err(AppError::Ssh(format!("systemctl: {err}"))); }

    Ok(InstallResult { token, remote_port, arch })
}

/// SSH local-port-forward used at runtime. Each server gets one tunnel
/// from a host-local port (the same as runner_port for simplicity) to
/// 127.0.0.1:runner_port on the remote box.
///
/// For v1 this just returns the SshConfig — actual tunnelling is handled
/// by spawning `ssh -L` via the system ssh client (or by using russh's
/// `direct_tcpip` channels). Wiring is in `commands::add_server`.
pub fn _unused(_p: &Path) {}
