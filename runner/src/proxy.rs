//! Traefik reverse-proxy setup + per-domain config files.
//!
//! Layout on the remote box (under /var/lib because the runner's systemd
//! unit sets ProtectSystem=full, making /etc read-only for the service):
//!   /var/lib/lockethq/traefik/traefik.yml      static config (entrypoints + providers)
//!   /var/lib/lockethq/traefik/dynamic/*.yml    one file per provisioned domain
//!   /var/lib/lockethq/traefik/acme.json        Let's Encrypt cert store (chmod 600)
//!   docker network: lockethq-proxy             where containers must join to be routable
//!
//! Each provisioned domain writes a dynamic/<name>.yml file mapping the host
//! to a container's internal address. Traefik watches the dir and reloads.

use anyhow::{Context, Result};
use bollard::Docker;
use bollard::container::{
    Config, CreateContainerOptions, ListContainersOptions, RemoveContainerOptions, StartContainerOptions,
};
use bollard::network::{CreateNetworkOptions, ListNetworksOptions};
use bollard::service::{HostConfig, RestartPolicy, RestartPolicyNameEnum};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

pub const PROXY_CONTAINER: &str = "lockethq-traefik";
pub const PROXY_NETWORK: &str = "lockethq-proxy";
pub const CONFIG_ROOT: &str = "/var/lib/lockethq/traefik";

#[derive(Debug, Serialize, Deserialize)]
pub struct ProxyStatus {
    pub installed: bool,
    pub running: bool,
    pub network: String,
    pub container_id: Option<String>,
    pub acme_email: Option<String>,
}

pub async fn status(docker: &Docker) -> Result<ProxyStatus> {
    let nets = docker.list_networks(None::<ListNetworksOptions<String>>).await?;
    let has_network = nets.iter().any(|n| n.name.as_deref() == Some(PROXY_NETWORK));

    let cs = docker
        .list_containers(Some(ListContainersOptions::<String> {
            all: true,
            ..Default::default()
        }))
        .await?;
    let proxy = cs.into_iter().find(|c| {
        c.names
            .as_ref()
            .map(|n| n.iter().any(|x| x.trim_start_matches('/') == PROXY_CONTAINER))
            .unwrap_or(false)
    });
    let running = proxy
        .as_ref()
        .and_then(|p| p.state.as_deref())
        .map(|s| s == "running")
        .unwrap_or(false);
    let acme_email = read_static_config().await.ok().and_then(|c| c.email);

    Ok(ProxyStatus {
        installed: has_network && proxy.is_some(),
        running,
        network: PROXY_NETWORK.into(),
        container_id: proxy.and_then(|p| p.id),
        acme_email,
    })
}

#[derive(Debug, Deserialize)]
pub struct SetupRequest {
    pub acme_email: String,
}

pub async fn setup(docker: &Docker, req: &SetupRequest) -> Result<ProxyStatus> {
    // 1. Make sure config dirs exist.
    tokio::fs::create_dir_all(format!("{CONFIG_ROOT}/dynamic")).await?;
    let acme_path = format!("{CONFIG_ROOT}/acme.json");
    if !PathBuf::from(&acme_path).exists() {
        tokio::fs::write(&acme_path, b"").await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut p = std::fs::metadata(&acme_path)?.permissions();
            p.set_mode(0o600);
            std::fs::set_permissions(&acme_path, p)?;
        }
    }

    // 2. Write traefik.yml.
    let static_cfg = StaticConfig { email: Some(req.acme_email.clone()) };
    write_static_config(&static_cfg).await?;

    // 3. Ensure the docker network exists.
    let nets = docker.list_networks(None::<ListNetworksOptions<String>>).await?;
    if !nets.iter().any(|n| n.name.as_deref() == Some(PROXY_NETWORK)) {
        let mut opts: CreateNetworkOptions<String> = Default::default();
        opts.name = PROXY_NETWORK.into();
        opts.driver = "bridge".into();
        docker.create_network(opts).await?;
    }

    // 4. Remove any old traefik container before recreating.
    let existing = docker
        .list_containers(Some(ListContainersOptions::<String> {
            all: true,
            ..Default::default()
        }))
        .await?;
    for c in existing.iter() {
        if c.names
            .as_ref()
            .map(|n| n.iter().any(|x| x.trim_start_matches('/') == PROXY_CONTAINER))
            .unwrap_or(false)
        {
            if let Some(id) = &c.id {
                let _ = docker
                    .remove_container(
                        id,
                        Some(RemoveContainerOptions {
                            force: true,
                            v: false,
                            link: false,
                        }),
                    )
                    .await;
            }
        }
    }

    // 5. Pull traefik:v3 if missing.
    let (tx, _rx) = tokio::sync::mpsc::channel::<String>(8);
    let _ = crate::docker::pull_image(docker, "traefik:v3", tx).await;

    // 6. Create + start the traefik container.
    let mut port_bindings: HashMap<String, Option<Vec<bollard::service::PortBinding>>> = HashMap::new();
    for p in ["80", "443"] {
        port_bindings.insert(
            format!("{p}/tcp"),
            Some(vec![bollard::service::PortBinding {
                host_ip: None,
                host_port: Some(p.into()),
            }]),
        );
    }
    let mut exposed: HashMap<String, HashMap<(), ()>> = HashMap::new();
    exposed.insert("80/tcp".into(), HashMap::new());
    exposed.insert("443/tcp".into(), HashMap::new());

    let binds = vec![
        format!("{CONFIG_ROOT}/traefik.yml:/etc/traefik/traefik.yml:ro"),
        format!("{CONFIG_ROOT}/dynamic:/etc/traefik/dynamic:ro"),
        format!("{CONFIG_ROOT}/acme.json:/acme.json"),
        "/var/run/docker.sock:/var/run/docker.sock:ro".into(),
    ];

    let host_config = HostConfig {
        port_bindings: Some(port_bindings),
        binds: Some(binds),
        network_mode: Some(PROXY_NETWORK.into()),
        restart_policy: Some(RestartPolicy {
            name: Some(RestartPolicyNameEnum::UNLESS_STOPPED),
            maximum_retry_count: None,
        }),
        ..Default::default()
    };

    let config = Config::<String> {
        image: Some("traefik:v3".into()),
        exposed_ports: Some(exposed),
        host_config: Some(host_config),
        ..Default::default()
    };
    let resp = docker
        .create_container(
            Some(CreateContainerOptions::<String> {
                name: PROXY_CONTAINER.into(),
                platform: None,
            }),
            config,
        )
        .await?;
    docker
        .start_container(&resp.id, None::<StartContainerOptions<String>>)
        .await?;

    status(docker).await
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct StaticConfig {
    email: Option<String>,
}

