use crate::archive::*;
use crate::fs_utils::{owl_http_client, stream_response_to_file};
use crate::git::*;
use crate::github::*;
use crate::models::*;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

#[tauri::command]
pub fn get_addons(base_path: String) -> std::result::Result<Vec<String>, String> {
    let addons_dir = PathBuf::from(&base_path).join("Interface").join("AddOns");
    if !addons_dir.exists() {
        return Ok(Vec::new());
    }

    let mut addons: Vec<String> = fs::read_dir(&addons_dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !name.starts_with('.'))
        .collect();

    addons.sort();
    Ok(addons)
}

#[tauri::command]
pub fn parse_toc(base_path: String, addon_name: String) -> std::result::Result<AddonMeta, String> {
    let addon_path = PathBuf::from(&base_path)
        .join("Interface")
        .join("AddOns")
        .join(&addon_name);
    if !addon_path.exists() || !addon_path.is_dir() {
        return Err("Addon folder not found".into());
    }

    let mut toc_file_name: Option<String> = None;
    let mut title = None;
    let mut author = None;
    let mut version = None;
    let mut notes = None;
    let mut optional_deps: Vec<String> = Vec::new();
    let mut required_deps: Vec<String> = Vec::new();

    for entry in fs::read_dir(&addon_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if let Some(ext) = entry.path().extension().and_then(|s| s.to_str()) {
            if ext.eq_ignore_ascii_case("toc") {
                toc_file_name = entry.file_name().into_string().ok();
                let toc_content = fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
                for line in toc_content.lines() {
                    let line = line.trim();
                    if line.starts_with("##") {
                        let rest = line.trim_start_matches('#').trim();
                        if let Some((key, val)) = rest.split_once(':') {
                            let key = key.trim().to_lowercase();
                            let val = val.trim().to_string();
                            match key.as_str() {
                                "title" => title = Some(val),
                                "author" => author = Some(val),
                                "version" => version = Some(val),
                                "notes" => notes = Some(val),
                                "optionaldeps" => {
                                    optional_deps = val
                                        .split(',')
                                        .map(|s| s.trim().to_string())
                                        .filter(|s| !s.is_empty())
                                        .collect();
                                }
                                "dependencies" | "requireddeps" => {
                                    required_deps = val
                                        .split(',')
                                        .map(|s| s.trim().to_string())
                                        .filter(|s| !s.is_empty())
                                        .collect();
                                }
                                _ => {}
                            }
                        }
                    }
                }
                break;
            }
        }
    }

    let addons_dir = PathBuf::from(&base_path).join("Interface").join("AddOns");
    let mut optional_deps_installed = Vec::new();
    for dep in &optional_deps {
        optional_deps_installed.push(addons_dir.join(dep).exists());
    }

    let mut readme = None;
    let readme_candidates = ["README.md", "readme.md", "Readme.md"];
    for candidate in &readme_candidates {
        let p = addon_path.join(candidate);
        if p.exists() {
            const README_LIMIT: u64 = 256 * 1024;
            let f = fs::File::open(&p).map_err(|e| e.to_string())?;
            let mut buf = Vec::with_capacity(README_LIMIT as usize);
            use std::io::Read;
            f.take(README_LIMIT)
                .read_to_end(&mut buf)
                .map_err(|e| e.to_string())?;
            readme = Some(String::from_utf8_lossy(&buf).into_owned());
            break;
        }
    }

    let addon_path_str = addon_path.to_string_lossy().to_string();
    let has_git = addon_path.join(".git").exists() || addon_path.join(".owl-meta.json").exists();

    // Check if this addon is a dependency of any other installed addon
    let mut is_dep = false;
    if let Ok(entries) = fs::read_dir(&addons_dir) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() && entry.file_name().to_string_lossy() != addon_name {
                if let Ok(sub_entries) = fs::read_dir(&path) {
                    for sub_entry in sub_entries.filter_map(Result::ok) {
                        if sub_entry
                            .path()
                            .extension()
                            .and_then(|s| s.to_str())
                            .map(|s| s.eq_ignore_ascii_case("toc"))
                            .unwrap_or(false)
                        {
                            if let Ok(content) = fs::read_to_string(sub_entry.path()) {
                                for line in content.lines() {
                                    let line = line.trim();
                                    if line.starts_with("##") {
                                        let rest = line.trim_start_matches('#').trim();
                                        if let Some((key, val)) = rest.split_once(':') {
                                            let key = key.trim().to_lowercase();
                                            if key == "dependencies" || key == "requireddeps" {
                                                let deps: Vec<String> = val
                                                    .split(',')
                                                    .map(|s| s.trim().to_lowercase())
                                                    .collect();
                                                if deps.contains(&addon_name.to_lowercase()) {
                                                    is_dep = true;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if is_dep {
                            break;
                        }
                    }
                }
            }
            if is_dep {
                break;
            }
        }
    }

    Ok(AddonMeta {
        name: addon_name,
        title,
        author,
        version,
        notes,
        optional_deps,
        optional_deps_installed,
        required_deps,
        toc_file: toc_file_name,
        readme,
        path: Some(addon_path_str),
        git_status: None,
        has_git,
        is_dependency: Some(is_dep),
    })
}

#[tauri::command]
pub fn check_addon_dependencies(
    base_path: String,
    addon_name: String,
) -> std::result::Result<Vec<String>, String> {
    let meta = parse_toc(base_path.clone(), addon_name)?;
    let addons_dir = PathBuf::from(&base_path).join("Interface").join("AddOns");
    let mut missing = Vec::new();
    for dep in meta.required_deps {
        let dep_path = addons_dir.join(&dep);
        let dep_disabled_path = addons_dir.join(format!("{}-disabled", dep));
        if !dep_path.exists() && !dep_disabled_path.exists() {
            missing.push(dep);
        }
    }
    Ok(missing)
}

#[tauri::command]
pub fn check_orphaned_dependencies(base_path: String) -> std::result::Result<Vec<String>, String> {
    let addons = get_addons(base_path.clone())?;
    let mut all_reqs = std::collections::HashSet::new();

    for addon in &addons {
        if let Ok(meta) = parse_toc(base_path.clone(), addon.clone()) {
            for req in meta.required_deps {
                all_reqs.insert(req.to_lowercase());
            }
        }
    }

    let mut orphaned = Vec::new();
    for addon in &addons {
        if let Ok(meta) = parse_toc(base_path.clone(), addon.clone()) {
            if meta.is_dependency == Some(true) && !all_reqs.contains(&addon.to_lowercase()) {
                orphaned.push(addon.clone());
            }
        }
    }
    Ok(orphaned)
}

#[tauri::command]
pub async fn check_addon_git_status(
    base_path: String,
    addon_name: String,
) -> std::result::Result<Option<AddonGitStatus>, String> {
    let addon_path = PathBuf::from(&base_path)
        .join("Interface")
        .join("AddOns")
        .join(&addon_name);
    if !addon_path.exists() || !addon_path.is_dir() {
        return Err("Addon folder not found".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let canonical_addon = fs::canonicalize(&addon_path).map_err(|e| e.to_string())?;
    if !canonical_addon.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }
    Ok(get_addon_git_status(&addon_path).await)
}

#[tauri::command]
pub async fn change_addon_branch(
    base_path: String,
    addon_name: String,
    branch_name: String,
) -> std::result::Result<String, String> {
    if !is_valid_branch_name(&branch_name) {
        return Err("Invalid branch name".into());
    }
    let addon_path = PathBuf::from(&base_path)
        .join("Interface")
        .join("AddOns")
        .join(&addon_name);
    if !addon_path.exists() || !addon_path.is_dir() {
        return Err("Addon folder not found".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let canonical_addon = fs::canonicalize(&addon_path).map_err(|e| e.to_string())?;
    if !canonical_addon.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }
    run_git_command(&addon_path, &["checkout", &branch_name])
        .map_err(|e| format!("Failed to checkout branch '{}': {}", branch_name, e))
}

#[tauri::command]
pub async fn update_addon(
    base_path: String,
    addon_name: String,
) -> std::result::Result<String, String> {
    let addon_path = PathBuf::from(&base_path)
        .join("Interface")
        .join("AddOns")
        .join(&addon_name);
    if !addon_path.exists() || !addon_path.is_dir() {
        return Err("Addon folder not found".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let canonical_addon = fs::canonicalize(&addon_path).map_err(|e| e.to_string())?;
    if !canonical_addon.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }

    if !addon_path.join(".git").exists() {
        let meta_path = addon_path.join(".owl-meta.json");
        if meta_path.exists() {
            if let Ok(content) = fs::read_to_string(&meta_path) {
                if let Ok(owl_meta) = serde_json::from_str::<OwlAddonMeta>(&content) {
                    let (owner, repo, _) = parse_github_repo_url(&owl_meta.remote_url)?;
                    let client = owl_http_client()?;

                    let zip_url = format!(
                        "https://github.com/{}/{}/archive/refs/heads/{}.zip",
                        owner, repo, owl_meta.branch
                    );

                    let resp = client
                        .get(&zip_url)
                        .send()
                        .await
                        .map_err(|e| e.to_string())?;
                    if !resp.status().is_success() {
                        return Err(format!("Failed to download zip: {}", resp.status()));
                    }

                    let latest_sha =
                        fetch_latest_commit_sha(&owner, &repo, &owl_meta.branch).await?;

                    let temp_dir = TempDir::new().map_err(|e| e.to_string())?;
                    let zip_path = temp_dir.path().join("addon.zip");
                    const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024; // 512 MB
                    stream_response_to_file(None, resp, &zip_path, MAX_DOWNLOAD).await?;

                    let extract_dir = temp_dir.path().join("extract");
                    let extracted_root = extract_archive(&zip_path, &extract_dir)?;

                    fs::remove_dir_all(&addon_path).map_err(|e| e.to_string())?;
                    fs::rename(&extracted_root, &addon_path).map_err(|e| e.to_string())?;

                    let new_meta = OwlAddonMeta {
                        remote_url: owl_meta.remote_url,
                        branch: owl_meta.branch,
                        commit_sha: latest_sha,
                    };
                    if let Ok(meta_json) = serde_json::to_string_pretty(&new_meta) {
                        let _ = fs::write(&meta_path, meta_json);
                    }

                    return Ok(format!("Updated addon '{}' (Zip Fallback)", addon_name));
                }
            }
        }
        return Err("Addon is not a git repository".into());
    }

    let changed = has_uncommitted_changes(&addon_path)?;
    if changed {
        let _ = run_git_command(&addon_path, &["stash"]);
    }

    let res = async {
        run_git_command(&addon_path, &["fetch", "--quiet", "--all", "--prune"])
            .map_err(|e| format!("Failed to fetch remote repository: {}", e))?;

        let status = get_addon_git_status(&addon_path)
            .await
            .ok_or("Unable to determine addon git status")?;

        if status.update_available == Some(false) {
            return Ok(format!("Addon '{}' is already up to date", addon_name));
        }

        if let Err(err) = run_git_command(&addon_path, &["pull", "--ff-only", "--quiet"]) {
            // A previous update can leave the repo with unmerged files (a `stash pop`
            // that conflicted), and that blocks every later pull. Throw the conflicted
            // state away and take upstream; the stashed local edits are still listed
            // by `git stash list`.
            if !has_unmerged_paths(&addon_path) {
                return Err(format!("Failed to pull latest addon changes: {}", err));
            }

            run_git_command(&addon_path, &["reset", "--hard", "HEAD"])
                .map_err(|e| format!("Failed to reset conflicted addon repository: {}", e))?;
            run_git_command(&addon_path, &["pull", "--ff-only", "--quiet"])
                .map_err(|e| format!("Failed to pull latest addon changes: {}", e))?;
        }

        Ok(format!(
            "Updated addon '{}'{}",
            addon_name,
            status
                .branch
                .map(|b| format!(" on branch {}", b))
                .unwrap_or_default()
        ))
    }
    .await;

    if changed {
        let _ = run_git_command(&addon_path, &["stash", "pop"]);
    }

    res
}

#[tauri::command]
pub fn toggle_addon(
    base_path: String,
    addon_name: String,
    enable: bool,
) -> std::result::Result<String, String> {
    if addon_name.contains("..") || addon_name.contains('/') || addon_name.contains('\\') {
        return Err("Invalid addon name".into());
    }
    let addons_dir = PathBuf::from(&base_path).join("Interface").join("AddOns");
    if !addons_dir.exists() {
        return Err("AddOns directory not found".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let canonical_addons = fs::canonicalize(&addons_dir).map_err(|e| e.to_string())?;
    if !canonical_addons.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }

    let base_name = if addon_name.ends_with("-disabled") {
        addon_name.trim_end_matches("-disabled").to_string()
    } else {
        addon_name.clone()
    };

    let enabled_path = addons_dir.join(&base_name);
    let disabled_path = addons_dir.join(format!("{}-disabled", base_name));

    if enable {
        if enabled_path.exists() {
            return Ok("Already enabled".into());
        }
        if disabled_path.exists() {
            fs::rename(&disabled_path, &enabled_path).map_err(|e| e.to_string())?;
            return Ok("Enabled".into());
        }
        Err("Addon folder to enable not found".into())
    } else {
        if disabled_path.exists() {
            return Ok("Already disabled".into());
        }
        if enabled_path.exists() {
            fs::rename(&enabled_path, &disabled_path).map_err(|e| e.to_string())?;
            return Ok("Disabled".into());
        }
        Err("Addon folder to disable not found".into())
    }
}

#[tauri::command]
pub fn delete_addon(base_path: String, addon_name: String) -> std::result::Result<String, String> {
    if addon_name.contains("..") || addon_name.contains('/') || addon_name.contains('\\') {
        return Err("Invalid addon name".into());
    }
    let addon_path = PathBuf::from(&base_path)
        .join("Interface")
        .join("AddOns")
        .join(&addon_name);
    if !addon_path.exists() {
        return Err("Addon folder not found".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let canonical_path = fs::canonicalize(&addon_path).map_err(|e| e.to_string())?;
    if !canonical_path.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }
    fs::remove_dir_all(&addon_path).map_err(|e| format!("Failed to delete addon: {}", e))?;
    Ok(format!("Deleted {}", addon_name))
}

#[tauri::command]
pub fn export_addon_list(base_path: String) -> std::result::Result<String, String> {
    let addons_dir = PathBuf::from(&base_path).join("Interface").join("AddOns");
    if !addons_dir.exists() {
        return Err("AddOns directory not found".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let canonical_addons = fs::canonicalize(&addons_dir).map_err(|e| e.to_string())?;
    if !canonical_addons.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }

    let mut exported_addons = Vec::new();
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

        let enabled = !folder_name.ends_with("-disabled");
        let base_name = if folder_name.ends_with("-disabled") {
            folder_name.trim_end_matches("-disabled").to_string()
        } else {
            folder_name.clone()
        };

        // Determine source
        let mut source = "manual".to_string();
        let mut git_url = None;
        let mut branch = None;
        let mut commit_sha = None;
        let mut mod_id = None;
        let mut file_id = None;

        let owl_meta_path = path.join(".owl-meta.json");
        let git_dir = path.join(".git");
        let cf_meta_path = path.join(".curseforge-meta.json");

        if owl_meta_path.exists() {
            if let Ok(content) = fs::read_to_string(&owl_meta_path) {
                if let Ok(meta) = serde_json::from_str::<OwlAddonMeta>(&content) {
                    source = "github".to_string();
                    git_url = Some(meta.remote_url);
                    branch = Some(meta.branch);
                    commit_sha = Some(meta.commit_sha);
                }
            }
        } else if git_dir.exists() {
            if let Ok(remote) = run_git_command(&path, &["remote", "get-url", "origin"]) {
                source = "github".to_string();
                git_url = Some(remote);
                if let Ok(b) = run_git_command(&path, &["rev-parse", "--abbrev-ref", "HEAD"]) {
                    branch = Some(b);
                }
                if let Ok(sha) = run_git_command(&path, &["rev-parse", "HEAD"]) {
                    commit_sha = Some(sha);
                }
            }
        } else if cf_meta_path.exists() {
            if let Ok(content) = fs::read_to_string(&cf_meta_path) {
                if let Ok(meta) = serde_json::from_str::<CurseForgeMeta>(&content) {
                    source = "curseforge".to_string();
                    mod_id = Some(meta.mod_id);
                    file_id = Some(meta.file_id);
                }
            }
        }

        exported_addons.push(ExportedAddon {
            name: base_name,
            enabled,
            source,
            git_url,
            branch,
            commit_sha,
            mod_id,
            file_id,
        });
    }

    if exported_addons.is_empty() {
        return Err("No addons to export".into());
    }

    let payload = ExportPayload {
        v: 1,
        addons: exported_addons,
    };

    let json_str = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let b64 = STANDARD.encode(json_str);
    Ok(b64)
}

#[tauri::command]
pub fn validate_import_string(import_str: String) -> std::result::Result<ExportPayload, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let decoded_bytes = STANDARD
        .decode(import_str.trim())
        .map_err(|e| e.to_string())?;
    let json_str = String::from_utf8(decoded_bytes).map_err(|e| e.to_string())?;
    let payload = serde_json::from_str::<ExportPayload>(&json_str).map_err(|e| e.to_string())?;
    if payload.v != 1 {
        return Err(format!("Unsupported export payload version: {}", payload.v));
    }
    Ok(payload)
}

#[tauri::command]
pub fn get_installed_addons_source_meta(
    base_path: String,
) -> std::result::Result<Vec<InstalledAddonSourceMeta>, String> {
    let addons_dir = PathBuf::from(&base_path).join("Interface").join("AddOns");
    if !addons_dir.exists() {
        return Ok(Vec::new());
    }
    let mut list = Vec::new();
    if let Ok(entries) = fs::read_dir(&addons_dir) {
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

            let mut git_url = None;
            let mut mod_id = None;

            let owl_meta_path = path.join(".owl-meta.json");
            let git_dir = path.join(".git");
            let cf_meta_path = path.join(".curseforge-meta.json");

            if owl_meta_path.exists() {
                if let Ok(content) = fs::read_to_string(&owl_meta_path) {
                    if let Ok(meta) = serde_json::from_str::<OwlAddonMeta>(&content) {
                        git_url = Some(meta.remote_url);
                    }
                }
            } else if git_dir.exists() {
                if let Ok(remote) = run_git_command(&path, &["remote", "get-url", "origin"]) {
                    git_url = Some(remote);
                }
            } else if cf_meta_path.exists() {
                if let Ok(content) = fs::read_to_string(&cf_meta_path) {
                    if let Ok(meta) = serde_json::from_str::<CurseForgeMeta>(&content) {
                        mod_id = Some(meta.mod_id);
                    }
                }
            }

            list.push(InstalledAddonSourceMeta {
                name: base_name,
                mod_id,
                git_url,
            });
        }
    }
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use tempfile::tempdir;

    fn git(dir: &std::path::Path, args: &[&str]) -> String {
        let mut full = vec![
            "-c",
            "user.name=owl-test",
            "-c",
            "user.email=owl@test",
            "-c",
            "commit.gpgsign=false",
        ];
        full.extend_from_slice(args);
        match run_git_command(dir, &full) {
            Ok(out) => out,
            Err(e) => panic!("git {:?} failed in {}: {}", args, dir.display(), e),
        }
    }

    /// `Result::unwrap_err` requires `T: Debug`, which several return types here don't
    /// derive; `.err()` only needs `E: Debug`.
    fn err_of<T>(res: std::result::Result<T, String>) -> String {
        res.err().unwrap()
    }

    fn addons_dir(base: &std::path::Path) -> std::path::PathBuf {
        base.join("Interface").join("AddOns")
    }

    fn make_addon(base: &std::path::Path, name: &str) -> std::path::PathBuf {
        let dir = addons_dir(base).join(name);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Bare `origin.git` seeded with one commit on `main`, plus the throwaway `seed`
    /// clone (left under `root`) that can push further commits to it.
    fn bare_origin_with_commit(root: &std::path::Path) -> std::path::PathBuf {
        let origin = root.join("origin.git");
        git(
            root,
            &["init", "--quiet", "--bare", "-b", "main", "origin.git"],
        );
        git(
            root,
            &["clone", "--quiet", origin.to_str().unwrap(), "seed"],
        );
        let seed = root.join("seed");
        git(&seed, &["commit", "--quiet", "--allow-empty", "-m", "c1"]);
        git(&seed, &["push", "--quiet", "origin", "main"]);
        origin
    }

    // -- get_addons --

    #[test]
    fn test_get_addons_no_dir_returns_empty() {
        let dir = tempdir().unwrap();
        let res = get_addons(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(res.is_empty());
    }

    #[test]
    fn test_get_addons_lists_dirs_sorted_skips_hidden_and_files() {
        let dir = tempdir().unwrap();
        make_addon(dir.path(), "Zeta");
        make_addon(dir.path(), "Alpha");
        make_addon(dir.path(), ".hidden");
        fs::write(addons_dir(dir.path()).join("stray.txt"), "x").unwrap();

        let res = get_addons(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(res, vec!["Alpha".to_string(), "Zeta".to_string()]);
    }

    // -- parse_toc --

    #[test]
    fn test_parse_toc_folder_not_found() {
        let dir = tempdir().unwrap();
        let res = parse_toc(dir.path().to_string_lossy().to_string(), "Foo".to_string());
        assert_eq!(err_of(res), "Addon folder not found");
    }

    #[test]
    fn test_parse_toc_no_toc_file_defaults() {
        let dir = tempdir().unwrap();
        make_addon(dir.path(), "Foo");
        let meta = parse_toc(dir.path().to_string_lossy().to_string(), "Foo".to_string()).unwrap();
        assert_eq!(meta.name, "Foo");
        assert_eq!(meta.title, None);
        assert_eq!(meta.toc_file, None);
        assert!(!meta.has_git);
        assert_eq!(meta.is_dependency, Some(false));
    }

    #[test]
    fn test_parse_toc_parses_fields_readme_and_optional_deps() {
        let dir = tempdir().unwrap();
        let foo = make_addon(dir.path(), "Foo");
        make_addon(dir.path(), "Installed-Optional");
        fs::write(
            foo.join("Foo.toc"),
            "## Title: Foo Addon\n## Author: Someone\n## Version: 1.0\n## Notes: hi\n## OptionalDeps: Installed-Optional, Missing-Optional\n## Dependencies: Bar\n",
        )
        .unwrap();
        fs::write(foo.join("README.md"), "hello readme").unwrap();
        fs::write(foo.join(".git"), "gitdir: ../.git/modules/Foo").unwrap();

        let meta = parse_toc(dir.path().to_string_lossy().to_string(), "Foo".to_string()).unwrap();
        assert_eq!(meta.title, Some("Foo Addon".to_string()));
        assert_eq!(meta.author, Some("Someone".to_string()));
        assert_eq!(meta.version, Some("1.0".to_string()));
        assert_eq!(meta.notes, Some("hi".to_string()));
        assert_eq!(
            meta.optional_deps,
            vec![
                "Installed-Optional".to_string(),
                "Missing-Optional".to_string()
            ]
        );
        assert_eq!(meta.optional_deps_installed, vec![true, false]);
        assert_eq!(meta.required_deps, vec!["Bar".to_string()]);
        assert_eq!(meta.toc_file, Some("Foo.toc".to_string()));
        assert_eq!(meta.readme, Some("hello readme".to_string()));
        assert!(meta.has_git);
    }

    #[test]
    fn test_parse_toc_is_dependency_true_when_listed_in_sibling_toc() {
        let dir = tempdir().unwrap();
        make_addon(dir.path(), "Bar");
        let foo = make_addon(dir.path(), "Foo");
        fs::write(foo.join("Foo.toc"), "## Dependencies: Bar\n").unwrap();

        let meta = parse_toc(dir.path().to_string_lossy().to_string(), "Bar".to_string()).unwrap();
        assert_eq!(meta.is_dependency, Some(true));
    }

    // -- check_addon_dependencies --

    #[test]
    fn test_check_addon_dependencies_missing_present_and_disabled() {
        let dir = tempdir().unwrap();
        let foo = make_addon(dir.path(), "Foo");
        make_addon(dir.path(), "Bar");
        make_addon(dir.path(), "Baz-disabled");
        fs::write(foo.join("Foo.toc"), "## Dependencies: Bar, Baz, Qux\n").unwrap();

        let missing =
            check_addon_dependencies(dir.path().to_string_lossy().to_string(), "Foo".to_string())
                .unwrap();
        assert_eq!(missing, vec!["Qux".to_string()]);
    }

    // -- check_orphaned_dependencies --

    #[test]
    fn test_check_orphaned_dependencies_detects_orphan_and_excludes_required() {
        // `all_reqs` is built only from `get_addons`' (visible, non-dot-prefixed) list,
        // while `parse_toc`'s own `is_dependency` scan reads every directory entry
        // unfiltered. A dot-prefixed folder's `Dependencies:` line is therefore invisible
        // to `all_reqs` but still flips `is_dependency` on the addon it names --
        // that mismatch is what "orphaned" actually detects.
        let dir = tempdir().unwrap();
        let foo = make_addon(dir.path(), "Foo");
        make_addon(dir.path(), "Bar");
        make_addon(dir.path(), "Orphan");
        let hidden = make_addon(dir.path(), ".Hidden");
        fs::write(foo.join("Foo.toc"), "## Dependencies: Bar\n").unwrap();
        fs::write(hidden.join("Hidden.toc"), "## Dependencies: Orphan\n").unwrap();

        let orphaned =
            check_orphaned_dependencies(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(orphaned, vec!["Orphan".to_string()]);
    }

    // -- check_addon_git_status --

    #[test]
    fn test_check_addon_git_status_folder_not_found() {
        let dir = tempdir().unwrap();
        let res = tauri::async_runtime::block_on(check_addon_git_status(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
        ));
        assert_eq!(err_of(res), "Addon folder not found");
    }

    #[test]
    fn test_check_addon_git_status_traversal_blocked_via_symlink() {
        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let dir = addons_dir(base.path());
        fs::create_dir_all(&dir).unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.join("Foo")).unwrap();

        let res = tauri::async_runtime::block_on(check_addon_git_status(
            base.path().to_string_lossy().to_string(),
            "Foo".to_string(),
        ));
        assert_eq!(err_of(res), "Directory traversal attempt blocked");
    }

    #[test]
    fn test_check_addon_git_status_success_real_repo() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let addon = make_addon(dir.path(), "Foo");
        git(&addon, &["init", "--quiet", "-b", "main"]);
        fs::write(addon.join("f.txt"), "hi").unwrap();
        git(&addon, &["add", "."]);
        git(&addon, &["commit", "--quiet", "-m", "c1"]);

        let res = tauri::async_runtime::block_on(check_addon_git_status(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
        ))
        .unwrap();
        assert!(res.is_some());
    }

    // -- change_addon_branch --

    #[test]
    fn test_change_addon_branch_invalid_name() {
        let res = tauri::async_runtime::block_on(change_addon_branch(
            "/base".to_string(),
            "Foo".to_string(),
            "bad name".to_string(),
        ));
        assert_eq!(res.unwrap_err(), "Invalid branch name");
    }

    #[test]
    fn test_change_addon_branch_folder_not_found() {
        let dir = tempdir().unwrap();
        let res = tauri::async_runtime::block_on(change_addon_branch(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
            "main".to_string(),
        ));
        assert_eq!(res.unwrap_err(), "Addon folder not found");
    }

    #[test]
    fn test_change_addon_branch_traversal_blocked_via_symlink() {
        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let dir = addons_dir(base.path());
        fs::create_dir_all(&dir).unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.join("Foo")).unwrap();

        let res = tauri::async_runtime::block_on(change_addon_branch(
            base.path().to_string_lossy().to_string(),
            "Foo".to_string(),
            "main".to_string(),
        ));
        assert_eq!(res.unwrap_err(), "Directory traversal attempt blocked");
    }

    #[test]
    fn test_change_addon_branch_success() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let addon = make_addon(dir.path(), "Foo");
        git(&addon, &["init", "--quiet", "-b", "main"]);
        fs::write(addon.join("f.txt"), "hi").unwrap();
        git(&addon, &["add", "."]);
        git(&addon, &["commit", "--quiet", "-m", "c1"]);
        git(&addon, &["checkout", "--quiet", "-b", "other"]);
        git(&addon, &["checkout", "--quiet", "main"]);

        let res = tauri::async_runtime::block_on(change_addon_branch(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
            "other".to_string(),
        ));
        assert!(res.is_ok());
        assert_eq!(git(&addon, &["rev-parse", "--abbrev-ref", "HEAD"]), "other");
    }

    // -- update_addon --

    #[test]
    fn test_update_addon_folder_not_found() {
        let dir = tempdir().unwrap();
        let res = tauri::async_runtime::block_on(update_addon(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
        ));
        assert_eq!(res.unwrap_err(), "Addon folder not found");
    }

    #[test]
    fn test_update_addon_traversal_blocked_via_symlink() {
        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let dir = addons_dir(base.path());
        fs::create_dir_all(&dir).unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.join("Foo")).unwrap();

        let res = tauri::async_runtime::block_on(update_addon(
            base.path().to_string_lossy().to_string(),
            "Foo".to_string(),
        ));
        assert_eq!(res.unwrap_err(), "Directory traversal attempt blocked");
    }

    #[test]
    fn test_update_addon_not_git_no_meta_errors() {
        let dir = tempdir().unwrap();
        make_addon(dir.path(), "Foo");
        let res = tauri::async_runtime::block_on(update_addon(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
        ));
        assert_eq!(res.unwrap_err(), "Addon is not a git repository");
    }

    #[test]
    fn test_update_addon_meta_invalid_remote_url_errors() {
        let dir = tempdir().unwrap();
        let addon = make_addon(dir.path(), "Foo");
        let meta = OwlAddonMeta {
            remote_url: "not-a-url".to_string(),
            branch: "main".to_string(),
            commit_sha: "abc".to_string(),
        };
        fs::write(
            addon.join(".owl-meta.json"),
            serde_json::to_string(&meta).unwrap(),
        )
        .unwrap();

        let res = tauri::async_runtime::block_on(update_addon(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
        ));
        assert_eq!(
            res.unwrap_err(),
            "GitHub URL must start with http:// or https://"
        );
    }

    #[test]
    fn test_update_addon_meta_malformed_json_falls_through_to_not_git_repo_err() {
        let dir = tempdir().unwrap();
        let addon = make_addon(dir.path(), "Foo");
        fs::write(addon.join(".owl-meta.json"), "not json").unwrap();

        let res = tauri::async_runtime::block_on(update_addon(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
        ));
        assert_eq!(res.unwrap_err(), "Addon is not a git repository");
    }

    #[test]
    fn test_update_addon_already_up_to_date() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let root = dir.path();
        let origin = bare_origin_with_commit(root);
        let addon = addons_dir(root).join("Foo");
        fs::create_dir_all(addon.parent().unwrap()).unwrap();
        git(
            root,
            &[
                "clone",
                "--quiet",
                origin.to_str().unwrap(),
                addon.to_str().unwrap(),
            ],
        );

        let res = tauri::async_runtime::block_on(update_addon(
            root.to_string_lossy().to_string(),
            "Foo".to_string(),
        ))
        .unwrap();
        assert_eq!(res, "Addon 'Foo' is already up to date");
    }

    #[test]
    fn test_update_addon_pulls_when_behind() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let root = dir.path();
        let origin = bare_origin_with_commit(root);
        let addon = addons_dir(root).join("Foo");
        fs::create_dir_all(addon.parent().unwrap()).unwrap();
        git(
            root,
            &[
                "clone",
                "--quiet",
                origin.to_str().unwrap(),
                addon.to_str().unwrap(),
            ],
        );

        // Upstream moves ahead after the clone.
        let seed = root.join("seed");
        git(&seed, &["commit", "--quiet", "--allow-empty", "-m", "c2"]);
        git(&seed, &["push", "--quiet", "origin", "main"]);

        let res = tauri::async_runtime::block_on(update_addon(
            root.to_string_lossy().to_string(),
            "Foo".to_string(),
        ))
        .unwrap();
        assert_eq!(res, "Updated addon 'Foo' on branch main");
        assert_eq!(
            git(&addon, &["rev-parse", "HEAD"]),
            git(&seed, &["rev-parse", "HEAD"])
        );
    }

    #[test]
    fn test_update_addon_conflicted_pull_recovers_via_reset_hard() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let root = dir.path();
        let origin = root.join("origin.git");
        fs::create_dir_all(&origin).unwrap();
        git(
            root,
            &["init", "--quiet", "--bare", "-b", "main", "origin.git"],
        );
        git(
            root,
            &["clone", "--quiet", origin.to_str().unwrap(), "seed"],
        );
        let seed = root.join("seed");
        fs::write(seed.join("f.txt"), "line1\nline2\nline3\n").unwrap();
        git(&seed, &["add", "."]);
        git(&seed, &["commit", "--quiet", "-m", "c1"]);
        git(&seed, &["push", "--quiet", "origin", "main"]);

        let addon = addons_dir(root).join("Foo");
        fs::create_dir_all(addon.parent().unwrap()).unwrap();
        git(
            root,
            &[
                "clone",
                "--quiet",
                origin.to_str().unwrap(),
                addon.to_str().unwrap(),
            ],
        );

        // Local edit, stashed away, that will conflict with an upstream change to the
        // same line -- this is what leaves the repo with unmerged paths.
        fs::write(addon.join("f.txt"), "line1\nLOCAL\nline3\n").unwrap();
        git(&addon, &["stash", "--quiet"]);
        fs::write(seed.join("f.txt"), "line1\nUPSTREAM\nline3\n").unwrap();
        git(&seed, &["commit", "--quiet", "-am", "c2"]);
        git(&seed, &["push", "--quiet", "origin", "main"]);
        git(&addon, &["pull", "--quiet", "--ff-only"]);
        let _ = run_git_command(&addon, &["stash", "pop"]);
        assert!(has_unmerged_paths(&addon), "expected conflicted state");
        // Drop the leftover stash entry: `update_addon` cannot stash an already-unmerged
        // tree (git refuses), so its own trailing unconditional `stash pop` would
        // otherwise reapply this same conflicting stash and reintroduce the conflict.
        let _ = run_git_command(&addon, &["stash", "drop"]);

        // Upstream moves again so `update_addon`'s own pull has something to fetch.
        fs::write(seed.join("f.txt"), "line1\nUPSTREAM\nMORE\n").unwrap();
        git(&seed, &["commit", "--quiet", "-am", "c3"]);
        git(&seed, &["push", "--quiet", "origin", "main"]);

        let res = tauri::async_runtime::block_on(update_addon(
            root.to_string_lossy().to_string(),
            "Foo".to_string(),
        ));
        assert!(res.is_ok(), "expected recovery via reset --hard: {:?}", res);
        assert!(!has_unmerged_paths(&addon));
    }

    // -- toggle_addon --

    #[test]
    fn test_toggle_addon_invalid_name() {
        assert_eq!(
            toggle_addon("/base".to_string(), "../evil".to_string(), true).unwrap_err(),
            "Invalid addon name"
        );
        assert_eq!(
            toggle_addon("/base".to_string(), "sub/evil".to_string(), true).unwrap_err(),
            "Invalid addon name"
        );
        assert_eq!(
            toggle_addon("/base".to_string(), "sub\\evil".to_string(), true).unwrap_err(),
            "Invalid addon name"
        );
    }

    #[test]
    fn test_toggle_addon_dir_missing() {
        let dir = tempdir().unwrap();
        let res = toggle_addon(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
            true,
        );
        assert_eq!(res.unwrap_err(), "AddOns directory not found");
    }

    #[test]
    fn test_toggle_addon_traversal_blocked_via_symlink() {
        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface")).unwrap();
        std::os::unix::fs::symlink(outside.path(), addons_dir(base.path())).unwrap();

        let res = toggle_addon(
            base.path().to_string_lossy().to_string(),
            "Foo".to_string(),
            true,
        );
        assert_eq!(res.unwrap_err(), "Directory traversal attempt blocked");
    }

    #[test]
    fn test_toggle_addon_enable_already_enabled() {
        let dir = tempdir().unwrap();
        make_addon(dir.path(), "Foo");
        let res = toggle_addon(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
            true,
        );
        assert_eq!(res.unwrap(), "Already enabled");
    }

    #[test]
    fn test_toggle_addon_enable_from_disabled() {
        let dir = tempdir().unwrap();
        make_addon(dir.path(), "Foo-disabled");
        let res = toggle_addon(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
            true,
        );
        assert_eq!(res.unwrap(), "Enabled");
        assert!(addons_dir(dir.path()).join("Foo").exists());
    }

    #[test]
    fn test_toggle_addon_enable_not_found() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(addons_dir(dir.path())).unwrap();
        let res = toggle_addon(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
            true,
        );
        assert_eq!(res.unwrap_err(), "Addon folder to enable not found");
    }

    #[test]
    fn test_toggle_addon_disable_already_disabled() {
        let dir = tempdir().unwrap();
        make_addon(dir.path(), "Foo-disabled");
        let res = toggle_addon(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
            false,
        );
        assert_eq!(res.unwrap(), "Already disabled");
    }

    #[test]
    fn test_toggle_addon_disable_from_enabled() {
        let dir = tempdir().unwrap();
        make_addon(dir.path(), "Foo");
        let res = toggle_addon(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
            false,
        );
        assert_eq!(res.unwrap(), "Disabled");
        assert!(addons_dir(dir.path()).join("Foo-disabled").exists());
    }

    #[test]
    fn test_toggle_addon_disable_not_found() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(addons_dir(dir.path())).unwrap();
        let res = toggle_addon(
            dir.path().to_string_lossy().to_string(),
            "Foo".to_string(),
            false,
        );
        assert_eq!(res.unwrap_err(), "Addon folder to disable not found");
    }

    // -- delete_addon --

    #[test]
    fn test_delete_addon_invalid_name() {
        let res = delete_addon("/base".to_string(), "../evil".to_string());
        assert_eq!(res.unwrap_err(), "Invalid addon name");
    }

    #[test]
    fn test_delete_addon_not_found() {
        let dir = tempdir().unwrap();
        let res = delete_addon(dir.path().to_string_lossy().to_string(), "Foo".to_string());
        assert_eq!(res.unwrap_err(), "Addon folder not found");
    }

    #[test]
    fn test_delete_addon_traversal_blocked_via_symlink() {
        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let dir = addons_dir(base.path());
        fs::create_dir_all(&dir).unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.join("Foo")).unwrap();

        let res = delete_addon(base.path().to_string_lossy().to_string(), "Foo".to_string());
        assert_eq!(res.unwrap_err(), "Directory traversal attempt blocked");
    }

    #[test]
    fn test_delete_addon_success() {
        let dir = tempdir().unwrap();
        make_addon(dir.path(), "Foo");
        let res = delete_addon(dir.path().to_string_lossy().to_string(), "Foo".to_string());
        assert_eq!(res.unwrap(), "Deleted Foo");
        assert!(!addons_dir(dir.path()).join("Foo").exists());
    }

    // -- export_addon_list --

    #[test]
    fn test_export_addon_list_dir_missing() {
        let dir = tempdir().unwrap();
        let res = export_addon_list(dir.path().to_string_lossy().to_string());
        assert_eq!(res.unwrap_err(), "AddOns directory not found");
    }

    #[test]
    fn test_export_addon_list_traversal_blocked_via_symlink() {
        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::create_dir_all(base.path().join("Interface")).unwrap();
        std::os::unix::fs::symlink(outside.path(), addons_dir(base.path())).unwrap();

        let res = export_addon_list(base.path().to_string_lossy().to_string());
        assert_eq!(res.unwrap_err(), "Directory traversal attempt blocked");
    }

    #[test]
    fn test_export_addon_list_empty_is_err() {
        let dir = tempdir().unwrap();
        make_addon(dir.path(), "Blizzard_UIParty");
        fs::write(addons_dir(dir.path()).join("stray.txt"), "x").unwrap();
        let res = export_addon_list(dir.path().to_string_lossy().to_string());
        assert_eq!(res.unwrap_err(), "No addons to export");
    }

    #[test]
    fn test_export_addon_list_all_sources_and_disabled() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();

        let gh = make_addon(dir.path(), "GhAddon");
        let owl_meta = OwlAddonMeta {
            remote_url: "https://github.com/owner/repo".to_string(),
            branch: "main".to_string(),
            commit_sha: "abc123".to_string(),
        };
        fs::write(
            gh.join(".owl-meta.json"),
            serde_json::to_string(&owl_meta).unwrap(),
        )
        .unwrap();

        let git_addon = make_addon(dir.path(), "GitAddon-disabled");
        git(&git_addon, &["init", "--quiet", "-b", "main"]);
        fs::write(git_addon.join("f.txt"), "hi").unwrap();
        git(&git_addon, &["add", "."]);
        git(&git_addon, &["commit", "--quiet", "-m", "c1"]);
        git(
            &git_addon,
            &["remote", "add", "origin", "https://github.com/owner/other"],
        );

        let cf = make_addon(dir.path(), "CfAddon");
        let cf_meta = CurseForgeMeta {
            mod_id: 42,
            file_id: 7,
        };
        fs::write(
            cf.join(".curseforge-meta.json"),
            serde_json::to_string(&cf_meta).unwrap(),
        )
        .unwrap();

        make_addon(dir.path(), "ManualAddon");
        make_addon(dir.path(), "Blizzard_UIParty");

        let b64 = export_addon_list(dir.path().to_string_lossy().to_string()).unwrap();
        let decoded = STANDARD.decode(&b64).unwrap();
        let payload: ExportPayload = serde_json::from_slice(&decoded).unwrap();
        assert_eq!(payload.v, 1);
        assert_eq!(payload.addons.len(), 4);

        let by_name = |n: &str| payload.addons.iter().find(|a| a.name == n).unwrap();

        let gh_entry = by_name("GhAddon");
        assert_eq!(gh_entry.source, "github");
        assert!(gh_entry.enabled);
        assert_eq!(
            gh_entry.git_url,
            Some("https://github.com/owner/repo".to_string())
        );
        assert_eq!(gh_entry.commit_sha, Some("abc123".to_string()));

        let git_entry = by_name("GitAddon");
        assert_eq!(git_entry.source, "github");
        assert!(!git_entry.enabled);
        assert_eq!(
            git_entry.git_url,
            Some("https://github.com/owner/other".to_string())
        );
        assert_eq!(git_entry.branch, Some("main".to_string()));
        assert!(git_entry.commit_sha.is_some());

        let cf_entry = by_name("CfAddon");
        assert_eq!(cf_entry.source, "curseforge");
        assert_eq!(cf_entry.mod_id, Some(42));
        assert_eq!(cf_entry.file_id, Some(7));

        let manual_entry = by_name("ManualAddon");
        assert_eq!(manual_entry.source, "manual");
    }

    // -- validate_import_string --

    #[test]
    fn test_validate_import_string_roundtrip_success() {
        let payload = ExportPayload {
            v: 1,
            addons: vec![ExportedAddon {
                name: "Foo".to_string(),
                enabled: true,
                source: "manual".to_string(),
                git_url: None,
                branch: None,
                commit_sha: None,
                mod_id: None,
                file_id: None,
            }],
        };
        let json = serde_json::to_string(&payload).unwrap();
        let b64 = STANDARD.encode(json);

        let res = validate_import_string(b64).unwrap();
        assert_eq!(res.v, 1);
        assert_eq!(res.addons.len(), 1);
        assert_eq!(res.addons[0].name, "Foo");
    }

    #[test]
    fn test_validate_import_string_invalid_base64() {
        let res = validate_import_string("not valid base64!!".to_string());
        assert!(res.is_err());
    }

    #[test]
    fn test_validate_import_string_invalid_utf8() {
        let b64 = STANDARD.encode([0xff, 0xfe, 0xfd]);
        let res = validate_import_string(b64);
        assert!(res.is_err());
    }

    #[test]
    fn test_validate_import_string_invalid_json() {
        let b64 = STANDARD.encode("not json");
        let res = validate_import_string(b64);
        assert!(res.is_err());
    }

    #[test]
    fn test_validate_import_string_wrong_version() {
        let json = r#"{"v":2,"addons":[]}"#;
        let b64 = STANDARD.encode(json);
        let res = validate_import_string(b64);
        assert_eq!(err_of(res), "Unsupported export payload version: 2");
    }

    // -- get_installed_addons_source_meta --

    #[test]
    fn test_get_installed_addons_source_meta_dir_missing_is_empty() {
        let dir = tempdir().unwrap();
        let res =
            get_installed_addons_source_meta(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(res.is_empty());
    }

    #[test]
    fn test_get_installed_addons_source_meta_all_sources_and_disabled() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();

        let gh = make_addon(dir.path(), "GhAddon-disabled");
        let owl_meta = OwlAddonMeta {
            remote_url: "https://github.com/owner/repo".to_string(),
            branch: "main".to_string(),
            commit_sha: "abc123".to_string(),
        };
        fs::write(
            gh.join(".owl-meta.json"),
            serde_json::to_string(&owl_meta).unwrap(),
        )
        .unwrap();

        let git_addon = make_addon(dir.path(), "GitAddon");
        git(&git_addon, &["init", "--quiet", "-b", "main"]);
        fs::write(git_addon.join("f.txt"), "hi").unwrap();
        git(&git_addon, &["add", "."]);
        git(&git_addon, &["commit", "--quiet", "-m", "c1"]);
        git(
            &git_addon,
            &["remote", "add", "origin", "https://github.com/owner/other"],
        );

        let cf = make_addon(dir.path(), "CfAddon");
        let cf_meta = CurseForgeMeta {
            mod_id: 42,
            file_id: 7,
        };
        fs::write(
            cf.join(".curseforge-meta.json"),
            serde_json::to_string(&cf_meta).unwrap(),
        )
        .unwrap();

        make_addon(dir.path(), "ManualAddon");
        make_addon(dir.path(), "Blizzard_UIParty");

        let res =
            get_installed_addons_source_meta(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(res.len(), 4);

        let by_name = |n: &str| res.iter().find(|a| a.name == n).unwrap();
        assert_eq!(
            by_name("GhAddon").git_url,
            Some("https://github.com/owner/repo".to_string())
        );
        assert_eq!(
            by_name("GitAddon").git_url,
            Some("https://github.com/owner/other".to_string())
        );
        assert_eq!(by_name("CfAddon").mod_id, Some(42));
        assert_eq!(by_name("ManualAddon").git_url, None);
        assert_eq!(by_name("ManualAddon").mod_id, None);
    }
}
