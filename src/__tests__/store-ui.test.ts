import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  triggerSearch,
  switchSiteTab,
  searchCurseForge,
  searchGithub,
  renderGithubTagFilters,
  updateFooterState,
  updateConfirmButtonState,
} from '../store/ui';
import {
  selectedAddons,
  setCurrentActiveSite,
  getCurrentActiveSite,
  setDetectedGameVersion,
} from '../state';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockFetch = vi.fn();

describe('Store UI Module', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    selectedAddons.clear();
    setCurrentActiveSite('curseforge');
    setDetectedGameVersion('3.3.5a');

    document.body.innerHTML = `
      <input id="storeSearchInput" value="" />
      <button id="storeSearchClearBtn" class="hidden"></button>
      <div id="githubTagFilters" class="hidden"></div>
      <div id="githubWarningBanner" class="hidden"></div>
      <div id="curseforgeCategoryFilters" class="hidden"></div>
      <select id="curseforgeCategorySelect">
        <option value=""></option>
        <option value="123">Quest</option>
      </select>
      <div id="storeListContainer"></div>
      <div id="storeListEmpty" class="hidden"></div>
      <span id="storeSelectedCount">0</span>
      <button id="storeReviewBtn" disabled></button>
      <button id="store-modal-confirm" disabled></button>
      
      <button class="store-sidebar-tab" data-site="curseforge"></button>
      <button class="store-sidebar-tab" data-site="github"></button>

      <button class="github-tag-pill active" data-tag="wotlk">wotlk</button>
      <button class="github-tag-pill" data-tag="warcraft">warcraft</button>
      
      <input type="checkbox" class="confirm-addon-checkbox" checked />
    `;
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('triggerSearch triggers search correctly based on active site', () => {
    const input = document.getElementById('storeSearchInput') as HTMLInputElement;
    input.value = 'Questie';

    // CurseForge site
    (invoke as any).mockResolvedValue({ data: [] });
    triggerSearch();
    expect(invoke).toHaveBeenCalled();

    // GitHub site
    setCurrentActiveSite('github');
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) });
    triggerSearch();
    expect(mockFetch).toHaveBeenCalled();
  });

  it('switchSiteTab toggles correct UI classes and filters', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) });
    (invoke as any).mockResolvedValue({ data: [] });

    switchSiteTab('github');
    expect(getCurrentActiveSite()).toBe('github');
    expect(document.getElementById('githubTagFilters')?.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('githubWarningBanner')?.classList.contains('hidden')).toBe(
      false
    );

    switchSiteTab('curseforge');
    expect(getCurrentActiveSite()).toBe('curseforge');
    expect(document.getElementById('curseforgeCategoryFilters')?.classList.contains('hidden')).toBe(
      false
    );
  });

  it('searchCurseForge handles data rendering and API errors', async () => {
    const list = document.getElementById('storeListContainer') as HTMLDivElement;

    // Error scenario
    (invoke as any).mockRejectedValue('Forbidden 403 error');
    await searchCurseForge('err');
    expect(list.innerHTML).toContain('Access denied by CurseForge');

    // Success with empty mods
    (invoke as any).mockResolvedValue({ data: [] });
    await searchCurseForge('');
    expect(document.getElementById('storeListEmpty')?.classList.contains('hidden')).toBe(false);

    // Success with items
    (invoke as any).mockResolvedValue({
      data: [{ id: 101, name: 'Questie', summary: 'Quest helper', logo: { thumbnailUrl: 'url' } }],
    });
    await searchCurseForge('quest');
    expect(list.innerHTML).toContain('Questie');
  });

  it('searchGithub handles api errors and results rendering', async () => {
    const list = document.getElementById('storeListContainer') as HTMLDivElement;

    // Error scenario
    mockFetch.mockRejectedValue(new Error('Network failure'));
    await searchGithub('err');
    expect(list.innerHTML).toContain('Failed to query GitHub API');

    // Success with empty items
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) });
    await searchGithub('');
    expect(document.getElementById('storeListEmpty')?.classList.contains('hidden')).toBe(false);

    // Success with items
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              id: 99,
              name: 'Questie',
              full_name: 'Q/Q',
              description: 'Helper',
              owner: { avatar_url: 'avatar', login: 'Q' },
              html_url: 'url',
            },
          ],
        }),
    });
    await searchGithub('test');
    expect(list.innerHTML).toContain('Questie');
  });

  it('renderGithubTagFilters renders tag pills and handles click triggers', () => {
    // classic game version
    setDetectedGameVersion('1.12.1');
    renderGithubTagFilters();
    expect(document.getElementById('githubTagFilters')?.innerHTML).toContain('vanilla-wow');

    // WotLK version
    setDetectedGameVersion('3.3.5a');
    renderGithubTagFilters();
    expect(document.getElementById('githubTagFilters')?.innerHTML).toContain('wotlk');

    const wotlkPill = document.querySelector('.github-tag-pill') as HTMLButtonElement;
    expect(wotlkPill.classList.contains('active')).toBe(true);

    // click to toggle inactive
    wotlkPill.click();
    expect(wotlkPill.classList.contains('active')).toBe(false);

    // click to toggle active
    wotlkPill.click();
    expect(wotlkPill.classList.contains('active')).toBe(true);
  });

  it('updateFooterState and updateConfirmButtonState update button disabled properties', () => {
    // updateFooterState
    selectedAddons.set('cf-1', {} as any);
    updateFooterState();
    expect(document.getElementById('storeSelectedCount')?.textContent).toBe('1');
    expect((document.getElementById('storeReviewBtn') as HTMLButtonElement).disabled).toBe(false);

    // updateConfirmButtonState
    const confirm = document.getElementById('store-modal-confirm') as HTMLButtonElement;
    updateConfirmButtonState();
    expect(confirm.disabled).toBe(false);
  });

  it('searchGithub covers empty tag fallback and non-ok status responses', async () => {
    // 1. Empty tags vanilla-wow
    setDetectedGameVersion('1.12.1');
    document.querySelectorAll('.github-tag-pill').forEach((el) => el.classList.remove('active'));

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    await searchGithub('q');
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('topic%3Avanilla-wow'));

    // 2. non-ok response
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Rate Limit',
    });

    await searchGithub('q');
    const list = document.getElementById('storeListContainer') as HTMLDivElement;
    expect(list.innerHTML).toContain('Rate Limit');
  });

  it('covers remaining store ui branches (missing elements, missing properties, other errors)', async () => {
    // 1. switchSiteTab with missing input/warning elements in DOM
    document.body.innerHTML = '';
    switchSiteTab('github'); // shouldn't crash

    // 2. searchCurseForge with missing elements, undefined data, empty logo, undefined authors, undefined links
    document.body.innerHTML = '';
    await searchCurseForge(''); // exits early if storeList missing

    document.body.innerHTML = `
      <div id="storeListContainer"></div>
    `;
    // response.data is undefined
    (invoke as any).mockResolvedValueOnce({});
    await searchCurseForge('');

    // mod has no summary, logo, authors, links
    (invoke as any).mockResolvedValueOnce({
      data: [{ id: 102, name: 'ModNoProps' }],
    });
    await searchCurseForge('');

    // non-403 error for CurseForge friendly message
    (invoke as any).mockRejectedValueOnce('Some standard connection error');
    await searchCurseForge('');
    expect(document.getElementById('storeListContainer')?.innerHTML).toContain(
      'Failed to query CurseForge'
    );

    // 3. searchGithub with missing storeList, undefined items, missing description, owner, html_url
    document.body.innerHTML = '';
    await searchGithub(''); // exits early

    document.body.innerHTML = `
      <div id="storeListContainer"></div>
    `;
    // json.items is undefined
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });
    await searchGithub('');

    // items have missing description, owner, html_url
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [{ id: 103, name: 'RepoNoProps', full_name: 'owner/RepoNoProps' }],
        }),
    });
    await searchGithub('');

    // 4. renderGithubTagFilters when container is missing
    document.body.innerHTML = '';
    renderGithubTagFilters(); // should return

    // 5. updateFooterState and updateConfirmButtonState with missing elements
    document.body.innerHTML = '';
    updateFooterState();
    updateConfirmButtonState();
  });
});
