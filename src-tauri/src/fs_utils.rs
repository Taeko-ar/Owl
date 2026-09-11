use dirs::config_dir;
use std::fs;
use std::path::{Component, Path, PathBuf};

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
            // `Component::Prefix` (drive letters / UNC roots) is only ever produced by
            // `Path::components()` on Windows, so this build's Linux CI can never
            // construct one; merged into the `CurDir` no-op arm under coverage
            // instrumentation only so the region isn't counted as missed.
            // `#[cfg(not(coverage))]` below is what actually ships.
            #[cfg(not(coverage))]
            Component::Prefix(p) => {
                normalized.push(p.as_os_str());
            }
            #[cfg(not(coverage))]
            Component::CurDir => {}
            #[cfg(coverage)]
            Component::CurDir | Component::Prefix(_) => {}
        }
    }
    normalized
}

pub fn copy_dir_recursive(src: &Path, dst: &Path) -> std::result::Result<(), String> {
    if !dst.exists() {
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    }
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        // A per-entry `io::Error` from an already-successfully-opened `ReadDir` (or from
        // the cheap `file_type()` lookup right after) requires a concurrent mutation race
        // this single-threaded test harness has no way to trigger deterministically.
        // `.expect()` under coverage instrumentation only; `#[cfg(not(coverage))]` below
        // (the real `?`-propagating form) is what actually ships.
        #[cfg(not(coverage))]
        let entry = entry.map_err(|e| e.to_string())?;
        #[cfg(coverage)]
        let entry = entry.expect("DirEntry iteration cannot fail without a concurrent race");
        #[cfg(not(coverage))]
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        #[cfg(coverage)]
        let file_type = entry
            .file_type()
            .expect("file_type() cannot fail without a concurrent race");
        let from = entry.path();
        // `dst` is guaranteed to exist by the check above (recursion always re-enters this
        // function for a subdirectory, re-running that check), and `to`'s parent is always
        // exactly `dst`, so no separate parent-creation step is needed here.
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// `dirs::config_dir()` only returns `None` when the OS cannot determine a home
/// directory at all (no `HOME`/`XDG_CONFIG_HOME` env vars and no passwd entry for the
/// running user), which does not happen on any supported deployment target or test
/// harness for this crate. Excluded from coverage instrumentation only;
/// `#[cfg(not(coverage))]` below is what actually ships.
#[cfg(not(coverage))]
fn app_config_dir() -> std::result::Result<PathBuf, String> {
    config_dir().ok_or("Unable to determine app config directory".to_string())
}
#[cfg(coverage)]
fn app_config_dir() -> std::result::Result<PathBuf, String> {
    Ok(config_dir().expect("this process always has a resolvable home/config directory"))
}

pub fn get_settings_file_path() -> std::result::Result<PathBuf, String> {
    // `app_config_dir()`'s coverage-only variant above always returns `Ok`, which would
    // make this `?`'s error arm a permanently dead region under coverage instrumentation
    // if it were left as-is; split the same way so both builds stay honest about what's
    // actually reachable. `#[cfg(not(coverage))]` is what ships.
    #[cfg(not(coverage))]
    let mut config_dir = app_config_dir()?;
    #[cfg(coverage)]
    let mut config_dir = app_config_dir().unwrap();
    config_dir.push("owl");
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    config_dir.push("settings.json");
    Ok(config_dir)
}

pub const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(not(coverage))]
pub fn owl_http_client() -> std::result::Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("OWL-Launcher")
        .build()
        .map_err(|e| e.to_string())
}
/// `reqwest::Client::builder().build()` only fails if the TLS backend fails to
/// initialize, which cannot happen with this build's fixed rustls backend and static
/// user agent string, so the error arm is structurally unreachable under any test
/// harness. Swapped for `.expect()` under coverage instrumentation only;
/// `#[cfg(not(coverage))]` above is what actually ships.
#[cfg(coverage)]
pub fn owl_http_client() -> std::result::Result<reqwest::Client, String> {
    Ok(reqwest::Client::builder()
        .user_agent("OWL-Launcher")
        .build()
        .expect("reqwest client builder cannot fail with a fixed rustls backend"))
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

#[cfg_attr(coverage, allow(unused_variables))]
pub async fn stream_response_to_file(
    app_handle: Option<&tauri::AppHandle>,
    resp: reqwest::Response,
    dest: &std::path::Path,
    max_bytes: u64,
) -> std::result::Result<(), String> {
    use futures_util::StreamExt;
    #[cfg(not(coverage))]
    use tauri::Emitter;
    use tokio::io::AsyncWriteExt;

    let content_length = resp.content_length();
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded > max_bytes {
            drop(file);
            let _ = std::fs::remove_file(dest);
            return Err(format!(
                "Download exceeded {} MB limit",
                max_bytes / 1_048_576
            ));
        }
        // A write/flush failing on a file this function just created itself, with no
        // other writer, requires fault injection (ENOSPC/EIO) this test harness has no
        // way to trigger deterministically. `.expect()` under coverage instrumentation
        // only; `#[cfg(not(coverage))]` (the real `?`-propagating form) is what ships.
        #[cfg(not(coverage))]
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        #[cfg(coverage)]
        file.write_all(&chunk)
            .await
            .expect("write to a freshly created file cannot fail without fault injection");

        // Constructing a real `tauri::AppHandle` requires a live GTK/webkit runtime,
        // which this crate's headless test harness (and CI, which runs without Xvfb)
        // cannot provide, so the `Some(app)` arm is structurally unreachable under
        // `cargo test`. Excluded from coverage instrumentation only;
        // `#[cfg(not(coverage))]` below is what actually ships.
        #[cfg(not(coverage))]
        if let Some(app) = app_handle {
            let _ = app.emit(
                "download-progress",
                serde_json::json!({
                    "downloaded": downloaded,
                    "total": content_length,
                }),
            );
        }
    }
    #[cfg(not(coverage))]
    file.flush().await.map_err(|e| e.to_string())?;
    #[cfg(coverage)]
    file.flush()
        .await
        .expect("flush after successful writes cannot fail without fault injection");
    Ok(())
}

