use keyring::Entry;
const SERVICE: &str = "jp.ledad.desktop";
pub fn read(name: &str) -> String {
    Entry::new(SERVICE, name)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .unwrap_or_default()
}
pub fn save(name: &str, value: &str) -> Result<(), String> {
    Entry::new(SERVICE, name)
        .map_err(|_| "キーチェーンを開けません。")?
        .set_password(value)
        .map_err(|_| "APIキーをキーチェーンへ保存できませんでした。".into())
}

pub fn import_development_keys() {
    // 開発時だけ既存のenv.localを取り込みます。配布物にキーを含めません。
    if !cfg!(debug_assertions) {
        return;
    }
    for directory in [
        std::env::current_dir().ok(),
        std::env::current_dir()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf())),
    ]
    .into_iter()
    .flatten()
    {
        for name in [".env.local", "env.local"] {
            if let Ok(entries) = dotenvy::from_path_iter(directory.join(name)) {
                for (key, value) in entries.flatten() {
                    if ["OPENAI_API_KEY", "GEMINI_API_KEY"].contains(&key.as_str())
                        && !value.is_empty()
                    {
                        let _ = save(&key, &value);
                    }
                }
            }
        }
    }
}
