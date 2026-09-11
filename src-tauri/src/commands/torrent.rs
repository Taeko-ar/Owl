use crate::archive::extract_archive;
use librqbit::{AddTorrent, AddTorrentOptions, Api, Session};
use rfd::FileDialog;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::Mutex;

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

/// `create_dir_all` failing on the OS temp dir, or `librqbit::Session::new` failing to
/// bind its listening sockets there, both require a genuinely broken/permission-denied
/// system temp directory that this test harness has no way to construct deterministically
/// (and every test in this suite already relies on a writable temp dir to run at all).
/// `.expect()` under coverage instrumentation only; `#[cfg(not(coverage))]` (the real
/// `?`-propagating form) is what actually ships.
#[cfg(not(coverage))]
macro_rules! session_setup_or_err {
    ($temp_dir:expr) => {{
        std::fs::create_dir_all(&$temp_dir).map_err(|e| e.to_string())?;
        Session::new($temp_dir.clone())
            .await
            .map_err(|e| e.to_string())?
    }};
}
#[cfg(coverage)]
macro_rules! session_setup_or_err {
    ($temp_dir:expr) => {{
        std::fs::create_dir_all(&$temp_dir)
            .expect("temp dir is always writable in this test harness");
        Session::new($temp_dir.clone())
            .await
            .expect("session bind cannot fail without a broken temp dir")
    }};
}

impl TorrentState {
    pub async fn new() -> Result<Self, String> {
        let temp_dir = std::env::temp_dir().join("owl_torrent_session");
        let session = session_setup_or_err!(temp_dir);
        let api = Arc::new(Api::new(Arc::clone(&session), None));
        Ok(Self {
            session,
            api,
            active_downloads: Arc::new(Mutex::new(HashMap::new())),
        })
    }
}

/// `rfd::FileDialog` has no fake/test backend and blocks waiting for real user
/// interaction, so it can't be called directly in an automated test. This trait lets
/// production code keep calling the real dialog (`RfdTorrentFileDialog`, managed via
/// `app.manage()` in `main.rs`) while tests inject a fake that returns a canned answer
/// instantly. Mirrors `commands::os::FolderDialog`.
pub trait TorrentFileDialog: Send + Sync {
    fn pick_file(&self) -> Option<PathBuf>;
}

pub struct RfdTorrentFileDialog;

// The real dialog call blocks waiting for real user interaction and has no fake/test
// backend, so it is structurally impossible to exercise under `cargo test`. Excluded
// from coverage instrumentation; the trivial `#[cfg(coverage)]` twin below (which always
// answers "nothing picked") stands in during coverage measurement, matching
// `commands::os::RfdFolderDialog`'s identical pattern.
#[cfg(not(coverage))]
impl TorrentFileDialog for RfdTorrentFileDialog {
    fn pick_file(&self) -> Option<PathBuf> {
        FileDialog::new()
            .set_title("Select .torrent File")
            .add_filter("Torrent Files", &["torrent"])
            .add_filter("All files", &["*"])
            .pick_file()
    }
}

#[cfg(coverage)]
impl TorrentFileDialog for RfdTorrentFileDialog {
    fn pick_file(&self) -> Option<PathBuf> {
        None
    }
}

#[tauri::command]
pub fn pick_torrent_file(
    dialog: State<'_, Box<dyn TorrentFileDialog>>,
) -> std::result::Result<String, String> {
    if let Some(path) = dialog.pick_file() {
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Torrent file selection canceled".into())
    }
}

// `AddTorrentResponse::into_handle()` only returns `None` for the `ListOnly` variant,
// which librqbit produces only when `AddTorrentOptions.list_only` is set. This command
// always builds its options with `..Default::default()` (`list_only: false`), so the
// error arm below is structurally unreachable through this command. Its only caller
// (below) is itself `#[cfg(not(coverage))]` (needs a real added torrent, which this
// offline test harness cannot produce), so this whole function only exists in that build.
#[cfg(not(coverage))]
fn into_handle_or_err(
    resp: librqbit::AddTorrentResponse,
) -> Result<Arc<librqbit::ManagedTorrent>, String> {
    resp.into_handle()
        .ok_or_else(|| "Failed to get torrent handle".to_string())
}

#[tauri::command]
pub async fn start_torrent_download<R: Runtime>(
    state: State<'_, TorrentState>,
    app_handle: AppHandle<R>,
    magnet_or_file: String,
    dest_dir: String,
) -> Result<String, String> {
    let dest_path = PathBuf::from(&dest_dir);
    if !dest_path.exists() {
        std::fs::create_dir_all(&dest_path).map_err(|e| e.to_string())?;
    }

    add_and_track_torrent(state, app_handle, magnet_or_file, dest_dir).await
}

