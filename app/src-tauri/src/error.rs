use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("ssh: {0}")]
    Ssh(String),
    #[error("ssh key: {0}")]
    SshKey(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("runner error ({status}): {body}")]
    Runner { status: u16, body: String },
    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        ser.serialize_str(&self.to_string())
    }
}

impl From<russh::Error> for AppError {
    fn from(e: russh::Error) -> Self { AppError::Ssh(e.to_string()) }
}
impl From<russh::keys::Error> for AppError {
    fn from(e: russh::keys::Error) -> Self { AppError::SshKey(e.to_string()) }
}
impl From<russh::keys::ssh_key::Error> for AppError {
    fn from(e: russh::keys::ssh_key::Error) -> Self { AppError::SshKey(e.to_string()) }
}
impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self { AppError::Other(e.to_string()) }
}

pub type AppResult<T> = Result<T, AppError>;
