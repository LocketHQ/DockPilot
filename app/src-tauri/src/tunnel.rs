//! SSH tunnel manager. Each remote server gets ONE long-lived SSH session
//! and a local TCP listener on 127.0.0.1:<random-port> that proxies each
//! accepted connection to 127.0.0.1:8765 on the remote box.
//!
//! Why: cloud firewalls usually block arbitrary ports. The runner binds
//! 0.0.0.0:8765 on the server but the public IP isn't reachable on that
//! port. SSH is the only way in, so we re-use that channel.

use crate::error::{AppError, AppResult};
use crate::ssh_install::{Handler, SshAuth, SshConfig};
use crate::storage::StoredSshAuth;
use lockethq_shared::ServerRecord;
use russh::client;
use russh::keys::HashAlg;
use russh_keys::key::PrivateKeyWithHashAlg;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

pub struct TunnelManager {
    inner: Mutex<HashMap<String, Tunnel>>,
}

struct Tunnel {
    local_port: u16,
    // keeping the JoinHandle alive prevents the accept loop from dropping.
    _task: tokio::task::JoinHandle<()>,
    _session: Arc<client::Handle<Handler>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self { inner: Mutex::new(HashMap::new()) }
    }

    /// Returns the local port for this server. Opens the SSH session and
    /// starts the forwarder on first call. If a previous tunnel has died,
    /// drops it and re-opens.
    pub async fn ensure(
        &self,
        server: &ServerRecord,
        creds: StoredSshAuth,
    ) -> AppResult<u16> {
        let mut map = self.inner.lock().await;

        if let Some(t) = map.get(&server.id) {
            if !t._task.is_finished() {
                return Ok(t.local_port);
            }
        }
        map.remove(&server.id);

        let auth = match creds {
            StoredSshAuth::Key { private_key_path, passphrase } =>
                SshAuth::Key { private_key_path, passphrase },
            StoredSshAuth::Password { password } => SshAuth::Password { password },
        };
        let cfg = SshConfig {
            host: server.host.clone(),
            port: server.ssh_port,
            user: server.ssh_user.clone(),
            auth,
        };

        let session = open_session(&cfg).await?;
        let session = Arc::new(session);

        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let local_port = listener.local_addr()?.port();
        let remote_port = server.runner_port;
        let sess = Arc::clone(&session);

        let task = tokio::spawn(async move {
            loop {
                let (mut socket, _peer) = match listener.accept().await {
                    Ok(x) => x,
                    Err(e) => {
                        tracing::warn!(error = %e, "tunnel accept failed");
                        break;
                    }
                };
                let sess = Arc::clone(&sess);
                tokio::spawn(async move {
                    if let Err(e) = forward(sess, &mut socket, remote_port).await {
                        tracing::debug!(error = %e, "tunnel forward closed");
                    }
                });
            }
        });

        map.insert(
            server.id.clone(),
            Tunnel { local_port, _task: task, _session: session },
        );
        Ok(local_port)
    }

    /// Drop a tunnel (called when the user removes a server).
    pub async fn drop_one(&self, server_id: &str) {
        self.inner.lock().await.remove(server_id);
    }
}

async fn open_session(cfg: &SshConfig) -> AppResult<client::Handle<Handler>> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(60 * 60)),
        keepalive_interval: Some(Duration::from_secs(30)),
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
        return Err(AppError::Ssh("ssh auth refused (tunnel)".into()));
    }
    Ok(session)
}

async fn forward(
    session: Arc<client::Handle<Handler>>,
    socket: &mut TcpStream,
    remote_port: u16,
) -> AppResult<()> {
    let mut channel = session
        .channel_open_direct_tcpip("127.0.0.1", remote_port as u32, "127.0.0.1", 0)
        .await?;

    // Pipe bytes both directions until either side closes.
    let (mut sock_r, mut sock_w) = socket.split();
    let mut buf_in = vec![0u8; 16 * 1024];

    loop {
        tokio::select! {
            // socket → channel
            n = sock_r.read(&mut buf_in) => {
                match n {
                    Ok(0) | Err(_) => { let _ = channel.eof().await; break; }
                    Ok(n) => {
                        if channel.data(&buf_in[..n]).await.is_err() { break; }
                    }
                }
            }
            // channel → socket
            msg = channel.wait() => {
                match msg {
                    Some(russh::ChannelMsg::Data { ref data }) => {
                        if sock_w.write_all(data).await.is_err() { break; }
                    }
                    Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    }
    Ok(())
}
