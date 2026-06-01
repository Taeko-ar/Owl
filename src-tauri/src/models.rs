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
    pub toc_file: Option<String>,
    pub readme: Option<String>,
    pub path: Option<String>,
    pub git_status: Option<AddonGitStatus>,
    pub has_git: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherSettings {
    pub path: Option<String>,
    pub window_size: Option<String>,
    pub stay_open: Option<bool>,
}

