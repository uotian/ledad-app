mod billing;
mod capture;
mod credentials;
mod menu;
mod service;
#[cfg(target_os = "macos")]
mod window;
use serde_json::{json, Value};
use service::Service;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, State, WebviewWindow};

#[derive(Default)]
struct ExitState(AtomicBool);

#[tauri::command]
fn quit_app(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    if window.label() != "main" {
        return Err("操作は許可されていません。".into());
    }
    app.state::<ExitState>().0.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn service_request(
    window: WebviewWindow,
    service: State<'_, Service>,
    input: Value,
    on_text: tauri::ipc::Channel<String>,
) -> Result<Value, String> {
    let path = input
        .get("path")
        .and_then(Value::as_str)
        .ok_or("操作が指定されていません。")?;
    if window.label() != "main" {
        return Err("操作は許可されていません。".into());
    }
    if !path.starts_with("/api/") || path.contains("..") {
        return Err("操作が許可されていません。".into());
    }
    let streaming = input.get("stream").and_then(Value::as_bool).unwrap_or(false);
    service.request(input, if streaming { Some(on_text) } else { None }).await
}
#[tauri::command]
fn service_cancel(
    window: WebviewWindow,
    service: State<'_, Service>,
    id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("操作は許可されていません。".into());
    }
    service.send(&json!({"cancel":id}))
}
#[tauri::command]
async fn save_keys(
    window: WebviewWindow,
    service: State<'_, Service>,
    app: tauri::AppHandle,
    openai: String,
    gemini: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("操作は許可されていません。".into());
    }
    let (openai_key, gemini_key) =
        tauri::async_runtime::spawn_blocking(move || -> Result<(String, String), String> {
            if !openai.trim().is_empty() {
                credentials::save("OPENAI_API_KEY", openai.trim())?;
            }
            if !gemini.trim().is_empty() {
                credentials::save("GEMINI_API_KEY", gemini.trim())?;
            }
            Ok((
                credentials::read("OPENAI_API_KEY"),
                credentials::read("GEMINI_API_KEY"),
            ))
        })
        .await
        .map_err(|_| "キーチェーンの処理に失敗しました。")??;
    service.send(&json!({"init":{"openaiKey":openai_key,"geminiKey":gemini_key,"dataDir":app.path().app_data_dir().map_err(|_| "保存先を開けません。")?}}))
}
pub fn resource_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    if cfg!(debug_assertions) {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
    } else {
        app.path()
            .resource_dir()
            .expect("resources")
            .join("resources")
    }
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                window::restore(&window)?;
            }
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let service = Service::start(resource_dir(app.handle()), data)?;
            app.manage(service);
            app.manage(capture::CaptureState::default());
            app.manage(ExitState::default());
            menu::install(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            service_request,
            service_cancel,
            save_keys,
            quit_app,
            billing::open_billing,
            capture::start_capture,
            capture::finish_capture,
            capture::stop_capture
        ])
        .build(tauri::generate_context!())
        .expect("ledadを起動できませんでした")
        .run(|app, event| {
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } = &event
            {
                if label == "main" {
                    app.state::<ExitState>().0.store(true, Ordering::SeqCst);
                    app.exit(0);
                }
            }
            // Cmd+Qもウィンドウを閉じる経路へ送り、画面側の保存完了を待ちます。
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                if !app.state::<ExitState>().0.load(Ordering::SeqCst) {
                    if let Some(window) = app.get_webview_window("main") {
                        api.prevent_exit();
                        let _ = window.close();
                    }
                }
            }
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<Service>().stop();
                app.state::<capture::CaptureState>().stop();
            }
        });
}
