import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setLoadingState, clearLoadingState } from './utils';
import { setupSettingsEvents, loadSavedSettings, checkLauncherUpdates } from './ui/settings';
import { translations, getTranslation, translateDOM, setAppLanguage } from './i18n';
import { setupStoreEvents } from './store';
import { setupMainSearchEvents, setupSearchHoverBehavior } from './ui/search';
import { setupImportModalEvents } from './ui/import';
import { setupImportExportEvents } from './ui/import-export';
import { setupGitStatusEvents } from './ui/git-status';
import { loadAddonsAndPatches, setupAddonProfileEvents } from './tabs/addons';
import { loadConfig } from './tabs/tweaks';
import { setupDebugConsoleEvents } from './ui/debug-console';
import { Prefs } from './prefs';
import { setupTorrentEvents } from './ui/torrent';

interface ExtendedWindow {
  __TAURI_INTERNALS__?: {
    invoke: (cmd: string, args?: unknown) => Promise<unknown>;
    transformCallback: (cb: (...args: unknown[]) => void, once?: boolean) => string;
    postMessage: () => void;
  };
  __TAURI_EVENT_PLUGIN_INTERNALS__?: {
    unregisterListener: () => void;
  };
  __OWL_INVOKE_MOCK__?: (cmd: string, args?: unknown) => Promise<unknown>;
  __OWL_MOCK_PROFILES__?: { name: string; enabledAddons: string[] }[];
  __OWL_MOCK_ACTIVE_PROFILE__?: string | null;
  __OWL_MOCK_ADDONS__?: string[];
  __OWL_MOCK_PATCHES__?: string[];
  __OWL_MOCK_VALIDATE_GAME_PATH__?: boolean;
  __OWL_MOCK_CF_RESULTS__?: unknown;
  __OWL_MOCK_CF_FILES__?: unknown;
  __OWL_MOCK_GH_RESULTS__?: unknown;
  __OWL_MOCK_GH_RELEASES__?: unknown;
  __OWL_MOCK_EXPORT_STRING__?: string;
  __OWL_MOCK_IMPORT_PAYLOAD__?: unknown;
  [key: string]: unknown;
}

const win = (typeof window !== 'undefined' ? window : {}) as unknown as ExtendedWindow;

