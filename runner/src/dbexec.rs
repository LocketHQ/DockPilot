//! Database editor support — execs `psql`/`mysql`/`mariadb` inside the target
//! container so the runner doesn't need network access or its own DB client.
//!
//! Engine is inferred from the container image. Credentials come from the
//! standard env vars set by the official Docker images:
//!   - postgres:  POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
//!   - mysql:     MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, MYSQL_ROOT_PASSWORD
//!   - mariadb:   MARIADB_USER, MARIADB_PASSWORD, MARIADB_DATABASE,
//!                MARIADB_ROOT_PASSWORD (or MYSQL_* equivalents)

use anyhow::{anyhow, bail, Result};
use bollard::container::LogOutput;
use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::Docker;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DbEngine {
    Postgres,
    Mysql,
    Mariadb,
}

pub fn detect_engine(image: &str) -> Option<DbEngine> {
    let img = image.to_lowercase();
    // Strip registry prefix (e.g. "docker.io/library/postgres:15.6-alpine").
    let bare = img.rsplit('/').next().unwrap_or(&img);
    let name = bare.split(':').next().unwrap_or(bare);
    if name == "postgres" || name == "postgresql" || name.contains("postgis") {
        Some(DbEngine::Postgres)
    } else if name == "mariadb" || name.starts_with("mariadb") {
        Some(DbEngine::Mariadb)
    } else if name == "mysql" || name.starts_with("mysql") {
        Some(DbEngine::Mysql)
    } else {
        None
    }
}

#[derive(Debug, Serialize)]
pub struct DbInfo {
    pub engine: DbEngine,
    pub version: Option<String>,
    pub default_db: String,
    pub default_user: String,
    pub databases: Vec<DatabaseRow>,
}

#[derive(Debug, Serialize)]
pub struct DatabaseRow {
    pub name: String,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct TableRow {
    pub schema: String,
    pub name: String,
    pub rows: i64,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub elapsed_ms: u64,
    pub row_count: usize,
    pub truncated: bool,
    pub command: Option<String>, // e.g. "SELECT", "UPDATE 5" — non-row queries
}

#[derive(Debug, Default, Clone)]
struct Creds {
    user: String,
    password: Option<String>,
    default_db: String,
}

async fn engine_and_creds(docker: &Docker, id: &str) -> Result<(DbEngine, Creds)> {
    let det = docker.inspect_container(id, None).await?;
    let image = det
        .config
        .as_ref()
        .and_then(|c| c.image.clone())
        .unwrap_or_default();
    let engine = detect_engine(&image)
        .ok_or_else(|| anyhow!("container image '{image}' is not a supported database"))?;

    let envs: HashMap<String, String> = det
        .config
        .as_ref()
        .and_then(|c| c.env.clone())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|kv| {
            let mut s = kv.splitn(2, '=');
            let k = s.next()?.to_string();
            let v = s.next()?.to_string();
            Some((k, v))
        })
        .collect();

    let creds = match engine {
        DbEngine::Postgres => {
            let user = envs
                .get("POSTGRES_USER")
                .cloned()
                .unwrap_or_else(|| "postgres".into());
            let db = envs.get("POSTGRES_DB").cloned().unwrap_or_else(|| user.clone());
            Creds {
                user,
                password: envs.get("POSTGRES_PASSWORD").cloned(),
                default_db: db,
            }
        }
        DbEngine::Mysql | DbEngine::Mariadb => {
            // Prefer root creds for full visibility; fall back to user creds.
            let (user, pass) = if let Some(p) = envs
                .get("MYSQL_ROOT_PASSWORD")
                .or_else(|| envs.get("MARIADB_ROOT_PASSWORD"))
            {
                ("root".to_string(), Some(p.clone()))
            } else {
                let u = envs
                    .get("MYSQL_USER")
                    .or_else(|| envs.get("MARIADB_USER"))
                    .cloned()
                    .unwrap_or_else(|| "root".into());
                let p = envs
                    .get("MYSQL_PASSWORD")
                    .or_else(|| envs.get("MARIADB_PASSWORD"))
                    .cloned();
                (u, p)
            };
            let db = envs
                .get("MYSQL_DATABASE")
                .or_else(|| envs.get("MARIADB_DATABASE"))
                .cloned()
                .unwrap_or_default();
            Creds {
                user,
                password: pass,
                default_db: db,
            }
        }
    };

