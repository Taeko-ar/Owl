use crate::{get_curseforge_base_url, CURSEFORGE_API_KEY, verify_sha1};
use std::fs;
use std::path::{Path, PathBuf};
use crate::models::{CurseForgeMeta};
use crate::fs_utils::*;
use crate::archive::*;

#[tauri::command]
pub async fn search_curseforge_addons(
    query: String,
    category_id: Option<i32>,
    game_version: String,
    is_mock: bool,
) -> std::result::Result<serde_json::Value, String> {
    let client = owl_http_client()?;

    let base_url = get_curseforge_base_url(is_mock);
    let url = if is_mock {
        let game_ver = if game_version == "1.12.1" { "1.12.1" } else { "3.3.5" };
        format!(
            "{}/v1/mods/search?gameId=1&classId=6&gameVersion={}&searchFilter={}",
            base_url, game_ver, query
        )
    } else {
        let version_type_id = if game_version == "1.12.1" { 67408 } else { 73713 };
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
pub async fn get_curseforge_mod_files(mod_id: i32, is_mock: bool) -> std::result::Result<serde_json::Value, String> {
    let client = owl_http_client()?;

    let base_url = get_curseforge_base_url(is_mock);
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
pub async fn get_curseforge_mod_description(mod_id: i32, is_mock: bool) -> std::result::Result<String, String> {
    let client = owl_http_client()?;

    let base_url = get_curseforge_base_url(is_mock);
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
    let html = json["data"].as_str().unwrap_or("No description available.").to_string();
    Ok(html)
}

#[tauri::command]
pub async fn download_and_extract_addon(
    base_path: String,
    url: String,
    sha1: Option<String>,
    mod_id: Option<i32>,
    file_id: Option<i32>,
) -> std::result::Result<String, String> {
    let addons_dir = PathBuf::from(&base_path).join("Interface").join("AddOns");
    if !addons_dir.exists() {
        fs::create_dir_all(&addons_dir).map_err(|e| e.to_string())?;
    }

    let client = owl_http_client()?;

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
    let mut file = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    std::io::copy(&mut &bytes[..], &mut file).map_err(|e| e.to_string())?;

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
    let validation = validate_addon_archive(&content_dir, &filename)?;
    let mut imported = Vec::new();

    match validation {
        ArchiveValidation::Valid { addon_dirs } => {
            for dir in addon_dirs {
                let mut target_name = dir
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("addon")
                    .to_string();
                if url.contains("github.com") {
                    if let Ok((_, repo, _)) = crate::github::parse_github_repo_url(&url) {
                        if target_name.to_lowercase().starts_with(&format!("{}-", repo.to_lowercase())) {
                            target_name = repo;
                        }
                    }
                } else if target_name == "content" {
                    target_name = Path::new(&url)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("addon")
                        .to_string();
                    if let Some(idx) = target_name.rfind('-') {
                        let suffix = &target_name[idx + 1..];
                        if suffix == "main" || suffix == "master" || suffix == "dev" || suffix.chars().all(|c| c.is_ascii_hexdigit()) {
                            target_name = target_name[..idx].to_string();
                        }
                    }
                }

                let target_dir = addons_dir.join(&target_name);
                if target_dir.exists() {
                    fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
                }
                copy_dir_recursive(&dir, &target_dir)?;
                imported.push(target_name);
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
            let names: Vec<String> = addon_dirs.iter().filter_map(|d| d.file_name().and_then(|s| s.to_str()).map(|s| s.to_string())).collect();
            return Err(format!("BUNDLED:{}|{}", content_dir.to_string_lossy(), names.join(",")));
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

#[tauri::command]
pub async fn resolve_addon_dependency(
    base_path: String,
    dependency_name: String,
    is_mock: bool,
) -> std::result::Result<String, String> {
    let game_ver = crate::commands::game::detect_game_version(base_path.clone());
    let search_results = search_curseforge_addons(dependency_name.clone(), None, game_ver.clone(), is_mock).await?;
    let data = search_results["data"].as_array().ok_or("No data in search results")?;
    if data.is_empty() {
        return Err(format!("No addon found for dependency: {}", dependency_name));
    }

    let best_mod = &data[0];
    let mod_id = best_mod["id"].as_i64().ok_or("No mod ID found")? as i32;

    let files_res = get_curseforge_mod_files(mod_id, is_mock).await?;
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

    let file = selected_file.ok_or_else(|| format!("No compatible version found for dependency: {}", dependency_name))?;
    let download_url = file["downloadUrl"].as_str().map(|s| s.to_string()).ok_or("No download URL found for file")?;
    let file_id = file["id"].as_i64().ok_or("No file ID found")? as i32;

    let sha1 = if let Some(hashes) = file["hashes"].as_array() {
        hashes.iter()
            .find(|h| h["algo"].as_i64() == Some(1))
            .and_then(|h| h["value"].as_str())
            .map(|s| s.to_string())
    } else {
        None
    };

    download_and_extract_addon(base_path, download_url, sha1, Some(mod_id), Some(file_id)).await
}

