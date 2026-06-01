import { invoke } from '@tauri-apps/api/core';
import { getTranslation } from '../i18n/index';
import { CatalogAddon, CurseForgeMod, GitHubRepository } from '../types';
import {
  selectedAddons,
  getCurrentActiveSite,
  setCurrentActiveSite,
  getDetectedGameVersion,
} from '../state';
import { renderStoreCatalog, clearDetailsPane } from './catalog';

export function triggerSearch() {
  const storeSearchInput = document.getElementById('storeSearchInput') as HTMLInputElement | null;
  const query = storeSearchInput?.value.trim() || '';
  if (getCurrentActiveSite() === 'github') {
    searchGithub(query);
  } else {
    searchCurseForge(query);
  }
}

export function switchSiteTab(site: 'curseforge' | 'mock' | 'github') {
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

export async function searchCurseForge(query: string) {
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

export async function searchGithub(query: string) {
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

export function renderGithubTagFilters() {
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