    Ok((engine, creds))
}

async fn exec_collect(
    docker: &Docker,
    container_id: &str,
    cmd: Vec<String>,
    env: Vec<String>,
) -> Result<(i64, Vec<u8>, Vec<u8>)> {
    let exec = docker
        .create_exec(
            container_id,
            CreateExecOptions {
                cmd: Some(cmd),
                env: if env.is_empty() { None } else { Some(env) },
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                ..Default::default()
            },
        )
        .await?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();

    match docker.start_exec(&exec.id, None).await? {
        StartExecResults::Attached { mut output, .. } => {
            while let Some(chunk) = output.next().await {
                match chunk? {
                    LogOutput::StdOut { message } => stdout.extend_from_slice(&message),
                    LogOutput::StdErr { message } => stderr.extend_from_slice(&message),
                    LogOutput::Console { message } => stdout.extend_from_slice(&message),
                    _ => {}
                }
            }
        }
        StartExecResults::Detached => {}
    }

    let inspect = docker.inspect_exec(&exec.id).await?;
    let code = inspect.exit_code.unwrap_or(-1);
    Ok((code, stdout, stderr))
}

// ─── postgres helpers ─────────────────────────────────────────────────────

async fn psql_run(
    docker: &Docker,
    id: &str,
    creds: &Creds,
    db: &str,
    sql: &str,
) -> Result<(i64, Vec<u8>, Vec<u8>)> {
    let mut env = Vec::new();
    if let Some(p) = &creds.password {
        env.push(format!("PGPASSWORD={p}"));
    }
    let cmd = vec![
        "psql".into(),
        "-U".into(),
        creds.user.clone(),
        "-d".into(),
        db.to_string(),
        "-X".into(),
        "-A".into(),
        "-t".into(),
        "-P".into(),
        "pager=off".into(),
        "-v".into(),
        "ON_ERROR_STOP=1".into(),
        "-c".into(),
        sql.into(),
    ];
    exec_collect(docker, id, cmd, env).await
}

/// Run a SELECT query via `COPY (...) TO STDOUT WITH CSV HEADER`, returning
/// the raw CSV bytes (or stderr on failure).
async fn psql_csv(
    docker: &Docker,
    id: &str,
    creds: &Creds,
    db: &str,
    inner_sql: &str,
) -> Result<(i64, Vec<u8>, Vec<u8>)> {
    let wrapped = format!("COPY ({}) TO STDOUT WITH CSV HEADER", inner_sql.trim().trim_end_matches(';'));
    let mut env = Vec::new();
    if let Some(p) = &creds.password {
        env.push(format!("PGPASSWORD={p}"));
    }
    let cmd = vec![
        "psql".into(),
        "-U".into(),
        creds.user.clone(),
        "-d".into(),
        db.to_string(),
        "-X".into(),
        "-P".into(),
        "pager=off".into(),
        "-v".into(),
        "ON_ERROR_STOP=1".into(),
        "-c".into(),
        wrapped,
    ];
    exec_collect(docker, id, cmd, env).await
}

// ─── mysql helpers ─────────────────────────────────────────────────────────

fn mysql_client(engine: DbEngine) -> &'static str {
    match engine {
        DbEngine::Mariadb => "mariadb",
        _ => "mysql",
    }
}

async fn mysql_run(
    docker: &Docker,
    id: &str,
    engine: DbEngine,
    creds: &Creds,
    db: &str,
    sql: &str,
) -> Result<(i64, Vec<u8>, Vec<u8>)> {
    let client = mysql_client(engine);
    let mut env = Vec::new();
    if let Some(p) = &creds.password {
        env.push(format!("MYSQL_PWD={p}"));
    }
    let mut cmd = vec![
        client.into(),
        "-u".into(),
        creds.user.clone(),
        "--batch".into(),
        "--raw".into(),
        "--default-character-set=utf8mb4".into(),
    ];
    if !db.is_empty() {
        cmd.push(db.to_string());
    }
    cmd.push("-e".into());
    cmd.push(sql.into());
    exec_collect(docker, id, cmd, env).await
}

