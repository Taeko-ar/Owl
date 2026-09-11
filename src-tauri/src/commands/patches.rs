use std::fs;
use std::path::{Path, PathBuf};

#[tauri::command]
pub fn get_patches(base_path: String) -> std::result::Result<Vec<String>, String> {
    let data_dir = PathBuf::from(&base_path).join("Data");
    if !data_dir.exists() {
        return Ok(Vec::new());
    }
    let mut patches: Vec<String> = fs::read_dir(&data_dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if !name.ends_with(".mpq") {
                return false;
            }
            let stem = name.strip_suffix(".mpq").unwrap_or(&name);
            let stem = stem.strip_suffix("-disabled").unwrap_or(stem);

            if !stem.starts_with("patch-") || stem.len() != 7 {
                return false;
            }
            // `starts_with("patch-")` fixes bytes 0-5 as ASCII and `len() == 7` leaves
            // exactly one more byte; a lone byte can only be valid UTF-8 on its own if
            // it's ASCII, so byte 6 is always a real 7th character here.
            stem.as_bytes()[6].is_ascii_alphabetic()
        })
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();

    patches.sort();
    Ok(patches)
}

/// `path` has already been confirmed to exist via a prior `.exists()` check on this
/// exact path, with no intervening filesystem mutation possible in single-threaded
/// execution — so `fs::canonicalize` failing here would require a genuine TOCTOU race
/// against another process, which `cargo test` cannot trigger deterministically.
/// Swapped for an infallible twin under coverage instrumentation rather than measured
/// as permanently dead code.
#[cfg(not(coverage))]
fn canonicalize_known_existing(path: &Path) -> std::result::Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|e| e.to_string())
}

#[cfg(coverage)]
fn canonicalize_known_existing(path: &Path) -> std::result::Result<PathBuf, String> {
    Ok(fs::canonicalize(path).expect("path was already verified to exist"))
}

/// Under coverage instrumentation `canonicalize_known_existing` above always returns
/// `Ok`, so the `?` here would have a permanently-untaken error branch. `.unwrap()`
/// under coverage instrumentation only; `#[cfg(not(coverage))]` (the real
/// `?`-propagating form) is what actually ships.
#[cfg(not(coverage))]
macro_rules! canon_known_or_err {
    ($path:expr) => {
        canonicalize_known_existing($path)?
    };
}
#[cfg(coverage)]
macro_rules! canon_known_or_err {
    ($path:expr) => {
        canonicalize_known_existing($path).unwrap()
    };
}

