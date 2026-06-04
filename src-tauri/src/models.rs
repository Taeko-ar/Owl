use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct OwlAddonMeta {
    pub remote_url: String,
    pub branch: String,
    pub commit_sha: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonGitStatus {
    pub remote_url: Option<String>,
    pub branch: Option<String>,
    pub ahead: Option<i32>,
    pub behind: Option<i32>,
    pub update_available: Option<bool>,
    pub last_commit: Option<String>,
    pub branches: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonMeta {
    pub name: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub optional_deps: Vec<String>,
    pub optional_deps_installed: Vec<bool>,
    pub required_deps: Vec<String>,
    pub toc_file: Option<String>,
    pub readme: Option<String>,
    pub path: Option<String>,
    pub git_status: Option<AddonGitStatus>,
    pub has_git: bool,
    pub is_dependency: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AddonProfile {
    pub name: String,
    pub enabled_addons: Vec<String>,
    pub tweak_configs: Option<std::collections::HashMap<String, String>>,
    pub enabled_patches: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LauncherSettings {
    pub path: Option<String>,
    pub window_size: Option<String>,
    pub stay_open: Option<bool>,
    pub active_profile_by_path: Option<std::collections::HashMap<String, String>>,
    pub addon_profiles_by_path: Option<std::collections::HashMap<String, Vec<AddonProfile>>>,
    pub addon_profiles: Option<Vec<AddonProfile>>,
    pub active_profile: Option<String>,
}
#[derive(Serialize, Deserialize, Clone)]
pub struct ExportedAddon {
    pub name: String,
    pub enabled: bool,
    pub source: String, // "github", "curseforge", or "manual"
    #[serde(rename = "gitUrl")]
    pub git_url: Option<String>,
    pub branch: Option<String>,
    #[serde(rename = "commitSha")]
    pub commit_sha: Option<String>,
    #[serde(rename = "modId")]
    pub mod_id: Option<i32>,
    #[serde(rename = "fileId")]
    pub file_id: Option<i32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ExportPayload {
    pub v: i32,
    pub addons: Vec<ExportedAddon>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CurseForgeMeta {
    #[serde(rename = "modId")]
    pub mod_id: i32,
    #[serde(rename = "fileId")]
    pub file_id: i32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAddonSourceMeta {
    pub name: String,
    pub mod_id: Option<i32>,
    pub git_url: Option<String>,
}

