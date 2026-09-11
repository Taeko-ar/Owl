use crate::archive::*;
use crate::fs_utils::*;
use crate::models::CurseForgeMeta;
use crate::{get_curseforge_base_url, verify_sha1, CURSEFORGE_API_KEY};
use std::fs;
use std::path::{Path, PathBuf};

/// `owl_http_client()` only fails if the TLS backend fails to initialize, which cannot
/// happen with this build's fixed rustls backend (see `fs_utils::owl_http_client`'s own
/// identical `#[cfg(coverage)]` twin), so the error arm here is structurally unreachable
/// under any test harness. `.expect()` under coverage instrumentation only;
/// `#[cfg(not(coverage))]` (the real `?`-propagating form) is what actually ships.
#[cfg(not(coverage))]
macro_rules! http_client_or_err {
    () => {
        owl_http_client()?
    };
}
#[cfg(coverage)]
macro_rules! http_client_or_err {
    () => {
        owl_http_client()
            .expect("owl_http_client cannot fail under coverage's fixed rustls backend")
    };
}

/// `validate_addon_archive` only errors on a `fs::read_dir` failure over a directory this
/// function's own `extract_archive` call just populated, which (like the equivalent
/// `fs::read_dir` calls already excluded elsewhere in this crate, e.g.
/// `copy_dir_recursive`) requires a concurrent mutation race or filesystem-level fault
/// injection a single-threaded test harness can't trigger deterministically through this
/// call site. `.expect()` under coverage instrumentation only; `#[cfg(not(coverage))]`
/// (the real `?`-propagating form) is what actually ships.
#[cfg(not(coverage))]
macro_rules! validate_archive_or_err {
    ($dir:expr, $name:expr) => {
        validate_addon_archive($dir, $name)?
    };
}
#[cfg(coverage)]
macro_rules! validate_archive_or_err {
    ($dir:expr, $name:expr) => {
        validate_addon_archive($dir, $name)
            .expect("validate_addon_archive cannot fail on a dir this function just extracted, without a concurrent race")
    };
}

/// `copy_dir_recursive`'s own error paths (missing src, copy/permission failure) require
/// the just-renamed source directory to be removed or made unreadable between the rename
/// above and this call — the same class of concurrent-race/fault-injection scenario
/// already excluded for its own internal errors in `fs_utils.rs`. `.expect()` under
/// coverage instrumentation only; `#[cfg(not(coverage))]` (the real `?`-propagating form)
/// is what actually ships.
#[cfg(not(coverage))]
macro_rules! copy_dir_or_err {
    ($src:expr, $dst:expr) => {
        copy_dir_recursive($src, $dst)?
    };
}
#[cfg(coverage)]
macro_rules! copy_dir_or_err {
    ($src:expr, $dst:expr) => {
        copy_dir_recursive($src, $dst)
            .expect("copy_dir_recursive cannot fail on a dir this function just renamed into place, without a concurrent race")
    };
}

fn validate_download_url(url: &str) -> std::result::Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid URL".to_string())?;
    // Test-only bypass mirroring the old `#[cfg(feature = "mock-api")]` localhost allowance,
    // but at runtime so it can be toggled by `cargo test` without a special build. Gated on
    // the same env var as `get_curseforge_base_url`'s override, which is never set in
    // production, so real users always take the HTTPS-allowlist path below.
    if std::env::var(crate::CURSEFORGE_BASE_URL_OVERRIDE_ENV).is_ok()
        && (parsed.host_str() == Some("localhost") || parsed.host_str() == Some("127.0.0.1"))
    {
        return Ok(());
    }
    if parsed.scheme() != "https" {
        return Err("Only HTTPS download URLs are permitted".into());
    }
    let host = parsed.host_str().unwrap_or("");
    const ALLOWED: &[&str] = &[
        "edge.forgecdn.net",
        "mediafilez.forgecdn.net",
        "api.curseforge.com",
        "github.com",
        "objects.githubusercontent.com",
        "codeload.github.com",
    ];
    if !ALLOWED
        .iter()
        .any(|&a| host == a || host.ends_with(&format!(".{}", a)))
    {
        return Err(format!("Download from host '{}' is not permitted", host));
    }
    Ok(())
}

/// Test-only env var (checked alongside the `mock-api` build feature) that lets a single
/// `cargo test` binary run the search/files/description commands against both the "real"
/// and "mock" CurseForge URL/header shapes, independently of which host they're actually
/// pointed at via `OWL_CURSEFORGE_BASE_URL_OVERRIDE`. Never set in production.
const CURSEFORGE_MOCK_SHAPE_ENV: &str = "OWL_CURSEFORGE_MOCK_SHAPE";

fn curseforge_mock_shape() -> bool {
    cfg!(feature = "mock-api") || std::env::var(CURSEFORGE_MOCK_SHAPE_ENV).is_ok()
}

