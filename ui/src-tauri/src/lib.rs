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
        // Packaged: run the compiled server bundled under resources/. Node is a
        // runtime dependency rather than an embedded binary -- better-sqlite3 is
        // a native module, so a single-file build would need per-platform
        // prebuilds. The UI surfaces a clear error if the backend never answers.
        let script = app.path().resource_dir().ok()?.join("server/cli.js");
        let mut c = Command::new("node");
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
        .invoke_handler(tauri::generate_handler![open_external_url])
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
