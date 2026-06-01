use rfd::FileDialog;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[tauri::command]
pub fn open_addon_folder(base_path: String, addon_name: String) -> std::result::Result<String, String> {
    if addon_name.contains("..") || addon_name.contains('/') || addon_name.contains('\\') {
        return Err("Invalid addon name".into());
    }
    let folder = PathBuf::from(&base_path).join("Interface").join("AddOns").join(&addon_name);
    if !folder.exists() {
        return Err("Addon folder not found".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let canonical_folder = fs::canonicalize(&folder).map_err(|e| e.to_string())?;
    if !canonical_folder.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok("Opened".into())
}

#[tauri::command]
pub fn open_folder(base_path: String, rel_path: String) -> std::result::Result<String, String> {
    if rel_path.contains("..") {
        return Err("Directory traversal attempt blocked".into());
    }
    let folder = PathBuf::from(&base_path).join(&rel_path);
    if !folder.exists() {
        return Err("Folder not found".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let canonical_folder = fs::canonicalize(&folder).map_err(|e| e.to_string())?;
    if !canonical_folder.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok("Opened".into())
}

#[tauri::command]
pub fn pick_folder() -> std::result::Result<String, String> {
    if let Some(path) = FileDialog::new().set_title("Select Game Folder").pick_folder() {
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Folder selection canceled".into())
    }
}

#[tauri::command]
pub fn pick_files() -> std::result::Result<Vec<String>, String> {
    if let Some(paths) = FileDialog::new()
        .set_title("Select addon archive file(s)")
        .add_filter("Addon archives", &["zip", "7z"])
        .add_filter("All files", &["*"])
        .pick_files()
    {
        Ok(paths.iter().map(|p| p.to_string_lossy().to_string()).collect())
    } else {
        Ok(Vec::new())
    }
}

