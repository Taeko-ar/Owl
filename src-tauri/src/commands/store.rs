use crate::{get_curseforge_base_url, CURSEFORGE_API_KEY, verify_sha1};
use tempfile::TempDir;
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

    let temp_dir = TempDir::new().map_err(|e| e.to_string())?;
    let ext = if url.to_lowercase().ends_with(".7z") {
        "7z"
    } else {
        "zip"
    };
    let zip_path = temp_dir.path().join(format!("addon.{}", ext));
    let mut file = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    std::io::copy(&mut &bytes[..], &mut file).map_err(|e| e.to_string())?;

    if let Some(ref expected_sha1) = sha1 {
        verify_sha1(&zip_path, expected_sha1)?;
    }

    let extract_dir = temp_dir.path().join("extract");
    let source_path = extract_archive(&zip_path, &extract_dir)?;

    let mut imported = Vec::new();

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
            let target_name = Path::new(&url)
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
            .unwrap_or("addon");
        let target_dir = addons_dir.join(target_name);
        if target_dir.exists() {
            fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
        }
        copy_dir_recursive(&source_path, &target_dir)?;
        imported.push(target_name.to_string());
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

    Ok(format!("Successfully imported: {}", imported.join(", ")))
}

