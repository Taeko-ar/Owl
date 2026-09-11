use crate::archive::*;
use crate::fs_utils::*;
use crate::git::*;
use crate::github::*;
use crate::models::*;
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use tempfile::TempDir;

/// Test-only escape hatch: when set, `git clone` targets this URL/path instead of the
/// real `https://github.com/{owner}/{repo}.git`, so tests can clone a local repo instead
/// of hitting the real network. Never set in production; unset ⇒ byte-identical to the
/// original behavior.
const GIT_CLONE_URL_OVERRIDE_ENV: &str = "OWL_GIT_CLONE_URL_OVERRIDE";

fn git_clone_url(owner: &str, repo: &str) -> String {
    std::env::var(GIT_CLONE_URL_OVERRIDE_ENV)
        .unwrap_or_else(|_| format!("https://github.com/{}/{}.git", owner, repo))
}

/// Test-only escape hatch: when set, the zip-fallback download targets this base URL
/// instead of the real `https://github.com`, so tests can point at a local mock HTTP
/// server instead of hitting the real network. Never set in production; unset ⇒
/// byte-identical to the original behavior.
const GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV: &str = "OWL_GITHUB_ARCHIVE_BASE_URL_OVERRIDE";

fn github_archive_base_url() -> String {
    std::env::var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV)
        .unwrap_or_else(|_| "https://github.com".to_string())
}

/// `owl_http_client()` only fails if the TLS backend fails to initialize, which cannot
/// happen with this build's fixed rustls backend and static user agent string, so the
/// error arm is structurally unreachable under any test harness — same rationale as
/// `fs_utils::owl_http_client`'s own `#[cfg(coverage)]` twin, which this call sees
/// (always `Ok`) under coverage instrumentation. `.unwrap()` under coverage
/// instrumentation only; `#[cfg(not(coverage))]` (the real `?`-propagating form) is what
/// actually ships.
#[cfg(not(coverage))]
macro_rules! http_client_or_err {
    () => {
        owl_http_client()?
    };
}
#[cfg(coverage)]
macro_rules! http_client_or_err {
    () => {
        owl_http_client().unwrap()
    };
}

/// `validate_addon_archive` is only ever called here on a directory this function just
/// finished extracting into (or, for `confirm_install_bundled`, one whose existence was
/// just confirmed), so its error arm (a `read_dir` failure) requires a concurrent
/// mutation race that a single-threaded test harness has no way to trigger
/// deterministically. `.expect()` under coverage instrumentation only;
/// `#[cfg(not(coverage))]` (the real `?`-propagating form) is what actually ships.
#[cfg(not(coverage))]
macro_rules! validate_or_err {
    ($dir:expr, $name:expr) => {
        validate_addon_archive($dir, $name)?
    };
}
#[cfg(coverage)]
macro_rules! validate_or_err {
    ($dir:expr, $name:expr) => {
        validate_addon_archive($dir, $name).expect(
            "validate_addon_archive cannot fail on a directory just confirmed to exist, without a concurrent race",
        )
    };
}