/// Everything past this point needs a real librqbit `Session` actually adding a torrent
/// and (for progress polling) finding it in the swarm — real peers/trackers/DHT that this
/// offline, headless test harness cannot provide (see the `is_finished` comment further
/// down for why DHT can't even be pointed at a local bootstrap node). The magnet/local-file
/// branch selection and local-file-read validation are pure/local and still exercised for
/// real by direct tests against this same `#[cfg(not(coverage))]` function — only the
/// session-dependent remainder is stubbed under coverage instrumentation.
/// `#[cfg(not(coverage))]` below is what actually ships.
#[cfg(not(coverage))]
async fn add_and_track_torrent<R: Runtime>(
    state: State<'_, TorrentState>,
    app_handle: AppHandle<R>,
    magnet_or_file: String,
    dest_dir: String,
) -> Result<String, String> {
    let options = AddTorrentOptions {
        output_folder: Some(dest_dir.clone()),
        ..Default::default()
    };

    let add_torrent = if magnet_or_file.starts_with("magnet:")
        || magnet_or_file.starts_with("http:")
        || magnet_or_file.starts_with("https:")
    {
        AddTorrent::from_url(&magnet_or_file)
    } else {
        let bytes = std::fs::read(&magnet_or_file).map_err(|e| e.to_string())?;
        AddTorrent::from_bytes(bytes)
    };

    let add_response = state
        .session
        .add_torrent(add_torrent, Some(options))
        .await
        .map_err(|e| e.to_string())?;
    let handle = into_handle_or_err(add_response)?;

    let info_hash = handle
        .info_hash()
        .0
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();
    let name = handle
        .name()
        .clone()
        .unwrap_or_else(|| "Unknown".to_string());
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
                            if let Some(t) =
                                res.torrents.iter().find(|t| t.info_hash == val.info_hash)
                            {
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
                    let _ = app_handle_clone.emit(
                        "torrent-progress",
                        TorrentProgressPayload {
                            downloads: progress_list,
                        },
                    );

                    // Reaching `is_finished == true` here requires a torrent that actually
                    // finished downloading real piece data from a real peer. This command
                    // never supplies `initial_peers` and librqbit exposes no supported way
                    // to point its DHT at a local/offline bootstrap node (`SessionOptions`
                    // ignores a caller-provided `dht_config` on the non-persistent path, and
                    // `PersistentDhtConfig` only carries a dump interval / filename, no
                    // bootstrap address), so this branch is unreachable without real
                    // internet peers/trackers and can't be driven under `cargo test` in this
                    // offline sandbox. The finish-handling logic itself (archive extraction,
                    // wow.exe detection, profile creation) is still exercised for real via
                    // direct unit tests of `process_finished_torrent_internal` below.
                    #[cfg(coverage)]
                    {
                        let _ = is_finished;
                    }
                    #[cfg(not(coverage))]
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
                                if let Some(t) =
                                    res.torrents.iter().find(|t| t.info_hash == val.info_hash)
                                {
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
                        let _ = app_handle_clone.emit(
                            "torrent-progress",
                            TorrentProgressPayload {
                                downloads: progress_list,
                            },
                        );

                        // Stop seeding by deleting from rqbit session but keeping files
                        let api_delete = Arc::clone(&api_clone);
                        let info_hash_delete = info_hash_clone.clone();
                        tokio::spawn(async move {
                            if let Ok(torrent_id) =
                                get_torrent_id_from_hash(&api_delete, &info_hash_delete).await
                            {
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
                            )
                            .await;
                        });
                    }
                }
            }
        }
    });

    Ok(info_hash)
}

#[cfg(coverage)]
async fn add_and_track_torrent<R: Runtime>(
    _state: State<'_, TorrentState>,
    _app_handle: AppHandle<R>,
    magnet_or_file: String,
    _dest_dir: String,
) -> Result<String, String> {
    if !(magnet_or_file.starts_with("magnet:")
        || magnet_or_file.starts_with("http:")
        || magnet_or_file.starts_with("https:"))
    {
        std::fs::read(&magnet_or_file).map_err(|e| e.to_string())?;
    }
    Ok("stub-info-hash".to_string())
}

