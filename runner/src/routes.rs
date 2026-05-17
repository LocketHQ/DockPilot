//! HTTP routes for the DockPilot Runner.

use crate::{dbexec, docker, files, proxy, stats};
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use bollard::Docker;
use futures_util::stream::Stream;
use lockethq_shared::CreateContainerRequest;
use serde::Deserialize;
use std::convert::Infallible;
use std::sync::Arc;
use tokio_stream::wrappers::ReceiverStream;

pub struct AppState {
    pub docker: Docker,
    pub token: String,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/info", get(info))
        .route("/v1/stats", get(stats_now))
        .route("/v1/stats/stream", get(stats_stream))
        .route("/v1/containers", get(list_containers).post(create_container))
        .route("/v1/containers/from-upload", post(create_from_upload))
        .route("/v1/containers/from-compose", post(create_from_compose))
        .route("/v1/containers/from-compose/stream", post(create_from_compose_stream))
        .route("/v1/compose/:project/:action", post(compose_action_route))
        .route("/v1/containers/:id", get(inspect_container).delete(remove_container))
        .route("/v1/containers/:id/start", post(start))
        .route("/v1/containers/:id/stop", post(stop))
        .route("/v1/containers/:id/restart", post(restart))
        .route("/v1/containers/:id/logs", get(logs))
        .route("/v1/containers/:id/stats", get(container_stats))
        .route("/v1/images", get(list_images))
        .route("/v1/images/pull", post(pull_image))
        .route("/v1/volumes", get(list_volumes))
        .route("/v1/networks", get(list_networks))
        .route("/v1/containers/:id/recreate-env", post(recreate_env))
        .route("/v1/containers/:id/fs", get(fs_get).post(fs_post))
        .route("/v1/containers/:id/db/info", get(db_info))
        .route("/v1/containers/:id/db/tables", get(db_tables))
        .route("/v1/containers/:id/db/query", post(db_query))
        .route("/v1/proxy/status", get(proxy_status))
        .route("/v1/proxy/setup", post(proxy_setup))
        .route("/v1/proxy/domains", get(list_domains).post(add_domain))
        .route("/v1/proxy/domains/:host", axum::routing::delete(remove_domain))
        .layer(axum::extract::DefaultBodyLimit::max(256 * 1024 * 1024))
        .with_state(state)
}

async fn check_auth(headers: &HeaderMap, state: &AppState) -> Result<(), Response> {
    let h = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let expected = format!("Bearer {}", state.token);
    if h != expected {
        return Err((StatusCode::UNAUTHORIZED, "invalid token").into_response());
    }
    Ok(())
}

async fn health() -> &'static str { "ok" }

async fn info(State(s): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    let docker_version = s
        .docker
        .version()
        .await
        .ok()
        .and_then(|v| v.version)
        .unwrap_or_else(|| "?".into());
    let info = stats::info(docker_version);
    Json(info).into_response()
}

async fn stats_now(State(_s): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&headers, &_s).await { return r; }
    let s = stats::snapshot();
    Json(s).into_response()
}

fn ndjson_response<S>(stream: S) -> Response
where
    S: Stream<Item = Result<String, Infallible>> + Send + 'static,
{
    use futures_util::StreamExt;
    let body = Body::from_stream(stream.map(|r| r.map(|s| format!("{s}\n"))));
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-ndjson")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(body)
        .unwrap()
}

async fn stats_stream(State(s): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    let (tx, rx) = tokio::sync::mpsc::channel::<String>(16);
    tokio::spawn(stats::stream(tx));
    ndjson_response(ReceiverStream::new(rx).map(Ok))
}

