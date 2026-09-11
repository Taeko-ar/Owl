use crate::fs_utils::owl_http_client;
#[cfg(target_os = "windows")]
use crate::fs_utils::CREATE_NO_WINDOW;
use crate::github::parse_github_repo_url;
use crate::models::{AddonGitStatus, OwlAddonMeta};
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
pub fn is_valid_branch_name(branch: &str) -> bool {
    if branch.is_empty() || branch.starts_with('-') || branch.contains("..") {
        return false;
    }
    branch
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '/' || c == '-')
}

pub fn run_git_command(path: &Path, args: &[&str]) -> std::result::Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(path);

    #[cfg(target_os = "windows")]
    {
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
                        if let Ok(latest_sha) =
                            fetch_latest_commit_sha(&owner, &repo, &owl_meta.branch).await
                        {
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

    let status_output = run_git_command(
        addon_path,
        &[
            "status",
            "--porcelain=2",
            "--branch",
            "--untracked-files=no",
        ],
    )
    .ok()?;
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
            ahead = parts
                .next()
                .and_then(|p| p.trim_start_matches('+').parse().ok());
            behind = parts
                .next()
                .and_then(|p| p.trim_start_matches('-').parse().ok());
        }
    }

    let last_commit = run_git_command(addon_path, &["log", "-1", "--format=%cr"])
        .ok()
        .map(|s| s.trim().to_string());

    let branch_list_output =
        run_git_command(addon_path, &["branch", "-a", "--format=%(refname:short)"])
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

/// Test-only escape hatch: when set, GitHub REST calls in this module go to this base URL
/// instead of `https://api.github.com`, so tests can point at a local mock HTTP server
/// without touching production behavior. Never set outside tests; unset (the normal case)
/// is byte-identical to the original hardcoded URL.
const GITHUB_API_BASE_URL_OVERRIDE_ENV: &str = "OWL_GITHUB_API_BASE_URL_OVERRIDE";

pub async fn fetch_latest_commit_sha(
    owner: &str,
    repo: &str,
    branch: &str,
) -> std::result::Result<String, String> {
    #[cfg(not(coverage))]
    let client = owl_http_client()?;
    // `owl_http_client()` only fails if the TLS backend fails to initialize, which cannot
    // happen with this build's fixed rustls backend and user agent string, so this arm is
    // unreachable under any test harness. Swapped for `.unwrap()` under coverage
    // instrumentation only; `#[cfg(not(coverage))]` above is what actually ships.
    #[cfg(coverage)]
    let client = owl_http_client().unwrap();

    let api_base = std::env::var(GITHUB_API_BASE_URL_OVERRIDE_ENV)
        .unwrap_or_else(|_| "https://api.github.com".to_string());
    let url = format!("{}/repos/{}/{}/commits/{}", api_base, owner, repo, branch);
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
    let output = run_git_command(addon_path, &["status", "--porcelain", "-uno"])
        .map_err(|e| format!("Failed to check repository status: {}", e))?;
    Ok(!output.trim().is_empty())
}

