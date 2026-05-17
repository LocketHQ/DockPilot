//! Thin Docker Hub client. Lives on the Rust side because hub.docker.com
//! rejects browser-origin requests (and Tauri's WKWebView's origin is
//! `tauri://localhost`, which fails CORS).

use crate::error::AppResult;
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;

fn client() -> AppResult<Client> {
    Ok(Client::builder()
        .user_agent("DockPilot/0.1 (+https://lockethq.local)")
        .timeout(Duration::from_secs(15))
        .build()?)
}

pub async fn search(query: &str) -> AppResult<Value> {
    let url = format!(
        "https://hub.docker.com/v2/search/repositories/?query={q}&page_size=12",
        q = urlencoding::encode(query),
    );
    let resp = client()?.get(&url).send().await?;
    Ok(resp.json().await?)
}

pub async fn repo_info(namespace: &str, name: &str) -> AppResult<Value> {
    let url = format!(
        "https://hub.docker.com/v2/repositories/{}/{}",
        namespace, name
    );
    Ok(client()?.get(&url).send().await?.json().await?)
}

pub async fn tag_info(namespace: &str, name: &str, tag: &str) -> AppResult<Value> {
    let url = format!(
        "https://hub.docker.com/v2/repositories/{}/{}/tags/{}",
        namespace, name, tag
    );
    let resp = client()?.get(&url).send().await?;
    if !resp.status().is_success() {
        return Ok(serde_json::Value::Null);
    }
    Ok(resp.json().await?)
}

/// Parses `nginx`, `nginx:alpine`, `bitnami/postgres:15.6` into (namespace, name, tag).
pub fn parse_image(image: &str) -> (String, String, String) {
    let (name_part, tag) = match image.split_once(':') {
        Some((n, t)) => (n.to_string(), t.to_string()),
        None => (image.to_string(), "latest".to_string()),
    };
    let (namespace, name) = match name_part.split_once('/') {
        Some((ns, n)) => (ns.to_string(), n.to_string()),
        None => ("library".to_string(), name_part),
    };
    (namespace, name, tag)
}
