// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::process::Command as StdCommand;
use std::sync::atomic::{AtomicBool, Ordering};
use parking_lot::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const DEFAULT_WS_PORT: u16 = 18789;
const DEFAULT_HTTP_PORT: u16 = 18790;
const POLL_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Serialize, Deserialize, Clone)]
struct ServerConfig {
    #[serde(default = "default_ws_port")]
    ws_port: u16,
    #[serde(default = "default_http_port")]
    http_port: u16,
    #[serde(default)]
    secret: String,
}

fn default_ws_port() -> u16 {
    DEFAULT_WS_PORT
}
fn default_http_port() -> u16 {
    DEFAULT_HTTP_PORT
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            ws_port: DEFAULT_WS_PORT,
            http_port: DEFAULT_HTTP_PORT,
            secret: String::new(),
        }
    }
}

#[derive(Deserialize)]
struct BrowserInfo {
    #[serde(rename = "browserId")]
    browser_id: String,
    #[serde(rename = "browserType")]
    browser_type: Option<String>,
}

#[derive(Deserialize)]
struct HealthResponse {
    browsers: Vec<BrowserInfo>,
}

struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    running: AtomicBool,
}

struct MenuHandles {
    status_item: MenuItem<tauri::Wry>,
    browsers_submenu: Submenu<tauri::Wry>,
    toggle_item: MenuItem<tauri::Wry>,
    autostart_item: CheckMenuItem<tauri::Wry>,
}

fn config_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("app config dir must resolve");
    fs::create_dir_all(&dir).ok();
    dir
}

fn config_path(app: &AppHandle) -> PathBuf {
    config_dir(app).join("config.json")
}

fn log_path(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_log_dir().expect("app log dir must resolve");
    fs::create_dir_all(&dir).ok();
    dir.join("mcp-server.log")
}

fn load_or_create_config(app: &AppHandle) -> ServerConfig {
    let path = config_path(app);
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<ServerConfig>(&raw) {
            return cfg;
        }
    }
    let cfg = ServerConfig::default();
    let _ = fs::write(&path, serde_json::to_string_pretty(&cfg).unwrap());
    cfg
}

fn reveal_path(path: &PathBuf) {
    #[cfg(target_os = "macos")]
    let _ = StdCommand::new("open").arg("-R").arg(path).spawn();
    #[cfg(target_os = "windows")]
    let _ = StdCommand::new("explorer").arg("/select,").arg(path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = StdCommand::new("xdg-open")
        .arg(path.parent().unwrap_or(path))
        .spawn();
}

fn start_sidecar(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    if state.running.load(Ordering::SeqCst) {
        return;
    }
    let cfg = load_or_create_config(app);
    let log_file = log_path(app);

    let (mut rx, child) = match app
        .shell()
        .sidecar("mcp-server")
        .expect("mcp-server sidecar must be bundled")
        .env("EXTENSION_PORT", cfg.ws_port.to_string())
        .env("MCP_HTTP_PORT", cfg.http_port.to_string())
        .env("EXTENSION_SECRET", cfg.secret.clone())
        .spawn()
    {
        Ok(pair) => pair,
        Err(err) => {
            append_log(&log_file, &format!("[desktop] failed to spawn sidecar: {err}\n"));
            set_status(app, "Status: error (see logs)");
            return;
        }
    };

    *state.child.lock() = Some(child);
    state.running.store(true, Ordering::SeqCst);
    set_status(app, "Status: starting…");
    set_toggle_label(app, "Stop server");

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let line = match event {
                CommandEvent::Stdout(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                CommandEvent::Stderr(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                CommandEvent::Terminated(payload) => {
                    let state = app_handle.state::<SidecarState>();
                    state.running.store(false, Ordering::SeqCst);
                    *state.child.lock() = None;
                    set_status(&app_handle, "Status: stopped");
                    set_toggle_label(&app_handle, "Start server");
                    update_browsers(&app_handle, &[]);
                    append_log(
                        &log_path(&app_handle),
                        &format!("[desktop] sidecar exited: {:?}\n", payload.code),
                    );
                    continue;
                }
                _ => continue,
            };
            append_log(&log_path(&app_handle), &line);
        }
    });
}

fn stop_sidecar(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    if let Some(child) = state.child.lock().take() {
        let _ = child.kill();
    }
    state.running.store(false, Ordering::SeqCst);
    set_status(app, "Status: stopped");
    set_toggle_label(app, "Start server");
    update_browsers(app, &[]);
}

