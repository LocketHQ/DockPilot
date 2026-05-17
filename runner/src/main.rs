//! DockPilot Runner — Docker control-plane agent.
//!
//! Lives on each managed server as a systemd service. Binds to localhost
//! (so the only path in is via the desktop app's SSH port-forward) and
//! authenticates every request with a static bearer token written by the
//! installer to /etc/lockethq/runner.toml.

mod config;
mod dbexec;
mod docker;
mod files;
mod proxy;
mod routes;
mod stats;

use anyhow::Result;
use clap::Parser;
use std::sync::Arc;

#[derive(Parser)]
#[command(name = "lockethq-runner", about = "DockPilot Runner agent")]
struct Args {
    /// Path to the runner config file.
    #[arg(long, default_value = "/etc/lockethq/runner.toml")]
    config: String,

    /// Override bind address (useful for local testing without root).
    #[arg(long)]
    bind: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "lockethq_runner=info,axum=info,tower_http=info".into()),
        )
        .init();

    let args = Args::parse();
    let mut cfg = config::Config::load(&args.config)?;
    if let Some(b) = args.bind {
        cfg.bind = b;
    }

    let docker = docker::connect().await?;
    tracing::info!("connected to docker daemon");

    let state = Arc::new(routes::AppState {
        docker,
        token: cfg.token.clone(),
    });

    let app = routes::router(state);
    let listener = tokio::net::TcpListener::bind(&cfg.bind).await?;
    tracing::info!("runner listening on http://{} (loopback-only)", cfg.bind);
    axum::serve(listener, app).await?;
    Ok(())
}
