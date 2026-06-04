import { invoke } from '@tauri-apps/api/core';
import {
  escapeHtml,
  formatWithColorCodes,
  setLoadingState,
  clearLoadingState,
  showToast,
} from '../utils';
import { getTranslation } from '../i18n';
import { checkSingleAddonGitStatus } from '../ui/git-status';
import { showAddonModal } from '../ui/addon-modal';
import { loadPatches } from './patches';
import { AddonMeta, AddonProfile, LauncherSettings } from '../types';
import { parseConfigToMap } from './tweaks';

export async function loadAddonsAndPatches() {
  const gamePath = document.getElementById('gamePath') as HTMLInputElement;
  const statusFooter = document.getElementById('status') as HTMLElement;
  const activityProgress = document.getElementById('activityProgress') as HTMLElement | null;
  const addonsList = document.getElementById('addons-list') as HTMLDivElement;
  const addonEmpty = document.getElementById('addons-empty') as HTMLDivElement;

  if (!gamePath || !addonsList || !addonEmpty) return;

  const activeTab = document.querySelector('.nav-tab.active')?.getAttribute('data-tab');

  setLoadingState('Loading addons and patches...', 20, null, activityProgress);
  try {
    if (activeTab === 'mods') {
      const patches = await invoke<string[]>('get_patches', { basePath: gamePath.value });
      await loadPatches(patches, gamePath.value, statusFooter);
      return;
    }

    const addons = await invoke<string[]>('get_addons', { basePath: gamePath.value });
    const patches = await invoke<string[]>('get_patches', { basePath: gamePath.value });

    const visibleAddons = addons.filter((a) => !a.startsWith('Blizzard_'));

    if (visibleAddons.length > 0) {
      addonEmpty.classList.add('hidden');
      addonEmpty.style.display = 'none';
      addonsList.classList.remove('hidden');
      addonsList.style.display = '';

      const exportBtn = document.getElementById('exportAddonsBtn') as HTMLButtonElement | null;
      if (exportBtn) {
        exportBtn.removeAttribute('disabled');
        exportBtn.removeAttribute('title');
      }

      const metas = await Promise.all(
        visibleAddons.map(async (addon) => {
          try {
            const m = await invoke<AddonMeta>('parse_toc', {
              basePath: gamePath.value,
              addonName: addon,
            });
            return m;
          } catch {
            return { name: addon, title: addon, author: null, version: null, hasGit: false };
          }
        })
      );

      const rows = metas.map((meta) => {
        const displayName = meta.title || meta.name.replace(/-disabled$/, '');
        const enabled = !meta.name.endsWith('-disabled');
        return { ...meta, displayName, enabled };
      });

      addonsList.innerHTML = rows
        .map(
          (meta) => `
        <div class="flex flex-col justify-center border-b border-slate-800 py-2" data-addon="${meta.name}">
          <div class="flex items-center justify-between w-full">
            <div class="flex items-center gap-3 min-w-0">
              <label class="toggle-switch flex-shrink-0">
                <input type="checkbox" class="addon-toggle" data-addon="${meta.name}" ${meta.enabled ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
              <div class="addon-item min-w-0 cursor-pointer" data-addon="${meta.name}">
                <div class="flex items-center gap-2 min-w-0">
                  <p class="font-semibold text-slate-100 truncate" data-html>${formatWithColorCodes(meta.displayName)}</p>
                  <span class="text-xs text-slate-400 truncate">${meta.author ? formatWithColorCodes(meta.author) : ''}${meta.version ? ' • v' + escapeHtml(meta.version) : ''}</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-2 normal-actions">
                <button class="open-addon p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all duration-200" data-addon="${meta.name}" title="Open Folder">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4 pointer-events-none">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-19.5 0A2.25 2.25 0 003 15v4.5A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V15a2.25 2.25 0 00-2.25-2.25H5.25a2.25 2.25 0 00-2.25 2.25z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 9.75h19.5L18.75 4.5H5.25L2.25 9.75z" />
                  </svg>
                </button>
                <button class="delete-addon p-1.5 rounded-md text-red-400 hover:text-red-300 hover:bg-red-950/30 transition-all duration-200" data-addon="${meta.name}" title="Delete Addon">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4 pointer-events-none">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
              <div class="flex items-center gap-1.5 confirm-actions hidden">
                <span class="text-xs text-red-400 font-semibold">${getTranslation('store.confirmDeleteShort')}</span>
                <button class="confirm-delete px-2 py-1 text-[11px] font-semibold bg-red-600 hover:bg-red-500 rounded text-slate-100 transition-all duration-150" data-addon="${meta.name}">
                  ${getTranslation('buttons.yes')}
                </button>
                <button class="cancel-delete px-2 py-1 text-[11px] font-semibold bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded text-slate-200 transition-all duration-150">
                  ${getTranslation('buttons.no')}
                </button>
              </div>
            </div>
          </div>
          ${
            meta.hasGit
              ? `
          <div class="flex items-center gap-3.5 mt-2 pl-14 text-xs w-full">
            <div class="addon-git-status flex items-center gap-1.5 text-slate-400" data-addon="${meta.name}">
              <span class="inline-block w-2.5 h-2.5 bg-yellow-500/20 border border-yellow-500/40 rounded-full animate-pulse"></span>
              <span class="text-slate-500">Pending update check...</span>
            </div>
            <div class="relative inline-block">
              <button class="addon-git-branch-btn flex items-center gap-1.5 text-slate-400 hover:text-slate-200 bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded px-2 py-0.5 transition-all duration-200 cursor-pointer outline-none focus:border-slate-500" data-addon="${meta.name}">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5 text-slate-400 pointer-events-none">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 19.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 0V9.75M12 9.75a3 3 0 116 0v5.25a1.5 1.5 0 1 03 0V9.75a6 6 0 00-6-6h-3" />
                </svg>
                <span class="addon-current-branch font-medium pointer-events-none">Checking...</span>
              </button>
              <div class="addon-branch-dropdown hidden absolute left-0 bottom-full mb-1 z-30 bg-slate-900 border border-slate-700 rounded shadow-xl py-1 min-w-[160px] w-max max-w-[240px] max-h-48 overflow-y-auto" data-addon="${meta.name}">
              </div>
            </div>
          </div>
          `
              : ''
          }
        </div>
      `
        )
        .join('');

      document.querySelectorAll('.addon-item').forEach((el) => {
        el.addEventListener('click', async (e) => {
          const target = e.currentTarget as HTMLElement;
          const addon = target.getAttribute('data-addon');
          if (!addon) return;
          try {
            const meta = await invoke<AddonMeta>('parse_toc', {
              basePath: gamePath.value,
              addonName: addon,
            });
            showAddonModal(meta);
          } catch (err) {
            statusFooter.textContent = `Error: ${err}`;
          }
        });
      });

      document.querySelectorAll('.open-addon').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const addon = (e.currentTarget as HTMLButtonElement).getAttribute('data-addon');
          if (!addon) return;
          try {
            await invoke('open_addon_folder', { basePath: gamePath.value, addonName: addon });
            statusFooter.textContent = `Opened folder: ${addon}`;
          } catch (err) {
            statusFooter.textContent = `Error: ${err}`;
          }
        });
      });

      document.querySelectorAll('.addon-toggle').forEach((chk) => {
        chk.addEventListener('change', async (e) => {
          e.stopPropagation();
          const checkbox = e.target as HTMLInputElement;
          const addon = checkbox.getAttribute('data-addon');
          if (!addon) return;
          const enable = checkbox.checked;
          try {
            const res = await invoke<string>('toggle_addon', {
              basePath: gamePath.value,
              addonName: addon,
              enable,
            });
            statusFooter.textContent = res;
            showToast(getTranslation('toast.saved'));
            await loadAddonsAndPatches();
          } catch (err) {
            statusFooter.textContent = `Error: ${err}`;
          }
        });
      });

      document.querySelectorAll('.delete-addon').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const normalActions = btn.parentElement;
          const confirmActions = normalActions?.nextElementSibling;
          if (normalActions && confirmActions) {
            normalActions.classList.add('hidden');
            confirmActions.classList.remove('hidden');
          }
        });
      });

      document.querySelectorAll('.confirm-actions .cancel-delete').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const confirmActions = btn.parentElement;
          const normalActions = confirmActions?.previousElementSibling;
          if (confirmActions && normalActions) {
            confirmActions.classList.add('hidden');
            normalActions.classList.remove('hidden');
          }
        });
      });

      document.querySelectorAll('.confirm-actions .confirm-delete').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const addon = (e.currentTarget as HTMLButtonElement).getAttribute('data-addon');
          if (!addon) return;
          try {
            await invoke('delete_addon', { basePath: gamePath.value, addonName: addon });
            await loadAddonsAndPatches();
            statusFooter.textContent = `Deleted addon: ${addon}`;
          } catch (err) {
            statusFooter.textContent = `Error: ${err}`;
          }
        });
      });

      document.querySelectorAll('.addon-git-branch-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const dropdown = btn.nextElementSibling as HTMLElement;
          document.querySelectorAll('.addon-branch-dropdown').forEach((d) => {
            if (d !== dropdown) {
              d.classList.add('hidden');
            }
          });
          dropdown.classList.toggle('hidden');
        });
      });

      document.addEventListener('click', () => {
        document.querySelectorAll('.addon-branch-dropdown').forEach((d) => {
          d.classList.add('hidden');
        });
      });
      (async () => {
        for (const meta of rows) {
          if (!meta.hasGit) continue;
          const container = document.querySelector(
            `.addon-git-status[data-addon="${meta.name}"]`
          ) as HTMLElement;
          await checkSingleAddonGitStatus(
            meta.name,
            container,
            gamePath.value,
            statusFooter,
            false
          );
        }
      })();

      const settings = await invoke<LauncherSettings | null>('load_settings').catch(() => null);
      const activeProfile = settings?.activeProfile || null;
      const profiles = settings?.addonProfiles || [];
      await updateProfileDropdown(profiles, activeProfile, rows);
    } else {
      const exportBtn = document.getElementById('exportAddonsBtn') as HTMLButtonElement;
      exportBtn.setAttribute('disabled', 'true');
      exportBtn.setAttribute('title', getTranslation('import.emptyTooltip'));
      addonEmpty.classList.remove('hidden');
      addonEmpty.style.display = 'flex';
      addonEmpty.classList.add('flex', 'flex-1', 'items-center', 'justify-center');
      addonsList.classList.add('hidden');
      addonsList.style.display = 'none';
      addonsList.innerHTML = '';

      const settings = await invoke<LauncherSettings | null>('load_settings').catch(() => null);
      const activeProfile = settings?.activeProfile || null;
      const profiles = settings?.addonProfiles || [];
      await updateProfileDropdown(profiles, activeProfile, []);
    }

    await loadPatches(patches, gamePath.value, statusFooter);
  } catch (error) {
    statusFooter.textContent = `Error loading files: ${error}`;
  } finally {
    clearLoadingState(statusFooter, activityProgress);
    const addonsSearch = document.getElementById('addons-search') as HTMLInputElement | null;
    if (addonsSearch && addonsSearch.value) {
      addonsSearch.dispatchEvent(new Event('input'));
    }
    const patchesSearch = document.getElementById('patches-search') as HTMLInputElement | null;
    if (patchesSearch && patchesSearch.value) {
      patchesSearch.dispatchEvent(new Event('input'));
    }
  }
}

