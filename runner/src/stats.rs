//! Host-level system info and stats backed by `sysinfo`.

use lockethq_shared::{SystemInfo, SystemStats};
use sysinfo::{Disks, Networks, System};
use tokio::sync::mpsc;

pub fn info(docker_version: String) -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_all();
    let cpu_cores = sys.cpus().len() as u32;
    let memory_total_mb = sys.total_memory() / 1024 / 1024;
    let disks = Disks::new_with_refreshed_list();
    let disk_total_gb = disks.iter().map(|d| d.total_space()).sum::<u64>() / 1024 / 1024 / 1024;
    SystemInfo {
        hostname: System::host_name().unwrap_or_else(|| "unknown".into()),
        os: System::name().unwrap_or_default(),
        kernel: System::kernel_version().unwrap_or_default(),
        docker_version,
        cpu_cores,
        memory_total_mb,
        disk_total_gb,
        uptime_seconds: System::uptime(),
    }
}

pub fn snapshot() -> SystemStats {
    let mut sys = System::new_all();
    sys.refresh_cpu_all();
    std::thread::sleep(std::time::Duration::from_millis(100));
    sys.refresh_cpu_all();
    let cpu_percent = sys.global_cpu_usage();
    let mem_used = sys.used_memory() / 1024 / 1024;
    let mem_total = sys.total_memory() / 1024 / 1024;
    let disks = Disks::new_with_refreshed_list();
    let disk_total: u64 = disks.iter().map(|d| d.total_space()).sum();
    let disk_avail: u64 = disks.iter().map(|d| d.available_space()).sum();
    let disk_used = disk_total.saturating_sub(disk_avail);
    let nets = Networks::new_with_refreshed_list();
    let (rx, tx) = nets
        .iter()
        .fold((0u64, 0u64), |(r, t), (_, n)| (r + n.received(), t + n.transmitted()));
    SystemStats {
        cpu_percent,
        memory_used_mb: mem_used,
        memory_total_mb: mem_total,
        disk_used_gb: disk_used / 1024 / 1024 / 1024,
        disk_total_gb: disk_total / 1024 / 1024 / 1024,
        net_rx_bytes_per_sec: rx,
        net_tx_bytes_per_sec: tx,
    }
}

/// Stream host stats once per second.
pub async fn stream(tx: mpsc::Sender<String>) {
    loop {
        let s = snapshot();
        if tx.send(serde_json::to_string(&s).unwrap()).await.is_err() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}
