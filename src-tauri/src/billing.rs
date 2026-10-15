use tauri::WebviewWindow;

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Openai,
    Gemini,
}

#[tauri::command]
pub async fn open_billing(window: WebviewWindow, provider: Provider) -> Result<(), String> {
    if window.label() != "main" {
        return Err("操作は許可されていません。".into());
    }
    // 任意のURLや引数は受け付けず、課金画面だけを既定のブラウザで開きます。
    let url = match provider {
        Provider::Openai => "https://platform.openai.com/settings/organization/billing/overview",
        Provider::Gemini => "https://aistudio.google.com/billing",
    };
    tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new("/usr/bin/open")
            .arg(url)
            .status()
            .map_err(|_| "課金画面を開けませんでした。".to_string())
            .and_then(|status| {
                if status.success() {
                    Ok(())
                } else {
                    Err("課金画面を開けませんでした。".into())
                }
            })
    })
    .await
    .map_err(|_| "課金画面を開けませんでした。".to_string())?
}
