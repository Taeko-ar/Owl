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
            active_profile_by_path: None,
            addon_profiles_by_path: None,
            addon_profiles: None,
            active_profile: None,
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

    if let Some(ref path) = settings.path {
        if let Ok(canonical) = fs::canonicalize(path) {
            let canonical_str = canonical.to_string_lossy().to_string();

            if settings.addon_profiles_by_path.is_none() && settings.addon_profiles.is_some() {
                let mut maps = std::collections::HashMap::new();
                maps.insert(canonical_str.clone(), settings.addon_profiles.clone().unwrap());
                settings.addon_profiles_by_path = Some(maps);
            }
            if settings.active_profile_by_path.is_none() && settings.active_profile.is_some() {
                let mut maps = std::collections::HashMap::new();
                maps.insert(canonical_str.clone(), settings.active_profile.clone().unwrap());
                settings.active_profile_by_path = Some(maps);
            }

            settings.addon_profiles = settings
                .addon_profiles_by_path
                .as_ref()
                .and_then(|m| m.get(&canonical_str).cloned());
            settings.active_profile = settings
                .active_profile_by_path
                .as_ref()
                .and_then(|m| m.get(&canonical_str).cloned());
        }
    }

    Ok(settings)
}

#[tauri::command]
pub fn save_settings(settings: LauncherSettings) -> std::result::Result<String, String> {
    let mut current_settings = load_settings().unwrap_or_else(|_| LauncherSettings {
        path: None,
        window_size: None,
        stay_open: Some(true),
        active_profile_by_path: None,
        addon_profiles_by_path: None,
        addon_profiles: None,
        active_profile: None,
    });

    current_settings.path = settings.path;
    if settings.window_size.is_some() {
        current_settings.window_size = settings.window_size;
    }
    if settings.stay_open.is_some() {
        current_settings.stay_open = settings.stay_open;
    }

    let mut profiles_map = current_settings.addon_profiles_by_path.clone().unwrap_or_default();
    let mut active_map = current_settings.active_profile_by_path.clone().unwrap_or_default();



    if let Some(ref path) = current_settings.path {
        if let Ok(canonical) = fs::canonicalize(path) {
            let canonical_str = canonical.to_string_lossy().to_string();

            if let Some(ref profs) = settings.addon_profiles {
                profiles_map.insert(canonical_str.clone(), profs.clone());
            }
            if let Some(ref active) = settings.active_profile {
                active_map.insert(canonical_str.clone(), active.clone());
            } else if settings.active_profile.is_some() {
                active_map.remove(&canonical_str);
            }
        }
    }

    current_settings.addon_profiles_by_path = Some(profiles_map);
    current_settings.active_profile_by_path = Some(active_map);

    // Also populate addon_profiles and active_profile for the current path
    if let Some(ref path) = current_settings.path {
        if let Ok(canonical) = fs::canonicalize(path) {
            let canonical_str = canonical.to_string_lossy().to_string();
            current_settings.addon_profiles = current_settings
                .addon_profiles_by_path
                .as_ref()
                .and_then(|m| m.get(&canonical_str).cloned());
            current_settings.active_profile = current_settings
                .active_profile_by_path
                .as_ref()
                .and_then(|m| m.get(&canonical_str).cloned());
        }
    }

    let settings_file_path = get_settings_file_path()?;
    fs::write(
        &settings_file_path,
        serde_json::to_string_pretty(&current_settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok("OK".into())
}

#[tauri::command]
pub fn get_addon_profiles() -> std::result::Result<Vec<AddonProfile>, String> {
    let settings = load_settings()?;
    Ok(settings.addon_profiles.unwrap_or_default())
}

#[tauri::command]
pub fn save_addon_profile(
    base_path: String,
    name: String,
    enabled_addons: Vec<String>,
) -> std::result::Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 32 {
        return Err("Profile name must be between 1 and 32 characters".into());
    }
    if base_path.contains("..") {
        return Err("Invalid path".into());
    }

    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;

    // Parse current tweaks
    let mut tweak_configs = std::collections::HashMap::new();
    let config_path = canonical_base.join("WTF").join("config.wtf");
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            let track_keys = [
                "gxResolution",
                "gxWindow",
                "gxMaximize",
                "gxRefresh",
                "maxFPS",
                "maxFPSbk",
                "gxTripleBuffer",
                "gxFixLag",
                "farClip",
                "environmentDetail",
                "projectedTextures",
                "gxMultisample",
                "shadowLevel",
            ];
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.to_uppercase().starts_with("SET ") {
                    if let Some(first_quote) = trimmed.find('"') {
                        if let Some(second_quote_rel) = trimmed[first_quote + 1..].find('"') {
                            let second_quote = first_quote + 1 + second_quote_rel;
                            let key = &trimmed[first_quote + 1..second_quote];
                            if track_keys.contains(&key) {
                                let val_part = trimmed[second_quote + 1..].trim();
                                if val_part.starts_with('"')
                                    && val_part.ends_with('"')
                                    && val_part.len() >= 2
                                {
                                    let val = &val_part[1..val_part.len() - 1];
                                    tweak_configs.insert(key.to_string(), val.to_string());
                                } else {
                                    let val = val_part.replace('"', "");
                                    tweak_configs.insert(key.to_string(), val);
                                }
                            }
                        }
                    } else {
                        let parts: Vec<&str> = trimmed.split_whitespace().collect();
                        if parts.len() >= 3 && parts[0].eq_ignore_ascii_case("SET") {
                            let key = parts[1];
                            if track_keys.contains(&key) {
                                let val = parts[2..].join(" ").replace('"', "");
                                tweak_configs.insert(key.to_string(), val);
                            }
                        }
                    }
                }
            }
        }
    }

    // Parse current enabled patches/mods
    let mut enabled_patches = Vec::new();
    let data_dir = canonical_base.join("Data");
    if data_dir.exists() {
        if let Ok(entries) = fs::read_dir(&data_dir) {
            for entry in entries.filter_map(Result::ok) {
                let file_name = entry.file_name().to_string_lossy().to_string();
                let lower_name = file_name.to_lowercase();
                if !lower_name.ends_with(".mpq") {
                    continue;
                }
                let stem = lower_name.strip_suffix(".mpq").unwrap_or(&lower_name);
                let is_disabled = stem.ends_with("-disabled");
                let base_stem = stem.strip_suffix("-disabled").unwrap_or(stem);

                if !base_stem.starts_with("patch-") || base_stem.len() != 7 {
                    continue;
                }
                if let Some(c) = base_stem.chars().nth(6) {
                    if c.is_ascii_alphabetic() && !is_disabled {
                        enabled_patches.push(file_name);
                    }
                }
            }
        }
    }

    let mut settings = load_settings()?;
    let mut profiles = settings.addon_profiles.unwrap_or_default();

    let mut found = false;
    for p in &mut profiles {
        if p.name == name {
            p.enabled_addons = enabled_addons.clone();
            p.tweak_configs = Some(tweak_configs.clone());
            p.enabled_patches = Some(enabled_patches.clone());
            found = true;
            break;
        }
    }
    if !found {
        if profiles.iter().any(|p| p.name == name) {
            return Err("A profile with that name already exists".into());
        }
        profiles.push(AddonProfile {
            name: name.to_string(),
            enabled_addons,
            tweak_configs: Some(tweak_configs),
            enabled_patches: Some(enabled_patches),
        });
    }

    settings.addon_profiles = Some(profiles);
    settings.active_profile = Some(name.to_string());
    save_settings(settings)?;
    Ok("OK".into())
}

