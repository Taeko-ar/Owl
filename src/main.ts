import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  debounce,
  escapeHtml,
  formatWithColorCodes,
  getConfigMetadata,
  renderMarkdown,
  sanitizeHtml,
  showTextInputModal,
  showToast,
  setLoadingState,
  clearLoadingState,
  parsePatchFilename,
} from './utils';
import { setLauncherWindowSize } from './main-utils';
import { translations, getTranslation, translateDOM, setAppLanguage } from './i18n';

export { translations, getTranslation, translateDOM, setAppLanguage, setupSearchHoverBehavior };

const navTabs = document.querySelectorAll('.nav-tab');
const tabContents = document.querySelectorAll('.tab-content');
const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
const minimizeBtn = document.getElementById('minimizeBtn') as HTMLButtonElement | null;
const windowCloseBtn = document.getElementById('windowCloseBtn') as HTMLButtonElement | null;
const settingsModal = document.getElementById('settingsModal') as HTMLDivElement;
const closeSettings = document.getElementById('closeSettings') as HTMLButtonElement;
const applySettingsButton = document.getElementById('applySettings') as HTMLButtonElement | null;
const cancelSettingsButton = document.getElementById('cancelSettings') as HTMLButtonElement | null;
const gamePath = document.getElementById('gamePath') as HTMLInputElement;
const stayOpen = document.getElementById('stayOpen') as HTMLInputElement;
const statusFooter = document.getElementById('status') as HTMLElement;
const activityProgress = document.getElementById('activityProgress') as HTMLElement | null;
const addonsList = document.getElementById('addons-list') as HTMLDivElement;
const addonEmpty = document.getElementById('addons-empty') as HTMLDivElement;
const patchesList = document.getElementById('patches-list') as HTMLDivElement;
const patchesEmpty = document.getElementById('patches-empty') as HTMLDivElement;
const configTree = document.getElementById('config-tree') as HTMLDivElement | null;
const openModsBtn = document.getElementById('openModsFolder') as HTMLButtonElement | null;
const importAddonBtn = document.getElementById('importAddonBtn') as HTMLButtonElement | null;
const browseGamePathBtn = document.getElementById('browseGamePathBtn') as HTMLButtonElement | null;
const windowSizeSelect = document.getElementById('windowSize') as HTMLSelectElement | null;
const langBtn = document.getElementById('langBtn') as HTMLButtonElement | null;
const langDropdown = document.getElementById('langDropdown') as HTMLDivElement | null;
let settingsBackup: { path: string; windowSize: string; stayOpen: boolean } | null = null;
const gitStatusCache = new Map<string, any>();

type LauncherSettings = {
  path?: string;
  windowSize?: string;
  stayOpen?: boolean;
};