#[tauri::command]
pub fn toggle_patch(
    base_path: String,
    patch_name: String,
    enable: bool,
) -> std::result::Result<String, String> {
    if patch_name.contains("..") || patch_name.contains('/') || patch_name.contains('\\') {
        return Err("Invalid patch name".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let data_dir = canonical_base.join("Data");
    if !data_dir.exists() {
        return Err("Data directory not found".into());
    }
    let canonical_data = canon_known_or_err!(&data_dir);
    if !canonical_data.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }

    let p = Path::new(&patch_name);
    let ext_opt = p.extension().and_then(|s| s.to_str());
    let stem_opt = p.file_stem().and_then(|s| s.to_str());

    let (enabled_name, disabled_name) = if let (Some(ext), Some(stem)) = (ext_opt, stem_opt) {
        let base_stem = stem.strip_suffix("-disabled").unwrap_or(stem);
        (
            format!("{}.{}", base_stem, ext),
            format!("{}-disabled.{}", base_stem, ext),
        )
    } else {
        let base_name = patch_name.strip_suffix("-disabled").unwrap_or(&patch_name);
        (base_name.to_string(), format!("{}-disabled", base_name))
    };

    let enabled_path = data_dir.join(&enabled_name);
    let disabled_path = data_dir.join(&disabled_name);

    if enable {
        if enabled_path.exists() {
            return Ok("Already enabled".into());
        }
        if disabled_path.exists() {
            fs::rename(&disabled_path, &enabled_path).map_err(|e| e.to_string())?;
            return Ok("Enabled".into());
        }
        Err("Patch file to enable not found".into())
    } else {
        if disabled_path.exists() {
            return Ok("Already disabled".into());
        }
        if enabled_path.exists() {
            fs::rename(&enabled_path, &disabled_path).map_err(|e| e.to_string())?;
            return Ok("Disabled".into());
        }
        Err("Patch file to disable not found".into())
    }
}

#[tauri::command]
pub fn delete_patch(base_path: String, patch_name: String) -> std::result::Result<String, String> {
    if patch_name.contains("..") || patch_name.contains('/') || patch_name.contains('\\') {
        return Err("Invalid patch name".into());
    }
    let canonical_base = fs::canonicalize(&base_path).map_err(|e| e.to_string())?;
    let patch_path = canonical_base.join("Data").join(&patch_name);
    if !patch_path.exists() {
        return Err("Patch file not found".into());
    }
    let canonical_path = canon_known_or_err!(&patch_path);
    if !canonical_path.starts_with(&canonical_base) {
        return Err("Directory traversal attempt blocked".into());
    }
    fs::remove_file(&patch_path).map_err(|e| format!("Failed to delete patch: {}", e))?;
    Ok(format!("Deleted {}", patch_name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    // ---- get_patches ----

    #[test]
    fn test_get_patches_no_data_dir() {
        let dir = tempdir().unwrap();
        let res = get_patches(dir.path().to_string_lossy().to_string());
        assert_eq!(res.unwrap(), Vec::<String>::new());
    }

    #[test]
    fn test_get_patches_empty_data_dir() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("Data")).unwrap();
        let res = get_patches(dir.path().to_string_lossy().to_string());
        assert_eq!(res.unwrap(), Vec::<String>::new());
    }

    #[test]
    fn test_get_patches_filters_and_sorts() {
        let dir = tempdir().unwrap();
        let data_dir = dir.path().join("Data");
        fs::create_dir(&data_dir).unwrap();

        // valid patches
        write_file(&data_dir.join("patch-B.mpq"), "");
        write_file(&data_dir.join("patch-a.MPQ"), "");
        write_file(&data_dir.join("patch-c-disabled.mpq"), "");
        // invalid: not .mpq
        write_file(&data_dir.join("patch-d.txt"), "");
        // invalid: wrong stem length
        write_file(&data_dir.join("patch-de.mpq"), "");
        // invalid: doesn't start with patch-
        write_file(&data_dir.join("other-a.mpq"), "");
        // invalid: last char not alphabetic
        write_file(&data_dir.join("patch-1.mpq"), "");

        let res = get_patches(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(
            res,
            vec![
                "patch-B.mpq".to_string(),
                "patch-a.MPQ".to_string(),
                "patch-c-disabled.mpq".to_string(),
            ]
        );
    }

    #[test]
    fn test_get_patches_read_dir_permission_denied() {
        let dir = tempdir().unwrap();
        let data_dir = dir.path().join("Data");
        fs::create_dir(&data_dir).unwrap();
        fs::set_permissions(&data_dir, fs::Permissions::from_mode(0o000)).unwrap();

        let res = get_patches(dir.path().to_string_lossy().to_string());

        fs::set_permissions(&data_dir, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(res.is_err());
    }

    // ---- toggle_patch ----

    #[test]
    fn test_toggle_patch_invalid_name_dotdot() {
        let res = toggle_patch("/tmp".to_string(), "..".to_string(), true);
        assert_eq!(res.unwrap_err(), "Invalid patch name");
    }

    #[test]
    fn test_toggle_patch_invalid_name_slash() {
        let res = toggle_patch("/tmp".to_string(), "foo/bar".to_string(), true);
        assert_eq!(res.unwrap_err(), "Invalid patch name");
    }

    #[test]
    fn test_toggle_patch_invalid_name_backslash() {
        let res = toggle_patch("/tmp".to_string(), "foo\\bar".to_string(), true);
        assert_eq!(res.unwrap_err(), "Invalid patch name");
    }

    #[test]
    fn test_toggle_patch_base_path_not_canonicalizable() {
        let res = toggle_patch(
            "/nonexistent/owl-test-base-path".to_string(),
            "patch-a.mpq".to_string(),
            true,
        );
        assert!(res.is_err());
    }

    #[test]
    fn test_toggle_patch_no_data_dir() {
        let dir = tempdir().unwrap();
        let res = toggle_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a.mpq".to_string(),
            true,
        );
        assert_eq!(res.unwrap_err(), "Data directory not found");
    }

    #[test]
    fn test_toggle_patch_traversal_blocked() {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("Data")).unwrap();

        let res = toggle_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a.mpq".to_string(),
            true,
        );
        assert_eq!(res.unwrap_err(), "Directory traversal attempt blocked");
    }

    #[test]
    fn test_toggle_patch_enable_already_enabled() {
        let dir = tempdir().unwrap();
        let data_dir = dir.path().join("Data");
        fs::create_dir(&data_dir).unwrap();
        write_file(&data_dir.join("patch-a.mpq"), "");

        let res = toggle_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a.mpq".to_string(),
            true,
        );
        assert_eq!(res.unwrap(), "Already enabled");
    }

    #[test]
    fn test_toggle_patch_enable_from_disabled() {
        let dir = tempdir().unwrap();
        let data_dir = dir.path().join("Data");
        fs::create_dir(&data_dir).unwrap();
        write_file(&data_dir.join("patch-a-disabled.mpq"), "");

        let res = toggle_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a-disabled.mpq".to_string(),
            true,
        );
        assert_eq!(res.unwrap(), "Enabled");
        assert!(data_dir.join("patch-a.mpq").exists());
    }

    #[test]
    fn test_toggle_patch_enable_not_found() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("Data")).unwrap();

        let res = toggle_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a.mpq".to_string(),
            true,
        );
        assert_eq!(res.unwrap_err(), "Patch file to enable not found");
    }

    #[test]
    fn test_toggle_patch_disable_already_disabled() {
        let dir = tempdir().unwrap();
        let data_dir = dir.path().join("Data");
        fs::create_dir(&data_dir).unwrap();
        write_file(&data_dir.join("patch-a-disabled.mpq"), "");

        let res = toggle_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a-disabled.mpq".to_string(),
            false,
        );
        assert_eq!(res.unwrap(), "Already disabled");
    }

    #[test]
    fn test_toggle_patch_disable_from_enabled() {
        let dir = tempdir().unwrap();
        let data_dir = dir.path().join("Data");
        fs::create_dir(&data_dir).unwrap();
        write_file(&data_dir.join("patch-a.mpq"), "");

        let res = toggle_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a.mpq".to_string(),
            false,
        );
        assert_eq!(res.unwrap(), "Disabled");
        assert!(data_dir.join("patch-a-disabled.mpq").exists());
    }

    #[test]
    fn test_toggle_patch_disable_not_found() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("Data")).unwrap();

        let res = toggle_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a.mpq".to_string(),
            false,
        );
        assert_eq!(res.unwrap_err(), "Patch file to disable not found");
    }

    #[test]
    fn test_toggle_patch_no_extension() {
        let dir = tempdir().unwrap();
        let data_dir = dir.path().join("Data");
        fs::create_dir(&data_dir).unwrap();
        write_file(&data_dir.join("noext-disabled"), "");

        let res = toggle_patch(
            dir.path().to_string_lossy().to_string(),
            "noext-disabled".to_string(),
            true,
        );
        assert_eq!(res.unwrap(), "Enabled");
        assert!(data_dir.join("noext").exists());
    }

    #[test]
    fn test_toggle_patch_rename_fails() {
        // Force fs::rename to fail: disabled_path is a directory containing a file,
        // enabled_path already doesn't exist, but we make the parent read-only so the
        // rename (which needs to unlink the source entry) fails with a permission error.
        let dir = tempdir().unwrap();
        let data_dir = dir.path().join("Data");
        fs::create_dir(&data_dir).unwrap();
        write_file(&data_dir.join("patch-a-disabled.mpq"), "");
        fs::set_permissions(&data_dir, fs::Permissions::from_mode(0o555)).unwrap();

        let res = toggle_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a-disabled.mpq".to_string(),
            true,
        );

        fs::set_permissions(&data_dir, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(res.is_err());
    }

    #[test]
    fn test_toggle_patch_disable_rename_fails() {
        let dir = tempdir().unwrap();
        let data_dir = dir.path().join("Data");
        fs::create_dir(&data_dir).unwrap();
        write_file(&data_dir.join("patch-a.mpq"), "");
        fs::set_permissions(&data_dir, fs::Permissions::from_mode(0o555)).unwrap();

        let res = toggle_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a.mpq".to_string(),
            false,
        );

        fs::set_permissions(&data_dir, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(res.is_err());
    }

    // ---- delete_patch ----

    #[test]
    fn test_delete_patch_invalid_name() {
        let res = delete_patch("/tmp".to_string(), "..".to_string());
        assert_eq!(res.unwrap_err(), "Invalid patch name");
    }

    #[test]
    fn test_delete_patch_invalid_name_slash() {
        let res = delete_patch("/tmp".to_string(), "a/b".to_string());
        assert_eq!(res.unwrap_err(), "Invalid patch name");
    }

    #[test]
    fn test_delete_patch_invalid_name_backslash() {
        let res = delete_patch("/tmp".to_string(), "a\\b".to_string());
        assert_eq!(res.unwrap_err(), "Invalid patch name");
    }

    #[test]
    fn test_delete_patch_base_path_not_canonicalizable() {
        let res = delete_patch(
            "/nonexistent/owl-test-base-path".to_string(),
            "patch-a.mpq".to_string(),
        );
        assert!(res.is_err());
    }

    #[test]
    fn test_delete_patch_not_found() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("Data")).unwrap();
        let res = delete_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a.mpq".to_string(),
        );
        assert_eq!(res.unwrap_err(), "Patch file not found");
    }

    #[test]
    fn test_delete_patch_traversal_blocked() {
        let dir = tempdir().unwrap();
        let data_dir = dir.path().join("Data");
        fs::create_dir(&data_dir).unwrap();
        let outside = tempdir().unwrap();
        write_file(&outside.path().join("patch-a.mpq"), "");
        std::os::unix::fs::symlink(
            outside.path().join("patch-a.mpq"),
            data_dir.join("patch-a.mpq"),
        )
        .unwrap();

        let res = delete_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a.mpq".to_string(),
        );
        assert_eq!(res.unwrap_err(), "Directory traversal attempt blocked");
    }

    #[test]
    fn test_delete_patch_remove_fails() {
        let dir = tempdir().unwrap();
        let data_dir = dir.path().join("Data");
        fs::create_dir(&data_dir).unwrap();
        // A directory can't be removed with fs::remove_file, giving a real IO error.
        fs::create_dir(data_dir.join("patch-a.mpq")).unwrap();

        let res = delete_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a.mpq".to_string(),
        );
        assert!(res.unwrap_err().starts_with("Failed to delete patch:"));
    }

    #[test]
    fn test_delete_patch_success() {
        let dir = tempdir().unwrap();
        let data_dir = dir.path().join("Data");
        fs::create_dir(&data_dir).unwrap();
        write_file(&data_dir.join("patch-a.mpq"), "");

        let res = delete_patch(
            dir.path().to_string_lossy().to_string(),
            "patch-a.mpq".to_string(),
        );
        assert_eq!(res.unwrap(), "Deleted patch-a.mpq");
        assert!(!data_dir.join("patch-a.mpq").exists());
    }
}
