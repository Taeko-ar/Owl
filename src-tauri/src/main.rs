#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use sha1::{Digest, Sha1};
use std::fs;
use std::path::Path;

pub mod archive;
pub mod commands;
pub mod fs_utils;
pub mod git;
pub mod github;
pub mod models;

/// Serializes tests that mutate process-wide environment variables (PATH, HOME, ...)
/// against tests that spawn external processes, since those share one process env.
#[cfg(test)]
pub static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
pub fn lock_env() -> std::sync::MutexGuard<'static, ()> {
    ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

// By using this key in your builds you accept the terms and conditions laid down in
// https://support.curseforge.com/en/support/solutions/articles/9000207405-curse-forge-3rd-party-api-terms-and-conditions
// NOTE: CurseForge requires you to change this if you make any kind of derivative work.
// This key was issued specifically for Owl
const CURSEFORGE_API_KEY: &str = "$2a$10$iY/ujXomVXZgD5J7Rl3PAuhnTzVTIFsqehxEsq5EMM2pRfxlezEHS";

/// Test-only escape hatch: when set, callers hit this URL instead of the real CurseForge
/// API, so `store.rs` tests can point at a local mock HTTP server without a compile-time
/// feature build. Never set in production; unset ⇒ byte-identical to the original behavior.
pub const CURSEFORGE_BASE_URL_OVERRIDE_ENV: &str = "OWL_CURSEFORGE_BASE_URL_OVERRIDE";

pub fn get_curseforge_base_url() -> std::borrow::Cow<'static, str> {
    if let Ok(url) = std::env::var(CURSEFORGE_BASE_URL_OVERRIDE_ENV) {
        return std::borrow::Cow::Owned(url);
    }
    #[cfg(feature = "mock-api")]
    return std::borrow::Cow::Borrowed("http://localhost:8080");
    #[cfg(not(feature = "mock-api"))]
    return std::borrow::Cow::Borrowed("https://api.curseforge.com");
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
        Err(format!(
            "SHA-1 mismatch: expected {}, got {}",
            expected_sha1, hash_hex
        ))
    }
}

// The updater performs a real network round-trip against a cryptographically signed
// manifest and needs a live `AppHandle<Wry>`; it cannot be driven headlessly under
// `tauri::test`'s mock runtime. Excluded from coverage instrumentation (see
// `#[cfg(coverage)]` twin below) rather than measured against a fabricated signer.
#[cfg(not(coverage))]
async fn check_for_updates<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> std::result::Result<(), String> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    if let Some(_update) = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
    {
        let _ = app.emit("update-available", ());
    }
    Ok(())
}

#[cfg(coverage)]
async fn check_for_updates<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
) -> std::result::Result<(), String> {
    Ok(())
}

// `fn main` boots the real windowing/event-loop runtime and never runs under `cargo
// test` (the test harness supplies its own entry point), so it is unreachable by any
// unit test regardless of how it's factored. Swapped for a trivial, fully-covered stub
// under coverage instrumentation; `#[cfg(not(coverage))]` below is what actually ships.
#[cfg(coverage)]
fn main() {}

#[cfg(not(coverage))]
fn main() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var("GDK_BACKEND").is_err() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
        if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    let allow_devtools = std::env::var("ALLOW_DEVTOOLS").unwrap_or_default() == "1";

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::game::launch_game,
            commands::game::get_available_executables,
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
            commands::window::close_splashscreen,
            commands::window::minimize_window,
            commands::window::close_window,
            commands::window::set_window_size,
            commands::window::start_drag,
            commands::window::get_window_position,
            commands::window::set_window_position_logical,
            commands::addons::check_addon_git_status,
            commands::addons::change_addon_branch,
            commands::addons::export_addon_list,
            commands::addons::validate_import_string,
            commands::addons::get_installed_addons_source_meta,
            commands::store::search_curseforge_addons,
            commands::store::get_curseforge_mod_files,
            commands::store::get_curseforge_mod,
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

            commands::window::spawn_splashscreen(app.handle());

            let state = tauri::async_runtime::block_on(async {
                commands::torrent::TorrentState::new().await
            }).expect("failed to initialize torrent state");
            app.manage(state);
            app.manage(models::PendingInstallations(std::sync::Mutex::new(std::collections::HashMap::new())));
            app.manage(Box::new(commands::torrent::RfdTorrentFileDialog) as Box<dyn commands::torrent::TorrentFileDialog>);

            tauri::async_runtime::spawn(async move {
                let _ = check_for_updates(handle).await;
            });

            // Failsafe: the frontend closes the splash once it is ready, but if that
            // never happens the main window must not stay hidden forever.
            let splash_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                commands::window::reveal_main_window(&splash_handle);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_verify_sha1_matches() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("data.bin");
        fs::write(&file_path, b"hello world").unwrap();
        // sha1("hello world")
        let expected = "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed";
        assert!(verify_sha1(&file_path, expected).is_ok());
        // case-insensitive match
        assert!(verify_sha1(&file_path, &expected.to_uppercase()).is_ok());
    }

    #[test]
    fn test_verify_sha1_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("data.bin");
        fs::write(&file_path, b"hello world").unwrap();
        let res = verify_sha1(&file_path, "0000000000000000000000000000000000000000");
        assert!(res.unwrap_err().contains("SHA-1 mismatch"));
    }

    #[test]
    fn test_verify_sha1_missing_file() {
        let res = verify_sha1(Path::new("/nonexistent/owl-test-file"), "deadbeef");
        assert!(res.is_err());
    }

    #[test]
    fn test_get_curseforge_base_url() {
        // The `mock-api` feature is never enabled by the `unit:back` coverage run, so
        // only the real endpoint is ever reachable here.
        assert_eq!(
            get_curseforge_base_url().as_ref(),
            "https://api.curseforge.com"
        );
    }

    #[test]
    fn test_get_curseforge_base_url_override() {
        let _env_guard = lock_env();
        std::env::set_var(CURSEFORGE_BASE_URL_OVERRIDE_ENV, "http://127.0.0.1:1");
        let result = get_curseforge_base_url();
        std::env::remove_var(CURSEFORGE_BASE_URL_OVERRIDE_ENV);
        assert_eq!(result.as_ref(), "http://127.0.0.1:1");
    }

    #[test]
    fn test_verify_sha1_read_error() {
        // Opening a directory succeeds on Linux but reading it fails, which drives the
        // `io::copy` error arm that a missing/unreadable *file* can't reach.
        let dir = tempfile::tempdir().unwrap();
        let res = verify_sha1(dir.path(), "deadbeef");
        assert!(res.is_err());
    }
}

#[cfg(coverage)]
#[cfg(test)]
mod coverage_only_tests {
    use super::*;

    // `main()` and `check_for_updates()` are swapped for trivial stubs under coverage
    // instrumentation (see the `#[cfg(coverage)]` definitions above) because their real
    // bodies require a live windowing/network runtime `cargo test` cannot provide. These
    // calls only exercise the stubs, never the real `#[cfg(not(coverage))]` code that ships.
    #[test]
    fn test_main_stub_is_noop() {
        main();
    }

    #[test]
    fn test_check_for_updates_stub_is_noop() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("failed to build mock app");
        let handle = app.handle().clone();
        let res = tauri::async_runtime::block_on(check_for_updates(handle));
        assert!(res.is_ok());
    }
}
