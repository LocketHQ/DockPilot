//! DockPilot Tauri backend.
//!
//! Owns:
//!  - Persisted server registry (servers.json under the app data dir).
//!  - SSH install of the DockPilot Runner on each remote server.
//!  - HTTP/SSE proxy from the frontend to each server's runner.

mod storage;
mod runner_client;
mod ssh_install;
mod tunnel;
mod cloudflare;
mod dockerhub;
mod commands;
mod error;

use tauri::Manager;

pub use error::AppError;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "lockethq_app_lib=info,warn".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let state = commands::AppState::new(app.handle().clone())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_servers,
            commands::add_server,
            commands::remove_server,
            commands::test_ssh,
            commands::runner_get,
            commands::runner_post,
            commands::runner_delete,
            commands::runner_stream_post,
            commands::runner_stream_logs,
            commands::runner_stream_stats,
            commands::cancel_stream,
            commands::restart_docker,
            commands::restart_runner,
            commands::update_runner_binary,
            commands::uninstall_runner,
            commands::fetch_runner_logs,
            commands::generate_ssh_key,
            commands::list_ssh_keys,
            commands::dockerhub_search,
            commands::dockerhub_image_info,
            commands::cf_save_token,
            commands::cf_has_token,
            commands::cf_list_zones,
            commands::cf_list_records,
            commands::cf_create_record,
            commands::cf_delete_record,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
