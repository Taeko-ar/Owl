use crate::fs_utils::normalize_path;
use zip::ZipArchive;
use std::fs;
use std::path::{Path, PathBuf};
use std::io;
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