async function loadAddonsAndPatches() {
  setLoadingState('Loading addons and patches...', 20, null, activityProgress);
  try {
    const addons = await invoke<string[]>('get_addons', { basePath: gamePath.value });
    const patches = await invoke<string[]>('get_patches', { basePath: gamePath.value });

    const visibleAddons = addons.filter((a) => !a.startsWith('Blizzard_'));

    if (visibleAddons.length > 0) {
      addonEmpty.classList.add('hidden');
      addonEmpty.style.display = 'none';
      addonsList.classList.remove('hidden');
      addonsList.style.display = '';

      const metas = await Promise.all(
        visibleAddons.map(async (addon) => {
          try {
            const m = await invoke<any>('parse_toc', {
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
            const meta = await invoke<any>('parse_toc', {
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
          const enable = checkbox.checked;
          try {
            const res = await invoke<string>('toggle_addon', {
              basePath: gamePath.value,
              addonName: addon,
              enable,
            });
            statusFooter.textContent = res;
            showToast('Changes saved!');
            await loadAddonsAndPatches();
          } catch (err) {
            statusFooter.textContent = `Error: ${err}`;
          }
        });
      });

      document.querySelectorAll('.delete-addon').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const addon = (e.currentTarget as HTMLButtonElement).getAttribute('data-addon') || '';
          const msg = getTranslation('store.confirmDeleteAddon', { name: addon });
          if (!confirm(msg)) return;
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
          const dropdown = btn.nextElementSibling as HTMLElement | null;
          if (dropdown) {
            document.querySelectorAll('.addon-branch-dropdown').forEach((d) => {
              if (d !== dropdown) d.classList.add('hidden');
            });
            dropdown.classList.toggle('hidden');
          }
        });
      });

      document.addEventListener('click', () => {
        document.querySelectorAll('.addon-branch-dropdown').forEach((d) => {
          d.classList.add('hidden');
        });
      });

      const renderGitStatusUI = (
        addonName: string,
        container: HTMLElement,
        branchContainer: HTMLElement | null,
        branchBtn: HTMLButtonElement | null,
        status: any
      ) => {
        if (status) {
          const hasUpdate = status.updateAvailable;
          let statusHtml = '';
          if (hasUpdate) {
            statusHtml = `
              <span class="inline-block w-2 h-2 bg-sky-500 border border-sky-600 rounded-full animate-pulse"></span>
              <button class="update-addon text-sky-400 hover:text-sky-300 font-semibold" data-addon="${addonName}">${getTranslation('git.update')}</button>
            `;
          } else {
            statusHtml = `
              <span class="inline-block w-2 h-2 bg-green-500 border border-green-600 rounded-full"></span>
              <span class="text-slate-400">${getTranslation('git.uptodate')}</span>
            `;
          }

          if (status.lastCommit) {
            statusHtml += `<span class="text-slate-500 text-[11px] font-normal ml-1">(${status.lastCommit})</span>`;
          }
          container.innerHTML = statusHtml;

          const validBranches = (status.branches || []).filter(
            (b: string) => b && b.trim() !== '' && b !== 'origin' && b !== 'remotes/origin'
          );

          if (branchBtn) {
            const branchSpan = branchBtn.querySelector('.addon-current-branch') as HTMLSpanElement;
            if (branchSpan) branchSpan.textContent = status.branch || getTranslation('git.unknown');

            const parentContainer = branchBtn.parentElement;
            if (parentContainer) {
              if (validBranches.length > 1) {
                parentContainer.classList.remove('hidden');
              } else {
                parentContainer.classList.add('hidden');
              }
            }
          }

          if (validBranches.length > 0 && branchContainer) {
            branchContainer.innerHTML = validBranches
              .map((b: string) => {
                const activeClass =
                  b === status.branch
                    ? 'bg-slate-800 text-slate-100 font-semibold'
                    : 'text-slate-300';
                return `
                   <button class="w-full text-left px-3 py-1.5 hover:bg-slate-800 ${activeClass} text-xs transition-colors duration-150 block cursor-pointer outline-none truncate" data-branch="${b}" title="${b}">
                     ${b}
                   </button>
                 `;
              })
              .join('');

            branchContainer.querySelectorAll('button[data-branch]').forEach((btn) => {
              btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const selectedBranch = btn.getAttribute('data-branch');
                if (!selectedBranch) return;

                branchContainer.classList.add('hidden');

                try {
                  container.innerHTML = `<span class="text-xs text-slate-500 animate-pulse">${getTranslation('git.switching')}</span>`;
                  const res = await invoke<string>('change_addon_branch', {
                    basePath: gamePath.value,
                    addonName: addonName,
                    branchName: selectedBranch,
                  });
                  statusFooter.textContent = res;
                  showToast(getTranslation('git.switched', { branch: selectedBranch }));
                  await checkSingleAddonGitStatus(addonName, container, true);
                } catch (err) {
                  statusFooter.textContent = `Error: ${err}`;
                  showToast(getTranslation('git.failed', { error: String(err) }));
                  await checkSingleAddonGitStatus(addonName, container, true);
                }
              });
            });
          } else if (branchContainer) {
            branchContainer.innerHTML = '';
          }

          const updateBtn = container.querySelector('.update-addon');
          updateBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              container.innerHTML = `<span class="text-xs text-slate-400 animate-pulse">${getTranslation('git.updating')}</span>`;
              if (branchContainer) branchContainer.classList.add('hidden');

              const res = await invoke<string>('update_addon', {
                basePath: gamePath.value,
                addonName: addonName,
              });
              statusFooter.textContent = res;
              showToast(res);
              await checkSingleAddonGitStatus(addonName, container, true);
            } catch (err) {
              statusFooter.textContent = `Error: ${err}`;
              container.innerHTML = `<span class="text-xs text-red-400" title="${err}">⚠️ ${getTranslation('git.updatefailed')}</span>`;
              setTimeout(() => checkSingleAddonGitStatus(addonName, container, true), 3000);
            }
          });
        } else {
          container.innerHTML = '';
          if (branchContainer) {
            branchContainer.innerHTML = '';
          }
        }
      };

      const checkSingleAddonGitStatus = async (
        addonName: string,
        container: HTMLElement,
        forceCheck = false
      ) => {
        const parentRow = container.closest('.flex-col') as HTMLElement;
        const branchContainer = parentRow?.querySelector(
          `.addon-branch-dropdown[data-addon="${addonName}"]`
        ) as HTMLElement;
        const branchBtn = parentRow?.querySelector(
          `.addon-git-branch-btn[data-addon="${addonName}"]`
        ) as HTMLButtonElement | null;

        if (!forceCheck && gitStatusCache.has(addonName)) {
          const cachedStatus = gitStatusCache.get(addonName);
          renderGitStatusUI(addonName, container, branchContainer, branchBtn, cachedStatus);
          return;
        }

        try {
          const status = await invoke<any>('check_addon_git_status', {
            basePath: gamePath.value,
            addonName: addonName,
          });
          gitStatusCache.set(addonName, status);
          renderGitStatusUI(addonName, container, branchContainer, branchBtn, status);
        } catch (err) {
          container.innerHTML = `<span class="inline-block w-2 h-2 bg-red-500 border border-red-600 rounded-full"></span> <span class="text-xs text-red-400" title="${err}">⚠️ ${getTranslation('git.checkfailed')}</span>`;
        }
      };

      (async () => {
        for (const meta of rows) {
          if (!meta.hasGit) continue;
          const container = document.querySelector(
            `.addon-git-status[data-addon="${meta.name}"]`
          ) as HTMLElement;
          if (container) {
            await checkSingleAddonGitStatus(meta.name, container, false);
          }
        }
      })();
    } else {
      addonEmpty.classList.remove('hidden');
      addonEmpty.style.display = 'flex';
      addonEmpty.classList.add('flex', 'flex-1', 'items-center', 'justify-center');
      addonsList.classList.add('hidden');
      addonsList.style.display = 'none';
      addonsList.innerHTML = '';
    }

    if (patches.length > 0) {
      patchesEmpty.classList.add('hidden');
      patchesEmpty.style.display = 'none';
      patchesList.classList.remove('hidden');
      patchesList.style.display = '';
      patchesList.innerHTML = patches
        .map((patch) => {
          const { enabled, displayName } = parsePatchFilename(patch);
          return `
        <div class="flex flex-col justify-center border-b border-slate-800 py-2" data-patch="${patch}">
          <div class="flex items-center justify-between w-full">
            <div class="flex items-center gap-3 min-w-0">
              <label class="toggle-switch flex-shrink-0">
                <input type="checkbox" class="patch-toggle" data-patch="${patch}" ${enabled ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
              <span class="font-semibold text-slate-100 truncate text-sm">${escapeHtml(displayName)}</span>
            </div>
            <div class="flex items-center gap-2">
              <button class="delete-patch p-1.5 rounded-md text-red-400 hover:text-red-300 hover:bg-red-950/30 transition-all duration-200" data-patch="${patch}" title="Delete Patch">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4 pointer-events-none">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;
        })
        .join('');

      document.querySelectorAll('.patch-toggle').forEach((chk) => {
        chk.addEventListener('change', async (e) => {
          const checkbox = e.target as HTMLInputElement;
          const patch = checkbox.getAttribute('data-patch');
          const enable = checkbox.checked;
          try {
            const res = await invoke<string>('toggle_patch', {
              basePath: gamePath.value,
              patchName: patch,
              enable,
            });
            statusFooter.textContent = res;
            showToast('Changes saved!');
            await loadAddonsAndPatches();
          } catch (err) {
            statusFooter.textContent = `Error: ${err}`;
          }
        });
      });

      document.querySelectorAll('.delete-patch').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const patch = (e.currentTarget as HTMLButtonElement).getAttribute('data-patch') || '';
          const msg = getTranslation('store.confirmDeletePatch', { name: patch });
          if (!confirm(msg)) return;
          try {
            await invoke('delete_patch', { basePath: gamePath.value, patchName: patch });
            await loadAddonsAndPatches();
            statusFooter.textContent = `Deleted patch: ${patch}`;
          } catch (err) {
            statusFooter.textContent = `Error: ${err}`;
          }
        });
      });
    } else {
      patchesEmpty.classList.remove('hidden');
      patchesEmpty.style.display = 'flex';
      patchesEmpty.classList.add('flex', 'flex-1', 'items-center', 'justify-center');
      patchesList.classList.add('hidden');
      patchesList.style.display = 'none';
      patchesList.innerHTML = '';
    }
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

function showAddonModal(meta: any) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40';
  overlay.style.backdropFilter = 'blur(4px)';
  const depsHtml =
    meta.optional_deps && meta.optional_deps.length
      ? meta.optional_deps
          .map(
            (d: string, i: number) => `
        <div class="flex items-center gap-2"><span class="${meta.optional_deps_installed && meta.optional_deps_installed[i] ? 'text-emerald-400' : 'text-slate-500'}">${meta.optional_deps_installed && meta.optional_deps_installed[i] ? '✅' : '✖'}</span><span class="text-sm text-slate-300">${d}</span></div>
      `
          )
          .join('')
      : `<div class="text-slate-400 text-sm">No dependencies</div>`;

  overlay.innerHTML = `
    <div class="rounded-lg border border-slate-700 bg-slate-900 p-6 w-11/12 max-w-3xl max-h-[80vh] flex flex-col">
      <div class="flex items-start justify-between mb-4 flex-shrink-0">
        <div>
          <h3 class="text-lg font-bold">${formatWithColorCodes(meta.title || meta.name)}</h3>
          <p class="text-sm text-slate-400">${meta.author ? 'By ' + formatWithColorCodes(meta.author) : ''} ${meta.version ? ' • v' + escapeHtml(meta.version) : ''}</p>
        </div>
        <div class="flex gap-2">
          <button id="modal-open-folder" class="text-sm bg-slate-800 px-3 py-1 rounded">📁</button>
          <button id="modal-close" class="text-sm text-slate-400 hover:text-white">✕</button>
        </div>
      </div>
      <div class="overflow-y-auto flex-1 pr-1">
        <div class="mb-4">
          <h4 class="font-semibold">Dependencies</h4>
          <div class="mt-2">${depsHtml}</div>
        </div>
        <div>
          <h4 class="font-semibold mb-2">Readme</h4>
          <div class="text-sm text-slate-300">${meta.readme ? renderMarkdown(meta.readme, meta.path) : '<span class="text-slate-500">No readme found</span>'}</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('#modal-close') as HTMLElement;
  const openBtn = overlay.querySelector('#modal-open-folder') as HTMLElement;
  closeBtn?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });
  openBtn?.addEventListener('click', async () => {
    try {
      await invoke('open_addon_folder', { basePath: gamePath.value, addonName: meta.name });
      statusFooter.textContent = `Opened folder: ${meta.name}`;
    } catch (err) {
      statusFooter.textContent = `Error: ${err}`;
    }
  });
}

const configGroups = [
  {
    title: 'Display & Window',
    colorClass: 'text-sky-400',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" /></svg>`,
    keys: ['gxResolution', 'gxWindow', 'gxMaximize', 'gxRefresh'],
  },
  {
    title: 'Performance Tuning',
    colorClass: 'text-emerald-400',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>`,
    keys: ['maxFPS', 'maxFPSbk', 'gxTripleBuffer', 'gxFixLag'],
  },
  {
    title: 'Details & Quality',
    colorClass: 'text-purple-400',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 21l-1.81-5.096L2.094 14.1 7.2 13.25 8.187 8l1.81 5.096L15.1 14.1l-5.287.804zm8.25-10.5L17.25 9l-.81-2.596L13.844 5.61l2.596-.414L17.25 2.6l.81 2.596 2.596.414-2.596.804z" /></svg>`,
    keys: ['farClip', 'environmentDetail', 'projectedTextures', 'gxMultisample', 'shadowLevel'],
  },
];

