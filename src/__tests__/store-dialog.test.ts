import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const mockInvoke = (globalThis as any).mockInvoke;

describe('Store Dialog', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    document.body.innerHTML = html;

    mockInvoke.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'load_settings') {
        return Promise.resolve({ path: 'C:\\wow', windowSize: '1280x720', stayOpen: false });
      }
      if (cmd === 'get_addons') {
        return Promise.resolve([]);
      }
      if (cmd === 'get_patches') {
        return Promise.resolve([]);
      }
      if (cmd === 'detect_game_version') {
        return Promise.resolve('3.3.5a');
      }
      if (cmd === 'search_curseforge_addons') {
        const query = args?.query ? decodeURIComponent(args.query) : '';
        if (query.toLowerCase().includes('error')) {
          return Promise.reject('CurseForge API returned status: 403 Forbidden');
        }
        return Promise.resolve({
          data: [
            {
              id: 10001,
              name: 'Questie',
              summary: 'Quest helper addon',
              logo: { thumbnailUrl: 'https://avatars.githubusercontent.com/u/15003504?s=200&v=4' },
              links: { websiteUrl: 'https://questie.com' },
              authors: [{ name: 'QuestieDevs' }],
            },
            {
              id: 10002,
              name: 'Deadly Boss Mods',
              summary: 'Boss mod addon',
              logo: { thumbnailUrl: 'https://avatars.githubusercontent.com/u/1183350?s=200&v=4' },
              links: { websiteUrl: 'https://dbm.com' },
              authors: [{ name: 'MysticalOS' }],
            },
          ],
        });
      }
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [
            {
              id: 100011,
              displayName: 'Questie-v3.3.5',
              fileName: 'Questie-v3.3.5.zip',
              releaseType: 1,
              downloadUrl: 'http://localhost:8080/addons/Questie-v3.3.5.zip',
              gameVersions: ['3.3.5'],
            },
            {
              id: 100012,
              displayName: 'Questie-v3.3.5-Beta',
              fileName: 'Questie-v3.3.5-Beta.zip',
              releaseType: 2,
              downloadUrl: 'http://localhost:8080/addons/Questie-v3.3.5-Beta.zip',
              gameVersions: ['3.3.5'],
            },
          ],
        });
      }
      if (cmd === 'get_curseforge_mod_description') {
        return Promise.resolve('<div>Detailed description of Questie</div>');
      }
      return Promise.resolve();
    });

    vi.resetModules();
    await import('../main');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('opens store modal on Get Addons click and queries CurseForge', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    const storeModal = document.getElementById('storeModal') as HTMLDivElement;

    expect(storeModal.classList.contains('hidden')).toBe(true);

    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    expect(storeModal.classList.contains('hidden')).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('search_curseforge_addons', {
      query: '',
      categoryId: null,
      gameVersion: '3.3.5a',
      isMock: false,
    });
  });

  it('renders store catalog elements correctly', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    const cards = document.querySelectorAll('.store-addon-card');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('h4')?.textContent).toBe('Questie');
    expect(cards[1].querySelector('h4')?.textContent).toBe('Deadly Boss Mods');
  });

  it('enables review button and updates selected count when a checkbox is checked', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    const firstCheckbox = document.querySelector('.store-addon-checkbox') as HTMLInputElement;
    const reviewBtn = document.getElementById('storeReviewBtn') as HTMLButtonElement;
    const selectedCount = document.getElementById('storeSelectedCount') as HTMLSpanElement;

    expect(firstCheckbox.checked).toBe(false);
    expect(reviewBtn.disabled).toBe(true);
    expect(selectedCount.textContent).toBe('0');

    firstCheckbox.checked = true;
    firstCheckbox.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 100));

    expect(reviewBtn.disabled).toBe(false);
    expect(selectedCount.textContent).toBe('1');
  });

  it('toggles tabs and updates site selection correctly', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    const githubTab = document.querySelector(
      '.store-sidebar-tab[data-site="github"]'
    ) as HTMLButtonElement;
    githubTab.click();
    await new Promise((r) => setTimeout(r, 100));

    expect(githubTab.classList.contains('active')).toBe(true);
  });

  it('triggers search with selected category ID when category selector changes', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    mockInvoke.mockClear();

    const categorySelect = document.getElementById('curseforgeCategorySelect') as HTMLSelectElement;
    categorySelect.value = '1067';
    categorySelect.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 100));

    expect(mockInvoke).toHaveBeenCalledWith('search_curseforge_addons', {
      query: '',
      categoryId: 1067,
      gameVersion: '3.3.5a',
      isMock: false,
    });
  });

  it('loads and displays details on card click, with version dropdown and select button', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    const card = document.querySelector('.store-addon-card') as HTMLDivElement;
    card.click();
    await new Promise((r) => setTimeout(r, 100));

    const detailsContent = document.getElementById('storeDetailsContent') as HTMLDivElement;
    expect(detailsContent.innerHTML).toContain('Detailed description of Questie');
    expect(detailsContent.innerHTML).toContain('QuestieDevs');

    const versionSelect = document.getElementById('detailVersionSelect') as HTMLSelectElement;
    expect(versionSelect).not.toBeNull();
    expect(versionSelect.options.length).toBe(2);

    const selectBtn = document.getElementById('detailSelectBtn') as HTMLButtonElement;
    expect(selectBtn.textContent?.trim()).toBe('Download');
  });

  it('closes store modal when clicking the backdrop', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    const storeModal = document.getElementById('storeModal') as HTMLDivElement;

    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 100));
    expect(storeModal.classList.contains('hidden')).toBe(false);

    storeModal.click();
    expect(storeModal.classList.contains('hidden')).toBe(true);
  });

  it('clears search input when clear button is clicked', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    const searchInput = document.getElementById('storeSearchInput') as HTMLInputElement;
    const clearBtn = document.getElementById('storeSearchClearBtn') as HTMLButtonElement;

    searchInput.value = 'Questie';
    searchInput.dispatchEvent(new Event('input'));
    expect(clearBtn.classList.contains('hidden')).toBe(false);

    clearBtn.click();
    expect(searchInput.value).toBe('');
    expect(clearBtn.classList.contains('hidden')).toBe(true);
  });

  it('displays user-friendly configuration hint on CurseForge 403 Forbidden search error', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    const curseforgeTab = document.querySelector(
      '.store-sidebar-tab[data-site="curseforge"]'
    ) as HTMLButtonElement;
    curseforgeTab?.click();
    await new Promise((r) => setTimeout(r, 100));

    const searchInput = document.getElementById('storeSearchInput') as HTMLInputElement;
    searchInput.value = 'error';
    searchInput.dispatchEvent(new Event('input'));

    await new Promise((r) => setTimeout(r, 500));

    const storeList = document.getElementById('storeListContainer') as HTMLDivElement;
    expect(storeList.textContent).toContain('verify that a valid CurseForge API Key is configured');
  });

  it('toggles selection button state when "Select mod for download" is clicked', async () => {
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    const card = document.querySelector('.store-addon-card') as HTMLDivElement;
    card.click();
    await new Promise((r) => setTimeout(r, 100));

    const selectBtn = document.getElementById('detailSelectBtn') as HTMLButtonElement;
    expect(selectBtn.textContent?.trim()).toBe('Download');

    selectBtn.click();
    await new Promise((r) => setTimeout(r, 100));
    expect(selectBtn.textContent?.trim()).toBe('Queued');

    selectBtn.click();
    await new Promise((r) => setTimeout(r, 100));
    expect(selectBtn.textContent?.trim()).toBe('Download');
  });
});