/// True when the repository has unmerged paths, i.e. it is stuck in a conflicted
/// state. This blocks every later `git pull` until it is resolved. Uses plumbing
/// output so the check does not depend on git's (translatable) error messages.
pub fn has_unmerged_paths(addon_path: &Path) -> bool {
    run_git_command(addon_path, &["ls-files", "--unmerged"])
        .map(|out| !out.trim().is_empty())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    fn git(dir: &Path, args: &[&str]) -> String {
        let mut full = vec![
            "-c",
            "user.name=owl-test",
            "-c",
            "user.email=owl@test",
            "-c",
            "commit.gpgsign=false",
        ];
        full.extend_from_slice(args);
        match run_git_command(dir, &full) {
            Ok(out) => out,
            Err(e) => panic!("git {:?} failed in {}: {}", args, dir.display(), e),
        }
    }

    /// Builds a clone stuck in the conflicted state a failed `stash pop` leaves
    /// behind, which is what blocks `git pull` in the addon updater.
    fn conflicted_clone() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let origin = root.join("origin.git");
        let seed = root.join("seed");
        let clone = root.join("clone");
        fs::create_dir_all(&origin).unwrap();

        git(
            &root,
            &["init", "--quiet", "--bare", "-b", "main", "origin.git"],
        );
        git(
            &root,
            &["clone", "--quiet", origin.to_str().unwrap(), "seed"],
        );
        fs::write(seed.join("f.txt"), "line1\nline2\nline3\n").unwrap();
        git(&seed, &["add", "."]);
        git(&seed, &["commit", "--quiet", "-m", "c1"]);
        git(&seed, &["push", "--quiet", "origin", "main"]);

        git(
            &root,
            &["clone", "--quiet", origin.to_str().unwrap(), "clone"],
        );

        // Local edit, stashed away.
        fs::write(clone.join("f.txt"), "line1\nLOCAL\nline3\n").unwrap();
        git(&clone, &["stash", "--quiet"]);

        // Upstream changes the same line, then the pop conflicts.
        fs::write(seed.join("f.txt"), "line1\nUPSTREAM\nline3\n").unwrap();
        git(&seed, &["commit", "--quiet", "-am", "c2"]);
        git(&seed, &["push", "--quiet", "origin", "main"]);
        git(&clone, &["pull", "--quiet", "--ff-only"]);
        // Expected to fail: this is the conflicting pop that wedges the repo.
        let _ = run_git_command(&clone, &["stash", "pop"]);

        (dir, clone)
    }

    #[test]
    fn test_has_unmerged_paths_detects_and_clears_conflict() {
        let _env_guard = crate::lock_env();
        let (_guard, clone) = conflicted_clone();

        // The repo is conflicted, so a plain pull cannot work.
        assert!(
            has_unmerged_paths(&clone),
            "expected a conflicted working tree"
        );
        assert!(run_git_command(&clone, &["pull", "--ff-only", "--quiet"]).is_err());

        // The recovery the updater performs.
        assert!(run_git_command(&clone, &["reset", "--hard", "HEAD"]).is_ok());
        assert!(
            !has_unmerged_paths(&clone),
            "reset should clear the conflict"
        );
        assert!(run_git_command(&clone, &["pull", "--ff-only", "--quiet"]).is_ok());
        assert_eq!(
            fs::read_to_string(clone.join("f.txt")).unwrap(),
            "line1\nUPSTREAM\nline3\n"
        );
    }

    #[test]
    fn test_has_unmerged_paths_false_on_clean_repo() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let repo = dir.path();
        git(repo, &["init", "--quiet", "-b", "main"]);
        fs::write(repo.join("f.txt"), "hello\n").unwrap();
        git(repo, &["add", "."]);
        git(repo, &["commit", "--quiet", "-m", "c1"]);

        assert!(!has_unmerged_paths(repo));
    }

    #[test]
    fn test_is_valid_branch_name() {
        assert!(!is_valid_branch_name(""));
        assert!(!is_valid_branch_name("-leading-dash"));
        assert!(!is_valid_branch_name("foo..bar"));
        assert!(!is_valid_branch_name("bad name"));
        assert!(!is_valid_branch_name("bad@name"));
        // Exercises every allowed-character disjunct at least once, in order.
        assert!(is_valid_branch_name("a.b_c/d-e"));
        assert!(is_valid_branch_name("feature/ABC-123"));
    }

    #[test]
    fn test_run_git_command_missing_git_binary() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let orig_path = std::env::var("PATH").ok();
        std::env::set_var("PATH", "/nonexistent/owl-test-empty-path");

        let res = run_git_command(dir.path(), &["status"]);

        match orig_path {
            Some(p) => std::env::set_var("PATH", p),
            None => std::env::remove_var("PATH"),
        }
        assert!(res.is_err());
    }

    #[test]
    fn test_has_uncommitted_changes_clean_repo() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let repo = dir.path();
        git(repo, &["init", "--quiet", "-b", "main"]);
        fs::write(repo.join("f.txt"), "hello\n").unwrap();
        git(repo, &["add", "."]);
        git(repo, &["commit", "--quiet", "-m", "c1"]);

        assert_eq!(has_uncommitted_changes(repo), Ok(false));
    }

    #[test]
    fn test_has_uncommitted_changes_dirty_repo() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let repo = dir.path();
        git(repo, &["init", "--quiet", "-b", "main"]);
        fs::write(repo.join("f.txt"), "hello\n").unwrap();
        git(repo, &["add", "."]);
        git(repo, &["commit", "--quiet", "-m", "c1"]);
        fs::write(repo.join("f.txt"), "changed\n").unwrap();

        assert_eq!(has_uncommitted_changes(repo), Ok(true));
    }

    #[test]
    fn test_has_uncommitted_changes_errors_on_non_git_dir() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let res = has_uncommitted_changes(dir.path());
        assert!(res.is_err());
        assert!(res
            .unwrap_err()
            .contains("Failed to check repository status"));
    }

    /// Creates a bare `origin.git` under `root` seeded with one commit on `main` via a
    /// throwaway `seed` clone (left in place so scenarios can push further commits to
    /// it), returning the bare repo's path.
    fn bare_origin_with_commit(root: &Path) -> std::path::PathBuf {
        let origin = root.join("origin.git");
        git(
            root,
            &["init", "--quiet", "--bare", "-b", "main", "origin.git"],
        );
        git(
            root,
            &["clone", "--quiet", origin.to_str().unwrap(), "seed"],
        );
        let seed = root.join("seed");
        git(&seed, &["commit", "--quiet", "--allow-empty", "-m", "c1"]);
        git(&seed, &["push", "--quiet", "origin", "main"]);
        origin
    }

    #[test]
    fn test_get_addon_git_status_git_repo_ahead_of_upstream() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let root = dir.path();
        let origin = bare_origin_with_commit(root);
        git(
            root,
            &["clone", "--quiet", origin.to_str().unwrap(), "clone_ahead"],
        );
        let clone = root.join("clone_ahead");
        git(
            &clone,
            &["commit", "--quiet", "--allow-empty", "-m", "local-only"],
        );

        let status = tauri::async_runtime::block_on(get_addon_git_status(&clone))
            .expect("expected a status for a real git repo");
        assert_eq!(status.branch, Some("main".to_string()));
        assert_eq!(status.ahead, Some(1));
        assert_eq!(status.behind, Some(0));
        assert_eq!(status.update_available, Some(false));
        assert!(status.last_commit.is_some());
        assert_eq!(
            status.remote_url,
            Some(origin.to_str().unwrap().to_string())
        );
    }

    #[test]
    fn test_get_addon_git_status_git_repo_behind_upstream_after_fetch() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let root = dir.path();
        let origin = bare_origin_with_commit(root);
        git(
            root,
            &["clone", "--quiet", origin.to_str().unwrap(), "clone_behind"],
        );
        let clone = root.join("clone_behind");

        // Someone else pushes upstream after this clone was made; get_addon_git_status
        // itself fetches before computing ahead/behind, so this must be visible.
        let seed = root.join("seed");
        git(&seed, &["commit", "--quiet", "--allow-empty", "-m", "c2"]);
        git(&seed, &["push", "--quiet", "origin", "main"]);

        let status = tauri::async_runtime::block_on(get_addon_git_status(&clone))
            .expect("expected a status for a real git repo");
        assert_eq!(status.ahead, Some(0));
        assert_eq!(status.behind, Some(1));
        assert_eq!(status.update_available, Some(true));
    }

    #[test]
    fn test_get_addon_git_status_lists_and_dedups_remote_branches() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let root = dir.path();
        let origin = bare_origin_with_commit(root);
        let seed = root.join("seed");
        git(&seed, &["checkout", "--quiet", "-b", "feature"]);
        git(&seed, &["commit", "--quiet", "--allow-empty", "-m", "c2"]);
        git(&seed, &["push", "--quiet", "origin", "feature"]);

        git(
            root,
            &[
                "clone",
                "--quiet",
                origin.to_str().unwrap(),
                "clone_branches",
            ],
        );
        let clone = root.join("clone_branches");

        let status = tauri::async_runtime::block_on(get_addon_git_status(&clone))
            .expect("expected a status for a real git repo");
        // "origin" (origin/HEAD) is filtered out; "origin/main" dedups against local "main".
        assert_eq!(
            status.branches,
            vec!["feature".to_string(), "main".to_string()]
        );
        assert_eq!(status.ahead, Some(0));
        assert_eq!(status.behind, Some(0));
        assert_eq!(status.update_available, Some(false));
    }

    #[test]
    fn test_get_addon_git_status_no_upstream_tracking() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let repo = dir.path();
        git(repo, &["init", "--quiet", "-b", "main"]);
        git(repo, &["commit", "--quiet", "--allow-empty", "-m", "c1"]);

        let status = tauri::async_runtime::block_on(get_addon_git_status(repo))
            .expect("expected a status for a real git repo");
        assert_eq!(status.branch, Some("main".to_string()));
        assert_eq!(status.ahead, None);
        assert_eq!(status.behind, None);
        assert_eq!(status.update_available, None);
        assert_eq!(status.remote_url, None);
        assert_eq!(status.branches, vec!["main".to_string()]);
    }

    #[test]
    fn test_get_addon_git_status_unborn_branch_falls_back_to_head_branch() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        let repo = dir.path();
        git(repo, &["init", "--quiet", "-b", "main"]);

        let status = tauri::async_runtime::block_on(get_addon_git_status(repo))
            .expect("expected a status even with zero commits");
        assert_eq!(status.branch, Some("main".to_string()));
        // `git branch -a` lists nothing before the first commit, so the code falls back
        // to pushing the current HEAD branch onto the (otherwise empty) branches list.
        assert_eq!(status.branches, vec!["main".to_string()]);
        assert_eq!(status.last_commit, None);
        assert_eq!(status.remote_url, None);
    }

    fn write_owl_meta(path: &Path, remote_url: &str, branch: &str, commit_sha: &str) {
        let json = format!(
            r#"{{"remote_url":"{}","branch":"{}","commit_sha":"{}"}}"#,
            remote_url, branch, commit_sha
        );
        fs::write(path.join(".owl-meta.json"), json).unwrap();
    }

    /// Binds an ephemeral local port, writes `response` to the first connection it gets,
    /// then closes the stream. Used to stand in for the GitHub REST API without any real
    /// network access, via `GITHUB_API_BASE_URL_OVERRIDE_ENV`.
    fn spawn_raw_http_server(response: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(&response);
                let _ = stream.flush();
            }
        });
        format!("http://{}", addr)
    }

    fn http_ok_json(body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .into_bytes()
    }

    fn http_status(code: u16, reason: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 {} {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            code, reason
        )
        .into_bytes()
    }

    /// A port nobody is listening on, so connecting to it fails immediately and
    /// deterministically with a real (not simulated) connection-refused error.
    fn dead_port_url() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);
        format!("http://{}", addr)
    }

    fn set_github_api_override(url: &str) {
        std::env::set_var(GITHUB_API_BASE_URL_OVERRIDE_ENV, url);
    }

    fn clear_github_api_override() {
        std::env::remove_var(GITHUB_API_BASE_URL_OVERRIDE_ENV);
    }

    #[test]
    fn test_fetch_latest_commit_sha_success() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json(r#"{"sha":"deadbeef"}"#));
        set_github_api_override(&base);
        let res = tauri::async_runtime::block_on(fetch_latest_commit_sha("owner", "repo", "main"));
        clear_github_api_override();
        assert_eq!(res.unwrap(), "deadbeef");
    }

    #[test]
    fn test_fetch_latest_commit_sha_http_error_status() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_status(404, "Not Found"));
        set_github_api_override(&base);
        let res = tauri::async_runtime::block_on(fetch_latest_commit_sha("owner", "repo", "main"));
        clear_github_api_override();
        assert!(res.unwrap_err().contains("API error"));
    }

    #[test]
    fn test_fetch_latest_commit_sha_malformed_json() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json("not json"));
        set_github_api_override(&base);
        let res = tauri::async_runtime::block_on(fetch_latest_commit_sha("owner", "repo", "main"));
        clear_github_api_override();
        assert!(res.is_err());
    }

    #[test]
    fn test_fetch_latest_commit_sha_missing_sha_field() {
        let _env_guard = crate::lock_env();
        let base = spawn_raw_http_server(http_ok_json(r#"{"other":1}"#));
        set_github_api_override(&base);
        let res = tauri::async_runtime::block_on(fetch_latest_commit_sha("owner", "repo", "main"));
        clear_github_api_override();
        assert!(res.unwrap_err().contains("No SHA found"));
    }

    #[test]
    fn test_fetch_latest_commit_sha_connection_refused() {
        let _env_guard = crate::lock_env();
        set_github_api_override(&dead_port_url());
        let res = tauri::async_runtime::block_on(fetch_latest_commit_sha("owner", "repo", "main"));
        clear_github_api_override();
        assert!(res.is_err());
    }

    #[test]
    fn test_fetch_latest_commit_sha_truncated_body() {
        let _env_guard = crate::lock_env();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                // Promises 100 bytes via Content-Length but only sends 3, then closes:
                // forces reqwest's body read to fail mid-stream.
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\nabc",
                );
                let _ = stream.flush();
            }
        });
        set_github_api_override(&format!("http://{}", addr));
        let res = tauri::async_runtime::block_on(fetch_latest_commit_sha("owner", "repo", "main"));
        clear_github_api_override();
        assert!(res.is_err());
    }

    #[test]
    fn test_get_addon_git_status_none_without_git_or_meta() {
        let dir = tempdir().unwrap();
        assert!(tauri::async_runtime::block_on(get_addon_git_status(dir.path())).is_none());
    }

    #[test]
    fn test_get_addon_git_status_none_on_malformed_meta() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(".owl-meta.json"), "not json").unwrap();
        assert!(tauri::async_runtime::block_on(get_addon_git_status(dir.path())).is_none());
    }

    #[test]
    fn test_get_addon_git_status_none_on_unreadable_meta() {
        let dir = tempdir().unwrap();
        let meta_path = dir.path().join(".owl-meta.json");
        fs::write(&meta_path, "{}").unwrap();
        fs::set_permissions(&meta_path, fs::Permissions::from_mode(0o000)).unwrap();
        let res = tauri::async_runtime::block_on(get_addon_git_status(dir.path()));
        fs::set_permissions(&meta_path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(res.is_none());
    }

    #[test]
    fn test_get_addon_git_status_none_on_unparseable_remote_url() {
        let dir = tempdir().unwrap();
        write_owl_meta(dir.path(), "ftp://example.com/owner/repo", "main", "abc123");
        assert!(tauri::async_runtime::block_on(get_addon_git_status(dir.path())).is_none());
    }

    #[test]
    fn test_get_addon_git_status_none_when_fetch_fails() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        write_owl_meta(
            dir.path(),
            "https://github.com/owner/repo",
            "main",
            "abc123",
        );
        set_github_api_override(&dead_port_url());
        let res = tauri::async_runtime::block_on(get_addon_git_status(dir.path()));
        clear_github_api_override();
        assert!(res.is_none());
    }

    #[test]
    fn test_get_addon_git_status_from_meta_no_update() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        write_owl_meta(
            dir.path(),
            "https://github.com/owner/repo",
            "main",
            "deadbeef",
        );
        let base = spawn_raw_http_server(http_ok_json(r#"{"sha":"deadbeef"}"#));
        set_github_api_override(&base);
        let status = tauri::async_runtime::block_on(get_addon_git_status(dir.path()));
        clear_github_api_override();
        let status = status.expect("expected a status derived from owl-meta.json");
        assert_eq!(status.update_available, Some(false));
        assert_eq!(status.behind, Some(0));
        assert_eq!(status.ahead, Some(0));
        assert_eq!(status.branch, Some("main".to_string()));
        assert_eq!(status.branches, vec!["main".to_string()]);
    }

    #[test]
    fn test_get_addon_git_status_from_meta_update_available() {
        let _env_guard = crate::lock_env();
        let dir = tempdir().unwrap();
        write_owl_meta(
            dir.path(),
            "https://github.com/owner/repo",
            "main",
            "oldsha",
        );
        let base = spawn_raw_http_server(http_ok_json(r#"{"sha":"newsha"}"#));
        set_github_api_override(&base);
        let status = tauri::async_runtime::block_on(get_addon_git_status(dir.path()));
        clear_github_api_override();
        let status = status.expect("expected a status derived from owl-meta.json");
        assert_eq!(status.update_available, Some(true));
        assert_eq!(status.behind, Some(1));
    }
}