function parseConfigToMap(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('#') || line.startsWith('--')) continue;

    let key: string | null = null;
    let value = '';

    const setMatch = line.match(/^SET\s+(.+?)\s+(.+)$/i);
    if (setMatch) {
      key = setMatch[1].replace(/^"|"$/g, '');
      value = setMatch[2].trim();
    } else if (line.includes('=')) {
      const idx = line.indexOf('=');
      key = line
        .substring(0, idx)
        .trim()
        .replace(/^\[|\]$/g, '');
      value = line.substring(idx + 1).trim();
    } else {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        key = parts[0];
        value = line.substring(parts[0].length).trim();
      }
    }

    if (key) {
      value = value.replace(/^"|"$/g, '').replace(/;$/g, '').trim();
      map[key] = value;
    }
  }
  return map;
}

let activeTweaksSubTab = 'presets';

async function loadConfig() {
  if (!configTree) return;
  setLoadingState(getTranslation('status.loading'), 20, null, activityProgress);
  configTree.innerHTML = `<div class="text-slate-500">${getTranslation('tweaks.loading')}</div>`;
  try {
    const raw = await invoke<string>('read_config', { basePath: gamePath.value });
    const configMap = parseConfigToMap(raw);
    configTree.innerHTML = '';

    const mainContainer = document.createElement('div');
    mainContainer.className = 'flex flex-1 min-h-0 gap-6 w-full h-full pb-6';

    const sidebar = document.createElement('div');
    sidebar.className =
      'w-48 flex-shrink-0 flex flex-col gap-1.5 border-r border-slate-800/60 pr-4';

    const contentPanel = document.createElement('div');
    contentPanel.className = 'flex-1 overflow-y-auto pr-3 min-h-0';

    const subTabs = [
      {
        id: 'presets',
        label: getTranslation('tweaks.tabs.presets'),
        icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" /></svg>`,
      },
      {
        id: 'display',
        label: getTranslation('tweaks.groups.display_and_window'),
        icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" /></svg>`,
      },
      {
        id: 'performance',
        label: getTranslation('tweaks.groups.performance_tuning'),
        icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>`,
      },
      {
        id: 'quality',
        label: getTranslation('tweaks.groups.details_and_quality'),
        icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 21l-1.81-5.096L2.094 14.1 7.2 13.25 8.187 8l1.81 5.096L15.1 14.1l-5.287.804zm8.25-10.5L17.25 9l-.81-2.596L13.844 5.61l2.596-.414L17.25 2.6l.81 2.596 2.596.414-2.596.804z" /></svg>`,
      },
    ];

    subTabs.forEach((t) => {
      const btn = document.createElement('button');
      const isActive = t.id === activeTweaksSubTab;
      btn.className = `tweak-sidebar-btn w-full px-3.5 py-2.5 rounded-lg text-left text-xs font-semibold flex items-center gap-2.5 transition-all duration-150 cursor-pointer outline-none ${
        isActive
          ? 'bg-slate-800 text-slate-100 border border-slate-700/80 active'
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
      }`;
      btn.innerHTML = `${t.icon} <span>${t.label}</span>`;
      btn.addEventListener('click', () => {
        activeTweaksSubTab = t.id;
        loadConfig();
      });
      sidebar.appendChild(btn);
    });

    if (activeTweaksSubTab === 'presets') {
      const presetsCard = document.createElement('div');
      presetsCard.className =
        'rounded-lg border border-slate-800 bg-slate-900 p-6 flex flex-col gap-4';
      presetsCard.innerHTML = `
        <div class="flex flex-col gap-4">
          <div class="flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0">
            <div class="flex flex-col">
              <span class="text-sm text-slate-200 font-semibold">${getTranslation('tweaks.presets.low')}</span>
              <span class="text-xs text-slate-400 max-w-[400px]">${getTranslation('tweaks.presets.lowDesc')}</span>
            </div>
            <button class="preset-btn text-xs bg-slate-800 border border-slate-700 hover:border-slate-500 px-3.5 py-1.5 rounded text-slate-100 hover:bg-slate-700 transition-all duration-150 cursor-pointer outline-none font-semibold" data-preset="performance">
              ${getTranslation('settings.apply')}
            </button>
          </div>
          <div class="flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0">
            <div class="flex flex-col">
              <span class="text-sm text-slate-200 font-semibold">${getTranslation('tweaks.presets.medium')}</span>
              <span class="text-xs text-slate-400 max-w-[400px]">${getTranslation('tweaks.presets.mediumDesc')}</span>
            </div>
            <button class="preset-btn text-xs bg-slate-800 border border-slate-700 hover:border-slate-500 px-3.5 py-1.5 rounded text-slate-100 hover:bg-slate-700 transition-all duration-150 cursor-pointer outline-none font-semibold" data-preset="balanced">
              ${getTranslation('settings.apply')}
            </button>
          </div>
          <div class="flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0">
            <div class="flex flex-col">
              <span class="text-sm text-slate-200 font-semibold">${getTranslation('tweaks.presets.high')}</span>
              <span class="text-xs text-slate-400 max-w-[400px]">${getTranslation('tweaks.presets.highDesc')}</span>
            </div>
            <button class="preset-btn text-xs bg-slate-800 border border-slate-700 hover:border-slate-500 px-3.5 py-1.5 rounded text-slate-100 hover:bg-slate-700 transition-all duration-150 cursor-pointer outline-none font-semibold" data-preset="quality">
              ${getTranslation('settings.apply')}
            </button>
          </div>
        </div>
      `;

      const PRESETS = {
        performance: {
          nameKey: 'tweaks.presets.low',
          values: {
            farClip: '177.000000',
            environmentDetail: '50.000000',
            shadowLevel: '0',
            gxMultisample: '1',
            projectedTextures: '0',
          },
        },
        balanced: {
          nameKey: 'tweaks.presets.medium',
          values: {
            farClip: '727.000000',
            environmentDetail: '100.000000',
            shadowLevel: '2',
            gxMultisample: '2',
            projectedTextures: '1',
          },
        },
        quality: {
          nameKey: 'tweaks.presets.high',
          values: {
            farClip: '1277.000000',
            environmentDetail: '150.000000',
            shadowLevel: '3',
            gxMultisample: '8',
            projectedTextures: '1',
          },
        },
      };

      presetsCard.querySelectorAll('.preset-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const presetType = btn.getAttribute('data-preset') as keyof typeof PRESETS;
          const presetData = PRESETS[presetType];
          if (!presetData) return;

          const presetName = getTranslation(presetData.nameKey);
          setLoadingState(
            getTranslation('tweaks.presets.applying', { name: presetName }),
            30,
            null,
            activityProgress
          );
          try {
            for (const [key, val] of Object.entries(presetData.values)) {
              await invoke('set_config_value', {
                basePath: gamePath.value,
                key: key,
                value: val,
              });
            }
            showToast(getTranslation('tweaks.presets.applied', { name: presetName }));
            await loadConfig();
          } catch (err) {
            showToast(`Error: ${err}`);
          } finally {
            clearLoadingState(statusFooter, activityProgress);
          }
        });
      });

      contentPanel.appendChild(presetsCard);
    } else {
      const groupKey =
        activeTweaksSubTab === 'display' ? 0 : activeTweaksSubTab === 'performance' ? 1 : 2;
      const group = configGroups[groupKey];

      const card = document.createElement('div');
      card.className = 'rounded-lg border border-slate-800 bg-slate-900 p-6 flex flex-col gap-4';

      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'flex flex-col gap-4';

      group.keys.forEach((key) => {
        const configMeta = getConfigMetadata(key, key);
        const value = configMap[key] || '';

        const row = document.createElement('div');
        row.className = 'flex flex-col gap-2 py-1.5 border-b border-slate-800/40 last:border-0';

        const saveFn = debounce(async (val: string) => {
          try {
            await invoke('set_config_value', {
              basePath: gamePath.value,
              key: key,
              value: val,
            });
            showToast(getTranslation('toast.saved'));
          } catch (err) {
            console.error(err);
          }
        }, 700);

        const translatedAlias =
          getTranslation(`tweaks.configs.${key}.alias`) !== `tweaks.configs.${key}.alias`
            ? getTranslation(`tweaks.configs.${key}.alias`)
            : configMeta.alias || key;

        const translatedDesc =
          getTranslation(`tweaks.configs.${key}.desc`) !== `tweaks.configs.${key}.desc`
            ? getTranslation(`tweaks.configs.${key}.desc`)
            : configMeta.desc || '';

        const isToggle =
          configMeta.options &&
          configMeta.options.length === 2 &&
          ((configMeta.options[0].value === '0' && configMeta.options[1].value === '1') ||
            (configMeta.options[0].value === '1' && configMeta.options[1].value === '0'));

        if (isToggle) {
          row.className =
            'flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0';
          row.innerHTML = `
            <div class="flex flex-col">
              <span class="text-sm text-slate-200 font-semibold">${translatedAlias}</span>
              <span class="text-xs text-slate-400 max-w-[340px]">${translatedDesc}</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" class="tweak-toggle" data-key="${key}" ${value === '1' ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
          `;

          const toggleInput = row.querySelector('.tweak-toggle') as HTMLInputElement;
          toggleInput.addEventListener('change', () => {
            saveFn(toggleInput.checked ? '1' : '0');
          });
        } else if (
          configMeta.type === 'number' &&
          configMeta.min !== undefined &&
          configMeta.max !== undefined
        ) {
          row.innerHTML = `
            <div class="flex items-center justify-between">
              <div class="flex flex-col">
                <span class="text-sm text-slate-200 font-semibold">${translatedAlias}</span>
                <span class="text-xs text-slate-400 max-w-[400px]">${translatedDesc}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="tweak-value-text text-sm font-semibold text-sky-400" id="tweak-val-${key}">${value || configMeta.min}</span>
                <span class="text-[11px] text-slate-500 font-normal" id="tweak-sub-${key}">${key === 'maxFPS' && value === '0' ? getTranslation('tweaks.uncapped') : ''}</span>
              </div>
            </div>
            <input type="range" class="tweak-range w-full accent-sky-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer mt-1" data-key="${key}" min="${configMeta.min}" max="${configMeta.max}" step="${configMeta.step || 1}" value="${value || configMeta.min}" />
          `;

          const rangeInput = row.querySelector('.tweak-range') as HTMLInputElement;
          const valDisplay = row.querySelector(`#tweak-val-${key}`) as HTMLSpanElement;
          const subDisplay = row.querySelector(`#tweak-sub-${key}`) as HTMLSpanElement;

          rangeInput.addEventListener('input', () => {
            valDisplay.textContent = rangeInput.value;
            if (key === 'maxFPS') {
              subDisplay.textContent =
                rangeInput.value === '0' ? getTranslation('tweaks.uncapped') : '';
            }
          });

          rangeInput.addEventListener('change', () => {
            saveFn(rangeInput.value);
          });
        } else if (configMeta.options && configMeta.options.length > 0) {
          row.className =
            'flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0';

          let optionsHtml = configMeta.options
            .map(
              (opt) =>
                `<option value="${opt.value}" ${opt.value === value ? 'selected' : ''}>${opt.label}</option>`
            )
            .join('');

          const found = configMeta.options.some((opt) => opt.value === value);
          if (!found && value !== '') {
            optionsHtml += `<option value="${value}" selected>Custom (${value})</option>`;
          }

          row.innerHTML = `
            <div class="flex flex-col">
              <span class="text-sm text-slate-200 font-semibold">${translatedAlias}</span>
              <span class="text-xs text-slate-400 max-w-[340px]">${translatedDesc}</span>
            </div>
            <select class="tweak-select bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2.5 py-1.5 outline-none focus:border-slate-500 cursor-pointer w-48">
              ${optionsHtml}
            </select>
          `;

          const selectEl = row.querySelector('.tweak-select') as HTMLSelectElement;
          selectEl.addEventListener('change', () => {
            saveFn(selectEl.value);
          });
        }

        itemsContainer.appendChild(row);
      });

      card.appendChild(itemsContainer);
      contentPanel.appendChild(card);
    }

    mainContainer.appendChild(sidebar);
    mainContainer.appendChild(contentPanel);
    configTree.appendChild(mainContainer);
  } catch (err) {
    configTree.innerHTML = `<div class="text-slate-400">${getTranslation('tweaks.unable', { error: String(err) })}</div>`;
  } finally {
    clearLoadingState(statusFooter, activityProgress);
  }
}
navTabs.forEach((tab) => {
  tab.addEventListener('click', async () => {
    const tabName = tab.getAttribute('data-tab');

    navTabs.forEach((t) => {
      t.classList.remove('active', 'border-slate-400', 'text-slate-100');
      t.classList.add('border-transparent', 'text-slate-400');
    });
    tab.classList.add('active', 'border-slate-400', 'text-slate-100');
    tab.classList.remove('border-transparent', 'text-slate-400');

    const importBtn = document.getElementById('importAddonBtn');
    const openModsBtn = document.getElementById('openModsFolder');
    const getAddonsBtn = document.getElementById('getAddonsBtn');
    if (importBtn && openModsBtn) {
      if (tabName === 'addons') {
        importBtn.classList.remove('hidden');
        getAddonsBtn?.classList.remove('hidden');
        openModsBtn.classList.add('hidden');
      } else if (tabName === 'mods') {
        importBtn.classList.add('hidden');
        getAddonsBtn?.classList.add('hidden');
        openModsBtn.classList.remove('hidden');
      } else {
        importBtn.classList.add('hidden');
        getAddonsBtn?.classList.add('hidden');
        openModsBtn.classList.add('hidden');
      }
    }

    tabContents.forEach(async (content) => {
      if (content.id === `${tabName}-tab`) {
        content.classList.remove('hidden');
        if (tabName === 'addons' || tabName === 'mods') {
          await loadAddonsAndPatches();
        }
        if (tabName === 'tweaks') {
          await loadConfig();
        }
      } else {
        content.classList.add('hidden');
      }
    });
  });
});

