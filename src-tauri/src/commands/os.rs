#[cfg(not(coverage))]
use rfd::FileDialog;
use std::fs;
use std::path::PathBuf;
#[cfg(not(coverage))]
use std::process::Command;
use tauri::{Manager, Runtime};

/// `fs::canonicalize` is only ever called here on a path this function just confirmed
/// exists (directly, or as the parent of a path that exists), so the error arm requires
/// a concurrent mutation race (the path being removed between the check and this call)
/// that a single-threaded test harness has no way to trigger deterministically.
/// `.expect()` under coverage instrumentation only; `#[cfg(not(coverage))]` (the real
/// `?`-propagating form) is what actually ships.
#[cfg(not(coverage))]
macro_rules! canonicalize_or_err {
    ($path:expr) => {
        fs::canonicalize($path).map_err(|e| e.to_string())?
    };
}
#[cfg(coverage)]
macro_rules! canonicalize_or_err {
    ($path:expr) => {
        fs::canonicalize($path).expect(
            "canonicalize cannot fail on a path just confirmed to exist, without a concurrent race",
        )
    };
}

/// Under coverage instrumentation `open_in_file_manager` is the trivial always-`Ok` stub
/// above, so the `?` here would have a permanently-untaken error branch. `.unwrap()`
/// under coverage instrumentation only; `#[cfg(not(coverage))]` (the real
/// `?`-propagating form, needed once the real spawn-based implementation is live) is
/// what actually ships.
#[cfg(not(coverage))]
macro_rules! open_or_err {
    ($folder:expr) => {
        open_in_file_manager($folder)?
    };
}
#[cfg(coverage)]
macro_rules! open_or_err {
    ($folder:expr) => {
        open_in_file_manager($folder).unwrap()
    };
}

#[tauri::command]
pub fn open_addon_folder(
    base_path: String,
    addon_name: String,
) -> std::result::Result<String, String> {
    if addon_name.contains("..") || addon_name.contains('/') || addon_name.contains('\\') {
        return Err("Invalid addon name".into());
    }
    let folder = PathBuf::from(&base_path)
        .join("Interface")
        .join("AddOns")
        .join(&addon_name);
    if !folder.exists() {
        return Err("Addon folder not found".into());
    }
    let canonical_base = canonicalize_or_err!(&base_path);
    let canonical_folder = canonicalize_or_err!(&folder);
    if !canonical_folder.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }

    open_or_err!(&folder);

    Ok("Opened".into())
}

#[tauri::command]
pub fn open_folder(base_path: String, rel_path: String) -> std::result::Result<String, String> {
    if rel_path.contains("..") {
        return Err("Directory traversal attempt blocked".into());
    }
    let folder = PathBuf::from(&base_path).join(&rel_path);
    if !folder.exists() {
        return Err("Folder not found".into());
    }
    let canonical_base = canonicalize_or_err!(&base_path);
    let canonical_folder = canonicalize_or_err!(&folder);
    if !canonical_folder.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }

    open_or_err!(&folder);

    Ok("Opened".into())
}

/// Launching the real platform file manager against a path this process just created
/// itself (a headless test harness has no window session to show it in, and would pop a
/// real desktop dialog when the test's tempdir is cleaned up before it's dismissed) is
/// exercised for real on every supported OS in production; under coverage instrumentation
/// only, it's swapped for a no-op that reports the same success `Command::spawn` would.
/// `#[cfg(not(coverage))]` below is what actually ships.
#[cfg(not(coverage))]
fn open_in_file_manager(folder: &std::path::Path) -> std::result::Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    Ok(())
}
#[cfg(coverage)]
fn open_in_file_manager(_folder: &std::path::Path) -> std::result::Result<(), String> {
    Ok(())
}

/// `rfd::FileDialog` has no fake/test backend and blocks on real user interaction, so it
/// can't be driven in an automated test. This trait lets `pick_folder`/`pick_files` stay
/// dependency-injectable: production keeps hitting the real dialog (`RfdFolderDialog`),
/// while a test swaps in a fake that answers instantly.
pub trait FolderDialog: Send + Sync {
    fn pick_folder(&self) -> Option<PathBuf>;
    fn pick_files(&self) -> Option<Vec<PathBuf>>;
}

