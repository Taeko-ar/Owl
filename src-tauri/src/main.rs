#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::fs;
use std::io;
use std::path::PathBuf;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
use tempfile::TempDir;
use zip::ZipArchive;
use sevenz_rust;
use serde::{Deserialize, Serialize};
use dirs::config_dir;
use rfd::FileDialog;
use tauri_plugin_updater::UpdaterExt;


#[tauri::command]
fn launch_game(base_path: String, _stay_open: bool) -> std::result::Result<String, String> {
    let base = PathBuf::from(&base_path);

    if !base.exists() {
        return Err(format!("Game directory does not exist: {}", base.display()));
    }

    let candidates = [
        "WoW.exe",
        "WoW.app",
        "World of Warcraft.app",
        "WoW",
        "worldofwarcraft",
        "World of Warcraft",
    ];

    let mut detected_exe = None;
    for c in &candidates {
        if base.join(c).exists() {
            detected_exe = Some(c.to_string());
            break;
        }
    }

    let exe = match detected_exe {
        Some(e) => e,
        None => {
            return Err(format!(
                "No WoW executable found in {}. Checked: WoW.exe, WoW.app, World of Warcraft.app, WoW",
                base.display()
            ));
        }
    };

    let cache_paths = vec![
        base.join("Cache"),
        base.join("WTF").join("Cache"),
    ];
    for cache_path in cache_paths {
        if cache_path.exists() {
            let _ = fs::remove_dir_all(&cache_path);
        }
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
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
        if exe.ends_with(".exe") {
            Command::new("wine")
                .arg(base.join(&exe))
                .current_dir(&base)
                .spawn()
                .or_else(|_| {
                    Command::new(base.join(&exe))
                        .current_dir(&base)
                        .spawn()
                })
                .map_err(|e| format!("Failed to launch {}: {}", exe, e))?;
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

#[tauri::command]
fn get_patches(base_path: String) -> std::result::Result<Vec<String>, String> {
    let data_dir = PathBuf::from(&base_path).join("Data");
    if !data_dir.exists() {
        return Ok(Vec::new());
    }
    let mut patches: Vec<String> = fs::read_dir(&data_dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if !name.ends_with(".mpq") {
                return false;
            }
            let stem = name.strip_suffix(".mpq").unwrap_or(&name);
            let stem = stem.strip_suffix("-disabled").unwrap_or(stem);
            
            if !stem.starts_with("patch-") || stem.len() != 7 {
                return false;
            }
            if let Some(c) = stem.chars().nth(6) {
                c.is_ascii_alphabetic()
            } else {
                false
            }
        })
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();

    patches.sort();
    Ok(patches)
}

#[tauri::command]
fn toggle_patch(base_path: String, patch_name: String, enable: bool) -> std::result::Result<String, String> {
    let data_dir = PathBuf::from(&base_path).join("Data");
    if !data_dir.exists() {
        return Err("Data directory not found".into());
    }

    let p = Path::new(&patch_name);
    let ext_opt = p.extension().and_then(|s| s.to_str()).map(|s| s.to_string());
    let stem_opt = p.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string());

    if let (Some(ext), Some(stem)) = (ext_opt, stem_opt) {
        let base_stem = if stem.ends_with("-disabled") {
            stem.trim_end_matches("-disabled").to_string()
        } else {
            stem.clone()
        };

        let enabled_name = format!("{}.{}", base_stem, ext);
        let disabled_name = format!("{}-disabled.{}", base_stem, ext);

        let enabled_path = data_dir.join(&enabled_name);
        let disabled_path = data_dir.join(&disabled_name);

        if enable {
            if enabled_path.exists() {
                return Ok("Already enabled".into());
            }
            if disabled_path.exists() {
                fs::rename(&disabled_path, &enabled_path).map_err(|e| e.to_string())?;
                return Ok("Enabled".into());
            }
            return Err("Patch file to enable not found".into());
        } else {
            if disabled_path.exists() {
                return Ok("Already disabled".into());
            }
            if enabled_path.exists() {
                if disabled_path.exists() {
                    return Err("Disabled target already exists".into());
                }
                fs::rename(&enabled_path, &disabled_path).map_err(|e| e.to_string())?;
                return Ok("Disabled".into());
            }
            return Err("Patch file to disable not found".into());
        }
    } else {
        let base_name = if patch_name.ends_with("-disabled") {
            patch_name.trim_end_matches("-disabled").to_string()
        } else {
            patch_name.clone()
        };

        let enabled_path = data_dir.join(&base_name);
        let disabled_path = data_dir.join(format!("{}-disabled", base_name));

        if enable {
            if enabled_path.exists() {
                return Ok("Already enabled".into());
            }
            if disabled_path.exists() {
                fs::rename(&disabled_path, &enabled_path).map_err(|e| e.to_string())?;
                return Ok("Enabled".into());
            }
            return Err("Patch file to enable not found".into());
        } else {
            if disabled_path.exists() {
                return Ok("Already disabled".into());
            }
            if enabled_path.exists() {
                if disabled_path.exists() {
                    return Err("Disabled target already exists".into());
                }
                fs::rename(&enabled_path, &disabled_path).map_err(|e| e.to_string())?;
                return Ok("Disabled".into());
            }
            return Err("Patch file to disable not found".into());
        }
    }
}

#[tauri::command]
fn get_addons(base_path: String) -> std::result::Result<Vec<String>, String> {
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

#[derive(Serialize, Deserialize)]
struct OwlAddonMeta {
    remote_url: String,
    branch: String,
    commit_sha: String,
}

fn fetch_latest_commit_sha(owner: &str, repo: &str, branch: &str) -> std::result::Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("OWL-Launcher")
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.github.com/repos/{}/{}/commits/{}", owner, repo, branch);
    let resp = client.get(&url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("API error: {}", resp.status()));
    }
    let text = resp.text().map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let sha = json["sha"].as_str().ok_or("No SHA found in API response")?;
    Ok(sha.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AddonGitStatus {
    remote_url: Option<String>,
    branch: Option<String>,
    ahead: Option<i32>,
    behind: Option<i32>,
    update_available: Option<bool>,
    last_commit: Option<String>,
    branches: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AddonMeta {
    name: String,
    title: Option<String>,
    author: Option<String>,
    version: Option<String>,
    notes: Option<String>,
    optional_deps: Vec<String>,
    optional_deps_installed: Vec<bool>,
    toc_file: Option<String>,
    readme: Option<String>,
    path: Option<String>,
    git_status: Option<AddonGitStatus>,
    has_git: bool,
}

fn run_git_command(path: &Path, args: &[&str]) -> std::result::Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(path);

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn get_addon_git_status(addon_path: &Path) -> Option<AddonGitStatus> {
    if !addon_path.join(".git").exists() {
        let meta_path = addon_path.join(".owl-meta.json");
        if meta_path.exists() {
            if let Ok(content) = fs::read_to_string(&meta_path) {
                if let Ok(owl_meta) = serde_json::from_str::<OwlAddonMeta>(&content) {
                    if let Ok((owner, repo, _)) = parse_github_repo_url(&owl_meta.remote_url) {
                        if let Ok(latest_sha) = fetch_latest_commit_sha(&owner, &repo, &owl_meta.branch) {
                            let has_update = latest_sha != owl_meta.commit_sha;
                            return Some(AddonGitStatus {
                                remote_url: Some(owl_meta.remote_url),
                                branch: Some(owl_meta.branch.clone()),
                                ahead: Some(0),
                                behind: Some(if has_update { 1 } else { 0 }),
                                update_available: Some(has_update),
                                last_commit: None,
                                branches: vec![owl_meta.branch],
                            });
                        }
                    }
                }
            }
        }
        return None;
    }

    let _ = run_git_command(addon_path, &["fetch", "--quiet", "--all", "--prune"]);

    let status_output = run_git_command(addon_path, &["status", "--porcelain=2", "--branch", "--untracked-files=no"]).ok()?;
    let remote_url = run_git_command(addon_path, &["remote", "get-url", "origin"]).ok();

    let mut branch = None;
    let mut ahead = None;
    let mut behind = None;
    for line in status_output.lines() {
        if let Some(value) = line.strip_prefix("# branch.head ") {
            branch = Some(value.to_string());
        }
        if let Some(value) = line.strip_prefix("# branch.ab ") {
            let mut parts = value.split_whitespace();
            ahead = parts.next().and_then(|p| p.trim_start_matches('+').parse().ok());
            behind = parts.next().and_then(|p| p.trim_start_matches('-').parse().ok());
        }
    }

    let last_commit = run_git_command(addon_path, &["log", "-1", "--format=%cr"])
        .ok()
        .map(|s| s.trim().to_string());

    let branch_list_output = run_git_command(addon_path, &["branch", "-a", "--format=%(refname:short)"])
        .ok()
        .unwrap_or_default();

    let mut branches: Vec<String> = branch_list_output
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && !line.contains("HEAD") && !line.contains("->"))
        .map(|line| {
            line.strip_prefix("remotes/origin/")
                .unwrap_or(line)
                .strip_prefix("origin/")
                .unwrap_or(line)
                .to_string()
        })
        .filter(|b| !b.is_empty() && b != "origin" && b != "remotes/origin")
        .collect();
    branches.sort();
    branches.dedup();

    if branches.is_empty() {
        if let Some(ref b) = branch {
            branches.push(b.clone());
        }
    }

    Some(AddonGitStatus {
        remote_url,
        branch,
        ahead,
        behind,
        update_available: behind.map(|b| b > 0),
        last_commit,
        branches,
    })
}

#[tauri::command]
fn parse_toc(base_path: String, addon_name: String) -> std::result::Result<AddonMeta, String> {
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
    let has_git = addon_path.join(".git").exists();

    Ok(AddonMeta {
        name: addon_name,
        title,
        author,
        version,
        notes,
        optional_deps,
        optional_deps_installed,
        toc_file: toc_file_name,
        readme,
        path: Some(addon_path_str),
        git_status: None,
        has_git,
    })
}

#[tauri::command]
async fn check_addon_git_status(base_path: String, addon_name: String) -> std::result::Result<Option<AddonGitStatus>, String> {
    let addon_path = PathBuf::from(&base_path).join("Interface").join("AddOns").join(&addon_name);
    if !addon_path.exists() || !addon_path.is_dir() {
        return Err("Addon folder not found".into());
    }
    Ok(get_addon_git_status(&addon_path))
}

#[tauri::command]
async fn change_addon_branch(base_path: String, addon_name: String, branch_name: String) -> std::result::Result<String, String> {
    let addon_path = PathBuf::from(&base_path).join("Interface").join("AddOns").join(&addon_name);
    if !addon_path.exists() || !addon_path.is_dir() {
        return Err("Addon folder not found".into());
    }
    run_git_command(&addon_path, &["checkout", &branch_name])
        .map_err(|e| format!("Failed to checkout branch '{}': {}", branch_name, e))
}

fn has_uncommitted_changes(addon_path: &Path) -> std::result::Result<bool, String> {
    let output = run_git_command(addon_path, &["status", "--porcelain", "-uno"]).map_err(|e| format!("Failed to check repository status: {}", e))?;
    Ok(!output.trim().is_empty())
}

#[tauri::command]
async fn update_addon(base_path: String, addon_name: String) -> std::result::Result<String, String> {
    let addon_path = PathBuf::from(&base_path).join("Interface").join("AddOns").join(&addon_name);
    if !addon_path.exists() || !addon_path.is_dir() {
        return Err("Addon folder not found".into());
    }
    if !addon_path.join(".git").exists() {
        let meta_path = addon_path.join(".owl-meta.json");
        if meta_path.exists() {
            if let Ok(content) = fs::read_to_string(&meta_path) {
                if let Ok(owl_meta) = serde_json::from_str::<OwlAddonMeta>(&content) {
                    let (owner, repo, _) = parse_github_repo_url(&owl_meta.remote_url)?;
                    let client = reqwest::blocking::Client::builder()
                        .user_agent("OWL-Launcher")
                        .build()
                        .map_err(|e| e.to_string())?;

                    let zip_url = format!(
                        "https://github.com/{}/{}/archive/refs/heads/{}.zip",
                        owner, repo, owl_meta.branch
                    );

                    let mut resp = client.get(&zip_url).send().map_err(|e| e.to_string())?;
                    if !resp.status().is_success() {
                        return Err(format!("Failed to download zip: {}", resp.status()));
                    }

                    let latest_sha = fetch_latest_commit_sha(&owner, &repo, &owl_meta.branch)?;

                    let temp_dir = TempDir::new().map_err(|e| e.to_string())?;
                    let zip_path = temp_dir.path().join("addon.zip");
                    let mut file = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
                    resp.copy_to(&mut file).map_err(|e| e.to_string())?;

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

    let res = (|| -> std::result::Result<String, String> {
        run_git_command(&addon_path, &["fetch", "--quiet", "--all", "--prune"])
            .map_err(|e| format!("Failed to fetch remote repository: {}", e))?;

        let status = get_addon_git_status(&addon_path).ok_or("Unable to determine addon git status")?;

        if status.update_available == Some(false) {
            return Ok(format!("Addon '{}' is already up to date", addon_name));
        }

        run_git_command(&addon_path, &["pull", "--ff-only", "--quiet"])
            .map_err(|e| format!("Failed to pull latest addon changes: {}", e))?;

        Ok(format!("Updated addon '{}'{}", addon_name, status.branch.map(|b| format!(" on branch {}", b)).unwrap_or_default()))
    })();

    if changed {
        let _ = run_git_command(&addon_path, &["stash", "pop"]);
    }

    res
}

#[tauri::command]
fn toggle_addon(base_path: String, addon_name: String, enable: bool) -> std::result::Result<String, String> {
    let addons_dir = PathBuf::from(&base_path).join("Interface").join("AddOns");
    if !addons_dir.exists() {
        return Err("AddOns directory not found".into());
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
            if disabled_path.exists() {
                return Err("Disabled target already exists".into());
            }
            fs::rename(&enabled_path, &disabled_path).map_err(|e| e.to_string())?;
            return Ok("Disabled".into());
        }
        return Err("Addon folder to disable not found".into());
    }
}

#[tauri::command]
fn read_config(base_path: String) -> std::result::Result<String, String> {
    let config_path = PathBuf::from(&base_path).join("WTF").join("config.wtf");
    if !config_path.exists() {
        return Err("config.wtf not found".into());
    }
    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    Ok(content)
}

#[tauri::command]
fn set_config_value(base_path: String, key: String, value: String) -> std::result::Result<String, String> {
    let config_path = PathBuf::from(&base_path).join("WTF").join("config.wtf");
    if !config_path.exists() {
        return Err("config.wtf not found".into());
    }

    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let mut found = false;
    let key_trim = key.trim();

    for i in 0..lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.to_uppercase().starts_with("SET ") {
            if let Some(first_quote) = trimmed.find('"') {
                if let Some(second_quote_rel) = trimmed[first_quote+1..].find('"') {
                    let second_quote = first_quote + 1 + second_quote_rel;
                    let found_key = &trimmed[first_quote+1..second_quote];
                    if found_key == key_trim {
                        lines[i] = format!("SET \"{}\" \"{}\"", key_trim, value);
                        found = true;
                        break;
                    }
                }
            }
        } else {
            let token = trimmed.split(|c: char| c.is_whitespace() || c == '=').next().unwrap_or("");
            if token == key_trim {
                lines[i] = format!("SET \"{}\" \"{}\"", key_trim, value);
                found = true;
                break;
            }
        }
    }

    if !found {
        lines.push(format!("SET \"{}\" \"{}\"", key_trim, value));
    }

    let new_content = lines.join("\n");
    fs::write(&config_path, new_content).map_err(|e| e.to_string())?;

    Ok("OK".into())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherSettings {
    path: Option<String>,
    window_size: Option<String>,
    stay_open: Option<bool>,
}

fn get_settings_file_path() -> std::result::Result<PathBuf, String> {
    let mut config_dir = config_dir().ok_or("Unable to determine app config directory".to_string())?;
    config_dir.push("owl");
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    config_dir.push("settings.json");
    Ok(config_dir)
}

#[tauri::command]
fn load_settings() -> std::result::Result<LauncherSettings, String> {
    let settings_file_path = get_settings_file_path()?;
    if !settings_file_path.exists() {
        let default_path = if cfg!(target_os = "windows") {
            Some("C:\\".to_string())
        } else {
            dirs::home_dir().map(|p| p.to_string_lossy().to_string()).or_else(|| Some("/".to_string()))
        };
        return Ok(LauncherSettings {
            path: default_path,
            window_size: None,
            stay_open: None,
        });
    }

    let content = fs::read_to_string(&settings_file_path).map_err(|e| e.to_string())?;
    let mut settings: LauncherSettings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    if settings.path.is_none() {
        settings.path = if cfg!(target_os = "windows") {
            Some("C:\\".to_string())
        } else {
            dirs::home_dir().map(|p| p.to_string_lossy().to_string()).or_else(|| Some("/".to_string()))
        };
    }
    Ok(settings)
}

#[tauri::command]
fn save_settings(settings: LauncherSettings) -> std::result::Result<String, String> {
    let settings_file_path = get_settings_file_path()?;
    fs::write(&settings_file_path, serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok("OK".into())
}

fn parse_github_repo_url(repo_url: &str) -> std::result::Result<(String, String, Option<String>), String> {
    let repo_url = repo_url.trim().trim_end_matches('/');
    let repo_url = repo_url.strip_prefix("https://").or_else(|| repo_url.strip_prefix("http://")).ok_or("GitHub URL must start with http:// or https://")?;
    let parts: Vec<&str> = repo_url.split('/').collect();
    if parts.len() < 3 || parts[0] != "github.com" {
        return Err("URL must be a github.com repository URL".into());
    }
    let owner = parts[1].to_string();
    let repo = parts[2].trim_end_matches(".git").to_string();
    let branch = if parts.len() > 4 && (parts[3] == "tree" || parts[3] == "blob") {
        Some(parts[4].to_string())
    } else if parts.len() > 3 && parts[3] == "archive" {
        if parts.len() > 6 && parts[4] == "refs" && (parts[5] == "heads" || parts[5] == "tags") {
            parts.get(6).map(|s| s.to_string())
        } else {
            parts.get(4).map(|s| s.to_string())
        }
    } else {
        None
    };
    Ok((owner, repo, branch))
}

#[tauri::command]
async fn import_addon(base_path: String, repo_url: String) -> std::result::Result<String, String> {
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
        let client = reqwest::blocking::Client::builder()
            .user_agent("OWL-Launcher")
            .build()
            .map_err(|e| e.to_string())?;

        let branch_name = branch.unwrap_or_else(|| "main".to_string());
        let zip_url = format!(
            "https://github.com/{}/{}/archive/refs/heads/{}.zip",
            owner, repo, branch_name
        );

        let mut resp = client.get(&zip_url).send().map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            if branch_name == "main" {
                let fallback_url = format!(
                    "https://github.com/{}/{}/archive/refs/heads/master.zip",
                    owner, repo
                );
                let resp2 = client.get(&fallback_url).send().map_err(|e| e.to_string())?;
                if resp2.status().is_success() {
                    resp = resp2;
                } else {
                    return Err(format!("Failed to download zip: {}", resp.status()));
                }
            } else {
                return Err(format!("Failed to download zip: {}", resp.status()));
            }
        }

        let latest_sha = fetch_latest_commit_sha(&owner, &repo, &branch_name).unwrap_or_default();

        let temp_dir = TempDir::new().map_err(|e| e.to_string())?;
        let zip_path = temp_dir.path().join("addon.zip");
        let mut file = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
        resp.copy_to(&mut file).map_err(|e| e.to_string())?;

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

fn extract_archive(file_path: &Path, extract_dir: &Path) -> std::result::Result<PathBuf, String> {
    let ext = file_path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .ok_or("Unable to determine archive type".to_string())?;

    if ext == "zip" {
        let reader = fs::File::open(file_path).map_err(|e| e.to_string())?;
        let mut zip = ZipArchive::new(reader).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
            let outpath = extract_dir.join(file.mangled_name());
            if file.name().ends_with('/') {
                fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
                continue;
            }
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    } else if ext == "7z" {
        fs::create_dir_all(extract_dir).map_err(|e| e.to_string())?;
        sevenz_rust::decompress_file(file_path, extract_dir).map_err(|e| e.to_string())?;
    } else {
        return Err(format!("Unsupported archive type: {}", ext));
    }

    let mut non_noise_entries = Vec::new();
    if let Ok(read_dir) = fs::read_dir(extract_dir) {
        for entry in read_dir {
            if let Ok(entry) = entry {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with('.') || name_str.eq_ignore_ascii_case("__MACOSX") {
                    continue;
                }
                non_noise_entries.push(entry);
            }
        }
    }

    if non_noise_entries.len() == 1 {
        let entry = &non_noise_entries[0];
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            return Ok(entry.path());
        }
    }
    Ok(extract_dir.to_path_buf())
}

#[tauri::command]
async fn import_addon_files(base_path: String, file_paths: Vec<String>) -> std::result::Result<String, String> {
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

#[tauri::command]
fn open_addon_folder(base_path: String, addon_name: String) -> std::result::Result<String, String> {
    let folder = PathBuf::from(&base_path).join("Interface").join("AddOns").join(&addon_name);
    if !folder.exists() {
        return Err("Addon folder not found".into());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok("Opened".into())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::result::Result<(), String> {
    if !dst.exists() {
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    }
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn minimize_window(window: tauri::Window) -> std::result::Result<String, String> {
    window.minimize().map_err(|e| e.to_string())?;
    Ok("OK".into())
}

#[tauri::command]
fn close_window(window: tauri::Window) -> std::result::Result<String, String> {
    window.close().map_err(|e| e.to_string())?;
    Ok("OK".into())
}

#[tauri::command]
fn set_window_size(window: tauri::Window, width: f64, height: f64) -> std::result::Result<String, String> {
    window.set_resizable(true).map_err(|e| e.to_string())?;
    window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height })).map_err(|e| e.to_string())?;
    window.set_resizable(false).map_err(|e| e.to_string())?;
    Ok("OK".into())
}

#[tauri::command]
fn open_folder(base_path: String, rel_path: String) -> std::result::Result<String, String> {
    let folder = PathBuf::from(&base_path).join(rel_path);
    if !folder.exists() {
        return Err("Folder not found".into());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok("Opened".into())
}

#[tauri::command]
fn pick_folder() -> std::result::Result<String, String> {
    if let Some(path) = FileDialog::new().set_title("Select Game Folder").pick_folder() {
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Folder selection canceled".into())
    }
}

#[tauri::command]
fn pick_files() -> std::result::Result<Vec<String>, String> {
    if let Some(paths) = FileDialog::new()
        .set_title("Select addon archive file(s)")
        .add_filter("Addon archives", &["zip", "7z"])
        .add_filter("All files", &["*"])
        .pick_files()
    {
        Ok(paths.iter().map(|p| p.to_string_lossy().to_string()).collect())
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
fn delete_patch(base_path: String, patch_name: String) -> std::result::Result<String, String> {
    let patch_path = PathBuf::from(&base_path).join("Data").join(&patch_name);
    if !patch_path.exists() {
        return Err("Patch file not found".into());
    }
    fs::remove_file(&patch_path)
        .map_err(|e| format!("Failed to delete patch: {}", e))?;
    Ok(format!("Deleted {}", patch_name))
}

#[tauri::command]
fn delete_addon(base_path: String, addon_name: String) -> std::result::Result<String, String> {
    let addon_path = PathBuf::from(&base_path).join("Interface").join("AddOns").join(&addon_name);
    if !addon_path.exists() {
        return Err("Addon folder not found".into());
    }
    fs::remove_dir_all(&addon_path)
        .map_err(|e| format!("Failed to delete addon: {}", e))?;
    Ok(format!("Deleted {}", addon_name))
}

async fn check_for_updates(app: tauri::AppHandle) -> std::result::Result<(), String> {
    if let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? {
        update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

fn main() {
    let allow_devtools = std::env::var("ALLOW_DEVTOOLS").unwrap_or_default() == "1";

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            launch_game,
            get_patches,
            toggle_patch,
            get_addons,
            parse_toc,
            read_config,
            set_config_value,
            toggle_addon,
            update_addon,
            import_addon,
            import_addon_files,
            open_addon_folder,
            open_folder,
            pick_folder,
            pick_files,
            load_settings,
            save_settings,
            delete_patch,
            delete_addon,
            minimize_window,
            close_window,
            set_window_size,
            check_addon_git_status,
            change_addon_branch
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = check_for_updates(handle).await;
            });
            if allow_devtools {
                println!("ALLOW_DEVTOOLS=1 set, but automatic devtools opening is not supported in this build; open devtools from the menu or console if needed.");
            }
            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