// ─── CSV / TSV parsing ─────────────────────────────────────────────────────

fn parse_csv(s: &str) -> Vec<Vec<Option<String>>> {
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut row: Vec<Option<String>> = Vec::new();
    let mut cur = String::new();
    let mut in_quoted = false;
    let mut started = false;
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if in_quoted {
            if c == '"' {
                if i + 1 < chars.len() && chars[i + 1] == '"' {
                    cur.push('"');
                    i += 2;
                    continue;
                }
                in_quoted = false;
                i += 1;
                continue;
            }
            cur.push(c);
            i += 1;
        } else {
            match c {
                '"' => {
                    in_quoted = true;
                    started = true;
                    i += 1;
                }
                ',' => {
                    row.push(if started || !cur.is_empty() { Some(std::mem::take(&mut cur)) } else { None });
                    started = false;
                    i += 1;
                }
                '\r' => {
                    i += 1;
                }
                '\n' => {
                    row.push(if started || !cur.is_empty() { Some(std::mem::take(&mut cur)) } else { None });
                    rows.push(std::mem::take(&mut row));
                    started = false;
                    i += 1;
                }
                _ => {
                    started = true;
                    cur.push(c);
                    i += 1;
                }
            }
        }
    }
    if started || !cur.is_empty() || !row.is_empty() {
        row.push(if started || !cur.is_empty() { Some(cur) } else { None });
        rows.push(row);
    }
    rows
}

/// Parse mysql --batch output: tab-separated, header on first line,
/// `NULL` literal for SQL NULL.
fn parse_tsv(s: &str) -> Vec<Vec<Option<String>>> {
    s.lines()
        .map(|line| {
            line.split('\t')
                .map(|cell| {
                    if cell == "NULL" {
                        None
                    } else {
                        Some(cell.replace("\\t", "\t").replace("\\n", "\n").replace("\\\\", "\\"))
                    }
                })
                .collect()
        })
        .collect()
}

// ─── Public API ────────────────────────────────────────────────────────────

pub async fn info(docker: &Docker, id: &str) -> Result<DbInfo> {
    let (engine, creds) = engine_and_creds(docker, id).await?;

    match engine {
        DbEngine::Postgres => {
            // Version.
            let (_, v_out, _) = psql_run(docker, id, &creds, &creds.default_db, "SELECT version();").await?;
            let version = String::from_utf8_lossy(&v_out).trim().to_string();
            let version = if version.is_empty() { None } else { Some(version) };

            // Databases + sizes.
            let (code, out, err) = psql_csv(
                docker,
                id,
                &creds,
                &creds.default_db,
                "SELECT datname, pg_database_size(datname)::bigint FROM pg_database WHERE NOT datistemplate ORDER BY datname",
            ).await?;
            if code != 0 {
                bail!("listing databases failed: {}", String::from_utf8_lossy(&err));
            }
            let parsed = parse_csv(&String::from_utf8_lossy(&out));
            let databases = parsed
                .into_iter()
                .skip(1) // header
                .filter_map(|r| {
                    let name = r.get(0).and_then(|x| x.clone())?;
                    let size = r.get(1).and_then(|x| x.as_ref()).and_then(|s| s.parse::<u64>().ok());
                    Some(DatabaseRow { name, size_bytes: size })
                })
                .collect();

            Ok(DbInfo {
                engine,
                version,
                default_db: creds.default_db.clone(),
                default_user: creds.user.clone(),
                databases,
            })
        }
        DbEngine::Mysql | DbEngine::Mariadb => {
            let (_, v_out, _) = mysql_run(docker, id, engine, &creds, "", "SELECT VERSION()").await?;
            let version = String::from_utf8_lossy(&v_out)
                .lines()
                .nth(1)
                .map(|s| s.trim().to_string());

            let (code, out, err) = mysql_run(
                docker,
                id,
                engine,
                &creds,
                "",
                "SELECT s.SCHEMA_NAME, IFNULL(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0) \
                 FROM information_schema.SCHEMATA s \
                 LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME \
                 WHERE s.SCHEMA_NAME NOT IN ('information_schema','performance_schema','mysql','sys') \
                 GROUP BY s.SCHEMA_NAME ORDER BY s.SCHEMA_NAME",
            )
            .await?;
            if code != 0 {
                bail!("listing databases failed: {}", String::from_utf8_lossy(&err));
            }
            let parsed = parse_tsv(&String::from_utf8_lossy(&out));
            let databases = parsed
                .into_iter()
                .skip(1)
                .filter_map(|r| {
                    let name = r.first().and_then(|x| x.clone())?;
                    let size = r.get(1).and_then(|x| x.as_ref()).and_then(|s| s.parse::<u64>().ok());
                    Some(DatabaseRow { name, size_bytes: size })
                })
                .collect();

            Ok(DbInfo {
                engine,
                version,
                default_db: creds.default_db.clone(),
                default_user: creds.user.clone(),
                databases,
            })
        }
    }
}