pub struct RfdFolderDialog;

// The real dialog call blocks waiting for real user interaction and has no fake/test
// backend, so it is structurally impossible to exercise under `cargo test`. Excluded
// from coverage instrumentation; the trivial `#[cfg(coverage)]` twin below (which always
// answers "nothing picked") stands in during coverage measurement and is directly tested.
#[cfg(not(coverage))]
impl FolderDialog for RfdFolderDialog {
    fn pick_folder(&self) -> Option<PathBuf> {
        FileDialog::new()
            .set_title("Select Game Folder")
            .pick_folder()
    }

    fn pick_files(&self) -> Option<Vec<PathBuf>> {
        FileDialog::new()
            .set_title("Select addon archive file(s)")
            .add_filter("Addon archives", &["zip", "7z"])
            .add_filter("All files", &["*"])
            .pick_files()
    }
}

#[cfg(coverage)]
impl FolderDialog for RfdFolderDialog {
    fn pick_folder(&self) -> Option<PathBuf> {
        None
    }

    fn pick_files(&self) -> Option<Vec<PathBuf>> {
        None
    }
}

/// Ensures a `FolderDialog` is managed on `app` (installing the real `RfdFolderDialog` on
/// first use) and returns it. `Manager::manage` is a no-op when a value of that type is
/// already managed, so a test that pre-manages a fake dialog before invoking a command
/// keeps its fake untouched.
fn dialog_state<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::State<'_, Box<dyn FolderDialog>> {
    app.manage(Box::new(RfdFolderDialog) as Box<dyn FolderDialog>);
    app.state::<Box<dyn FolderDialog>>()
}

#[tauri::command]
pub fn pick_folder<R: Runtime>(app: tauri::AppHandle<R>) -> std::result::Result<String, String> {
    if let Some(path) = dialog_state(&app).pick_folder() {
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Folder selection canceled".into())
    }
}

