//! File-system browser scoped to a container's bind/volume mounts.
//!
//! Reads/writes are only allowed if the requested absolute path is a
//! descendant of one of the container's mount sources. This prevents the
//! API from being a backdoor onto the host filesystem.

use anyhow::{anyhow, bail, Context, Result};
use bollard::Docker;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub kind: String, // "file" | "dir" | "link" | "other"
    pub size: Option<u64>,
    pub modified: Option<i64>,
    pub read_only_view: bool,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FsView {
    Dir { path: String, entries: Vec<DirEntry>, root: String, read_only: bool },
    File { path: String, content: String, size: u64, read_only: bool, truncated: bool },
}

#[derive(Deserialize)]
pub struct FsWrite { pub content: String }

const MAX_FILE_READ_BYTES: u64 = 2 * 1024 * 1024;
const MAX_FILE_WRITE_BYTES: usize = 4 * 1024 * 1024;

async fn container_mounts(docker: &Docker, id: &str) -> Result<Vec<(PathBuf, bool)>> {
    let det = docker.inspect_container(id, None).await?;
    let mounts = det.mounts.unwrap_or_default();
    let mut out = Vec::new();
    for m in mounts {
        if let Some(src) = m.source {
            if !src.is_empty() {
                let read_only = !m.rw.unwrap_or(true);
                out.push((PathBuf::from(src), read_only));
            }
        }
    }
    Ok(out)
}

/// Resolve a requested path to an absolute path and identify the mount
/// it belongs to. Rejects parent traversal.
fn resolve_under_mounts(
    requested: &str,
    mounts: &[(PathBuf, bool)],
) -> Result<(PathBuf, PathBuf, bool)> {
    let req = Path::new(requested);
    if !req.is_absolute() {
        bail!("path must be absolute");
    }
    // Disallow any `..` components.
    for c in req.components() {
        if matches!(c, Component::ParentDir) {
            bail!("path may not contain ..");
        }
    }
    for (m, ro) in mounts {
        if req.starts_with(m) || req == m.as_path() {
            return Ok((req.to_path_buf(), m.clone(), *ro));
        }
    }
    Err(anyhow!(
        "path is not inside any of this container's mounts ({} known)",
        mounts.len()
    ))
}

pub async fn read(docker: &Docker, id: &str, requested: &str) -> Result<FsView> {
    let mounts = container_mounts(docker, id).await?;
    if mounts.is_empty() { bail!("container has no bind/volume mounts"); }
    let (path, root, ro) = resolve_under_mounts(requested, &mounts)?;

    let md = tokio::fs::metadata(&path)
        .await
        .with_context(|| format!("stat {}", path.display()))?;

    if md.is_dir() {
        let mut entries = Vec::new();
        let mut rd = tokio::fs::read_dir(&path).await?;
        while let Some(e) = rd.next_entry().await? {
            let m = match e.metadata().await { Ok(x) => x, Err(_) => continue };
            let kind = if m.is_dir() {
                "dir"
            } else if m.is_symlink() {
                "link"
            } else if m.is_file() {
                "file"
            } else {
                "other"
            };
            entries.push(DirEntry {
                name: e.file_name().to_string_lossy().to_string(),
                kind: kind.into(),
                size: if m.is_file() { Some(m.len()) } else { None },
                modified: m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64),
                read_only_view: ro,
            });
        }
        entries.sort_by(|a, b| {
            a.kind.cmp(&b.kind).reverse().then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(FsView::Dir {
            path: path.display().to_string(),
            entries,
            root: root.display().to_string(),
            read_only: ro,
        })
    } else if md.is_file() {
        let size = md.len();
        let truncated = size > MAX_FILE_READ_BYTES;
        let bytes = if truncated {
            let mut buf = vec![0u8; MAX_FILE_READ_BYTES as usize];
            use tokio::io::AsyncReadExt;
            let mut f = tokio::fs::File::open(&path).await?;
            let _ = f.read_exact(&mut buf).await;
            buf
        } else {
            tokio::fs::read(&path).await?
        };
        let content = String::from_utf8_lossy(&bytes).to_string();
        Ok(FsView::File { path: path.display().to_string(), content, size, read_only: ro, truncated })
    } else {
        bail!("unsupported file type")
    }
}

pub async fn write(docker: &Docker, id: &str, requested: &str, content: &str) -> Result<()> {
    if content.len() > MAX_FILE_WRITE_BYTES {
        bail!("file too large ({} bytes, max {})", content.len(), MAX_FILE_WRITE_BYTES);
    }
    let mounts = container_mounts(docker, id).await?;
    if mounts.is_empty() { bail!("container has no bind/volume mounts"); }
    let (path, _root, ro) = resolve_under_mounts(requested, &mounts)?;
    if ro {
        bail!("mount is read-only — refusing to write");
    }
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&path, content.as_bytes()).await?;
    Ok(())
}
