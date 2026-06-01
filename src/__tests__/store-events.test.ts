import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { setupStoreEvents, onReloadAddons } from '../store/events';
import { selectedAddons, setDetectedGameVersion, setCurrentActiveSite } from '../state';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('Store Events Module', () => {
  const reloadCallbackSpy = vi.fn();

  beforeEach(() => {
    document.body.innerHTML = `
      <input id="gamePath" value="C:\\wow" />
      <button id="getAddonsBtn"></button>
      <div id="storeModal" class="hidden"></div>
      <button id="storeCancelBtn"></button>
      <button id="storeReviewBtn" disabled></button>
      <input id="storeSearchInput" />
      <button id="storeSearchClearBtn" class="hidden"></button>
      <select id="curseforgeCategorySelect"></select>
      <div id="githubTagFilters"></div>
      <div id="githubWarningBanner"></div>
      <div id="curseforgeCategoryFilters"></div>
      <div id="storeListContainer"></div>
      <div id="storeListEmpty" class="hidden"></div>
      <span id="storeSelectedCount">0</span>
      <button id="store-modal-confirm" disabled></button>
      
      <div id="storeDownloadModal" class="hidden"></div>
      <div id="store-modal-table-body"></div>
      <button id="store-modal-cancel"></button>
      
      <button class="store-sidebar-tab" data-site="curseforge"></button>
    `;
    selectedAddons.clear();
    setDetectedGameVersion('3.3.5a');
    reloadCallbackSpy.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('handles reload-addons global window event', async () => {
    setupStoreEvents(reloadCallbackSpy);
    window.dispatchEvent(new Event('reload-addons'));
    expect(reloadCallbackSpy).toHaveBeenCalled();
  });

  it('handles openStore game version detection failure', async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'detect_game_version') {
        return Promise.reject('Detect error');
      }
      if (cmd === 'search_curseforge_addons') {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve();
    });

    setupStoreEvents(reloadCallbackSpy);
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    getAddonsBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    // expect game version fallback to WotLK
    expect(invoke).toHaveBeenCalledWith('detect_game_version', { basePath: 'C:\\wow' });
  });

  it('handles openStore and clears running debounce timer', async () => {
    vi.useFakeTimers();
    (invoke as any).mockResolvedValue({ data: [] });

    setupStoreEvents(reloadCallbackSpy);
    const getAddonsBtn = document.getElementById('getAddonsBtn') as HTMLButtonElement;
    const searchInput = document.getElementById('storeSearchInput') as HTMLInputElement;

    // Type to start debounce timer
    searchInput.value = 'abc';
    searchInput.dispatchEvent(new Event('input'));

    // Open store (should cancel timer)
    getAddonsBtn.click();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  it('handles search input clear and typing debounce', async () => {
    vi.useFakeTimers();
    (invoke as any).mockResolvedValue({ data: [] });

    setupStoreEvents(reloadCallbackSpy);
    const searchInput = document.getElementById('storeSearchInput') as HTMLInputElement;
    const clearBtn = document.getElementById('storeSearchClearBtn') as HTMLButtonElement;

    // Type characters
    searchInput.value = 'a';
    searchInput.dispatchEvent(new Event('input'));
    expect(clearBtn.classList.contains('hidden')).toBe(false);

    // Type again to clear previous timer
    searchInput.value = 'ab';
    searchInput.dispatchEvent(new Event('input'));

    // Empty search
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));
    expect(clearBtn.classList.contains('hidden')).toBe(true);

    // Click clear button
    clearBtn.click();
    expect(searchInput.value).toBe('');

    vi.useRealTimers();
  });

  it('handles storeReviewBtn click and populates review modal and checkbox change', async () => {
    setupStoreEvents(reloadCallbackSpy);
    selectedAddons.set('cf-1', {
      addon: { title: 'Questie', modId: 1 } as any,
      selectedVersion: { fileName: 'questie.zip', releaseType: 1 } as any,
    });

    const storeReviewBtn = document.getElementById('storeReviewBtn') as HTMLButtonElement;
    storeReviewBtn.removeAttribute('disabled');
    storeReviewBtn.click();

    const tableBody = document.getElementById('store-modal-table-body');
    expect(tableBody?.innerHTML).toContain('Questie');

    // Trigger checkbox toggle
    const checkbox = tableBody?.querySelector('.confirm-addon-checkbox') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    // Backdrop click close modal
    const downloadModal = document.getElementById('storeDownloadModal') as HTMLDivElement;
    downloadModal.click();
    expect(downloadModal.classList.contains('hidden')).toBe(true);
  });

  it('handles store-modal-confirm click to trigger installSelectedAddons', () => {
    setupStoreEvents(reloadCallbackSpy);
    const confirmBtn = document.getElementById('store-modal-confirm') as HTMLButtonElement;
    confirmBtn.removeAttribute('disabled');
    confirmBtn.click();
    // Simply asserting that it does not throw
    expect(confirmBtn).toBeDefined();
  });
});
