#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::fs;
use std::path::Path;
use sha1::{Sha1, Digest};

pub mod models;
pub mod fs_utils;
pub mod git;
pub mod archive;
pub mod github;
pub mod commands;

// By using this key in your builds you accept the terms and conditions laid down in
// https://support.curseforge.com/en/support/solutions/articles/9000207405-curse-forge-3rd-party-api-terms-and-conditions
// NOTE: CurseForge requires you to change this if you make any kind of derivative work.
// This key was issued specifically for Owl
const CURSEFORGE_API_KEY: &str = "$2a$10$iY/ujXomVXZgD5J7Rl3PAuhnTzVTIFsqehxEsq5EMM2pRfxlezEHS";

pub fn get_curseforge_base_url() -> &'static str {
    #[cfg(feature = "mock-api")]
    return "http://localhost:8080";
    #[cfg(not(feature = "mock-api"))]
    return "https://api.curseforge.com";
}

fn verify_sha1(file_path: &Path, expected_sha1: &str) -> std::result::Result<(), String> {
    let mut file = fs::File::open(file_path).map_err(|e| e.to_string())?;
    let mut hasher = Sha1::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
    let hash = hasher.finalize();
    let hash_hex = format!("{:x}", hash);
    if hash_hex.eq_ignore_ascii_case(expected_sha1) {
        Ok(())
    } else {
        Err(format!("SHA-1 mismatch: expected {}, got {}", expected_sha1, hash_hex))
    }
}

async fn check_for_updates(app: tauri::AppHandle) -> std::result::Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    use tauri::Emitter;

    if let Some(_update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? {
        let _ = app.emit("update-available", ());
    }
    Ok(())
}

fn main() {
    let allow_devtools = std::env::var("ALLOW_DEVTOOLS").unwrap_or_default() == "1";

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::game::launch_game,
            commands::patches::get_patches,
            commands::patches::toggle_patch,
            commands::addons::get_addons,
            commands::addons::parse_toc,
            commands::game::read_config,
            commands::game::set_config_value,
            commands::addons::toggle_addon,
            commands::addons::update_addon,
            commands::import::import_addon,
            commands::import::import_addon_files,
            commands::os::open_addon_folder,
            commands::os::open_folder,
            commands::os::pick_folder,
            commands::os::pick_files,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::settings::get_addon_profiles,
            commands::settings::save_addon_profile,
            commands::settings::apply_addon_profile,
            commands::settings::delete_addon_profile,
            commands::settings::rename_addon_profile,
            commands::patches::delete_patch,
            commands::addons::delete_addon,
            commands::game::detect_game_version,
            commands::window::minimize_window,
            commands::window::close_window,
            commands::window::set_window_size,
            commands::addons::check_addon_git_status,
            commands::addons::change_addon_branch,
            commands::addons::export_addon_list,
            commands::addons::validate_import_string,
            commands::addons::get_installed_addons_source_meta,
            commands::store::search_curseforge_addons,
            commands::store::get_curseforge_mod_files,
            commands::store::get_curseforge_mod_description,
            commands::store::download_and_extract_addon,
            commands::system::install_update,
            commands::system::check_update_details,
            commands::system::get_app_version,
            commands::import::confirm_install_bundled,
            commands::import::cleanup_temp_archive,
            commands::addons::check_addon_dependencies,
            commands::addons::check_orphaned_dependencies,
            commands::store::resolve_addon_dependency,
            commands::torrent::start_torrent_download,
            commands::torrent::cancel_torrent_download,
            commands::torrent::pause_torrent_downloads,
            commands::torrent::resume_torrent_downloads,
            commands::torrent::get_active_downloads,
            commands::torrent::pick_torrent_file,
            commands::torrent::validate_game_path
        ])
        .setup(move |app| {
            use tauri::Manager;
            let handle = app.handle().clone();
            
            let state = tauri::async_runtime::block_on(async {
                commands::torrent::TorrentState::new().await
            }).expect("failed to initialize torrent state");
            app.manage(state);
            app.manage(models::PendingInstallations(std::sync::Mutex::new(std::collections::HashMap::new())));

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