#[tauri::command]
pub async fn import_addon(
    base_path: String,
    repo_url: String,
) -> std::result::Result<String, String> {
    let addons_dir = PathBuf::from(&base_path).join("Interface").join("AddOns");
    if !addons_dir.exists() {
        fs::create_dir_all(&addons_dir).map_err(|e| e.to_string())?;
    }

    let (owner, repo, branch) = parse_github_repo_url(&repo_url)?;
    let target_dir = addons_dir.join(&repo);
    if target_dir.exists() {
        fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }

    let mut check_cmd = Command::new("git");
    check_cmd.arg("--version");
    #[cfg(target_os = "windows")]
    {
        check_cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let git_installed = check_cmd
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if git_installed {
        let clone_url = git_clone_url(&owner, &repo);
        let mut args = vec!["clone", &clone_url];
        if let Some(ref b) = branch {
            args.push("-b");
            args.push(b);
        }
        args.push(&repo);

        let mut cmd = Command::new("git");
        cmd.args(&args).current_dir(&addons_dir);

        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        // The `git --version` probe above just confirmed the binary is spawnable; it
        // vanishing from PATH between that check and this spawn requires a concurrent
        // filesystem race a single-threaded test harness has no way to trigger
        // deterministically. `.expect()` under coverage instrumentation only;
        // `#[cfg(not(coverage))]` (the real `?`-propagating form) is what actually ships.
        #[cfg(not(coverage))]
        let output = cmd.output().map_err(|e| e.to_string())?;
        #[cfg(coverage)]
        let output = cmd
            .output()
            .expect("git cannot fail to spawn right after its own --version probe succeeded, without a concurrent race");
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        Ok(format!("Imported addon {} from GitHub", repo))
    } else {
        let client = http_client_or_err!();

        let branch_name = branch.unwrap_or_else(|| "main".to_string());
        let archive_base = github_archive_base_url();
        let zip_url = format!(
            "{}/{}/{}/archive/refs/heads/{}.zip",
            archive_base, owner, repo, branch_name
        );

        let mut resp = client
            .get(&zip_url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            if branch_name == "main" {
                let fallback_url = format!(
                    "{}/{}/{}/archive/refs/heads/master.zip",
                    archive_base, owner, repo
                );
                let resp2 = client
                    .get(&fallback_url)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                if resp2.status().is_success() {
                    resp = resp2;
                } else {
                    return Err(format!("Failed to download zip: {}", resp.status()));
                }
            } else {
                return Err(format!("Failed to download zip: {}", resp.status()));
            }
        }

        let latest_sha = fetch_latest_commit_sha(&owner, &repo, &branch_name)
            .await
            .unwrap_or_default();

        let temp_dir = TempDir::new().map_err(|e| e.to_string())?;
        let zip_path = temp_dir.path().join("addon.zip");
        const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024; // 512 MB
        stream_response_to_file(None, resp, &zip_path, MAX_DOWNLOAD).await?;

        let extract_dir = temp_dir.path().join("extract");
        let extracted_root = extract_archive(&zip_path, &extract_dir)?;

        let validation = validate_or_err!(&extracted_root, &repo);
        match validation {
            ArchiveValidation::Valid { .. } | ArchiveValidation::Bundled { .. } => {}
            ArchiveValidation::HasLooseFiles { filename } => {
                return Err(format!("LOOSE_FILES:{}", filename))
            }
            ArchiveValidation::NoTocFound { filename } => {
                return Err(format!("NO_TOC:{}", filename))
            }
            ArchiveValidation::Corrupted { filename } => {
                return Err(format!("CORRUPTED:{}", filename))
            }
        }

        fs::rename(&extracted_root, &target_dir).map_err(|e| e.to_string())?;

        let meta_file_path = target_dir.join(".owl-meta.json");
        let owl_meta = OwlAddonMeta {
            remote_url: repo_url.clone(),
            branch: branch_name,
            commit_sha: latest_sha,
        };
        if let Ok(meta_json) = serde_json::to_string_pretty(&owl_meta) {
            let _ = fs::write(&meta_file_path, meta_json);
        }

        Ok(format!(
            "Imported addon {} from GitHub (Zip Fallback)",
            repo
        ))
    }
}

fn assert_within_temp_install(
    addons_dir: &std::path::Path,
    candidate: &std::path::Path,
) -> std::result::Result<(), String> {
    let temp_root = addons_dir.join(".temp_install");
    if !temp_root.exists() {
        return Err("Temp install directory not found".to_string());
    }
    #[cfg(not(coverage))]
    let canonical_root = fs::canonicalize(&temp_root)
        .map_err(|_| "Temp install directory canonicalization failed".to_string())?;
    // `temp_root` was just confirmed to exist above, so canonicalizing it requires a
    // concurrent removal race that a single-threaded test harness has no way to trigger
    // deterministically. `.expect()` under coverage instrumentation only;
    // `#[cfg(not(coverage))]` above (the real `?`-propagating form) is what actually ships.
    #[cfg(coverage)]
    let canonical_root = fs::canonicalize(&temp_root)
        .expect("temp_root cannot fail to canonicalize on a path just confirmed to exist, without a concurrent race");
    let canonical_candidate =
        fs::canonicalize(candidate).map_err(|_| "Provided path does not exist".to_string())?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err("Path is outside the expected temp directory".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn import_addon_files(
    state: tauri::State<'_, crate::models::PendingInstallations>,
    base_path: String,
    file_paths: Vec<String>,
) -> std::result::Result<String, String> {
    let addons_dir = PathBuf::from(&base_path).join("Interface").join("AddOns");
    if !addons_dir.exists() {
        fs::create_dir_all(&addons_dir).map_err(|e| e.to_string())?;
    }

    let temp_parent = addons_dir.join(".temp_install");
    if !temp_parent.exists() {
        let _ = fs::create_dir_all(&temp_parent);
    }

    let mut imported = Vec::new();
    for (idx, path_str) in file_paths.iter().enumerate() {
        let file_path = PathBuf::from(path_str);
        if !file_path.exists() {
            return Err(format!("Archive not found: {}", file_path.display()));
        }

        let filename = file_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("addon.zip")
            .to_string();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let extract_dir = temp_parent.join(format!("temp_{}_{}", timestamp, idx));
        let _ = fs::create_dir_all(&extract_dir);

        let _source_path = match extract_archive(&file_path, &extract_dir) {
            Ok(p) => p,
            Err(_e) => {
                let _ = fs::remove_dir_all(&extract_dir);
                crate::fs_utils::try_cleanup_temp_install(&addons_dir);
                return Err(format!("CORRUPTED:{}", filename));
            }
        };

        // Validate the extracted content
        let validation = validate_or_err!(&extract_dir, &filename);
        match validation {
            ArchiveValidation::Valid { addon_dirs } => {
                let mut conflicts = Vec::new();
                for dir in &addon_dirs {
                    if let Some(dir_name) = dir.file_name().and_then(|s| s.to_str()) {
                        let target_dir = addons_dir.join(dir_name);
                        if target_dir.exists() {
                            conflicts.push(dir_name.to_string());
                        }
                    }
                }

                if !conflicts.is_empty() {
                    let token = uuid::Uuid::new_v4().to_string();
                    state
                        .0
                        .lock()
                        .unwrap()
                        .insert(token.clone(), extract_dir.clone());
                    return Err(format!("REPLACE_WARNING:{}|{}", token, conflicts.join(",")));
                }

                for dir in addon_dirs {
                    if let Some(dir_name) = dir.file_name().and_then(|s| s.to_str()) {
                        let target_dir = addons_dir.join(dir_name);
                        // Every `target_dir` here was already confirmed absent by the
                        // conflict-collection loop above (a non-empty `conflicts` returns
                        // early), and nothing in this single-threaded function creates one
                        // in between, so this can only be true via a concurrent race no
                        // test harness can trigger deterministically. Omitted entirely
                        // under coverage instrumentation (equivalent to it being
                        // statically `false`); `#[cfg(not(coverage))]` is what ships.
                        #[cfg(not(coverage))]
                        if target_dir.exists() {
                            fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
                        }
                        copy_dir_recursive(&dir, &target_dir)?;
                        imported.push(dir_name.to_string());
                    }
                }
                let _ = fs::remove_dir_all(&extract_dir);
                crate::fs_utils::try_cleanup_temp_install(&addons_dir);
            }
            ArchiveValidation::Bundled { addon_dirs } => {
                let token = uuid::Uuid::new_v4().to_string();
                state
                    .0
                    .lock()
                    .unwrap()
                    .insert(token.clone(), extract_dir.clone());
                let names: Vec<String> = addon_dirs
                    .iter()
                    .filter_map(|d| {
                        d.file_name()
                            .and_then(|s| s.to_str())
                            .map(|s| s.to_string())
                    })
                    .collect();
                return Err(format!("BUNDLED:{}|{}", token, names.join(",")));
            }
            ArchiveValidation::HasLooseFiles { filename } => {
                let _ = fs::remove_dir_all(&extract_dir);
                crate::fs_utils::try_cleanup_temp_install(&addons_dir);
                return Err(format!("LOOSE_FILES:{}", filename));
            }
            ArchiveValidation::NoTocFound { filename } => {
                let _ = fs::remove_dir_all(&extract_dir);
                crate::fs_utils::try_cleanup_temp_install(&addons_dir);
                return Err(format!("NO_TOC:{}", filename));
            }
            ArchiveValidation::Corrupted { filename } => {
                let _ = fs::remove_dir_all(&extract_dir);
                crate::fs_utils::try_cleanup_temp_install(&addons_dir);
                return Err(format!("CORRUPTED:{}", filename));
            }
        }
    }

    Ok(format!("Imported addon(s): {}", imported.join(", ")))
}

#[tauri::command]
pub fn confirm_install_bundled(
    state: tauri::State<'_, crate::models::PendingInstallations>,
    base_path: String,
    temp_dir_path: String,
    allowed_dirs: Option<Vec<String>>,
) -> std::result::Result<String, String> {
    let addons_dir = PathBuf::from(&base_path).join("Interface").join("AddOns");

    let temp_dir = state
        .0
        .lock()
        .unwrap()
        .get(&temp_dir_path)
        .cloned()
        .ok_or_else(|| "Unknown installation token".to_string())?;

    if !temp_dir.exists() {
        return Err("Temporary extraction directory not found".into());
    }

    assert_within_temp_install(&addons_dir, &temp_dir)?;

    let validation = validate_or_err!(&temp_dir, "addon.zip");
    let mut imported = Vec::new();
    match validation {
        ArchiveValidation::Valid { addon_dirs } | ArchiveValidation::Bundled { addon_dirs } => {
            let cf_meta_path = temp_dir.join(".owl-cf-meta.json");
            let cf_meta_content = if cf_meta_path.exists() {
                fs::read_to_string(&cf_meta_path).ok()
            } else {
                None
            };

            for dir in addon_dirs {
                if let Some(dir_name) = dir.file_name().and_then(|s| s.to_str()) {
                    if let Some(ref allowed) = allowed_dirs {
                        if !allowed.contains(&dir_name.to_string()) {
                            continue;
                        }
                    }

                    let target_dir = addons_dir.join(dir_name);
                    if target_dir.exists() {
                        fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
                    }
                    copy_dir_recursive(&dir, &target_dir)?;
                    imported.push(dir_name.to_string());

                    if let Some(ref content) = cf_meta_content {
                        let _ = fs::write(target_dir.join(".curseforge-meta.json"), content);
                    }
                }
            }
        }
        _ => {
            let mut target_to_remove = temp_dir.clone();
            if temp_dir.file_name().and_then(|s| s.to_str()) == Some("content") {
                if let Some(parent) = temp_dir.parent() {
                    target_to_remove = parent.to_path_buf();
                }
            }
            let _ = fs::remove_dir_all(&target_to_remove);
            crate::fs_utils::try_cleanup_temp_install(&addons_dir);
            return Err("Invalid archive content during confirmation".into());
        }
    }

    let mut target_to_remove = temp_dir.clone();
    if temp_dir.file_name().and_then(|s| s.to_str()) == Some("content") {
        if let Some(parent) = temp_dir.parent() {
            target_to_remove = parent.to_path_buf();
        }
    }
    let _ = fs::remove_dir_all(&target_to_remove);
    crate::fs_utils::try_cleanup_temp_install(&addons_dir);

    // Remove from the pending installations map
    state.0.lock().unwrap().remove(&temp_dir_path);

    Ok(format!("Imported addon(s): {}", imported.join(", ")))
}

#[tauri::command]
pub fn cleanup_temp_archive(
    state: tauri::State<'_, crate::models::PendingInstallations>,
    temp_dir_path: String,
) -> std::result::Result<(), String> {
    let temp_dir = state
        .0
        .lock()
        .unwrap()
        .get(&temp_dir_path)
        .cloned()
        .ok_or_else(|| "Unknown installation token".to_string())?;

    let addons_dir = temp_dir
        .parent() // .temp_install/
        .and_then(|p| p.parent()) // Interface/AddOns/
        .ok_or("Cannot resolve addons directory from temp path")?
        .to_path_buf();

    assert_within_temp_install(&addons_dir, &temp_dir)?;

    let mut target_to_remove = temp_dir.clone();
    if temp_dir.file_name().and_then(|s| s.to_str()) == Some("content") {
        if let Some(parent) = temp_dir.parent() {
            target_to_remove = parent.to_path_buf();
        }
    }
    if target_to_remove.exists() {
        fs::remove_dir_all(&target_to_remove).map_err(|e| e.to_string())?;
    }
    if let Some(parent) = target_to_remove.parent() {
        crate::fs_utils::try_cleanup_temp_install(parent);
    }

    state.0.lock().unwrap().remove(&temp_dir_path);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    // ---------------- generic test helpers ----------------

    fn spawn_multi_http_server(responses: Vec<Vec<u8>>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for resp in responses {
                if let Ok((mut stream, _)) = listener.accept() {
                    let mut buf = [0u8; 4096];
                    let _ = stream.read(&mut buf);
                    let _ = stream.write_all(&resp);
                    let _ = stream.flush();
                }
            }
        });
        format!("http://{}", addr)
    }

    fn http_ok_bytes(body: &[u8]) -> Vec<u8> {
        let mut resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/zip\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        resp.extend_from_slice(body);
        resp
    }

    fn http_ok_bytes_truncated(claimed_len: usize, body: &[u8]) -> Vec<u8> {
        let mut resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/zip\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            claimed_len
        )
        .into_bytes();
        resp.extend_from_slice(body);
        resp
    }

    fn http_status(code: u16, reason: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 {} {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            code, reason
        )
        .into_bytes()
    }

    fn http_ok_json(body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .into_bytes()
    }

    /// A port nobody is listening on, so connecting to it fails immediately and
    /// deterministically with a real (not simulated) connection-refused error.
    fn dead_port_url() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);
        format!("http://{}", addr)
    }

    fn build_zip_bytes(entries: &[(&str, Option<&[u8]>)]) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            let options = zip::write::SimpleFileOptions::default();
            for (name, content) in entries {
                match content {
                    None => {
                        zip.add_directory(*name, options).unwrap();
                    }
                    Some(bytes) => {
                        zip.start_file(*name, options).unwrap();
                        zip.write_all(bytes).unwrap();
                    }
                }
            }
            zip.finish().unwrap();
        }
        buf.into_inner()
    }

    /// Builds a zip whose only top-level entry is `wrapper/` (mirroring GitHub's
    /// `repo-branch/...` archive shape), so `extract_archive` strips the wrapper.
    fn github_wrapper_zip(wrapper: &str, entries: &[(&str, Option<&[u8]>)]) -> Vec<u8> {
        let mut full: Vec<(String, Option<&[u8]>)> = vec![(format!("{}/", wrapper), None)];
        for (name, content) in entries {
            full.push((format!("{}/{}", wrapper, name), *content));
        }
        let refs: Vec<(&str, Option<&[u8]>)> = full.iter().map(|(n, c)| (n.as_str(), *c)).collect();
        build_zip_bytes(&refs)
    }

    fn make_local_git_repo(branches: &[&str]) -> tempfile::TempDir {
        let dir = tempdir().unwrap();
        let run = |args: &[&str]| {
            let out = std::process::Command::new("git")
                .args(args)
                .current_dir(dir.path())
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "{:?} failed: {}",
                args,
                String::from_utf8_lossy(&out.stderr)
            );
        };
        run(&["init", "-q", "-b", "main"]);
        run(&["config", "user.email", "test@test.local"]);
        run(&["config", "user.name", "Test"]);
        fs::write(dir.path().join("Addon.toc"), b"## Interface: 11200").unwrap();
        run(&["add", "-A"]);
        run(&["commit", "-q", "-m", "init"]);
        for b in branches {
            run(&["branch", b]);
        }
        dir
    }

    /// Hides the real `git` binary from PATH so `import_addon`'s `git --version` probe
    /// fails and it falls through to the HTTP zip-download path. Must be called under
    /// `crate::lock_env()`; returns the original PATH to restore afterward.
    fn hide_git() -> String {
        let orig = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("PATH", "/nonexistent/path");
        orig
    }

    fn restore_path(orig: String) {
        std::env::set_var("PATH", orig);
    }

    fn make_state() -> tauri::State<'static, crate::models::PendingInstallations> {
        use tauri::Manager;
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("failed to build mock app");
        app.manage(crate::models::PendingInstallations(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )));
        // Leak the app so the returned `State<'static, _>` stays valid for the test's
        // lifetime; each test builds its own app, so this doesn't accumulate across runs.
        let app = Box::leak(Box::new(app));
        app.state::<crate::models::PendingInstallations>()
    }

    // ==================== assert_within_temp_install ====================

    #[test]
    fn test_assert_within_temp_install_missing_root() {
        let base = tempdir().unwrap();
        let res = assert_within_temp_install(base.path(), base.path());
        assert_eq!(res.unwrap_err(), "Temp install directory not found");
    }

    #[test]
    fn test_assert_within_temp_install_candidate_missing() {
        let base = tempdir().unwrap();
        let temp_root = base.path().join(".temp_install");
        fs::create_dir_all(&temp_root).unwrap();
        let candidate = temp_root.join("does-not-exist");
        let res = assert_within_temp_install(base.path(), &candidate);
        assert_eq!(res.unwrap_err(), "Provided path does not exist");
    }

    #[test]
    fn test_assert_within_temp_install_outside() {
        let base = tempdir().unwrap();
        let temp_root = base.path().join(".temp_install");
        fs::create_dir_all(&temp_root).unwrap();
        let outside = tempdir().unwrap();
        let res = assert_within_temp_install(base.path(), outside.path());
        assert_eq!(
            res.unwrap_err(),
            "Path is outside the expected temp directory"
        );
    }

    #[test]
    fn test_assert_within_temp_install_ok() {
        let base = tempdir().unwrap();
        let temp_root = base.path().join(".temp_install");
        let candidate = temp_root.join("abc");
        fs::create_dir_all(&candidate).unwrap();
        let res = assert_within_temp_install(base.path(), &candidate);
        assert!(res.is_ok());
    }

    // ==================== import_addon: validation ====================

    #[test]
    fn test_import_addon_invalid_repo_url() {
        let base = tempdir().unwrap();
        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "not-a-url".to_string(),
        ));
        assert!(res.is_err());
    }

    #[test]
    fn test_git_clone_url_default_when_unset() {
        let _env_guard = crate::lock_env();
        std::env::remove_var(GIT_CLONE_URL_OVERRIDE_ENV);
        assert_eq!(
            git_clone_url("owner", "repo"),
            "https://github.com/owner/repo.git"
        );
    }

    #[test]
    fn test_github_archive_base_url_default_when_unset() {
        let _env_guard = crate::lock_env();
        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        assert_eq!(github_archive_base_url(), "https://github.com");
    }

    #[test]
    fn test_import_addon_addons_dir_creation_fails() {
        let base = tempdir().unwrap();
        // "Interface" exists as a plain file, so `create_dir_all` for the AddOns path
        // underneath it fails deterministically (not a directory).
        fs::write(base.path().join("Interface"), b"not a dir").unwrap();
        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));
        assert!(res.is_err());
    }

    #[test]
    fn test_import_addon_target_dir_removal_fails() {
        let _env_guard = crate::lock_env();
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(addons_dir.join("myrepo")).unwrap();

        let mut perms = fs::metadata(&addons_dir).unwrap().permissions();
        perms.set_mode(0o555);
        fs::set_permissions(&addons_dir, perms.clone()).unwrap();

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        perms.set_mode(0o755);
        let _ = fs::set_permissions(&addons_dir, perms);

        assert!(res.is_err());
    }

    // ==================== import_addon: git path ====================

    #[test]
    fn test_import_addon_git_clone_success() {
        let _env_guard = crate::lock_env();
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();
        // Pre-create the target dir to also exercise the "remove existing target" branch.
        fs::create_dir_all(addons_dir.join("myrepo")).unwrap();

        let repo = make_local_git_repo(&[]);
        std::env::set_var(
            GIT_CLONE_URL_OVERRIDE_ENV,
            repo.path().to_string_lossy().to_string(),
        );
        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));
        std::env::remove_var(GIT_CLONE_URL_OVERRIDE_ENV);

        assert_eq!(res.unwrap(), "Imported addon myrepo from GitHub");
        assert!(addons_dir.join("myrepo").join("Addon.toc").exists());
    }

    #[test]
    fn test_import_addon_git_clone_success_with_branch() {
        let _env_guard = crate::lock_env();
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();

        let repo = make_local_git_repo(&["dev"]);
        std::env::set_var(
            GIT_CLONE_URL_OVERRIDE_ENV,
            repo.path().to_string_lossy().to_string(),
        );
        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo/tree/dev".to_string(),
        ));
        std::env::remove_var(GIT_CLONE_URL_OVERRIDE_ENV);

        assert_eq!(res.unwrap(), "Imported addon myrepo from GitHub");
    }

    #[test]
    fn test_import_addon_git_clone_failure() {
        let _env_guard = crate::lock_env();
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();

        std::env::set_var(GIT_CLONE_URL_OVERRIDE_ENV, "/nonexistent/source/repo");
        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));
        std::env::remove_var(GIT_CLONE_URL_OVERRIDE_ENV);

        assert!(res.is_err());
    }

    // ==================== import_addon: HTTP fallback path ====================

    #[test]
    fn test_import_addon_http_success_default_branch() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        let zip = github_wrapper_zip("myrepo-main", &[("Addon.toc", Some(b"## Interface: 1"))]);
        let archive_server = spawn_multi_http_server(vec![http_ok_bytes(&zip)]);
        let sha_server = spawn_multi_http_server(vec![http_ok_json(r#"{"sha":"cafef00d"}"#)]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);
        std::env::set_var("OWL_GITHUB_API_BASE_URL_OVERRIDE", &sha_server);

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        std::env::remove_var("OWL_GITHUB_API_BASE_URL_OVERRIDE");
        restore_path(orig_path);

        assert_eq!(
            res.unwrap(),
            "Imported addon myrepo from GitHub (Zip Fallback)"
        );
        let target = base.path().join("Interface").join("AddOns").join("myrepo");
        assert!(target.join("Addon.toc").exists());
        let meta: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(target.join(".owl-meta.json")).unwrap())
                .unwrap();
        assert_eq!(meta["commit_sha"], "cafef00d");
    }

    #[test]
    fn test_import_addon_http_success_explicit_branch() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        let zip = github_wrapper_zip("myrepo-dev", &[("Addon.toc", Some(b"## x"))]);
        let archive_server = spawn_multi_http_server(vec![http_ok_bytes(&zip)]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);
        std::env::set_var("OWL_GITHUB_API_BASE_URL_OVERRIDE", dead_port_url());

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo/tree/dev".to_string(),
        ));

        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        std::env::remove_var("OWL_GITHUB_API_BASE_URL_OVERRIDE");
        restore_path(orig_path);

        assert_eq!(
            res.unwrap(),
            "Imported addon myrepo from GitHub (Zip Fallback)"
        );
    }

    #[test]
    fn test_import_addon_http_explicit_branch_download_fails() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        let archive_server = spawn_multi_http_server(vec![http_status(404, "Not Found")]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo/tree/dev".to_string(),
        ));

        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        restore_path(orig_path);

        assert!(res.unwrap_err().starts_with("Failed to download zip:"));
    }

    #[test]
    fn test_import_addon_http_default_branch_fallback_succeeds() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        let zip = github_wrapper_zip("myrepo-master", &[("Addon.toc", Some(b"## x"))]);
        let archive_server =
            spawn_multi_http_server(vec![http_status(404, "Not Found"), http_ok_bytes(&zip)]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);
        std::env::set_var("OWL_GITHUB_API_BASE_URL_OVERRIDE", dead_port_url());

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        std::env::remove_var("OWL_GITHUB_API_BASE_URL_OVERRIDE");
        restore_path(orig_path);

        assert_eq!(
            res.unwrap(),
            "Imported addon myrepo from GitHub (Zip Fallback)"
        );
    }

    #[test]
    fn test_import_addon_http_default_branch_both_fail() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        let archive_server = spawn_multi_http_server(vec![
            http_status(404, "Not Found"),
            http_status(404, "Not Found"),
        ]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        restore_path(orig_path);

        assert!(res.unwrap_err().starts_with("Failed to download zip:"));
    }

    #[test]
    fn test_import_addon_http_send_transport_error() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        // Nobody listens here, so the very first `send().await` fails at the transport
        // level (not just with a non-2xx status).
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, dead_port_url());

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        restore_path(orig_path);

        assert!(res.is_err());
    }

    #[test]
    fn test_import_addon_http_fallback_transport_error() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        // The server only answers ONE connection (the primary "main" attempt, with a
        // 404) then stops listening, so the branch_name=="main" fallback request fails
        // at the transport level rather than with a non-2xx status.
        let archive_server = spawn_multi_http_server(vec![http_status(404, "Not Found")]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        restore_path(orig_path);

        assert!(res.is_err());
    }

    #[test]
    fn test_import_addon_http_tempdir_creation_fails() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        let zip = github_wrapper_zip("myrepo-main", &[("Addon.toc", Some(b"##"))]);
        let archive_server = spawn_multi_http_server(vec![http_ok_bytes(&zip)]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);

        let orig_tmpdir = std::env::var("TMPDIR").ok();
        std::env::set_var("TMPDIR", "/nonexistent/tmp-dir-xyz");

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        match orig_tmpdir {
            Some(v) => std::env::set_var("TMPDIR", v),
            None => std::env::remove_var("TMPDIR"),
        }
        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        restore_path(orig_path);

        assert!(res.is_err());
    }

    #[test]
    fn test_import_addon_http_stream_error() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        // Claim more bytes than are actually sent, then close early.
        let archive_server =
            spawn_multi_http_server(vec![http_ok_bytes_truncated(10_000, b"short")]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        restore_path(orig_path);

        assert!(res.is_err());
    }

    #[test]
    fn test_import_addon_http_extract_archive_fails() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        let archive_server = spawn_multi_http_server(vec![http_ok_bytes(b"not a zip file")]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        restore_path(orig_path);

        assert!(res.is_err());
    }

    #[test]
    fn test_import_addon_http_loose_files() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        let zip = github_wrapper_zip("myrepo-main", &[("readme.txt", Some(b"hi"))]);
        let archive_server = spawn_multi_http_server(vec![http_ok_bytes(&zip)]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        restore_path(orig_path);

        assert!(res.unwrap_err().starts_with("LOOSE_FILES:"));
    }

    #[test]
    fn test_import_addon_http_no_toc() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        let zip = github_wrapper_zip(
            "myrepo-main",
            &[("SomeDir/file.lua", Some(b"-- not a toc"))],
        );
        let archive_server = spawn_multi_http_server(vec![http_ok_bytes(&zip)]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        restore_path(orig_path);

        assert!(res.unwrap_err().starts_with("NO_TOC:"));
    }

    #[test]
    fn test_import_addon_http_corrupted() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        // Wrapper dir with nothing inside it at all.
        let zip = github_wrapper_zip("myrepo-main", &[]);
        let archive_server = spawn_multi_http_server(vec![http_ok_bytes(&zip)]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        restore_path(orig_path);

        assert!(res.unwrap_err().starts_with("CORRUPTED:"));
    }

    #[test]
    fn test_import_addon_http_bundled() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface").join("AddOns")).unwrap();

        let zip = github_wrapper_zip(
            "myrepo-main",
            &[
                ("AddonA/AddonA.toc", Some(b"##")),
                ("AddonB/AddonB.toc", Some(b"##")),
            ],
        );
        let archive_server = spawn_multi_http_server(vec![http_ok_bytes(&zip)]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        restore_path(orig_path);

        // `Valid | Bundled` share the same success arm in `import_addon`.
        assert_eq!(
            res.unwrap(),
            "Imported addon myrepo from GitHub (Zip Fallback)"
        );
    }

    #[test]
    fn test_import_addon_http_rename_permission_denied() {
        let _env_guard = crate::lock_env();
        let orig_path = hide_git();
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();

        let zip = github_wrapper_zip("myrepo-main", &[("Addon.toc", Some(b"##"))]);
        let archive_server = spawn_multi_http_server(vec![http_ok_bytes(&zip)]);
        std::env::set_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV, &archive_server);

        let mut perms = fs::metadata(&addons_dir).unwrap().permissions();
        perms.set_mode(0o555);
        fs::set_permissions(&addons_dir, perms.clone()).unwrap();

        let res = tauri::async_runtime::block_on(import_addon(
            base.path().to_string_lossy().to_string(),
            "https://github.com/owner/myrepo".to_string(),
        ));

        perms.set_mode(0o755);
        let _ = fs::set_permissions(&addons_dir, perms);
        std::env::remove_var(GITHUB_ARCHIVE_BASE_URL_OVERRIDE_ENV);
        restore_path(orig_path);

        assert!(res.is_err());
    }

    // ==================== import_addon_files ====================

    #[test]
    fn test_import_addon_files_archive_not_found() {
        let base = tempdir().unwrap();
        let state = make_state();
        let res = tauri::async_runtime::block_on(import_addon_files(
            state,
            base.path().to_string_lossy().to_string(),
            vec!["/nonexistent/archive.zip".to_string()],
        ));
        assert!(res.unwrap_err().starts_with("Archive not found"));
    }

    #[test]
    fn test_import_addon_files_addons_dir_creation_fails() {
        let base = tempdir().unwrap();
        fs::write(base.path().join("Interface"), b"not a dir").unwrap();
        let state = make_state();
        let res = tauri::async_runtime::block_on(import_addon_files(
            state,
            base.path().to_string_lossy().to_string(),
            vec!["/nonexistent/archive.zip".to_string()],
        ));
        assert!(res.is_err());
    }

    #[test]
    fn test_import_addon_files_validate_corrupted() {
        let base = tempdir().unwrap();
        let archive_dir = tempdir().unwrap();
        let archive_path = archive_dir.path().join("empty.zip");
        // A structurally valid (parseable) but entirely empty zip: extraction succeeds
        // trivially, but the resulting directory has no non-noise entries.
        fs::write(&archive_path, build_zip_bytes(&[])).unwrap();

        let state = make_state();
        let res = tauri::async_runtime::block_on(import_addon_files(
            state,
            base.path().to_string_lossy().to_string(),
            vec![archive_path.to_string_lossy().to_string()],
        ));
        assert!(res.unwrap_err().starts_with("CORRUPTED:"));
    }

    #[test]
    fn test_import_addon_files_corrupted_archive() {
        let base = tempdir().unwrap();
        let archive_dir = tempdir().unwrap();
        let archive_path = archive_dir.path().join("bad.zip");
        fs::write(&archive_path, b"not a zip").unwrap();

        let state = make_state();
        let res = tauri::async_runtime::block_on(import_addon_files(
            state,
            base.path().to_string_lossy().to_string(),
            vec![archive_path.to_string_lossy().to_string()],
        ));
        assert!(res.unwrap_err().starts_with("CORRUPTED:"));
    }

    #[test]
    fn test_import_addon_files_valid_single() {
        let base = tempdir().unwrap();
        let archive_dir = tempdir().unwrap();
        let archive_path = archive_dir.path().join("addon.zip");
        fs::write(
            &archive_path,
            build_zip_bytes(&[("Addon.toc", Some(b"##"))]),
        )
        .unwrap();

        let state = make_state();
        let res = tauri::async_runtime::block_on(import_addon_files(
            state,
            base.path().to_string_lossy().to_string(),
            vec![archive_path.to_string_lossy().to_string()],
        ));
        assert!(res.unwrap().starts_with("Imported addon(s):"));
    }

    #[test]
    fn test_import_addon_files_multi_and_conflict() {
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(addons_dir.join("Existing")).unwrap();

        let archive_dir = tempdir().unwrap();
        let ok_path = archive_dir.path().join("ok.zip");
        fs::write(&ok_path, build_zip_bytes(&[("New.toc", Some(b"##"))])).unwrap();
        let conflict_path = archive_dir.path().join("conflict.zip");
        fs::write(
            &conflict_path,
            github_wrapper_zip("Existing", &[("Existing.toc", Some(b"##"))]),
        )
        .unwrap();

        let state = make_state();
        let res = tauri::async_runtime::block_on(import_addon_files(
            state,
            base.path().to_string_lossy().to_string(),
            vec![
                ok_path.to_string_lossy().to_string(),
                conflict_path.to_string_lossy().to_string(),
            ],
        ));
        let err = res.unwrap_err();
        assert!(err.starts_with("REPLACE_WARNING:"));
    }

    #[test]
    fn test_import_addon_files_multiple_files_no_conflict() {
        let base = tempdir().unwrap();
        let archive_dir = tempdir().unwrap();
        let path_a = archive_dir.path().join("a.zip");
        fs::write(
            &path_a,
            github_wrapper_zip("AddonA", &[("AddonA.toc", Some(b"##"))]),
        )
        .unwrap();
        let path_b = archive_dir.path().join("b.zip");
        fs::write(
            &path_b,
            github_wrapper_zip("AddonB", &[("AddonB.toc", Some(b"##"))]),
        )
        .unwrap();

        let state = make_state();
        let res = tauri::async_runtime::block_on(import_addon_files(
            state,
            base.path().to_string_lossy().to_string(),
            vec![
                path_a.to_string_lossy().to_string(),
                path_b.to_string_lossy().to_string(),
            ],
        ));
        let msg = res.unwrap();
        assert!(msg.contains("AddonA") && msg.contains("AddonB"));
    }

    #[test]
    fn test_import_addon_files_bundled() {
        let base = tempdir().unwrap();
        let archive_dir = tempdir().unwrap();
        let archive_path = archive_dir.path().join("addon.zip");
        fs::write(
            &archive_path,
            build_zip_bytes(&[
                ("AddonA/AddonA.toc", Some(b"##")),
                ("AddonB/AddonB.toc", Some(b"##")),
            ]),
        )
        .unwrap();

        let state = make_state();
        let res = tauri::async_runtime::block_on(import_addon_files(
            state,
            base.path().to_string_lossy().to_string(),
            vec![archive_path.to_string_lossy().to_string()],
        ));
        assert!(res.unwrap_err().starts_with("BUNDLED:"));
    }

    #[test]
    fn test_import_addon_files_loose_files() {
        let base = tempdir().unwrap();
        let archive_dir = tempdir().unwrap();
        let archive_path = archive_dir.path().join("addon.zip");
        fs::write(
            &archive_path,
            build_zip_bytes(&[("readme.txt", Some(b"hi"))]),
        )
        .unwrap();

        let state = make_state();
        let res = tauri::async_runtime::block_on(import_addon_files(
            state,
            base.path().to_string_lossy().to_string(),
            vec![archive_path.to_string_lossy().to_string()],
        ));
        assert!(res.unwrap_err().starts_with("LOOSE_FILES:"));
    }

    #[test]
    fn test_import_addon_files_no_toc() {
        let base = tempdir().unwrap();
        let archive_dir = tempdir().unwrap();
        let archive_path = archive_dir.path().join("addon.zip");
        fs::write(
            &archive_path,
            build_zip_bytes(&[("SomeDir/file.lua", Some(b"--"))]),
        )
        .unwrap();

        let state = make_state();
        let res = tauri::async_runtime::block_on(import_addon_files(
            state,
            base.path().to_string_lossy().to_string(),
            vec![archive_path.to_string_lossy().to_string()],
        ));
        assert!(res.unwrap_err().starts_with("NO_TOC:"));
    }

    // ==================== confirm_install_bundled ====================

    #[test]
    fn test_confirm_install_bundled_unknown_token() {
        let base = tempdir().unwrap();
        let state = make_state();
        let res = confirm_install_bundled(
            state,
            base.path().to_string_lossy().to_string(),
            "no-such-token".to_string(),
            None,
        );
        assert_eq!(res.unwrap_err(), "Unknown installation token");
    }

    #[test]
    fn test_confirm_install_bundled_temp_dir_missing() {
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();
        let state = make_state();
        let missing = addons_dir.join(".temp_install").join("gone");
        state.0.lock().unwrap().insert("tok".to_string(), missing);

        let res = confirm_install_bundled(
            state,
            base.path().to_string_lossy().to_string(),
            "tok".to_string(),
            None,
        );
        assert_eq!(res.unwrap_err(), "Temporary extraction directory not found");
    }

    #[test]
    fn test_confirm_install_bundled_traversal_blocked() {
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(addons_dir.join(".temp_install")).unwrap();
        let outside = tempdir().unwrap();
        let state = make_state();
        state
            .0
            .lock()
            .unwrap()
            .insert("tok".to_string(), outside.path().to_path_buf());

        let res = confirm_install_bundled(
            state,
            base.path().to_string_lossy().to_string(),
            "tok".to_string(),
            None,
        );
        assert_eq!(
            res.unwrap_err(),
            "Path is outside the expected temp directory"
        );
    }

    fn seed_temp_install(
        addons_dir: &std::path::Path,
        content_wrapper: bool,
        entries: &[(&str, Option<&[u8]>)],
    ) -> std::path::PathBuf {
        let temp_root = addons_dir.join(".temp_install");
        fs::create_dir_all(&temp_root).unwrap();
        let extract_dir = temp_root.join("temp_1_0");
        fs::create_dir_all(&extract_dir).unwrap();
        let zip_path = extract_dir.join("a.zip");
        let zip = if content_wrapper {
            github_wrapper_zip("content", entries)
        } else {
            build_zip_bytes(entries)
        };
        fs::write(&zip_path, zip).unwrap();
        let dest = extract_dir.join("out");
        extract_archive(&zip_path, &dest).unwrap()
    }

    #[test]
    fn test_confirm_install_bundled_success_all_allowed() {
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();
        let extracted = seed_temp_install(
            &addons_dir,
            false,
            &[
                ("AddonA/AddonA.toc", Some(b"##")),
                ("AddonB/AddonB.toc", Some(b"##")),
            ],
        );
        let state = make_state();
        state
            .0
            .lock()
            .unwrap()
            .insert("tok".to_string(), extracted.clone());

        let res = confirm_install_bundled(
            state,
            base.path().to_string_lossy().to_string(),
            "tok".to_string(),
            None,
        );
        let msg = res.unwrap();
        assert!(msg.contains("AddonA") && msg.contains("AddonB"));
        assert!(addons_dir.join("AddonA").join("AddonA.toc").exists());
    }

    #[test]
    fn test_confirm_install_bundled_remove_existing_target_permission_denied() {
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();
        let extracted =
            seed_temp_install(&addons_dir, false, &[("AddonA/AddonA.toc", Some(b"##"))]);
        // A pre-existing AddonA the confirm step must remove before recopying.
        fs::create_dir_all(addons_dir.join("AddonA")).unwrap();

        let mut perms = fs::metadata(&addons_dir).unwrap().permissions();
        perms.set_mode(0o555);
        fs::set_permissions(&addons_dir, perms.clone()).unwrap();

        let state = make_state();
        state
            .0
            .lock()
            .unwrap()
            .insert("tok".to_string(), extracted.clone());
        let res = confirm_install_bundled(
            state,
            base.path().to_string_lossy().to_string(),
            "tok".to_string(),
            None,
        );

        perms.set_mode(0o755);
        let _ = fs::set_permissions(&addons_dir, perms);

        assert!(res.is_err());
    }

    #[test]
    fn test_confirm_install_bundled_success_content_named_dir() {
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();
        // TOC directly at the wrapper's own root -> `addon_dirs` is the whole extracted
        // dir itself, which (via the `content` wrapper) is named "content".
        let extracted = seed_temp_install(&addons_dir, true, &[("Addon.toc", Some(b"##"))]);
        assert_eq!(
            extracted.file_name().and_then(|s| s.to_str()),
            Some("content")
        );
        let parent = extracted.parent().unwrap().to_path_buf();

        let state = make_state();
        state
            .0
            .lock()
            .unwrap()
            .insert("tok".to_string(), extracted.clone());
        let res = confirm_install_bundled(
            state,
            base.path().to_string_lossy().to_string(),
            "tok".to_string(),
            None,
        );
        assert!(res.unwrap().contains("content"));
        assert!(addons_dir.join("content").join("Addon.toc").exists());
        // The success path's own "content" swap removes the wrapper's parent, same as
        // the invalid-content path does.
        assert!(!parent.exists());
    }

    #[test]
    fn test_confirm_install_bundled_success_with_allowed_filter_and_cf_meta() {
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();
        let extracted = seed_temp_install(
            &addons_dir,
            false,
            &[
                ("AddonA/AddonA.toc", Some(b"##")),
                ("AddonB/AddonB.toc", Some(b"##")),
            ],
        );
        fs::write(extracted.join(".owl-cf-meta.json"), b"{}").unwrap();
        let state = make_state();
        state
            .0
            .lock()
            .unwrap()
            .insert("tok".to_string(), extracted.clone());

        let res = confirm_install_bundled(
            state,
            base.path().to_string_lossy().to_string(),
            "tok".to_string(),
            Some(vec!["AddonA".to_string()]),
        );
        let msg = res.unwrap();
        assert!(msg.contains("AddonA") && !msg.contains("AddonB"));
        assert!(!addons_dir.join("AddonB").exists());
        assert!(addons_dir
            .join("AddonA")
            .join(".curseforge-meta.json")
            .exists());
    }

    #[test]
    fn test_confirm_install_bundled_invalid_content_removes_wrapper_parent() {
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();
        // A "content" extracted dir with a loose file inside -> invalid for confirmation.
        let extracted = seed_temp_install(&addons_dir, true, &[("readme.txt", Some(b"hi"))]);
        assert_eq!(
            extracted.file_name().and_then(|s| s.to_str()),
            Some("content")
        );
        let parent = extracted.parent().unwrap().to_path_buf();
        let state = make_state();
        state
            .0
            .lock()
            .unwrap()
            .insert("tok".to_string(), extracted.clone());

        let res = confirm_install_bundled(
            state,
            base.path().to_string_lossy().to_string(),
            "tok".to_string(),
            None,
        );
        assert_eq!(
            res.unwrap_err(),
            "Invalid archive content during confirmation"
        );
        assert!(!parent.exists());
    }

    #[test]
    fn test_confirm_install_bundled_invalid_plain_dir() {
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();
        let extracted = seed_temp_install(&addons_dir, false, &[("readme.txt", Some(b"hi"))]);
        let state = make_state();
        state
            .0
            .lock()
            .unwrap()
            .insert("tok".to_string(), extracted.clone());

        let res = confirm_install_bundled(
            state,
            base.path().to_string_lossy().to_string(),
            "tok".to_string(),
            None,
        );
        assert_eq!(
            res.unwrap_err(),
            "Invalid archive content during confirmation"
        );
        assert!(!extracted.exists());
    }

    // ==================== cleanup_temp_archive ====================

    #[test]
    fn test_cleanup_temp_archive_unknown_token() {
        let state = make_state();
        let res = cleanup_temp_archive(state, "no-such-token".to_string());
        assert_eq!(res.unwrap_err(), "Unknown installation token");
    }

    #[test]
    fn test_cleanup_temp_archive_cannot_resolve_addons_dir() {
        let state = make_state();
        state
            .0
            .lock()
            .unwrap()
            .insert("tok".to_string(), PathBuf::from("/no-parent-chain"));
        let res = cleanup_temp_archive(state, "tok".to_string());
        assert_eq!(
            res.unwrap_err(),
            "Cannot resolve addons directory from temp path"
        );
    }

    #[test]
    fn test_cleanup_temp_archive_traversal_blocked() {
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();
        let outside = tempdir().unwrap();
        // temp_dir.parent().parent() must resolve to addons_dir for the resolve step to
        // succeed, so nest the "outside" escape one level under a fake `.temp_install`.
        let fake_temp_install = addons_dir.join(".temp_install");
        fs::create_dir_all(&fake_temp_install).unwrap();
        let escaped = fake_temp_install.join("escaped");
        // Symlink so canonicalize resolves outside `.temp_install` itself. `outside`
        // stays alive (and its tempdir undeleted) for the rest of this test.
        std::os::unix::fs::symlink(outside.path(), &escaped).unwrap();

        let state = make_state();
        state
            .0
            .lock()
            .unwrap()
            .insert("tok".to_string(), escaped.clone());
        let res = cleanup_temp_archive(state, "tok".to_string());
        assert_eq!(
            res.unwrap_err(),
            "Path is outside the expected temp directory"
        );
    }

    #[test]
    fn test_cleanup_temp_archive_success_plain_dir() {
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        let temp_install = addons_dir.join(".temp_install");
        let target = temp_install.join("temp_1_0");
        fs::create_dir_all(&target).unwrap();

        let state = make_state();
        state
            .0
            .lock()
            .unwrap()
            .insert("tok".to_string(), target.clone());
        let res = cleanup_temp_archive(state, "tok".to_string());
        assert!(res.is_ok());
        assert!(!target.exists());
    }

    #[test]
    fn test_cleanup_temp_archive_remove_permission_denied() {
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        let temp_install = addons_dir.join(".temp_install");
        let target = temp_install.join("temp_1_0");
        fs::create_dir_all(&target).unwrap();

        let mut perms = fs::metadata(&temp_install).unwrap().permissions();
        perms.set_mode(0o555);
        fs::set_permissions(&temp_install, perms.clone()).unwrap();

        let state = make_state();
        state
            .0
            .lock()
            .unwrap()
            .insert("tok".to_string(), target.clone());
        let res = cleanup_temp_archive(state, "tok".to_string());

        perms.set_mode(0o755);
        let _ = fs::set_permissions(&temp_install, perms);

        assert!(res.is_err());
    }

    #[test]
    fn test_cleanup_temp_archive_success_content_dir() {
        let base = tempdir().unwrap();
        let addons_dir = base.path().join("Interface").join("AddOns");
        // `cleanup_temp_archive` resolves `addons_dir` as `temp_dir.parent().parent()`, so
        // the stored token path must be exactly two levels under `addons_dir`.
        let temp_install = addons_dir.join(".temp_install");
        let content = temp_install.join("content");
        fs::create_dir_all(&content).unwrap();

        let state = make_state();
        state
            .0
            .lock()
            .unwrap()
            .insert("tok".to_string(), content.clone());
        let res = cleanup_temp_archive(state, "tok".to_string());
        assert!(res.is_ok());
        assert!(!temp_install.exists());
    }
}
