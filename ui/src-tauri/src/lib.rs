use std::fs::{create_dir_all, write, OpenOptions};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
use tauri_plugin_updater::UpdaterExt;

fn proxy_snapshot_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("system-proxy.snapshot"))
}

fn snapshot_system_proxy(app: &tauri::AppHandle) -> Result<(), String> {
    let path = proxy_snapshot_path(app)?;
    if path.exists() { return Ok(()); }
    #[cfg(target_os = "macos")]
    let value = {
        let services = Command::new("networksetup").arg("-listallnetworkservices").output().map_err(|e| e.to_string())?;
        let service_text = String::from_utf8_lossy(&services.stdout);
        let names = service_text.lines().map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('*') && *line != "An asterisk (*) denotes that a network service is disabled.");
        let mut out = String::new();
        for name in names {
            out.push_str("[service] "); out.push_str(name); out.push('\n');
            for flag in ["-getwebproxy", "-getsecurewebproxy"] {
                let result = Command::new("networksetup").args([flag, name]).output().map_err(|e| e.to_string())?;
                out.push_str(flag); out.push('\n'); out.push_str(&String::from_utf8_lossy(&result.stdout));
            }
        }
        out.into_bytes()
    };
    #[cfg(target_os = "linux")]
    let value = {
        let keys = [
            ("mode", "org.gnome.system.proxy", "mode"),
            ("http-host", "org.gnome.system.proxy.http", "host"), ("http-port", "org.gnome.system.proxy.http", "port"),
            ("https-host", "org.gnome.system.proxy.https", "host"), ("https-port", "org.gnome.system.proxy.https", "port"),
            ("ftp-host", "org.gnome.system.proxy.ftp", "host"), ("ftp-port", "org.gnome.system.proxy.ftp", "port"),
            ("ignore-hosts", "org.gnome.system.proxy", "ignore-hosts"),
        ];
        let mut out = String::new();
        for (key, schema, gkey) in keys {
            let result = Command::new("gsettings").args(["get", schema, gkey]).output().map_err(|e| e.to_string())?;
            out.push_str(key); out.push('='); out.push_str(String::from_utf8_lossy(&result.stdout).trim()); out.push('\n');
        }
        out.into_bytes()
    };
    #[cfg(target_os = "windows")]
    let value = Command::new("netsh").args(["winhttp", "show", "proxy"]).output().map_err(|e| e.to_string())?.stdout;
    #[allow(unreachable_code)]
    write(path, value).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let result = Command::new("cmd").args(["/C", "start", "", &url]).spawn();
    #[cfg(target_os = "linux")]
    let result = Command::new("xdg-open").arg(&url).spawn();
    result.map(|_| ()).map_err(|error| error.to_string())
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(match update {
        Some(update) => serde_json::json!({
            "available": true,
            "currentVersion": update.current_version,
            "version": update.version,
            "date": update.date.map(|value| value.to_string()),
            "body": update.body,
        }),
        None => serde_json::json!({ "available": false }),
    })
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else { return Ok(serde_json::json!({ "available": false })); };
    let version = update.version.clone();
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "available": true, "installed": true, "version": version }))
}

