use std::fs;
use std::path::{Path, PathBuf};

#[tauri::command]
pub fn get_patches(base_path: String) -> std::result::Result<Vec<String>, String> {
    let data_dir = PathBuf::from(&base_path).join("Data");
    if !data_dir.exists() {
        return Ok(Vec::new());
    }
    let mut patches: Vec<String> = fs::read_dir(&data_dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if !name.ends_with(".mpq") {
                return false;
            }
            let stem = name.strip_suffix(".mpq").unwrap_or(&name);
            let stem = stem.strip_suffix("-disabled").unwrap_or(stem);
            
            if !stem.starts_with("patch-") || stem.len() != 7 {
                return false;
            }
            if let Some(c) = stem.chars().nth(6) {
                c.is_ascii_alphabetic()
            } else {
                false
            }
        })
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();

    patches.sort();
    Ok(patches)
}

#[tauri::command]
pub fn toggle_patch(base_path: String, patch_name: String, enable: bool) -> std::result::Result<String, String> {
    if patch_name.contains("..") || patch_name.contains('/') || patch_name.contains('\\') {
        return Err("Invalid patch name".into());
    }
    let data_dir = PathBuf::from(&base_path).join("Data");
    if !data_dir.exists() {
        return Err("Data directory not found".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let canonical_data = fs::canonicalize(&data_dir).map_err(|e| e.to_string())?;
    if !canonical_data.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }

    let p = Path::new(&patch_name);
    let ext_opt = p.extension().and_then(|s| s.to_str()).map(|s| s.to_string());
    let stem_opt = p.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string());

    if let (Some(ext), Some(stem)) = (ext_opt, stem_opt) {
        let base_stem = if stem.ends_with("-disabled") {
            stem.trim_end_matches("-disabled").to_string()
        } else {
            stem.clone()
        };

        let enabled_name = format!("{}.{}", base_stem, ext);
        let disabled_name = format!("{}-disabled.{}", base_stem, ext);

        let enabled_path = data_dir.join(&enabled_name);
        let disabled_path = data_dir.join(&disabled_name);

        if enable {
            if enabled_path.exists() {
                return Ok("Already enabled".into());
            }
            if disabled_path.exists() {
                fs::rename(&disabled_path, &enabled_path).map_err(|e| e.to_string())?;
                return Ok("Enabled".into());
            }
            return Err("Patch file to enable not found".into());
        } else {
            if disabled_path.exists() {
                return Ok("Already disabled".into());
            }
            if enabled_path.exists() {
                if disabled_path.exists() {
                    return Err("Disabled target already exists".into());
                }
                fs::rename(&enabled_path, &disabled_path).map_err(|e| e.to_string())?;
                return Ok("Disabled".into());
            }
            return Err("Patch file to disable not found".into());
        }
    } else {
        let base_name = if patch_name.ends_with("-disabled") {
            patch_name.trim_end_matches("-disabled").to_string()
        } else {
            patch_name.clone()
        };

        let enabled_path = data_dir.join(&base_name);
        let disabled_path = data_dir.join(format!("{}-disabled", base_name));

        if enable {
            if enabled_path.exists() {
                return Ok("Already enabled".into());
            }
            if disabled_path.exists() {
                fs::rename(&disabled_path, &enabled_path).map_err(|e| e.to_string())?;
                return Ok("Enabled".into());
            }
            return Err("Patch file to enable not found".into());
        } else {
            if disabled_path.exists() {
                return Ok("Already disabled".into());
            }
            if enabled_path.exists() {
                if disabled_path.exists() {
                    return Err("Disabled target already exists".into());
                }
                fs::rename(&enabled_path, &disabled_path).map_err(|e| e.to_string())?;
                return Ok("Disabled".into());
            }
            return Err("Patch file to disable not found".into());
        }
    }
}

#[tauri::command]
pub fn delete_patch(base_path: String, patch_name: String) -> std::result::Result<String, String> {
    if patch_name.contains("..") || patch_name.contains('/') || patch_name.contains('\\') {
        return Err("Invalid patch name".into());
    }
    let patch_path = PathBuf::from(&base_path).join("Data").join(&patch_name);
    if !patch_path.exists() {
        return Err("Patch file not found".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let canonical_path = fs::canonicalize(&patch_path).map_err(|e| e.to_string())?;
    if !canonical_path.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }
    fs::remove_file(&patch_path)
        .map_err(|e| format!("Failed to delete patch: {}", e))?;
    Ok(format!("Deleted {}", patch_name))
}

