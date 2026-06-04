#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use crate::fs_utils::CREATE_NO_WINDOW;

#[tauri::command]
pub fn launch_game(base_path: String, _stay_open: bool) -> std::result::Result<String, String> {
    let base = PathBuf::from(&base_path);

    if !base.exists() {
        return Err(format!("Game directory does not exist: {}", base.display()));
    }

    let candidates = [
        "WoW.exe",
        "WoW.app",
        "World of Warcraft.app",
        "WoW",
        "worldofwarcraft",
        "World of Warcraft",
    ];

    let mut detected_exe = None;
    for c in &candidates {
        if base.join(c).exists() {
            detected_exe = Some(c.to_string());
            break;
        }
    }

    let exe = match detected_exe {
        Some(e) => e,
        None => {
            return Err(format!(
                "No WoW executable found in {}. Checked: WoW.exe, WoW.app, World of Warcraft.app, WoW",
                base.display()
            ));
        }
    };

    let cache_paths = vec![
        base.join("Cache"),
        base.join("WTF").join("Cache"),
    ];
    for cache_path in cache_paths {
        if cache_path.exists() {
            let _ = fs::remove_dir_all(&cache_path);
        }
    }

    #[cfg(target_os = "windows")]
    {
        Command::new(base.join(&exe))
            .creation_flags(CREATE_NO_WINDOW)
            .current_dir(&base)
            .spawn()
            .map_err(|e| format!("Failed to launch {}: {}", exe, e))?;
    }

    #[cfg(target_os = "macos")]
    {
        if exe.ends_with(".app") {
            Command::new("open")
                .arg(base.join(&exe))
                .current_dir(&base)
                .spawn()
                .map_err(|e| format!("Failed to launch macOS App bundle {}: {}", exe, e))?;
        } else {
            Command::new(base.join(&exe))
                .current_dir(&base)
                .spawn()
                .map_err(|e| format!("Failed to launch {}: {}", exe, e))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        if exe.ends_with(".exe") {
            Command::new("wine")
                .arg(base.join(&exe))
                .current_dir(&base)
                .spawn()
                .or_else(|_| {
                    Command::new(base.join(&exe))
                        .current_dir(&base)
                        .spawn()
                })
                .map_err(|e| format!("Failed to launch {}: {}", exe, e))?;
        } else {
            Command::new(base.join(&exe))
                .current_dir(&base)
                .spawn()
                .map_err(|e| format!("Failed to launch {}: {}", exe, e))?;
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Command::new(base.join(&exe))
            .current_dir(&base)
            .spawn()
            .map_err(|e| format!("Failed to launch {}: {}", exe, e))?;
    }

    Ok("Game launched successfully".into())
}

#[tauri::command]
pub fn detect_game_version(base_path: String) -> String {
    let base_path_buf = std::path::PathBuf::from(&base_path);
    let data_dir = base_path_buf.join("Data");
    if data_dir.is_dir() {
        
        if data_dir.join("lichking.MPQ").exists() || data_dir.join("lichking.mpq").exists() {
            return "3.3.5a".to_string();
        }
        
        if let Ok(entries) = std::fs::read_dir(&data_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    if entry.path().join("lichking.MPQ").exists() || entry.path().join("lichking.mpq").exists() {
                        return "3.3.5a".to_string();
                    }
                }
            }
        }
    }
    "1.12.1".to_string()
}

#[tauri::command]
pub fn read_config(base_path: String) -> std::result::Result<String, String> {
    let config_path = PathBuf::from(&base_path).join("WTF").join("config.wtf");
    if !config_path.exists() {
        return Err("config.wtf not found".into());
    }
    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    Ok(content)
}

#[tauri::command]
pub fn set_config_value(base_path: String, key: String, value: String) -> std::result::Result<String, String> {
    if key.contains('\n') || key.contains('\r') || key.contains('"') {
        return Err("Invalid config key".into());
    }
    if value.contains('\n') || value.contains('\r') {
        return Err("Invalid config value".into());
    }

    let config_path = PathBuf::from(&base_path).join("WTF").join("config.wtf");
    if !config_path.exists() {
        return Err("config.wtf not found".into());
    }

    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let mut found = false;
    let key_trim = key.trim();

    for i in 0..lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.to_uppercase().starts_with("SET ") {
            if let Some(first_quote) = trimmed.find('"') {
                if let Some(second_quote_rel) = trimmed[first_quote+1..].find('"') {
                    let second_quote = first_quote + 1 + second_quote_rel;
                    let found_key = &trimmed[first_quote+1..second_quote];
                    if found_key == key_trim {
                        lines[i] = format!("SET \"{}\" \"{}\"", key_trim, value);
                        found = true;
                        break;
                    }
                }
            }
        } else {
            let token = trimmed.split(|c: char| c.is_whitespace() || c == '=').next().unwrap_or("");
            if token == key_trim {
                lines[i] = format!("SET \"{}\" \"{}\"", key_trim, value);
                found = true;
                break;
            }
        }
    }


    if !found {
        lines.push(format!("SET \"{}\" \"{}\"", key_trim, value));
    }

    let new_content = lines.join("\n");
    fs::write(&config_path, new_content).map_err(|e| e.to_string())?;

    Ok("OK".into())
}
