use std::fs;
use crate::models::*;
use crate::fs_utils::*;

#[tauri::command]
pub fn load_settings() -> std::result::Result<LauncherSettings, String> {
    let settings_file_path = get_settings_file_path()?;
    if !settings_file_path.exists() {
        let default_path = if cfg!(target_os = "windows") {
            Some("C:\\".to_string())
        } else {
            dirs::home_dir().map(|p| p.to_string_lossy().to_string()).or_else(|| Some("/".to_string()))
        };
        return Ok(LauncherSettings {
            path: default_path,
            window_size: None,
            stay_open: Some(true),
        });
    }

    let content = fs::read_to_string(&settings_file_path).map_err(|e| e.to_string())?;
    let mut settings: LauncherSettings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    if settings.path.is_none() {
        settings.path = if cfg!(target_os = "windows") {
            Some("C:\\".to_string())
        } else {
            dirs::home_dir().map(|p| p.to_string_lossy().to_string()).or_else(|| Some("/".to_string()))
        };
    }
    if settings.stay_open.is_none() {
        settings.stay_open = Some(true);
    }
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(settings: LauncherSettings) -> std::result::Result<String, String> {
    let settings_file_path = get_settings_file_path()?;
    fs::write(&settings_file_path, serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok("OK".into())
}