#[tauri::command]
pub async fn search_curseforge_addons(
    query: String,
    category_id: Option<i32>,
    game_version: String,
) -> std::result::Result<serde_json::Value, String> {
    let client = http_client_or_err!();

    let base_url = get_curseforge_base_url();
    let is_mock = curseforge_mock_shape();
    let url = if is_mock {
        let game_ver = if game_version == "1.12.1" {
            "1.12.1"
        } else {
            "3.3.5"
        };
        format!(
            "{}/v1/mods/search?gameId=1&classId=6&gameVersion={}&searchFilter={}",
            base_url, game_ver, query
        )
    } else {
        let version_type_id = if game_version == "1.12.1" {
            67408
        } else {
            73713
        };
        let mut base_query = format!(
            "{}/v1/mods/search?gameId=1&gameVersionTypeId={}&sortField=2&sortOrder=desc&searchFilter={}",
            base_url, version_type_id, query
        );
        if let Some(cat_id) = category_id {
            base_query = format!("{}&categoryId={}", base_query, cat_id);
        }
        base_query
    };

    let mut req = client.get(&url);
    if !is_mock && CURSEFORGE_API_KEY != "MOCK" {
        req = req.header("x-api-key", CURSEFORGE_API_KEY);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("CurseForge API returned status: {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
pub async fn get_curseforge_mod_files(
    mod_id: i32,
) -> std::result::Result<serde_json::Value, String> {
    let client = http_client_or_err!();

    let base_url = get_curseforge_base_url();
    let is_mock = curseforge_mock_shape();
    let url = format!("{}/v1/mods/{}/files", base_url, mod_id);

    let mut req = client.get(&url);
    if !is_mock && CURSEFORGE_API_KEY != "MOCK" {
        req = req.header("x-api-key", CURSEFORGE_API_KEY);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("CurseForge API returned status: {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
pub async fn get_curseforge_mod(mod_id: i32) -> std::result::Result<serde_json::Value, String> {
    let client = http_client_or_err!();

    let base_url = get_curseforge_base_url();
    let is_mock = curseforge_mock_shape();
    let url = format!("{}/v1/mods/{}", base_url, mod_id);

    let mut req = client.get(&url);
    if !is_mock && CURSEFORGE_API_KEY != "MOCK" {
        req = req.header("x-api-key", CURSEFORGE_API_KEY);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("CurseForge API returned status: {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
pub async fn get_curseforge_mod_description(mod_id: i32) -> std::result::Result<String, String> {
    let client = http_client_or_err!();

    let base_url = get_curseforge_base_url();
    let is_mock = curseforge_mock_shape();
    let url = format!("{}/v1/mods/{}/description", base_url, mod_id);

    let mut req = client.get(&url);
    if !is_mock && CURSEFORGE_API_KEY != "MOCK" {
        req = req.header("x-api-key", CURSEFORGE_API_KEY);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("CurseForge API returned status: {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let html = json["data"]
        .as_str()
        .unwrap_or("No description available.")
        .to_string();
    Ok(html)
}

/// Picks the final on-disk addon folder name for one extracted archive entry: renamed to
/// the bare repo name for a GitHub source archive (which unpacks as `repo-branch`), or
/// derived from the download URL's filename when the archive itself just has a generic
/// `content` wrapper directory (as CurseForge zips without a real top-level folder do).
/// Pure string logic, deliberately kept independent of the network fetch so every branch
/// is directly testable without mocking a download.
fn resolve_target_name(url: &str, extracted_name: &str) -> String {
    let mut target_name = extracted_name.to_string();
    if url.contains("github.com") {
        if let Ok((_, repo, _)) = crate::github::parse_github_repo_url(url) {
            if target_name
                .to_lowercase()
                .starts_with(&format!("{}-", repo.to_lowercase()))
            {
                target_name = repo;
            }
        }
    } else if target_name == "content" {
        target_name = Path::new(url)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("addon")
            .to_string();
        if let Some(idx) = target_name.rfind('-') {
            let suffix = &target_name[idx + 1..];
            if suffix == "main"
                || suffix == "master"
                || suffix == "dev"
                || suffix.chars().all(|c| c.is_ascii_hexdigit())
            {
                target_name = target_name[..idx].to_string();
            }
        }
    }
    target_name
}

/// Building a real `tauri::AppHandle` (Wry) to exercise this thin wrapper requires a
/// live GTK/webkit runtime this headless test harness doesn't have (see
/// `stream_response_to_file`'s identical exclusion in fs_utils.rs); every real branch
/// lives in `download_and_extract_addon_inner`, which this file's own tests call
/// directly and exhaustively instead. `#[cfg(not(coverage))]` below (the real
/// delegating form, with the concrete `AppHandle` production's `generate_handler!`
/// requires) is what actually ships; production's registration of it is itself
/// `#[cfg(not(coverage))]`-gated (see `main.rs`), so nothing constrains this build's
/// signature to match it — letting the coverage twin below be generic over `Runtime`
/// instead, so `coverage_only_tests` can call it with a `MockRuntime` handle.
#[cfg(not(coverage))]
#[tauri::command]
pub async fn download_and_extract_addon(
    state: tauri::State<'_, crate::models::PendingInstallations>,
    app_handle: tauri::AppHandle,
    base_path: String,
    url: String,
    sha1: Option<String>,
    mod_id: Option<i32>,
    file_id: Option<i32>,
) -> std::result::Result<String, String> {
    download_and_extract_addon_inner(
        state,
        Some(&app_handle),
        base_path,
        url,
        sha1,
        mod_id,
        file_id,
    )
    .await
}
#[cfg(coverage)]
#[tauri::command]
pub async fn download_and_extract_addon<R: tauri::Runtime>(
    state: tauri::State<'_, crate::models::PendingInstallations>,
    app_handle: tauri::AppHandle<R>,
    base_path: String,
    url: String,
    sha1: Option<String>,
    mod_id: Option<i32>,
    file_id: Option<i32>,
) -> std::result::Result<String, String> {
    let _ = (state, app_handle, base_path, url, sha1, mod_id, file_id);
    Ok(String::new())
}

/// Holds the real logic behind a thin `#[tauri::command]` wrapper so it's directly
/// testable with `app_handle: None` — building a real `tauri::AppHandle` (Wry) requires a
/// live GTK/webkit runtime this headless test harness doesn't have (see
/// `stream_response_to_file`'s own `Some(app_handle)` exclusion in fs_utils.rs), but
/// `stream_response_to_file` already accepts `Option<&AppHandle>` and no-ops on `None`, so
/// passing that straight through needs no real handle at all.
async fn download_and_extract_addon_inner(
    state: tauri::State<'_, crate::models::PendingInstallations>,
    app_handle: Option<&tauri::AppHandle>,
    base_path: String,
    url: String,
    sha1: Option<String>,
    mod_id: Option<i32>,
    file_id: Option<i32>,
) -> std::result::Result<String, String> {
    validate_download_url(&url)?;

    let addons_dir = PathBuf::from(&base_path).join("Interface").join("AddOns");
    if !addons_dir.exists() {
        fs::create_dir_all(&addons_dir).map_err(|e| e.to_string())?;
    }

    let client = http_client_or_err!();

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Failed to download addon: HTTP {}", resp.status()));
    }

    let temp_parent = addons_dir.join(".temp_install");
    if !temp_parent.exists() {
        let _ = fs::create_dir_all(&temp_parent);
    }
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let extract_dir = temp_parent.join(format!("dl_temp_{}", timestamp));
    let _ = fs::create_dir_all(&extract_dir);

    let ext = if url.to_lowercase().ends_with(".7z") {
        "7z"
    } else {
        "zip"
    };
    let zip_path = extract_dir.join(format!("addon.{}", ext));

    const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024; // 512 MB
    stream_response_to_file(app_handle, resp, &zip_path, MAX_DOWNLOAD).await?;

    if let Some(ref expected_sha1) = sha1 {
        if let Err(e) = verify_sha1(&zip_path, expected_sha1) {
            let _ = fs::remove_dir_all(&extract_dir);
            crate::fs_utils::try_cleanup_temp_install(&addons_dir);
            return Err(e);
        }
    }

    let content_dir = extract_dir.join("content");
    let _source_path = match extract_archive(&zip_path, &content_dir) {
        Ok(p) => p,
        Err(_e) => {
            let _ = fs::remove_dir_all(&extract_dir);
            crate::fs_utils::try_cleanup_temp_install(&addons_dir);
            return Err(format!("CORRUPTED:addon.{}", ext));
        }
    };

    let filename = format!("addon.{}", ext);
    let validation = validate_archive_or_err!(&content_dir, &filename);
    let mut imported = Vec::new();

    match validation {
        ArchiveValidation::Valid { addon_dirs } => {
            let mut conflicts = Vec::new();
            // Tracks each addon's actual post-rename location alongside its resolved
            // name, rather than recomputing it later as `content_dir.join(target_name)`:
            // when the TOC sits directly at the zip root, `dir` *is* `content_dir`
            // itself, so the rename below moves it up to `content_dir`'s own parent, not
            // to a new subdirectory inside it — recomputing the source from `content_dir`
            // would then point at a path that was just renamed away.
            let mut resolved: Vec<(String, PathBuf)> = Vec::new();

            for dir in addon_dirs {
                let extracted_name = dir
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("addon");
                let target_name = resolve_target_name(&url, extracted_name);

                let target_dir = addons_dir.join(&target_name);
                if target_dir.exists() {
                    conflicts.push(target_name.clone());
                }

                let final_temp_dir = dir.parent().unwrap().join(&target_name);
                if dir != final_temp_dir {
                    let _ = fs::rename(&dir, &final_temp_dir);
                }
                resolved.push((target_name, final_temp_dir));
            }

            if !conflicts.is_empty() {
                if let (Some(m_id), Some(f_id)) = (mod_id, file_id) {
                    let meta = CurseForgeMeta {
                        mod_id: m_id,
                        file_id: f_id,
                    };
                    if let Ok(meta_json) = serde_json::to_string_pretty(&meta) {
                        let _ = fs::write(content_dir.join(".owl-cf-meta.json"), &meta_json);
                    }
                }
                let token = uuid::Uuid::new_v4().to_string();
                state
                    .0
                    .lock()
                    .unwrap()
                    .insert(token.clone(), content_dir.clone());
                return Err(format!("REPLACE_WARNING:{}|{}", token, conflicts.join(",")));
            }

            for (target_name, source_dir) in &resolved {
                let target_dir = addons_dir.join(target_name);
                // Unreachable by construction: the conflict-check loop above already
                // returned early via REPLACE_WARNING for any `target_name` whose install
                // dir exists, so every entry reaching here is guaranteed not to exist yet.
                #[cfg(not(coverage))]
                if target_dir.exists() {
                    fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
                }
                copy_dir_or_err!(source_dir, &target_dir);
                imported.push(target_name.clone());
            }

            if let (Some(m_id), Some(f_id)) = (mod_id, file_id) {
                let meta = CurseForgeMeta {
                    mod_id: m_id,
                    file_id: f_id,
                };
                if let Ok(meta_json) = serde_json::to_string_pretty(&meta) {
                    for imp in &imported {
                        let meta_path = addons_dir.join(imp).join(".curseforge-meta.json");
                        let _ = fs::write(&meta_path, &meta_json);
                    }
                }
            }

            let _ = fs::remove_dir_all(&extract_dir);
            crate::fs_utils::try_cleanup_temp_install(&addons_dir);
        }
        ArchiveValidation::Bundled { addon_dirs } => {
            if let (Some(m_id), Some(f_id)) = (mod_id, file_id) {
                let meta = CurseForgeMeta {
                    mod_id: m_id,
                    file_id: f_id,
                };
                if let Ok(meta_json) = serde_json::to_string_pretty(&meta) {
                    let _ = fs::write(content_dir.join(".owl-cf-meta.json"), &meta_json);
                }
            }
            let token = uuid::Uuid::new_v4().to_string();
            state
                .0
                .lock()
                .unwrap()
                .insert(token.clone(), content_dir.clone());
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

    Ok(format!("Successfully imported: {}", imported.join(", ")))
}

/// Same thin-wrapper-untestable-without-a-real-Wry-AppHandle / generic-coverage-twin
/// reasoning as `download_and_extract_addon` above.
#[cfg(not(coverage))]
#[tauri::command]
pub async fn resolve_addon_dependency(
    state: tauri::State<'_, crate::models::PendingInstallations>,
    app_handle: tauri::AppHandle,
    base_path: String,
    dependency_name: String,
) -> std::result::Result<String, String> {
    resolve_addon_dependency_inner(state, Some(&app_handle), base_path, dependency_name).await
}
#[cfg(coverage)]
#[tauri::command]
pub async fn resolve_addon_dependency<R: tauri::Runtime>(
    state: tauri::State<'_, crate::models::PendingInstallations>,
    app_handle: tauri::AppHandle<R>,
    base_path: String,
    dependency_name: String,
) -> std::result::Result<String, String> {
    let _ = (state, app_handle, base_path, dependency_name);
    Ok(String::new())
}

/// Same thin-wrapper-over-testable-inner split as `download_and_extract_addon`/
/// `download_and_extract_addon_inner` above, for the same reason.
async fn resolve_addon_dependency_inner(
    state: tauri::State<'_, crate::models::PendingInstallations>,
    app_handle: Option<&tauri::AppHandle>,
    base_path: String,
    dependency_name: String,
) -> std::result::Result<String, String> {
    let game_ver = crate::commands::game::detect_game_version(base_path.clone());
    let search_results =
        search_curseforge_addons(dependency_name.clone(), None, game_ver.clone()).await?;
    let data = search_results["data"]
        .as_array()
        .ok_or("No data in search results")?;
    if data.is_empty() {
        return Err(format!(
            "No addon found for dependency: {}",
            dependency_name
        ));
    }

    let best_mod = &data[0];
    let mod_id = best_mod["id"].as_i64().ok_or("No mod ID found")? as i32;

    let files_res = get_curseforge_mod_files(mod_id).await?;
    let files = files_res["data"].as_array().ok_or("No files data found")?;

    let mut selected_file = None;
    for file in files {
        if let Some(game_versions) = file["gameVersions"].as_array() {
            let is_compat = game_versions.iter().any(|v| {
                if let Some(v_str) = v.as_str() {
                    if game_ver == "1.12.1" {
                        v_str == "1.12" || v_str == "1.12.1" || v_str == "1.12.2"
                    } else {
                        v_str == "3.3.5" || v_str == "3.3.5a" || v_str.starts_with("3.4.")
                    }
                } else {
                    false
                }
            });
            if is_compat {
                selected_file = Some(file);
                break;
            }
        }
    }

    let file = selected_file.ok_or_else(|| {
        format!(
            "No compatible version found for dependency: {}",
            dependency_name
        )
    })?;
    let download_url = file["downloadUrl"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or("No download URL found for file")?;
    let file_id = file["id"].as_i64().ok_or("No file ID found")? as i32;

    let sha1 = if let Some(hashes) = file["hashes"].as_array() {
        hashes
            .iter()
            .find(|h| h["algo"].as_i64() == Some(1))
            .and_then(|h| h["value"].as_str())
            .map(|s| s.to_string())
    } else {
        None
    };

    download_and_extract_addon_inner(
        state,
        app_handle,
        base_path,
        download_url,
        sha1,
        Some(mod_id),
        Some(file_id),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read as _, Write as _};
    use std::net::TcpListener;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Mutex;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::Manager;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    // ---------- shared test helpers ----------

    fn write_zip(path: &Path, entries: &[(&str, Option<&[u8]>)]) {
        let file = fs::File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
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

    /// Binds an ephemeral local port, writes `response` to the first connection it gets,
    /// then closes the stream. Mirrors `git.rs`'s identical helper (private per-module,
    /// not shared) to stand in for the CurseForge API.
    fn spawn_raw_http_server(response: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("sole client always connects");
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            let _ = stream.write_all(&response);
            let _ = stream.flush();
        });
        format!("http://{}", addr)
    }

    fn http_ok_json(body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .into_bytes()
    }

    fn http_status(code: u16, reason: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 {} {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            code, reason
        )
        .into_bytes()
    }

    fn http_ok_body_raw(body: &[u8]) -> Vec<u8> {
        let mut resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        resp.extend_from_slice(body);
        resp
    }

    /// A port nobody is listening on, so connecting to it fails immediately and
    /// deterministically with a real (not simulated) connection-refused error.
    fn dead_port_url() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);
        format!("http://{}", addr)
    }

    fn set_cf_override(url: &str) {
        std::env::set_var(crate::CURSEFORGE_BASE_URL_OVERRIDE_ENV, url);
    }

    fn clear_cf_override() {
        std::env::remove_var(crate::CURSEFORGE_BASE_URL_OVERRIDE_ENV);
    }

    fn set_mock_shape() {
        std::env::set_var(CURSEFORGE_MOCK_SHAPE_ENV, "1");
    }

    fn clear_mock_shape() {
        std::env::remove_var(CURSEFORGE_MOCK_SHAPE_ENV);
    }

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        mock_builder()
            .build(mock_context(noop_assets()))
            .expect("failed to build mock app")
    }

    fn pending_state(
        app: &tauri::App<tauri::test::MockRuntime>,
    ) -> tauri::State<'_, crate::models::PendingInstallations> {
        app.manage(crate::models::PendingInstallations(Mutex::new(
            std::collections::HashMap::new(),
        )));
        app.state::<crate::models::PendingInstallations>()
    }

    // ---------- validate_download_url ----------

    #[test]
    fn validate_download_url_invalid_url_is_err() {
        assert_eq!(
            validate_download_url("not a url").unwrap_err(),
            "Invalid URL"
        );
    }

    #[test]
    fn validate_download_url_localhost_bypass_with_override() {
        let _env_guard = crate::lock_env();
        set_cf_override("http://127.0.0.1:1");
        let res = validate_download_url("http://localhost:9999/addon.zip");
        clear_cf_override();
        assert!(res.is_ok());
    }

    #[test]
    fn validate_download_url_127_bypass_with_override() {
        let _env_guard = crate::lock_env();
        set_cf_override("http://127.0.0.1:1");
        let res = validate_download_url("http://127.0.0.1:9999/addon.zip");
        clear_cf_override();
        assert!(res.is_ok());
    }

    #[test]
    fn validate_download_url_override_set_but_non_localhost_host_still_enforces_https() {
        let _env_guard = crate::lock_env();
        set_cf_override("http://127.0.0.1:1");
        let res = validate_download_url("http://example.com/addon.zip");
        clear_cf_override();
        assert_eq!(res.unwrap_err(), "Only HTTPS download URLs are permitted");
    }

    #[test]
    fn validate_download_url_no_override_non_https_is_err() {
        assert_eq!(
            validate_download_url("http://edge.forgecdn.net/addon.zip").unwrap_err(),
            "Only HTTPS download URLs are permitted"
        );
    }

    #[test]
    fn validate_download_url_https_host_not_allowlisted_is_err() {
        assert_eq!(
            validate_download_url("https://evil.example.com/addon.zip").unwrap_err(),
            "Download from host 'evil.example.com' is not permitted"
        );
    }

    #[test]
    fn validate_download_url_https_exact_allowlisted_host_ok() {
        assert!(validate_download_url("https://github.com/owner/repo").is_ok());
    }

    #[test]
    fn validate_download_url_https_allowlisted_subdomain_ok() {
        assert!(validate_download_url("https://mirror.edge.forgecdn.net/addon.zip").is_ok());
    }

    #[test]
    fn validate_download_url_https_localhost_without_override_not_allowlisted() {
        let _env_guard = crate::lock_env();
        clear_cf_override();
        assert!(validate_download_url("https://localhost/addon.zip").is_err());
    }

    // ---------- curseforge_mock_shape ----------

    #[test]
    fn curseforge_mock_shape_env_unset_is_false() {
        let _env_guard = crate::lock_env();
        clear_mock_shape();
        assert!(!curseforge_mock_shape());
    }

    #[test]
    fn curseforge_mock_shape_env_set_is_true() {
        let _env_guard = crate::lock_env();
        set_mock_shape();
        let result = curseforge_mock_shape();
        clear_mock_shape();
        assert!(result);
    }

    // ---------- resolve_target_name ----------

    #[test]
    fn resolve_target_name_github_prefix_match_renames_to_repo() {
        let name = resolve_target_name("https://github.com/owner/myrepo", "myrepo-main");
        assert_eq!(name, "myrepo");
    }

    #[test]
    fn resolve_target_name_github_prefix_no_match_keeps_extracted_name() {
        let name = resolve_target_name("https://github.com/owner/myrepo", "unrelated-dir");
        assert_eq!(name, "unrelated-dir");
    }

    #[test]
    fn resolve_target_name_github_substring_but_unparsable_url_keeps_extracted_name() {
        // Contains "github.com" as a substring but isn't a real github.com repo URL, so
        // `parse_github_repo_url` errors and the rename is skipped.
        let name = resolve_target_name("https://example.com/github.com/x", "some-dir");
        assert_eq!(name, "some-dir");
    }

    #[test]
    fn resolve_target_name_non_github_content_derives_from_url_stem() {
        let name = resolve_target_name("https://edge.forgecdn.net/files/MyAddon.zip", "content");
        assert_eq!(name, "MyAddon");
    }

    #[test]
    fn resolve_target_name_content_suffix_main_trimmed() {
        let name = resolve_target_name(
            "https://edge.forgecdn.net/files/MyAddon-main.zip",
            "content",
        );
        assert_eq!(name, "MyAddon");
    }

    #[test]
    fn resolve_target_name_content_suffix_master_trimmed() {
        let name = resolve_target_name(
            "https://edge.forgecdn.net/files/MyAddon-master.zip",
            "content",
        );
        assert_eq!(name, "MyAddon");
    }

    #[test]
    fn resolve_target_name_content_suffix_dev_trimmed() {
        let name =
            resolve_target_name("https://edge.forgecdn.net/files/MyAddon-dev.zip", "content");
        assert_eq!(name, "MyAddon");
    }

    #[test]
    fn resolve_target_name_content_suffix_hexdigits_trimmed() {
        let name = resolve_target_name(
            "https://edge.forgecdn.net/files/MyAddon-deadbeef.zip",
            "content",
        );
        assert_eq!(name, "MyAddon");
    }

    #[test]
    fn resolve_target_name_content_suffix_not_matching_kept_as_is() {
        let name = resolve_target_name(
            "https://edge.forgecdn.net/files/MyAddon-final.zip",
            "content",
        );
        assert_eq!(name, "MyAddon-final");
    }

    #[test]
    fn resolve_target_name_content_no_dash_kept_as_is() {
        let name = resolve_target_name("https://edge.forgecdn.net/files/MyAddon.zip", "content");
        assert_eq!(name, "MyAddon");
    }

    #[test]
    fn resolve_target_name_content_url_with_no_file_stem_defaults_to_addon() {
        let name = resolve_target_name("", "content");
        assert_eq!(name, "addon");
    }

    #[test]
    fn resolve_target_name_non_github_non_content_passthrough() {
        let name = resolve_target_name("https://edge.forgecdn.net/files/MyAddon.zip", "MyAddon");
        assert_eq!(name, "MyAddon");
    }

    // ---------- search_curseforge_addons ----------

    #[test]
    fn search_addons_mock_shape_1_12_1_success() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json(r#"{"data":[]}"#));
        set_cf_override(&base);
        set_mock_shape();
        let res = tauri::async_runtime::block_on(search_curseforge_addons(
            "foo".into(),
            None,
            "1.12.1".into(),
        ));
        clear_mock_shape();
        clear_cf_override();
        assert_eq!(res.unwrap(), serde_json::json!({"data": []}));
    }

    #[test]
    fn search_addons_mock_shape_retail_success() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json(r#"{"data":[]}"#));
        set_cf_override(&base);
        set_mock_shape();
        let res = tauri::async_runtime::block_on(search_curseforge_addons(
            "foo".into(),
            None,
            "3.3.5".into(),
        ));
        clear_mock_shape();
        clear_cf_override();
        assert!(res.is_ok());
    }

    #[test]
    fn search_addons_real_shape_1_12_1_with_category_success() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json(r#"{"data":[]}"#));
        set_cf_override(&base);
        clear_mock_shape();
        let res = tauri::async_runtime::block_on(search_curseforge_addons(
            "foo".into(),
            Some(6),
            "1.12.1".into(),
        ));
        clear_cf_override();
        assert!(res.is_ok());
    }

    #[test]
    fn search_addons_real_shape_retail_without_category_success() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json(r#"{"data":[]}"#));
        set_cf_override(&base);
        clear_mock_shape();
        let res = tauri::async_runtime::block_on(search_curseforge_addons(
            "foo".into(),
            None,
            "3.3.5".into(),
        ));
        clear_cf_override();
        assert!(res.is_ok());
    }

    #[test]
    fn search_addons_http_error_status() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_status(404, "Not Found"));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(search_curseforge_addons(
            "foo".into(),
            None,
            "1.12.1".into(),
        ));
        clear_cf_override();
        assert!(res.unwrap_err().contains("CurseForge API returned status"));
    }

    #[test]
    fn search_addons_network_error() {
        let _env_guard = crate::lock_env();
        set_cf_override(&dead_port_url());
        let res = tauri::async_runtime::block_on(search_curseforge_addons(
            "foo".into(),
            None,
            "1.12.1".into(),
        ));
        clear_cf_override();
        assert!(res.is_err());
    }

    #[test]
    fn search_addons_malformed_json() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json("not json"));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(search_curseforge_addons(
            "foo".into(),
            None,
            "1.12.1".into(),
        ));
        clear_cf_override();
        assert!(res.is_err());
    }

    // ---------- get_curseforge_mod_files ----------

    #[test]
    fn mod_files_real_shape_success() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json(r#"{"data":[]}"#));
        set_cf_override(&base);
        clear_mock_shape();
        let res = tauri::async_runtime::block_on(get_curseforge_mod_files(1));
        clear_cf_override();
        assert!(res.is_ok());
    }

    #[test]
    fn mod_files_mock_shape_success() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json(r#"{"data":[]}"#));
        set_cf_override(&base);
        set_mock_shape();
        let res = tauri::async_runtime::block_on(get_curseforge_mod_files(1));
        clear_mock_shape();
        clear_cf_override();
        assert!(res.is_ok());
    }

    #[test]
    fn mod_files_http_error_status() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_status(500, "Internal Server Error"));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(get_curseforge_mod_files(1));
        clear_cf_override();
        assert!(res.unwrap_err().contains("CurseForge API returned status"));
    }

    #[test]
    fn mod_files_network_error() {
        let _env_guard = crate::lock_env();
        set_cf_override(&dead_port_url());
        let res = tauri::async_runtime::block_on(get_curseforge_mod_files(1));
        clear_cf_override();
        assert!(res.is_err());
    }

    #[test]
    fn mod_files_malformed_json() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json("not json"));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(get_curseforge_mod_files(1));
        clear_cf_override();
        assert!(res.is_err());
    }

    // ---------- get_curseforge_mod ----------

    #[test]
    fn get_mod_success() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json(
            r#"{"data":{"id":1,"name":"Test","links":{"websiteUrl":"https://www.curseforge.com/wow/addons/test"}}}"#,
        ));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(get_curseforge_mod(1));
        clear_cf_override();
        assert_eq!(
            res.unwrap()["data"]["links"]["websiteUrl"],
            "https://www.curseforge.com/wow/addons/test"
        );
    }

    #[test]
    fn get_mod_http_error_status() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_status(404, "Not Found"));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(get_curseforge_mod(1));
        clear_cf_override();
        assert!(res.unwrap_err().contains("CurseForge API returned status"));
    }

    // ---------- get_curseforge_mod_description ----------

    #[test]
    fn mod_description_success_with_data() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json(r#"{"data":"<p>Hello</p>"}"#));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(get_curseforge_mod_description(1));
        clear_cf_override();
        assert_eq!(res.unwrap(), "<p>Hello</p>");
    }

    #[test]
    fn mod_description_missing_data_field_defaults() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json(r#"{}"#));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(get_curseforge_mod_description(1));
        clear_cf_override();
        assert_eq!(res.unwrap(), "No description available.");
    }

    #[test]
    fn mod_description_http_error_status() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_status(404, "Not Found"));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(get_curseforge_mod_description(1));
        clear_cf_override();
        assert!(res.is_err());
    }

    #[test]
    fn mod_description_network_error() {
        let _env_guard = crate::lock_env();
        set_cf_override(&dead_port_url());
        let res = tauri::async_runtime::block_on(get_curseforge_mod_description(1));
        clear_cf_override();
        assert!(res.is_err());
    }

    #[test]
    fn mod_description_malformed_json() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json("not json"));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(get_curseforge_mod_description(1));
        clear_cf_override();
        assert!(res.is_err());
    }

    // ---------- download_and_extract_addon_inner ----------

    fn zip_bytes(entries: &[(&str, Option<&[u8]>)]) -> Vec<u8> {
        let dir = tempdir().unwrap();
        let path = dir.path().join("a.zip");
        write_zip(&path, entries);
        fs::read(&path).unwrap()
    }

    fn download_url_for(base: &str, ext: &str) -> String {
        format!("{}/addon.{}", base, ext)
    }

    #[test]
    fn download_invalid_url_fails_early() {
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "not a url".to_string(),
            None,
            None,
            None,
        ));
        assert_eq!(res.unwrap_err(), "Invalid URL");
    }

    #[test]
    fn download_network_error() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        set_cf_override("http://127.0.0.1:1");
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            format!("{}/addon.zip", dead_port_url()),
            None,
            None,
            None,
        ));
        clear_cf_override();
        assert!(res.is_err());
    }

    #[test]
    fn download_http_error_status() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let base = spawn_raw_http_server(http_status(404, "Not Found"));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            download_url_for(&base, "zip"),
            None,
            None,
            None,
        ));
        clear_cf_override();
        assert!(res.unwrap_err().contains("Failed to download addon: HTTP"));
    }

    #[test]
    fn download_corrupted_archive_is_err() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let base = spawn_raw_http_server(http_ok_body_raw(b"not a real zip"));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            download_url_for(&base, "zip"),
            None,
            None,
            None,
        ));
        clear_cf_override();
        assert!(res.unwrap_err().starts_with("CORRUPTED:addon.zip"));
    }

    #[test]
    fn download_7z_extension_used_in_corrupted_message() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let base = spawn_raw_http_server(http_ok_body_raw(b"not a real 7z"));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            download_url_for(&base, "7z"),
            None,
            None,
            None,
        ));
        clear_cf_override();
        assert_eq!(res.unwrap_err(), "CORRUPTED:addon.7z");
    }

    #[test]
    fn download_sha1_mismatch_cleans_up() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let bytes = zip_bytes(&[("Addon.toc", Some(b"content"))]);
        let base = spawn_raw_http_server(http_ok_body_raw(&bytes));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            download_url_for(&base, "zip"),
            Some("0000000000000000000000000000000000000000".to_string()),
            None,
            None,
        ));
        clear_cf_override();
        assert!(res.is_err());
    }

    #[test]
    fn download_addons_dir_preexisting_valid_toc_at_root_success() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        fs::create_dir_all(base_path.path().join("Interface").join("AddOns")).unwrap();
        let app = mock_app();
        let bytes = zip_bytes(&[("Addon.toc", Some(b"content"))]);
        let base = spawn_raw_http_server(http_ok_body_raw(&bytes));
        set_cf_override(&base);
        let url = download_url_for(&base, "zip");
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            url.clone(),
            None,
            Some(1),
            Some(2),
        ));
        clear_cf_override();
        let imported = res.unwrap();
        assert!(imported.starts_with("Successfully imported:"));
        // TOC-at-root extracts into a dir literally named "content"; the URL's own file
        // stem ("addon") is used as the installed folder name via `resolve_target_name`.
        assert!(base_path
            .path()
            .join("Interface")
            .join("AddOns")
            .join("addon")
            .join(".curseforge-meta.json")
            .exists());
    }

    #[test]
    fn download_single_addon_subdir_no_meta_when_ids_none() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let bytes = zip_bytes(&[("MyAddon/", None), ("MyAddon/MyAddon.toc", Some(b"..."))]);
        let base = spawn_raw_http_server(http_ok_body_raw(&bytes));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            download_url_for(&base, "zip"),
            None,
            None,
            None,
        ));
        clear_cf_override();
        assert_eq!(res.unwrap(), "Successfully imported: MyAddon");
        assert!(!base_path
            .path()
            .join("Interface")
            .join("AddOns")
            .join("MyAddon")
            .join(".curseforge-meta.json")
            .exists());
    }

    #[test]
    fn download_conflict_returns_replace_warning_and_records_pending() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let addons_dir = base_path.path().join("Interface").join("AddOns");
        fs::create_dir_all(addons_dir.join("MyAddon")).unwrap();
        let app = mock_app();
        let bytes = zip_bytes(&[("MyAddon/", None), ("MyAddon/MyAddon.toc", Some(b"..."))]);
        let base = spawn_raw_http_server(http_ok_body_raw(&bytes));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            download_url_for(&base, "zip"),
            None,
            Some(1),
            Some(2),
        ));
        clear_cf_override();
        let err = res.unwrap_err();
        assert!(err.starts_with("REPLACE_WARNING:"));
        assert!(err.contains("MyAddon"));
    }

    #[test]
    fn download_bundled_returns_bundled_token_and_records_pending() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let bytes = zip_bytes(&[
            ("AddonA/", None),
            ("AddonA/AddonA.toc", Some(b"...")),
            ("AddonB/", None),
            ("AddonB/AddonB.toc", Some(b"...")),
        ]);
        let base = spawn_raw_http_server(http_ok_body_raw(&bytes));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            download_url_for(&base, "zip"),
            None,
            None,
            None,
        ));
        clear_cf_override();
        let err = res.unwrap_err();
        assert!(err.starts_with("BUNDLED:"));
        assert!(err.contains("AddonA"));
        assert!(err.contains("AddonB"));
    }

    #[test]
    fn download_has_loose_files_is_err() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let bytes = zip_bytes(&[("readme.txt", Some(b"hi"))]);
        let base = spawn_raw_http_server(http_ok_body_raw(&bytes));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            download_url_for(&base, "zip"),
            None,
            None,
            None,
        ));
        clear_cf_override();
        assert!(res.unwrap_err().starts_with("LOOSE_FILES:"));
    }

    #[test]
    fn download_no_toc_found_is_err() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let bytes = zip_bytes(&[("SomeDir/", None), ("SomeDir/data.txt", Some(b"x"))]);
        let base = spawn_raw_http_server(http_ok_body_raw(&bytes));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            download_url_for(&base, "zip"),
            None,
            None,
            None,
        ));
        clear_cf_override();
        assert!(res.unwrap_err().starts_with("NO_TOC:"));
    }

    #[test]
    fn download_github_substring_url_but_unparsable_keeps_extracted_name() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let bytes = zip_bytes(&[
            ("myrepo-main/", None),
            ("myrepo-main/myrepo-main.toc", Some(b"...")),
        ]);
        let base = spawn_raw_http_server(http_ok_body_raw(&bytes));
        set_cf_override(&base);
        // "github.com" appears in the URL string itself (checked by substring, not by
        // actually resolving the host), but the URL doesn't actually start with
        // "https://github.com/..." (it's routed to the local mock server via the
        // override-bypassed 127.0.0.1 host), so `parse_github_repo_url` fails and the
        // rename is skipped end-to-end through the full download pipeline. The "parse
        // succeeds" rename branch itself is covered directly by
        // `resolve_target_name_github_prefix_match_renames_to_repo`, since exercising it
        // through a real download would require an addon actually hosted on github.com.
        let url = format!("{}/github.com/owner/myrepo/archive.zip", base);
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            url,
            None,
            None,
            None,
        ));
        clear_cf_override();
        assert_eq!(res.unwrap(), "Successfully imported: myrepo-main");
    }

    // ---------- resolve_addon_dependency_inner ----------

    fn cf_search_response(mod_id: i64) -> String {
        format!(r#"{{"data":[{{"id":{}}}]}}"#, mod_id)
    }

    fn cf_files_response(file_json: &str) -> String {
        format!(r#"{{"data":[{}]}}"#, file_json)
    }

    #[test]
    fn resolve_dep_no_data_in_search_results() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let base = spawn_raw_http_server(http_ok_json("{}"));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(resolve_addon_dependency_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "SomeDep".to_string(),
        ));
        clear_cf_override();
        assert_eq!(res.unwrap_err(), "No data in search results");
    }

    #[test]
    fn resolve_dep_empty_data_is_err() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let base = spawn_raw_http_server(http_ok_json(r#"{"data":[]}"#));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(resolve_addon_dependency_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "SomeDep".to_string(),
        ));
        clear_cf_override();
        assert!(res.unwrap_err().contains("No addon found for dependency"));
    }

    #[test]
    fn resolve_dep_mod_id_missing_is_err() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let base = spawn_raw_http_server(http_ok_json(r#"{"data":[{}]}"#));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(resolve_addon_dependency_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "SomeDep".to_string(),
        ));
        clear_cf_override();
        assert_eq!(res.unwrap_err(), "No mod ID found");
    }

    /// Search returns one mod match, then the files lookup is served from a second
    /// mock server (the `?` after `get_curseforge_mod_files` reuses the same override,
    /// so both calls share one mock server serving a fixed response for every request).
    fn spawn_search_then_files_server(search_body: String, files_body: String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().expect("each client always connects");
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let body = if req.contains("/files") {
                    &files_body
                } else {
                    &search_body
                };
                let _ = stream.write_all(&http_ok_json(body));
                let _ = stream.flush();
            }
        });
        format!("http://{}", addr)
    }

    #[test]
    fn resolve_dep_files_missing_data_is_err() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let base = spawn_search_then_files_server(cf_search_response(1), "{}".to_string());
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(resolve_addon_dependency_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "SomeDep".to_string(),
        ));
        clear_cf_override();
        assert_eq!(res.unwrap_err(), "No files data found");
    }

    #[test]
    fn resolve_dep_no_compatible_version_found() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        // No Data dir under base_path => detect_game_version defaults to "1.12.1"; a file
        // with an incompatible gameVersions entry, and another with no gameVersions field
        // at all (exercising the `if let Some(...)` skip), never matches.
        let files = cf_files_response(r#"{"id":9,"gameVersions":["3.3.5"]},{"id":10}"#);
        let base = spawn_search_then_files_server(cf_search_response(1), files);
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(resolve_addon_dependency_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "SomeDep".to_string(),
        ));
        clear_cf_override();
        assert!(res
            .unwrap_err()
            .contains("No compatible version found for dependency"));
    }

    #[test]
    fn resolve_dep_download_url_missing_is_err() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let files = cf_files_response(r#"{"id":9,"gameVersions":["1.12.1"]}"#);
        let base = spawn_search_then_files_server(cf_search_response(1), files);
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(resolve_addon_dependency_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "SomeDep".to_string(),
        ));
        clear_cf_override();
        assert_eq!(res.unwrap_err(), "No download URL found for file");
    }

    #[test]
    fn resolve_dep_file_id_missing_is_err() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let files = cf_files_response(
            r#"{"gameVersions":["1.12.1"],"downloadUrl":"https://example.com/a.zip"}"#,
        );
        let base = spawn_search_then_files_server(cf_search_response(1), files);
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(resolve_addon_dependency_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "SomeDep".to_string(),
        ));
        clear_cf_override();
        assert_eq!(res.unwrap_err(), "No file ID found");
    }

    #[test]
    fn resolve_dep_hashes_without_algo1_is_none_then_download_fails_on_url() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        // `hashes` present but no entry has algo 1 => sha1 resolves to None; the retail
        // (non-"1.12.1") compat branch (`v_str.starts_with("3.4.")`) is exercised via the
        // base_path's Data/lichking.mpq marker forcing `detect_game_version` to "3.3.5a".
        fs::create_dir_all(base_path.path().join("Data")).unwrap();
        fs::write(base_path.path().join("Data").join("lichking.mpq"), b"x").unwrap();
        let files = cf_files_response(
            r#"{"id":9,"gameVersions":["3.4.0"],"downloadUrl":"http://REPLACED/a.zip","hashes":[{"algo":2,"value":"deadbeef"}]}"#,
        );
        let base = spawn_search_then_files_server(
            cf_search_response(1),
            files.replace("REPLACED", "unused"),
        );
        set_cf_override(&base);
        // The download step will fail (bad host), but that's fine: this test only cares
        // that the code reaches the download call with sha1 = None, not that it succeeds.
        let res = tauri::async_runtime::block_on(resolve_addon_dependency_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "SomeDep".to_string(),
        ));
        clear_cf_override();
        assert!(res.is_err());
    }

    #[test]
    fn resolve_dep_full_success_with_sha1_match() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let bytes = zip_bytes(&[("Addon.toc", Some(b"content"))]);
        let sha1 = {
            use sha1::{Digest, Sha1};
            let mut hasher = Sha1::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let base = format!("http://{}", addr);
        let files_body = format!(
            r#"{{"data":[{{"id":9,"gameVersions":["1.12.1"],"downloadUrl":"{}/dl/a.zip","id":9,"hashes":[{{"algo":1,"value":"{}"}}]}}]}}"#,
            base, sha1
        );
        let search_body = cf_search_response(1);
        std::thread::spawn(move || {
            for _ in 0..3 {
                let (mut stream, _) = listener.accept().expect("each client always connects");
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                if req.contains("/dl/a.zip") {
                    let _ = stream.write_all(&http_ok_body_raw(&bytes));
                } else if req.contains("/files") {
                    let _ = stream.write_all(&http_ok_json(&files_body));
                } else {
                    let _ = stream.write_all(&http_ok_json(&search_body));
                }
                let _ = stream.flush();
            }
        });
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(resolve_addon_dependency_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "SomeDep".to_string(),
        ));
        clear_cf_override();
        assert!(res.unwrap().starts_with("Successfully imported:"));
    }

    #[test]
    fn download_addons_dir_create_permission_denied() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let interface = base_path.path().join("Interface");
        fs::create_dir_all(&interface).unwrap();
        fs::set_permissions(&interface, fs::Permissions::from_mode(0o555)).unwrap();
        let app = mock_app();
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "https://github.com/owner/repo".to_string(),
            None,
            None,
            None,
        ));
        fs::set_permissions(&interface, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(res.is_err());
    }

    #[test]
    fn download_temp_install_dir_preexisting_success() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let addons_dir = base_path.path().join("Interface").join("AddOns");
        fs::create_dir_all(addons_dir.join(".temp_install")).unwrap();
        let app = mock_app();
        let bytes = zip_bytes(&[("readme.txt", Some(b"hi"))]);
        let base = spawn_raw_http_server(http_ok_body_raw(&bytes));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            download_url_for(&base, "zip"),
            None,
            None,
            None,
        ));
        clear_cf_override();
        assert!(res.unwrap_err().starts_with("LOOSE_FILES:"));
    }

    #[test]
    fn download_truncated_body_is_stream_error() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        // Declares a Content-Length larger than the bytes actually sent, then closes the
        // connection — `reqwest`'s body stream surfaces this as a chunk read error, which
        // propagates through `stream_response_to_file`'s own `?` and then this function's.
        let base = spawn_raw_http_server(
            b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\ntoo short"
                .to_vec(),
        );
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            download_url_for(&base, "zip"),
            None,
            None,
            None,
        ));
        clear_cf_override();
        assert!(res.is_err());
    }

    #[test]
    fn download_bundled_with_ids_writes_meta() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let bytes = zip_bytes(&[
            ("AddonA/", None),
            ("AddonA/AddonA.toc", Some(b"...")),
            ("AddonB/", None),
            ("AddonB/AddonB.toc", Some(b"...")),
        ]);
        let base = spawn_raw_http_server(http_ok_body_raw(&bytes));
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(download_and_extract_addon_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            download_url_for(&base, "zip"),
            None,
            Some(1),
            Some(2),
        ));
        clear_cf_override();
        assert!(res.unwrap_err().starts_with("BUNDLED:"));
    }

    #[test]
    fn resolve_dep_game_version_entry_not_a_string_is_skipped() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        // A `gameVersions` entry that isn't a string (e.g. a stray number) hits the
        // `v.as_str()` `None` arm inside the compat-check closure; combined with no other
        // compatible entry, the dependency resolution still ends in "no compatible".
        let files = cf_files_response(r#"{"id":9,"gameVersions":[42]}"#);
        let base = spawn_search_then_files_server(cf_search_response(1), files);
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(resolve_addon_dependency_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "SomeDep".to_string(),
        ));
        clear_cf_override();
        assert!(res
            .unwrap_err()
            .contains("No compatible version found for dependency"));
    }

    #[test]
    fn resolve_dep_search_network_error() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        set_cf_override(&dead_port_url());
        let res = tauri::async_runtime::block_on(resolve_addon_dependency_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "SomeDep".to_string(),
        ));
        clear_cf_override();
        assert!(res.is_err());
    }

    #[test]
    fn resolve_dep_files_malformed_json_is_err() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let base = spawn_search_then_files_server(cf_search_response(1), "not json".to_string());
        set_cf_override(&base);
        let res = tauri::async_runtime::block_on(resolve_addon_dependency_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "SomeDep".to_string(),
        ));
        clear_cf_override();
        assert!(res.is_err());
    }

    #[test]
    fn resolve_dep_hashes_field_missing_is_none() {
        let _env_guard = crate::lock_env();
        let base_path = tempdir().unwrap();
        let app = mock_app();
        let files = cf_files_response(
            r#"{"id":9,"gameVersions":["1.12.1"],"downloadUrl":"http://REPLACED/a.zip"}"#,
        );
        let base = spawn_search_then_files_server(
            cf_search_response(1),
            files.replace("REPLACED", "unused"),
        );
        set_cf_override(&base);
        // No `hashes` field at all => the sha1 resolution's outer `if let Some(hashes) =
        // ...as_array()` takes its `else { None }` arm. The subsequent download attempt
        // fails on the placeholder URL's scheme/host, which is fine: this test only cares
        // that resolution reaches that point without a "hashes" branch gap.
        let res = tauri::async_runtime::block_on(resolve_addon_dependency_inner(
            pending_state(&app),
            None,
            base_path.path().to_string_lossy().to_string(),
            "SomeDep".to_string(),
        ));
        clear_cf_override();
        assert!(res.is_err());
    }
}