fn append_log(path: &PathBuf, text: &str) {
    use std::io::Write;
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(text.as_bytes());
    }
}

fn set_status(app: &AppHandle, text: &str) {
    if let Some(menu) = app.try_state::<MenuHandles>() {
        let _ = menu.status_item.set_text(text);
    }
}

fn set_toggle_label(app: &AppHandle, text: &str) {
    if let Some(menu) = app.try_state::<MenuHandles>() {
        let _ = menu.toggle_item.set_text(text);
    }
}

fn update_browsers(app: &AppHandle, browsers: &[BrowserInfo]) {
    let Some(menu) = app.try_state::<MenuHandles>() else {
        return;
    };
    while let Ok(Some(_)) = menu.browsers_submenu.remove_at(0) {}
    if browsers.is_empty() {
        let item = MenuItem::with_id(app, "no-browsers", "No browsers connected", false, None::<&str>)
            .unwrap();
        let _ = menu.browsers_submenu.append(&item);
        return;
    }
    for b in browsers {
        let label = format!("{} ({})", b.browser_id, b.browser_type.as_deref().unwrap_or("unknown"));
        if let Ok(item) = MenuItem::with_id(app, format!("browser-{}", b.browser_id), label, false, None::<&str>) {
            let _ = menu.browsers_submenu.append(&item);
        }
    }
}

fn poll_health(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL_INTERVAL);
        let running = app.state::<SidecarState>().running.load(Ordering::SeqCst);
        if !running {
            continue;
        }
        let cfg = load_or_create_config(&app);
        let url = format!("http://127.0.0.1:{}/health", cfg.http_port);
        match ureq::get(&url).timeout(Duration::from_secs(2)).call() {
            Ok(resp) => {
                if let Ok(health) = resp.into_json::<HealthResponse>() {
                    set_status(&app, "Status: running");
                    update_browsers(&app, &health.browsers);
                }
            }
            Err(_) => {
                set_status(&app, "Status: starting…");
            }
        }
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let status_item = MenuItem::with_id(app, "status", "Status: stopped", false, None::<&str>)?;
    let browsers_submenu = Submenu::with_id(app, "browsers", "Connected browsers", true)?;
    let placeholder = MenuItem::with_id(app, "no-browsers", "No browsers connected", false, None::<&str>)?;
    browsers_submenu.append(&placeholder)?;

    let toggle_item = MenuItem::with_id(app, "toggle", "Stop server", true, None::<&str>)?;
    let autostart_manager = app.autolaunch();
    let autostart_enabled = autostart_manager.is_enabled().unwrap_or(false);
    let autostart_item =
        CheckMenuItem::with_id(app, "autostart", "Launch at startup", true, autostart_enabled, None::<&str>)?;
    let open_logs_item = MenuItem::with_id(app, "open-logs", "Open logs", true, None::<&str>)?;
    let reveal_config_item = MenuItem::with_id(app, "reveal-config", "Reveal config file", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &status_item,
            &browsers_submenu,
            &PredefinedMenuItem::separator(app)?,
            &toggle_item,
            &autostart_item,
            &PredefinedMenuItem::separator(app)?,
            &open_logs_item,
            &reveal_config_item,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    app.manage(MenuHandles {
        status_item,
        browsers_submenu,
        toggle_item,
        autostart_item,
    });

    let tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Tail MCP")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                let running = app.state::<SidecarState>().running.load(Ordering::SeqCst);
                if running {
                    stop_sidecar(app);
                } else {
                    start_sidecar(app);
                }
            }
            "autostart" => {
                let manager = app.autolaunch();
                let enabled = manager.is_enabled().unwrap_or(false);
                if enabled {
                    let _ = manager.disable();
                } else {
                    let _ = manager.enable();
                }
                if let Some(menu) = app.try_state::<MenuHandles>() {
                    let _ = menu.autostart_item.set_checked(!enabled);
                }
            }
            "open-logs" => reveal_path(&log_path(app)),
            "reveal-config" => reveal_path(&config_path(app)),
            "quit" => {
                stop_sidecar(app);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(tray)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(SidecarState {
            child: Mutex::new(None),
            running: AtomicBool::new(false),
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let handle = app.handle().clone();
            build_tray(&handle)?;
            start_sidecar(&handle);
            poll_health(handle);
            Ok(())
        })
        .on_window_event(|_, _| {})
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                stop_sidecar(app_handle);
            }
        });
}