#[tauri::command]
pub fn apply_addon_profile(
    base_path: String,
    name: String,
) -> std::result::Result<String, String> {
    if base_path.contains("..") {
        return Err("Invalid path".into());
    }
    let addons_dir = std::path::PathBuf::from(&base_path).join("Interface").join("AddOns");
    if !addons_dir.exists() {
        return Err("AddOns directory not found".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let canonical_addons = fs::canonicalize(&addons_dir).map_err(|e| e.to_string())?;
    if !canonical_addons.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }

    let mut settings = load_settings()?;

    if name == "All Addons" {
        let entries = fs::read_dir(&addons_dir).map_err(|e| e.to_string())?;
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let folder_name = entry.file_name().to_string_lossy().to_string();
            if folder_name.starts_with("Blizzard_") {
                continue;
            }
            if folder_name.ends_with("-disabled") {
                let base_name = folder_name.trim_end_matches("-disabled");
                let enabled_path = addons_dir.join(base_name);
                if !enabled_path.exists() {
                    let _ = fs::rename(&path, &enabled_path);
                }
            }
        }
        settings.active_profile = None;
        save_settings(settings)?;
        return Ok("OK".into());
    }

    let profiles = settings.addon_profiles.clone().unwrap_or_default();
    let profile = profiles
        .iter()
        .find(|p| p.name == name)
        .ok_or_else(|| format!("Profile '{}' not found", name))?;

    // Apply enabled addons
    let entries = fs::read_dir(&addons_dir).map_err(|e| e.to_string())?;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder_name = entry.file_name().to_string_lossy().to_string();
        if folder_name.starts_with("Blizzard_") {
            continue;
        }

        let base_name = if folder_name.ends_with("-disabled") {
            folder_name.trim_end_matches("-disabled").to_string()
        } else {
            folder_name.clone()
        };

        let should_enable = profile.enabled_addons.contains(&base_name);
        let enabled_path = addons_dir.join(&base_name);
        let disabled_path = addons_dir.join(format!("{}-disabled", base_name));

        if should_enable {
            if disabled_path.exists() && !enabled_path.exists() {
                let _ = fs::rename(&disabled_path, &enabled_path);
            }
        } else {
            if enabled_path.exists() && !disabled_path.exists() {
                let _ = fs::rename(&enabled_path, &disabled_path);
            }
        }
    }

    // Apply tweak configs
    if let Some(ref tweaks) = profile.tweak_configs {
        for (key, val) in tweaks {
            let _ = crate::commands::game::set_config_value(
                base_path.clone(),
                key.clone(),
                val.clone(),
            );
        }
    }

    // Apply enabled patches
    if let Some(ref patches) = profile.enabled_patches {
        let data_dir = canonical_base.join("Data");
        if data_dir.exists() {
            if let Ok(entries) = fs::read_dir(&data_dir) {
                let mut list = Vec::new();
                for entry in entries.filter_map(Result::ok) {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    let lower_name = file_name.to_lowercase();
                    if !lower_name.ends_with(".mpq") {
                        continue;
                    }
                    let stem = lower_name.strip_suffix(".mpq").unwrap_or(&lower_name);
                    let base_stem = stem.strip_suffix("-disabled").unwrap_or(stem);

                    if !base_stem.starts_with("patch-") || base_stem.len() != 7 {
                        continue;
                    }
                    if let Some(c) = base_stem.chars().nth(6) {
                        if c.is_ascii_alphabetic() {
                            list.push(file_name);
                        }
                    }
                }

                for item in list {
                    let lower_item = item.to_lowercase();
                    let base_name = if lower_item.ends_with("-disabled.mpq") {
                        let stem = lower_item.strip_suffix("-disabled.mpq").unwrap_or("");
                        format!("{}.mpq", stem)
                    } else {
                        lower_item.clone()
                    };

                    let should_enable = patches.iter().any(|p| {
                        let p_lower = p.to_lowercase();
                        let p_base = if p_lower.ends_with("-disabled.mpq") {
                            p_lower.strip_suffix("-disabled.mpq").unwrap_or("").to_string() + ".mpq"
                        } else {
                            p_lower
                        };
                        p_base == base_name
                    });

                    let _ = crate::commands::patches::toggle_patch(
                        base_path.clone(),
                        item,
                        should_enable,
                    );
                }
            }
        }
    }

    settings.active_profile = Some(name);
    save_settings(settings)?;
    Ok("OK".into())
}