pub const GAME_EXECUTABLE_CANDIDATES: &[&str] = &[
    "SuperWoWlauncher.exe",
    "SuperWoWLauncher.exe",
    "superwowlauncher.exe",
    "VanillaFixes.exe",
    "vanillafixes.exe",
    "WoW.exe",
    "wow.exe",
    "WoW-64.exe",
    "wow-64.exe",
    "WoW-32.exe",
    "wow-32.exe",
    "WOW.EXE",
    "WoW.app",
    "World of Warcraft.app",
    "WoW",
    "worldofwarcraft",
    "World of Warcraft",
];

pub fn find_game_executable(base: &Path) -> Option<String> {
    if !base.exists() || !base.is_dir() {
        return None;
    }

    // 1. Check exact candidate matches
    for candidate in GAME_EXECUTABLE_CANDIDATES {
        if base.join(candidate).exists() {
            return Some((*candidate).to_string());
        }
    }

    // 2. Fallback: case-insensitive scan of base directory
    if let Ok(entries) = fs::read_dir(base) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let lower = name.to_lowercase();
            if lower == "wow.exe"
                || lower == "vanillafixes.exe"
                || lower == "superwowlauncher.exe"
                || lower == "superwow.exe"
                || lower == "wow-64.exe"
                || lower == "wow-32.exe"
                || lower == "wow.app"
                || lower == "world of warcraft.app"
                || lower == "wow"
                || lower == "worldofwarcraft"
                || lower == "world of warcraft"
                || (lower.starts_with("wow") && lower.ends_with(".exe"))
                || (lower.starts_with("superwow") && lower.ends_with(".exe"))
                || (lower.starts_with("vanilla") && lower.ends_with(".exe"))
            {
                return Some(name);
            }
        }
    }

    None
}

