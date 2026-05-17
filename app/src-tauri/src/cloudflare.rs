//! Minimal Cloudflare API client — just enough to list zones, list DNS
//! records, and CRUD A records. Auth is a per-user API token (scoped to
//! Zone:DNS:Edit) stored in our local secrets file.

use crate::error::{AppError, AppResult};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const BASE: &str = "https://api.cloudflare.com/client/v4";

fn client() -> AppResult<Client> {
    Ok(Client::builder().timeout(Duration::from_secs(20)).build()?)
}

#[derive(Debug, Deserialize)]
struct CfResp<T> {
    success: bool,
    #[serde(default)]
    errors: Vec<CfError>,
    result: Option<T>,
}

#[derive(Debug, Deserialize)]
struct CfError { code: i64, message: String }

fn unwrap<T>(resp: CfResp<T>) -> AppResult<T> {
    if !resp.success {
        let msg = resp.errors.iter()
            .map(|e| format!("{}: {}", e.code, e.message))
            .collect::<Vec<_>>().join("; ");
        return Err(AppError::Other(format!("cloudflare api error: {msg}")));
    }
    resp.result.ok_or_else(|| AppError::Other("cloudflare returned no result".into()))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Zone {
    pub id: String,
    pub name: String,
    pub status: String,
}

pub async fn list_zones(token: &str) -> AppResult<Vec<Zone>> {
    let resp: CfResp<Vec<Zone>> = client()?
        .get(format!("{BASE}/zones?per_page=50"))
        .bearer_auth(token)
        .send()
        .await?
        .json()
        .await?;
    unwrap(resp)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DnsRecord {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    pub content: String,
    pub proxied: bool,
    pub ttl: u32,
}

pub async fn list_records(token: &str, zone_id: &str) -> AppResult<Vec<DnsRecord>> {
    let resp: CfResp<Vec<DnsRecord>> = client()?
        .get(format!("{BASE}/zones/{zone_id}/dns_records?per_page=100"))
        .bearer_auth(token)
        .send()
        .await?
        .json()
        .await?;
    unwrap(resp)
}

#[derive(Debug, Serialize)]
pub struct NewRecord<'a> {
    #[serde(rename = "type")]
    pub kind: &'a str,
    pub name: &'a str,
    pub content: &'a str,
    pub proxied: bool,
    pub ttl: u32,
}

pub async fn create_record(token: &str, zone_id: &str, rec: NewRecord<'_>) -> AppResult<DnsRecord> {
    let resp: CfResp<DnsRecord> = client()?
        .post(format!("{BASE}/zones/{zone_id}/dns_records"))
        .bearer_auth(token)
        .json(&rec)
        .send()
        .await?
        .json()
        .await?;
    unwrap(resp)
}

pub async fn delete_record(token: &str, zone_id: &str, record_id: &str) -> AppResult<()> {
    let resp: CfResp<serde_json::Value> = client()?
        .delete(format!("{BASE}/zones/{zone_id}/dns_records/{record_id}"))
        .bearer_auth(token)
        .send()
        .await?
        .json()
        .await?;
    let _ = unwrap(resp)?;
    Ok(())
}

/// Verify a token is valid (`GET /user/tokens/verify`).
pub async fn verify_token(token: &str) -> AppResult<bool> {
    let resp: CfResp<serde_json::Value> = client()?
        .get(format!("{BASE}/user/tokens/verify"))
        .bearer_auth(token)
        .send()
        .await?
        .json()
        .await?;
    Ok(resp.success)
}
