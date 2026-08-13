use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

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
fn set_system_proxy(enabled: bool, port: u16) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("networksetup").arg("-listallnetworkservices").output().map_err(|e| e.to_string())?;
        let services = String::from_utf8_lossy(&output.stdout).lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('*'))
            .map(String::from)
            .collect::<Vec<_>>();
        let service = services.iter().find(|name| *name == "Wi-Fi").or_else(|| services.iter().find(|name| *name == "Ethernet")).cloned().ok_or("未找到可用网络服务")?;
        for flag in ["-setwebproxy", "-setsecurewebproxy"] {
            let mut cmd = Command::new("networksetup");
            cmd.args([flag, &service, "127.0.0.1", &port.to_string()]);
            let result = cmd.output().map_err(|e| e.to_string())?;
            if !result.status.success() { return Err(String::from_utf8_lossy(&result.stderr).trim().to_string()); }
            let state = if flag == "-setwebproxy" { "-setwebproxystate" } else { "-setsecurewebproxystate" };
            let result = Command::new("networksetup").args([state, &service, if enabled { "on" } else { "off" }]).output().map_err(|e| e.to_string())?;
            if !result.status.success() { return Err(String::from_utf8_lossy(&result.stderr).trim().to_string()); }
        }
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        let mode = if enabled { "manual" } else { "none" };
        let status = Command::new("gsettings").args(["set", "org.gnome.system.proxy", "mode", mode]).status().map_err(|e| e.to_string())?;
        if !status.success() { return Err("gsettings 设置系统代理失败".into()); }
        if enabled {
            for key in ["host", "port"] {
                let value = if key == "host" { "127.0.0.1".to_string() } else { port.to_string() };
                let status = Command::new("gsettings").args(["set", "org.gnome.system.proxy.http", key, &value]).status().map_err(|e| e.to_string())?;
                if !status.success() { return Err("gsettings 设置代理地址失败".into()); }
            }
        }
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let value = if enabled { format!("127.0.0.1:{}", port) } else { "".to_string() };
        let args = if enabled { vec!["winhttp", "set", "proxy", value.as_str()] } else { vec!["winhttp", "reset", "proxy"] };
        let status = Command::new("netsh").args(args).status().map_err(|e| e.to_string())?;
        if !status.success() { return Err("Windows 系统代理设置失败".into()); }
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("当前平台不支持系统代理".into())
}

/// Handle to the Node backend so it can be killed when the window closes.
/// Without this the server survives the UI and holds the port.
struct Backend(Mutex<Option<Child>>);

/// Start the bundled server. In development it runs from source via the repo's
/// `server/` directory; a packaged build uses the sidecar binary placed next to
/// the app executable.
fn spawn_backend(app: &tauri::AppHandle) -> Option<Child> {
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

    match cmd.stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
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
        .invoke_handler(tauri::generate_handler![open_external_url, set_system_proxy])
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let child = spawn_backend(app.handle());
            *app.state::<Backend>().0.lock().unwrap() = child;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(mut child) = window.state::<Backend>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
