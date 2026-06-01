import { CatalogAddon, AddonVersion, GitHubRelease, GitHubRepository } from '../types';
import { getTranslation } from '../i18n/index';
import { getDetectedGameVersion } from '../state';

export function getReleaseTypeName(type: number): string {
  switch (type) {
    case 1:
      return getTranslation('store.releaseType.release');
    case 2:
      return getTranslation('store.releaseType.beta');
    case 3:
      return getTranslation('store.releaseType.alpha');
    default:
      return getTranslation('store.releaseType.unknown');
  }
}

export async function fetchGithubReleases(repoFullName: string): Promise<AddonVersion[]> {
  const parts = repoFullName.split('/');
  const owner = parts[0];
  const repo = parts[1] || repoFullName;
  const url = `https://api.github.com/repos/${owner}/${repo}/releases`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
      let defaultBranch = 'master';
      if (repoRes.ok) {
        const repoJson = await repoRes.json();
        defaultBranch = repoJson.default_branch || 'master';
      }
      return [
        {
          id: 0,
          displayName: `${repo} (Source Code: ${defaultBranch})`,
          fileName: `${repo}-${defaultBranch}.zip`,
          releaseType: 1,
          downloadUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/${defaultBranch}.zip`,
          gameVersions: [getDetectedGameVersion()],
        },
      ];
    }

    const json = (await res.json()) as GitHubRelease[];
    const versions: AddonVersion[] = [];

    json.forEach((rel) => {
      const releaseName = rel.name || rel.tag_name;
      let hasZip = false;
      if (rel.assets && rel.assets.length > 0) {
        rel.assets.forEach((asset) => {
          if (
            asset.name.toLowerCase().endsWith('.zip') ||
            asset.name.toLowerCase().endsWith('.7z')
          ) {
            versions.push({
              id: asset.id,
              displayName: `${releaseName} - ${asset.name}`,
              fileName: asset.name,
              releaseType: rel.prerelease ? 2 : 1,
              downloadUrl: asset.browser_download_url,
              gameVersions: [getDetectedGameVersion()],
            });
            hasZip = true;
          }
        });
      }

      if (!hasZip) {
        versions.push({
          id: rel.id,
          displayName: `${releaseName} (Source Code)`,
          fileName: `${rel.tag_name}.zip`,
          releaseType: rel.prerelease ? 2 : 1,
          downloadUrl: `https://github.com/${owner}/${repo}/archive/refs/tags/${rel.tag_name}.zip`,
          gameVersions: [getDetectedGameVersion()],
        });
      }
    });

    if (versions.length === 0) {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
      let defaultBranch = 'master';
      if (repoRes.ok) {
        const repoJson = await repoRes.json();
        defaultBranch = repoJson.default_branch || 'master';
      }
      versions.push({
        id: 0,
        displayName: `${repo} (Source Code: ${defaultBranch})`,
        fileName: `${repo}-${defaultBranch}.zip`,
        releaseType: 1,
        downloadUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/${defaultBranch}.zip`,
        gameVersions: [getDetectedGameVersion()],
      });
    }

    return versions;
  } catch {
    return [
      {
        id: 0,
        displayName: `${repo} (Source Code: master)`,
        fileName: `${repo}-master.zip`,
        releaseType: 1,
        downloadUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/master.zip`,
        gameVersions: [getDetectedGameVersion()],
      },
    ];
  }
}

export async function searchGithubApi(q: string): Promise<CatalogAddon[]> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GitHub API returned status: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { items?: GitHubRepository[] };
  const items = data.items || [];

  return items.map((item) => ({
    name: item.full_name,
    title: item.name,
    description: item.description || 'No description provided.',
    modId: item.id,
    logoUrl: item.owner?.avatar_url || '',
    authors: item.owner?.login || 'Unknown',
    websiteUrl: item.html_url || '',
    issuesUrl: item.has_issues ? `${item.html_url}/issues` : '',
    sourceUrl: item.html_url || '',
    donationUrl: '',
  }));
}