// Fallback stub for Tauri window globals in non-Tauri environments
if (typeof window !== 'undefined' && !win.__TAURI_INTERNALS__) {
  win.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args?: unknown) => {
      if (typeof win.__OWL_INVOKE_MOCK__ === 'function') {
        return win.__OWL_INVOKE_MOCK__(cmd, args);
      }
      console.warn(`[Tauri Mock Fallback] invoke(${cmd}) called in browser context`, args);

      switch (cmd) {
        case 'load_settings':
          return {
            path: 'C:\\\\wow',
            windowSize: '1280x720',
            stayOpen: true,
            addonProfiles: win.__OWL_MOCK_PROFILES__ || [],
            activeProfile: win.__OWL_MOCK_ACTIVE_PROFILE__ || null,
          };
        case 'get_addon_profiles':
          return win.__OWL_MOCK_PROFILES__ || [];
        case 'get_addons':
          return win.__OWL_MOCK_ADDONS__ || [];
        case 'get_patches':
          return win.__OWL_MOCK_PATCHES__ || [];
        case 'validate_game_path':
          return win.__OWL_MOCK_VALIDATE_GAME_PATH__ !== undefined
            ? win.__OWL_MOCK_VALIDATE_GAME_PATH__
            : true;
        case 'get_active_downloads':
          return [];
        case 'check_update_details':
          return {
            version: '1.2.0',
            body: 'Added amazing features!\n- Feature 1\n- Feature 2',
          };
        case 'get_app_version':
          return '1.1.0';
        case 'git_status':
          return { status: 'up_to_date', branch: 'main' };
        case 'read_config':
          return {};
        case 'parse_toc': {
          const parsedArgs = args as { addonName?: string } | undefined;
          return {
            name: parsedArgs?.addonName || 'TestAddon',
            title: parsedArgs?.addonName || 'Test Addon',
            author: 'TestAuthor',
            version: '1.0.0',
            hasGit: false,
            description: 'A test addon',
          };
        }
        case 'save_addon_profile': {
          const saveArgs = args as { name?: string; enabledAddons?: string[] } | undefined;
          const name = saveArgs?.name;
          const enabledAddons = saveArgs?.enabledAddons || [];
          if (!win.__OWL_MOCK_PROFILES__) {
            win.__OWL_MOCK_PROFILES__ = [];
          }
          const index = win.__OWL_MOCK_PROFILES__.findIndex((p) => p.name === name);
          if (index !== -1) {
            win.__OWL_MOCK_PROFILES__[index].enabledAddons = enabledAddons;
          } else {
            if (name) {
              win.__OWL_MOCK_PROFILES__.push({ name, enabledAddons });
            }
          }
          win.__OWL_MOCK_ACTIVE_PROFILE__ = name;
          return 'OK';
        }
        case 'apply_addon_profile': {
          const applyArgs = args as { name?: string } | undefined;
          const name = applyArgs?.name;
          if (name === 'All Addons') {
            win.__OWL_MOCK_ACTIVE_PROFILE__ = null;
          } else {
            win.__OWL_MOCK_ACTIVE_PROFILE__ = name;
          }
          return 'OK';
        }
        case 'delete_addon_profile': {
          const deleteArgs = args as { name?: string } | undefined;
          const name = deleteArgs?.name;
          if (win.__OWL_MOCK_PROFILES__) {
            win.__OWL_MOCK_PROFILES__ = win.__OWL_MOCK_PROFILES__.filter((p) => p.name !== name);
          }
          if (win.__OWL_MOCK_ACTIVE_PROFILE__ === name) {
            win.__OWL_MOCK_ACTIVE_PROFILE__ = null;
          }
          return 'OK';
        }
        case 'rename_addon_profile': {
          const renameArgs = args as { oldName?: string; newName?: string } | undefined;
          const oldName = renameArgs?.oldName;
          const newName = renameArgs?.newName;
          if (win.__OWL_MOCK_PROFILES__) {
            const profile = win.__OWL_MOCK_PROFILES__.find((p) => p.name === oldName);
            if (profile && newName) {
              profile.name = newName;
            }
          }
          if (win.__OWL_MOCK_ACTIVE_PROFILE__ === oldName) {
            win.__OWL_MOCK_ACTIVE_PROFILE__ = newName;
          }
          return 'OK';
        }
        case 'search_curseforge_addons':
          return (
            win.__OWL_MOCK_CF_RESULTS__ || {
              data: [
                {
                  id: 10001,
                  name: 'Questie',
                  summary: 'Quest helper addon for WotLK',
                  logo: { thumbnailUrl: 'https://via.placeholder.com/64' },
                  links: { websiteUrl: 'https://questie.com' },
                  authors: [{ name: 'QuestieDevs' }],
                },
                {
                  id: 10002,
                  name: 'Deadly Boss Mods',
                  summary: 'Boss mod addon',
                  logo: { thumbnailUrl: 'https://via.placeholder.com/64' },
                  links: { websiteUrl: 'https://dbm.com' },
                  authors: [{ name: 'MysticalOS' }],
                },
              ],
            }
          );
        case 'get_curseforge_mod_files':
          return (
            win.__OWL_MOCK_CF_FILES__ || {
              data: [
                {
                  id: 100011,
                  displayName: 'Questie-v3.3.5',
                  fileName: 'Questie-v3.3.5.zip',
                  releaseType: 1,
                  downloadUrl: 'http://example.com/Questie.zip',
                  gameVersions: ['3.3.5'],
                  hashes: [{ algo: 1, value: 'aabbccdd' }],
                },
              ],
            }
          );
        case 'get_curseforge_mod_description':
          return '<div>Questie is the most popular quest helper addon for WotLK.</div>';
        case 'search_github_addons':
          return (
            win.__OWL_MOCK_GH_RESULTS__ || {
              items: [
                {
                  id: 99001,
                  full_name: 'author/SomeAddon',
                  description: 'A github addon',
                  html_url: 'https://github.com/author/SomeAddon',
                  stargazers_count: 42,
                  owner: { avatar_url: 'https://via.placeholder.com/64', login: 'author' },
                },
              ],
            }
          );
        case 'get_github_releases':
          return (
            win.__OWL_MOCK_GH_RELEASES__ || [
              {
                id: 1,
                tag_name: 'v1.2.3',
                name: 'v1.2.3',
                prerelease: false,
                assets: [
                  {
                    id: 1,
                    name: 'SomeAddon.zip',
                    browser_download_url: 'http://example.com/addon.zip',
                    size: 1024,
                  },
                ],
              },
            ]
          );
        case 'download_curseforge_addon':
        case 'download_github_release':
        case 'download_and_extract_addon':
        case 'toggle_addon':
        case 'toggle_patch':
        case 'open_addon_folder':
        case 'open_patch_folder':
        case 'open_mods_folder':
        case 'delete_addon':
        case 'delete_patch':
        case 'launch_game':
        case 'save_settings':
        case 'check_for_app_update':
        case 'cleanup_temp_archive':
          return null;
        case 'confirm_install_bundled':
        case 'resolve_addon_dependency':
          return 'Successfully imported: Dependency';
        case 'check_addon_dependencies':
        case 'check_orphaned_dependencies':
          return [];
        case 'export_addon_list':
          return (
            win.__OWL_MOCK_EXPORT_STRING__ ||
            'eyJ2IjoxLCJhZGRvbnMiOlt7Im5hbWUiOiJUZXN0QWRkb24iLCJlbmFibGVkIjp0cnVlLCJzb3VyY2UiOiJtYW51YWwifV19'
          );
        case 'validate_import_string': {
          const importArgs = args as { importStr?: string } | undefined;
          if (importArgs?.importStr?.includes('invalid')) {
            throw new Error('Invalid base64 string');
          }
          return (
            win.__OWL_MOCK_IMPORT_PAYLOAD__ || {
              v: 1,
              addons: [{ name: 'TestAddon', enabled: true, source: 'manual' }],
            }
          );
        }
        default:
          return null;
      }
    },
    transformCallback: (cb: (...callbackArgs: unknown[]) => void) => {
      const id = Math.random().toString(36).slice(2);
      win[id] = cb;
      return id;
    },
    postMessage: () => {},
  };
}
if (typeof window !== 'undefined' && !win.__TAURI_EVENT_PLUGIN_INTERNALS__) {
  win.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };
}

