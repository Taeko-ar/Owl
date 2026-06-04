use dirs::config_dir;
use std::fs;
use std::path::{Path, PathBuf, Component};

pub fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(c) => normalized.push(c),
            Component::ParentDir => {
                normalized.pop();
            }
            Component::RootDir => {
                normalized.push(Component::RootDir.as_os_str());
            }
            Component::Prefix(p) => {
                normalized.push(p.as_os_str());
            }
            Component::CurDir => {}
        }
    }
    normalized
}

pub fn copy_dir_recursive(src: &Path, dst: &Path) -> std::result::Result<(), String> {
    if !dst.exists() {
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    }
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn get_settings_file_path() -> std::result::Result<PathBuf, String> {
    let mut config_dir = config_dir().ok_or("Unable to determine app config directory".to_string())?;
    config_dir.push("owl");
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    config_dir.push("settings.json");
    Ok(config_dir)
}

pub const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn owl_http_client() -> std::result::Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("OWL-Launcher")
        .build()
        .map_err(|e| e.to_string())
}

pub fn try_cleanup_temp_install(addons_dir: &Path) {
    let temp_parent = addons_dir.join(".temp_install");
    if temp_parent.exists() {
        if let Ok(entries) = fs::read_dir(&temp_parent) {
            let count = entries.filter_map(Result::ok).count();
            if count == 0 {
                let _ = fs::remove_dir(&temp_parent);
            }
        }
    }
}

pub async fn stream_response_to_file(
    app_handle: Option<&tauri::AppHandle>,
    resp: reqwest::Response,
    dest: &std::path::Path,
    max_bytes: u64,
) -> std::result::Result<(), String> {
    use tokio::io::AsyncWriteExt;
    use futures_util::StreamExt;
    use tauri::Emitter;

    let content_length = resp.content_length();
    let mut file = tokio::fs::File::create(dest).await.map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded > max_bytes {
            drop(file);
            let _ = std::fs::remove_file(dest);
            return Err(format!("Download exceeded {} MB limit", max_bytes / 1_048_576));
        }
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;

        if let Some(app) = app_handle {
            let _ = app.emit("download-progress", serde_json::json!({
                "downloaded": downloaded,
                "total": content_length,
            }));
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}