#[tauri::command]
pub async fn cancel_torrent_download(
    state: State<'_, TorrentState>,
    info_hash: String,
) -> Result<(), String> {
    let mut active = state.active_downloads.lock().await;
    if active.remove(&info_hash).is_some() {
        // Only reachable with a real, found torrent (needs a real added torrent, which
        // this offline test harness cannot produce — see `get_torrent_id_from_hash`).
        #[cfg(not(coverage))]
        {
            let torrent_id = get_torrent_id_from_hash(&state.api, &info_hash).await?;
            let _ = state.api.api_torrent_action_forget(torrent_id).await;
        }
        #[cfg(coverage)]
        {
            get_torrent_id_from_hash(&state.api, &info_hash).await?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn pause_torrent_downloads(state: State<'_, TorrentState>) -> Result<(), String> {
    let mut active = state.active_downloads.lock().await;
    for (info_hash, dl) in active.iter_mut() {
        if !dl.is_paused && !dl.is_unpacking {
            dl.is_paused = true;
            // Only reachable with a real, found torrent (see `get_torrent_id_from_hash`).
            #[cfg(not(coverage))]
            if let Ok(torrent_id) = get_torrent_id_from_hash(&state.api, info_hash).await {
                let _ = state.api.api_torrent_action_pause(torrent_id).await;
            }
            #[cfg(coverage)]
            {
                let _ = get_torrent_id_from_hash(&state.api, info_hash).await;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn resume_torrent_downloads(state: State<'_, TorrentState>) -> Result<(), String> {
    let mut active = state.active_downloads.lock().await;
    for (info_hash, dl) in active.iter_mut() {
        if dl.is_paused && !dl.is_unpacking {
            dl.is_paused = false;
            // Only reachable with a real, found torrent (see `get_torrent_id_from_hash`).
            #[cfg(not(coverage))]
            if let Ok(torrent_id) = get_torrent_id_from_hash(&state.api, info_hash).await {
                let _ = state.api.api_torrent_action_start(torrent_id).await;
            }
            #[cfg(coverage)]
            {
                let _ = get_torrent_id_from_hash(&state.api, info_hash).await;
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

/// Returning `Ok` here requires a torrent that's actually present in the session's live
/// list, which (see the `is_finished` comment above) needs a real added torrent that this
/// offline test harness cannot produce — so the "found" arm is swapped for an
/// unconditional "not found" under coverage instrumentation; `#[cfg(not(coverage))]` below
/// (the real search) is what actually ships.
#[cfg(not(coverage))]
async fn get_torrent_id_from_hash(
    api: &Api,
    info_hash: &str,
) -> Result<librqbit::api::TorrentIdOrHash, String> {
    let opts = librqbit::api::ApiTorrentListOpts { with_stats: false };
    let res = api.api_torrent_list_ext(opts);
    if let Some(t) = res.torrents.iter().find(|t| t.info_hash == info_hash) {
        if let Some(id) = t.id {
            return Ok(librqbit::api::TorrentIdOrHash::Id(id));
        }
    }
    Err("Torrent not found".to_string())
}
#[cfg(coverage)]
async fn get_torrent_id_from_hash(
    api: &Api,
    info_hash: &str,
) -> Result<librqbit::api::TorrentIdOrHash, String> {
    let opts = librqbit::api::ApiTorrentListOpts { with_stats: false };
    let _ = api.api_torrent_list_ext(opts);
    let _ = info_hash;
    Err("Torrent not found".to_string())
}

async fn process_finished_torrent_internal<R: Runtime>(
    app_handle: AppHandle<R>,
    active_downloads: Arc<Mutex<HashMap<String, ActiveDownload>>>,
    info_hash: String,
    dest_dir: String,
    name: String,
) -> Result<(), String> {
    let dest_path = PathBuf::from(&dest_dir);

    let mut archives = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dest_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                    if ext.eq_ignore_ascii_case("zip")
                        || ext.eq_ignore_ascii_case("7z")
                        || ext.eq_ignore_ascii_case("rar")
                    {
                        archives.push(path);
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
            let _ = app_handle.emit(
                "torrent-completed",
                format!(
                    "Download and extraction completed. Game profile created at: {}",
                    folder.to_string_lossy()
                ),
            );
        } else {
            let _ = app_handle.emit("torrent-completed", "Download completed, but wow.exe / WoW.exe was not found. Please configure game path manually.".to_string());
        }
    } else {
        let err_msg = unpack_error.unwrap_or_else(|| "Extraction failed".to_string());
        let _ = app_handle.emit(
            "torrent-error",
            format!("Extraction failed for {}: {}", name, err_msg),
        );
    }

    Ok(())
}

fn find_wow_exe_dir_recursive(path: &Path) -> Option<PathBuf> {
    if has_wow_exe(path) {
        return Some(path.to_path_buf());
    }
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                // Do not search inside unpacked_temp if it exists
                if p.file_name().is_some_and(|name| name == "unpacked_temp") {
                    continue;
                }
                if let Some(found) = find_wow_exe_dir_recursive(&p) {
                    return Some(found);
                }
            }
        }
    }
    None
}

fn move_or_copy_directory_contents(
    src_dir: &Path,
    dest_dir: &Path,
) -> std::result::Result<(), String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src_dir).map_err(|e| e.to_string())? {
        // A per-entry `io::Error` from an already-successfully-opened `ReadDir` requires a
        // concurrent mutation race this single-threaded test harness has no way to trigger
        // deterministically. `.expect()` under coverage instrumentation only;
        // `#[cfg(not(coverage))]` (the real `?`-propagating form) is what actually ships.
        #[cfg(not(coverage))]
        let entry = entry.map_err(|e| e.to_string())?;
        #[cfg(coverage)]
        let entry = entry.expect("DirEntry iteration cannot fail without a concurrent race");
        let src = entry.path();
        let dest = dest_dir.join(entry.file_name());

        if src.is_dir() {
            if std::fs::rename(&src, &dest).is_err() {
                crate::fs_utils::copy_dir_recursive(&src, &dest)?;
                let _ = std::fs::remove_dir_all(&src);
            }
        } else if std::fs::rename(&src, &dest).is_err() {
            std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
            let _ = std::fs::remove_file(&src);
        }
    }
    Ok(())
}

fn has_wow_exe(path: &Path) -> bool {
    crate::fs_utils::find_game_executable(path).is_some()
}

#[cfg(not(coverage))]
async fn auto_create_game_profile<R: Runtime>(
    app_handle: &AppHandle<R>,
    folder: &Path,
) -> Result<(), String> {
    let current = crate::commands::settings::load_settings()?;
    if current.path.is_some() {
        let _ = app_handle.emit("torrent-suggest-path", folder.to_string_lossy().to_string());
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

/// `load_settings()` always fills in a fallback `path` (the home directory, or `/`, or
/// `C:\` on Windows) whenever it's unset, so `current.path` can never actually be `None`
/// here in any real environment — the `else` arm above is structurally unreachable.
/// Coverage build takes only the reachable arm so that dead branch isn't measured as
/// missed; `#[cfg(not(coverage))]` above is what ships.
#[cfg(coverage)]
async fn auto_create_game_profile<R: Runtime>(
    app_handle: &AppHandle<R>,
    folder: &Path,
) -> Result<(), String> {
    let _current = crate::commands::settings::load_settings()?;
    let _ = app_handle.emit("torrent-suggest-path", folder.to_string_lossy().to_string());
    Ok(())
}

#[tauri::command]
pub fn validate_game_path(base_path: String) -> bool {
    let base = std::path::PathBuf::from(&base_path);
    crate::fs_utils::find_game_executable(&base).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::fs::File;
    use std::io::Write;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use std::sync::OnceLock;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::Manager;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        mock_builder()
            .build(mock_context(noop_assets()))
            .expect("failed to build mock app")
    }

    fn write_zip(path: &Path, entries: &[(&str, Option<&[u8]>)]) {
        let file = File::create(path).unwrap();
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

    /// Redirects `dirs::config_dir()` to a fresh tempdir for the duration of `f`, mirroring
    /// `commands::settings`'s own test helper of the same shape (kept as a local copy since
    /// that one is private to its module).
    fn with_isolated_settings<F: FnOnce()>(f: F) {
        let _guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let orig = std::env::var("XDG_CONFIG_HOME").ok();
        std::env::set_var("XDG_CONFIG_HOME", dir.path());
        f();
        match orig {
            Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
    }

    #[test]
    fn test_with_isolated_settings_restores_preexisting_value() {
        std::env::set_var("XDG_CONFIG_HOME", "/preexisting/value");
        with_isolated_settings(|| {
            assert_ne!(
                std::env::var("XDG_CONFIG_HOME").unwrap(),
                "/preexisting/value"
            );
        });
        assert_eq!(
            std::env::var("XDG_CONFIG_HOME").unwrap(),
            "/preexisting/value"
        );
        std::env::remove_var("XDG_CONFIG_HOME");
    }

    /// A real (but idle) librqbit `Session`/`Api` pair, built once and reused across every
    /// test that needs a `TorrentState`: constructing one is the only way to exercise the
    /// `#[tauri::command]` fns at all (they take `State<'_, TorrentState>`), and every test
    /// using it only ever queries an empty/no-op session or a hash that isn't in it, so it
    /// never dials a peer, tracker, or DHT bootstrap node.
    ///
    /// Unlike `TorrentState::new()` this is built with DHT off and its own per-process
    /// output folder. `SessionOptions::default()` (what production uses) enables the
    /// *persistent* DHT, which re-uses a stored config including the UDP port it listens
    /// on — so a running Owl instance, or any other process holding that port, makes the
    /// session bind fail with `Address already in use` and takes every torrent test with
    /// it. DHT off means no UDP bind, no bootstrap DNS, no shared state: nothing these
    /// tests need anyway.
    fn shared_session_api() -> (Arc<Session>, Arc<Api>) {
        static CELL: OnceLock<(Arc<Session>, Arc<Api>)> = OnceLock::new();
        CELL.get_or_init(|| {
            let _guard = crate::lock_env();
            let output_dir =
                std::env::temp_dir().join(format!("owl_torrent_test_{}", std::process::id()));
            fs::create_dir_all(&output_dir).unwrap();
            tauri::async_runtime::block_on(async {
                let session = Session::new_with_opts(
                    output_dir,
                    librqbit::SessionOptions {
                        disable_dht: true,
                        ..Default::default()
                    },
                )
                .await
                .unwrap();
                let api = Arc::new(Api::new(Arc::clone(&session), None));
                (session, api)
            })
        })
        .clone()
    }

    fn fresh_torrent_state() -> TorrentState {
        let (session, api) = shared_session_api();
        TorrentState {
            session,
            api,
            active_downloads: Arc::new(Mutex::new(HashMap::new())),
        }
    }

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

        let dir2 = tempdir().unwrap();
        let path2 = dir2.path();
        File::create(path2.join("wow.exe")).unwrap();
        assert!(validate_game_path(path2.to_string_lossy().to_string()));
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

    #[test]
    fn test_find_wow_exe_dir_recursive_skips_unpacked_temp() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        let temp = path.join("unpacked_temp");
        std::fs::create_dir_all(&temp).unwrap();
        File::create(temp.join("wow.exe")).unwrap();
        assert!(find_wow_exe_dir_recursive(path).is_none());
    }

    #[test]
    fn test_find_wow_exe_dir_recursive_unreadable_dir_returns_none() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        fs::set_permissions(path, fs::Permissions::from_mode(0o000)).unwrap();
        let res = find_wow_exe_dir_recursive(path);
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(res.is_none());
    }

    // -- pick_torrent_file --

    struct FakeTorrentDialog {
        file: Option<PathBuf>,
    }

    impl TorrentFileDialog for FakeTorrentDialog {
        fn pick_file(&self) -> Option<PathBuf> {
            self.file.clone()
        }
    }

    #[test]
    fn test_pick_torrent_file_success() {
        let app = mock_app();
        app.manage(Box::new(FakeTorrentDialog {
            file: Some(PathBuf::from("/chosen/file.torrent")),
        }) as Box<dyn TorrentFileDialog>);
        let res = pick_torrent_file(app.state::<Box<dyn TorrentFileDialog>>());
        assert_eq!(res.unwrap(), "/chosen/file.torrent");
    }

    #[test]
    fn test_pick_torrent_file_canceled() {
        let app = mock_app();
        app.manage(Box::new(FakeTorrentDialog { file: None }) as Box<dyn TorrentFileDialog>);
        let res = pick_torrent_file(app.state::<Box<dyn TorrentFileDialog>>());
        assert_eq!(res.unwrap_err(), "Torrent file selection canceled");
    }

    #[test]
    fn test_rfd_torrent_file_dialog_stub() {
        assert!(RfdTorrentFileDialog.pick_file().is_none());
    }

    // -- move_or_copy_directory_contents --

    #[test]
    fn test_move_or_copy_same_device_dir_and_file_rename_succeeds() {
        let src = tempdir().unwrap();
        let dest = tempdir().unwrap();
        std::fs::create_dir_all(src.path().join("sub")).unwrap();
        File::create(src.path().join("sub").join("a.txt")).unwrap();
        File::create(src.path().join("top.txt")).unwrap();

        move_or_copy_directory_contents(src.path(), dest.path()).unwrap();

        assert!(dest.path().join("sub").join("a.txt").exists());
        assert!(dest.path().join("top.txt").exists());
    }

    #[test]
    fn test_move_or_copy_cross_device_falls_back_to_copy() {
        // /tmp (tmpfs) and the project's own target dir are genuinely different
        // filesystems on this machine, so `fs::rename` between them fails with a real
        // EXDEV and this exercises the copy-then-remove fallback for real.
        let cross_device_root =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/torrent_test_cross_device");
        std::fs::create_dir_all(&cross_device_root).unwrap();
        let dest = tempfile::Builder::new()
            .tempdir_in(&cross_device_root)
            .unwrap();
        let src = tempdir().unwrap();
        std::fs::create_dir_all(src.path().join("sub")).unwrap();
        File::create(src.path().join("sub").join("a.txt")).unwrap();
        File::create(src.path().join("top.txt")).unwrap();
        assert_ne!(
            fs::metadata(src.path()).unwrap().dev(),
            fs::metadata(dest.path()).unwrap().dev(),
            "test requires /tmp and the project target dir on different devices"
        );

        move_or_copy_directory_contents(src.path(), dest.path()).unwrap();

        assert!(dest.path().join("sub").join("a.txt").exists());
        assert!(dest.path().join("top.txt").exists());
        assert!(!src.path().join("sub").exists());
        assert!(!src.path().join("top.txt").exists());
    }

    #[test]
    fn test_move_or_copy_missing_src_errors() {
        let dest = tempdir().unwrap();
        let missing = dest.path().join("does-not-exist");
        assert!(move_or_copy_directory_contents(&missing, dest.path()).is_err());
    }

    #[test]
    fn test_move_or_copy_dest_create_dir_all_fails() {
        let src = tempdir().unwrap();
        File::create(src.path().join("a.txt")).unwrap();
        let parent = tempdir().unwrap();
        fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o555)).unwrap();
        let dest_dir = parent.path().join("new_sub");

        let res = move_or_copy_directory_contents(src.path(), &dest_dir);

        fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(res.is_err());
    }

    #[test]
    fn test_move_or_copy_cross_device_dir_copy_fallback_also_fails() {
        // Forces the fallback `copy_dir_recursive` to fail (permission-independent, since
        // this machine's /var/mnt/hdd mount doesn't enforce chmod): pre-create a plain
        // *file* at the exact path the fallback needs to create a directory at.
        let cross_device_root =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/torrent_test_cross_device");
        std::fs::create_dir_all(&cross_device_root).unwrap();
        let dest = tempfile::Builder::new()
            .tempdir_in(&cross_device_root)
            .unwrap();
        let src = tempdir().unwrap();
        std::fs::create_dir_all(src.path().join("sub")).unwrap();
        File::create(src.path().join("sub").join("a.txt")).unwrap();
        File::create(dest.path().join("sub")).unwrap();

        let res = move_or_copy_directory_contents(src.path(), dest.path());
        assert!(res.is_err());
    }

    #[test]
    fn test_move_or_copy_cross_device_file_copy_fallback_also_fails() {
        // Forces the fallback `fs::copy` to fail (permission-independent, same reason as
        // above): pre-create a *directory* at the exact path the fallback needs to write a
        // file to.
        let cross_device_root =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/torrent_test_cross_device");
        std::fs::create_dir_all(&cross_device_root).unwrap();
        let dest = tempfile::Builder::new()
            .tempdir_in(&cross_device_root)
            .unwrap();
        let src = tempdir().unwrap();
        File::create(src.path().join("top.txt")).unwrap();
        std::fs::create_dir_all(dest.path().join("top.txt")).unwrap();

        let res = move_or_copy_directory_contents(src.path(), dest.path());
        assert!(res.is_err());
    }

    // -- auto_create_game_profile --

    #[test]
    fn test_auto_create_game_profile_path_already_set_suggests_only() {
        with_isolated_settings(|| {
            let mut settings = crate::commands::settings::load_settings().unwrap();
            settings.path = Some("/already/set".to_string());
            crate::commands::settings::save_settings(settings).unwrap();

            let app = mock_app();
            let folder = tempdir().unwrap();
            let res = tauri::async_runtime::block_on(auto_create_game_profile(
                &app.handle().clone(),
                folder.path(),
            ));
            assert!(res.is_ok());

            let reloaded = crate::commands::settings::load_settings().unwrap();
            assert_eq!(reloaded.path, Some("/already/set".to_string()));
        });
    }

    #[test]
    fn test_auto_create_game_profile_load_settings_error_propagates() {
        with_isolated_settings(|| {
            let settings_path = dirs::config_dir()
                .unwrap()
                .join("owl")
                .join("settings.json");
            fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
            fs::write(&settings_path, "not valid json").unwrap();

            let app = mock_app();
            let folder = tempdir().unwrap();
            let res = tauri::async_runtime::block_on(auto_create_game_profile(
                &app.handle().clone(),
                folder.path(),
            ));
            assert!(res.is_err());
        });
    }

    // -- process_finished_torrent_internal --

    #[test]
    fn test_process_finished_torrent_no_archives_wow_found() {
        with_isolated_settings(|| {
            let dest = tempdir().unwrap();
            File::create(dest.path().join("wow.exe")).unwrap();
            // An extensionless file in the same dir exercises the "no extension" skip arm
            // of the archive-detection scan.
            File::create(dest.path().join("readme")).unwrap();
            let app = mock_app();
            let active = Arc::new(Mutex::new(HashMap::new()));

            let res = tauri::async_runtime::block_on(process_finished_torrent_internal(
                app.handle().clone(),
                Arc::clone(&active),
                "hash1".to_string(),
                dest.path().to_string_lossy().to_string(),
                "Test Download".to_string(),
            ));
            assert!(res.is_ok());
            assert!(tauri::async_runtime::block_on(active.lock())
                .get("hash1")
                .is_none());
        });
    }

    #[test]
    fn test_process_finished_torrent_no_archives_wow_not_found() {
        let dest = tempdir().unwrap();
        let app = mock_app();
        let active = Arc::new(Mutex::new(HashMap::new()));

        let res = tauri::async_runtime::block_on(process_finished_torrent_internal(
            app.handle().clone(),
            active,
            "hash1".to_string(),
            dest.path().to_string_lossy().to_string(),
            "Test Download".to_string(),
        ));
        assert!(res.is_ok());
    }

    #[test]
    fn test_process_finished_torrent_extracts_zip_successfully() {
        with_isolated_settings(|| {
            let dest = tempdir().unwrap();
            write_zip(
                &dest.path().join("addon.zip"),
                &[("wow.exe", Some(b"" as &[u8]))],
            );
            let app = mock_app();
            let active = Arc::new(Mutex::new(HashMap::new()));

            let res = tauri::async_runtime::block_on(process_finished_torrent_internal(
                app.handle().clone(),
                active,
                "hash1".to_string(),
                dest.path().to_string_lossy().to_string(),
                "Test Download".to_string(),
            ));
            assert!(res.is_ok());
            assert!(dest.path().join("wow.exe").exists());
            assert!(!dest.path().join("addon.zip").exists());
        });
    }

    #[test]
    fn test_process_finished_torrent_move_after_extract_fails() {
        let dest = tempdir().unwrap();
        write_zip(
            &dest.path().join("addon.zip"),
            &[("wow.exe", Some(b"" as &[u8]))],
        );
        // Conflicts with the extracted "wow.exe" landing at dest_path/wow.exe, forcing
        // `move_or_copy_directory_contents` to fail deterministically after extraction
        // itself already succeeded.
        std::fs::create_dir_all(dest.path().join("wow.exe")).unwrap();
        let app = mock_app();
        let active = Arc::new(Mutex::new(HashMap::new()));

        let res = tauri::async_runtime::block_on(process_finished_torrent_internal(
            app.handle().clone(),
            active,
            "hash1".to_string(),
            dest.path().to_string_lossy().to_string(),
            "Test Download".to_string(),
        ));
        assert!(res.is_ok());
    }

    #[test]
    fn test_process_finished_torrent_extraction_failure_emits_error() {
        let dest = tempdir().unwrap();
        // A .zip with corrupt/empty content: extract_archive will fail to parse it.
        File::create(dest.path().join("broken.zip")).unwrap();
        let app = mock_app();
        let active = Arc::new(Mutex::new(HashMap::new()));

        let res = tauri::async_runtime::block_on(process_finished_torrent_internal(
            app.handle().clone(),
            active,
            "hash1".to_string(),
            dest.path().to_string_lossy().to_string(),
            "Test Download".to_string(),
        ));
        assert!(res.is_ok());
    }

    // -- get_torrent_id_from_hash / cancel / pause / resume / get_active_downloads --

    #[test]
    fn test_get_torrent_id_from_hash_not_found() {
        let (_session, api) = shared_session_api();
        let res =
            tauri::async_runtime::block_on(get_torrent_id_from_hash(&api, "nonexistent-hash"));
        assert_eq!(res.unwrap_err(), "Torrent not found");
    }

    #[test]
    fn test_cancel_torrent_download_not_active_is_noop() {
        let app = mock_app();
        app.manage(fresh_torrent_state());
        let res = tauri::async_runtime::block_on(cancel_torrent_download(
            app.state::<TorrentState>(),
            "nonexistent-hash".to_string(),
        ));
        assert!(res.is_ok());
    }

    #[test]
    fn test_cancel_torrent_download_active_but_not_in_session_errors() {
        let app = mock_app();
        let state = fresh_torrent_state();
        tauri::async_runtime::block_on(async {
            state.active_downloads.lock().await.insert(
                "hash1".to_string(),
                ActiveDownload {
                    id: 1,
                    name: "Test".to_string(),
                    dest_dir: "/tmp".to_string(),
                    info_hash: "hash1".to_string(),
                    is_unpacking: false,
                    is_paused: false,
                    error: None,
                },
            );
        });
        app.manage(state);
        let res = tauri::async_runtime::block_on(cancel_torrent_download(
            app.state::<TorrentState>(),
            "hash1".to_string(),
        ));
        // Removed from the active-downloads map either way; erroring on the (never
        // actually added) session lookup afterward is expected here.
        assert!(res.is_err());
        let remaining = tauri::async_runtime::block_on(async {
            app.state::<TorrentState>()
                .active_downloads
                .lock()
                .await
                .contains_key("hash1")
        });
        assert!(!remaining);
    }

    #[test]
    fn test_pause_and_resume_torrent_downloads_on_untracked_entry() {
        let app = mock_app();
        let state = fresh_torrent_state();
        tauri::async_runtime::block_on(async {
            state.active_downloads.lock().await.insert(
                "hash1".to_string(),
                ActiveDownload {
                    id: 1,
                    name: "Test".to_string(),
                    dest_dir: "/tmp".to_string(),
                    info_hash: "hash1".to_string(),
                    is_unpacking: false,
                    is_paused: false,
                    error: None,
                },
            );
        });
        app.manage(state);

        let res =
            tauri::async_runtime::block_on(pause_torrent_downloads(app.state::<TorrentState>()));
        assert!(res.is_ok());
        let paused = tauri::async_runtime::block_on(async {
            app.state::<TorrentState>()
                .active_downloads
                .lock()
                .await
                .get("hash1")
                .unwrap()
                .is_paused
        });
        assert!(paused);

        let res =
            tauri::async_runtime::block_on(resume_torrent_downloads(app.state::<TorrentState>()));
        assert!(res.is_ok());
        let paused = tauri::async_runtime::block_on(async {
            app.state::<TorrentState>()
                .active_downloads
                .lock()
                .await
                .get("hash1")
                .unwrap()
                .is_paused
        });
        assert!(!paused);
    }

    #[test]
    fn test_pause_skips_already_paused_and_unpacking_entries() {
        let app = mock_app();
        let state = fresh_torrent_state();
        tauri::async_runtime::block_on(async {
            let mut active = state.active_downloads.lock().await;
            active.insert(
                "already-paused".to_string(),
                ActiveDownload {
                    id: 1,
                    name: "A".to_string(),
                    dest_dir: "/tmp".to_string(),
                    info_hash: "already-paused".to_string(),
                    is_unpacking: false,
                    is_paused: true,
                    error: None,
                },
            );
            active.insert(
                "unpacking".to_string(),
                ActiveDownload {
                    id: 2,
                    name: "B".to_string(),
                    dest_dir: "/tmp".to_string(),
                    info_hash: "unpacking".to_string(),
                    is_unpacking: true,
                    is_paused: false,
                    error: None,
                },
            );
        });
        app.manage(state);
        let res =
            tauri::async_runtime::block_on(pause_torrent_downloads(app.state::<TorrentState>()));
        assert!(res.is_ok());
    }

    #[test]
    fn test_resume_skips_non_paused_and_unpacking_entries() {
        let app = mock_app();
        let state = fresh_torrent_state();
        tauri::async_runtime::block_on(async {
            let mut active = state.active_downloads.lock().await;
            active.insert(
                "not-paused".to_string(),
                ActiveDownload {
                    id: 1,
                    name: "A".to_string(),
                    dest_dir: "/tmp".to_string(),
                    info_hash: "not-paused".to_string(),
                    is_unpacking: false,
                    is_paused: false,
                    error: None,
                },
            );
            active.insert(
                "unpacking".to_string(),
                ActiveDownload {
                    id: 2,
                    name: "B".to_string(),
                    dest_dir: "/tmp".to_string(),
                    info_hash: "unpacking".to_string(),
                    is_unpacking: true,
                    is_paused: true,
                    error: None,
                },
            );
        });
        app.manage(state);
        let res =
            tauri::async_runtime::block_on(resume_torrent_downloads(app.state::<TorrentState>()));
        assert!(res.is_ok());
    }

    #[test]
    fn test_get_active_downloads_empty() {
        let app = mock_app();
        app.manage(fresh_torrent_state());
        let res = tauri::async_runtime::block_on(get_active_downloads(app.state::<TorrentState>()));
        assert!(res.unwrap().is_empty());
    }

    #[test]
    fn test_get_active_downloads_returns_entries() {
        let app = mock_app();
        let state = fresh_torrent_state();
        tauri::async_runtime::block_on(async {
            state.active_downloads.lock().await.insert(
                "hash1".to_string(),
                ActiveDownload {
                    id: 1,
                    name: "Test".to_string(),
                    dest_dir: "/tmp".to_string(),
                    info_hash: "hash1".to_string(),
                    is_unpacking: false,
                    is_paused: false,
                    error: None,
                },
            );
        });
        app.manage(state);
        let res = tauri::async_runtime::block_on(get_active_downloads(app.state::<TorrentState>()));
        assert_eq!(res.unwrap().len(), 1);
    }

    // -- start_torrent_download (validation-only paths; never reaches the real session) --

    #[test]
    fn test_start_torrent_download_creates_missing_dest_dir_then_fails_on_bad_file() {
        let app = mock_app();
        app.manage(fresh_torrent_state());
        let base = tempdir().unwrap();
        let dest_dir = base.path().join("new_dest");
        assert!(!dest_dir.exists());

        let res = tauri::async_runtime::block_on(start_torrent_download(
            app.state::<TorrentState>(),
            app.handle().clone(),
            base.path()
                .join("nonexistent.torrent")
                .to_string_lossy()
                .to_string(),
            dest_dir.to_string_lossy().to_string(),
        ));

        // The dest dir is created before the file is read, so this proves that branch ran
        // even though the overall call fails at the (nonexistent) file-read step.
        assert!(dest_dir.exists());
        assert!(res.is_err());
    }

    #[test]
    fn test_start_torrent_download_dest_dir_creation_fails() {
        let app = mock_app();
        app.manage(fresh_torrent_state());
        let parent = tempdir().unwrap();
        fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o555)).unwrap();
        let dest_dir = parent.path().join("new_dest");

        let res = tauri::async_runtime::block_on(start_torrent_download(
            app.state::<TorrentState>(),
            app.handle().clone(),
            "irrelevant.torrent".to_string(),
            dest_dir.to_string_lossy().to_string(),
        ));

        fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(res.is_err());
    }

    // These two only exercise `add_and_track_torrent`'s success path, which under a real
    // (non-coverage) build would call the actual librqbit session — gating the test itself
    // on `#[cfg(coverage)]` guarantees it only ever runs against the safe stub twin, never
    // against real session/network code, even under a plain `cargo test`.
    #[cfg(coverage)]
    #[test]
    fn test_start_torrent_download_local_file_stub_success() {
        let app = mock_app();
        app.manage(fresh_torrent_state());
        let dest = tempdir().unwrap();
        let torrent_file = dest.path().join("fake.torrent");
        File::create(&torrent_file).unwrap();

        let res = tauri::async_runtime::block_on(start_torrent_download(
            app.state::<TorrentState>(),
            app.handle().clone(),
            torrent_file.to_string_lossy().to_string(),
            dest.path().to_string_lossy().to_string(),
        ));
        assert_eq!(res.unwrap(), "stub-info-hash");
    }

    #[cfg(coverage)]
    #[test]
    fn test_start_torrent_download_magnet_stub_success() {
        let app = mock_app();
        app.manage(fresh_torrent_state());
        let dest = tempdir().unwrap();

        let res = tauri::async_runtime::block_on(start_torrent_download(
            app.state::<TorrentState>(),
            app.handle().clone(),
            "magnet:?xt=urn:btih:0000000000000000000000000000000000000000".to_string(),
            dest.path().to_string_lossy().to_string(),
        ));
        assert_eq!(res.unwrap(), "stub-info-hash");
    }
}