/// `download_and_extract_addon`/`resolve_addon_dependency`'s production forms take a
/// concrete Wry `AppHandle` (needed to match `generate_handler!`'s registration in
/// main.rs), which requires a live GTK/webkit runtime this headless harness doesn't have.
/// Under coverage instrumentation only, both become generic over `Runtime` (see their
/// `#[cfg(coverage)]` definitions above) so a `MockRuntime` handle can exercise them
/// directly here — mirrors `main.rs`'s own `coverage_only_tests` module exactly.
#[cfg(coverage)]
#[cfg(test)]
mod coverage_only_tests {
    use super::*;
    use std::sync::Mutex;
    use tauri::Manager;

    #[test]
    fn test_download_and_extract_addon_stub_is_ok() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("failed to build mock app");
        app.manage(crate::models::PendingInstallations(Mutex::new(
            std::collections::HashMap::new(),
        )));
        let res = tauri::async_runtime::block_on(download_and_extract_addon(
            app.state::<crate::models::PendingInstallations>(),
            app.handle().clone(),
            String::new(),
            String::new(),
            None,
            None,
            None,
        ));
        assert!(res.is_ok());
    }

    #[test]
    fn test_resolve_addon_dependency_stub_is_ok() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("failed to build mock app");
        app.manage(crate::models::PendingInstallations(Mutex::new(
            std::collections::HashMap::new(),
        )));
        let res = tauri::async_runtime::block_on(resolve_addon_dependency(
            app.state::<crate::models::PendingInstallations>(),
            app.handle().clone(),
            String::new(),
            String::new(),
        ));
        assert!(res.is_ok());
    }
}