#[tauri::command]
fn set_system_proxy(app: tauri::AppHandle, enabled: bool, port: u16) -> Result<(), String> {
    if enabled { snapshot_system_proxy(&app)?; }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("networksetup").arg("-listallnetworkservices").output().map_err(|e| e.to_string())?;
        let services = String::from_utf8_lossy(&output.stdout).lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('*'))
            .map(String::from)
            .collect::<Vec<_>>();
        let selected_services = if enabled {
            services.iter().filter(|name| *name == "Wi-Fi" || *name == "Ethernet").cloned().collect::<Vec<_>>()
        } else {
            services.clone()
        };
        if selected_services.is_empty() { return Err("未找到可用网络服务".into()); }
        let snapshot = if !enabled { std::fs::read_to_string(proxy_snapshot_path(&app)?).unwrap_or_default() } else { String::new() };
        for service in selected_services {
            let section = snapshot.split("[service] ").find_map(|block| block.strip_prefix(service.as_str())).unwrap_or("");
            for (get_flag, set_flag, state_flag) in [("-getwebproxy", "-setwebproxy", "-setwebproxystate"), ("-getsecurewebproxy", "-setsecurewebproxy", "-setsecurewebproxystate")] {
                let original_server = section.lines().skip_while(|line| *line != get_flag).skip(1).find_map(|line| line.strip_prefix("Server: ")).unwrap_or("");
                let original_port = section.lines().skip_while(|line| *line != get_flag).skip(1).find_map(|line| line.strip_prefix("Port: ")).unwrap_or("");
                let original_enabled = section.lines().skip_while(|line| *line != get_flag).skip(1).any(|line| line.trim().eq_ignore_ascii_case("Enabled: Yes"));
                let mut cmd = Command::new("networksetup");
                let host = if enabled { "127.0.0.1" } else if original_server.is_empty() { "127.0.0.1" } else { original_server };
                let proxy_port = if enabled { port.to_string() } else if original_port.is_empty() { "0".into() } else { original_port.into() };
                cmd.args([set_flag, &service, host, &proxy_port]);
                let result = cmd.output().map_err(|e| e.to_string())?;
                if !result.status.success() { return Err(String::from_utf8_lossy(&result.stderr).trim().to_string()); }
                let result = Command::new("networksetup").args([state_flag, &service, if enabled || original_enabled { "on" } else { "off" }]).output().map_err(|e| e.to_string())?;
                if !result.status.success() { return Err(String::from_utf8_lossy(&result.stderr).trim().to_string()); }
            }
        }
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        let snapshot = std::fs::read_to_string(proxy_snapshot_path(&app)?).unwrap_or_default();
        let mode = if enabled { "manual" } else { snapshot.lines().find_map(|line| line.strip_prefix("mode=")).unwrap_or("none").trim_matches('\'') };
        let status = Command::new("gsettings").args(["set", "org.gnome.system.proxy", "mode", mode]).status().map_err(|e| e.to_string())?;
        if !status.success() { return Err("gsettings 设置系统代理失败".into()); }
        if enabled {
            for (schema, key) in [("org.gnome.system.proxy.http", "host"), ("org.gnome.system.proxy.http", "port"), ("org.gnome.system.proxy.https", "host"), ("org.gnome.system.proxy.https", "port"), ("org.gnome.system.proxy.ftp", "host"), ("org.gnome.system.proxy.ftp", "port")] {
                let value = if key == "host" { "127.0.0.1".to_string() } else { port.to_string() };
                let status = Command::new("gsettings").args(["set", schema, key, &value]).status().map_err(|e| e.to_string())?;
                if !status.success() { return Err("gsettings 设置代理地址失败".into()); }
            }
        }
        if !enabled {
            for (line_key, schema, gkey) in [("http-host", "org.gnome.system.proxy.http", "host"), ("http-port", "org.gnome.system.proxy.http", "port"), ("https-host", "org.gnome.system.proxy.https", "host"), ("https-port", "org.gnome.system.proxy.https", "port"), ("ftp-host", "org.gnome.system.proxy.ftp", "host"), ("ftp-port", "org.gnome.system.proxy.ftp", "port"), ("ignore-hosts", "org.gnome.system.proxy", "ignore-hosts")] {
                if let Some(value) = snapshot.lines().find_map(|line| line.strip_prefix(&format!("{}=", line_key))) {
                    let status = Command::new("gsettings").args(["set", schema, gkey, value]).status().map_err(|e| e.to_string())?;
                    if !status.success() { return Err("gsettings 恢复代理设置失败".into()); }
                }
            }
        }
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let snapshot = if !enabled { std::fs::read_to_string(proxy_snapshot_path(&app)?).unwrap_or_default() } else { String::new() };
        let original = snapshot.lines().find_map(|line| line.strip_prefix("Proxy Server(s) :").map(str::trim)).filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("(none)"));
        let value = if enabled { Some(format!("127.0.0.1:{}", port)) } else { original.map(str::to_string) };
        let args = if let Some(proxy) = value.as_deref() { vec!["winhttp", "set", "proxy", proxy] } else { vec!["winhttp", "reset", "proxy"] };
        let status = Command::new("netsh").args(args).status().map_err(|e| e.to_string())?;
        if !status.success() { return Err("Windows 系统代理设置失败".into()); }
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("当前平台不支持系统代理".into())
}

#[tauri::command]
fn system_proxy_status() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("networksetup").args(["-getwebproxy", "Wi-Fi"]).output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
        return Ok(text.lines().any(|line| line.trim() == "enabled: yes"));
    }
    #[cfg(target_os = "linux")]
    {
        let output = Command::new("gsettings").args(["get", "org.gnome.system.proxy", "mode"]).output().map_err(|e| e.to_string())?;
        return Ok(String::from_utf8_lossy(&output.stdout).contains("'manual'"));
    }
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("netsh").args(["winhttp", "show", "proxy"]).output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
        return Ok(!text.contains("direct access") && !text.contains("no proxy"));
    }
    #[allow(unreachable_code)]
    Err("当前平台不支持读取系统代理状态".into())
}

