
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

#[tauri::command]
pub fn start_drag(window: tauri::Window) -> std::result::Result<String, String> {
    window.start_dragging().map_err(|e| e.to_string())?;
    Ok("OK".into())
}

#[tauri::command]
pub fn get_window_position(window: tauri::Window) -> std::result::Result<(f64, f64), String> {
    let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let logical_pos = pos.to_logical::<f64>(scale_factor);
    Ok((logical_pos.x, logical_pos.y))
}

#[tauri::command]
pub fn set_window_position_logical(window: tauri::Window, x: f64, y: f64) -> std::result::Result<(), String> {
    window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y })).map_err(|e| e.to_string())?;
    Ok(())
}


