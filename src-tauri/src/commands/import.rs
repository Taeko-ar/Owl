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
        const CREATE_NO_WINDOW: u32 = 0x08000000;
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
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let output = cmd.output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        Ok(format!("Imported addon {} from GitHub", repo))
    } else {
        let client = reqwest::Client::builder()
            .user_agent("OWL-Launcher")
            .build()
            .map_err(|e| e.to_string())?;

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

    let mut imported = Vec::new();
    for path_str in file_paths {
        let file_path = PathBuf::from(&path_str);
        if !file_path.exists() {
            return Err(format!("Archive not found: {}", file_path.display()));
        }

        let temp_dir = TempDir::new().map_err(|e| e.to_string())?;
        let extract_dir = temp_dir.path().join("extracted");
        let source_path = extract_archive(&file_path, &extract_dir)?;

        if source_path == extract_dir {
            let mut has_toc = false;
            let mut sub_dirs = Vec::new();
            if let Ok(read_dir) = fs::read_dir(&extract_dir) {
                for entry in read_dir {
                    if let Ok(entry) = entry {
                        let name = entry.file_name();
                        let name_str = name.to_string_lossy();
                        if name_str.starts_with('.') || name_str.eq_ignore_ascii_case("__MACOSX") {
                            continue;
                        }
                        if let Ok(ft) = entry.file_type() {
                            if ft.is_dir() {
                                sub_dirs.push(entry.path());
                            } else if name_str.to_lowercase().ends_with(".toc") {
                                has_toc = true;
                            }
                        }
                    }
                }
            }

            if has_toc || sub_dirs.is_empty() {
                let target_name = file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("addon");
                let target_dir = addons_dir.join(target_name);
                if target_dir.exists() {
                    fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
                }
                copy_dir_recursive(&extract_dir, &target_dir)?;
                imported.push(target_name.to_string());
            } else {
                for sub_dir in sub_dirs {
                    if let Some(sub_dir_name) = sub_dir.file_name().and_then(|n| n.to_str()) {
                        let target_dir = addons_dir.join(sub_dir_name);
                        if target_dir.exists() {
                            fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
                        }
                        copy_dir_recursive(&sub_dir, &target_dir)?;
                        imported.push(sub_dir_name.to_string());
                    }
                }
            }
        } else {
            let target_name = source_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_else(|| file_path.file_stem().and_then(|s| s.to_str()).unwrap_or("addon"));
            let target_dir = addons_dir.join(target_name);
            if target_dir.exists() {
                fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
            }
            copy_dir_recursive(&source_path, &target_dir)?;
            imported.push(target_name.to_string());
        }
    }

    Ok(format!("Imported addon(s): {}", imported.join(", ")))
}