function restoreSettingsBackup() {
  if (!settingsBackup) return;
  gamePath.value = settingsBackup.path;
  if (windowSizeSelect) windowSizeSelect.value = settingsBackup.windowSize;
  stayOpen.checked = settingsBackup.stayOpen;
}

settingsBtn?.addEventListener('click', () => {
  settingsBackup = {
    path: gamePath.value,
    windowSize: windowSizeSelect?.value ?? '1280x720',
    stayOpen: stayOpen.checked,
  };
  settingsModal?.classList.remove('hidden');
});

const closeSettingsModal = () => {
  restoreSettingsBackup();
  settingsModal?.classList.add('hidden');
};

closeSettings?.addEventListener('click', closeSettingsModal);

settingsModal?.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    closeSettingsModal();
  }
});

cancelSettingsButton?.addEventListener('click', closeSettingsModal);

applySettingsButton?.addEventListener('click', async () => {
  if (windowSizeSelect) {
    await setLauncherWindowSize(windowSizeSelect.value);
  }
  await saveSettings();
  settingsBackup = null;
  settingsModal.classList.add('hidden');
  statusFooter.textContent = getTranslation('status.saved');

  const activeTab = document.querySelector('.nav-tab.active');
  if (activeTab) {
    const tabName = activeTab.getAttribute('data-tab');
    if (tabName === 'addons' || tabName === 'mods') {
      await loadAddonsAndPatches();
    } else if (tabName === 'tweaks') {
      await loadConfig();
    }
  }
});

minimizeBtn?.addEventListener('click', async () => {
  try {
    await invoke('minimize_window');
  } catch {
    console.error('Minimize failed');
  }
});

