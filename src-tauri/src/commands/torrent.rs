use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State, Emitter};
use rfd::FileDialog;
use librqbit::{Session, Api, AddTorrent, AddTorrentOptions};
use crate::archive::extract_archive;

pub struct TorrentState {
    pub session: Arc<Session>,
    pub api: Arc<Api>,
    pub active_downloads: Arc<Mutex<HashMap<String, ActiveDownload>>>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveDownload {
    pub id: usize,
    pub name: String,
    pub dest_dir: String,
    pub info_hash: String,
    pub is_unpacking: bool,
    pub is_paused: bool,
    pub error: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentProgressPayload {
    pub downloads: Vec<TorrentProgressInfo>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentProgressInfo {
    pub info_hash: String,
    pub name: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bps: u64,
    pub peers: u64,
    pub is_unpacking: bool,
    pub is_paused: bool,
    pub error: Option<String>,
    pub state: String,
}

impl TorrentState {
    pub async fn new() -> Result<Self, String> {
        let temp_dir = std::env::temp_dir().join("owl_torrent_session");
        std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
        let session = Session::new(temp_dir).await.map_err(|e| e.to_string())?;
        let api = Arc::new(Api::new(Arc::clone(&session), None));
        Ok(Self {
            session,
            api,
            active_downloads: Arc::new(Mutex::new(HashMap::new())),
        })
    }
}

#[tauri::command]
pub fn pick_torrent_file() -> std::result::Result<String, String> {
    if let Some(path) = FileDialog::new()
        .set_title("Select .torrent File")
        .add_filter("Torrent Files", &["torrent"])
        .add_filter("All files", &["*"])
        .pick_file()
    {
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Torrent file selection canceled".into())
    }
}

#[tauri::command]
pub async fn start_torrent_download(
    state: State<'_, TorrentState>,
    app_handle: AppHandle,
    magnet_or_file: String,
    dest_dir: String,
) -> Result<String, String> {
    let dest_path = PathBuf::from(&dest_dir);
    if !dest_path.exists() {
        std::fs::create_dir_all(&dest_path).map_err(|e| e.to_string())?;
    }

    let options = AddTorrentOptions {
        output_folder: Some(dest_dir.clone()),
        ..Default::default()
    };
    
    let add_torrent = if magnet_or_file.starts_with("magnet:") || magnet_or_file.starts_with("http:") || magnet_or_file.starts_with("https:") {
        AddTorrent::from_url(&magnet_or_file)
    } else {
        let bytes = std::fs::read(&magnet_or_file).map_err(|e| e.to_string())?;
        AddTorrent::from_bytes(bytes)
    };

    let handle = state.session.add_torrent(add_torrent, Some(options))
        .await
        .map_err(|e| e.to_string())?
        .into_handle()
        .ok_or_else(|| "Failed to get torrent handle".to_string())?;

    let info_hash = handle.info_hash().0.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    let name = handle.name().clone().unwrap_or_else(|| "Unknown".to_string());
    let id = handle.id();

    let download = ActiveDownload {
        id,
        name: name.clone(),
        dest_dir: dest_dir.clone(),
        info_hash: info_hash.clone(),
        is_unpacking: false,
        is_paused: false,
        error: None,
    };

    let mut active = state.active_downloads.lock().await;
    active.insert(info_hash.clone(), download);

    let state_clone = Arc::clone(&state.active_downloads);
    let api_clone = Arc::clone(&state.api);
    let info_hash_clone = info_hash.clone();
    let app_handle_clone = app_handle.clone();
    
    tokio::spawn(async move {
        let mut completed = false;
        while !completed {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            
            let mut active = state_clone.lock().await;
            let (is_unpacking, is_paused) = match active.get(&info_hash_clone) {
                Some(dl) => (dl.is_unpacking, dl.is_paused),
                None => {
                    completed = true;
                    continue;
                }
            };
            if is_unpacking || is_paused {
                continue;
            }
            
            let opts = librqbit::api::ApiTorrentListOpts { with_stats: true };
            let res = api_clone.api_torrent_list_ext(opts);
            if let Some(torrent) = res.torrents.iter().find(|t| t.info_hash == info_hash_clone) {
                if let Some(ref stats) = torrent.stats {
                    let downloaded = stats.progress_bytes;
                    let total = stats.total_bytes;
                    let mut speed_bps = 0;
                    let mut peers = 0;
                    if let Some(ref live) = stats.live {
                        speed_bps = (live.download_speed.mbps * 1_048_576.0) as u64;
                        peers = live.snapshot.peer_stats.live as u64;
                    }
                    
                    let is_finished = stats.finished || (total > 0 && downloaded >= total);
                    
                    let mut progress_list = Vec::new();
                    for val in active.values() {
                        let (mut dl_bytes, mut tl_bytes, mut sp, mut pr) = (0, 0, 0, 0);
                        let mut state_str = "live".to_string();
                        if val.info_hash == info_hash_clone {
                            dl_bytes = downloaded;
                            tl_bytes = total;
                            sp = speed_bps;
                            pr = peers;
                            state_str = stats.state.to_string();
                        } else {
                            if let Some(t) = res.torrents.iter().find(|t| t.info_hash == val.info_hash) {
                                if let Some(ref s) = t.stats {
                                    dl_bytes = s.progress_bytes;
                                    tl_bytes = s.total_bytes;
                                    state_str = s.state.to_string();
                                    if let Some(ref l) = s.live {
                                        sp = (l.download_speed.mbps * 1_048_576.0) as u64;
                                        pr = l.snapshot.peer_stats.live as u64;
                                    }
                                }
                            }
                        }
                        let prog = TorrentProgressInfo {
                            info_hash: val.info_hash.clone(),
                            name: val.name.clone(),
                            downloaded_bytes: dl_bytes,
                            total_bytes: tl_bytes,
                            speed_bps: sp,
                            peers: pr,
                            is_unpacking: val.is_unpacking,
                            is_paused: val.is_paused,
                            error: val.error.clone(),
                            state: state_str,
                        };
                        progress_list.push(prog);
                    }
                    let _ = app_handle_clone.emit("torrent-progress", TorrentProgressPayload { downloads: progress_list });
                    
                    if is_finished {
                        completed = true;
                        let mut dest_dir_unpack = String::new();
                        let mut name_unpack = String::new();
                        if let Some(dl) = active.get_mut(&info_hash_clone) {
                            dl.is_unpacking = true;
                            dest_dir_unpack = dl.dest_dir.clone();
                            name_unpack = dl.name.clone();
                        }
                        
                        let mut progress_list = Vec::new();
                        for val in active.values() {
                            let (mut dl_bytes, mut tl_bytes, mut sp, mut pr) = (0, 0, 0, 0);
                            let mut state_str = "live".to_string();
                            if val.info_hash == info_hash_clone {
                                dl_bytes = total;
                                tl_bytes = total;
                                state_str = "finished".to_string();
                            } else {
                                if let Some(t) = res.torrents.iter().find(|t| t.info_hash == val.info_hash) {
                                    if let Some(ref s) = t.stats {
                                        dl_bytes = s.progress_bytes;
                                        tl_bytes = s.total_bytes;
                                        state_str = s.state.to_string();
                                        if let Some(ref l) = s.live {
                                            sp = (l.download_speed.mbps * 1_048_576.0) as u64;
                                            pr = l.snapshot.peer_stats.live as u64;
                                        }
                                    }
                                }
                            }
                            let prog = TorrentProgressInfo {
                                info_hash: val.info_hash.clone(),
                                name: val.name.clone(),
                                downloaded_bytes: dl_bytes,
                                total_bytes: tl_bytes,
                                speed_bps: sp,
                                peers: pr,
                                is_unpacking: val.is_unpacking,
                                is_paused: val.is_paused,
                                error: val.error.clone(),
                                state: state_str,
                            };
                            progress_list.push(prog);
                        }
                        let _ = app_handle_clone.emit("torrent-progress", TorrentProgressPayload { downloads: progress_list });

                        // Stop seeding by deleting from rqbit session but keeping files
                        let api_delete = Arc::clone(&api_clone);
                        let info_hash_delete = info_hash_clone.clone();
                        tokio::spawn(async move {
                            if let Ok(torrent_id) = get_torrent_id_from_hash(&api_delete, &info_hash_delete).await {
                                let _ = api_delete.api_torrent_action_forget(torrent_id).await;
                            }
                        });

                        let app_handle_unpack = app_handle_clone.clone();
                        let active_downloads_unpack = Arc::clone(&state_clone);
                        let info_hash_unpack = info_hash_clone.clone();
                        
                        tokio::spawn(async move {
                            let _ = process_finished_torrent_internal(
                                app_handle_unpack,
                                active_downloads_unpack,
                                info_hash_unpack,
                                dest_dir_unpack,
                                name_unpack,
                            ).await;
                        });
                    }
                }
            }
        }
    });

    Ok(info_hash)
}

#[tauri::command]
pub async fn cancel_torrent_download(
    state: State<'_, TorrentState>,
    info_hash: String,
) -> Result<(), String> {
    let mut active = state.active_downloads.lock().await;
    if active.remove(&info_hash).is_some() {
        let torrent_id = get_torrent_id_from_hash(&state.api, &info_hash).await?;
        let _ = state.api.api_torrent_action_forget(torrent_id).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn pause_torrent_downloads(
    state: State<'_, TorrentState>,
) -> Result<(), String> {
    let mut active = state.active_downloads.lock().await;
    for (info_hash, dl) in active.iter_mut() {
        if !dl.is_paused && !dl.is_unpacking {
            dl.is_paused = true;
            if let Ok(torrent_id) = get_torrent_id_from_hash(&state.api, info_hash).await {
                let _ = state.api.api_torrent_action_pause(torrent_id).await;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn resume_torrent_downloads(
    state: State<'_, TorrentState>,
) -> Result<(), String> {
    let mut active = state.active_downloads.lock().await;
    for (info_hash, dl) in active.iter_mut() {
        if dl.is_paused && !dl.is_unpacking {
            dl.is_paused = false;
            if let Ok(torrent_id) = get_torrent_id_from_hash(&state.api, info_hash).await {
                let _ = state.api.api_torrent_action_start(torrent_id).await;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_active_downloads(
    state: State<'_, TorrentState>,
) -> Result<Vec<ActiveDownload>, String> {
    let active = state.active_downloads.lock().await;
    Ok(active.values().cloned().collect())
}

// Helpers

async fn get_torrent_id_from_hash(api: &Api, info_hash: &str) -> Result<librqbit::api::TorrentIdOrHash, String> {
    let opts = librqbit::api::ApiTorrentListOpts { with_stats: false };
    let res = api.api_torrent_list_ext(opts);
    if let Some(t) = res.torrents.iter().find(|t| t.info_hash == info_hash) {
        if let Some(id) = t.id {
            return Ok(librqbit::api::TorrentIdOrHash::Id(id));
        }
    }
    Err("Torrent not found".to_string())
}

async fn process_finished_torrent_internal(
    app_handle: AppHandle,
    active_downloads: Arc<Mutex<HashMap<String, ActiveDownload>>>,
    info_hash: String,
    dest_dir: String,
    name: String,
) -> Result<(), String> {
    let dest_path = PathBuf::from(&dest_dir);
    
    let mut archives = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dest_path) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                        if ext.eq_ignore_ascii_case("zip") || ext.eq_ignore_ascii_case("7z") || ext.eq_ignore_ascii_case("rar") {
                            archives.push(path);
                        }
                    }
                }
            }
        }
    }

    let mut unpack_success = true;
    let mut unpack_error = None;
    
    for archive in archives {
        let content_dir = dest_path.join("unpacked_temp");
        if let Err(e) = extract_archive(&archive, &content_dir) {
            unpack_success = false;
            unpack_error = Some(e);
            break;
        } else {
            let _ = std::fs::remove_file(&archive);
            if let Err(e) = move_or_copy_directory_contents(&content_dir, &dest_path) {
                unpack_success = false;
                unpack_error = Some(e.to_string());
                break;
            }
            let _ = std::fs::remove_dir_all(&content_dir);
        }
    }

    let mut wow_folder = None;
    if unpack_success {
        if let Some(actual_wow_dir) = find_wow_exe_dir_recursive(&dest_path) {
            wow_folder = Some(actual_wow_dir);
        }
    }

    let mut active = active_downloads.lock().await;
    active.remove(&info_hash);

    if unpack_success {
        if let Some(folder) = wow_folder {
            let _ = auto_create_game_profile(&app_handle, &folder).await;
            let _ = app_handle.emit("torrent-completed", format!("Download and extraction completed. Game profile created at: {}", folder.to_string_lossy()));
        } else {
            let _ = app_handle.emit("torrent-completed", "Download completed, but wow.exe / WoW.exe was not found. Please configure game path manually.".to_string());
        }
    } else {
        let err_msg = unpack_error.unwrap_or_else(|| "Extraction failed".to_string());
        let _ = app_handle.emit("torrent-error", format!("Extraction failed for {}: {}", name, err_msg));
    }

    Ok(())
}

fn find_wow_exe_dir_recursive(path: &Path) -> Option<PathBuf> {
    if has_wow_exe(path) {
        return Some(path.to_path_buf());
    }
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries {
            if let Ok(entry) = entry {
                let p = entry.path();
                if p.is_dir() {
                    // Do not search inside unpacked_temp if it exists
                    if p.file_name().map_or(false, |name| name == "unpacked_temp") {
                        continue;
                    }
                    if let Some(found) = find_wow_exe_dir_recursive(&p) {
                        return Some(found);
                    }
                }
            }
        }
    }
    None
}

fn move_or_copy_directory_contents(src_dir: &Path, dest_dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest_dir)?;
    for entry in std::fs::read_dir(src_dir)? {
        let entry = entry?;
        let src = entry.path();
        let dest = dest_dir.join(entry.file_name());
        
        if src.is_dir() {
            if std::fs::rename(&src, &dest).is_err() {
                copy_dir_recursive(&src, &dest)?;
                let _ = std::fs::remove_dir_all(&src);
            }
        } else {
            if std::fs::rename(&src, &dest).is_err() {
                std::fs::copy(&src, &dest)?;
                let _ = std::fs::remove_file(&src);
            }
        }
    }
    Ok(())
}


fn has_wow_exe(path: &Path) -> bool {
    path.join("wow.exe").exists() || path.join("WoW.exe").exists()
}

async fn auto_create_game_profile(app_handle: &AppHandle, folder: &Path) -> Result<(), String> {
    let current = crate::commands::settings::load_settings()?;
    if current.path.is_some() {
        let _ = app_handle.emit(
            "torrent-suggest-path",
            folder.to_string_lossy().to_string(),
        );
    } else {
        let mut settings = current;
        settings.path = Some(folder.to_string_lossy().to_string());
        crate::commands::settings::save_settings(settings)?;
        let _ = app_handle.emit(
            "torrent-completed",
            format!("Game path set to: {}", folder.display()),
        );
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            std::fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn validate_game_path(base_path: String) -> bool {
    let base = std::path::PathBuf::from(&base_path);
    if !base.exists() {
        return false;
    }
    let candidates = [
        "WoW.exe",
        "WoW.app",
        "World of Warcraft.app",
        "WoW",
        "worldofwarcraft",
        "World of Warcraft",
    ];
    candidates.iter().any(|c| base.join(c).exists())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use std::fs::File;

    #[test]
    fn test_has_wow_exe() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        assert!(!has_wow_exe(path));

        File::create(path.join("wow.exe")).unwrap();
        assert!(has_wow_exe(path));
    }

    #[test]
    fn test_validate_game_path() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        assert!(!validate_game_path(path.to_string_lossy().to_string()));

        File::create(path.join("WoW.exe")).unwrap();
        assert!(validate_game_path(path.to_string_lossy().to_string()));
    }

    #[test]
    fn test_find_wow_exe_dir_recursive() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        assert!(find_wow_exe_dir_recursive(path).is_none());

        // Nested subfolder
        let sub = path.join("WoW_Client").join("nested");
        std::fs::create_dir_all(&sub).unwrap();
        File::create(sub.join("wow.exe")).unwrap();

        let found = find_wow_exe_dir_recursive(path);
        assert!(found.is_some());
        assert_eq!(found.unwrap(), sub);
    }
}
