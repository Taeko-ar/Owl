import './style.css';
import { invoke } from '@tauri-apps/api/core';
import {
  debounce,
  escapeHtml,
  formatWithColorCodes,
  getConfigMetadata,
  renderMarkdown,
  showTextInputModal,
  showToast,
  setLoadingState,
  clearLoadingState,
  parsePatchFilename,
} from './utils';
import { setLauncherWindowSize } from './main-utils';
import { translations, getTranslation, translateDOM, setAppLanguage } from './i18n';

export { translations, getTranslation, translateDOM, setAppLanguage };

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
          const addon = (e.currentTarget as HTMLButtonElement).getAttribute('data-addon');
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
          const patch = (e.currentTarget as HTMLButtonElement).getAttribute('data-patch');
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
    if (importBtn && openModsBtn) {
      if (tabName === 'addons') {
        importBtn.classList.remove('hidden');
        openModsBtn.classList.add('hidden');
      } else if (tabName === 'mods') {
        importBtn.classList.add('hidden');
        openModsBtn.classList.remove('hidden');
      } else {
        importBtn.classList.add('hidden');
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
    loadAddonsAndPatches();
    const activeTab = document.querySelector('.nav-tab.active');
    const tabName = activeTab ? activeTab.getAttribute('data-tab') : 'addons';
    const importBtn = document.getElementById('importAddonBtn');
    const openModsBtn = document.getElementById('openModsFolder');
    if (importBtn && openModsBtn && tabName) {
      if (tabName === 'addons') {
        importBtn.classList.remove('hidden');
        openModsBtn.classList.add('hidden');
      } else if (tabName === 'mods') {
        importBtn.classList.add('hidden');
        openModsBtn.classList.remove('hidden');
      } else {
        importBtn.classList.add('hidden');
        openModsBtn.classList.add('hidden');
      }
    }
  });
}