async fn list_containers(State(s): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match docker::list_containers(&s.docker).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

async fn inspect_container(
    Path(id): Path<String>,
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match docker::inspect_container(&s.docker, &id).await {
        Ok(d) => Json(d).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct RemoveQuery { #[serde(default)] force: bool }

async fn remove_container(
    Path(id): Path<String>,
    Query(q): Query<RemoveQuery>,
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match docker::remove(&s.docker, &id, q.force).await {
        Ok(_) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

async fn start(Path(id): Path<String>, State(s): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match docker::start(&s.docker, &id).await {
        Ok(_) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}
async fn stop(Path(id): Path<String>, State(s): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match docker::stop(&s.docker, &id).await {
        Ok(_) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}
async fn restart(Path(id): Path<String>, State(s): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match docker::restart(&s.docker, &id).await {
        Ok(_) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct LogsQuery {
    #[serde(default)] follow: bool,
    #[serde(default = "default_tail")] tail: u64,
}
fn default_tail() -> u64 { 200 }

async fn logs(
    Path(id): Path<String>,
    Query(q): Query<LogsQuery>,
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    let (tx, rx) = tokio::sync::mpsc::channel::<String>(64);
    let docker = s.docker.clone();
    tokio::spawn(async move {
        let _ = docker::logs_stream(&docker, &id, q.follow, q.tail, tx).await;
    });
    ndjson_response(ReceiverStream::new(rx).map(Ok))
}

async fn container_stats(
    Path(id): Path<String>,
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    let (tx, rx) = tokio::sync::mpsc::channel::<String>(16);
    let docker = s.docker.clone();
    tokio::spawn(async move {
        let _ = docker::stats_stream(&docker, &id, tx).await;
    });
    ndjson_response(ReceiverStream::new(rx).map(Ok))
}

async fn create_container(
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CreateContainerRequest>,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match docker::create_container(&s.docker, &req, None).await {
        Ok(id) => Json(serde_json::json!({"id": id})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct UploadCreateRequest {
    spec: CreateContainerRequest,
    /// Base64-encoded tar.gz of the build context.
    tarball_b64: String,
}

async fn create_from_upload(
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<UploadCreateRequest>,
) -> Response {
    use base64::Engine;
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    let body = match base64::engine::general_purpose::STANDARD.decode(&req.tarball_b64) {
        Ok(b) => b,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("invalid base64: {e}")).into_response(),
    };
    match docker::create_container(&s.docker, &req.spec, Some(body)).await {
        Ok(id) => Json(serde_json::json!({"id": id})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct ComposeCreateRequest {
    name: String,
    yaml: String,
    #[serde(default)]
    env: std::collections::HashMap<String, String>,
}

async fn create_from_compose(
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<ComposeCreateRequest>,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    let env_pairs: Vec<(String, String)> = req.env.into_iter().collect();
    match docker::compose_up(&req.name, &req.yaml, &env_pairs).await {
        Ok(ids) => Json(serde_json::json!({"ids": ids})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

async fn compose_action_route(
    Path((project, action)): Path<(String, String)>,
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match docker::compose_action(&project, &action).await {
        Ok(out) => Json(serde_json::json!({"ok": true, "output": out})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

async fn create_from_compose_stream(
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<ComposeCreateRequest>,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    let env_pairs: Vec<(String, String)> = req.env.into_iter().collect();
    let (tx, rx) = tokio::sync::mpsc::channel::<String>(64);
    tokio::spawn(async move {
        let _ = docker::compose_up_stream(&req.name, &req.yaml, &env_pairs, tx).await;
    });
    ndjson_response(ReceiverStream::new(rx).map(Ok))
}

async fn list_images(State(s): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match docker::list_images(&s.docker).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct PullRequest { image: String }

async fn pull_image(
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<PullRequest>,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    let (tx, rx) = tokio::sync::mpsc::channel::<String>(32);
    let docker = s.docker.clone();
    tokio::spawn(async move {
        let _ = docker::pull_image(&docker, &req.image, tx).await;
    });
    ndjson_response(ReceiverStream::new(rx).map(Ok))
}

async fn list_volumes(State(s): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match docker::list_volumes(&s.docker).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

async fn list_networks(State(s): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match docker::list_networks(&s.docker).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct RecreateEnvBody { env: Vec<lockethq_shared::EnvVar> }

async fn recreate_env(
    Path(id): Path<String>,
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<RecreateEnvBody>,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match docker::recreate_with_env(&s.docker, &id, &body.env).await {
        Ok(new_id) => Json(serde_json::json!({"id": new_id})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct FsQuery { path: String }

async fn fs_get(
    Path(id): Path<String>,
    Query(q): Query<FsQuery>,
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match files::read(&s.docker, &id, &q.path).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

async fn fs_post(
    Path(id): Path<String>,
    Query(q): Query<FsQuery>,
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<files::FsWrite>,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match files::write(&s.docker, &id, &q.path, &body.content).await {
        Ok(_) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct DbTablesQuery {
    #[serde(default)]
    db: String,
}

async fn db_info(
    Path(id): Path<String>,
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match dbexec::info(&s.docker, &id).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

async fn db_tables(
    Path(id): Path<String>,
    Query(q): Query<DbTablesQuery>,
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match dbexec::tables(&s.docker, &id, &q.db).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

async fn db_query(
    Path(id): Path<String>,
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<dbexec::QueryRequest>,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match dbexec::query(&s.docker, &id, &body).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

async fn proxy_status(State(s): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match proxy::status(&s.docker).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

async fn proxy_setup(
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<proxy::SetupRequest>,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match proxy::setup(&s.docker, &req).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

async fn list_domains(State(s): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match proxy::list_domains().await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

async fn add_domain(
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<proxy::DomainRequest>,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match proxy::add_domain(&s.docker, &req).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

async fn remove_domain(
    Path(host): Path<String>,
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(r) = check_auth(&headers, &s).await { return r; }
    match proxy::remove_domain(&host).await {
        Ok(_) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

// tokio_stream wrappers — bring our own to keep deps tight.
mod tokio_stream {
    pub mod wrappers {
        use std::pin::Pin;
        use std::task::{Context, Poll};
        use tokio::sync::mpsc::Receiver;
        pub struct ReceiverStream<T> { inner: Receiver<T> }
        impl<T> ReceiverStream<T> {
            pub fn new(inner: Receiver<T>) -> Self { Self { inner } }
        }
        impl<T> futures_util::Stream for ReceiverStream<T> {
            type Item = T;
            fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<T>> {
                self.inner.poll_recv(cx)
            }
        }
    }
}

use futures_util::StreamExt;
