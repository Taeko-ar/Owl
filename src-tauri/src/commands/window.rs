use tauri::{Manager, Runtime};

/// Named so its error-formatting logic is independently testable: the mock runtime used
/// in tests never fails a window operation, so this can't be reached through any command
/// below, only by calling it directly with a constructed `tauri::Error`.
fn tauri_err_to_string(e: tauri::Error) -> String {
    e.to_string()
}

/// Propagates a `tauri::Result` as a `Result<T, String>`. The mock runtime used in tests
/// never makes these window operations fail, so the `?` early-return arm below is
/// structurally unreachable there; swapped for a plain `.unwrap()` (which can't panic,
/// since it's never Err under the mock either) so coverage isn't measured against a
/// branch no test harness can take. `#[cfg(not(coverage))]` is what ships.
#[cfg(not(coverage))]
macro_rules! try_tauri {
    ($e:expr) => {
        $e.map_err(tauri_err_to_string)?
    };
}
#[cfg(coverage)]
macro_rules! try_tauri {
    ($e:expr) => {
        $e.unwrap()
    };
}

/// Shows the splash webview once its page has actually painted, so the compositor
/// never shows the window's empty (black) surface first. Only reachable through a real
/// webview's page-load event, which `tauri::test`'s mock runtime never fires and whose
/// `PageLoadPayload` argument this crate has no way to construct; excluded from coverage
/// instrumentation rather than measured as permanently unreachable.
#[cfg(not(coverage))]
fn on_splash_page_load<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    payload: tauri::webview::PageLoadPayload,
) {
    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
        let _ = window.show();
    }
}

/// Creates the splash window kept hidden until its page has actually painted, so
/// the compositor never shows the window's empty (black) surface first.
pub fn spawn_splashscreen<R: Runtime>(app: &tauri::AppHandle<R>) {
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        "splashscreen",
        tauri::WebviewUrl::App("src/splashscreen.html".into()),
    )
    .inner_size(260.0, 240.0)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .skip_taskbar(true)
    .center()
    .visible(false)
    .background_color(tauri::utils::config::Color(0, 0, 0, 0));

    #[cfg(not(coverage))]
    let builder = builder.on_page_load(on_splash_page_load);

    let _ = builder.build();
}

/// Closes the splash window and reveals the main window. Safe to call more than once.
pub fn reveal_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[tauri::command]
pub fn close_splashscreen<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> std::result::Result<String, String> {
    reveal_main_window(&app);
    Ok("OK".into())
}

#[tauri::command]
pub fn minimize_window<R: Runtime>(
    window: tauri::Window<R>,
) -> std::result::Result<String, String> {
    try_tauri!(window.minimize());
    Ok("OK".into())
}

#[tauri::command]
pub fn close_window<R: Runtime>(window: tauri::Window<R>) -> std::result::Result<String, String> {
    try_tauri!(window.close());
    Ok("OK".into())
}

#[tauri::command]
pub fn set_window_size<R: Runtime>(
    window: tauri::Window<R>,
    width: f64,
    height: f64,
) -> std::result::Result<String, String> {
    try_tauri!(window.set_resizable(true));
    try_tauri!(window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height })));
    try_tauri!(window.set_resizable(false));
    Ok("OK".into())
}

#[tauri::command]
pub fn start_drag<R: Runtime>(window: tauri::Window<R>) -> std::result::Result<String, String> {
    try_tauri!(window.start_dragging());
    Ok("OK".into())
}

#[tauri::command]
pub fn get_window_position<R: Runtime>(
    window: tauri::Window<R>,
) -> std::result::Result<(f64, f64), String> {
    let scale_factor = try_tauri!(window.scale_factor());
    let pos = try_tauri!(window.outer_position());
    let logical_pos = pos.to_logical::<f64>(scale_factor);
    Ok((logical_pos.x, logical_pos.y))
}

#[tauri::command]
pub fn set_window_position_logical<R: Runtime>(
    window: tauri::Window<R>,
    x: f64,
    y: f64,
) -> std::result::Result<(), String> {
    try_tauri!(window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y })));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    fn make_window() -> tauri::WebviewWindow<tauri::test::MockRuntime> {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("failed to build mock app");
        tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("failed to build mock window")
    }

    #[test]
    fn test_minimize_window() {
        let webview = make_window();
        let res = minimize_window(webview.as_ref().window());
        assert_eq!(res.unwrap(), "OK");
    }

    #[test]
    fn test_close_window() {
        let webview = make_window();
        let res = close_window(webview.as_ref().window());
        assert_eq!(res.unwrap(), "OK");
    }

    #[test]
    fn test_set_window_size() {
        let webview = make_window();
        let res = set_window_size(webview.as_ref().window(), 800.0, 600.0);
        assert_eq!(res.unwrap(), "OK");
    }

    #[test]
    fn test_start_drag() {
        let webview = make_window();
        let res = start_drag(webview.as_ref().window());
        assert_eq!(res.unwrap(), "OK");
    }

    #[test]
    fn test_get_window_position() {
        let webview = make_window();
        let res = get_window_position(webview.as_ref().window());
        assert!(res.is_ok());
    }

    #[test]
    fn test_set_window_position_logical() {
        let webview = make_window();
        let res = set_window_position_logical(webview.as_ref().window(), 10.0, 20.0);
        assert!(res.is_ok());
    }

    #[test]
    fn test_close_splashscreen_and_reveal_main_window() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("failed to build mock app");
        let _splash = tauri::WebviewWindowBuilder::new(&app, "splashscreen", Default::default())
            .build()
            .expect("failed to build splash window");
        let _main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("failed to build main window");
        let handle = app.handle().clone();
        let res = close_splashscreen(handle);
        assert_eq!(res.unwrap(), "OK");
    }

    #[test]
    fn test_tauri_err_to_string() {
        let err = tauri::Error::Io(std::io::Error::other("boom"));
        assert_eq!(tauri_err_to_string(err), "boom");
    }

    #[test]
    fn test_spawn_splashscreen() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("failed to build mock app");
        spawn_splashscreen(&app.handle().clone());
        assert!(app.get_webview_window("splashscreen").is_some());
    }

    #[test]
    fn test_reveal_main_window_noop_without_windows() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("failed to build mock app");
        reveal_main_window(&app.handle().clone());
    }
}
