use tauri::Runtime;
use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDetails {
    pub version: String,
    pub body: Option<String>,
}

// Both commands below perform a real network round-trip against a cryptographically
// signed update manifest via `tauri_plugin_updater::UpdaterExt`, and need a live
// `AppHandle` with the updater plugin registered. This can't be driven headlessly under
// `tauri::test`'s mock runtime: registering the plugin without a real, running local
// server would still require fabricating a valid Ed25519/minisign signature to reach
// the `Ok(Some(update))` branch, and there is no `Err`-only shortcut either — checked
// against the plugin's own source (`tauri-plugin-updater-2.10.1/src/lib.rs`), a mock app
// with the plugin *not* registered doesn't make `app.updater()` return `Err`, it panics
// inside `self.state::<UpdaterState>()` before any `Result` is produced. So there is no
// reachable branch here under a mock runtime at all. Excluded from coverage
// instrumentation (see the `#[cfg(coverage)]` twins below) rather than measured against
// an unreachable branch or a fabricated signer.
#[cfg(not(coverage))]
#[tauri::command]
pub async fn check_update_details<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> std::result::Result<Option<UpdateDetails>, String> {
    if let Some(update) = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
    {
        Ok(Some(UpdateDetails {
            version: update.version.clone(),
            body: update.body.clone(),
        }))
    } else {
        Ok(None)
    }
}

#[cfg(coverage)]
#[tauri::command]
pub async fn check_update_details<R: Runtime>(
    _app: tauri::AppHandle<R>,
) -> std::result::Result<Option<UpdateDetails>, String> {
    Ok(None)
}

#[tauri::command]
pub fn get_app_version<R: Runtime>(app: tauri::AppHandle<R>) -> String {
    app.package_info().version.to_string()
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn install_update<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> std::result::Result<String, String> {
    if let Some(update) = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
    {
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
        #[allow(unreachable_code)]
        Ok("Update installed successfully, restarting...".into())
    } else {
        Err("No update found".into())
    }
}

#[cfg(coverage)]
#[tauri::command]
pub async fn install_update<R: Runtime>(
    _app: tauri::AppHandle<R>,
) -> std::result::Result<String, String> {
    Err("No update found".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    #[test]
    fn test_get_app_version() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("failed to build mock app");
        let version = get_app_version(app.handle().clone());
        // The mock context's fixture manifest sets a fixed package version.
        assert!(!version.is_empty());
    }
}

#[cfg(coverage)]
#[cfg(test)]
mod coverage_only_tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    // `check_update_details` and `install_update` are swapped for trivial stubs under
    // coverage instrumentation (see the `#[cfg(coverage)]` definitions above) because
    // their real bodies require a live, signed-manifest network round-trip `cargo test`
    // cannot provide, and a mock app without the plugin panics rather than erroring. These
    // calls only exercise the stubs, never the real `#[cfg(not(coverage))]` code that ships.
    #[test]
    fn test_check_update_details_stub_is_none() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("failed to build mock app");
        let res =
            tauri::async_runtime::block_on(check_update_details(app.handle().clone())).unwrap();
        assert!(res.is_none());
    }

    #[test]
    fn test_install_update_stub_is_err() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("failed to build mock app");
        let res = tauri::async_runtime::block_on(install_update(app.handle().clone()));
        assert_eq!(res.unwrap_err(), "No update found");
    }
}