#[tauri::command]
pub fn delete_addon_profile(name: String) -> std::result::Result<String, String> {
    let mut settings = load_settings()?;
    if let Some(ref mut profiles) = settings.addon_profiles {
        profiles.retain(|p| p.name != name);
    }
    if settings.active_profile == Some(name) {
        settings.active_profile = None;
    }
    save_settings(settings)?;
    Ok("OK".into())
}

#[tauri::command]
pub fn rename_addon_profile(old_name: String, new_name: String) -> std::result::Result<String, String> {
    let new_name = new_name.trim();
    if new_name.is_empty() || new_name.chars().count() > 32 {
        return Err("Profile name must be between 1 and 32 characters".into());
    }
    let mut settings = load_settings()?;
    let mut profiles = settings.addon_profiles.clone().unwrap_or_default();

    if old_name != new_name && profiles.iter().any(|p| p.name == new_name) {
        return Err("A profile with that name already exists".into());
    }

    let mut found = false;
    for p in &mut profiles {
        if p.name == old_name {
            p.name = new_name.to_string();
            found = true;
            break;
        }
    }
    if !found {
        return Err("Profile not found".into());
    }

    settings.addon_profiles = Some(profiles);
    if settings.active_profile == Some(old_name) {
        settings.active_profile = Some(new_name.to_string());
    }
    save_settings(settings)?;
    Ok("OK".into())
}

