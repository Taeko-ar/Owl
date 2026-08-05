#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
#[cfg(target_os = "windows")]
use crate::fs_utils::CREATE_NO_WINDOW;

#[tauri::command]
pub fn launch_game(base_path: String, _stay_open: bool) -> std::result::Result<String, String> {
    let base = PathBuf::from(&base_path);

    if !base.exists() {
        return Err(format!("Game directory does not exist: {}", base.display()));
    }

    let exe = match crate::fs_utils::find_game_executable(&base) {
        Some(e) => e,
        None => {
            return Err(format!(
                "No WoW executable found in {}. Checked: WoW.exe, wow.exe, WoW-64.exe, WoW.app, WoW",
                base.display()
            ));
        }
    };

    let cache_paths = vec![
        base.join("Cache"),
        base.join("WTF").join("Cache"),
        base.join("wtf").join("Cache"),
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
        if exe.to_lowercase().ends_with(".exe") {
            let pfx_dir = dirs::data_dir()
                .map(|d| d.join("owl").join("proton_prefix"))
                .unwrap_or_else(|| base.join(".proton"));
            let _ = std::fs::create_dir_all(&pfx_dir);

            let home_steam = dirs::home_dir().map(|h| h.join(".steam/steam")).unwrap_or_default();

            let custom_runner = std::env::var("GAME_RUNNER")
                .or_else(|_| std::env::var("WINE"))
                .ok();

            let mut spawn_result = None;

            if let Some(ref runner) = custom_runner {
                let parts: Vec<&str> = runner.split_whitespace().collect();
                if !parts.is_empty() {
                    let mut cmd = Command::new(parts[0]);
                    if parts.len() > 1 {
                        cmd.args(&parts[1..]);
                    }
                    cmd.arg(base.join(&exe))
                        .current_dir(&base)
                        .env("STEAM_COMPAT_DATA_PATH", &pfx_dir)
                        .env("STEAM_COMPAT_CLIENT_INSTALL_PATH", &home_steam);
                    let res = cmd.spawn();
                    if res.is_ok() {
                        spawn_result = Some(res);
                    }
                }
            }

            if spawn_result.as_ref().map_or(true, |r| r.is_err()) {
                let res = Command::new("proton")
                    .arg("run")
                    .arg(base.join(&exe))
                    .current_dir(&base)
                    .env("STEAM_COMPAT_DATA_PATH", &pfx_dir)
                    .env("STEAM_COMPAT_CLIENT_INSTALL_PATH", &home_steam)
                    .spawn();
                if res.is_ok() {
                    spawn_result = Some(res);
                }
            }

            if spawn_result.as_ref().map_or(true, |r| r.is_err()) {
                for (runner_path, is_script) in find_steam_proton_runners() {
                    let mut cmd = Command::new(&runner_path);
                    if is_script {
                        cmd.arg("run");
                    }
                    cmd.arg(base.join(&exe))
                        .current_dir(&base)
                        .env("STEAM_COMPAT_DATA_PATH", &pfx_dir)
                        .env("STEAM_COMPAT_CLIENT_INSTALL_PATH", &home_steam);
                    let res = cmd.spawn();
                    if res.is_ok() {
                        spawn_result = Some(res);
                        break;
                    }
                }
            }

            if spawn_result.as_ref().map_or(true, |r| r.is_err()) {
                let res = Command::new("wine")
                    .arg(base.join(&exe))
                    .current_dir(&base)
                    .spawn();
                if res.is_ok() {
                    spawn_result = Some(res);
                }
            }

            if spawn_result.as_ref().map_or(true, |r| r.is_err()) {
                let res = Command::new("wine64")
                    .arg(base.join(&exe))
                    .current_dir(&base)
                    .spawn();
                if res.is_ok() {
                    spawn_result = Some(res);
                }
            }

            if spawn_result.as_ref().map_or(true, |r| r.is_err()) {
                let res = Command::new(base.join(&exe))
                    .current_dir(&base)
                    .spawn();
                spawn_result = Some(res);
            }

            let final_res = spawn_result.unwrap();
            match final_res {
                Ok(_) => {}
                Err(e) => {
                    let err_str = e.to_string();
                    if e.kind() == std::io::ErrorKind::NotFound
                        || e.raw_os_error() == Some(8)
                        || err_str.contains("Exec format error")
                    {
                        return Err(format!(
                            "Failed to launch {}: No Windows compatibility runner (Proton or Wine) was found. If using Steam Proton, set GAME_RUNNER environment variable to your proton executable path or install Wine.",
                            exe
                        ));
                    }
                    return Err(format!("Failed to launch {}: {}", exe, e));
                }
            }
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

#[cfg(target_os = "linux")]
fn find_steam_proton_runners() -> Vec<(PathBuf, bool)> {
    let mut runners = Vec::new();
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return runners,
    };

    let search_dirs = vec![
        home.join(".steam/steam/steamapps/common"),
        home.join(".steam/root/steamapps/common"),
        home.join(".local/share/Steam/steamapps/common"),
        home.join(".var/app/com.valvesoftware.Steam/data/Steam/steamapps/common"),
        home.join(".steam/steam/compatibilitytools.d"),
        home.join(".steam/root/compatibilitytools.d"),
        home.join(".local/share/Steam/compatibilitytools.d"),
        home.join(".var/app/com.valvesoftware.Steam/data/Steam/compatibilitytools.d"),
        PathBuf::from("/usr/share/steam/compatibilitytools.d"),
    ];

    for search_dir in search_dirs {
        if !search_dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&search_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                let name_lower = name.to_lowercase();
                if name_lower.contains("proton") || name_lower.contains("ge-proton") {
                    let proton_script = path.join("proton");
                    if proton_script.is_file() {
                        runners.push((proton_script, true));
                    }
                    let wine_candidates = vec![
                        path.join("files").join("bin").join("wine64"),
                        path.join("files").join("bin").join("wine"),
                        path.join("dist").join("bin").join("wine64"),
                        path.join("dist").join("bin").join("wine"),
                    ];
                    for wp in wine_candidates {
                        if wp.is_file() {
                            runners.push((wp, false));
                        }
                    }
                }
            }
        }
    }

    runners
}

