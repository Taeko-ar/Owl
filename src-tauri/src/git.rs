use crate::models::{AddonGitStatus, OwlAddonMeta};
use crate::github::parse_github_repo_url;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::fs;
use std::path::Path;
use std::process::Command;
pub fn is_valid_branch_name(branch: &str) -> bool {
    if branch.is_empty() || branch.starts_with('-') || branch.contains("..") {
        return false;
    }
    branch.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '/' || c == '-')
}

pub fn run_git_command(path: &Path, args: &[&str]) -> std::result::Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(path);

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub async fn get_addon_git_status(addon_path: &Path) -> Option<AddonGitStatus> {
    if !addon_path.join(".git").exists() {
        let meta_path = addon_path.join(".owl-meta.json");
        if meta_path.exists() {
            if let Ok(content) = fs::read_to_string(&meta_path) {
                if let Ok(owl_meta) = serde_json::from_str::<OwlAddonMeta>(&content) {
                    if let Ok((owner, repo, _)) = parse_github_repo_url(&owl_meta.remote_url) {
                        if let Ok(latest_sha) = fetch_latest_commit_sha(&owner, &repo, &owl_meta.branch).await {
                            let has_update = latest_sha != owl_meta.commit_sha;
                            return Some(AddonGitStatus {
                                remote_url: Some(owl_meta.remote_url),
                                branch: Some(owl_meta.branch.clone()),
                                ahead: Some(0),
                                behind: Some(if has_update { 1 } else { 0 }),
                                update_available: Some(has_update),
                                last_commit: None,
                                branches: vec![owl_meta.branch],
                            });
                        }
                    }
                }
            }
        }
        return None;
    }

    let _ = run_git_command(addon_path, &["fetch", "--quiet", "--all", "--prune"]);

    let status_output = run_git_command(addon_path, &["status", "--porcelain=2", "--branch", "--untracked-files=no"]).ok()?;
    let remote_url = run_git_command(addon_path, &["remote", "get-url", "origin"]).ok();

    let mut branch = None;
    let mut ahead = None;
    let mut behind = None;
    for line in status_output.lines() {
        if let Some(value) = line.strip_prefix("# branch.head ") {
            branch = Some(value.to_string());
        }
        if let Some(value) = line.strip_prefix("# branch.ab ") {
            let mut parts = value.split_whitespace();
            ahead = parts.next().and_then(|p| p.trim_start_matches('+').parse().ok());
            behind = parts.next().and_then(|p| p.trim_start_matches('-').parse().ok());
        }
    }

    let last_commit = run_git_command(addon_path, &["log", "-1", "--format=%cr"])
        .ok()
        .map(|s| s.trim().to_string());

    let branch_list_output = run_git_command(addon_path, &["branch", "-a", "--format=%(refname:short)"])
        .ok()
        .unwrap_or_default();

    let mut branches: Vec<String> = branch_list_output
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && !line.contains("HEAD") && !line.contains("->"))
        .map(|line| {
            line.strip_prefix("remotes/origin/")
                .unwrap_or(line)
                .strip_prefix("origin/")
                .unwrap_or(line)
                .to_string()
        })
        .filter(|b| !b.is_empty() && b != "origin" && b != "remotes/origin")
        .collect();
    branches.sort();
    branches.dedup();

    if branches.is_empty() {
        if let Some(ref b) = branch {
            branches.push(b.clone());
        }
    }

    Some(AddonGitStatus {
        remote_url,
        branch,
        ahead,
        behind,
        update_available: behind.map(|b| b > 0),
        last_commit,
        branches,
    })
}

pub async fn fetch_latest_commit_sha(owner: &str, repo: &str, branch: &str) -> std::result::Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("OWL-Launcher")
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.github.com/repos/{}/{}/commits/{}", owner, repo, branch);
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("API error: {}", resp.status()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let sha = json["sha"].as_str().ok_or("No SHA found in API response")?;
    Ok(sha.to_string())
}

pub fn has_uncommitted_changes(addon_path: &Path) -> std::result::Result<bool, String> {
    let output = run_git_command(addon_path, &["status", "--porcelain", "-uno"]).map_err(|e| format!("Failed to check repository status: {}", e))?;
    Ok(!output.trim().is_empty())
}

