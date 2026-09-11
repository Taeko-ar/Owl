use crate::git::is_valid_branch_name;
pub fn parse_github_repo_url(
    repo_url: &str,
) -> std::result::Result<(String, String, Option<String>), String> {
    let repo_url = repo_url.trim().trim_end_matches('/');
    let repo_url = repo_url
        .strip_prefix("https://")
        .or_else(|| repo_url.strip_prefix("http://"))
        .ok_or("GitHub URL must start with http:// or https://")?;
    let parts: Vec<&str> = repo_url.split('/').collect();
    if parts.len() < 3 || parts[0] != "github.com" {
        return Err("URL must be a github.com repository URL".into());
    }
    let owner = parts[1].to_string();
    let repo = parts[2].trim_end_matches(".git").to_string();
    let branch = if parts.len() > 4 && (parts[3] == "tree" || parts[3] == "blob") {
        let b = parts[4].to_string();
        if !is_valid_branch_name(&b) {
            return Err("Invalid branch name in URL".into());
        }
        Some(b)
    } else if parts.len() > 3 && parts[3] == "archive" {
        let b =
            if parts.len() > 6 && parts[4] == "refs" && (parts[5] == "heads" || parts[5] == "tags")
            {
                parts[6].to_string()
            } else {
                parts[4].to_string()
            };
        let b_clean = b.strip_suffix(".zip").unwrap_or(&b).to_string();
        if !is_valid_branch_name(&b_clean) {
            return Err("Invalid branch name in URL".into());
        }
        Some(b_clean)
    } else {
        None
    };
    Ok((owner, repo, branch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plain_repo_url() {
        let (owner, repo, branch) = parse_github_repo_url("https://github.com/owner/repo").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
        assert_eq!(branch, None);
    }

    #[test]
    fn test_http_scheme_allowed() {
        let (owner, repo, branch) = parse_github_repo_url("http://github.com/owner/repo").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
        assert_eq!(branch, None);
    }

    #[test]
    fn test_trailing_slash_trimmed() {
        let (owner, repo, _) = parse_github_repo_url("https://github.com/owner/repo/").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_git_suffix_trimmed() {
        let (_, repo, _) = parse_github_repo_url("https://github.com/owner/repo.git").unwrap();
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_missing_scheme_rejected() {
        let err = parse_github_repo_url("ftp://github.com/owner/repo").unwrap_err();
        assert_eq!(err, "GitHub URL must start with http:// or https://");
    }

    #[test]
    fn test_no_scheme_at_all_rejected() {
        let err = parse_github_repo_url("github.com/owner/repo").unwrap_err();
        assert_eq!(err, "GitHub URL must start with http:// or https://");
    }

    #[test]
    fn test_non_github_host_rejected() {
        let err = parse_github_repo_url("https://gitlab.com/owner/repo").unwrap_err();
        assert_eq!(err, "URL must be a github.com repository URL");
    }

    #[test]
    fn test_too_few_segments_rejected() {
        let err = parse_github_repo_url("https://github.com/owner").unwrap_err();
        assert_eq!(err, "URL must be a github.com repository URL");
    }

    #[test]
    fn test_tree_branch_parsed() {
        let (_, _, branch) =
            parse_github_repo_url("https://github.com/owner/repo/tree/main").unwrap();
        assert_eq!(branch, Some("main".to_string()));
    }

    #[test]
    fn test_blob_branch_parsed() {
        let (_, _, branch) =
            parse_github_repo_url("https://github.com/owner/repo/blob/dev").unwrap();
        assert_eq!(branch, Some("dev".to_string()));
    }

    #[test]
    fn test_tree_without_branch_segment_yields_none() {
        // parts.len() is only 4 here, so the `parts.len() > 4` tree/blob guard is false and
        // this falls through to the `None` branch rather than indexing an absent segment.
        let (_, _, branch) = parse_github_repo_url("https://github.com/owner/repo/tree").unwrap();
        assert_eq!(branch, None);
    }

    #[test]
    fn test_tree_invalid_branch_rejected() {
        let err =
            parse_github_repo_url("https://github.com/owner/repo/tree/feat..bad").unwrap_err();
        assert_eq!(err, "Invalid branch name in URL");
    }

    #[test]
    fn test_archive_zip_without_refs_parsed() {
        let (_, _, branch) =
            parse_github_repo_url("https://github.com/owner/repo/archive/main.zip").unwrap();
        assert_eq!(branch, Some("main".to_string()));
    }

    #[test]
    fn test_archive_refs_heads_parsed() {
        let (_, _, branch) =
            parse_github_repo_url("https://github.com/owner/repo/archive/refs/heads/feature-x.zip")
                .unwrap();
        assert_eq!(branch, Some("feature-x".to_string()));
    }

    #[test]
    fn test_archive_refs_tags_parsed() {
        let (_, _, branch) =
            parse_github_repo_url("https://github.com/owner/repo/archive/refs/tags/v1.0.zip")
                .unwrap();
        assert_eq!(branch, Some("v1.0".to_string()));
    }

    #[test]
    fn test_archive_invalid_branch_rejected() {
        let err =
            parse_github_repo_url("https://github.com/owner/repo/archive/-bad.zip").unwrap_err();
        assert_eq!(err, "Invalid branch name in URL");
    }

    #[test]
    fn test_archive_without_zip_suffix_still_parsed() {
        let (_, _, branch) =
            parse_github_repo_url("https://github.com/owner/repo/archive/refs/heads/main").unwrap();
        assert_eq!(branch, Some("main".to_string()));
    }
}
