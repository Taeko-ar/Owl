use crate::fs_utils::*;
use crate::models::*;
use std::fs;

#[cfg(target_os = "windows")]
fn default_wow_path() -> Option<String> {
    Some("C:\\".to_string())
}

#[cfg(not(target_os = "windows"))]
fn default_wow_path() -> Option<String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .or(Some("/".to_string()))
}

#[tauri::command]
pub fn load_settings() -> std::result::Result<LauncherSettings, String> {
    let settings_file_path = get_settings_file_path()?;
    if !settings_file_path.exists() {
        return Ok(LauncherSettings {
            path: default_wow_path(),
            window_size: None,
            stay_open: Some(true),
            active_profile_by_path: None,
            addon_profiles_by_path: None,
            addon_profiles: None,
            active_profile: None,
            selected_executable: None,
        });
    }

    let content = fs::read_to_string(&settings_file_path).map_err(|e| e.to_string())?;
    let mut settings: LauncherSettings =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;
    if settings.path.is_none() {
        settings.path = default_wow_path();
    }
    if settings.stay_open.is_none() {
        settings.stay_open = Some(true);
    }

    if let Some(ref path) = settings.path {
        if let Ok(canonical) = fs::canonicalize(path) {
            let canonical_str = canonical.to_string_lossy().to_string();

            if settings.addon_profiles_by_path.is_none() && settings.addon_profiles.is_some() {
                let mut maps = std::collections::HashMap::new();
                maps.insert(
                    canonical_str.clone(),
                    settings.addon_profiles.clone().unwrap(),
                );
                settings.addon_profiles_by_path = Some(maps);
            }
            if settings.active_profile_by_path.is_none() && settings.active_profile.is_some() {
                let mut maps = std::collections::HashMap::new();
                maps.insert(
                    canonical_str.clone(),
                    settings.active_profile.clone().unwrap(),
                );
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
    let mut current_settings = load_settings().unwrap_or(LauncherSettings {
        path: None,
        window_size: None,
        stay_open: Some(true),
        active_profile_by_path: None,
        addon_profiles_by_path: None,
        addon_profiles: None,
        active_profile: None,
        selected_executable: None,
    });

    current_settings.path = settings.path;
    if settings.window_size.is_some() {
        current_settings.window_size = settings.window_size;
    }
    if settings.stay_open.is_some() {
        current_settings.stay_open = settings.stay_open;
    }
    if settings.selected_executable.is_some() {
        current_settings.selected_executable = settings.selected_executable;
    }

    let mut profiles_map = settings.addon_profiles_by_path.clone().unwrap_or_else(|| {
        current_settings
            .addon_profiles_by_path
            .clone()
            .unwrap_or_default()
    });
    let mut active_map = settings.active_profile_by_path.clone().unwrap_or_else(|| {
        current_settings
            .active_profile_by_path
            .clone()
            .unwrap_or_default()
    });

    if let Some(ref path) = current_settings.path {
        if let Ok(canonical) = fs::canonicalize(path) {
            let canonical_str = canonical.to_string_lossy().to_string();

            if let Some(ref profs) = settings.addon_profiles {
                profiles_map.insert(canonical_str.clone(), profs.clone());
            }
            if let Some(ref active) = settings.active_profile {
                active_map.insert(canonical_str.clone(), active.clone());
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

    if let Some(existing) = profiles.iter_mut().find(|p| p.name == name) {
        existing.enabled_addons = enabled_addons;
        existing.tweak_configs = Some(tweak_configs);
        existing.enabled_patches = Some(enabled_patches);
    } else {
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
pub fn apply_addon_profile(base_path: String, name: String) -> std::result::Result<String, String> {
    if base_path.contains("..") {
        return Err("Invalid path".into());
    }
    let addons_dir = std::path::PathBuf::from(&base_path)
        .join("Interface")
        .join("AddOns");
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
        } else if enabled_path.exists() && !disabled_path.exists() {
            let _ = fs::rename(&enabled_path, &disabled_path);
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
                            p_lower
                                .strip_suffix("-disabled.mpq")
                                .unwrap_or("")
                                .to_string()
                                + ".mpq"
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
    if let Some(ref mut map) = settings.addon_profiles_by_path {
        for profiles in map.values_mut() {
            profiles.retain(|p| p.name != name);
        }
    }
    if settings.active_profile.as_deref() == Some(name.as_str()) {
        settings.active_profile = None;
    }
    if let Some(ref mut map) = settings.active_profile_by_path {
        map.retain(|_, v| v != &name);
    }
    save_settings(settings)?;
    Ok("OK".into())
}

#[tauri::command]
pub fn rename_addon_profile(
    old_name: String,
    new_name: String,
) -> std::result::Result<String, String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    /// Redirects `dirs::config_dir()` (which `get_settings_file_path` in
    /// `fs_utils.rs` builds on) to a fresh tempdir for the duration of `f`, so each
    /// test gets its own isolated `settings.json` instead of touching the real one.
    /// `XDG_CONFIG_HOME` is process-wide state, so this is serialized on
    /// `crate::ENV_LOCK` (same pattern as `commands::game`'s env-mutating tests).
    fn with_isolated_settings<F: FnOnce(&std::path::Path)>(f: F) {
        let _guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let orig = std::env::var("XDG_CONFIG_HOME").ok();
        std::env::set_var("XDG_CONFIG_HOME", dir.path());

        f(dir.path());

        match orig {
            Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
    }

    fn settings_json_path(config_home: &std::path::Path) -> std::path::PathBuf {
        config_home.join("owl").join("settings.json")
    }

    fn write_file(path: &std::path::Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    // ---- load_settings ----

    #[test]
    fn test_load_settings_no_file_returns_defaults() {
        with_isolated_settings(|_| {
            let settings = load_settings().unwrap();
            assert_eq!(settings.stay_open, Some(true));
            assert!(settings.path.is_some());
            assert!(settings.addon_profiles.is_none());
        });
    }

    #[test]
    fn test_load_settings_malformed_json() {
        with_isolated_settings(|config_home| {
            write_file(&settings_json_path(config_home), "{ not valid json");
            let res = load_settings();
            assert!(res.is_err());
        });
    }

    #[test]
    fn test_load_settings_fills_missing_path_and_stay_open() {
        with_isolated_settings(|config_home| {
            write_file(&settings_json_path(config_home), "{}");
            let settings = load_settings().unwrap();
            assert!(settings.path.is_some());
            assert_eq!(settings.stay_open, Some(true));
        });
    }

    #[test]
    fn test_load_settings_preserves_explicit_values() {
        with_isolated_settings(|config_home| {
            write_file(
                &settings_json_path(config_home),
                r#"{"path":null,"windowSize":"800x600","stayOpen":false}"#,
            );
            let settings = load_settings().unwrap();
            assert_eq!(settings.window_size, Some("800x600".to_string()));
            assert_eq!(settings.stay_open, Some(false));
        });
    }

    #[test]
    fn test_load_settings_path_not_canonicalizable_skips_profile_sync() {
        with_isolated_settings(|config_home| {
            write_file(
                &settings_json_path(config_home),
                r#"{"path":"/nonexistent/owl-test-wow-dir","addonProfiles":[{"name":"p","enabledAddons":[]}]}"#,
            );
            let settings = load_settings().unwrap();
            // canonicalize failed, so addon_profiles is left as parsed (not synced via map)
            assert_eq!(settings.addon_profiles.unwrap().len(), 1);
        });
    }

    #[test]
    fn test_load_settings_migrates_legacy_profiles_by_path() {
        with_isolated_settings(|config_home| {
            let wow_dir = tempdir().unwrap();
            let json = format!(
                r#"{{"path":"{}","addonProfiles":[{{"name":"p1","enabledAddons":[]}}],"activeProfile":"p1"}}"#,
                wow_dir.path().to_string_lossy().replace('\\', "\\\\")
            );
            write_file(&settings_json_path(config_home), &json);
            let settings = load_settings().unwrap();
            let canonical = fs::canonicalize(wow_dir.path())
                .unwrap()
                .to_string_lossy()
                .to_string();
            assert!(settings
                .addon_profiles_by_path
                .as_ref()
                .unwrap()
                .contains_key(&canonical));
            assert!(settings
                .active_profile_by_path
                .as_ref()
                .unwrap()
                .contains_key(&canonical));
            assert_eq!(settings.active_profile, Some("p1".to_string()));
        });
    }

    #[test]
    fn test_load_settings_uses_existing_profiles_by_path() {
        with_isolated_settings(|config_home| {
            let wow_dir = tempdir().unwrap();
            let canonical = fs::canonicalize(wow_dir.path())
                .unwrap()
                .to_string_lossy()
                .to_string();
            let json = format!(
                r#"{{"path":"{}","addonProfilesByPath":{{"{}":[{{"name":"existing","enabledAddons":[]}}]}}}}"#,
                wow_dir.path().to_string_lossy().replace('\\', "\\\\"),
                canonical.replace('\\', "\\\\")
            );
            write_file(&settings_json_path(config_home), &json);
            let settings = load_settings().unwrap();
            let profiles = settings.addon_profiles.unwrap();
            assert_eq!(profiles.len(), 1);
            assert_eq!(profiles[0].name, "existing");
        });
    }

    // ---- save_settings ----

    #[test]
    fn test_save_settings_creates_file_and_roundtrips() {
        with_isolated_settings(|config_home| {
            let wow_dir = tempdir().unwrap();
            let settings = LauncherSettings {
                path: Some(wow_dir.path().to_string_lossy().to_string()),
                window_size: Some("1024x768".to_string()),
                stay_open: Some(false),
                active_profile_by_path: None,
                addon_profiles_by_path: None,
                addon_profiles: Some(vec![AddonProfile {
                    name: "p1".to_string(),
                    enabled_addons: vec!["Foo".to_string()],
                    tweak_configs: None,
                    enabled_patches: None,
                }]),
                active_profile: Some("p1".to_string()),
                selected_executable: Some("WoW.exe".to_string()),
            };
            let res = save_settings(settings);
            assert_eq!(res.unwrap(), "OK");
            assert!(settings_json_path(config_home).exists());

            let reloaded = load_settings().unwrap();
            assert_eq!(reloaded.window_size, Some("1024x768".to_string()));
            assert_eq!(reloaded.stay_open, Some(false));
            assert_eq!(reloaded.selected_executable, Some("WoW.exe".to_string()));
            assert_eq!(reloaded.active_profile, Some("p1".to_string()));
        });
    }

    #[test]
    fn test_save_settings_falls_back_when_load_fails() {
        with_isolated_settings(|config_home| {
            write_file(&settings_json_path(config_home), "{ not valid json");
            let settings = LauncherSettings {
                path: None,
                window_size: None,
                stay_open: None,
                active_profile_by_path: None,
                addon_profiles_by_path: None,
                addon_profiles: None,
                active_profile: None,
                selected_executable: None,
            };
            let res = save_settings(settings);
            assert_eq!(res.unwrap(), "OK");
        });
    }

    #[test]
    fn test_save_settings_no_path_skips_profile_maps() {
        with_isolated_settings(|_| {
            let settings = LauncherSettings {
                path: None,
                window_size: None,
                stay_open: None,
                active_profile_by_path: None,
                addon_profiles_by_path: None,
                addon_profiles: None,
                active_profile: None,
                selected_executable: None,
            };
            let res = save_settings(settings);
            assert_eq!(res.unwrap(), "OK");
            let reloaded = load_settings().unwrap();
            assert_eq!(reloaded.addon_profiles_by_path, Some(Default::default()));
        });
    }

    #[test]
    fn test_save_settings_write_permission_denied() {
        with_isolated_settings(|config_home| {
            let owl_dir = config_home.join("owl");
            fs::create_dir_all(&owl_dir).unwrap();
            fs::set_permissions(&owl_dir, fs::Permissions::from_mode(0o555)).unwrap();

            let settings = LauncherSettings {
                path: None,
                window_size: None,
                stay_open: None,
                active_profile_by_path: None,
                addon_profiles_by_path: None,
                addon_profiles: None,
                active_profile: None,
                selected_executable: None,
            };
            let res = save_settings(settings);

            fs::set_permissions(&owl_dir, fs::Permissions::from_mode(0o755)).unwrap();
            assert!(res.is_err());
        });
    }

    // ---- get_addon_profiles ----

    #[test]
    fn test_get_addon_profiles_empty() {
        with_isolated_settings(|_| {
            let profiles = get_addon_profiles().unwrap();
            assert!(profiles.is_empty());
        });
    }

    #[test]
    fn test_get_addon_profiles_returns_saved() {
        with_isolated_settings(|_| {
            let wow_dir = tempdir().unwrap();
            let settings = LauncherSettings {
                path: Some(wow_dir.path().to_string_lossy().to_string()),
                window_size: None,
                stay_open: None,
                active_profile_by_path: None,
                addon_profiles_by_path: None,
                addon_profiles: Some(vec![AddonProfile {
                    name: "p1".to_string(),
                    enabled_addons: vec![],
                    tweak_configs: None,
                    enabled_patches: None,
                }]),
                active_profile: None,
                selected_executable: None,
            };
            save_settings(settings).unwrap();
            let profiles = get_addon_profiles().unwrap();
            assert_eq!(profiles.len(), 1);
        });
    }

    // ---- save_addon_profile ----

    #[test]
    fn test_save_addon_profile_empty_name() {
        with_isolated_settings(|_| {
            let res = save_addon_profile("/tmp".to_string(), "  ".to_string(), vec![]);
            assert_eq!(
                res.unwrap_err(),
                "Profile name must be between 1 and 32 characters"
            );
        });
    }

    #[test]
    fn test_save_addon_profile_name_too_long() {
        with_isolated_settings(|_| {
            let long_name = "a".repeat(33);
            let res = save_addon_profile("/tmp".to_string(), long_name, vec![]);
            assert_eq!(
                res.unwrap_err(),
                "Profile name must be between 1 and 32 characters"
            );
        });
    }

    #[test]
    fn test_save_addon_profile_invalid_path() {
        with_isolated_settings(|_| {
            let res = save_addon_profile("/tmp/../evil".to_string(), "p1".to_string(), vec![]);
            assert_eq!(res.unwrap_err(), "Invalid path");
        });
    }

    #[test]
    fn test_save_addon_profile_base_path_not_canonicalizable() {
        with_isolated_settings(|_| {
            let res = save_addon_profile(
                "/nonexistent/owl-test-base".to_string(),
                "p1".to_string(),
                vec![],
            );
            assert!(res.is_err());
        });
    }

    #[test]
    fn test_save_addon_profile_new_profile_parses_config_and_patches() {
        with_isolated_settings(|_| {
            let base = tempdir().unwrap();
            let wtf_dir = base.path().join("WTF");
            fs::create_dir_all(&wtf_dir).unwrap();
            write_file(
                &wtf_dir.join("config.wtf"),
                concat!(
                    "SET \"gxWindow\" \"1\"\n",
                    "SET gxMaximize 0\n",
                    "set \"maxFPS\" \"60\"\n",
                    "SET \"untrackedKey\" \"value\"\n",
                    "SET untrackedUnquoted foo\n",
                    "SET \"unterminated\n",
                    "SET onlykey\n",
                    "not a set line\n",
                ),
            );

            let data_dir = base.path().join("Data");
            fs::create_dir_all(&data_dir).unwrap();
            write_file(&data_dir.join("patch-a.mpq"), "");
            write_file(&data_dir.join("patch-b-disabled.mpq"), "");
            write_file(&data_dir.join("not-a-patch.txt"), "");

            let res = save_addon_profile(
                base.path().to_string_lossy().to_string(),
                "  My Profile  ".to_string(),
                vec!["Foo".to_string()],
            );
            assert_eq!(res.unwrap(), "OK");

            let profiles = get_addon_profiles().unwrap();
            assert_eq!(profiles.len(), 1);
            let p = &profiles[0];
            assert_eq!(p.name, "My Profile");
            assert_eq!(p.enabled_addons, vec!["Foo".to_string()]);
            let tweaks = p.tweak_configs.as_ref().unwrap();
            assert_eq!(tweaks.get("gxWindow"), Some(&"1".to_string()));
            assert_eq!(tweaks.get("gxMaximize"), Some(&"0".to_string()));
            assert_eq!(tweaks.get("maxFPS"), Some(&"60".to_string()));
            assert!(!tweaks.contains_key("untrackedKey"));
            let patches = p.enabled_patches.as_ref().unwrap();
            assert_eq!(patches, &vec!["patch-a.mpq".to_string()]);
        });
    }

    #[test]
    fn test_save_addon_profile_updates_existing_profile() {
        with_isolated_settings(|_| {
            let base = tempdir().unwrap();
            fs::create_dir_all(base.path().join("Data")).unwrap();

            save_addon_profile(
                base.path().to_string_lossy().to_string(),
                "p1".to_string(),
                vec!["A".to_string()],
            )
            .unwrap();
            save_addon_profile(
                base.path().to_string_lossy().to_string(),
                "p1".to_string(),
                vec!["B".to_string()],
            )
            .unwrap();

            let profiles = get_addon_profiles().unwrap();
            assert_eq!(profiles.len(), 1);
            assert_eq!(profiles[0].enabled_addons, vec!["B".to_string()]);
        });
    }

    #[test]
    fn test_save_addon_profile_no_config_or_data_dir() {
        with_isolated_settings(|_| {
            let base = tempdir().unwrap();
            let res = save_addon_profile(
                base.path().to_string_lossy().to_string(),
                "p1".to_string(),
                vec![],
            );
            assert_eq!(res.unwrap(), "OK");
        });
    }

    // ---- apply_addon_profile ----

    #[test]
    fn test_apply_addon_profile_invalid_path() {
        with_isolated_settings(|_| {
            let res = apply_addon_profile("/tmp/../evil".to_string(), "p1".to_string());
            assert_eq!(res.unwrap_err(), "Invalid path");
        });
    }

    #[test]
    fn test_apply_addon_profile_no_addons_dir() {
        with_isolated_settings(|_| {
            let base = tempdir().unwrap();
            let res =
                apply_addon_profile(base.path().to_string_lossy().to_string(), "p1".to_string());
            assert_eq!(res.unwrap_err(), "AddOns directory not found");
        });
    }

    #[test]
    fn test_apply_addon_profile_traversal_blocked() {
        with_isolated_settings(|_| {
            let base = tempdir().unwrap();
            let interface_dir = base.path().join("Interface");
            fs::create_dir_all(&interface_dir).unwrap();
            let outside = tempdir().unwrap();
            std::os::unix::fs::symlink(outside.path(), interface_dir.join("AddOns")).unwrap();

            let res =
                apply_addon_profile(base.path().to_string_lossy().to_string(), "p1".to_string());
            assert_eq!(res.unwrap_err(), "Directory traversal attempt blocked");
        });
    }

    #[test]
    fn test_apply_addon_profile_all_addons() {
        with_isolated_settings(|_| {
            let base = tempdir().unwrap();
            let addons_dir = base.path().join("Interface").join("AddOns");
            fs::create_dir_all(&addons_dir).unwrap();
            fs::create_dir_all(addons_dir.join("Blizzard_Something")).unwrap();
            fs::create_dir_all(addons_dir.join("MyAddon-disabled")).unwrap();
            fs::create_dir_all(addons_dir.join("AlreadyEnabled")).unwrap();
            fs::create_dir_all(addons_dir.join("AlreadyEnabled-disabled")).unwrap();
            write_file(&addons_dir.join("not-a-dir.txt"), "");

            let res = apply_addon_profile(
                base.path().to_string_lossy().to_string(),
                "All Addons".to_string(),
            );
            assert_eq!(res.unwrap(), "OK");
            assert!(addons_dir.join("MyAddon").exists());
            // AlreadyEnabled already had a non-disabled counterpart, so the
            // disabled duplicate is left alone.
            assert!(addons_dir.join("AlreadyEnabled-disabled").exists());

            let settings = load_settings().unwrap();
            assert!(settings.active_profile.is_none());
        });
    }

    #[test]
    fn test_apply_addon_profile_not_found() {
        with_isolated_settings(|_| {
            let base = tempdir().unwrap();
            let addons_dir = base.path().join("Interface").join("AddOns");
            fs::create_dir_all(&addons_dir).unwrap();

            let res = apply_addon_profile(
                base.path().to_string_lossy().to_string(),
                "missing".to_string(),
            );
            assert_eq!(res.unwrap_err(), "Profile 'missing' not found");
        });
    }

    #[test]
    fn test_apply_addon_profile_full_flow() {
        with_isolated_settings(|_| {
            let base = tempdir().unwrap();
            let addons_dir = base.path().join("Interface").join("AddOns");
            fs::create_dir_all(&addons_dir).unwrap();
            fs::create_dir_all(addons_dir.join("Blizzard_Skip")).unwrap();
            // Should be enabled: currently disabled, target for enabling.
            fs::create_dir_all(addons_dir.join("Foo-disabled")).unwrap();
            // Should be disabled: currently enabled, not in profile.
            fs::create_dir_all(addons_dir.join("Bar")).unwrap();
            // Already in the desired state - both branches' guard should no-op.
            fs::create_dir_all(addons_dir.join("Baz")).unwrap();
            fs::create_dir_all(addons_dir.join("Baz-disabled")).unwrap();

            let data_dir = base.path().join("Data");
            fs::create_dir_all(&data_dir).unwrap();
            write_file(&data_dir.join("patch-a.mpq"), "");
            write_file(&data_dir.join("patch-b-disabled.mpq"), "");
            write_file(&data_dir.join("patch-c.mpq"), "");

            let wtf_dir = base.path().join("WTF");
            fs::create_dir_all(&wtf_dir).unwrap();
            write_file(&wtf_dir.join("config.wtf"), "SET gxWindow \"1\"\n");

            // Build the profile: enable Foo and Baz, keep patch-a disabled and
            // patch-b enabled (opposite of current on-disk state), leave patch-c
            // enabled (matches current on-disk state, exercising the no-rename path).
            let mut tweak_configs = std::collections::HashMap::new();
            tweak_configs.insert("gxWindow".to_string(), "0".to_string());
            let profile = AddonProfile {
                name: "p1".to_string(),
                enabled_addons: vec!["Foo".to_string(), "Baz".to_string()],
                tweak_configs: Some(tweak_configs),
                enabled_patches: Some(vec![
                    "patch-b-disabled.mpq".to_string(),
                    "patch-c.mpq".to_string(),
                ]),
            };
            let settings = LauncherSettings {
                path: Some(base.path().to_string_lossy().to_string()),
                window_size: None,
                stay_open: None,
                active_profile_by_path: None,
                addon_profiles_by_path: None,
                addon_profiles: Some(vec![profile]),
                active_profile: None,
                selected_executable: None,
            };
            save_settings(settings).unwrap();

            let res =
                apply_addon_profile(base.path().to_string_lossy().to_string(), "p1".to_string());
            assert_eq!(res.unwrap(), "OK");

            assert!(addons_dir.join("Foo").exists());
            assert!(addons_dir.join("Bar-disabled").exists());
            assert!(addons_dir.join("Baz").exists());
            assert!(data_dir.join("patch-a-disabled.mpq").exists());
            assert!(data_dir.join("patch-b.mpq").exists());
            assert!(data_dir.join("patch-c.mpq").exists());

            let settings = load_settings().unwrap();
            assert_eq!(settings.active_profile, Some("p1".to_string()));
        });
    }

    #[test]
    fn test_apply_addon_profile_no_tweaks_no_patches() {
        with_isolated_settings(|_| {
            let base = tempdir().unwrap();
            let addons_dir = base.path().join("Interface").join("AddOns");
            fs::create_dir_all(&addons_dir).unwrap();

            let profile = AddonProfile {
                name: "p1".to_string(),
                enabled_addons: vec![],
                tweak_configs: None,
                enabled_patches: None,
            };
            let settings = LauncherSettings {
                path: Some(base.path().to_string_lossy().to_string()),
                window_size: None,
                stay_open: None,
                active_profile_by_path: None,
                addon_profiles_by_path: None,
                addon_profiles: Some(vec![profile]),
                active_profile: None,
                selected_executable: None,
            };
            save_settings(settings).unwrap();

            let res =
                apply_addon_profile(base.path().to_string_lossy().to_string(), "p1".to_string());
            assert_eq!(res.unwrap(), "OK");
        });
    }

    // ---- delete_addon_profile ----

    #[test]
    fn test_delete_addon_profile_removes_from_all_maps() {
        with_isolated_settings(|_| {
            let wow_dir = tempdir().unwrap();
            let profile = AddonProfile {
                name: "p1".to_string(),
                enabled_addons: vec![],
                tweak_configs: None,
                enabled_patches: None,
            };
            let settings = LauncherSettings {
                path: Some(wow_dir.path().to_string_lossy().to_string()),
                window_size: None,
                stay_open: None,
                active_profile_by_path: None,
                addon_profiles_by_path: None,
                addon_profiles: Some(vec![profile]),
                active_profile: Some("p1".to_string()),
                selected_executable: None,
            };
            save_settings(settings).unwrap();

            let res = delete_addon_profile("p1".to_string());
            assert_eq!(res.unwrap(), "OK");

            let reloaded = load_settings().unwrap();
            assert!(reloaded.addon_profiles.unwrap().is_empty());
            assert!(reloaded.active_profile.is_none());
        });
    }

    #[test]
    fn test_delete_addon_profile_nonexistent_is_noop() {
        with_isolated_settings(|_| {
            let res = delete_addon_profile("does-not-exist".to_string());
            assert_eq!(res.unwrap(), "OK");
        });
    }

    #[test]
    fn test_delete_addon_profile_leaves_other_active_profile() {
        with_isolated_settings(|_| {
            let wow_dir = tempdir().unwrap();
            let profile = AddonProfile {
                name: "p1".to_string(),
                enabled_addons: vec![],
                tweak_configs: None,
                enabled_patches: None,
            };
            let settings = LauncherSettings {
                path: Some(wow_dir.path().to_string_lossy().to_string()),
                window_size: None,
                stay_open: None,
                active_profile_by_path: None,
                addon_profiles_by_path: None,
                addon_profiles: Some(vec![profile]),
                active_profile: Some("other".to_string()),
                selected_executable: None,
            };
            save_settings(settings).unwrap();

            let res = delete_addon_profile("p1".to_string());
            assert_eq!(res.unwrap(), "OK");
            let reloaded = load_settings().unwrap();
            assert_eq!(reloaded.active_profile, Some("other".to_string()));
        });
    }

    // ---- rename_addon_profile ----

    #[test]
    fn test_rename_addon_profile_empty_new_name() {
        with_isolated_settings(|_| {
            let res = rename_addon_profile("p1".to_string(), "  ".to_string());
            assert_eq!(
                res.unwrap_err(),
                "Profile name must be between 1 and 32 characters"
            );
        });
    }

    #[test]
    fn test_rename_addon_profile_new_name_too_long() {
        with_isolated_settings(|_| {
            let res = rename_addon_profile("p1".to_string(), "a".repeat(33));
            assert_eq!(
                res.unwrap_err(),
                "Profile name must be between 1 and 32 characters"
            );
        });
    }

    #[test]
    fn test_rename_addon_profile_not_found() {
        with_isolated_settings(|_| {
            let res = rename_addon_profile("missing".to_string(), "new".to_string());
            assert_eq!(res.unwrap_err(), "Profile not found");
        });
    }

    #[test]
    fn test_rename_addon_profile_name_collision() {
        with_isolated_settings(|_| {
            let wow_dir = tempdir().unwrap();
            let settings = LauncherSettings {
                path: Some(wow_dir.path().to_string_lossy().to_string()),
                window_size: None,
                stay_open: None,
                active_profile_by_path: None,
                addon_profiles_by_path: None,
                addon_profiles: Some(vec![
                    AddonProfile {
                        name: "p1".to_string(),
                        enabled_addons: vec![],
                        tweak_configs: None,
                        enabled_patches: None,
                    },
                    AddonProfile {
                        name: "p2".to_string(),
                        enabled_addons: vec![],
                        tweak_configs: None,
                        enabled_patches: None,
                    },
                ]),
                active_profile: None,
                selected_executable: None,
            };
            save_settings(settings).unwrap();

            let res = rename_addon_profile("p1".to_string(), "p2".to_string());
            assert_eq!(res.unwrap_err(), "A profile with that name already exists");
        });
    }

    #[test]
    fn test_rename_addon_profile_same_name_is_allowed() {
        with_isolated_settings(|_| {
            let wow_dir = tempdir().unwrap();
            let settings = LauncherSettings {
                path: Some(wow_dir.path().to_string_lossy().to_string()),
                window_size: None,
                stay_open: None,
                active_profile_by_path: None,
                addon_profiles_by_path: None,
                addon_profiles: Some(vec![AddonProfile {
                    name: "p1".to_string(),
                    enabled_addons: vec![],
                    tweak_configs: None,
                    enabled_patches: None,
                }]),
                active_profile: Some("p1".to_string()),
                selected_executable: None,
            };
            save_settings(settings).unwrap();

            let res = rename_addon_profile("p1".to_string(), "p1".to_string());
            assert_eq!(res.unwrap(), "OK");
        });
    }

    #[test]
    fn test_rename_addon_profile_updates_active_profile() {
        with_isolated_settings(|_| {
            let wow_dir = tempdir().unwrap();
            let settings = LauncherSettings {
                path: Some(wow_dir.path().to_string_lossy().to_string()),
                window_size: None,
                stay_open: None,
                active_profile_by_path: None,
                addon_profiles_by_path: None,
                addon_profiles: Some(vec![AddonProfile {
                    name: "p1".to_string(),
                    enabled_addons: vec![],
                    tweak_configs: None,
                    enabled_patches: None,
                }]),
                active_profile: Some("p1".to_string()),
                selected_executable: None,
            };
            save_settings(settings).unwrap();

            let res = rename_addon_profile("p1".to_string(), "renamed".to_string());
            assert_eq!(res.unwrap(), "OK");
            let reloaded = load_settings().unwrap();
            assert_eq!(reloaded.active_profile, Some("renamed".to_string()));
        });
    }

    #[test]
    fn test_rename_addon_profile_leaves_other_active_profile() {
        with_isolated_settings(|_| {
            let wow_dir = tempdir().unwrap();
            let settings = LauncherSettings {
                path: Some(wow_dir.path().to_string_lossy().to_string()),
                window_size: None,
                stay_open: None,
                active_profile_by_path: None,
                addon_profiles_by_path: None,
                addon_profiles: Some(vec![AddonProfile {
                    name: "p1".to_string(),
                    enabled_addons: vec![],
                    tweak_configs: None,
                    enabled_patches: None,
                }]),
                active_profile: Some("other".to_string()),
                selected_executable: None,
            };
            save_settings(settings).unwrap();

            let res = rename_addon_profile("p1".to_string(), "renamed".to_string());
            assert_eq!(res.unwrap(), "OK");
            let reloaded = load_settings().unwrap();
            assert_eq!(reloaded.active_profile, Some("other".to_string()));
        });
    }
}