let profilesInitialized = false;
let activeModalAction: 'save' | null = null;

export function resetProfilesInitializedForTesting() {
  profilesInitialized = false;
}

export function setupAddonProfileEvents() {
  if (profilesInitialized) return;
  profilesInitialized = true;

  const profileSelectorBtn = document.getElementById('profileSelectorBtn');
  const profileDropdown = document.getElementById('profileDropdown');
  const profileModal = document.getElementById('profileModal');
  const profileModalTitle = document.getElementById('profileModalTitle');
  const profileModalInput = document.getElementById('profileModalInput') as HTMLInputElement;
  const profileModalError = document.getElementById('profileModalError');
  const cancelProfileModal = document.getElementById('cancelProfileModal');
  const confirmProfileModal = document.getElementById('confirmProfileModal');

  const gamePath = document.getElementById('gamePath') as HTMLInputElement;

  if (
    !profileSelectorBtn ||
    !profileDropdown ||
    !profileModal ||
    !profileModalInput ||
    !profileModalError ||
    !profileModalTitle
  )
    return;

  profileSelectorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    profileDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    profileDropdown.classList.add('hidden');
  });
  profileDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  profileModal.addEventListener('click', (e) => {
    if (e.target === profileModal) {
      profileModal.classList.add('hidden');
    }
  });

  profileModalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmProfileModal?.click();
    }
  });

  cancelProfileModal?.addEventListener('click', () => {
    profileModal.classList.add('hidden');
  });

  confirmProfileModal?.addEventListener('click', async () => {
    const name = profileModalInput.value.trim();
    if (!name) {
      profileModalError.textContent = getTranslation('addons.profileErrorEmpty');
      profileModalError.classList.remove('hidden');
      return;
    }
    if (name.length > 32) {
      profileModalError.textContent = getTranslation('addons.profileErrorTooLong');
      profileModalError.classList.remove('hidden');
      return;
    }

    const settings = await invoke<LauncherSettings>('load_settings');
    const profiles = settings.addonProfiles || [];

    if (activeModalAction === 'save') {
      if (profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        profileModalError.textContent = getTranslation('addons.profileErrorDuplicate');
        profileModalError.classList.remove('hidden');
        return;
      }

      try {
        const addons = await invoke<string[]>('get_addons', { basePath: gamePath.value });
        const visibleAddons = addons.filter((a) => !a.startsWith('Blizzard_'));
        const enabledAddons = visibleAddons
          .filter((name) => !name.endsWith('-disabled'))
          .map((name) => name.replace(/-disabled$/, ''));

        await invoke('save_addon_profile', {
          basePath: gamePath.value,
          name,
          enabledAddons,
        });
        showToast(getTranslation('addons.toast.profileCreated'));
        profileModal.classList.add('hidden');
        await loadAddonsAndPatches();
      } catch (err) {
        profileModalError.textContent = String(err);
        profileModalError.classList.remove('hidden');
      }
    }
  });
}