document.querySelector('.titlebar')?.addEventListener('dblclick', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

windowCloseBtn?.addEventListener('click', async () => {
  try {
    await invoke('close_window');
  } catch {
    console.error('Close failed');
  }
});

browseGamePathBtn?.addEventListener('click', async () => {
  try {
    const selectedFolder = await invoke<string>('pick_folder');
    if (selectedFolder) {
      gamePath.value = selectedFolder;
      statusFooter.textContent = getTranslation('status.ready');
    }
  } catch (error) {
    console.error('Browse game path failed', error);
    statusFooter.textContent = getTranslation('status.ready');
  }
});

const defaultLauncherSize = '1280x720';

async function loadSavedSettings() {
  try {
    const saved = await invoke<LauncherSettings>('load_settings');
    if (saved?.path) {
      gamePath.value = saved.path;
    }
    if (windowSizeSelect && saved?.windowSize) {
      windowSizeSelect.value = saved.windowSize;
      await setLauncherWindowSize(saved.windowSize);
    }
    if (saved?.stayOpen !== undefined) {
      stayOpen.checked = saved.stayOpen;
    }
  } catch {
    if (windowSizeSelect) {
      windowSizeSelect.value = defaultLauncherSize;
      setLauncherWindowSize(defaultLauncherSize).catch(() => undefined);
    }
  }
}

async function saveSettings() {
  const settings: LauncherSettings = {
    path: gamePath.value,
    windowSize: windowSizeSelect?.value || defaultLauncherSize,
    stayOpen: stayOpen.checked,
  };

  await invoke('save_settings', { settings });
}

playBtn?.addEventListener('click', async () => {
  if (playBtn) playBtn.disabled = true;
  setLoadingState(getTranslation('status.launching'), 20, statusFooter, activityProgress);

  try {
    await invoke<string>('launch_game', {
      basePath: gamePath.value,
      stayOpen: stayOpen.checked,
    });

    setLoadingState(getTranslation('status.launched'), 100, statusFooter, activityProgress);
    if (!stayOpen.checked) {
      await invoke('close_window');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    statusFooter.textContent = `Error: ${errorMessage}`;
  } finally {
    if (playBtn) playBtn.disabled = false;
    setTimeout(clearLoadingState, 1200);
  }
});

openModsBtn?.addEventListener('click', async () => {
  try {
    await invoke('open_folder', { basePath: gamePath.value, relPath: 'Data' });
    statusFooter.textContent = getTranslation('status.openDataFolder');
  } catch (err) {
    statusFooter.textContent = `Error: ${err}`;
  }
});

importAddonBtn?.addEventListener('click', async () => {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
  overlay.innerHTML = `
    <div class="w-full max-w-lg rounded-lg bg-slate-900 border border-slate-700 p-6 shadow-lg">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="text-lg font-semibold text-slate-100">${getTranslation('import.title')}</h3>
          <p class="text-sm text-slate-400">${getTranslation('import.description')}</p>
        </div>
        <button type="button" id="importCancelBtn" class="text-slate-400 hover:text-slate-200">✕</button>
      </div>
      <div class="grid gap-3">
        <button id="importGithubBtn" class="w-full rounded bg-slate-800 px-4 py-3 text-left text-slate-100 hover:bg-slate-700">
          <div class="font-semibold">${getTranslation('import.github')}</div>
          <div class="text-sm text-slate-400">${getTranslation('import.githubDesc')}</div>
        </button>
        <button id="importFileBtn" class="w-full rounded bg-slate-800 px-4 py-3 text-left text-slate-100 hover:bg-slate-700">
          <div class="font-semibold">${getTranslation('import.file')}</div>
          <div class="text-sm text-slate-400">${getTranslation('import.fileDesc')}</div>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const closeOverlay = () => overlay.remove();
  const githubBtn = overlay.querySelector('#importGithubBtn') as HTMLButtonElement;
  const fileBtn = overlay.querySelector('#importFileBtn') as HTMLButtonElement;
  const cancelBtn = overlay.querySelector('#importCancelBtn') as HTMLButtonElement;

  cancelBtn.addEventListener('click', () => closeOverlay());

  githubBtn.addEventListener('click', async () => {
    closeOverlay();
    const repoUrl = await showTextInputModal({
      title: getTranslation('import.github'),
      label: getTranslation('import.githubDesc'),
      placeholder: 'https://github.com/user/repo',
      submitText: getTranslation('settings.apply'),
      cancelText: getTranslation('settings.cancel'),
    });
    if (!repoUrl) return;
    try {
      statusFooter.textContent = getTranslation('status.importing');
      await invoke('import_addon', { basePath: gamePath.value, repoUrl });
      await loadAddonsAndPatches();
      statusFooter.textContent = getTranslation('status.imported');
      showToast(getTranslation('toast.imported'));
    } catch (err) {
      statusFooter.textContent = `Error: ${err}`;
    }
  });

  fileBtn.addEventListener('click', async () => {
    closeOverlay();
    try {
      const filePaths = await invoke<string[]>('pick_files');
      if (!filePaths || filePaths.length === 0) return;

      statusFooter.textContent = getTranslation('status.importingFiles');
      await invoke('import_addon_files', { basePath: gamePath.value, filePaths });
      await loadAddonsAndPatches();
      statusFooter.textContent = getTranslation('status.imported');
      showToast(getTranslation('toast.imported'));
    } catch (err) {
      statusFooter.textContent = `Error: ${err}`;
    }
  });
});

const themeToggleBtn = document.getElementById('themeToggleBtn');
if (localStorage.getItem('theme') === 'light') {
  document.body.classList.add('light-mode');
}
themeToggleBtn?.addEventListener('click', () => {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
});

langBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  langDropdown?.classList.toggle('hidden');
});

document.addEventListener('click', () => {
  langDropdown?.classList.add('hidden');
});

document.querySelectorAll('.lang-option').forEach((btn) => {
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    langDropdown?.classList.add('hidden');
    const selectedLang = btn.getAttribute('data-lang') as 'en' | 'es' | 'pt';
    if (selectedLang) {
      setAppLanguage(selectedLang);
      const activeTab = document.querySelector('.nav-tab.active');
      if (activeTab) {
        const tabName = activeTab.getAttribute('data-tab');
        if (tabName === 'addons' || tabName === 'mods') {
          await loadAddonsAndPatches();
        } else if (tabName === 'tweaks') {
          await loadConfig();
        }
      }
    }
  });
});

if (statusFooter) {
  loadSavedSettings().then(() => {
    translateDOM();
    setupStoreEvents();
    setupMainSearchEvents();
    setupSearchHoverBehavior();
    loadAddonsAndPatches();
    const activeTab = document.querySelector('.nav-tab.active');
    const tabName = activeTab ? activeTab.getAttribute('data-tab') : 'addons';
    const importBtn = document.getElementById('importAddonBtn');
    const openModsBtn = document.getElementById('openModsFolder');
    const getAddonsBtn = document.getElementById('getAddonsBtn');
    if (importBtn && openModsBtn && tabName) {
      if (tabName === 'addons') {
        importBtn.classList.remove('hidden');
        getAddonsBtn?.classList.remove('hidden');
        openModsBtn.classList.add('hidden');
      } else if (tabName === 'mods') {
        importBtn.classList.add('hidden');
        getAddonsBtn?.classList.add('hidden');
        openModsBtn.classList.remove('hidden');
      } else {
        importBtn.classList.add('hidden');
        getAddonsBtn?.classList.add('hidden');
        openModsBtn.classList.add('hidden');
      }
    }
  });
}

// Store implementation and search functions
interface CatalogAddon {
  name: string;
  title: string;
  description: string;
  downloadUrl?: string;
  modId?: number;
  logoUrl?: string;
  authors?: string;
  websiteUrl?: string;
  issuesUrl?: string;
  sourceUrl?: string;
  donationUrl?: string;
}

interface AddonVersion {
  id: number;
  displayName: string;
  fileName: string;
  releaseType: number; // 1 = Release, 2 = Beta, 3 = Alpha
  downloadUrl: string;
  gameVersions: string[];
  sha1?: string | null;
}

// Map of key -> { addon: CatalogAddon, selectedVersion: AddonVersion }
const selectedAddons = new Map<string, { addon: CatalogAddon; selectedVersion: AddonVersion }>();
let currentActiveSite: 'curseforge' | 'mock' | 'github' = 'curseforge';
let selectedDetailAddon: CatalogAddon | null = null;
let selectedDetailAddonKey = '';
let currentDetailVersions: AddonVersion[] = [];
let detectedGameVersion = '3.3.5a';

function getReleaseTypeName(type: number): string {
  switch (type) {
    case 1:
      return getTranslation('store.releaseType.release');
    case 2:
      return getTranslation('store.releaseType.beta');
    case 3:
      return getTranslation('store.releaseType.alpha');
    default:
      return getTranslation('store.releaseType.unknown');
  }
}

function setupStoreEvents() {
  const getAddonsBtn = document.getElementById('getAddonsBtn');
  const storeModal = document.getElementById('storeModal');
  const storeCancelBtn = document.getElementById('storeCancelBtn');
  const storeReviewBtn = document.getElementById('storeReviewBtn') as HTMLButtonElement | null;
  const storeSearchInput = document.getElementById('storeSearchInput') as HTMLInputElement | null;
  const storeSearchClearBtn = document.getElementById(
    'storeSearchClearBtn'
  ) as HTMLButtonElement | null;
  const storeSidebarTabs = document.querySelectorAll('.store-sidebar-tab');
  let debounceTimer: any = null;

  // Modal Open/Close
  getAddonsBtn?.addEventListener('click', async () => {
    storeModal?.classList.remove('hidden');
    selectedAddons.clear();
    updateFooterState();

    // Synchronously reset active tab and clear inputs/timers to avoid state leaks
    currentActiveSite = 'curseforge';
    if (storeSearchInput) {
      storeSearchInput.value = '';
      storeSearchClearBtn?.classList.add('hidden');
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    try {
      detectedGameVersion = await invoke<string>('detect_game_version', { basePath: gamePath.value });
    } catch (err) {
      console.error('Failed to detect game version:', err);
      detectedGameVersion = '3.3.5a';
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

  // Search input clear button
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

  // Search input debounce
  storeSearchInput?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      triggerSearch();
    }, 400);
  });

  // Site selector tabs
  storeSidebarTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const site = tab.getAttribute('data-site') as 'curseforge' | 'mock' | 'github';
      if (site) {
        switchSiteTab(site);
      }
    });
  });

  // GitHub tag pills click listeners are bound dynamically inside renderGithubTagFilters()

  // CurseForge category dropdown selector listener
  const cfSelectElement = document.getElementById('curseforgeCategorySelect');
  cfSelectElement?.addEventListener('change', () => {
    triggerSearch();
  });

  // Review Modal Setup
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
        <td class="p-2 text-slate-400 font-mono text-[10px] break-all">${escapeHtml(item.selectedVersion.fileName)}</td>
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

  // Sequential Downloading
  confirmConfirm?.addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll(
      '.confirm-addon-checkbox'
    ) as NodeListOf<HTMLInputElement>;
    const itemsToDownload: { key: string; addon: CatalogAddon; version: AddonVersion }[] = [];

    checkboxes.forEach((cb) => {
      if (cb.checked) {
        const key = cb.getAttribute('data-key');
        if (key) {
          const item = selectedAddons.get(key);
          if (item) {
            itemsToDownload.push({ key, addon: item.addon, version: item.selectedVersion });
          }
        }
      }
    });

    if (itemsToDownload.length === 0) return;

    // Disable modal controls
    confirmConfirm.disabled = true;
    if (confirmCancel) confirmCancel.disabled = true;

    setLoadingState('Downloading addons...', 10, statusFooter, activityProgress);

    let successCount = 0;
    for (let i = 0; i < itemsToDownload.length; i++) {
      const { key, addon, version } = itemsToDownload[i];
      const row = document.querySelector(`tr[data-key="${key}"]`);
      const statusCell = row?.querySelector('.store-status-cell');

      if (statusCell) {
        statusCell.innerHTML = `
          <span class="flex items-center gap-1.5 animate-pulse text-sky-400">
            <svg class="animate-spin h-3 w-3 text-sky-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Downloading...
          </span>
        `;
      }
      statusFooter.textContent = getTranslation('status.downloadingAddon', { name: addon.title });

      try {
        if (statusCell) {
          statusCell.innerHTML = `
            <span class="flex items-center gap-1.5 animate-pulse text-yellow-400">
              <svg class="animate-spin h-3 w-3 text-yellow-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Installing...
            </span>
          `;
        }
        statusFooter.textContent = getTranslation('status.installingAddon', { name: addon.title });

        await invoke<string>('download_and_extract_addon', {
          basePath: gamePath.value,
          url: version.downloadUrl,
          sha1: version.sha1 || null,
        });

        if (statusCell) {
          statusCell.innerHTML = `<span class="text-emerald-400 font-bold">✓ Installed</span>`;
        }
        successCount++;
      } catch (err) {
        console.error(err);
        if (statusCell) {
          statusCell.innerHTML = `<span class="text-red-400 font-bold" title="${err}">❌ Failed</span>`;
        }
      }
    }

    statusFooter.textContent = `Completed downloading. Installed ${successCount} of ${itemsToDownload.length} successfully.`;
    showToast(`Installed ${successCount} addons!`);

    confirmConfirm.disabled = false;
    if (confirmCancel) confirmCancel.disabled = false;

    setTimeout(() => {
      closeConfirmModal();
      closeStore();
      clearLoadingState(statusFooter, activityProgress);
      loadAddonsAndPatches();
    }, 1500);
  });
}

function triggerSearch() {
  const storeSearchInput = document.getElementById('storeSearchInput') as HTMLInputElement | null;
  const query = storeSearchInput?.value.trim() || '';
  if (currentActiveSite === 'github') {
    searchGithub(query);
  } else {
    searchCurseForge(query);
  }
}

function switchSiteTab(site: 'curseforge' | 'mock' | 'github') {
  currentActiveSite = site;
  const storeSearchInput = document.getElementById('storeSearchInput') as HTMLInputElement | null;
  const storeSearchClearBtn = document.getElementById(
    'storeSearchClearBtn'
  ) as HTMLButtonElement | null;

  if (storeSearchInput) {
    storeSearchInput.value = '';
    storeSearchClearBtn?.classList.add('hidden');
  }

  // Toggle github filters visibility
  const githubFilters = document.getElementById('githubTagFilters');
  if (githubFilters) {
    if (site === 'github') {
      githubFilters.classList.remove('hidden');
    } else {
      githubFilters.classList.add('hidden');
    }
  }

  // Toggle github warning banner visibility
  const githubWarning = document.getElementById('githubWarningBanner');
  if (githubWarning) {
    if (site === 'github') {
      githubWarning.classList.remove('hidden');
    } else {
      githubWarning.classList.add('hidden');
    }
  }

  // Toggle curseforge category filters visibility
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

  // Update tabs visual active state
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

  // Clear details pane
  clearDetailsPane();

  // Trigger initial list render
  if (site === 'github') {
    searchGithub('');
  } else {
    searchCurseForge('');
  }
}

function clearDetailsPane() {
  selectedDetailAddon = null;
  selectedDetailAddonKey = '';
  currentDetailVersions = [];
  const detailsContent = document.getElementById('storeDetailsContent');
  if (detailsContent) {
    detailsContent.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs text-center" data-i18n="store.selectAddonHint">
        ${getTranslation('store.selectAddonHint')}
      </div>
    `;
  }
}

function renderStoreCatalog(addons: CatalogAddon[], _site: 'curseforge' | 'mock' | 'github') {
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
      currentActiveSite === 'github'
        ? `gh-${addon.modId}`
        : addon.modId
          ? `cf-${addon.modId}`
          : `mock-${index}-${addon.name.replace(/\s+/g, '')}`;
    const isChecked = selectedAddons.has(key);
    const isSelectedDetails =
      selectedDetailAddon &&
      selectedDetailAddon.modId === addon.modId &&
      selectedDetailAddon.name === addon.name;

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

    // Handle check box click
    const checkbox = card.querySelector('.store-addon-checkbox') as HTMLInputElement;
    checkbox.addEventListener('change', async () => {
      if (checkbox.checked) {
        await selectAddonForDownload(key, addon);
        if (selectedDetailAddon && selectedDetailAddonKey === key) {
          updateDetailsSelectionButton();
        }
      } else {
        selectedAddons.delete(key);
        updateFooterState();
        card.classList.remove('selected', 'border-sky-600/30');
        if (selectedDetailAddon && selectedDetailAddonKey === key) {
          updateDetailsSelectionButton();
        }
      }
    });

    // Handle card select click
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

async function selectAddonForDownload(
  key: string,
  addon: CatalogAddon,
  specificVersion?: AddonVersion
) {
  if (specificVersion) {
    selectedAddons.set(key, { addon, selectedVersion: specificVersion });
    updateFooterState();

    const card = document.querySelector(`.store-addon-card[data-key="${key}"]`);
    if (card) {
      card.classList.add('selected', 'border-sky-600/30');
      const cb = card.querySelector('.store-addon-checkbox') as HTMLInputElement;
      if (cb) cb.checked = true;
    }
    return;
  }

  try {
    let compatible: AddonVersion[] = [];
    if (currentActiveSite === 'github') {
      compatible = await fetchGithubReleases(addon.name);
    } else {
      const isMock = currentActiveSite === 'mock';
      const response = await invoke<any>('get_curseforge_mod_files', {
        modId: addon.modId,
        isMock,
      });
      const files = response.data || [];
      compatible = files
        .filter((file: any) => {
          const hasDlUrl = !!(file.downloadUrl || (file.id && file.fileName));
          if (!file.gameVersions || !hasDlUrl) return false;
          return file.gameVersions.some((v: string) => {
            if (detectedGameVersion === '1.12.1') {
              return v === '1.12' || v === '1.12.1' || v === '1.12.2';
            } else {
              return v === '3.3.5' || v === '3.3.5a' || v.startsWith('3.4.');
            }
          });
        })
        .map((file: any) => {
          const dlUrl =
            file.downloadUrl ||
            `https://edge.forgecdn.net/files/${Math.floor(file.id / 1000)}/${file.id % 1000}/${encodeURIComponent(file.fileName)}`;
          return {
            id: file.id,
            displayName: file.displayName || file.fileName,
            fileName: file.fileName,
            releaseType: file.releaseType || 1,
            downloadUrl: dlUrl,
            gameVersions: file.gameVersions,
            sha1: file.hashes?.find((h: any) => h.algo === 1)?.value || null,
          };
        });
    }

    if (compatible.length > 0) {
      selectedAddons.set(key, { addon, selectedVersion: compatible[0] });
      updateFooterState();

      const card = document.querySelector(`.store-addon-card[data-key="${key}"]`);
      if (card) {
        card.classList.add('selected', 'border-sky-600/30');
        const cb = card.querySelector('.store-addon-checkbox') as HTMLInputElement;
        if (cb) cb.checked = true;
      }
    } else {
      showToast(getTranslation('store.noCompatibleVersionToast', { title: addon.title }));
      const card = document.querySelector(`.store-addon-card[data-key="${key}"]`);
      if (card) {
        const cb = card.querySelector('.store-addon-checkbox') as HTMLInputElement;
        if (cb) cb.checked = false;
      }
    }
  } catch (err) {
    console.error(err);
    showToast(`Error fetching addon files: ${err}`);
    const card = document.querySelector(`.store-addon-card[data-key="${key}"]`);
    if (card) {
      const cb = card.querySelector('.store-addon-checkbox') as HTMLInputElement;
      if (cb) cb.checked = false;
    }
  }
}

async function loadAddonDetails(addon: CatalogAddon, key: string) {
  selectedDetailAddon = addon;
  selectedDetailAddonKey = key;
  currentDetailVersions = [];

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
    if (currentActiveSite === 'github') {
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
      const isMock = currentActiveSite === 'mock';
      const [filesRes, descRes] = await Promise.all([
        invoke<any>('get_curseforge_mod_files', { modId: addon.modId, isMock }),
        invoke<string>('get_curseforge_mod_description', { modId: addon.modId, isMock }),
      ]);

      descriptionHtml = descRes;
      const files = filesRes.data || [];
      versionsList = files
        .filter((file: any) => {
          const hasDlUrl = !!(file.downloadUrl || (file.id && file.fileName));
          if (!file.gameVersions || !hasDlUrl) return false;
          return file.gameVersions.some((v: string) => {
            if (detectedGameVersion === '1.12.1') {
              return v === '1.12' || v === '1.12.1' || v === '1.12.2';
            } else {
              return v === '3.3.5' || v === '3.3.5a' || v.startsWith('3.4.');
            }
          });
        })
        .map((file: any) => {
          const dlUrl =
            file.downloadUrl ||
            `https://edge.forgecdn.net/files/${Math.floor(file.id / 1000)}/${file.id % 1000}/${encodeURIComponent(file.fileName)}`;
          return {
            id: file.id,
            displayName: file.displayName || file.fileName,
            fileName: file.fileName,
            releaseType: file.releaseType || 1,
            downloadUrl: dlUrl,
            gameVersions: file.gameVersions,
            sha1: file.hashes?.find((h: any) => h.algo === 1)?.value || null,
          };
        });
    }

    currentDetailVersions = versionsList;

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
      const targetVersion = currentDetailVersions.find((v) => v.downloadUrl === selectVal);

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
        const targetVersion = currentDetailVersions.find((v) => v.downloadUrl === selectVal);
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

function updateDetailsSelectionButton() {
  const selectBtn = document.getElementById('detailSelectBtn') as HTMLButtonElement | null;
  if (!selectBtn || !selectedDetailAddon || !selectedDetailAddonKey) return;

  const isChecked = selectedAddons.has(selectedDetailAddonKey);

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

function updateFooterState() {
  const count = selectedAddons.size;
  const countSpan = document.getElementById('storeSelectedCount');
  if (countSpan) countSpan.textContent = count.toString();

  const reviewBtn = document.getElementById('storeReviewBtn') as HTMLButtonElement | null;
  if (reviewBtn) {
    reviewBtn.disabled = count === 0;
  }
}

function updateConfirmButtonState() {
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
    const isMock = currentActiveSite === 'mock';
    const response = await invoke<any>('search_curseforge_addons', {
      query: encodeURIComponent(query),
      categoryId,
      gameVersion: detectedGameVersion,
      isMock,
    });
    const mods = response.data || [];

    if (mods.length === 0) {
      storeList.innerHTML = '';
      if (storeEmpty) storeEmpty.classList.remove('hidden');
      return;
    }

    const catalogList: CatalogAddon[] = mods.map((mod: any) => ({
      name: mod.name,
      title: mod.name,
      description: mod.summary || 'No description available',
      modId: mod.id,
      logoUrl: mod.logo?.thumbnailUrl || '',
      authors: mod.authors ? mod.authors.map((a: any) => a.name).join(', ') : 'Unknown',
      websiteUrl: mod.links?.websiteUrl || '',
      issuesUrl: mod.links?.issuesUrl || '',
      sourceUrl: mod.links?.sourceUrl || '',
      donationUrl: mod.links?.donationUrl || '',
    }));

    renderStoreCatalog(catalogList, currentActiveSite);
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

async function fetchGithubReleases(repoFullName: string): Promise<AddonVersion[]> {
  const parts = repoFullName.split('/');
  const owner = parts[0];
  const repo = parts[1] || repoFullName;
  const url = `https://api.github.com/repos/${owner}/${repo}/releases`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
      let defaultBranch = 'master';
      if (repoRes.ok) {
        const repoJson = await repoRes.json();
        defaultBranch = repoJson.default_branch || 'master';
      }
      return [
        {
          id: 0,
          displayName: `${repo} (Source Code: ${defaultBranch})`,
          fileName: `${repo}-${defaultBranch}.zip`,
          releaseType: 1,
          downloadUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/${defaultBranch}.zip`,
          gameVersions: [detectedGameVersion],
        },
      ];
    }

    const json = await res.json();
    const versions: AddonVersion[] = [];

    json.forEach((rel: any) => {
      const releaseName = rel.name || rel.tag_name;
      let hasZip = false;
      if (rel.assets && rel.assets.length > 0) {
        rel.assets.forEach((asset: any) => {
          if (
            asset.name.toLowerCase().endsWith('.zip') ||
            asset.name.toLowerCase().endsWith('.7z')
          ) {
            versions.push({
              id: asset.id,
              displayName: `${releaseName} - ${asset.name}`,
              fileName: asset.name,
              releaseType: rel.prerelease ? 2 : 1,
              downloadUrl: asset.browser_download_url,
              gameVersions: [detectedGameVersion],
            });
            hasZip = true;
          }
        });
      }

      if (!hasZip) {
        versions.push({
          id: rel.id,
          displayName: `${releaseName} (Source Code)`,
          fileName: `${rel.tag_name}.zip`,
          releaseType: rel.prerelease ? 2 : 1,
          downloadUrl: `https://github.com/${owner}/${repo}/archive/refs/tags/${rel.tag_name}.zip`,
          gameVersions: [detectedGameVersion],
        });
      }
    });

    if (versions.length === 0) {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
      let defaultBranch = 'master';
      if (repoRes.ok) {
        const repoJson = await repoRes.json();
        defaultBranch = repoJson.default_branch || 'master';
      }
      versions.push({
        id: 0,
        displayName: `${repo} (Source Code: ${defaultBranch})`,
        fileName: `${repo}-${defaultBranch}.zip`,
        releaseType: 1,
        downloadUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/${defaultBranch}.zip`,
        gameVersions: [detectedGameVersion],
      });
    }

    return versions;
  } catch {
    return [
      {
        id: 0,
        displayName: `${repo} (Source Code: master)`,
        fileName: `${repo}-master.zip`,
        releaseType: 1,
        downloadUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/master.zip`,
        gameVersions: [detectedGameVersion],
      },
    ];
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
      tags = [detectedGameVersion === '1.12.1' ? 'vanilla-wow' : 'wotlk'];
    }

    const topicQuery = tags.map((t) => `topic:${t}`).join(' OR ');
    const q = query.trim() ? `${query.trim()} (${topicQuery})` : topicQuery;

    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`GitHub API returned status: ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    const items = json.items || [];

    if (items.length === 0) {
      storeList.innerHTML = '';
      if (storeEmpty) storeEmpty.classList.remove('hidden');
      return;
    }

    const catalogList: CatalogAddon[] = items.map((mod: any) => ({
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

  const tags = detectedGameVersion === '1.12.1'
    ? ['vanilla-wow', 'classic-wow', 'wow-classic', '1-12-1']
    : ['wotlk', 'wow-classic', 'world-of-warcraft', 'warcraft'];

  container.innerHTML = tags.map((tag, idx) => {
    const isActive = idx === 0;
    const activeClasses = 'bg-sky-600/20 border-sky-500 text-sky-400 hover:bg-sky-600/30 active';
    const inactiveClasses = 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-slate-200';
    return `<button class="github-tag-pill px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all duration-150 cursor-pointer outline-none ${isActive ? activeClasses : inactiveClasses}" data-tag="${tag}">${tag}</button>`;
  }).join('');

  // Bind click listeners
  const pills = container.querySelectorAll('.github-tag-pill');
  pills.forEach((pill) => {
    pill.addEventListener('click', () => {
      if (pill.classList.contains('active')) {
        pill.classList.remove('active', 'bg-sky-600/20', 'border-sky-500', 'text-sky-400', 'hover:bg-sky-600/30');
        pill.classList.add('bg-slate-800', 'border-slate-700', 'text-slate-400', 'hover:bg-slate-700', 'hover:text-slate-200');
      } else {
        pill.classList.add('active', 'bg-sky-600/20', 'border-sky-500', 'text-sky-400', 'hover:bg-sky-600/30');
        pill.classList.remove('bg-slate-800', 'border-slate-700', 'text-slate-400', 'hover:bg-slate-700', 'hover:text-slate-200');
      }
      triggerSearch();
    });
  });
}

function setupMainSearchEvents() {
  const addonsSearch = document.getElementById('addons-search') as HTMLInputElement | null;
  const addonsClear = document.getElementById('addons-search-clear') as HTMLButtonElement | null;
  const patchesSearch = document.getElementById('patches-search') as HTMLInputElement | null;
  const patchesClear = document.getElementById('patches-search-clear') as HTMLButtonElement | null;

  const toggleClear = (input: HTMLInputElement, clearBtn: HTMLButtonElement | null) => {
    if (!clearBtn) return;
    if (input.value.trim().length > 0) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  };

  addonsSearch?.addEventListener('input', () => {
    toggleClear(addonsSearch, addonsClear);
    const query = addonsSearch.value.toLowerCase().trim();
    const addonRows = document.querySelectorAll('#addons-list > div') as NodeListOf<HTMLDivElement>;
    addonRows.forEach((row) => {
      const addonName = row.getAttribute('data-addon')?.toLowerCase() || '';
      const text = row.textContent?.toLowerCase() || '';
      if (addonName.includes(query) || text.includes(query)) {
        row.classList.remove('hidden');
        row.style.display = '';
      } else {
        row.classList.add('hidden');
        row.style.display = 'none';
      }
    });
  });

  addonsClear?.addEventListener('click', () => {
    if (addonsSearch) {
      addonsSearch.value = '';
      addonsSearch.dispatchEvent(new Event('input'));
      addonsSearch.focus();
    }
  });

  patchesSearch?.addEventListener('input', () => {
    toggleClear(patchesSearch, patchesClear);
    const query = patchesSearch.value.toLowerCase().trim();
    const patchRows = document.querySelectorAll(
      '#patches-list > div'
    ) as NodeListOf<HTMLDivElement>;
    patchRows.forEach((row) => {
      const patchName = row.getAttribute('data-patch')?.toLowerCase() || '';
      const text = row.textContent?.toLowerCase() || '';
      if (patchName.includes(query) || text.includes(query)) {
        row.classList.remove('hidden');
        row.style.display = '';
      } else {
        row.classList.add('hidden');
        row.style.display = 'none';
      }
    });
  });

  patchesClear?.addEventListener('click', () => {
    if (patchesSearch) {
      patchesSearch.value = '';
      patchesSearch.dispatchEvent(new Event('input'));
      patchesSearch.focus();
    }
  });
}

function setupSearchHoverBehavior() {
  const containers = document.querySelectorAll('.search-container');
  containers.forEach((container) => {
    const input = container.querySelector('.search-input') as HTMLInputElement | null;
    if (!input) return;

    let timer: any = null;

    const showInput = () => {
      clearTimeout(timer);
      input.classList.add('active');
    };

    const hideInputWithDelay = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (input !== document.activeElement && input.value.trim().length === 0) {
          input.classList.remove('active');
        }
      }, 3000); // 3 seconds delay
    };

    container.addEventListener('mouseenter', showInput);
    container.addEventListener('mouseleave', hideInputWithDelay);

    input.addEventListener('focus', () => {
      clearTimeout(timer);
    });

    input.addEventListener('blur', () => {
      if (!container.matches(':hover')) {
        hideInputWithDelay();
      }
    });
  });
}

// --- DEBUG CONSOLE LOGGER & SHORTCUT ---
interface LogEntry {
  type: 'error' | 'warn' | 'log';
  message: string;
  timestamp: string;
}

const debugLogs: LogEntry[] = [];
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;

function updateDebugConsoleUI() {
  const container = document.getElementById('debugLogsContainer');
  if (!container) return;
  container.innerHTML = debugLogs
    .map((log) => {
      let classType = 'log-info';
      if (log.type === 'error') {
        classType = 'log-error';
      } else if (log.type === 'warn') {
        classType = 'log-warn';
      }
      return `<div class="${classType}">[${log.timestamp}] [${log.type.toUpperCase()}] ${escapeHtml(log.message)}</div>`;
    })
    .join('');
  container.scrollTop = container.scrollHeight;
}

function addDebugLog(type: 'error' | 'warn' | 'log', ...args: any[]) {
  const message = args
    .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
    .join(' ');
  const timestamp = new Date().toLocaleTimeString();
  debugLogs.push({ type, message, timestamp });

  if (debugLogs.length > 500) {
    debugLogs.shift();
  }

  updateDebugConsoleUI();
}

console.error = function (...args: any[]) {
  addDebugLog('error', ...args);
  originalConsoleError.apply(console, args);
};

console.warn = function (...args: any[]) {
  addDebugLog('warn', ...args);
  originalConsoleWarn.apply(console, args);
};

console.log = function (...args: any[]) {
  addDebugLog('log', ...args);
  originalConsoleLog.apply(console, args);
};

window.addEventListener('error', (e) => {
  addDebugLog('error', `Uncaught Exception: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`);
});

window.addEventListener('unhandledrejection', (e) => {
  addDebugLog('error', `Unhandled Promise Rejection: ${e.reason}`);
});

function toggleDebugConsole() {
  const modal = document.getElementById('debugConsoleModal');
  if (!modal) return;
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) {
    updateDebugConsoleUI();
  }
}

// Listen for update available event
listen('update-available', () => {
  const updateAvailableBtn = document.getElementById('updateAvailableBtn');
  if (updateAvailableBtn) {
    updateAvailableBtn.classList.remove('hidden');
  }
});

document.getElementById('updateAvailableBtn')?.addEventListener('click', async () => {
  try {
    if (statusFooter) statusFooter.textContent = 'Updating...';
    await invoke('install_update');
  } catch (err) {
    if (statusFooter) statusFooter.textContent = `Update error: ${err}`;
  }
});

// Setup Debug Console events when DOM is loaded
function setupDebugConsoleEvents() {
  const closeBtn = document.getElementById('debugCloseBtn');
  const copyBtn = document.getElementById('debugCopyBtn');
  const clearBtn = document.getElementById('debugClearBtn');
  const modal = document.getElementById('debugConsoleModal');

  closeBtn?.addEventListener('click', toggleDebugConsole);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      toggleDebugConsole();
    }
  });

  clearBtn?.addEventListener('click', () => {
    debugLogs.length = 0;
    updateDebugConsoleUI();
  });

  copyBtn?.addEventListener('click', async () => {
    const text = debugLogs
      .map((log) => `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast('Logs copied to clipboard!');
    } catch (err) {
      originalConsoleError('Failed to copy logs:', err);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      toggleDebugConsole();
    }
  });
}

// Execute setup
setupDebugConsoleEvents();