pub async fn tables(docker: &Docker, id: &str, db: &str) -> Result<Vec<TableRow>> {
    let (engine, creds) = engine_and_creds(docker, id).await?;
    let db = if db.is_empty() { creds.default_db.as_str() } else { db };

    match engine {
        DbEngine::Postgres => {
            let sql = "SELECT n.nspname, c.relname, \
                       COALESCE(s.n_live_tup, c.reltuples::bigint), \
                       pg_total_relation_size(c.oid)::bigint \
                       FROM pg_class c \
                       JOIN pg_namespace n ON n.oid = c.relnamespace \
                       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid \
                       WHERE c.relkind = 'r' \
                       AND n.nspname NOT IN ('pg_catalog','information_schema') \
                       ORDER BY n.nspname, c.relname";
            let (code, out, err) = psql_csv(docker, id, &creds, db, sql).await?;
            if code != 0 {
                bail!("listing tables failed: {}", String::from_utf8_lossy(&err));
            }
            let parsed = parse_csv(&String::from_utf8_lossy(&out));
            Ok(parsed
                .into_iter()
                .skip(1)
                .filter_map(|r| {
                    Some(TableRow {
                        schema: r.first().and_then(|x| x.clone())?,
                        name: r.get(1).and_then(|x| x.clone())?,
                        rows: r.get(2).and_then(|x| x.as_ref()).and_then(|s| s.parse().ok()).unwrap_or(0),
                        size_bytes: r.get(3).and_then(|x| x.as_ref()).and_then(|s| s.parse().ok()).unwrap_or(0),
                    })
                })
                .collect())
        }
        DbEngine::Mysql | DbEngine::Mariadb => {
            if db.is_empty() {
                bail!("database name required");
            }
            let sql = format!(
                "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_ROWS, (DATA_LENGTH + INDEX_LENGTH) \
                 FROM information_schema.TABLES WHERE TABLE_SCHEMA = '{}' \
                 ORDER BY TABLE_NAME",
                db.replace('\'', "''")
            );
            let (code, out, err) = mysql_run(docker, id, engine, &creds, "", &sql).await?;
            if code != 0 {
                bail!("listing tables failed: {}", String::from_utf8_lossy(&err));
            }
            let parsed = parse_tsv(&String::from_utf8_lossy(&out));
            Ok(parsed
                .into_iter()
                .skip(1)
                .filter_map(|r| {
                    Some(TableRow {
                        schema: r.first().and_then(|x| x.clone())?,
                        name: r.get(1).and_then(|x| x.clone())?,
                        rows: r.get(2).and_then(|x| x.as_ref()).and_then(|s| s.parse().ok()).unwrap_or(0),
                        size_bytes: r.get(3).and_then(|x| x.as_ref()).and_then(|s| s.parse().ok()).unwrap_or(0),
                    })
                })
                .collect())
        }
    }
}

#[derive(Deserialize)]
pub struct QueryRequest {
    #[serde(default)]
    pub db: String,
    pub sql: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
}
fn default_limit() -> usize { 1000 }

/// Heuristic: query returns rows? (so we can stream via CSV / batch).
fn returns_rows(sql: &str) -> bool {
    let s = sql.trim_start();
    // strip leading -- comments and /* */ blocks (cheaply, not full SQL parsing).
    let s = strip_leading_comments(s).to_ascii_uppercase();
    s.starts_with("SELECT")
        || s.starts_with("WITH")
        || s.starts_with("VALUES")
        || s.starts_with("TABLE ")
        || s.starts_with("SHOW")
        || s.starts_with("DESCRIBE")
        || s.starts_with("DESC ")
        || s.starts_with("EXPLAIN")
}