async function updateProfileDropdown(
  profiles: AddonProfile[],
  activeProfile: string | null,
  rows: { name: string; enabled: boolean }[]
) {
  const profileDropdown = document.getElementById('profileDropdown');
  const activeProfileHeaderName = document.getElementById('activeProfileHeaderName');
  const activeProfileHeaderContainer = document.getElementById('activeProfileHeaderContainer');

  if (!profileDropdown) return;

  let isModified = false;
  if (activeProfile && activeProfile !== 'All Addons') {
    const activeProf = profiles.find((p) => p.name === activeProfile);
    if (activeProf) {
      // 1. Compare Addons
      const currentEnabled = rows
        .filter((r) => r.enabled)
        .map((r) => r.name.replace(/-disabled$/, ''));
      const profEnabled = activeProf.enabledAddons;
      const currentSet = new Set(currentEnabled);
      const profSet = new Set(profEnabled);
      if (currentSet.size !== profSet.size || ![...currentSet].every((x) => profSet.has(x))) {
        isModified = true;
      }

      // 2. Compare Tweaks
      const gamePath = document.getElementById('gamePath') as HTMLInputElement;
      if (!isModified && gamePath && activeProf.tweakConfigs) {
        try {
          const raw = await invoke<string>('read_config', { basePath: gamePath.value });
          const configMap = parseConfigToMap(raw);
          for (const [key, val] of Object.entries(activeProf.tweakConfigs)) {
            if (configMap[key] !== val) {
              isModified = true;
              break;
            }
          }
        } catch {
          // ignore
        }
      }

      // 3. Compare Patches
      if (!isModified && gamePath && activeProf.enabledPatches) {
        try {
          const patches = await invoke<string[]>('get_patches', { basePath: gamePath.value });
          const currentEnabledPatches = patches
            .filter(
              (p) =>
                !p.toLowerCase().endsWith('-disabled.mpq') && !p.toLowerCase().endsWith('-disabled')
            )
            .map((p) => p.toLowerCase());
          const profEnabledPatches = activeProf.enabledPatches.map((p) => p.toLowerCase());
          const currentPatchesSet = new Set(currentEnabledPatches);
          const profPatchesSet = new Set(profEnabledPatches);
          if (
            currentPatchesSet.size !== profPatchesSet.size ||
            ![...currentPatchesSet].every((x) => profPatchesSet.has(x))
          ) {
            isModified = true;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  const activeProfileHeaderNameMods = document.getElementById('activeProfileHeaderNameMods');
  const activeProfileHeaderContainerMods = document.getElementById(
    'activeProfileHeaderContainerMods'
  );

  if (activeProfileHeaderName) {
    if (activeProfile) {
      activeProfileHeaderName.textContent = `${activeProfile}${isModified ? ' (modified)' : ''}`;
      activeProfileHeaderName.classList.add('text-sky-400');
      activeProfileHeaderContainer?.classList.remove('hidden');
    } else {
      activeProfileHeaderContainer?.classList.add('hidden');
    }
  }

  if (activeProfileHeaderNameMods) {
    if (activeProfile) {
      activeProfileHeaderNameMods.textContent = `${activeProfile}${isModified ? ' (modified)' : ''}`;
      activeProfileHeaderNameMods.classList.add('text-sky-400');
      activeProfileHeaderContainerMods?.classList.remove('hidden');
    } else {
      activeProfileHeaderContainerMods?.classList.add('hidden');
    }
  }

  if (profiles.length === 0) {
    profileDropdown.innerHTML = `
      <div class="py-1">
        <button
          id="saveProfileBtn"
          class="w-full text-left px-4 py-2 hover:bg-slate-800 text-slate-100 text-xs transition-colors duration-150 block cursor-pointer outline-none font-semibold"
        >
          <span>Save Setup as Profile...</span>
        </button>
      </div>
    `;

    document.getElementById('saveProfileBtn')?.addEventListener('click', () => {
      activeModalAction = 'save';
      const profileModal = document.getElementById('profileModal');
      const profileModalTitle = document.getElementById('profileModalTitle');
      const profileModalInput = document.getElementById('profileModalInput') as HTMLInputElement;
      const profileModalError = document.getElementById('profileModalError');
      if (profileModal) {
        if (profileModalTitle) profileModalTitle.textContent = getTranslation('addons.profileSave');
        if (profileModalInput) {
          profileModalInput.value = '';
          profileModalInput.focus();
        }
        profileModalError?.classList.add('hidden');
        profileModal.classList.remove('hidden');
        profileDropdown.classList.add('hidden');
      }
    });

    return;
  }

  let listHtml = '';
  for (const prof of profiles) {
    const isActive = prof.name === activeProfile;
    listHtml += `
      <div class="profile-item-row flex items-center justify-between px-2 py-1.5 hover:bg-slate-800/60 text-xs transition-colors duration-150 w-full group relative" data-profile="${escapeHtml(prof.name)}">
        <!-- Normal view -->
        <div class="profile-normal-view flex items-center justify-between w-full min-w-0">
          <span class="profile-option-name truncate cursor-pointer flex-1 py-0.5 ${isActive ? 'text-sky-400 font-semibold' : 'text-slate-100'}" data-profile="${escapeHtml(prof.name)}">
            ${escapeHtml(prof.name)}
          </span>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <button class="rename-profile-btn p-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-all duration-150" title="Rename" data-profile="${escapeHtml(prof.name)}">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5 pointer-events-none">
                <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
              </svg>
            </button>
            <button class="delete-profile-btn p-0.5 rounded text-red-400 hover:text-red-300 hover:bg-red-950/30 transition-all duration-150" title="Delete" data-profile="${escapeHtml(prof.name)}">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5 pointer-events-none">
                <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          </div>
        </div>
        <!-- Edit view -->
        <div class="profile-edit-view flex items-center gap-1 hidden w-full">
          <input type="text" class="profile-edit-input bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-xs text-slate-200 outline-none focus:border-slate-600 flex-1 min-w-0" value="${escapeHtml(prof.name)}" data-old="${escapeHtml(prof.name)}" maxlength="32" />
          <button class="confirm-rename-btn px-1.5 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-slate-100 text-[10px] font-semibold" data-profile="${escapeHtml(prof.name)}">✓</button>
          <button class="cancel-rename-btn px-1.5 py-0.5 rounded bg-slate-850 border border-slate-700 hover:bg-slate-700 text-slate-200 text-[10px]">✕</button>
        </div>
        <!-- Delete confirmation view -->
        <div class="profile-delete-view flex items-center justify-between hidden w-full">
          <span class="text-red-400 font-semibold text-[10px]">${getTranslation('store.confirmDeleteShort')}</span>
          <div class="flex items-center gap-1">
            <button class="confirm-delete-btn px-1.5 py-0.5 text-[10px] font-semibold bg-red-600 hover:bg-red-500 rounded text-slate-100" data-profile="${escapeHtml(prof.name)}">Yes</button>
            <button class="cancel-delete-btn px-1.5 py-0.5 text-[10px] font-semibold bg-slate-850 border border-slate-700 hover:bg-slate-700 rounded text-slate-200">No</button>
          </div>
        </div>
      </div>
    `;
  }

  profileDropdown.innerHTML = `
    <div class="py-1">
      <button
        id="saveProfileBtn"
        class="w-full text-left px-4 py-2 hover:bg-slate-800 text-slate-100 text-xs transition-colors duration-150 block cursor-pointer outline-none font-semibold"
      >
        <span>Save Setup as Profile...</span>
      </button>
      
      <button
        id="updateProfileBtn"
        class="hidden w-full text-left px-4 py-2 hover:bg-slate-800 text-sky-400 font-semibold hover:text-sky-300 text-xs transition-colors duration-150 block cursor-pointer outline-none font-semibold"
      >
        Update Active Profile
      </button>

      <div class="border-t border-slate-800 my-1"></div>

      <div id="profileList" class="flex flex-col">
        ${listHtml}
      </div>
    </div>
  `;

  document.getElementById('saveProfileBtn')?.addEventListener('click', () => {
    activeModalAction = 'save';
    const profileModal = document.getElementById('profileModal');
    const profileModalTitle = document.getElementById('profileModalTitle');
    const profileModalInput = document.getElementById('profileModalInput') as HTMLInputElement;
    const profileModalError = document.getElementById('profileModalError');
    if (profileModal) {
      if (profileModalTitle) profileModalTitle.textContent = getTranslation('addons.profileSave');
      if (profileModalInput) {
        profileModalInput.value = '';
        profileModalInput.focus();
      }
      profileModalError?.classList.add('hidden');
      profileModal.classList.remove('hidden');
      profileDropdown.classList.add('hidden');
    }
  });

  const updateProfileBtn = document.getElementById('updateProfileBtn');
  if (updateProfileBtn) {
    updateProfileBtn.classList.toggle('hidden', !isModified);
    updateProfileBtn.addEventListener('click', async () => {
      const settings = await invoke<LauncherSettings>('load_settings');
      const activeProfileName = settings.activeProfile;
      if (!activeProfileName) return;

      const gamePath = document.getElementById('gamePath') as HTMLInputElement;
      const statusFooter = document.getElementById('status') as HTMLElement;

      try {
        const addons = await invoke<string[]>('get_addons', { basePath: gamePath.value });
        const visibleAddons = addons.filter((a) => !a.startsWith('Blizzard_'));
        const enabledAddons = visibleAddons
          .filter((name) => !name.endsWith('-disabled'))
          .map((name) => name.replace(/-disabled$/, ''));

        await invoke('save_addon_profile', {
          basePath: gamePath.value,
          name: activeProfileName,
          enabledAddons,
        });
        showToast(getTranslation('addons.toast.profileUpdated'));
        profileDropdown.classList.add('hidden');
        await loadAddonsAndPatches();
      } catch (err) {
        if (statusFooter) statusFooter.textContent = `Error: ${err}`;
      }
    });
  }

  const profileList = document.getElementById('profileList');
  if (profileList) {
    profileList.querySelectorAll('.profile-item-row').forEach((row) => {
      const profileName = row.getAttribute('data-profile') || '';
      const normalView = row.querySelector('.profile-normal-view') as HTMLElement;
      const editView = row.querySelector('.profile-edit-view') as HTMLElement;
      const deleteView = row.querySelector('.profile-delete-view') as HTMLElement;

      const nameLabel = row.querySelector('.profile-option-name') as HTMLElement;
      const renameBtn = row.querySelector('.rename-profile-btn') as HTMLElement;
      const deleteBtn = row.querySelector('.delete-profile-btn') as HTMLElement;

      const editInput = row.querySelector('.profile-edit-input') as HTMLInputElement;
      const confirmRenameBtn = row.querySelector('.confirm-rename-btn') as HTMLElement;
      const cancelRenameBtn = row.querySelector('.cancel-rename-btn') as HTMLElement;

      const confirmDeleteBtn = row.querySelector('.confirm-delete-btn') as HTMLElement;
      const cancelDeleteBtn = row.querySelector('.cancel-delete-btn') as HTMLElement;

      const gamePath = document.getElementById('gamePath') as HTMLInputElement;
      const statusFooter = document.getElementById('status') as HTMLElement;

      nameLabel.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await invoke('apply_addon_profile', { basePath: gamePath.value, name: profileName });
          statusFooter.textContent = `Applied profile: ${profileName}`;
          showToast(getTranslation('addons.toast.profileApplied'));
          profileDropdown.classList.add('hidden');
          await loadAddonsAndPatches();
        } catch (err) {
          statusFooter.textContent = `Error: ${err}`;
        }
      });

      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        normalView.classList.add('hidden');
        editView.classList.remove('hidden');
        editInput.focus();
        editInput.select();
      });

      cancelRenameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        editView.classList.add('hidden');
        normalView.classList.remove('hidden');
      });

      const performRename = async () => {
        const newName = editInput.value.trim();
        if (!newName) {
          showToast(getTranslation('addons.profileErrorEmpty'));
          return;
        }
        if (newName.length > 32) {
          showToast(getTranslation('addons.profileErrorTooLong'));
          return;
        }

        const settings = await invoke<LauncherSettings | null>('load_settings').catch(() => null);
        const profiles = settings?.addonProfiles || [];
        if (
          profileName.toLowerCase() !== newName.toLowerCase() &&
          profiles.some((p) => p.name.toLowerCase() === newName.toLowerCase())
        ) {
          showToast(getTranslation('addons.profileErrorDuplicate'));
          return;
        }

        try {
          await invoke('rename_addon_profile', { oldName: profileName, newName });
          showToast(getTranslation('addons.toast.profileRenamed'));
          await loadAddonsAndPatches();
        } catch (err) {
          showToast(String(err));
        }
      };

      confirmRenameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        performRename();
      });

      editInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          performRename();
        } else if (e.key === 'Escape') {
          cancelRenameBtn.click();
        }
      });

      editInput.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        normalView.classList.add('hidden');
        deleteView.classList.remove('hidden');
      });

      cancelDeleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteView.classList.add('hidden');
        normalView.classList.remove('hidden');
      });

      confirmDeleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await invoke('delete_addon_profile', { name: profileName });
          showToast(getTranslation('addons.toast.profileDeleted'));
          await loadAddonsAndPatches();
        } catch (err) {
          statusFooter.textContent = `Error: ${err}`;
        }
      });
    });
  }
}