export {
  translations,
  getTranslation,
  translateDOM,
  setAppLanguage,
  setupSearchHoverBehavior,
  loadAddonsAndPatches,
  setupAddonProfileEvents,
};

function updateNavButtonsForTab(tabName: string | null) {
  const openModsBtn = document.getElementById('openModsFolder');
  if (!openModsBtn) return;
  openModsBtn.classList.toggle('hidden', tabName !== 'mods');
}

const navTabs = document.querySelectorAll('.nav-tab');
const tabContents = document.querySelectorAll('.tab-content');
const playBtn = document.getElementById('playBtn') as HTMLButtonElement | null;
const minimizeBtn = document.getElementById('minimizeBtn') as HTMLButtonElement | null;
const windowCloseBtn = document.getElementById('windowCloseBtn') as HTMLButtonElement | null;
const gamePath = document.getElementById('gamePath') as HTMLInputElement;
const stayOpen = document.getElementById('stayOpen') as HTMLInputElement;
const statusFooter = document.getElementById('status') as HTMLElement;
const activityProgress = document.getElementById('activityProgress') as HTMLElement | null;
const openModsBtn = document.getElementById('openModsFolder') as HTMLButtonElement | null;
const langBtn = document.getElementById('langBtn') as HTMLButtonElement | null;
const langDropdown = document.getElementById('langDropdown') as HTMLDivElement | null;

navTabs.forEach((tab) => {
  tab.addEventListener('click', async () => {
    if ((tab as HTMLButtonElement).disabled) return;
    const tabName = tab.getAttribute('data-tab');

    navTabs.forEach((t) => {
      t.classList.remove('active', 'border-slate-400', 'text-slate-100');
      t.classList.add('border-transparent', 'text-slate-400');
    });
    tab.classList.add('active', 'border-slate-400', 'text-slate-100');
    tab.classList.remove('border-transparent', 'text-slate-400');

    updateNavButtonsForTab(tabName);

    tabContents.forEach(async (content) => {
      if (content.id === `${tabName}-tab`) {
        content.classList.remove('hidden');
        if (tabName === 'addons' || tabName === 'mods') {
          const list = document.getElementById(
            tabName === 'addons' ? 'addons-list' : 'patches-list'
          );
          if (!list || list.children.length === 0) {
            await loadAddonsAndPatches();
          }
        }
        if (tabName === 'tweaks') {
          const tree = document.getElementById('config-tree');
          if (!tree || tree.children.length === 0) {
            await loadConfig();
          }
        }
      } else {
        content.classList.add('hidden');
      }
    });
  });
});

setupSettingsEvents(loadConfig);

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

playBtn?.addEventListener('click', async () => {
  const action = playBtn.getAttribute('data-action');
  if (action === 'install') {
    const installChoiceModal = document.getElementById('installChoiceModal');
    installChoiceModal?.classList.remove('hidden');
    return;
  }
  if (action === 'download') {
    window.dispatchEvent(new CustomEvent('open-torrent-modal'));
    return;
  }

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

setupImportModalEvents();

const themeToggleBtn = document.getElementById('themeToggleBtn');
if (Prefs.getTheme() === 'light') {
  document.body.classList.add('light-mode');
}
themeToggleBtn?.addEventListener('click', () => {
  const isLight = document.body.classList.toggle('light-mode');
  Prefs.setTheme(isLight ? 'light' : 'dark');
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
    setupGitStatusEvents();
    setupImportExportEvents();
    setupStoreEvents(loadAddonsAndPatches);
    setupMainSearchEvents();
    setupSearchHoverBehavior();
    setupAddonProfileEvents();
    setupTorrentEvents(loadAddonsAndPatches);
    loadAddonsAndPatches();
    const activeTab = document.querySelector('.nav-tab.active');
    const tabName = activeTab ? activeTab.getAttribute('data-tab') : 'addons';
    updateNavButtonsForTab(tabName);
  });
}

listen('update-available', () => {
  const updateAvailableBtn = document.getElementById('updateAvailableBtn');
  if (updateAvailableBtn) {
    updateAvailableBtn.classList.remove('hidden');
  }
  checkLauncherUpdates(false);
});

document.getElementById('updateAvailableBtn')?.addEventListener('click', async () => {
  try {
    if (statusFooter) statusFooter.textContent = 'Updating...';
    await invoke('install_update');
  } catch (err) {
    if (statusFooter) statusFooter.textContent = `Update error: ${err}`;
  }
});

setupDebugConsoleEvents();

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});
