use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> std::result::Result<String, String> {
    let confirmed = rfd::MessageDialog::new()
        .set_title("Update Available")
        .set_description("A new update is available. Do you want to download and install it now?")
        .set_buttons(rfd::MessageButtons::YesNo)
        .show();

    if confirmed == rfd::MessageDialogResult::Yes {
        if let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? {
            update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
            app.restart();
            #[allow(unreachable_code)]
            Ok("Update installed successfully, restarting...".into())
        } else {
            Err("No update found".into())
        }
    } else {
        Ok("Update canceled by user".into())
    }
}

