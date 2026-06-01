import { invoke } from '@tauri-apps/api/core';
import { getTranslation } from '../i18n/index';
import { escapeHtml } from '../utils';
import { CatalogAddon, CurseForgeMod, GitHubRepository } from '../types';
import {
  selectedAddons,
  getCurrentActiveSite,
  setCurrentActiveSite,
  getDetectedGameVersion,
  setDetectedGameVersion,
} from '../state';
import { getReleaseTypeName } from './github';
import { renderStoreCatalog, clearDetailsPane } from './catalog';
import { installSelectedAddons } from './download';

const gamePathInput = () => document.getElementById('gamePath') as HTMLInputElement;

export let onReloadAddons: () => Promise<void>;
window.addEventListener('reload-addons', () => {
  if (onReloadAddons) onReloadAddons();
});

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

  getAddonsBtn?.addEventListener('click', async () => {
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
    renderGithubTagFilters();
    switchSiteTab('curseforge');
  });

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
    clearTimeout(debounceTimer);
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

function triggerSearch() {
  const storeSearchInput = document.getElementById('storeSearchInput') as HTMLInputElement | null;
  const query = storeSearchInput?.value.trim() || '';
  if (getCurrentActiveSite() === 'github') {
    searchGithub(query);
  } else {
    searchCurseForge(query);
  }
}

function switchSiteTab(site: 'curseforge' | 'mock' | 'github') {
  setCurrentActiveSite(site);
  const storeSearchInput = document.getElementById('storeSearchInput') as HTMLInputElement | null;
  const storeSearchClearBtn = document.getElementById(
    'storeSearchClearBtn'
  ) as HTMLButtonElement | null;

  if (storeSearchInput) {
    storeSearchInput.value = '';
    storeSearchClearBtn?.classList.add('hidden');
  }

  const githubFilters = document.getElementById('githubTagFilters');
  if (githubFilters) {
    if (site === 'github') {
      githubFilters.classList.remove('hidden');
    } else {
      githubFilters.classList.add('hidden');
    }
  }

  const githubWarning = document.getElementById('githubWarningBanner');
  if (githubWarning) {
    if (site === 'github') {
      githubWarning.classList.remove('hidden');
    } else {
      githubWarning.classList.add('hidden');
    }
  }

  const cfFilters = document.getElementById('curseforgeCategoryFilters');
  const cfSelect = document.getElementById('curseforgeCategorySelect') as HTMLSelectElement | null;
  if (cfFilters) {
    if (site === 'curseforge') {
      cfFilters.classList.remove('hidden');
    } else {
      cfFilters.classList.add('hidden');
    }
  }
  if (cfSelect) {
    cfSelect.value = '';
  }

  const tabs = document.querySelectorAll('.store-sidebar-tab');
  tabs.forEach((t) => {
    if (t.getAttribute('data-site') === site) {
      t.classList.add('active', 'border-sky-500');
      t.classList.remove('border-transparent');
    } else {
      t.classList.remove('active', 'border-sky-500');
      t.classList.add('border-transparent');
    }
  });

  clearDetailsPane();

  if (site === 'github') {
    searchGithub('');
  } else {
    searchCurseForge('');
  }
}

async function searchCurseForge(query: string) {
  const storeList = document.getElementById('storeListContainer');
  const storeEmpty = document.getElementById('storeListEmpty');
  if (!storeList) return;

  storeList.innerHTML = `
    <div class="col-span-full flex flex-col items-center justify-center py-12 gap-3 text-slate-500">
      <svg class="animate-spin h-6 w-6 text-sky-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span class="text-xs font-medium animate-pulse">${getTranslation('tweaks.loading')}</span>
    </div>
  `;
  if (storeEmpty) storeEmpty.classList.add('hidden');

  const categorySelect = document.getElementById(
    'curseforgeCategorySelect'
  ) as HTMLSelectElement | null;
  const categoryId = categorySelect && categorySelect.value ? parseInt(categorySelect.value) : null;

  try {
    const isMock = getCurrentActiveSite() === 'mock';
    const response = await invoke<{ data?: CurseForgeMod[] }>('search_curseforge_addons', {
      query: encodeURIComponent(query),
      categoryId,
      gameVersion: getDetectedGameVersion(),
      isMock,
    });
    const mods = response.data || [];

    if (mods.length === 0) {
      storeList.innerHTML = '';
      if (storeEmpty) storeEmpty.classList.remove('hidden');
      return;
    }

    const catalogList: CatalogAddon[] = mods.map((mod) => ({
      name: mod.name,
      title: mod.name,
      description: mod.summary || 'No description available',
      modId: mod.id,
      logoUrl: mod.logo?.thumbnailUrl || '',
      authors: mod.authors ? mod.authors.map((a) => a.name).join(', ') : 'Unknown',
      websiteUrl: mod.links?.websiteUrl || '',
      issuesUrl: mod.links?.issuesUrl || '',
      sourceUrl: mod.links?.sourceUrl || '',
      donationUrl: mod.links?.donationUrl || '',
    }));

    renderStoreCatalog(catalogList, getCurrentActiveSite());
  } catch (err) {
    console.error(err);
    const errMsg = String(err);
    let friendlyMsg =
      'Failed to query CurseForge. Please check your internet connection or try again later.';
    if (errMsg.includes('403') || errMsg.toLowerCase().includes('forbidden')) {
      friendlyMsg =
        'Access denied by CurseForge. Please verify that a valid CurseForge API Key is configured in your launcher settings, or switch to the Mock tab to test local files.';
    }
    storeList.innerHTML = `<div class="col-span-full text-center text-red-400 py-8 px-4 text-xs font-semibold leading-relaxed border border-red-950/20 bg-red-950/5 rounded">${friendlyMsg}</div>`;
  }
}

