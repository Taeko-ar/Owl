import { invoke } from '@tauri-apps/api/core';
import { getTranslation } from '../i18n/index';
import { escapeHtml, sanitizeHtml } from '../utils';
import { CatalogAddon, AddonVersion, CurseForgeFile } from '../types';
import {
  selectedAddons,
  getCurrentActiveSite,
  getSelectedDetailAddon,
  setSelectedDetailAddon,
  getSelectedDetailAddonKey,
  setSelectedDetailAddonKey,
  getCurrentDetailVersions,
  setCurrentDetailVersions,
  getDetectedGameVersion,
} from '../state';
import { fetchGithubReleases, getReleaseTypeName } from './github';
import { updateFooterState } from './index';
import { selectAddonForDownload } from './download';

export function updateDetailsSelectionButton() {
  const selectBtn = document.getElementById('detailSelectBtn') as HTMLButtonElement | null;
  if (!selectBtn || !getSelectedDetailAddon() || !getSelectedDetailAddonKey()) return;

  const isChecked = selectedAddons.has(getSelectedDetailAddonKey());

  if (isChecked) {
    selectBtn.textContent = getTranslation('store.deselectForDownload');
    selectBtn.className =
      'flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded transition-all duration-150 cursor-pointer outline-none bg-sky-600/20 border border-sky-500 text-sky-400 hover:bg-sky-600/30';
  } else {
    selectBtn.textContent = getTranslation('store.selectForDownload');
    selectBtn.className =
      'flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded transition-all duration-150 cursor-pointer outline-none bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700';
  }
}

