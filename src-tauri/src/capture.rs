use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Emitter, Manager, State, WebviewWindow};

#[derive(Default)]
pub struct CaptureState(Mutex<Option<(String, Child)>>);
impl CaptureState {
    pub fn stop(&self) {
        self.stop_id(None);
    }
    fn stop_id(&self, id: Option<&str>) {
        if let Ok(mut state) = self.0.lock() {
            if id.is_some() && state.as_ref().map(|(current, _)| current.as_str()) != id {
                return;
            }
            if let Some((_, mut child)) = state.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
    fn active(&self, id: &str) -> bool {
        self.0
            .lock()
            .ok()
            .is_some_and(|state| state.as_ref().is_some_and(|(current, _)| current == id))
    }
}
#[tauri::command]
pub fn start_capture(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, CaptureState>,
    source: String,
    capture_id: String,
    apple_locale: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("音声を取得できません。".into());
    }
    if !["microphone", "display", "mixed"].contains(&source.as_str())
        || !["", "ja-JP", "en-US", "zh-CN", "fr-FR"].contains(&apple_locale.as_str())
        || uuid::Uuid::parse_str(&capture_id).is_err()
    {
        return Err("入力元を確認してください。".into());
    }
    state.stop();
    let mut child = Command::new(crate::resource_dir(&app).join("ledad-audio"))
        .arg(&source)
        .arg(std::process::id().to_string())
        .arg(&apple_locale)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "音声入力を起動できません。")?;
    let stdout = child.stdout.take().ok_or("音声を読み取れません。")?;
    *state.0.lock().map_err(|_| "音声入力を利用できません。")? = Some((capture_id.clone(), child));
    std::thread::spawn(move || {
        let mut reported_error = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(mut value) = serde_json::from_str::<Value>(&line) {
                if value["type"] == "error" || value["type"] == "finished" {
                    reported_error = true;
                }
                value["captureId"] = json!(capture_id);
                let _ = window.emit("native-audio", value);
            }
        }
        if !reported_error && app.state::<CaptureState>().active(&capture_id) {
            let _ = window.emit("native-audio", json!({"captureId":capture_id,"type":"error","message":"音声入力が終了しました。入力元を確認して聞き取りを再開してください。"}));
        }
    });
    Ok(())
}
#[tauri::command]
pub fn finish_capture(
    window: WebviewWindow,
    state: State<'_, CaptureState>,
    capture_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("操作は許可されていません。".into());
    }
    let mut state = state.0.lock().map_err(|_| "音声入力を利用できません。")?;
    let (id, child) = state.as_mut().ok_or("音声入力は終了しています。")?;
    if id != &capture_id {
        return Err("音声入力は終了しています。".into());
    }
    child
        .stdin
        .as_mut()
        .ok_or("音声入力を終了できません。")?
        .write_all(b"finish\n")
        .map_err(|_| "音声入力を終了できません。".into())
}
#[tauri::command]
pub fn stop_capture(
    window: WebviewWindow,
    state: State<'_, CaptureState>,
    capture_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("操作は許可されていません。".into());
    }
    state.stop_id(Some(&capture_id));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(CaptureState);
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.0.stop();
        }
    }

    #[test]
    fn stale_stop_cannot_kill_new_capture_and_exit_reaps_current_child() {
        let child = Command::new("/bin/sleep").arg("60").spawn().unwrap();
        let pid = child.id();
        let fixture = Fixture(CaptureState(Mutex::new(Some(("new".into(), child)))));
        fixture.0.stop_id(Some("old"));
        assert!(fixture.0.active("new"));
        assert!(fixture.0.0.lock().unwrap().as_mut().unwrap().1.try_wait().unwrap().is_none());
        fixture.0.stop_id(Some("new"));
        fixture.0.stop();
        assert!(!fixture.0.active("new"));
        assert!(fixture.0.0.lock().unwrap().is_none());
        assert!(!Command::new("/bin/kill").args(["-0", &pid.to_string()])
            .stderr(Stdio::null()).status().unwrap().success());
    }

    #[test]
    fn app_exit_can_clean_up_a_capture_that_already_crashed() {
        let mut child = Command::new("/bin/sh").args(["-c", "exit 7"]).spawn().unwrap();
        assert_eq!(child.wait().unwrap().code(), Some(7));
        let fixture = Fixture(CaptureState(Mutex::new(Some(("crashed".into(), child)))));
        fixture.0.stop();
        fixture.0.stop();
        assert!(fixture.0.0.lock().unwrap().is_none());
    }
}
