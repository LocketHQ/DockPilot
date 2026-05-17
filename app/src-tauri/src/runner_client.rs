//! Thin HTTP client for talking to a remote DockPilot Runner.
//!
//! For v1 we trust the runner's self-signed TLS cert (verified against the
//! pinned cert we recorded during install). Streaming responses are exposed
//! as `bytes::Bytes` streams the caller can forward as Tauri events.

use crate::error::{AppError, AppResult};
use futures_util::StreamExt;
use reqwest::Client;
use serde::de::DeserializeOwned;
use std::time::Duration;

pub fn client() -> AppResult<Client> {
    // No overall timeout; some ops (image pulls, docker build, compose up
    // pulling several images) legitimately take minutes. We rely on the
    // tunnel + remote runner to surface real failures.
    let c = Client::builder()
        // Keep a connect timeout so a dead tunnel fails fast.
        .connect_timeout(Duration::from_secs(15))
        // Pool-level idle timeout — not request-level.
        .pool_idle_timeout(Duration::from_secs(90))
        .build()?;
    Ok(c)
}

fn base_url(local_port: u16) -> String {
    // Always 127.0.0.1 — the tunnel manager forwards to the remote runner.
    format!("http://127.0.0.1:{local_port}")
}

pub async fn get_json<T: DeserializeOwned>(port: u16, token: &str, path: &str) -> AppResult<T> {
    let url = format!("{}{path}", base_url(port));
    let resp = client()?.get(url).bearer_auth(token).send().await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Runner { status: status.as_u16(), body });
    }
    Ok(resp.json::<T>().await?)
}

pub async fn delete_json<T: DeserializeOwned>(port: u16, token: &str, path: &str) -> AppResult<T> {
    let url = format!("{}{path}", base_url(port));
    let resp = client()?.delete(url).bearer_auth(token).send().await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Runner { status: status.as_u16(), body });
    }
    Ok(resp.json::<T>().await?)
}

pub async fn post_json<T: DeserializeOwned>(
    port: u16, token: &str, path: &str, body: serde_json::Value,
) -> AppResult<T> {
    let url = format!("{}{path}", base_url(port));
    let resp = client()?.post(url).bearer_auth(token).json(&body).send().await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Runner { status: status.as_u16(), body });
    }
    Ok(resp.json::<T>().await?)
}

pub async fn stream_post<F>(
    port: u16, token: &str, path: &str, body: serde_json::Value,
    cancel: tokio::sync::watch::Receiver<bool>,
    mut on_line: F,
) -> AppResult<()>
where F: FnMut(&str) {
    let url = format!("{}{path}", base_url(port));
    let mut resp = client()?
        .post(url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .bytes_stream();

    let mut buf = Vec::with_capacity(4096);
    loop {
        if *cancel.borrow() { break; }
        tokio::select! {
            chunk = resp.next() => {
                match chunk {
                    None => break,
                    Some(Err(e)) => return Err(e.into()),
                    Some(Ok(bytes)) => {
                        buf.extend_from_slice(&bytes);
                        while let Some(nl) = buf.iter().position(|b| *b == b'\n') {
                            let line: Vec<u8> = buf.drain(..=nl).collect();
                            let trimmed = std::str::from_utf8(&line[..line.len().saturating_sub(1)])
                                .unwrap_or("");
                            if !trimmed.is_empty() { on_line(trimmed); }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

pub async fn stream<F>(
    port: u16, token: &str, path: &str,
    cancel: tokio::sync::watch::Receiver<bool>,
    mut on_line: F,
) -> AppResult<()>
where F: FnMut(&str) {
    let url = format!("{}{path}", base_url(port));
    let mut resp = client()?
        .get(url)
        .bearer_auth(token)
        .send()
        .await?
        .error_for_status()?
        .bytes_stream();

    let mut buf = Vec::with_capacity(4096);
    loop {
        if *cancel.borrow() { break; }
        tokio::select! {
            chunk = resp.next() => {
                match chunk {
                    None => break,
                    Some(Err(e)) => return Err(e.into()),
                    Some(Ok(bytes)) => {
                        buf.extend_from_slice(&bytes);
                        while let Some(nl) = buf.iter().position(|b| *b == b'\n') {
                            let line: Vec<u8> = buf.drain(..=nl).collect();
                            let trimmed = std::str::from_utf8(&line[..line.len().saturating_sub(1)])
                                .unwrap_or("");
                            if !trimmed.is_empty() { on_line(trimmed); }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
