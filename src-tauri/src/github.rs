use crate::git::is_valid_branch_name;
pub fn parse_github_repo_url(repo_url: &str) -> std::result::Result<(String, String, Option<String>), String> {
    let repo_url = repo_url.trim().trim_end_matches('/');
    let repo_url = repo_url.strip_prefix("https://").or_else(|| repo_url.strip_prefix("http://")).ok_or("GitHub URL must start with http:// or https://")?;
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
        let b = if parts.len() > 6 && parts[4] == "refs" && (parts[5] == "heads" || parts[5] == "tags") {
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

