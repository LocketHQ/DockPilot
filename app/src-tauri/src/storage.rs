//! Server registry + secrets persisted under the app data dir.
//!
//! - `servers.json`: ServerRecord[]
//! - `secrets.json`: bearer tokens + SSH credentials (chmod 600)

use crate::error::{AppError, AppResult};
use lockethq_shared::ServerRecord;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf};
use tauri::{AppHandle, Manager};
use tokio::fs;

#[derive(Default, Serialize, Deserialize)]
struct Servers {
    servers: Vec<ServerRecord>,
}

#[derive(Default, Serialize, Deserialize)]
struct Secrets {
    #[serde(default)]
    tokens: HashMap<String, String>,
    #[serde(default)]
    ssh: HashMap<String, StoredSshAuth>,
    #[serde(default)]
    cloudflare_token: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum StoredSshAuth {
    Key {
        private_key_path: String,
        passphrase: Option<String>,
    },
    Password {
        password: String,
    },
}

#[derive(Clone)]
pub struct Storage {
    dir: PathBuf,
}

impl Storage {
    pub fn new(app: &AppHandle) -> AppResult<Self> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::Other(format!("app_data_dir: {e}")))?;
        std::fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    fn servers_path(&self) -> PathBuf { self.dir.join("servers.json") }
    fn secrets_path(&self) -> PathBuf { self.dir.join("secrets.json") }

    pub async fn list(&self) -> AppResult<Vec<ServerRecord>> {
        match fs::read(self.servers_path()).await {
            Ok(buf) => Ok(serde_json::from_slice::<Servers>(&buf)?.servers),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn save(&self, list: &[ServerRecord]) -> AppResult<()> {
        let s = Servers { servers: list.to_vec() };
        let buf = serde_json::to_vec_pretty(&s)?;
        fs::write(self.servers_path(), buf).await?;
        Ok(())
    }

    pub async fn put_token(&self, server_id: &str, token: &str) -> AppResult<()> {
        let mut secrets = self.read_secrets().await?;
        secrets.tokens.insert(server_id.into(), token.into());
        self.write_secrets(&secrets).await
    }

    pub async fn get_token(&self, server_id: &str) -> AppResult<String> {
        let s = self.read_secrets().await?;
        s.tokens.get(server_id).cloned()
            .ok_or_else(|| AppError::NotFound(format!("token for {server_id}")))
    }

    pub async fn put_ssh(&self, server_id: &str, auth: StoredSshAuth) -> AppResult<()> {
        let mut s = self.read_secrets().await?;
        s.ssh.insert(server_id.into(), auth);
        self.write_secrets(&s).await
    }

    pub async fn get_ssh(&self, server_id: &str) -> AppResult<StoredSshAuth> {
        let s = self.read_secrets().await?;
        s.ssh.get(server_id).cloned()
            .ok_or_else(|| AppError::NotFound(format!("ssh creds for {server_id}")))
    }

    pub async fn delete_secret(&self, server_id: &str) -> AppResult<()> {
        let mut s = self.read_secrets().await?;
        s.tokens.remove(server_id);
        s.ssh.remove(server_id);
        self.write_secrets(&s).await
    }

    pub async fn put_cloudflare_token(&self, token: Option<String>) -> AppResult<()> {
        let mut s = self.read_secrets().await?;
        s.cloudflare_token = token;
        self.write_secrets(&s).await
    }
    pub async fn get_cloudflare_token(&self) -> AppResult<Option<String>> {
        Ok(self.read_secrets().await?.cloudflare_token)
    }

    async fn read_secrets(&self) -> AppResult<Secrets> {
        match fs::read(self.secrets_path()).await {
            Ok(buf) => Ok(serde_json::from_slice(&buf)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Secrets::default()),
            Err(e) => Err(e.into()),
        }
    }

    async fn write_secrets(&self, s: &Secrets) -> AppResult<()> {
        let buf = serde_json::to_vec_pretty(s)?;
        fs::write(self.secrets_path(), buf).await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut p = std::fs::metadata(self.secrets_path())?.permissions();
            p.set_mode(0o600);
            std::fs::set_permissions(self.secrets_path(), p)?;
        }
        Ok(())
    }
}
