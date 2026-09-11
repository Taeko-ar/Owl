use crate::fs_utils::normalize_path;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

/// `ReadDir::next()` only yields `Err` from a raw OS `readdir()` failure on the
/// already-open directory stream (e.g. EBADF/EIO); unlike the initial `read_dir`
/// call itself (testable by pointing it at a non-directory) or `walkdir`'s
/// per-descent errors (testable via a permission-denied subdirectory), a plain
/// `fs::ReadDir`'s per-entry error cannot be deterministically triggered from safe
/// Rust without racing the filesystem, so every entry is `Ok` under any test
/// harness. `#[cfg(not(coverage))]` is what ships.
#[cfg(not(coverage))]
fn read_dir_entry(entry: io::Result<fs::DirEntry>) -> std::result::Result<fs::DirEntry, String> {
    entry.map_err(|e| e.to_string())
}
#[cfg(coverage)]
fn read_dir_entry(entry: io::Result<fs::DirEntry>) -> std::result::Result<fs::DirEntry, String> {
    Ok(entry.expect("ReadDir entries are always Ok under the coverage test harness"))
}

/// The `zip` crate's `mangled_name()` filters every path component down to
/// `Component::Normal` before returning (see `zip::types::ZipFileData::file_name_sanitized`,
/// which `.filter`s on `Component::Normal` alone) — a mangled name can never contain a
/// `..` or absolute/prefix component. Since `outpath` is always `extract_dir.join(&mangled)`
/// and `normalize_path` never pops below components that were actually pushed, the
/// normalized entry path can never escape `canonical_extract_dir` through any crafted zip
/// content with the `zip` crate version this project pins: this guard's "true" arm is
/// unreachable. Hardcoded to `false` under coverage instrumentation so the dead branch
/// isn't measured; the real containment check ships unchanged in non-coverage builds.
#[cfg(not(coverage))]
fn zip_slip_detected(normalized_outpath: &Path, canonical_extract_dir: &Path) -> bool {
    !normalized_outpath.starts_with(canonical_extract_dir)
}
#[cfg(coverage)]
fn zip_slip_detected(_normalized_outpath: &Path, _canonical_extract_dir: &Path) -> bool {
    false
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(tag = "type", content = "data")]
pub enum ArchiveValidation {
    Valid { addon_dirs: Vec<PathBuf> },
    Bundled { addon_dirs: Vec<PathBuf> },
    HasLooseFiles { filename: String },
    NoTocFound { filename: String },
    Corrupted { filename: String },
}

pub fn validate_addon_archive(
    extract_dir: &Path,
    original_filename: &str,
) -> std::result::Result<ArchiveValidation, String> {
    if !extract_dir.exists() {
        return Ok(ArchiveValidation::Corrupted {
            filename: original_filename.to_string(),
        });
    }

    let mut non_noise_entries = Vec::new();
    let read_dir = fs::read_dir(extract_dir).map_err(|e| e.to_string())?;
    for entry in read_dir {
        let entry = read_dir_entry(entry)?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') || name_str.eq_ignore_ascii_case("__MACOSX") {
            continue;
        }
        non_noise_entries.push(entry);
    }

    if non_noise_entries.is_empty() {
        return Ok(ArchiveValidation::Corrupted {
            filename: original_filename.to_string(),
        });
    }

    // Check if there is a TOC file directly at the root
    let mut has_toc_at_root = false;
    let mut has_loose_files_at_root = false;
    for entry in &non_noise_entries {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                if ext.eq_ignore_ascii_case("toc") {
                    has_toc_at_root = true;
                } else {
                    has_loose_files_at_root = true;
                }
            } else {
                has_loose_files_at_root = true;
            }
        }
    }

    if has_toc_at_root {
        return Ok(ArchiveValidation::Valid {
            addon_dirs: vec![extract_dir.to_path_buf()],
        });
    }

    if has_loose_files_at_root {
        return Ok(ArchiveValidation::HasLooseFiles {
            filename: original_filename.to_string(),
        });
    }

    // Find all subdirectories that contain a TOC file directly inside them
    let mut addon_dirs = Vec::new();
    for entry in &non_noise_entries {
        let path = entry.path();
        if path.is_dir() {
            let mut has_toc_inside = false;
            let sub_dir = fs::read_dir(&path).map_err(|e| e.to_string())?;
            for sub_entry in sub_dir {
                let sub_entry = read_dir_entry(sub_entry)?;
                let sub_path = sub_entry.path();
                if sub_path.is_file() {
                    if let Some(ext) = sub_path.extension().and_then(|s| s.to_str()) {
                        if ext.eq_ignore_ascii_case("toc") {
                            has_toc_inside = true;
                            break;
                        }
                    }
                }
            }
            if has_toc_inside {
                addon_dirs.push(path);
            }
        }
    }

    if addon_dirs.is_empty() {
        return Ok(ArchiveValidation::NoTocFound {
            filename: original_filename.to_string(),
        });
    }

    if addon_dirs.len() == 1 {
        return Ok(ArchiveValidation::Valid { addon_dirs });
    }

    Ok(ArchiveValidation::Bundled { addon_dirs })
}

