use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDetails {
    pub version: String,
    pub body: Option<String>,
}

#[tauri::command]
pub async fn check_update_details(app: tauri::AppHandle) -> std::result::Result<Option<UpdateDetails>, String> {
    if let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? {
        Ok(Some(UpdateDetails {
            version: update.version.clone(),
            body: update.body.clone(),
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}


#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> std::result::Result<String, String> {
    if let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? {
        update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        app.restart();
        #[allow(unreachable_code)]
        Ok("Update installed successfully, restarting...".into())
    } else {
        Err("No update found".into())
    }
}

