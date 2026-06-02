use crate::fs_utils::normalize_path;
use zip::ZipArchive;
use std::fs;
use std::path::{Path, PathBuf};
use std::io;

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(tag = "type", content = "data")]
pub enum ArchiveValidation {
    Valid { addon_dirs: Vec<PathBuf> },
    Bundled { addon_dirs: Vec<PathBuf> },
    HasLooseFiles { filename: String },
    NoTocFound { filename: String },
    Corrupted { filename: String },
}

pub fn validate_addon_archive(extract_dir: &Path, original_filename: &str) -> std::result::Result<ArchiveValidation, String> {
    if !extract_dir.exists() {
        return Ok(ArchiveValidation::Corrupted { filename: original_filename.to_string() });
    }

    let mut non_noise_entries = Vec::new();
    let read_dir = fs::read_dir(extract_dir).map_err(|e| e.to_string())?;
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') || name_str.eq_ignore_ascii_case("__MACOSX") {
            continue;
        }
        non_noise_entries.push(entry);
    }

    if non_noise_entries.is_empty() {
        return Ok(ArchiveValidation::Corrupted { filename: original_filename.to_string() });
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
        return Ok(ArchiveValidation::Valid { addon_dirs: vec![extract_dir.to_path_buf()] });
    }

    if has_loose_files_at_root {
        return Ok(ArchiveValidation::HasLooseFiles { filename: original_filename.to_string() });
    }

    // Find all subdirectories that contain a TOC file directly inside them
    let mut addon_dirs = Vec::new();
    for entry in &non_noise_entries {
        let path = entry.path();
        if path.is_dir() {
            let mut has_toc_inside = false;
            let sub_dir = fs::read_dir(&path).map_err(|e| e.to_string())?;
            for sub_entry in sub_dir {
                let sub_entry = sub_entry.map_err(|e| e.to_string())?;
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
        return Ok(ArchiveValidation::NoTocFound { filename: original_filename.to_string() });
    }

    if addon_dirs.len() == 1 {
        return Ok(ArchiveValidation::Valid { addon_dirs });
    }

    Ok(ArchiveValidation::Bundled { addon_dirs })
}

pub fn extract_archive(file_path: &Path, extract_dir: &Path) -> std::result::Result<PathBuf, String> {
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
            if !normalized_outpath.starts_with(&canonical_extract_dir) {
                return Err(format!("Vulnerability detected: Zip Slip path traversal attempt: {}", mangled.display()));
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
    } else {
        return Err(format!("Unsupported archive type: {}", ext));
    }

    let mut non_noise_entries = Vec::new();
    if let Ok(read_dir) = fs::read_dir(extract_dir) {
        for entry in read_dir {
            if let Ok(entry) = entry {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with('.') || name_str.eq_ignore_ascii_case("__MACOSX") {
                    continue;
                }
                non_noise_entries.push(entry);
            }
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