fn strip_leading_comments(s: &str) -> &str {
    let mut s = s.trim_start();
    loop {
        if let Some(rest) = s.strip_prefix("--") {
            if let Some(nl) = rest.find('\n') {
                s = &rest[nl + 1..];
            } else {
                return "";
            }
            s = s.trim_start();
        } else if let Some(rest) = s.strip_prefix("/*") {
            if let Some(end) = rest.find("*/") {
                s = &rest[end + 2..];
            } else {
                return "";
            }
            s = s.trim_start();
        } else {
            break;
        }
    }
    s
}

pub async fn query(docker: &Docker, id: &str, req: &QueryRequest) -> Result<QueryResult> {
    let (engine, creds) = engine_and_creds(docker, id).await?;
    let db = if req.db.is_empty() { creds.default_db.as_str() } else { req.db.as_str() };
    let limit = req.limit.clamp(1, 10_000);

    let started = std::time::Instant::now();

    let yields_rows = returns_rows(&req.sql);

    match engine {
        DbEngine::Postgres => {
            if yields_rows {
                // Wrap in COPY for clean CSV output. Apply LIMIT outside the
                // user query so we never blow up memory on a huge select.
                let inner = format!("SELECT * FROM ({}) __q LIMIT {}", req.sql.trim().trim_end_matches(';'), limit + 1);
                let (code, out, err) = psql_csv(docker, id, &creds, db, &inner).await?;
                if code != 0 {
                    bail!("{}", String::from_utf8_lossy(&err).trim());
                }
                let elapsed_ms = started.elapsed().as_millis() as u64;
                let parsed = parse_csv(&String::from_utf8_lossy(&out));
                let mut iter = parsed.into_iter();
                let header = iter
                    .next()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|c| c.unwrap_or_default())
                    .collect::<Vec<_>>();
                let mut rows: Vec<Vec<Option<String>>> = iter.collect();
                let truncated = rows.len() > limit;
                rows.truncate(limit);
                let row_count = rows.len();
                Ok(QueryResult {
                    columns: header,
                    rows,
                    elapsed_ms,
                    row_count,
                    truncated,
                    command: None,
                })
            } else {
                let (code, _out, err) = psql_run(docker, id, &creds, db, &req.sql).await?;
                let elapsed_ms = started.elapsed().as_millis() as u64;
                if code != 0 {
                    bail!("{}", String::from_utf8_lossy(&err).trim());
                }
                let trimmed = String::from_utf8_lossy(&err).trim().to_string();
                Ok(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    elapsed_ms,
                    row_count: 0,
                    truncated: false,
                    command: if trimmed.is_empty() { Some("OK".into()) } else { Some(trimmed) },
                })
            }
        }
        DbEngine::Mysql | DbEngine::Mariadb => {
            let sql = if yields_rows {
                format!("{} LIMIT {}", req.sql.trim().trim_end_matches(';'), limit + 1)
            } else {
                req.sql.clone()
            };
            let (code, out, err) = mysql_run(docker, id, engine, &creds, db, &sql).await?;
            let elapsed_ms = started.elapsed().as_millis() as u64;
            if code != 0 {
                bail!("{}", String::from_utf8_lossy(&err).trim());
            }
            if yields_rows {
                let parsed = parse_tsv(&String::from_utf8_lossy(&out));
                let mut iter = parsed.into_iter();
                let header = iter
                    .next()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|c| c.unwrap_or_default())
                    .collect::<Vec<_>>();
                let mut rows: Vec<Vec<Option<String>>> = iter.collect();
                let truncated = rows.len() > limit;
                rows.truncate(limit);
                let row_count = rows.len();
                Ok(QueryResult {
                    columns: header,
                    rows,
                    elapsed_ms,
                    row_count,
                    truncated,
                    command: None,
                })
            } else {
                Ok(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    elapsed_ms,
                    row_count: 0,
                    truncated: false,
                    command: Some("OK".into()),
                })
            }
        }
    }
}
