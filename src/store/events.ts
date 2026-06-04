import { invoke } from '@tauri-apps/api/core';
import { escapeHtml } from '../utils';
import {
  selectedAddons,
  setCurrentActiveSite,
  setDetectedGameVersion,
  setInstalledAddonsMeta,
} from '../state';
import { InstalledAddonSourceMeta } from '../types';
import { getReleaseTypeName } from './github';
import { installSelectedAddons } from './download';
import {
  updateFooterState,
  updateConfirmButtonState,
  switchSiteTab,
  triggerSearch,
  renderGithubTagFilters,
} from './ui';

const gamePathInput = () => document.getElementById('gamePath') as HTMLInputElement;

export let onReloadAddons: () => Promise<void>;
window.addEventListener('reload-addons', () => {
  if (onReloadAddons) onReloadAddons();
});

declare global {
  interface Window {
    __openStoreListener?: () => Promise<void>;
  }
}

export function setupStoreEvents(reloadCallback: () => Promise<void>) {
  onReloadAddons = reloadCallback;
  const getAddonsBtn = document.getElementById('getAddonsBtn');
  const storeModal = document.getElementById('storeModal');
  const storeCancelBtn = document.getElementById('storeCancelBtn');
  const storeReviewBtn = document.getElementById('storeReviewBtn') as HTMLButtonElement | null;
  const storeSearchInput = document.getElementById('storeSearchInput') as HTMLInputElement | null;
  const storeSearchClearBtn = document.getElementById(
    'storeSearchClearBtn'
  ) as HTMLButtonElement | null;
  const storeSidebarTabs = document.querySelectorAll('.store-sidebar-tab');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const openStore = async () => {
    storeModal?.classList.remove('hidden');
    selectedAddons.clear();
    updateFooterState();

    setCurrentActiveSite('curseforge');
    if (storeSearchInput) {
      storeSearchInput.value = '';
      storeSearchClearBtn?.classList.add('hidden');
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    try {
      setDetectedGameVersion(
        await invoke<string>('detect_game_version', {
          basePath: gamePathInput().value,
        })
      );
    } catch (err) {
      console.error('Failed to detect game version:', err);
      setDetectedGameVersion('3.3.5a');
    }

    try {
      const installedMeta = await invoke<InstalledAddonSourceMeta[]>(
        'get_installed_addons_source_meta',
        {
          basePath: gamePathInput().value,
        }
      );
      setInstalledAddonsMeta(installedMeta);
    } catch (err) {
      console.error('Failed to get installed addons meta:', err);
      setInstalledAddonsMeta([]);
    }
    renderGithubTagFilters();
    switchSiteTab('curseforge');
  };

  getAddonsBtn?.addEventListener('click', openStore);
  if (window.__openStoreListener) {
    window.removeEventListener('open-store', window.__openStoreListener);
  }
  window.__openStoreListener = openStore;
  window.addEventListener('open-store', openStore);

  const closeStore = () => {
    storeModal?.classList.add('hidden');
  };
  storeCancelBtn?.addEventListener('click', closeStore);

  storeModal?.addEventListener('click', (e) => {
    if (e.target === storeModal) {
      closeStore();
    }
  });

  storeSearchInput?.addEventListener('input', () => {
    if (storeSearchInput.value.trim().length > 0) {
      storeSearchClearBtn?.classList.remove('hidden');
    } else {
      storeSearchClearBtn?.classList.add('hidden');
    }
  });

  storeSearchClearBtn?.addEventListener('click', () => {
    if (storeSearchInput) {
      storeSearchInput.value = '';
      storeSearchClearBtn?.classList.add('hidden');
      triggerSearch();
    }
  });

  storeSearchInput?.addEventListener('input', () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      triggerSearch();
    }, 400);
  });

  storeSidebarTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const site = tab.getAttribute('data-site') as 'curseforge' | 'mock' | 'github';
      if (site) {
        switchSiteTab(site);
      }
    });
  });

  const cfSelectElement = document.getElementById('curseforgeCategorySelect');
  cfSelectElement?.addEventListener('change', () => {
    triggerSearch();
  });

  const confirmModal = document.getElementById('storeDownloadModal');
  const confirmCancel = document.getElementById('store-modal-cancel') as HTMLButtonElement | null;
  const confirmConfirm = document.getElementById('store-modal-confirm') as HTMLButtonElement | null;

  storeReviewBtn?.addEventListener('click', () => {
    const tableBody = document.getElementById('store-modal-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    selectedAddons.forEach((item, key) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-800 hover:bg-slate-900/40 transition-colors';
      tr.setAttribute('data-key', key);
      const provider = key.startsWith('gh-')
        ? 'GitHub'
        : key.startsWith('mock-')
          ? 'Mock'
          : 'CurseForge';
      tr.innerHTML = `
        <td class="p-2 text-center">
          <input type="checkbox" class="confirm-addon-checkbox w-4 h-4 accent-sky-500 rounded border-slate-700 bg-slate-800" data-key="${key}" checked />
        </td>
        <td class="p-2 font-semibold text-slate-200">${escapeHtml(item.addon.title)}</td>
        <td class="p-2 text-slate-400 font-mono text-[10px] break-all">${escapeHtml(item.selectedVersion.fileName || 'Unknown File')}</td>
        <td class="p-2"><span class="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-slate-400">${provider}</span></td>
        <td class="p-2"><span class="store-status-cell font-semibold" data-key="${key}">${escapeHtml(getReleaseTypeName(item.selectedVersion.releaseType))}</span></td>
      `;

      const checkbox = tr.querySelector('.confirm-addon-checkbox') as HTMLInputElement;
      checkbox.addEventListener('change', () => {
        updateConfirmButtonState();
      });

      tableBody.appendChild(tr);
    });

    confirmModal?.classList.remove('hidden');
    updateConfirmButtonState();
  });

  const closeConfirmModal = () => {
    confirmModal?.classList.add('hidden');
  };
  confirmCancel?.addEventListener('click', closeConfirmModal);

  confirmModal?.addEventListener('click', (e) => {
    if (e.target === confirmModal) {
      closeConfirmModal();
    }
  });

  confirmConfirm?.addEventListener('click', async () => {
    await installSelectedAddons();
  });
}