#[tauri::command]
pub fn detect_game_version(base_path: String) -> String {
    let base_path_buf = std::path::PathBuf::from(&base_path);
    let data_dir = if base_path_buf.join("Data").is_dir() {
        Some(base_path_buf.join("Data"))
    } else if base_path_buf.join("data").is_dir() {
        Some(base_path_buf.join("data"))
    } else {
        None
    };

    if let Some(data_dir) = data_dir {
        let is_lich_king = |p: &std::path::Path| {
            if let Ok(entries) = std::fs::read_dir(p) {
                entries.flatten().any(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    name.to_lowercase() == "lichking.mpq"
                })
            } else {
                false
            }
        };

        if is_lich_king(&data_dir) {
            return "3.3.5a".to_string();
        }

        if let Ok(entries) = std::fs::read_dir(&data_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() && is_lich_king(&entry.path()) {
                    return "3.3.5a".to_string();
                }
            }
        }
    }
    "1.12.1".to_string()
}

fn get_config_path(base_path: &str) -> Option<PathBuf> {
    let base = PathBuf::from(base_path);
    let wtf_dir = if base.join("WTF").exists() {
        base.join("WTF")
    } else if base.join("wtf").exists() {
        base.join("wtf")
    } else {
        base.join("WTF")
    };

    if wtf_dir.join("config.wtf").exists() {
        Some(wtf_dir.join("config.wtf"))
    } else if wtf_dir.join("Config.wtf").exists() {
        Some(wtf_dir.join("Config.wtf"))
    } else {
        None
    }
}

#[tauri::command]
pub fn read_config(base_path: String) -> std::result::Result<String, String> {
    let config_path = get_config_path(&base_path).ok_or("config.wtf not found".to_string())?;
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

    let config_path = get_config_path(&base_path).ok_or("config.wtf not found".to_string())?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use std::fs::File;

    #[test]
    fn test_launch_game_nonexistent_dir() {
        let res = launch_game("/nonexistent/dir/path".to_string(), false);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_launch_game_no_executable() {
        let dir = tempdir().unwrap();
        let res = launch_game(dir.path().to_string_lossy().to_string(), false);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("No WoW executable found"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_launch_game_linux_wine_missing() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("WoW.exe")).unwrap();
        // Point WINE to a non-existent binary to test missing Wine error message
        std::env::set_var("WINE", "/nonexistent/wine/binary");
        let res = launch_game(dir.path().to_string_lossy().to_string(), false);
        std::env::remove_var("WINE");
        assert!(res.is_err());
        let err = res.unwrap_err();
        assert!(err.contains("No Windows compatibility runner (Proton or Wine) was found"));
    }
}


