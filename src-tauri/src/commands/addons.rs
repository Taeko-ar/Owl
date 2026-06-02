use tempfile::TempDir;
use std::fs;
use std::path::PathBuf;
use crate::models::*;
use crate::git::*;
use crate::archive::*;
use crate::github::*;
use crate::fs_utils::owl_http_client;

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
        .collect();

    addons.sort();
    Ok(addons)
}

#[tauri::command]
pub fn parse_toc(base_path: String, addon_name: String) -> std::result::Result<AddonMeta, String> {
    let addon_path = PathBuf::from(&base_path).join("Interface").join("AddOns").join(&addon_name);
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
                                    optional_deps = val.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                                }
                                "dependencies" | "requireddeps" => {
                                    required_deps = val.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
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
            readme = Some(fs::read_to_string(p).map_err(|e| e.to_string())?);
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
                        if sub_entry.path().extension().and_then(|s| s.to_str()).map(|s| s.eq_ignore_ascii_case("toc")).unwrap_or(false) {
                            if let Ok(content) = fs::read_to_string(sub_entry.path()) {
                                for line in content.lines() {
                                    let line = line.trim();
                                    if line.starts_with("##") {
                                        let rest = line.trim_start_matches('#').trim();
                                        if let Some((key, val)) = rest.split_once(':') {
                                            let key = key.trim().to_lowercase();
                                            if key == "dependencies" || key == "requireddeps" {
                                                let deps: Vec<String> = val.split(',').map(|s| s.trim().to_lowercase()).collect();
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
pub fn check_addon_dependencies(base_path: String, addon_name: String) -> std::result::Result<Vec<String>, String> {
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
pub async fn check_addon_git_status(base_path: String, addon_name: String) -> std::result::Result<Option<AddonGitStatus>, String> {
    let addon_path = PathBuf::from(&base_path).join("Interface").join("AddOns").join(&addon_name);
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
pub async fn change_addon_branch(base_path: String, addon_name: String, branch_name: String) -> std::result::Result<String, String> {
    if !is_valid_branch_name(&branch_name) {
        return Err("Invalid branch name".into());
    }
    let addon_path = PathBuf::from(&base_path).join("Interface").join("AddOns").join(&addon_name);
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
pub async fn update_addon(base_path: String, addon_name: String) -> std::result::Result<String, String> {
    let addon_path = PathBuf::from(&base_path).join("Interface").join("AddOns").join(&addon_name);
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

                    let resp = client.get(&zip_url).send().await.map_err(|e| e.to_string())?;
                    if !resp.status().is_success() {
                        return Err(format!("Failed to download zip: {}", resp.status()));
                    }

                    let latest_sha = fetch_latest_commit_sha(&owner, &repo, &owl_meta.branch).await?;

                    let temp_dir = TempDir::new().map_err(|e| e.to_string())?;
                    let zip_path = temp_dir.path().join("addon.zip");
                    let mut file = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
                    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
                    std::io::copy(&mut &bytes[..], &mut file).map_err(|e| e.to_string())?;

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

        let status = get_addon_git_status(&addon_path).await.ok_or("Unable to determine addon git status")?;

        if status.update_available == Some(false) {
            return Ok(format!("Addon '{}' is already up to date", addon_name));
        }

        run_git_command(&addon_path, &["pull", "--ff-only", "--quiet"])
            .map_err(|e| format!("Failed to pull latest addon changes: {}", e))?;

        Ok(format!("Updated addon '{}'{}", addon_name, status.branch.map(|b| format!(" on branch {}", b)).unwrap_or_default()))
    }.await;

    if changed {
        let _ = run_git_command(&addon_path, &["stash", "pop"]);
    }

    res
}

#[tauri::command]
pub fn toggle_addon(base_path: String, addon_name: String, enable: bool) -> std::result::Result<String, String> {
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
        return Err("Addon folder to enable not found".into());
    } else {
        if disabled_path.exists() {
            return Ok("Already disabled".into());
        }
        if enabled_path.exists() {
            fs::rename(&enabled_path, &disabled_path).map_err(|e| e.to_string())?;
            return Ok("Disabled".into());
        }
        return Err("Addon folder to disable not found".into());
    }
}

#[tauri::command]
pub fn delete_addon(base_path: String, addon_name: String) -> std::result::Result<String, String> {
    if addon_name.contains("..") || addon_name.contains('/') || addon_name.contains('\\') {
        return Err("Invalid addon name".into());
    }
    let addon_path = PathBuf::from(&base_path).join("Interface").join("AddOns").join(&addon_name);
    if !addon_path.exists() {
        return Err("Addon folder not found".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let canonical_path = fs::canonicalize(&addon_path).map_err(|e| e.to_string())?;
    if !canonical_path.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }
    fs::remove_dir_all(&addon_path)
        .map_err(|e| format!("Failed to delete addon: {}", e))?;
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
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let b64 = STANDARD.encode(json_str);
    Ok(b64)
}

#[tauri::command]
pub fn validate_import_string(import_str: String) -> std::result::Result<ExportPayload, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let decoded_bytes = STANDARD.decode(import_str.trim()).map_err(|e| e.to_string())?;
    let json_str = String::from_utf8(decoded_bytes).map_err(|e| e.to_string())?;
    let payload = serde_json::from_str::<ExportPayload>(&json_str).map_err(|e| e.to_string())?;
    if payload.v != 1 {
        return Err(format!("Unsupported export payload version: {}", payload.v));
    }
    Ok(payload)
}