async function searchGithub(query: string) {
  const storeList = document.getElementById('storeListContainer');
  const storeEmpty = document.getElementById('storeListEmpty');
  if (!storeList) return;

  storeList.innerHTML = `
    <div class="col-span-full flex flex-col items-center justify-center py-12 gap-3 text-slate-500">
      <svg class="animate-spin h-6 w-6 text-sky-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span class="text-xs font-medium animate-pulse">${getTranslation('tweaks.loading')}</span>
    </div>
  `;
  if (storeEmpty) storeEmpty.classList.add('hidden');

  try {
    const activePills = document.querySelectorAll('.github-tag-pill.active');
    let tags = Array.from(activePills)
      .map((p) => p.getAttribute('data-tag'))
      .filter(Boolean);

    if (tags.length === 0) {
      tags = [getDetectedGameVersion() === '1.12.1' ? 'vanilla-wow' : 'wotlk'];
    }

    const topicQuery = tags.map((t) => `topic:${t}`).join(' OR ');
    const q = query.trim() ? `${query.trim()} (${topicQuery})` : topicQuery;

    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`GitHub API returned status: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { items?: GitHubRepository[] };
    const items = json.items || [];

    if (items.length === 0) {
      storeList.innerHTML = '';
      if (storeEmpty) storeEmpty.classList.remove('hidden');
      return;
    }

    const catalogList: CatalogAddon[] = items.map((mod) => ({
      name: mod.full_name,
      title: mod.name,
      description: mod.description || 'No description available',
      modId: mod.id,
      logoUrl: mod.owner?.avatar_url || '',
      authors: mod.owner?.login || 'Unknown',
      websiteUrl: mod.html_url || '',
      issuesUrl: mod.html_url ? `${mod.html_url}/issues` : '',
      sourceUrl: mod.html_url || '',
      donationUrl: '',
    }));

    renderStoreCatalog(catalogList, 'github');
  } catch (err) {
    console.error(err);
    storeList.innerHTML = `<div class="col-span-full text-center text-red-400 py-8 px-4 text-xs font-semibold leading-relaxed border border-red-950/20 bg-red-950/5 rounded">Failed to query GitHub API: ${err}</div>`;
  }
}

function renderGithubTagFilters() {
  const container = document.getElementById('githubTagFilters');
  if (!container) return;

  const tags =
    getDetectedGameVersion() === '1.12.1'
      ? ['vanilla-wow', 'classic-wow', 'wow-classic', '1-12-1']
      : ['wotlk', 'wow-classic', 'world-of-warcraft', 'warcraft'];

  container.innerHTML = tags
    .map((tag, idx) => {
      const isActive = idx === 0;
      const activeClasses = 'bg-sky-600/20 border-sky-500 text-sky-400 hover:bg-sky-600/30 active';
      const inactiveClasses =
        'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-slate-200';
      return `<button class="github-tag-pill px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all duration-150 cursor-pointer outline-none ${isActive ? activeClasses : inactiveClasses}" data-tag="${tag}">${tag}</button>`;
    })
    .join('');

  const pills = container.querySelectorAll('.github-tag-pill');
  pills.forEach((pill) => {
    pill.addEventListener('click', () => {
      if (pill.classList.contains('active')) {
        pill.classList.remove(
          'active',
          'bg-sky-600/20',
          'border-sky-500',
          'text-sky-400',
          'hover:bg-sky-600/30'
        );
        pill.classList.add(
          'bg-slate-800',
          'border-slate-700',
          'text-slate-400',
          'hover:bg-slate-700',
          'hover:text-slate-200'
        );
      } else {
        pill.classList.add(
          'active',
          'bg-sky-600/20',
          'border-sky-500',
          'text-sky-400',
          'hover:bg-sky-600/30'
        );
        pill.classList.remove(
          'bg-slate-800',
          'border-slate-700',
          'text-slate-400',
          'hover:bg-slate-700',
          'hover:text-slate-200'
        );
      }
      triggerSearch();
    });
  });
}
export function updateFooterState() {
  const count = selectedAddons.size;
  const countSpan = document.getElementById('storeSelectedCount');
  if (countSpan) countSpan.textContent = count.toString();

  const reviewBtn = document.getElementById('storeReviewBtn') as HTMLButtonElement | null;
  if (reviewBtn) {
    reviewBtn.disabled = count === 0;
  }
}

export function updateConfirmButtonState() {
  const confirmConfirm = document.getElementById('store-modal-confirm') as HTMLButtonElement | null;
  const checkboxes = document.querySelectorAll(
    '.confirm-addon-checkbox'
  ) as NodeListOf<HTMLInputElement>;
  let checkedCount = 0;
  checkboxes.forEach((cb) => {
    if (cb.checked) checkedCount++;
  });
  if (confirmConfirm) {
    confirmConfirm.disabled = checkedCount === 0;
  }
}