export async function loadAddonDetails(addon: CatalogAddon, key: string) {
  setSelectedDetailAddon(addon);
  setSelectedDetailAddonKey(key);
  setCurrentDetailVersions([]);

  const detailsContent = document.getElementById('storeDetailsContent');
  if (!detailsContent) return;

  detailsContent.innerHTML = `
    <div class="flex items-center gap-3 mb-4">
      <div class="w-12 h-12 rounded bg-slate-900 border border-slate-800 animate-pulse flex-shrink-0"></div>
      <div class="flex-1 min-w-0">
        <div class="h-4 bg-slate-900 rounded w-3/4 animate-pulse"></div>
        <div class="h-3 bg-slate-900 rounded w-1/2 mt-2 animate-pulse"></div>
      </div>
    </div>
    <div class="h-8 bg-slate-900 rounded mb-4 animate-pulse"></div>
    <div class="space-y-2 mt-4">
      <div class="h-3 bg-slate-900 rounded w-full animate-pulse"></div>
      <div class="h-3 bg-slate-900 rounded w-5/6 animate-pulse"></div>
      <div class="h-3 bg-slate-900 rounded w-4/5 animate-pulse"></div>
    </div>
  `;

  let versionsList: AddonVersion[] = [];
  let descriptionHtml = addon.description || 'No description available.';

  try {
    if (getCurrentActiveSite() === 'github') {
      const parts = addon.name.split('/');
      const owner = parts[0];
      const repo = parts[1] || addon.title;
      const [files, descHtml] = await Promise.all([
        fetchGithubReleases(addon.name),
        fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
          headers: { Accept: 'application/vnd.github.html' },
        })
          .then((res) => (res.ok ? res.text() : 'No description available.'))
          .catch(() => 'No description available.'),
      ]);
      versionsList = files;
      descriptionHtml = descHtml;
    } else {
      const isMock = getCurrentActiveSite() === 'mock';
      const [filesRes, descRes] = await Promise.all([
        invoke<{ data: CurseForgeFile[] }>('get_curseforge_mod_files', {
          modId: addon.modId,
          isMock,
        }),
        invoke<string>('get_curseforge_mod_description', { modId: addon.modId, isMock }),
      ]);

      descriptionHtml = descRes;
      const files = filesRes.data || [];
      versionsList = files
        .filter((file) => {
          const hasDlUrl = !!(file.downloadUrl || (file.id && file.fileName));
          if (!file.gameVersions || !hasDlUrl) return false;
          return file.gameVersions.some((v: string) => {
            if (getDetectedGameVersion() === '1.12.1') {
              return v === '1.12' || v === '1.12.1' || v === '1.12.2';
            } else {
              return v === '3.3.5' || v === '3.3.5a' || v.startsWith('3.4.');
            }
          });
        })
        .map((file) => {
          const dlUrl =
            file.downloadUrl ||
            `https://edge.forgecdn.net/files/${Math.floor(file.id / 1000)}/${file.id % 1000}/${encodeURIComponent(file.fileName || '')}`;
          return {
            id: file.id,
            displayName: file.displayName || file.fileName || 'Unknown Version',
            fileName: file.fileName,
            releaseType: file.releaseType || 1,
            downloadUrl: dlUrl,
            gameVersions: file.gameVersions,
            sha1: file.hashes?.find((h) => h.algo === 1)?.value || null,
          };
        });
    }

    setCurrentDetailVersions(versionsList);

    const isChecked = selectedAddons.has(key);
    const selectedItem = selectedAddons.get(key);
    const currentlySelectedUrl = selectedItem?.selectedVersion.downloadUrl || '';

    const placeholderSvg = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><rect width='40' height='40' fill='%231e293b'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%2364748b' font-size='10' font-family='sans-serif' font-weight='bold'>${addon.title.substring(0, 2).toUpperCase()}</text></svg>`;

    let linksHtml = '';
    if (addon.websiteUrl) {
      linksHtml += `<a href="${addon.websiteUrl}" target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:underline">${getTranslation('store.website')}</a>`;
    }
    if (addon.issuesUrl) {
      if (linksHtml) linksHtml += ' • ';
      linksHtml += `<a href="${addon.issuesUrl}" target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:underline">${getTranslation('store.issueTracker')}</a>`;
    }
    if (addon.sourceUrl) {
      if (linksHtml) linksHtml += ' • ';
      linksHtml += `<a href="${addon.sourceUrl}" target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:underline">GitHub</a>`;
    }

    detailsContent.innerHTML = `
      <!-- Header Row (Image on left, details on right) -->
      <div class="flex items-start gap-3 mb-4 pb-3 border-b border-slate-800 flex-shrink-0 w-full">
        <img src="${addon.logoUrl || placeholderSvg}" class="w-12 h-12 rounded border border-slate-800 object-cover flex-shrink-0 mt-0.5" onerror="this.src='${placeholderSvg}'" />
        <div class="min-w-0 flex-1 flex flex-col gap-1.5">
          <h3 class="text-sm font-bold text-slate-100 truncate">${escapeHtml(addon.title)}</h3>
          <div class="flex items-center gap-2 w-full">
            <select id="detailVersionSelect" class="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-[11px] text-slate-200 outline-none focus:border-slate-700 cursor-pointer">
              ${versionsList.map((v) => `<option value="${v.downloadUrl}" ${v.downloadUrl === currentlySelectedUrl ? 'selected' : ''}>${escapeHtml(v.displayName)} (${escapeHtml(getReleaseTypeName(v.releaseType))})</option>`).join('')}
              ${versionsList.length === 0 ? `<option value="">${getTranslation('store.noVersions')}</option>` : ''}
            </select>
            <button id="detailSelectBtn" class="flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded transition-all duration-150 cursor-pointer outline-none ${isChecked ? 'bg-sky-600/20 border border-sky-500 text-sky-400 hover:bg-sky-600/30' : 'bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700'}">
              ${isChecked ? getTranslation('store.deselectForDownload') : getTranslation('store.selectForDownload')}
            </button>
          </div>
        </div>
      </div>

      <!-- By (Author) -->
      <div class="text-xs text-slate-400 mb-1.5 flex-shrink-0">
        ${getTranslation('store.byAuthor')} <span class="text-slate-300 font-semibold">${escapeHtml(addon.authors || getTranslation('store.none'))}</span>
      </div>

      <!-- Donate information: (Link to any information for donations) -->
      <div class="text-xs text-slate-400 mb-1.5 flex-shrink-0">
        ${getTranslation('store.donateInfo')} ${addon.donationUrl ? `<a href="${escapeHtml(addon.donationUrl)}" target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:underline">${getTranslation('store.supportCreator')}</a>` : `<span class="text-slate-500">${getTranslation('store.none')}</span>`}
      </div>

      <!-- External links: (Issue tracker, github) -->
      <div class="text-xs text-slate-400 mb-3 flex-shrink-0 flex items-center gap-1.5">
        <span>${getTranslation('store.externalLinks')}</span>
        <div class="flex gap-2">
          ${linksHtml || `<span class="text-slate-500">${getTranslation('store.none')}</span>`}
        </div>
      </div>

      <!-- Mod Description -->
      <div class="flex-1 min-h-0 overflow-y-auto details-description pr-1">
        ${sanitizeHtml(descriptionHtml)}
      </div>
    `;

    const versionSelect = document.getElementById(
      'detailVersionSelect'
    ) as HTMLSelectElement | null;
    versionSelect?.addEventListener('change', () => {
      const selectVal = versionSelect.value;
      if (!selectVal) return;
      const targetVersion = getCurrentDetailVersions().find((v) => v.downloadUrl === selectVal);

      if (selectedAddons.has(key) && targetVersion) {
        selectedAddons.set(key, { addon, selectedVersion: targetVersion });
      }
    });

    const selectBtn = document.getElementById('detailSelectBtn') as HTMLButtonElement | null;
    selectBtn?.addEventListener('click', async () => {
      const activeChecked = selectedAddons.has(key);
      if (activeChecked) {
        selectedAddons.delete(key);
        updateFooterState();
        updateDetailsSelectionButton();

        const card = document.querySelector(`.store-addon-card[data-key="${key}"]`);
        if (card) {
          card.classList.remove('selected', 'border-sky-600/30');
          const cb = card.querySelector('.store-addon-checkbox') as HTMLInputElement;
          if (cb) cb.checked = false;
        }
      } else {
        const selectVal = versionSelect?.value || '';
        const targetVersion = getCurrentDetailVersions().find((v) => v.downloadUrl === selectVal);
        if (targetVersion) {
          await selectAddonForDownload(key, addon, targetVersion);
          updateDetailsSelectionButton();
        } else {
          await selectAddonForDownload(key, addon);
          updateDetailsSelectionButton();
          const updatedItem = selectedAddons.get(key);
          if (updatedItem && versionSelect) {
            versionSelect.value = updatedItem.selectedVersion.downloadUrl;
          }
        }
      }
    });
  } catch (err) {
    console.error('loadAddonDetails error:', err);
    detailsContent.innerHTML = `<div class="text-center text-red-400 py-12 text-xs">Failed to load details: ${err}</div>`;
  }
}

export function clearDetailsPane() {
  setSelectedDetailAddon(null);
  setSelectedDetailAddonKey('');
  setCurrentDetailVersions([]);
  const detailsContent = document.getElementById('storeDetailsContent');
  if (detailsContent) {
    detailsContent.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs text-center" data-i18n="store.selectAddonHint">
        ${getTranslation('store.selectAddonHint')}
      </div>
    `;
  }
}