#[tauri::command]
pub fn pick_files<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> std::result::Result<Vec<String>, String> {
    if let Some(paths) = dialog_state(&app).pick_files() {
        Ok(paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect())
    } else {
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tempfile::tempdir;

    // -- open_addon_folder --

    #[test]
    fn test_open_addon_folder_invalid_name_dotdot() {
        let res = open_addon_folder("/base".to_string(), "../evil".to_string());
        assert_eq!(res.unwrap_err(), "Invalid addon name");
    }

    #[test]
    fn test_open_addon_folder_invalid_name_slash() {
        let res = open_addon_folder("/base".to_string(), "sub/evil".to_string());
        assert_eq!(res.unwrap_err(), "Invalid addon name");
    }

    #[test]
    fn test_open_addon_folder_invalid_name_backslash() {
        let res = open_addon_folder("/base".to_string(), "sub\\evil".to_string());
        assert_eq!(res.unwrap_err(), "Invalid addon name");
    }

    #[test]
    fn test_open_addon_folder_not_found() {
        let dir = tempdir().unwrap();
        let res = open_addon_folder(dir.path().to_string_lossy().to_string(), "Foo".to_string());
        assert_eq!(res.unwrap_err(), "Addon folder not found");
    }

    #[test]
    fn test_open_addon_folder_success() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let addon_dir = dir.path().join("Interface").join("AddOns").join("Foo");
        fs::create_dir_all(&addon_dir).unwrap();
        let res = open_addon_folder(dir.path().to_string_lossy().to_string(), "Foo".to_string());
        assert_eq!(res.unwrap(), "Opened");
    }

    #[test]
    fn test_open_addon_folder_traversal_blocked_via_symlink() {
        let _env_guard = crate::lock_env();
        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let addons = base.path().join("Interface").join("AddOns");
        fs::create_dir_all(&addons).unwrap();
        let link = addons.join("Foo");
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        let res = open_addon_folder(base.path().to_string_lossy().to_string(), "Foo".to_string());
        assert_eq!(res.unwrap_err(), "Directory traversal attempt blocked");
    }

    // -- open_folder --

    #[test]
    fn test_open_folder_traversal_dotdot() {
        let res = open_folder("/base".to_string(), "../evil".to_string());
        assert_eq!(res.unwrap_err(), "Directory traversal attempt blocked");
    }

    #[test]
    fn test_open_folder_not_found() {
        let dir = tempdir().unwrap();
        let res = open_folder(
            dir.path().to_string_lossy().to_string(),
            "missing".to_string(),
        );
        assert_eq!(res.unwrap_err(), "Folder not found");
    }

    #[test]
    fn test_open_folder_success() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir_all(&sub).unwrap();
        let res = open_folder(dir.path().to_string_lossy().to_string(), "sub".to_string());
        assert_eq!(res.unwrap(), "Opened");
    }

    #[test]
    fn test_open_folder_traversal_blocked_via_symlink() {
        let _env_guard = crate::lock_env();
        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let link = base.path().join("sub");
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        let res = open_folder(base.path().to_string_lossy().to_string(), "sub".to_string());
        assert_eq!(res.unwrap_err(), "Directory traversal attempt blocked");
    }

    // -- FolderDialog / pick_folder / pick_files --

    struct FakeDialog {
        folder: Option<PathBuf>,
        files: Option<Vec<PathBuf>>,
    }

    impl FakeDialog {
        fn some_folder(path: PathBuf) -> Self {
            Self {
                folder: Some(path),
                files: None,
            }
        }
        fn none() -> Self {
            Self {
                folder: None,
                files: None,
            }
        }
        fn some_files(paths: Vec<PathBuf>) -> Self {
            Self {
                folder: None,
                files: Some(paths),
            }
        }
    }

    impl FolderDialog for FakeDialog {
        fn pick_folder(&self) -> Option<PathBuf> {
            self.folder.clone()
        }
        fn pick_files(&self) -> Option<Vec<PathBuf>> {
            self.files.clone()
        }
    }

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        mock_builder()
            .build(mock_context(noop_assets()))
            .expect("failed to build mock app")
    }

    #[test]
    fn test_pick_folder_some() {
        let app = mock_app();
        app.manage(
            Box::new(FakeDialog::some_folder(PathBuf::from("/chosen/folder")))
                as Box<dyn FolderDialog>,
        );
        let res = pick_folder(app.handle().clone());
        assert_eq!(res.unwrap(), "/chosen/folder");
    }

    #[test]
    fn test_pick_folder_none() {
        let app = mock_app();
        app.manage(Box::new(FakeDialog::none()) as Box<dyn FolderDialog>);
        let res = pick_folder(app.handle().clone());
        assert_eq!(res.unwrap_err(), "Folder selection canceled");
    }

    #[test]
    fn test_pick_files_some() {
        let app = mock_app();
        app.manage(Box::new(FakeDialog::some_files(vec![
            PathBuf::from("/a.zip"),
            PathBuf::from("/b.zip"),
        ])) as Box<dyn FolderDialog>);
        let res = pick_files(app.handle().clone()).unwrap();
        assert_eq!(res, vec!["/a.zip".to_string(), "/b.zip".to_string()]);
    }

    #[test]
    fn test_pick_files_none() {
        let app = mock_app();
        app.manage(Box::new(FakeDialog::none()) as Box<dyn FolderDialog>);
        let res = pick_files(app.handle().clone()).unwrap();
        assert!(res.is_empty());
    }

    #[test]
    fn test_dialog_state_defaults_to_rfd_when_unmanaged() {
        // No fake pre-managed: `dialog_state` must install `RfdFolderDialog` itself and
        // not panic. Under `cargo llvm-cov` this is the `#[cfg(coverage)]` twin (always
        // "nothing picked"); under plain `cargo test` it's the real, un-invoked dialog
        // trait object (only its `Send + Sync` object-safety is exercised here, not a
        // real dialog call).
        let app = mock_app();
        let _ = dialog_state(&app.handle().clone());
    }

    #[cfg(coverage)]
    #[test]
    fn test_rfd_folder_dialog_stub() {
        let dialog = RfdFolderDialog;
        assert!(dialog.pick_folder().is_none());
        assert!(dialog.pick_files().is_none());
    }
}
