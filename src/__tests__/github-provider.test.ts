import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from 'vitest';
import fs from 'fs';
import path from 'path';

const mockInvoke = (globalThis as unknown as { mockInvoke: Mock }).mockInvoke;

const mockFetch = vi.fn();

describe('GitHub Addon Provider', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    mockFetch.mockReset();

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_settings') {
        return Promise.resolve({ path: 'C:\\wow', windowSize: '1280x720', stayOpen: false });
      }
      if (cmd === 'get_addons' || cmd === 'get_patches') {
        return Promise.resolve([]);
      }
      if (cmd === 'search_curseforge_addons') {
        return Promise.resolve({ data: [] });
      }
      if (cmd === 'detect_game_version') {
        return Promise.resolve('3.3.5a');
      }
      return Promise.resolve();
    });

    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    document.body.innerHTML = html;

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.github.com/search/repositories')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                {
                  id: 99001,
                  name: 'Questie',
                  full_name: 'Questie/Questie',
                  description: 'Questie addon on GitHub',
                  html_url: 'https://github.com/Questie/Questie',
                  owner: {
                    login: 'Questie',
                    avatar_url: 'https://avatars.githubusercontent.com/u/75445548?v=4',
                  },
                },
              ],
            }),
        });
      }
      if (url.includes('/releases')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 990011,
                name: 'Questie v3.7.2',
                tag_name: 'v3.7.2',
                prerelease: false,
                assets: [
                  {
                    id: 9900111,
                    name: 'Questie-3.7.2.zip',
                    browser_download_url:
                      'https://github.com/Questie/Questie/releases/download/v3.7.2/Questie-3.7.2.zip',
                  },
                ],
              },
            ]),
        });
      }
      if (url.includes('/readme')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('<div>Rendered README Content from GitHub</div>'),
        });
      }
      if (url.match(/api\.github\.com\/repos\/[^/]+\/[^/]+$/)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ default_branch: 'main' }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });
    });

    vi.resetModules();
    await import('../main');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('switches to GitHub tab, shows tag filters, and shows starred addons when query is empty', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 50));

    const githubTab = document.querySelector(
      '.store-sidebar-tab[data-site="github"]'
    ) as HTMLButtonElement;
    expect(githubTab).not.toBeNull();

    githubTab.click();
    await new Promise((r) => setTimeout(r, 50));

    expect(githubTab.classList.contains('active')).toBe(true);

    const tagFilters = document.getElementById('githubTagFilters') as HTMLDivElement;
    expect(tagFilters).not.toBeNull();
    expect(tagFilters.classList.contains('hidden')).toBe(false);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('search/repositories?q=topic%3Awotlk')
    );
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('sort=stars&order=desc'));

    const cards = document.querySelectorAll('.store-addon-card');
    expect(cards.length).toBe(1);
    expect(cards[0].querySelector('h4')?.textContent).toBe('Questie');
  });

  it('queries GitHub Search API sorted by stars when search query is typed', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 50));

    const githubTab = document.querySelector(
      '.store-sidebar-tab[data-site="github"]'
    ) as HTMLButtonElement;
    githubTab.click();
    await new Promise((r) => setTimeout(r, 50));

    const searchInput = document.getElementById('storeSearchInput') as HTMLInputElement;
    searchInput.value = 'Questie';
    searchInput.dispatchEvent(new Event('input'));

    await new Promise((r) => setTimeout(r, 500));

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('search/repositories?q=Questie%20(topic%3Awotlk)')
    );
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('sort=stars&order=desc'));

    const cards = document.querySelectorAll('.store-addon-card');
    expect(cards.length).toBe(1);
    expect(cards[0].querySelector('h4')?.textContent).toBe('Questie');
  });

  it('toggles tag pills and queries GitHub API with updated search topics', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 50));

    const githubTab = document.querySelector(
      '.store-sidebar-tab[data-site="github"]'
    ) as HTMLButtonElement;
    githubTab.click();
    await new Promise((r) => setTimeout(r, 50));

    mockFetch.mockClear();

    const warcraftPill = document.querySelector(
      '.github-tag-pill[data-tag="warcraft"]'
    ) as HTMLButtonElement;
    expect(warcraftPill).not.toBeNull();
    warcraftPill.click();
    await new Promise((r) => setTimeout(r, 50));

    expect(warcraftPill.classList.contains('active')).toBe(true);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('topic%3Awotlk%20OR%20topic%3Awarcraft')
    );
  });

  it('loads GitHub details (README HTML and Releases) on card click', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 50));

    const githubTab = document.querySelector(
      '.store-sidebar-tab[data-site="github"]'
    ) as HTMLButtonElement;
    githubTab.click();
    await new Promise((r) => setTimeout(r, 50));

    const card = document.querySelector('.store-addon-card') as HTMLDivElement;
    card.click();
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('Questie/Questie/releases'));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('Questie/Questie/readme'),
      expect.any(Object)
    );

    const detailsContent = document.getElementById('storeDetailsContent') as HTMLDivElement;
    expect(detailsContent.innerHTML).toContain('Rendered README Content from GitHub');

    const versionSelect = document.getElementById('detailVersionSelect') as HTMLSelectElement;
    expect(versionSelect).not.toBeNull();
    expect(versionSelect.options[0].text).toContain('Questie v3.7.2 - Questie-3.7.2.zip');
  });

  it('falls back to tag or branch zip if release has no built assets', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.github.com/search/repositories')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                {
                  id: 99001,
                  name: 'Questie',
                  full_name: 'Questie/Questie',
                  description: 'Questie addon on GitHub',
                  html_url: 'https://github.com/Questie/Questie',
                  owner: {
                    login: 'Questie',
                    avatar_url: 'https://avatars.githubusercontent.com/u/75445548?v=4',
                  },
                },
              ],
            }),
        });
      }
      if (url.includes('/releases')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 990011,
                name: 'Questie v3.7.2',
                tag_name: 'v3.7.2',
                prerelease: false,
                assets: [],
              },
            ]),
        });
      }
      if (url.includes('/readme')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('<div>Readme</div>'),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 50));

    const githubTab = document.querySelector(
      '.store-sidebar-tab[data-site="github"]'
    ) as HTMLButtonElement;
    githubTab.click();
    await new Promise((r) => setTimeout(r, 50));

    const card = document.querySelector('.store-addon-card') as HTMLDivElement;
    card.click();
    await new Promise((r) => setTimeout(r, 50));

    const versionSelect = document.getElementById('detailVersionSelect') as HTMLSelectElement;
    expect(versionSelect.options[0].text).toContain('Questie v3.7.2 (Source Code)');
    expect(versionSelect.value).toBe(
      'https://github.com/Questie/Questie/archive/refs/tags/v3.7.2.zip'
    );
  });

  it('selects and deselects GitHub addon for download correctly', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 50));

    const githubTab = document.querySelector(
      '.store-sidebar-tab[data-site="github"]'
    ) as HTMLButtonElement;
    githubTab.click();
    await new Promise((r) => setTimeout(r, 50));

    const firstCheckbox = document.querySelector('.store-addon-checkbox') as HTMLInputElement;
    const selectedCount = document.getElementById('storeSelectedCount') as HTMLSpanElement;

    expect(firstCheckbox.checked).toBe(false);
    expect(selectedCount.textContent).toBe('0');

    firstCheckbox.checked = true;
    firstCheckbox.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 50));

    expect(selectedCount.textContent).toBe('1');

    firstCheckbox.checked = false;
    firstCheckbox.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 50));

    expect(selectedCount.textContent).toBe('0');
  });

  it('covers getReleaseTypeName edge cases', async () => {
    const { getReleaseTypeName } = await import('../store/github');
    expect(getReleaseTypeName(3)).toBe('Alpha');
    expect(getReleaseTypeName(99)).toBe('Unknown');
  });

  it('covers fetchGithubReleases when releases are empty or network fails', async () => {
    const { fetchGithubReleases } = await import('../store/github');

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/releases')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.match(/api\.github\.com\/repos\/[^/]+\/[^/]+$/)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ default_branch: 'develop' }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const res1 = await fetchGithubReleases('Questie/Questie');
    expect(res1[0].displayName).toBe('Questie (Source Code: develop)');

    mockFetch.mockRejectedValue(new Error('Network error'));
    const res2 = await fetchGithubReleases('Questie/Questie');
    expect(res2[0].displayName).toBe('Questie (Source Code: master)');
  });

  it('covers searchGithubApi failures', async () => {
    const { searchGithubApi } = await import('../store/github');
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
    await expect(searchGithubApi('q')).rejects.toThrow(
      'GitHub API returned status: 500 Internal Server Error'
    );
  });

  it('covers fetchGithubReleases when releases call returns non-ok status', async () => {
    const { fetchGithubReleases } = await import('../store/github');
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/releases')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (url.match(/api\.github\.com\/repos\/[^/]+\/[^/]+$/)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ default_branch: 'master-branch' }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const res = await fetchGithubReleases('Questie/Questie');
    expect(res[0].displayName).toBe('Questie (Source Code: master-branch)');
  });

  it('covers searchGithubApi when items are missing', async () => {
    const { searchGithubApi } = await import('../store/github');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const res = await searchGithubApi('test');
    expect(res).toEqual([]);
  });

  it('covers fetchGithubReleases when releases fail and repo detail fails or missing default_branch', async () => {
    const { fetchGithubReleases } = await import('../store/github');

    // 1. releases fail, repo metadata query fails (repoRes.ok = false)
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/releases')) return Promise.resolve({ ok: false, status: 404 });
      if (url.match(/api\.github\.com\/repos\/[^/]+\/[^/]+$/))
        return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: false });
    });
    let res = await fetchGithubReleases('Questie/Questie');
    expect(res[0].displayName).toBe('Questie (Source Code: master)');

    // 2. releases fail, repo metadata succeeds but default_branch is missing
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/releases')) return Promise.resolve({ ok: false, status: 404 });
      if (url.match(/api\.github\.com\/repos\/[^/]+\/[^/]+$/)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({ ok: false });
    });
    res = await fetchGithubReleases('Questie/Questie');
    expect(res[0].displayName).toBe('Questie (Source Code: master)');
  });

  it('covers fetchGithubReleases releaseName fallback, asset prerelease, 7z assets, and prerelease fallback', async () => {
    const { fetchGithubReleases } = await import('../store/github');

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/releases')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                name: null, // trigger rel.tag_name fallback
                tag_name: 'v1.0.0',
                prerelease: true, // trigger prerelease type
                assets: [
                  {
                    id: 11,
                    name: 'file.7z', // trigger .7z match
                    browser_download_url: 'dl-7z',
                  },
                  {
                    id: 12,
                    name: 'file.txt', // trigger non-zip/7z filter branch
                    browser_download_url: 'dl-txt',
                  },
                ],
              },
              {
                id: 2,
                name: 'v2.0.0',
                tag_name: 'v2.0.0',
                prerelease: true,
                assets: [], // trigger fallback tag zip with prerelease true
              },
            ]),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const res = await fetchGithubReleases('Questie/Questie');
    expect(res.length).toBe(2);
    expect(res[0].displayName).toContain('v1.0.0');
    expect(res[0].releaseType).toBe(2); // Beta/Prerelease
    expect(res[1].releaseType).toBe(2); // Beta/Prerelease
  });

  it('covers fetchGithubReleases when releases succeeds but is empty and repoRes metadata fails or has missing default_branch', async () => {
    const { fetchGithubReleases } = await import('../store/github');

    // 1. releases is empty array, repoRes fails
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/releases'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      if (url.match(/api\.github\.com\/repos\/[^/]+\/[^/]+$/))
        return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: false });
    });
    let res = await fetchGithubReleases('Questie/Questie');
    expect(res[0].displayName).toBe('Questie (Source Code: master)');

    // 2. releases is empty array, repoRes succeeds but default_branch is missing
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/releases'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      if (url.match(/api\.github\.com\/repos\/[^/]+\/[^/]+$/)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({ ok: false });
    });
    res = await fetchGithubReleases('Questie/Questie');
    expect(res[0].displayName).toBe('Questie (Source Code: master)');
  });

  it('covers searchGithubApi mapper fallback paths (missing description, owner, html_url, has_issues)', async () => {
    const { searchGithubApi } = await import('../store/github');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              id: 123,
              name: 'RepoName',
              full_name: 'owner/RepoName',
              description: null, // missing description
              owner: undefined, // missing owner info
              html_url: '', // empty html_url
              has_issues: false, // has_issues is false
            },
            {
              id: 124,
              name: 'RepoWithIssues',
              full_name: 'owner/RepoWithIssues',
              description: 'Desc',
              owner: { login: 'owner', avatar_url: 'avatar' },
              html_url: 'https://github.com/owner/RepoWithIssues',
              has_issues: true, // has_issues is true
            },
          ],
        }),
    });

    const res = await searchGithubApi('test');
    expect(res.length).toBe(2);
    expect(res[0].description).toBe('No description provided.');
    expect(res[0].logoUrl).toBe('');
    expect(res[0].authors).toBe('Unknown');
    expect(res[0].websiteUrl).toBe('');
    expect(res[0].issuesUrl).toBe('');

    expect(res[1].issuesUrl).toBe('https://github.com/owner/RepoWithIssues/issues');
  });
});