export function renderStoreCatalog(
  addons: CatalogAddon[],
  _site: 'curseforge' | 'mock' | 'github'
) {
  const listContainer = document.getElementById('storeListContainer');
  const listEmpty = document.getElementById('storeListEmpty');
  if (!listContainer) return;

  listContainer.innerHTML = '';

  if (addons.length === 0) {
    listEmpty?.classList.remove('hidden');
    return;
  }
  listEmpty?.classList.add('hidden');

  addons.forEach((addon, index) => {
    const key =
      getCurrentActiveSite() === 'github'
        ? `gh-${addon.modId}`
        : addon.modId
          ? `cf-${addon.modId}`
          : `mock-${index}-${addon.name.replace(/\s+/g, '')}`;
    const isChecked = selectedAddons.has(key);
    const isSelectedDetails =
      getSelectedDetailAddon() &&
      getSelectedDetailAddon()?.modId === addon.modId &&
      getSelectedDetailAddon()?.name === addon.name;

    const card = document.createElement('div');
    card.className = `store-addon-card flex items-start py-1.5 px-2.5 rounded-lg border border-slate-800 bg-slate-900/40 hover:border-slate-700 transition-all duration-200 cursor-pointer ${isChecked ? 'selected border-sky-600/30' : ''} ${isSelectedDetails ? 'border-sky-500 bg-slate-900/60' : ''}`;
    card.setAttribute('data-key', key);

    const placeholderSvg = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><rect width='32' height='32' fill='%231e293b'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%2364748b' font-size='9' font-family='sans-serif' font-weight='bold'>${addon.title.substring(0, 2).toUpperCase()}</text></svg>`;

    card.innerHTML = `
      <div class="flex items-center justify-center p-1 flex-shrink-0 mr-2 mt-0.5" onclick="event.stopPropagation();">
        <input type="checkbox" class="store-addon-checkbox w-4 h-4 accent-sky-500 rounded border-slate-700 bg-slate-800 cursor-pointer" data-key="${key}" ${isChecked ? 'checked' : ''} />
      </div>
      <img src="${addon.logoUrl || placeholderSvg}" class="w-8 h-8 rounded border border-slate-800 mr-2.5 flex-shrink-0 object-cover" onerror="this.src='${placeholderSvg}'" />
      <div class="flex-1 min-w-0 pr-2">
        <h4 class="text-xs font-bold text-slate-200 truncate">${escapeHtml(addon.title)}</h4>
        <p class="text-[11px] text-slate-400 mt-0.5 line-clamp-1">${escapeHtml(addon.description)}</p>
      </div>
    `;

    const checkbox = card.querySelector('.store-addon-checkbox') as HTMLInputElement;
    checkbox.addEventListener('change', async () => {
      if (checkbox.checked) {
        await selectAddonForDownload(key, addon);
        if (getSelectedDetailAddon() && getSelectedDetailAddonKey() === key) {
          updateDetailsSelectionButton();
        }
      } else {
        selectedAddons.delete(key);
        updateFooterState();
        card.classList.remove('selected', 'border-sky-600/30');
        if (getSelectedDetailAddon() && getSelectedDetailAddonKey() === key) {
          updateDetailsSelectionButton();
        }
      }
    });

    card.addEventListener('click', () => {
      document
        .querySelectorAll('.store-addon-card')
        .forEach((c) => c.classList.remove('border-sky-500', 'bg-slate-900/60'));
      card.classList.add('border-sky-500', 'bg-slate-900/60');
      loadAddonDetails(addon, key);
    });

    listContainer.appendChild(card);
  });
}
