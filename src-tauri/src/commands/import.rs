use tempfile::TempDir;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use crate::models::*;
use crate::fs_utils::*;
use crate::git::*;
use crate::archive::*;
use crate::github::*;

#[tauri::command]
pub async fn import_addon(base_path: String, repo_url: String) -> std::result::Result<String, String> {
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
    let git_installed = check_cmd.output().map(|o| o.status.success()).unwrap_or(false);

    if git_installed {
        let clone_url = format!("https://github.com/{}/{}.git", owner, repo);
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

        let output = cmd.output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        Ok(format!("Imported addon {} from GitHub", repo))
    } else {
        let client = owl_http_client()?;

        let branch_name = branch.unwrap_or_else(|| "main".to_string());
        let zip_url = format!(
            "https://github.com/{}/{}/archive/refs/heads/{}.zip",
            owner, repo, branch_name
        );

        let mut resp = client.get(&zip_url).send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            if branch_name == "main" {
                let fallback_url = format!(
                    "https://github.com/{}/{}/archive/refs/heads/master.zip",
                    owner, repo
                );
                let resp2 = client.get(&fallback_url).send().await.map_err(|e| e.to_string())?;
                if resp2.status().is_success() {
                    resp = resp2;
                } else {
                    return Err(format!("Failed to download zip: {}", resp.status()));
                }
            } else {
                return Err(format!("Failed to download zip: {}", resp.status()));
            }
        }

        let latest_sha = fetch_latest_commit_sha(&owner, &repo, &branch_name).await.unwrap_or_default();

        let temp_dir = TempDir::new().map_err(|e| e.to_string())?;
        let zip_path = temp_dir.path().join("addon.zip");
        let mut file = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        std::io::copy(&mut &bytes[..], &mut file).map_err(|e| e.to_string())?;

        let extract_dir = temp_dir.path().join("extract");
        let extracted_root = extract_archive(&zip_path, &extract_dir)?;

        let validation = validate_addon_archive(&extracted_root, &repo)?;
        match validation {
            ArchiveValidation::Valid { .. } | ArchiveValidation::Bundled { .. } => {}
            ArchiveValidation::HasLooseFiles { filename } => return Err(format!("LOOSE_FILES:{}", filename)),
            ArchiveValidation::NoTocFound { filename } => return Err(format!("NO_TOC:{}", filename)),
            ArchiveValidation::Corrupted { filename } => return Err(format!("CORRUPTED:{}", filename)),
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

        Ok(format!("Imported addon {} from GitHub (Zip Fallback)", repo))
    }
}

#[tauri::command]
pub async fn import_addon_files(base_path: String, file_paths: Vec<String>) -> std::result::Result<String, String> {
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

        let filename = file_path.file_name().and_then(|s| s.to_str()).unwrap_or("addon.zip").to_string();
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
        let validation = validate_addon_archive(&extract_dir, &filename)?;
        match validation {
            ArchiveValidation::Valid { addon_dirs } => {
                for dir in addon_dirs {
                    if let Some(dir_name) = dir.file_name().and_then(|s| s.to_str()) {
                        let target_dir = addons_dir.join(dir_name);
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
                let names: Vec<String> = addon_dirs.iter().filter_map(|d| d.file_name().and_then(|s| s.to_str()).map(|s| s.to_string())).collect();
                return Err(format!("BUNDLED:{}|{}", extract_dir.to_string_lossy(), names.join(",")));
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
    base_path: String,
    temp_dir_path: String,
    allowed_dirs: Option<Vec<String>>,
) -> std::result::Result<String, String> {
    let addons_dir = PathBuf::from(&base_path).join("Interface").join("AddOns");
    let temp_dir = PathBuf::from(&temp_dir_path);
    if !temp_dir.exists() {
        return Err("Temporary extraction directory not found".into());
    }

    let validation = validate_addon_archive(&temp_dir, "addon.zip")?;
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
    Ok(format!("Imported addon(s): {}", imported.join(", ")))
}

#[tauri::command]
pub fn cleanup_temp_archive(temp_dir_path: String) -> std::result::Result<(), String> {
    let temp_dir = PathBuf::from(&temp_dir_path);
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
    Ok(())
}