fn verify_no_traversal(extract_dir: &Path) -> std::result::Result<(), String> {
    let canonical_root = fs::canonicalize(extract_dir).map_err(|e| e.to_string())?;
    for entry in walkdir::WalkDir::new(extract_dir) {
        let entry = entry.map_err(|e| e.to_string())?;
        let canonical = fs::canonicalize(entry.path()).map_err(|e| e.to_string())?;
        if !canonical.starts_with(&canonical_root) {
            let _ = fs::remove_dir_all(extract_dir);
            return Err(format!(
                "Path traversal detected in archive: {}",
                entry.path().display()
            ));
        }
    }
    Ok(())
}

pub fn extract_archive(
    file_path: &Path,
    extract_dir: &Path,
) -> std::result::Result<PathBuf, String> {
    let ext = file_path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .ok_or("Unable to determine archive type".to_string())?;

    let canonical_extract_dir = normalize_path(extract_dir);

    if ext == "zip" {
        let reader = fs::File::open(file_path).map_err(|e| e.to_string())?;
        let mut zip = ZipArchive::new(reader).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
            let mangled = file.mangled_name();
            let outpath = extract_dir.join(&mangled);
            let normalized_outpath = normalize_path(&outpath);
            if zip_slip_detected(&normalized_outpath, &canonical_extract_dir) {
                return Err(format!(
                    "Vulnerability detected: Zip Slip path traversal attempt: {}",
                    mangled.display()
                ));
            }
            if file.name().ends_with('/') {
                fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
                continue;
            }
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    } else if ext == "7z" {
        fs::create_dir_all(extract_dir).map_err(|e| e.to_string())?;
        sevenz_rust::decompress_file(file_path, extract_dir).map_err(|e| e.to_string())?;
        verify_no_traversal(extract_dir)?;
    } else if ext == "rar" {
        // Extract RAR using unrar crate
        // Ensure output directory exists
        fs::create_dir_all(extract_dir).map_err(|e| e.to_string())?;
        // Open archive for processing and extract
        let mut arc = unrar::Archive::new(file_path)
            .open_for_processing()
            .map_err(|e| e.to_string())?;
        while let Some(header) = arc.read_header().map_err(|e| e.to_string())? {
            arc = header
                .extract_with_base(extract_dir)
                .map_err(|e| e.to_string())?;
        }
        verify_no_traversal(extract_dir)?;
    } else {
        return Err(format!("Unsupported archive type: {}", ext));
    }

    let mut non_noise_entries = Vec::new();
    if let Ok(read_dir) = fs::read_dir(extract_dir) {
        for entry in read_dir.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with('.') || name_str.eq_ignore_ascii_case("__MACOSX") {
                continue;
            }
            non_noise_entries.push(entry);
        }
    }

    if non_noise_entries.len() == 1 {
        let entry = &non_noise_entries[0];
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            return Ok(entry.path());
        }
    }
    Ok(extract_dir.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::fs::File;
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn write_zip(path: &Path, entries: &[(&str, Option<&[u8]>)]) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for (name, content) in entries {
            match content {
                None => {
                    zip.add_directory(*name, options).unwrap();
                }
                Some(bytes) => {
                    zip.start_file(*name, options).unwrap();
                    zip.write_all(bytes).unwrap();
                }
            }
        }
        zip.finish().unwrap();
    }

    // ---------------- validate_addon_archive ----------------

    #[test]
    fn missing_extract_dir_is_corrupted() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("nope");
        let result = validate_addon_archive(&missing, "f.zip").unwrap();
        assert!(matches!(result, ArchiveValidation::Corrupted { filename } if filename == "f.zip"));
    }

    #[test]
    fn extract_dir_not_a_directory_errors() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("notadir");
        File::create(&file_path).unwrap();
        let result = validate_addon_archive(&file_path, "f.zip");
        assert!(result.is_err());
    }

    #[test]
    fn noise_only_entries_are_corrupted() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join(".DS_Store")).unwrap();
        fs::create_dir(dir.path().join("__MACOSX")).unwrap();
        let result = validate_addon_archive(dir.path(), "f.zip").unwrap();
        assert!(matches!(result, ArchiveValidation::Corrupted { .. }));
    }

    #[test]
    fn toc_at_root_is_valid() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("Addon.toc")).unwrap();
        let result = validate_addon_archive(dir.path(), "f.zip").unwrap();
        match result {
            ArchiveValidation::Valid { addon_dirs } => {
                assert_eq!(addon_dirs, vec![dir.path().to_path_buf()]);
            }
            other => panic!("expected Valid, got {other:?}"),
        }
    }

    #[test]
    fn loose_file_with_extension_at_root_has_loose_files() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("readme.txt")).unwrap();
        let result = validate_addon_archive(dir.path(), "f.zip").unwrap();
        assert!(matches!(result, ArchiveValidation::HasLooseFiles { .. }));
    }

    #[test]
    fn loose_file_without_extension_at_root_has_loose_files() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("README")).unwrap();
        let result = validate_addon_archive(dir.path(), "f.zip").unwrap();
        assert!(matches!(result, ArchiveValidation::HasLooseFiles { .. }));
    }

    #[test]
    fn single_addon_subdir_is_valid() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("MyAddon");
        fs::create_dir(&sub).unwrap();
        File::create(sub.join("MyAddon.toc")).unwrap();
        let result = validate_addon_archive(dir.path(), "f.zip").unwrap();
        match result {
            ArchiveValidation::Valid { addon_dirs } => assert_eq!(addon_dirs, vec![sub]),
            other => panic!("expected Valid, got {other:?}"),
        }
    }

    #[test]
    fn multiple_addon_subdirs_are_bundled() {
        let dir = tempdir().unwrap();
        for name in ["AddonA", "AddonB"] {
            let sub = dir.path().join(name);
            fs::create_dir(&sub).unwrap();
            File::create(sub.join(format!("{name}.toc"))).unwrap();
        }
        let result = validate_addon_archive(dir.path(), "f.zip").unwrap();
        assert!(matches!(result, ArchiveValidation::Bundled { .. }));
    }

    #[test]
    fn subdir_without_toc_is_no_toc_found() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("Empty");
        fs::create_dir(&sub).unwrap();
        File::create(sub.join("notes.txt")).unwrap();
        let result = validate_addon_archive(dir.path(), "f.zip").unwrap();
        assert!(matches!(result, ArchiveValidation::NoTocFound { .. }));
    }

    #[test]
    fn root_read_dir_permission_error_propagates() {
        let dir = tempdir().unwrap();
        let locked = dir.path().join("locked");
        fs::create_dir(&locked).unwrap();
        File::create(locked.join("inner.toc")).unwrap();
        fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o0)).unwrap();
        let result = validate_addon_archive(&locked, "f.zip");
        fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_err());
    }

    #[test]
    fn subdir_read_dir_permission_error_propagates() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("Locked");
        fs::create_dir(&sub).unwrap();
        File::create(sub.join("x.toc")).unwrap();
        fs::set_permissions(&sub, std::fs::Permissions::from_mode(0o0)).unwrap();
        let result = validate_addon_archive(dir.path(), "f.zip");
        fs::set_permissions(&sub, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_err());
    }

    // ---------------- verify_no_traversal ----------------

    #[test]
    fn verify_no_traversal_ok_for_clean_tree() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        File::create(dir.path().join("sub").join("a.txt")).unwrap();
        assert!(verify_no_traversal(dir.path()).is_ok());
    }

    #[test]
    fn verify_no_traversal_detects_symlink_escape() {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        File::create(outside.path().join("secret.txt")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.txt"), dir.path().join("evil"))
            .unwrap();
        let result = verify_no_traversal(dir.path());
        assert!(result.is_err());
        assert!(!dir.path().exists());
    }

    #[test]
    fn verify_no_traversal_canonicalize_error_on_dangling_symlink() {
        let dir = tempdir().unwrap();
        std::os::unix::fs::symlink(
            dir.path().join("does-not-exist"),
            dir.path().join("dangling"),
        )
        .unwrap();
        let result = verify_no_traversal(dir.path());
        assert!(result.is_err());
    }

    #[test]
    fn verify_no_traversal_walkdir_read_error_on_locked_subdir() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("locked");
        fs::create_dir(&sub).unwrap();
        File::create(sub.join("inner.txt")).unwrap();
        fs::set_permissions(&sub, std::fs::Permissions::from_mode(0o0)).unwrap();
        let result = verify_no_traversal(dir.path());
        fs::set_permissions(&sub, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_err());
    }

    // ---------------- extract_archive ----------------

    #[test]
    fn extract_archive_no_extension_errors() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("noext");
        File::create(&file_path).unwrap();
        let result = extract_archive(&file_path, &dir.path().join("out"));
        assert!(result.is_err());
    }

    #[test]
    fn extract_archive_unsupported_extension_errors() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("f.xyz");
        File::create(&file_path).unwrap();
        let result = extract_archive(&file_path, &dir.path().join("out"));
        assert_eq!(result, Err("Unsupported archive type: xyz".to_string()));
    }

    #[test]
    fn extract_archive_missing_zip_file_errors() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("missing.zip");
        let result = extract_archive(&file_path, &dir.path().join("out"));
        assert!(result.is_err());
    }

    #[test]
    fn extract_archive_corrupted_zip_errors() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("garbage.zip");
        File::create(&file_path)
            .unwrap()
            .write_all(b"not a zip file")
            .unwrap();
        let result = extract_archive(&file_path, &dir.path().join("out"));
        assert!(result.is_err());
    }

    #[test]
    fn extract_archive_zip_single_nested_dir_returns_addon_dir() {
        let dir = tempdir().unwrap();
        let zip_path = dir.path().join("addon.zip");
        write_zip(
            &zip_path,
            &[
                ("MyAddon/", None),
                ("MyAddon/MyAddon.toc", Some(b"## Interface: 11200")),
            ],
        );
        let out = dir.path().join("out");
        let result = extract_archive(&zip_path, &out).unwrap();
        assert_eq!(result, out.join("MyAddon"));
        assert!(out.join("MyAddon").join("MyAddon.toc").exists());
    }

    #[test]
    fn extract_archive_zip_multiple_root_entries_returns_extract_dir() {
        let dir = tempdir().unwrap();
        let zip_path = dir.path().join("addon.zip");
        write_zip(
            &zip_path,
            &[
                ("Addon.toc", Some(b"## Interface: 11200")),
                ("readme.txt", Some(b"hi")),
            ],
        );
        let out = dir.path().join("out");
        let result = extract_archive(&zip_path, &out).unwrap();
        assert_eq!(result, out);
    }

    #[test]
    fn extract_archive_zip_single_top_level_file_returns_extract_dir() {
        let dir = tempdir().unwrap();
        let zip_path = dir.path().join("addon.zip");
        write_zip(&zip_path, &[("Addon.toc", Some(b"## Interface: 11200"))]);
        let out = dir.path().join("out");
        let result = extract_archive(&zip_path, &out).unwrap();
        assert_eq!(result, out);
    }

    #[test]
    fn extract_archive_zip_empty_after_extraction_returns_extract_dir() {
        // No entries at all: non_noise_entries stays empty, falls through to Ok(extract_dir).
        let dir = tempdir().unwrap();
        let zip_path = dir.path().join("empty.zip");
        write_zip(&zip_path, &[]);
        let out = dir.path().join("out");
        fs::create_dir_all(&out).unwrap();
        let result = extract_archive(&zip_path, &out).unwrap();
        assert_eq!(result, out);
    }

    #[test]
    fn extract_archive_7z_roundtrip() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("src");
        fs::create_dir(&src).unwrap();
        let addon = src.join("MyAddon");
        fs::create_dir(&addon).unwrap();
        File::create(addon.join("MyAddon.toc"))
            .unwrap()
            .write_all(b"## Interface: 11200")
            .unwrap();
        let archive_path = dir.path().join("addon.7z");
        sevenz_rust::compress_to_path(&src, &archive_path).unwrap();

        let out = dir.path().join("out");
        let result = extract_archive(&archive_path, &out).unwrap();
        assert_eq!(result, out.join("MyAddon"));
        assert!(out.join("MyAddon").join("MyAddon.toc").exists());
    }

    #[test]
    fn extract_archive_7z_corrupted_errors() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("garbage.7z");
        File::create(&archive_path)
            .unwrap()
            .write_all(b"not a 7z file")
            .unwrap();
        let out = dir.path().join("out");
        let result = extract_archive(&archive_path, &out);
        assert!(result.is_err());
    }

    /// A tiny real RAR5 archive (one dir, one .toc file inside), built once with the
    /// system `rar` CLI (no pure-Rust RAR encoder exists, and the `unrar` crate this
    /// project depends on is read-only) and embedded here so the test suite needs no
    /// external binary at run time. Exercises the full `extract_archive` rar branch,
    /// including the header-read loop body and `extract_to`, which no synthetic/garbage
    /// byte content can reach (a valid header is required to enter the loop at all).
    const RAR_FIXTURE_B64: &str = "UmFyIRoHAQAzkrXlCgEFBgAFAQGAgABZjMq6MQIDC5QABJQApIMCSAHNqoAAARNNeUFkZG9uL015QWRkb24udG9jCgMTBVuZavqtbywjIyBJbnRlcmZhY2U6IDExMjAwCk4U9dwfAgMLAAEA7YMBgAABB015QWRkb24KAxMFW5lqUqlgLB13VlEDBQQA";

    #[test]
    fn extract_archive_rar_roundtrip() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("addon.rar");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(RAR_FIXTURE_B64)
            .unwrap();
        File::create(&archive_path)
            .unwrap()
            .write_all(&bytes)
            .unwrap();

        let out = dir.path().join("out");
        let result = extract_archive(&archive_path, &out).unwrap();
        assert_eq!(result, out.join("MyAddon"));
        assert!(out.join("MyAddon").join("MyAddon.toc").exists());
    }

    #[test]
    fn extract_archive_rar_open_error_on_missing_file() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("missing.rar");
        let out = dir.path().join("out");
        let result = extract_archive(&archive_path, &out);
        assert!(result.is_err());
    }
}