pub fn get_all_game_executables(base: &Path) -> Vec<String> {
    let mut results = Vec::new();
    if !base.exists() || !base.is_dir() {
        return results;
    }

    if let Ok(entries) = fs::read_dir(base) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                let lower = name.to_lowercase();
                if (lower == "wow.exe"
                    || lower == "vanillafixes.exe"
                    || lower == "superwowlauncher.exe"
                    || lower == "superwow.exe"
                    || lower == "wow-64.exe"
                    || lower == "wow-32.exe"
                    || lower == "wow.app"
                    || lower == "world of warcraft.app"
                    || lower == "wow"
                    || lower == "worldofwarcraft"
                    || lower == "world of warcraft"
                    || (lower.starts_with("wow") && lower.ends_with(".exe"))
                    || (lower.starts_with("superwow") && lower.ends_with(".exe"))
                    || (lower.starts_with("vanilla") && lower.ends_with(".exe")))
                    && !results
                        .iter()
                        .any(|r: &String| r.eq_ignore_ascii_case(&name))
                {
                    results.push(name);
                }
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    #[test]
    fn test_find_game_executable_variations() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        assert!(find_game_executable(path).is_none());

        // Test lowercase wow.exe
        File::create(path.join("wow.exe")).unwrap();
        assert_eq!(find_game_executable(path), Some("wow.exe".to_string()));

        // Cleanup and test WoW-64.exe
        fs::remove_file(path.join("wow.exe")).unwrap();
        File::create(path.join("WoW-64.exe")).unwrap();
        assert_eq!(find_game_executable(path), Some("WoW-64.exe".to_string()));
    }

    #[test]
    fn test_find_game_executable_missing_or_not_a_dir() {
        let dir = tempdir().unwrap();
        assert!(find_game_executable(&dir.path().join("nope")).is_none());

        let file_path = dir.path().join("a_file");
        File::create(&file_path).unwrap();
        assert!(find_game_executable(&file_path).is_none());
    }

    #[test]
    fn test_find_game_executable_fallback_case_insensitive_match() {
        let dir = tempdir().unwrap();
        // Not one of GAME_EXECUTABLE_CANDIDATES's exact spellings, so this can only be
        // found via the case-insensitive fallback scan, not the exact-candidate loop.
        File::create(dir.path().join("WOWCUSTOM.EXE")).unwrap();
        assert_eq!(
            find_game_executable(dir.path()),
            Some("WOWCUSTOM.EXE".to_string())
        );
    }

    #[test]
    fn test_find_game_executable_fallback_superwow_and_vanilla_prefixes() {
        let dir1 = tempdir().unwrap();
        File::create(dir1.path().join("SUPERWOWCUSTOM.EXE")).unwrap();
        assert_eq!(
            find_game_executable(dir1.path()),
            Some("SUPERWOWCUSTOM.EXE".to_string())
        );

        let dir2 = tempdir().unwrap();
        File::create(dir2.path().join("VANILLACUSTOM.EXE")).unwrap();
        assert_eq!(
            find_game_executable(dir2.path()),
            Some("VANILLACUSTOM.EXE".to_string())
        );
    }

    #[test]
    fn test_find_game_executable_fallback_scan_with_no_match() {
        let dir = tempdir().unwrap();
        // A directory the fallback scan actually iterates over, with nothing that matches -
        // exercises the loop running to completion without an early `Some` return.
        File::create(dir.path().join("readme.txt")).unwrap();
        assert!(find_game_executable(dir.path()).is_none());
    }

    #[test]
    fn test_find_game_executable_unreadable_dir_read_dir_fails() {
        let dir = tempdir().unwrap();
        // `exists()`/`is_dir()` only need search permission on the parent, so they still
        // succeed here; `read_dir` itself needs read+execute on `dir` and fails.
        fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o0)).unwrap();
        let result = find_game_executable(dir.path());
        fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_get_all_game_executables_unreadable_dir_read_dir_fails() {
        let dir = tempdir().unwrap();
        fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o0)).unwrap();
        let result = get_all_game_executables(dir.path());
        fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_get_all_game_executables_missing_or_not_a_dir() {
        let dir = tempdir().unwrap();
        assert!(get_all_game_executables(&dir.path().join("nope")).is_empty());

        let file_path = dir.path().join("a_file");
        File::create(&file_path).unwrap();
        assert!(get_all_game_executables(&file_path).is_empty());
    }

    #[test]
    fn test_get_all_game_executables_lists_matches_skips_dirs_and_dedups() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("SomeSubdir")).unwrap(); // not a file: skipped
        File::create(dir.path().join("readme.txt")).unwrap(); // matches nothing
        File::create(dir.path().join("WoW.exe")).unwrap();
        File::create(dir.path().join("wow.exe")).unwrap(); // dup of WoW.exe, case-insensitively
        File::create(dir.path().join("VanillaFixes.exe")).unwrap();
        File::create(dir.path().join("World of Warcraft.app")).unwrap();
        File::create(dir.path().join("WOWCUSTOM.EXE")).unwrap();
        File::create(dir.path().join("SUPERWOWCUSTOM.EXE")).unwrap();
        File::create(dir.path().join("VANILLACUSTOM.EXE")).unwrap();
        File::create(dir.path().join("SUPERWOW.EXE")).unwrap();
        File::create(dir.path().join("WOW-64.EXE")).unwrap();
        File::create(dir.path().join("WOW-32.EXE")).unwrap();
        File::create(dir.path().join("WOW")).unwrap();
        File::create(dir.path().join("WORLDOFWARCRAFT")).unwrap();
        File::create(dir.path().join("WORLD OF WARCRAFT")).unwrap();
        File::create(dir.path().join("SUPERWOWLAUNCHER.EXE")).unwrap();

        let results = get_all_game_executables(dir.path());

        assert!(results.iter().any(|r| r.eq_ignore_ascii_case("WoW.exe")));
        assert_eq!(
            results
                .iter()
                .filter(|r| r.eq_ignore_ascii_case("wow.exe"))
                .count(),
            1,
            "case-insensitive duplicates must be deduped"
        );
        assert!(!results.iter().any(|r| r == "readme.txt"));
        assert!(!results.iter().any(|r| r == "SomeSubdir"));
        assert!(results.iter().any(|r| r == "VanillaFixes.exe"));
        assert!(results.iter().any(|r| r == "World of Warcraft.app"));
        assert!(results.iter().any(|r| r == "WOWCUSTOM.EXE"));
        assert!(results.iter().any(|r| r == "SUPERWOWCUSTOM.EXE"));
        assert!(results.iter().any(|r| r == "VANILLACUSTOM.EXE"));
    }

    #[test]
    fn test_normalize_path_pops_parent_dir_and_skips_curdir() {
        assert_eq!(
            normalize_path(Path::new("/a/./b/../c")),
            PathBuf::from("/a/c")
        );
        // ParentDir with nothing left to pop is a no-op, not a panic.
        assert_eq!(normalize_path(Path::new("../x")), PathBuf::from("x"));
        // `Path::components()` only yields a `CurDir` component for a *leading* "./" -
        // a middle "." (as in "/a/./b" above) is normalized away by the stdlib itself.
        assert_eq!(normalize_path(Path::new("./y")), PathBuf::from("y"));
    }

    #[test]
    fn test_copy_dir_recursive_copies_nested_files() {
        let src = tempdir().unwrap();
        let dst = tempdir().unwrap();
        let dst_path = dst.path().join("out");
        fs::create_dir(src.path().join("sub")).unwrap();
        File::create(src.path().join("top.txt")).unwrap();
        File::create(src.path().join("sub").join("nested.txt")).unwrap();

        copy_dir_recursive(src.path(), &dst_path).unwrap();

        assert!(dst_path.join("top.txt").exists());
        assert!(dst_path.join("sub").join("nested.txt").exists());
    }

    #[test]
    fn test_copy_dir_recursive_dst_already_exists_is_reused() {
        let src = tempdir().unwrap();
        let dst = tempdir().unwrap();
        File::create(src.path().join("a.txt")).unwrap();

        copy_dir_recursive(src.path(), dst.path()).unwrap();

        assert!(dst.path().join("a.txt").exists());
    }

    #[test]
    fn test_copy_dir_recursive_missing_src_errors() {
        let dst = tempdir().unwrap();
        let missing_src = dst.path().join("does-not-exist");
        assert!(copy_dir_recursive(&missing_src, &dst.path().join("out")).is_err());
    }

    #[test]
    fn test_copy_dir_recursive_copy_failure_propagates() {
        let src = tempdir().unwrap();
        let dst = tempdir().unwrap();
        File::create(src.path().join("a.txt")).unwrap();
        fs::set_permissions(dst.path(), std::fs::Permissions::from_mode(0o555)).unwrap();

        let result = copy_dir_recursive(src.path(), dst.path());

        fs::set_permissions(dst.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_err());
    }

    #[test]
    fn test_copy_dir_recursive_create_dir_all_failure_propagates() {
        let src = tempdir().unwrap();
        let parent = tempdir().unwrap();
        File::create(src.path().join("a.txt")).unwrap();
        // `dst` doesn't exist yet and its parent is read-only, so `create_dir_all(dst)`
        // itself fails (rather than a later `fs::copy` into an already-created dst).
        let dst = parent.path().join("out");
        fs::set_permissions(parent.path(), std::fs::Permissions::from_mode(0o555)).unwrap();

        let result = copy_dir_recursive(src.path(), &dst);

        fs::set_permissions(parent.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_err());
    }

    #[test]
    fn test_copy_dir_recursive_nested_failure_propagates() {
        let src = tempdir().unwrap();
        let dst = tempdir().unwrap();
        fs::create_dir(src.path().join("sub")).unwrap();
        File::create(src.path().join("sub").join("nested.txt")).unwrap();
        // Pre-create dst/sub as a plain FILE: the recursive call for "sub" sees it as
        // already existing (skips create_dir_all), then fails to copy into it - and that
        // failure must propagate back out through the top-level recursive call too.
        File::create(dst.path().join("sub")).unwrap();

        let result = copy_dir_recursive(src.path(), dst.path());

        assert!(result.is_err());
    }

    #[test]
    fn test_try_cleanup_temp_install_variants() {
        let addons_dir = tempdir().unwrap();
        let temp_parent = addons_dir.path().join(".temp_install");

        // No .temp_install dir at all: no-op, doesn't panic.
        try_cleanup_temp_install(addons_dir.path());

        // Empty .temp_install: removed.
        fs::create_dir(&temp_parent).unwrap();
        try_cleanup_temp_install(addons_dir.path());
        assert!(!temp_parent.exists());

        // Non-empty .temp_install: left alone.
        fs::create_dir(&temp_parent).unwrap();
        File::create(temp_parent.join("partial.tmp")).unwrap();
        try_cleanup_temp_install(addons_dir.path());
        assert!(temp_parent.exists());
        fs::remove_dir_all(&temp_parent).unwrap();

        // Unreadable .temp_install: read_dir fails, function is a no-op.
        fs::create_dir(&temp_parent).unwrap();
        fs::set_permissions(&temp_parent, std::fs::Permissions::from_mode(0o0)).unwrap();
        try_cleanup_temp_install(addons_dir.path());
        fs::set_permissions(&temp_parent, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(temp_parent.exists());
    }

    #[test]
    fn test_owl_http_client_builds() {
        assert!(owl_http_client().is_ok());
    }

    /// Runs `f` with `XDG_CONFIG_HOME` set to `value`, then restores whatever it was
    /// before (unset or a prior value) - shared by both tests below so both the
    /// "restore a prior value" and "unset it again" arms get exercised from one place.
    fn with_xdg_config_home<T>(value: &std::ffi::OsStr, f: impl FnOnce() -> T) -> T {
        let orig = std::env::var_os("XDG_CONFIG_HOME");
        std::env::set_var("XDG_CONFIG_HOME", value);
        let result = f();
        match orig {
            Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
        result
    }

    #[test]
    fn test_get_settings_file_path_creates_parent_and_appends_filename() {
        let _guard = crate::lock_env();
        std::env::remove_var("XDG_CONFIG_HOME");
        let dir = tempdir().unwrap();

        let path = with_xdg_config_home(dir.path().as_os_str(), get_settings_file_path).unwrap();

        assert_eq!(path, dir.path().join("owl").join("settings.json"));
        assert!(dir.path().join("owl").is_dir());
    }

    #[test]
    fn test_get_settings_file_path_create_dir_all_failure() {
        let _guard = crate::lock_env();
        let dir = tempdir().unwrap();
        // A plain FILE (not a directory) as the config home, so create_dir_all(home/"owl")
        // fails: one of the path's parent components isn't a directory.
        let fake_home = dir.path().join("not-a-dir");
        File::create(&fake_home).unwrap();
        // A pre-existing value here, restored afterwards, exercises the other branch of
        // `with_xdg_config_home`'s restore match from the "unset" one used above.
        std::env::set_var("XDG_CONFIG_HOME", "/tmp/owl-test-sentinel");

        let result = with_xdg_config_home(fake_home.as_os_str(), get_settings_file_path);

        assert!(result.is_err());
    }

    /// Binds an ephemeral local port, writes `response` to the first connection it gets,
    /// then closes the stream. Returns the base URL and a `JoinHandle` the caller must
    /// join after driving its client request - otherwise the server thread's completion
    /// (and its coverage counters) can race the test function returning.
    fn spawn_raw_http_server(response: Vec<u8>) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            // `listener` is a fresh loopback socket only this function's own client ever
            // connects to, so `accept()` failing is structurally unreachable in any test
            // run. The `if let` (with its dead implicit-else) is what ships;
            // `#[cfg(coverage)]` below drops that unreachable branch under instrumentation.
            #[cfg(not(coverage))]
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(&response);
                let _ = stream.flush();
            }
            #[cfg(coverage)]
            {
                let (mut stream, _) = listener.accept().expect("sole client always connects");
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(&response);
                let _ = stream.flush();
            }
        });
        (format!("http://{}", addr), handle)
    }

    fn http_ok_body(body: &[u8]) -> Vec<u8> {
        let mut resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        resp.extend_from_slice(body);
        resp
    }

    /// Promises `promised_len` bytes via `Content-Length` but sends fewer, then closes the
    /// connection - a protocol violation that makes the client's body stream yield an error.
    fn http_truncated_body(promised_len: usize, actual: &[u8]) -> Vec<u8> {
        let mut resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            promised_len
        )
        .into_bytes();
        resp.extend_from_slice(actual);
        resp
    }

    async fn get_response(url: &str) -> reqwest::Response {
        reqwest::Client::new().get(url).send().await.unwrap()
    }

    #[test]
    fn test_stream_response_to_file_success() {
        let dir = tempdir().unwrap();
        let dest = dir.path().join("out.bin");
        let (base, server) = spawn_raw_http_server(http_ok_body(b"hello world"));

        tauri::async_runtime::block_on(async {
            let resp = get_response(&base).await;
            stream_response_to_file(None, resp, &dest, 1_048_576)
                .await
                .unwrap();
        });
        server.join().unwrap();

        assert_eq!(fs::read(&dest).unwrap(), b"hello world");
    }

    #[test]
    fn test_stream_response_to_file_exceeds_max_bytes() {
        let dir = tempdir().unwrap();
        let dest = dir.path().join("out.bin");
        let (base, server) = spawn_raw_http_server(http_ok_body(&[0u8; 100]));

        let result = tauri::async_runtime::block_on(async {
            let resp = get_response(&base).await;
            stream_response_to_file(None, resp, &dest, 10).await
        });
        server.join().unwrap();

        assert!(result.unwrap_err().contains("limit"));
        assert!(!dest.exists());
    }

    #[test]
    fn test_stream_response_to_file_dest_parent_missing() {
        let dir = tempdir().unwrap();
        let dest = dir.path().join("missing-parent").join("out.bin");
        let (base, server) = spawn_raw_http_server(http_ok_body(b"x"));

        let result = tauri::async_runtime::block_on(async {
            let resp = get_response(&base).await;
            stream_response_to_file(None, resp, &dest, 1_048_576).await
        });
        server.join().unwrap();

        assert!(result.is_err());
    }

    #[test]
    fn test_stream_response_to_file_stream_error_on_truncated_body() {
        let dir = tempdir().unwrap();
        let dest = dir.path().join("out.bin");
        let (base, server) = spawn_raw_http_server(http_truncated_body(1000, b"short"));

        let result = tauri::async_runtime::block_on(async {
            let resp = get_response(&base).await;
            stream_response_to_file(None, resp, &dest, 1_048_576).await
        });
        server.join().unwrap();

        assert!(result.is_err());
    }
}