async fn read_static_config() -> Result<StaticConfig> {
    let p = format!("{CONFIG_ROOT}/lockethq.json");
    match tokio::fs::read(&p).await {
        Ok(buf) => Ok(serde_json::from_slice(&buf).unwrap_or_default()),
        Err(_) => Ok(StaticConfig::default()),
    }
}

async fn write_static_config(cfg: &StaticConfig) -> Result<()> {
    // Write the actual Traefik config + our metadata.
    let yml = render_traefik_yaml(cfg);
    tokio::fs::write(format!("{CONFIG_ROOT}/traefik.yml"), yml.as_bytes()).await?;
    let meta = serde_json::to_vec_pretty(cfg)?;
    tokio::fs::write(format!("{CONFIG_ROOT}/lockethq.json"), meta).await?;
    Ok(())
}

fn render_traefik_yaml(cfg: &StaticConfig) -> String {
    let email = cfg.email.clone().unwrap_or_else(|| "admin@example.com".into());
    format!(
        r#"# Generated by DockPilot — do not edit by hand.
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

api:
  dashboard: false

providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: {email}
      storage: /acme.json
      tlsChallenge: {{}}

log:
  level: INFO
accessLog: {{}}
"#
    )
}

#[derive(Debug, Deserialize)]
pub struct DomainRequest {
    pub host: String,                // e.g. "myapp.example.com"
    pub container: String,           // container name on this server
    pub container_port: u16,         // internal port the container listens on
}

#[derive(Debug, Serialize)]
pub struct DomainRecord {
    pub host: String,
    pub container: String,
    pub container_port: u16,
    pub config_path: String,
}

pub async fn add_domain(docker: &Docker, req: &DomainRequest) -> Result<DomainRecord> {
    // Make sure the container is attached to the proxy network.
    let _ = docker
        .connect_network(
            PROXY_NETWORK,
            bollard::network::ConnectNetworkOptions {
                container: req.container.clone(),
                ..Default::default()
            },
        )
        .await; // ok if already attached

    let safe = sanitize(&req.host);
    let path = format!("{CONFIG_ROOT}/dynamic/{safe}.yml");
    let yml = render_dynamic(&req.host, &req.container, req.container_port);
    tokio::fs::write(&path, yml.as_bytes())
        .await
        .with_context(|| format!("writing {path}"))?;
    Ok(DomainRecord {
        host: req.host.clone(),
        container: req.container.clone(),
        container_port: req.container_port,
        config_path: path,
    })
}

pub async fn remove_domain(host: &str) -> Result<()> {
    let path = format!("{CONFIG_ROOT}/dynamic/{}.yml", sanitize(host));
    if PathBuf::from(&path).exists() {
        tokio::fs::remove_file(&path).await?;
    }
    Ok(())
}

pub async fn list_domains() -> Result<Vec<DomainRecord>> {
    let dir = format!("{CONFIG_ROOT}/dynamic");
    let mut out = Vec::new();
    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => return Ok(out),
    };
    while let Some(entry) = rd.next_entry().await? {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("yml") {
            continue;
        }
        let buf = tokio::fs::read_to_string(&p).await?;
        // crude parse — we control the file format.
        let host = buf
            .lines()
            .find(|l| l.contains("# host:"))
            .and_then(|l| l.split_once("# host:").map(|t| t.1.trim().to_string()))
            .unwrap_or_default();
        let container = buf
            .lines()
            .find(|l| l.contains("# container:"))
            .and_then(|l| l.split_once("# container:").map(|t| t.1.trim().to_string()))
            .unwrap_or_default();
        let port = buf
            .lines()
            .find(|l| l.contains("# port:"))
            .and_then(|l| l.split_once("# port:").and_then(|t| t.1.trim().parse::<u16>().ok()))
            .unwrap_or(0);
        out.push(DomainRecord {
            host,
            container,
            container_port: port,
            config_path: p.display().to_string(),
        });
    }
    Ok(out)
}

fn sanitize(host: &str) -> String {
    host.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '.' { c } else { '-' })
        .collect()
}

fn render_dynamic(host: &str, container: &str, port: u16) -> String {
    let router_id = sanitize(host).replace('.', "-");
    let service_id = format!("svc-{router_id}");
    format!(
        r#"# Generated by DockPilot — do not edit by hand.
# host: {host}
# container: {container}
# port: {port}
http:
  routers:
    {router_id}:
      rule: "Host(`{host}`)"
      entryPoints:
        - websecure
      service: {service_id}
      tls:
        certResolver: letsencrypt
  services:
    {service_id}:
      loadBalancer:
        servers:
          - url: "http://{container}:{port}"
"#
    )
}
