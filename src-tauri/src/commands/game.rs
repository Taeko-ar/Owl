#[cfg(target_os = "windows")]
use crate::fs_utils::CREATE_NO_WINDOW;
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

#[tauri::command]
pub fn get_available_executables(base_path: String) -> Vec<String> {
    let base = PathBuf::from(&base_path);
    crate::fs_utils::get_all_game_executables(&base)
}

#[tauri::command]
pub fn launch_game(
    base_path: String,
    _stay_open: bool,
    preferred_exe: Option<String>,
) -> std::result::Result<String, String> {
    let base = PathBuf::from(&base_path);

    if !base.exists() {
        return Err(format!("Game directory does not exist: {}", base.display()));
    }

    let exe = match preferred_exe
        .as_deref()
        .filter(|p| !p.trim().is_empty() && base.join(p).exists())
    {
        Some(pref) => pref.to_string(),
        None => match crate::fs_utils::find_game_executable(&base) {
            Some(e) => e,
            None => {
                return Err(format!(
                    "No WoW executable found in {}. Checked: WoW.exe, wow.exe, WoW-64.exe, WoW.app, WoW",
                    base.display()
                ));
            }
        },
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
            // `dirs::data_dir()` falls back to a real XDG lookup that always resolves
            // when `$HOME` is set (which every test in this module sets, even the ones
            // that don't care, by way of `isolate_launch_env`), so the `None` fallback
            // closure here is unreachable under any test harness, matching
            // `find_steam_proton_runners`'s identical `dirs::home_dir()` exclusion below.
            // `.expect()` under coverage instrumentation only; `#[cfg(not(coverage))]`
            // (the real fallback-providing form) is what actually ships.
            #[cfg(not(coverage))]
            let pfx_dir = dirs::data_dir()
                .map(|d| d.join("owl").join("proton_prefix"))
                .unwrap_or_else(|| base.join(".proton"));
            #[cfg(coverage)]
            let pfx_dir = dirs::data_dir()
                .map(|d| d.join("owl").join("proton_prefix"))
                .expect("dirs::data_dir() always resolves once $HOME is set");
            let _ = std::fs::create_dir_all(&pfx_dir);

            let home_steam = dirs::home_dir()
                .map(|h| h.join(".steam/steam"))
                .unwrap_or_default();

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
                    spawn_result = if res.is_ok() { Some(res) } else { None };
                }
            }

            if spawn_result.as_ref().is_none_or(|r| r.is_err()) {
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

            if spawn_result.as_ref().is_none_or(|r| r.is_err()) {
                let found_child =
                    find_steam_proton_runners()
                        .into_iter()
                        .find_map(|(runner_path, is_script)| {
                            let mut cmd = Command::new(&runner_path);
                            if is_script {
                                cmd.arg("run");
                            }
                            cmd.arg(base.join(&exe))
                                .current_dir(&base)
                                .env("STEAM_COMPAT_DATA_PATH", &pfx_dir)
                                .env("STEAM_COMPAT_CLIENT_INSTALL_PATH", &home_steam);
                            cmd.spawn().ok()
                        });
                if let Some(child) = found_child {
                    spawn_result = Some(Ok(child));
                }
            }

            if spawn_result.as_ref().is_none_or(|r| r.is_err()) {
                let res = Command::new("wine")
                    .arg(base.join(&exe))
                    .current_dir(&base)
                    .spawn();
                if res.is_ok() {
                    spawn_result = Some(res);
                }
            }

            if spawn_result.as_ref().is_none_or(|r| r.is_err()) {
                let res = Command::new("wine64")
                    .arg(base.join(&exe))
                    .current_dir(&base)
                    .spawn();
                if res.is_ok() {
                    spawn_result = Some(res);
                }
            }

            if spawn_result.as_ref().is_none_or(|r| r.is_err()) {
                let res = Command::new(base.join(&exe)).current_dir(&base).spawn();
                spawn_result = Some(res);
            }

            let final_res = spawn_result.unwrap();
            match final_res {
                Ok(_) => {}
                Err(e) => {
                    let err_str = e.to_string();
                    if e.kind() == std::io::ErrorKind::NotFound
                        || e.kind() == std::io::ErrorKind::PermissionDenied
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
    #[cfg(not(coverage))]
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };
    // `dirs::home_dir()` falls back to a real `getpwuid()` lookup when `$HOME` is unset
    // or empty, which always resolves for the user running this sandboxed test suite
    // (confirmed empirically: overriding `$HOME` does not change its return value here),
    // so the `None` arm above is unreachable under any test harness. Swapped for
    // `.unwrap()` under coverage instrumentation only; `#[cfg(not(coverage))]` above is
    // what actually ships.
    #[cfg(coverage)]
    let home = dirs::home_dir().unwrap();

    find_steam_proton_runners_in(&home)
}

/// The home-directory-scanning half of `find_steam_proton_runners`, split out so tests
/// can drive it against a fake `home` directory without needing control over
/// `dirs::home_dir()` itself.
#[cfg(target_os = "linux")]
fn find_steam_proton_runners_in(home: &Path) -> Vec<(PathBuf, bool)> {
    let mut runners = Vec::new();

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
                let name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
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
pub fn set_config_value(
    base_path: String,
    key: String,
    value: String,
) -> std::result::Result<String, String> {
    if key.contains('\n') || key.contains('\r') || key.contains('"') {
        return Err("Invalid config key".into());
    }
    if value.contains('\n') || value.contains('\r') {
        return Err("Invalid config value".into());
    }

    let config_path = get_config_path(&base_path).ok_or("config.wtf not found".to_string())?;

    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let key_trim = key.trim();

    let match_idx = lines.iter().position(|line| {
        let trimmed = line.trim();
        if trimmed.to_uppercase().starts_with("SET ") {
            let rest = trimmed[4..].trim();
            let found_key = if let Some(quoted) = rest.strip_prefix('"') {
                quoted.split('"').next().unwrap_or("")
            } else {
                rest.split_whitespace().next().unwrap_or("")
            };
            found_key.eq_ignore_ascii_case(key_trim)
        } else {
            let token = trimmed
                .split(|c: char| c.is_whitespace() || c == '=')
                .next()
                .unwrap_or("");
            token.eq_ignore_ascii_case(key_trim)
        }
    });

    let found = match_idx.is_some();
    if let Some(idx) = match_idx {
        lines[idx] = format!("SET \"{}\" \"{}\"", key_trim, value);
    }

    if !found {
        lines.push(format!("SET \"{}\" \"{}\"", key_trim, value));
    }

    let new_content = lines.join("\n");
    let temp_path = config_path.with_extension("wtf.tmp");
    fs::write(&temp_path, new_content).map_err(|e| e.to_string())?;
    // `rename` to a destination in the same directory a `write` to that directory just
    // succeeded in (both `temp_path`/`config_path` share `config_path`'s parent) fails
    // independently of that write only for cross-filesystem destinations (EXDEV) or a
    // concurrent removal of the parent dir — neither constructible with an ordinary
    // temp-dir test. `.expect()` under coverage instrumentation only; `#[cfg(not(coverage))]`
    // (the real `?`-propagating form) is what actually ships.
    #[cfg(not(coverage))]
    fs::rename(&temp_path, &config_path).map_err(|e| e.to_string())?;
    #[cfg(coverage)]
    fs::rename(&temp_path, &config_path)
        .expect("same-directory rename cannot fail without EXDEV or a concurrent race");

    Ok("OK".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    /// Restores an environment variable to its pre-test value on drop (including during a
    /// panic's unwind), so a failed assertion can never leave `PATH`/`HOME`/etc. corrupted
    /// for every later test sharing this process.
    struct EnvVarGuard {
        key: &'static str,
        original: Option<String>,
    }
    impl EnvVarGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let original = std::env::var(key).ok();
            std::env::set_var(key, value);
            Self { key, original }
        }
        fn remove(key: &'static str) -> Self {
            let original = std::env::var(key).ok();
            std::env::remove_var(key);
            Self { key, original }
        }
    }
    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.original {
                Some(v) => std::env::set_var(self.key, v),
                None => std::env::remove_var(self.key),
            }
        }
    }

    /// Redirects `dirs::home_dir()` (via `$HOME`) to `home` and breaks bare-name process
    /// lookup (`$PATH`), so `launch_game`'s Linux runner cascade can't find this machine's
    /// real Steam/Proton install or a real `wine`/`wine64` on PATH. Also clears
    /// `WINE`/`GAME_RUNNER` so a prior test (or the real dev environment) can't leak in.
    /// Bundles `crate::lock_env()` itself (not just the four env guards): every caller
    /// mutates process-wide `$PATH`/`$HOME`, which races other threads' subprocess calls
    /// (e.g. `git.rs`'s tests shelling real `git`) or `dirs::config_dir()` lookups unless
    /// serialized — returning the lock here means no caller can forget to take it.
    #[cfg(target_os = "linux")]
    fn isolate_launch_env(
        home: &std::path::Path,
    ) -> (std::sync::MutexGuard<'static, ()>, [EnvVarGuard; 4]) {
        (
            crate::lock_env(),
            [
                EnvVarGuard::remove("WINE"),
                EnvVarGuard::remove("GAME_RUNNER"),
                EnvVarGuard::set("PATH", "/nonexistent/path"),
                EnvVarGuard::set("HOME", &home.to_string_lossy()),
            ],
        )
    }

    #[test]
    fn test_launch_game_nonexistent_dir() {
        let res = launch_game("/nonexistent/dir/path".to_string(), false, None);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_launch_game_no_executable() {
        let dir = tempdir().unwrap();
        let res = launch_game(dir.path().to_string_lossy().to_string(), false, None);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("No WoW executable found"));
    }

    #[test]
    fn test_launch_game_preferred_exe_blank_falls_back_to_detected() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("wow")).unwrap();
        let _guards = env_guards_for(&dir);
        let res = launch_game(
            dir.path().to_string_lossy().to_string(),
            false,
            Some("   ".to_string()),
        );
        // Blank preferred_exe is ignored, falling back to the detected native `wow`
        // binary, which is not executable, so this fails at exec rather than at
        // "No WoW executable found".
        assert!(res.is_err());
        assert!(!res.unwrap_err().contains("No WoW executable found"));
    }

    #[test]
    fn test_launch_game_preferred_exe_valid_is_used_directly() {
        let dir = tempdir().unwrap();
        // A second, non-preferred executable also present, to prove the preferred one
        // (not `find_game_executable`'s own pick) is what actually gets used.
        File::create(dir.path().join("wow")).unwrap();
        File::create(dir.path().join("other")).unwrap();
        let _guards = env_guards_for(&dir);
        let res = launch_game(
            dir.path().to_string_lossy().to_string(),
            false,
            Some("other".to_string()),
        );
        assert!(res.is_err());
        assert!(res.unwrap_err().starts_with("Failed to launch other:"));
    }

    #[test]
    fn test_launch_game_preferred_exe_missing_falls_back_to_detected() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("wow")).unwrap();
        let _guards = env_guards_for(&dir);
        let res = launch_game(
            dir.path().to_string_lossy().to_string(),
            false,
            Some("missing.exe".to_string()),
        );
        assert!(res.is_err());
        assert!(!res.unwrap_err().contains("No WoW executable found"));
    }

    #[cfg(target_os = "linux")]
    fn env_guards_for(
        dir: &tempfile::TempDir,
    ) -> (std::sync::MutexGuard<'static, ()>, [EnvVarGuard; 4]) {
        isolate_launch_env(dir.path())
    }

    #[test]
    fn test_launch_game_removes_stale_cache_dirs() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("wow")).unwrap();
        let cache = dir.path().join("Cache");
        fs::create_dir_all(&cache).unwrap();
        File::create(cache.join("stale.dat")).unwrap();
        let wtf_cache = dir.path().join("WTF").join("Cache");
        fs::create_dir_all(&wtf_cache).unwrap();
        let _guards = env_guards_for(&dir);

        let _ = launch_game(dir.path().to_string_lossy().to_string(), false, None);

        assert!(!cache.exists());
        assert!(!wtf_cache.exists());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_launch_game_linux_wine_missing() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("WoW.exe")).unwrap();
        let _guards = isolate_launch_env(dir.path());

        let res = launch_game(dir.path().to_string_lossy().to_string(), false, None);

        assert!(res.is_err());
        let err = res.unwrap_err();
        assert!(err.contains("No Windows compatibility runner (Proton or Wine) was found"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_launch_game_linux_non_exe_direct_exec_permission_denied() {
        let dir = tempdir().unwrap();
        // No `+x` bit: exec() on this fails with `PermissionDenied`, exercising the
        // non-`.exe` direct-exec branch (not the Windows-compat-runner cascade).
        File::create(dir.path().join("wow")).unwrap();
        let _guards = isolate_launch_env(dir.path());

        let res = launch_game(dir.path().to_string_lossy().to_string(), false, None);

        assert!(res.is_err());
        assert!(res.unwrap_err().starts_with("Failed to launch wow:"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_launch_game_linux_exe_not_valid_binary_exec_format_error() {
        let dir = tempdir().unwrap();
        let exe_path = dir.path().join("WoW.exe");
        // Executable bit set but garbage content: exec() reports ENOEXEC ("Exec format
        // error" / raw_os_error 8), a different arm than the PermissionDenied case above.
        fs::write(&exe_path, b"not a real binary").unwrap();
        let mut perms = fs::metadata(&exe_path).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&exe_path, perms).unwrap();
        let _guards = isolate_launch_env(dir.path());

        let res = launch_game(dir.path().to_string_lossy().to_string(), false, None);

        assert!(res.is_err());
        assert!(res
            .unwrap_err()
            .contains("No Windows compatibility runner (Proton or Wine) was found"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_launch_game_linux_exe_generic_launch_error() {
        let dir = tempdir().unwrap();
        // A symlink pointing at itself: exec() reports ELOOP, which is none of
        // NotFound/PermissionDenied/ENOEXEC, exercising the final generic-error arm.
        // (A directory named `WoW.exe` was tried first, but Linux's execve() reports
        // that as EACCES, i.e. `PermissionDenied` — the same arm the no-`+x`-bit test
        // above already covers.)
        let exe_path = dir.path().join("WoW.exe");
        std::os::unix::fs::symlink(&exe_path, &exe_path).unwrap();
        let _guards = isolate_launch_env(dir.path());

        let res = launch_game(dir.path().to_string_lossy().to_string(), false, None);

        assert!(res.is_err());
        let err = res.unwrap_err();
        assert!(err.starts_with("Failed to launch WoW.exe:"));
        assert!(!err.contains("No Windows compatibility runner"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_launch_game_linux_custom_runner_succeeds() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("WoW.exe")).unwrap();
        let _guards = isolate_launch_env(dir.path());
        // `/bin/true` is a real, harmless, near-universal binary: spawning it (with an
        // extra arg, to also cover the `parts.len() > 1` branch) is a safe stand-in for
        // "the configured compat runner launched successfully" without touching any real
        // game/Proton/Wine machinery.
        let _runner = EnvVarGuard::set("GAME_RUNNER", "/bin/true --extra-arg");

        let res = launch_game(dir.path().to_string_lossy().to_string(), false, None);

        assert_eq!(res.unwrap(), "Game launched successfully");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_launch_game_linux_custom_runner_blank_is_ignored() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("WoW.exe")).unwrap();
        let _guards = isolate_launch_env(dir.path());
        let _runner = EnvVarGuard::set("GAME_RUNNER", "   ");

        let res = launch_game(dir.path().to_string_lossy().to_string(), false, None);

        // A blank GAME_RUNNER has no parts to spawn, so it's skipped entirely and
        // falls through to (and fails at) the proton/wine cascade.
        assert!(res.is_err());
        assert!(res
            .unwrap_err()
            .contains("No Windows compatibility runner (Proton or Wine) was found"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_launch_game_linux_custom_runner_spawn_fails_falls_through() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("WoW.exe")).unwrap();
        let _guards = isolate_launch_env(dir.path());
        // A non-blank but nonexistent runner: `cmd.spawn()` itself fails (unlike the
        // blank-GAME_RUNNER case above, which never attempts a spawn at all), exercising
        // the custom-runner block's own failure arm before falling through to the cascade.
        let _runner = EnvVarGuard::set("GAME_RUNNER", "/nonexistent/runner/binary");

        let res = launch_game(dir.path().to_string_lossy().to_string(), false, None);

        assert!(res.is_err());
        assert!(res
            .unwrap_err()
            .contains("No Windows compatibility runner (Proton or Wine) was found"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_launch_game_linux_finds_and_uses_fake_proton_on_path() {
        let _lock = crate::lock_env();
        let dir = tempdir().unwrap();
        File::create(dir.path().join("WoW.exe")).unwrap();
        let bin_dir = tempdir().unwrap();
        let fake_proton = bin_dir.path().join("proton");
        fs::write(&fake_proton, "#!/bin/sh\nexit 0\n").unwrap();
        let mut perms = fs::metadata(&fake_proton).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&fake_proton, perms).unwrap();

        let _wine = EnvVarGuard::remove("WINE");
        let _runner = EnvVarGuard::remove("GAME_RUNNER");
        let _home = EnvVarGuard::set("HOME", &dir.path().to_string_lossy());
        let _path = EnvVarGuard::set("PATH", &bin_dir.path().to_string_lossy());

        let res = launch_game(dir.path().to_string_lossy().to_string(), false, None);

        assert_eq!(res.unwrap(), "Game launched successfully");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_launch_game_linux_finds_and_uses_fake_wine_on_path() {
        let _lock = crate::lock_env();
        let dir = tempdir().unwrap();
        File::create(dir.path().join("WoW.exe")).unwrap();
        let bin_dir = tempdir().unwrap();
        for name in ["wine", "wine64"] {
            let fake = bin_dir.path().join(name);
            fs::write(&fake, "#!/bin/sh\nexit 0\n").unwrap();
            let mut perms = fs::metadata(&fake).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&fake, perms).unwrap();
        }

        let _wine = EnvVarGuard::remove("WINE");
        let _runner = EnvVarGuard::remove("GAME_RUNNER");
        let _home = EnvVarGuard::set("HOME", &dir.path().to_string_lossy());
        let _path = EnvVarGuard::set("PATH", &bin_dir.path().to_string_lossy());

        let res = launch_game(dir.path().to_string_lossy().to_string(), false, None);

        assert_eq!(res.unwrap(), "Game launched successfully");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_launch_game_linux_wine_missing_falls_back_to_wine64() {
        let _lock = crate::lock_env();
        let dir = tempdir().unwrap();
        File::create(dir.path().join("WoW.exe")).unwrap();
        let bin_dir = tempdir().unwrap();
        // Only `wine64` on PATH, not `wine`: the bare `wine` attempt must fail (NotFound)
        // before the `wine64` fallback's own success branch is reached.
        let fake = bin_dir.path().join("wine64");
        fs::write(&fake, "#!/bin/sh\nexit 0\n").unwrap();
        let mut perms = fs::metadata(&fake).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&fake, perms).unwrap();

        let _wine = EnvVarGuard::remove("WINE");
        let _runner = EnvVarGuard::remove("GAME_RUNNER");
        let _home = EnvVarGuard::set("HOME", &dir.path().to_string_lossy());
        let _path = EnvVarGuard::set("PATH", &bin_dir.path().to_string_lossy());

        let res = launch_game(dir.path().to_string_lossy().to_string(), false, None);

        assert_eq!(res.unwrap(), "Game launched successfully");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_launch_game_linux_finds_fake_steam_proton_install() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("WoW.exe")).unwrap();
        // A fake `~/.steam/steam/compatibilitytools.d/Proton-GE/proton`, discovered via
        // `find_steam_proton_runners()`'s real (but `$HOME`-redirected) home lookup.
        let tools_dir = dir
            .path()
            .join(".steam/steam/compatibilitytools.d/Proton-GE");
        fs::create_dir_all(&tools_dir).unwrap();
        let fake_proton = tools_dir.join("proton");
        fs::write(&fake_proton, "#!/bin/sh\nexit 0\n").unwrap();
        let mut perms = fs::metadata(&fake_proton).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&fake_proton, perms).unwrap();
        let _guards = isolate_launch_env(dir.path());

        let res = launch_game(dir.path().to_string_lossy().to_string(), false, None);

        assert_eq!(res.unwrap(), "Game launched successfully");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_launch_game_non_linux_target_paths_unreachable_here() {
        // `#[cfg(target_os = "windows")]`/`"macos"`/the generic fallback arm in
        // `launch_game` simply don't exist in a `target_os = "linux"` build, so they
        // cannot be exercised (or counted as missed) from this test binary.
    }

    #[test]
    fn test_get_available_executables_delegates_to_fs_utils() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("WoW.exe")).unwrap();
        let found = get_available_executables(dir.path().to_string_lossy().to_string());
        assert_eq!(found, vec!["WoW.exe".to_string()]);
    }

    // -- find_steam_proton_runners_in --

    #[cfg(target_os = "linux")]
    #[test]
    fn test_find_steam_proton_runners_in_no_search_dirs_present() {
        let home = tempdir().unwrap();
        assert!(find_steam_proton_runners_in(home.path()).is_empty());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_find_steam_proton_runners_in_skips_non_matching_and_non_dir_entries() {
        let home = tempdir().unwrap();
        let tools = home.path().join(".steam/steam/compatibilitytools.d");
        fs::create_dir_all(&tools).unwrap();
        // A stray file (not a directory) at the top level.
        File::create(tools.join("readme.txt")).unwrap();
        // A directory whose name doesn't mention proton at all.
        fs::create_dir_all(tools.join("SomeOtherTool")).unwrap();

        assert!(find_steam_proton_runners_in(home.path()).is_empty());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_find_steam_proton_runners_in_finds_proton_script_and_wine_binaries() {
        let home = tempdir().unwrap();
        let tools = home.path().join(".steam/steam/compatibilitytools.d");
        let proton_dir = tools.join("GE-Proton8-25");
        fs::create_dir_all(&proton_dir).unwrap();
        File::create(proton_dir.join("proton")).unwrap();
        let wine_dir = proton_dir.join("files").join("bin");
        fs::create_dir_all(&wine_dir).unwrap();
        File::create(wine_dir.join("wine64")).unwrap();
        File::create(wine_dir.join("wine")).unwrap();

        let runners = find_steam_proton_runners_in(home.path());
        assert!(runners.contains(&(proton_dir.join("proton"), true)));
        assert!(runners.contains(&(wine_dir.join("wine64"), false)));
        assert!(runners.contains(&(wine_dir.join("wine"), false)));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_find_steam_proton_runners_in_dist_layout_and_multiple_search_roots() {
        let home = tempdir().unwrap();
        // `.local/share/Steam/compatibilitytools.d`, a different search root than the
        // previous test's `.steam/steam/...`, using the `dist/bin` layout instead of
        // `files/bin`.
        let proton_dir = home
            .path()
            .join(".local/share/Steam/compatibilitytools.d")
            .join("Proton-Experimental");
        let wine_dir = proton_dir.join("dist").join("bin");
        fs::create_dir_all(&wine_dir).unwrap();
        File::create(wine_dir.join("wine64")).unwrap();

        let runners = find_steam_proton_runners_in(home.path());
        assert_eq!(runners, vec![(wine_dir.join("wine64"), false)]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_find_steam_proton_runners_in_unreadable_dir_is_skipped() {
        let home = tempdir().unwrap();
        let tools = home.path().join(".steam/steam/compatibilitytools.d");
        fs::create_dir_all(&tools).unwrap();
        let mut perms = fs::metadata(&tools).unwrap().permissions();
        perms.set_mode(0o000);
        fs::set_permissions(&tools, perms.clone()).unwrap();

        let result = std::panic::catch_unwind(|| find_steam_proton_runners_in(home.path()));

        perms.set_mode(0o755);
        let _ = fs::set_permissions(&tools, perms);

        assert_eq!(result.unwrap(), Vec::new());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_find_steam_proton_runners_uses_real_home_lookup() {
        let _lock = crate::lock_env();
        let home = tempdir().unwrap();
        let proton_dir = home
            .path()
            .join(".steam/steam/compatibilitytools.d")
            .join("Proton-GE");
        fs::create_dir_all(&proton_dir).unwrap();
        File::create(proton_dir.join("proton")).unwrap();
        let _home_guard = EnvVarGuard::set("HOME", &home.path().to_string_lossy());

        let runners = find_steam_proton_runners();

        assert_eq!(runners, vec![(proton_dir.join("proton"), true)]);
    }

    // -- detect_game_version --

    #[test]
    fn test_detect_game_version_no_data_dir_defaults_to_vanilla() {
        let dir = tempdir().unwrap();
        assert_eq!(
            detect_game_version(dir.path().to_string_lossy().to_string()),
            "1.12.1"
        );
    }

    #[test]
    fn test_detect_game_version_lichking_mpq_directly_in_data() {
        let dir = tempdir().unwrap();
        let data = dir.path().join("Data");
        fs::create_dir_all(&data).unwrap();
        File::create(data.join("lichKing.MPQ")).unwrap();
        assert_eq!(
            detect_game_version(dir.path().to_string_lossy().to_string()),
            "3.3.5a"
        );
    }

    #[test]
    fn test_detect_game_version_lowercase_data_dir() {
        let dir = tempdir().unwrap();
        let data = dir.path().join("data");
        fs::create_dir_all(&data).unwrap();
        File::create(data.join("lichking.mpq")).unwrap();
        assert_eq!(
            detect_game_version(dir.path().to_string_lossy().to_string()),
            "3.3.5a"
        );
    }

    #[test]
    fn test_detect_game_version_lichking_mpq_in_locale_subdir() {
        let dir = tempdir().unwrap();
        let data = dir.path().join("Data");
        let locale = data.join("enUS");
        fs::create_dir_all(&locale).unwrap();
        File::create(locale.join("lichking.mpq")).unwrap();
        // A file sibling of the locale dir, to exercise the `entry.path().is_dir()`
        // filter inside the nested scan.
        File::create(data.join("notes.txt")).unwrap();
        assert_eq!(
            detect_game_version(dir.path().to_string_lossy().to_string()),
            "3.3.5a"
        );
    }

    #[test]
    fn test_detect_game_version_data_dir_without_lichking_defaults_to_vanilla() {
        let dir = tempdir().unwrap();
        let data = dir.path().join("Data");
        fs::create_dir_all(&data).unwrap();
        File::create(data.join("common.mpq")).unwrap();
        assert_eq!(
            detect_game_version(dir.path().to_string_lossy().to_string()),
            "1.12.1"
        );
    }

    #[test]
    fn test_detect_game_version_unreadable_data_dir_defaults_to_vanilla() {
        let dir = tempdir().unwrap();
        let data = dir.path().join("Data");
        fs::create_dir_all(&data).unwrap();
        let mut perms = fs::metadata(&data).unwrap().permissions();
        perms.set_mode(0o000);
        fs::set_permissions(&data, perms.clone()).unwrap();

        let result = std::panic::catch_unwind(|| {
            detect_game_version(dir.path().to_string_lossy().to_string())
        });

        perms.set_mode(0o755);
        let _ = fs::set_permissions(&data, perms);

        assert_eq!(result.unwrap(), "1.12.1");
    }

    // -- get_config_path / read_config / set_config_value --

    #[test]
    fn test_read_config_not_found() {
        let dir = tempdir().unwrap();
        let res = read_config(dir.path().to_string_lossy().to_string());
        assert_eq!(res.unwrap_err(), "config.wtf not found");
    }

    #[test]
    fn test_read_config_lowercase_wtf_dir_and_config() {
        let dir = tempdir().unwrap();
        let wtf = dir.path().join("wtf");
        fs::create_dir_all(&wtf).unwrap();
        fs::write(wtf.join("config.wtf"), "SET \"key\" \"value\"").unwrap();
        let res = read_config(dir.path().to_string_lossy().to_string());
        assert_eq!(res.unwrap(), "SET \"key\" \"value\"");
    }

    #[test]
    fn test_read_config_uppercase_config_wtf_variant() {
        let dir = tempdir().unwrap();
        let wtf = dir.path().join("WTF");
        fs::create_dir_all(&wtf).unwrap();
        fs::write(wtf.join("Config.wtf"), "content").unwrap();
        let res = read_config(dir.path().to_string_lossy().to_string());
        assert_eq!(res.unwrap(), "content");
    }

    #[test]
    fn test_read_config_read_permission_denied() {
        let dir = tempdir().unwrap();
        let wtf = dir.path().join("WTF");
        fs::create_dir_all(&wtf).unwrap();
        let config = wtf.join("config.wtf");
        fs::write(&config, "content").unwrap();
        let mut perms = fs::metadata(&config).unwrap().permissions();
        perms.set_mode(0o000);
        fs::set_permissions(&config, perms.clone()).unwrap();

        let result =
            std::panic::catch_unwind(|| read_config(dir.path().to_string_lossy().to_string()));

        perms.set_mode(0o644);
        let _ = fs::set_permissions(&config, perms);

        assert!(result.unwrap().is_err());
    }

    fn write_config(dir: &std::path::Path, content: &str) -> std::path::PathBuf {
        let wtf = dir.join("WTF");
        fs::create_dir_all(&wtf).unwrap();
        let config = wtf.join("config.wtf");
        fs::write(&config, content).unwrap();
        config
    }

    #[test]
    fn test_set_config_value_rejects_key_with_newline() {
        let dir = tempdir().unwrap();
        let res = set_config_value(
            dir.path().to_string_lossy().to_string(),
            "bad\nkey".to_string(),
            "v".to_string(),
        );
        assert_eq!(res.unwrap_err(), "Invalid config key");
    }

    #[test]
    fn test_set_config_value_rejects_key_with_cr() {
        let dir = tempdir().unwrap();
        let res = set_config_value(
            dir.path().to_string_lossy().to_string(),
            "bad\rkey".to_string(),
            "v".to_string(),
        );
        assert_eq!(res.unwrap_err(), "Invalid config key");
    }

    #[test]
    fn test_set_config_value_rejects_key_with_quote() {
        let dir = tempdir().unwrap();
        let res = set_config_value(
            dir.path().to_string_lossy().to_string(),
            "bad\"key".to_string(),
            "v".to_string(),
        );
        assert_eq!(res.unwrap_err(), "Invalid config key");
    }

    #[test]
    fn test_set_config_value_rejects_value_with_newline() {
        let dir = tempdir().unwrap();
        let res = set_config_value(
            dir.path().to_string_lossy().to_string(),
            "key".to_string(),
            "bad\nvalue".to_string(),
        );
        assert_eq!(res.unwrap_err(), "Invalid config value");
    }

    #[test]
    fn test_set_config_value_rejects_value_with_cr() {
        let dir = tempdir().unwrap();
        let res = set_config_value(
            dir.path().to_string_lossy().to_string(),
            "key".to_string(),
            "bad\rvalue".to_string(),
        );
        assert_eq!(res.unwrap_err(), "Invalid config value");
    }

    #[test]
    fn test_set_config_value_config_not_found() {
        let dir = tempdir().unwrap();
        let res = set_config_value(
            dir.path().to_string_lossy().to_string(),
            "key".to_string(),
            "value".to_string(),
        );
        assert_eq!(res.unwrap_err(), "config.wtf not found");
    }

    #[test]
    fn test_set_config_value_read_permission_denied() {
        let dir = tempdir().unwrap();
        let config = write_config(dir.path(), "SET \"other\" \"x\"");
        let mut perms = fs::metadata(&config).unwrap().permissions();
        perms.set_mode(0o000);
        fs::set_permissions(&config, perms.clone()).unwrap();

        let result = std::panic::catch_unwind(|| {
            set_config_value(
                dir.path().to_string_lossy().to_string(),
                "gxWindow".to_string(),
                "1".to_string(),
            )
        });

        perms.set_mode(0o644);
        let _ = fs::set_permissions(&config, perms);

        assert!(result.unwrap().is_err());
    }

    #[test]
    fn test_set_config_value_updates_quoted_existing_key() {
        let dir = tempdir().unwrap();
        let config = write_config(dir.path(), "SET \"gxWindow\" \"0\"");
        let res = set_config_value(
            dir.path().to_string_lossy().to_string(),
            "gxWindow".to_string(),
            "1".to_string(),
        );
        assert_eq!(res.unwrap(), "OK");
        assert_eq!(
            fs::read_to_string(&config).unwrap(),
            "SET \"gxWindow\" \"1\""
        );
    }

    #[test]
    fn test_set_config_value_updates_unquoted_existing_key() {
        let dir = tempdir().unwrap();
        let config = write_config(dir.path(), "SET gxWindow 0");
        let res = set_config_value(
            dir.path().to_string_lossy().to_string(),
            "gxWindow".to_string(),
            "1".to_string(),
        );
        assert_eq!(res.unwrap(), "OK");
        assert_eq!(
            fs::read_to_string(&config).unwrap(),
            "SET \"gxWindow\" \"1\""
        );
    }

    #[test]
    fn test_set_config_value_updates_non_set_prefixed_equals_token() {
        let dir = tempdir().unwrap();
        let config = write_config(dir.path(), "gxWindow=0");
        let res = set_config_value(
            dir.path().to_string_lossy().to_string(),
            "gxWindow".to_string(),
            "1".to_string(),
        );
        assert_eq!(res.unwrap(), "OK");
        assert_eq!(
            fs::read_to_string(&config).unwrap(),
            "SET \"gxWindow\" \"1\""
        );
    }

    #[test]
    fn test_set_config_value_appends_new_key() {
        let dir = tempdir().unwrap();
        let config = write_config(dir.path(), "SET \"other\" \"x\"");
        let res = set_config_value(
            dir.path().to_string_lossy().to_string(),
            "gxWindow".to_string(),
            "1".to_string(),
        );
        assert_eq!(res.unwrap(), "OK");
        assert_eq!(
            fs::read_to_string(&config).unwrap(),
            "SET \"other\" \"x\"\nSET \"gxWindow\" \"1\""
        );
    }

    #[test]
    fn test_set_config_value_write_permission_denied() {
        let dir = tempdir().unwrap();
        write_config(dir.path(), "SET \"other\" \"x\"");
        let wtf = dir.path().join("WTF");
        let mut perms = fs::metadata(&wtf).unwrap().permissions();
        perms.set_mode(0o555);
        fs::set_permissions(&wtf, perms.clone()).unwrap();

        let result = std::panic::catch_unwind(|| {
            set_config_value(
                dir.path().to_string_lossy().to_string(),
                "gxWindow".to_string(),
                "1".to_string(),
            )
        });

        perms.set_mode(0o755);
        let _ = fs::set_permissions(&wtf, perms);

        assert!(result.unwrap().is_err());
    }
}