#[tauri::command]
fn tun_status() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "linux")]
    {
        let device = std::path::Path::new("/dev/net/tun").exists();
        let output = Command::new("ip").args(["-o", "link", "show"]).output();
        let text = output.as_ref().map(|value| String::from_utf8_lossy(&value.stdout).to_ascii_lowercase()).unwrap_or_default();
        let active = text.lines().any(|line| line.contains(": tun") || line.contains(" mihomo"));
        return Ok(serde_json::json!({ "state": if active { "active" } else if device { "inactive" } else { "permission-required" }, "active": active, "device": device, "detail": if active { "TUN 接口已创建" } else if device { "设备可用，等待 Mihomo 创建接口" } else { "缺少 /dev/net/tun" } }));
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("ifconfig").output();
        let text = output.as_ref().map(|value| String::from_utf8_lossy(&value.stdout).to_ascii_lowercase()).unwrap_or_default();
        let active = text.lines().any(|line| line.starts_with("utun"));
        return Ok(serde_json::json!({ "state": if active { "active" } else { "permission-required" }, "active": active, "device": true, "detail": if active { "utun 接口已创建" } else { "等待 Network Extension 或 Mihomo 创建 utun" } }));
    }
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("netsh").args(["interface", "show", "interface"]).output();
        let text = output.as_ref().map(|value| String::from_utf8_lossy(&value.stdout).to_ascii_lowercase()).unwrap_or_default();
        let active = text.lines().any(|line| line.contains("wintun") || line.contains("mihomo") || line.contains("tun"));
        return Ok(serde_json::json!({ "state": if active { "active" } else { "permission-required" }, "active": active, "device": true, "detail": if active { "TUN/Wintun 接口已创建" } else { "等待 Wintun 驱动或管理员权限" } }));
    }
    #[allow(unreachable_code)]
    Ok(serde_json::json!({ "state": "unsupported", "active": false, "device": false, "detail": "当前平台不支持 TUN 探测" }))
}

fn restore_system_proxy(app: &tauri::AppHandle) -> Result<bool, String> {
    let path = proxy_snapshot_path(app)?;
    if !path.exists() { return Ok(false); }
    set_system_proxy(app.clone(), false, 0)?;
    std::fs::remove_file(path).map_err(|error| error.to_string())?;
    Ok(true)
}

fn recover_stale_system_proxy(app: &tauri::AppHandle) {
    match restore_system_proxy(app) {
        Ok(true) => eprintln!("restored stale system proxy snapshot during startup"),
        Ok(false) => {}
        Err(error) => eprintln!("failed to restore stale system proxy snapshot: {error}"),
    }
}

/// Handle to the Node backend so it can be killed when the window closes.
/// Without this the server survives the UI and holds the port.
struct Backend(Mutex<Option<Child>>);

fn stop_backend(app: &tauri::AppHandle) {
    if let Err(error) = restore_system_proxy(app) {
        eprintln!("failed to restore system proxy on shutdown: {error}");
    }
    if let Some(mut child) = app.state::<Backend>().0.lock().unwrap().take() {
        let _ = child.kill();
    }
}

/// Start the bundled server. In development it runs from source via the repo's
/// `server/` directory; a packaged build uses the sidecar binary placed next to
/// the app executable.
fn spawn_backend(app: &tauri::AppHandle) -> Option<Child> {
    let data_dir = app.path().app_data_dir().ok()?;
    create_dir_all(&data_dir).ok()?;
    let db_path = data_dir.join("pool.db");
    let log_path = data_dir.join("backend.log");
    let log = OpenOptions::new().create(true).append(true).open(log_path).ok()?;
    let log_err = log.try_clone().ok()?;
    let mut cmd = if cfg!(debug_assertions) {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("server"))?;
        let mut c = Command::new("npx");
        c.args(["tsx", "src/cli.ts", "serve"]).current_dir(root);
        c
    } else {
        // Packaged: use the platform Node runtime shipped as a Tauri resource.
        let script = app.path().resource_dir().ok()?.join("server/cli.js");
        let node_name = if cfg!(target_os = "windows") { "node.exe" } else { "bin/node" };
        let node = app.path().resource_dir().ok()?.join("runtime/node").join(node_name);
        let mut c = Command::new(node);
        c.arg(script).arg("serve");
        c
    };

    let mihomo = app.path().resource_dir().ok()?.join("runtime/mihomo").join(if cfg!(target_os = "windows") { "mihomo.exe" } else { "mihomo" });
    cmd.env("PM_DB", db_path)
        .env("PM_MIHOMO_DIR", data_dir.join("mihomo"));
    if mihomo.exists() { cmd.env("PM_MIHOMO_BIN", mihomo); } else { cmd.env_remove("PM_MIHOMO_BIN"); }
    cmd
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    match cmd.spawn() {
        Ok(child) => Some(child),
        Err(e) => {
            eprintln!("failed to start backend: {e}");
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![open_external_url, check_for_update, install_update, set_system_proxy, system_proxy_status, tun_status])
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            recover_stale_system_proxy(app.handle());
            let child = spawn_backend(app.handle());
            *app.state::<Backend>().0.lock().unwrap() = child;
            let show = MenuItemBuilder::with_id("show", "打开 ProxyManager").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
            let icon = app.default_window_icon().cloned().ok_or("缺少应用图标")?;
            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("ProxyManager")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        stop_backend(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            } else if let WindowEvent::Destroyed = event {
                stop_backend(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
