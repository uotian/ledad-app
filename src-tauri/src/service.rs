use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
};
use tokio::sync::{oneshot, watch};
use tauri::ipc::Channel;

type Pending = (oneshot::Sender<Value>, Option<Channel<String>>);

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;

pub struct Service {
    stdin: Arc<Mutex<ChildStdin>>,
    child: Mutex<Child>,
    pending: Arc<Mutex<HashMap<String, Pending>>>,
    credentials_ready: watch::Receiver<bool>,
}
impl Service {
    pub fn start(resources: PathBuf, data_dir: PathBuf) -> Result<Self, String> {
        let runtime = resources.join("service/ledad-service");
        let child = Command::new(runtime)
            .current_dir(&resources)
            .env("LEDAD_DATA_DIR", data_dir.to_string_lossy().to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "アプリの内部処理を起動できませんでした。再インストールしてください。")?;
        let (ready, credentials_ready) = watch::channel(false);
        let service = Self::connect(child, credentials_ready)?;
        let initializer = service.stdin.clone();
        // キーチェーンの許可待ちでmacOSの画面スレッドを止めないようにします。
        std::thread::spawn(move || {
            crate::credentials::import_development_keys();
            let openai = crate::credentials::read("OPENAI_API_KEY");
            let gemini = crate::credentials::read("GEMINI_API_KEY");
            let init = json!({"init":{"openaiKey":openai,"geminiKey":gemini,"dataDir":data_dir}});
            if let Ok(mut writer) = initializer.lock() {
                let _ = writeln!(writer, "{}", init);
                let _ = writer.flush();
            }
            let _ = ready.send(true);
        });
        Ok(service)
    }

    fn connect(mut child: Child, credentials_ready: watch::Receiver<bool>) -> Result<Self, String> {
        let stdin = Arc::new(Mutex::new(
            child.stdin.take().ok_or("内部通信を開始できません。")?,
        ));
        let stdout = child.stdout.take().ok_or("内部通信を開始できません。")?;
        let pending: Arc<Mutex<HashMap<String, Pending>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let waiters = pending.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    if let Some(id) = value.get("id").and_then(Value::as_str) {
                        let mut pending = waiters.lock().unwrap();
                        if let Some(text) = value.get("text").and_then(Value::as_str) {
                            if let Some((_, Some(channel))) = pending.get(id) {
                                let _ = channel.send(text.to_string());
                            }
                        } else if let Some((sender, _)) = pending.remove(id) {
                            let _ = sender.send(value);
                        }
                    }
                }
            }
            waiters.lock().unwrap().clear();
        });
        Ok(Self {
            stdin,
            child: Mutex::new(child),
            pending,
            credentials_ready,
        })
    }
    pub fn send(&self, value: &Value) -> Result<(), String> {
        let mut stdin = self
            .stdin
            .lock()
            .map_err(|_| "内部通信を利用できません。")?;
        writeln!(stdin, "{}", value)
            .map_err(|_| "内部処理との接続が切れました。アプリを再起動してください。")?;
        stdin.flush().map_err(|_| "内部通信に失敗しました。".into())
    }
    pub async fn request(&self, input: Value, on_text: Option<Channel<String>>) -> Result<Value, String> {
        // 原本の登録はAPIキーを待たず、参照文の生成時だけ待ちます。
        let path = input.get("path").and_then(Value::as_str).unwrap_or("");
        let document_preparation = path.ends_with("/document-reference")
            && input.get("method").and_then(Value::as_str) == Some("POST");
        if path == "/api/config"
            || path == "/api/speech"
            || path == "/api/live-token"
            || document_preparation
            || [
                "/generate",
                "/analyze",
                "/minutes",
                "/translate",
                "/insights",
                "/consult",
                "/translate-transcript",
                "/refine-transcripts",
            ]
            .iter()
            .any(|suffix| path.ends_with(suffix))
        {
            let mut ready = self.credentials_ready.clone();
            tokio::time::timeout(std::time::Duration::from_secs(30), ready.wait_for(|value| *value))
                .await.map_err(|_| "APIキーの読み込みを待っています。Macのキーチェーンの確認画面を確認してから再試行してください。")?
                .map_err(|_| "APIキーを読み込めませんでした。アプリを再起動してください。")?;
        }
        let id = input
            .get("id")
            .and_then(Value::as_str)
            .ok_or("識別情報がありません。")?
            .to_string();
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), (sender, on_text));
        if let Err(error) = self.send(&input) {
            self.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        let timeout = if document_preparation { 300 } else { 180 };
        let result = tokio::time::timeout(std::time::Duration::from_secs(timeout), receiver).await;
        self.pending.lock().unwrap().remove(&id);
        if result.is_err() {
            let _ = self.send(&json!({"cancel": id}));
        }
        result
            .map_err(|_| "処理に時間がかかっています。もう一度お試しください。")?
            .map_err(|_| "内部処理が終了しました。アプリを再起動してください。".into())
    }
    pub fn stop(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
