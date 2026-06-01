
#[tauri::command]
pub fn minimize_window(window: tauri::Window) -> std::result::Result<String, String> {
    window.minimize().map_err(|e| e.to_string())?;
    Ok("OK".into())
}

#[tauri::command]
pub fn close_window(window: tauri::Window) -> std::result::Result<String, String> {
    window.close().map_err(|e| e.to_string())?;
    Ok("OK".into())
}

#[tauri::command]
pub fn set_window_size(window: tauri::Window, width: f64, height: f64) -> std::result::Result<String, String> {
    window.set_resizable(true).map_err(|e| e.to_string())?;
    window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height })).map_err(|e| e.to_string())?;
    window.set_resizable(false).map_err(|e| e.to_string())?;
    Ok("OK".into())
}

