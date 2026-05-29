import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const mockInvoke = (globalThis as any).mockInvoke;

// Mock global fetch
const mockFetch = vi.fn();

describe('GitHub Addon Provider', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    mockFetch.mockReset();

    mockInvoke.mockImplementation((cmd: any) => {
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

    // Set up the DOM from index.html
    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    document.body.innerHTML = html;

    // Default mock fetch implementations
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
        // repo meta fallback mock
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

    // Verify tag filters container is visible
    const tagFilters = document.getElementById('githubTagFilters') as HTMLDivElement;
    expect(tagFilters).not.toBeNull();
    expect(tagFilters.classList.contains('hidden')).toBe(false);

    // Verify search is initiated with topic:wotlk sorted by stars
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('search/repositories?q=topic%3Awotlk')
    );
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('sort=stars&order=desc'));

    const cards = document.querySelectorAll('.store-addon-card');
    expect(cards.length).toBe(1); // Questie (mocked search response)
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
    // Wait for 400ms debounce + search promise
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

    // Clear call history of mockFetch to isolate the pill click trigger
    mockFetch.mockClear();

    // Click the warcraft pill (which is inactive by default) to activate it
    const warcraftPill = document.querySelector(
      '.github-tag-pill[data-tag="warcraft"]'
    ) as HTMLButtonElement;
    expect(warcraftPill).not.toBeNull();
    warcraftPill.click();
    await new Promise((r) => setTimeout(r, 50));

    // Check that it's marked active and styles are updated
    expect(warcraftPill.classList.contains('active')).toBe(true);

    // Verify it triggers fetch with 'warcraft' included
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
    // Override fetch to return release without assets
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
                assets: [], // empty assets
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
});
