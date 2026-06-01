import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setLoadingState, clearLoadingState } from './utils';
import { setupSettingsEvents, loadSavedSettings } from './ui/settings';
import { translations, getTranslation, translateDOM, setAppLanguage } from './i18n';
import { setupStoreEvents } from './store';
import { setupMainSearchEvents, setupSearchHoverBehavior } from './ui/search';
import { setupImportModalEvents } from './ui/import';
import { setupGitStatusEvents } from './ui/git-status';
import { loadAddonsAndPatches } from './tabs/addons';
import { loadConfig } from './tabs/tweaks';
import { setupDebugConsoleEvents } from './ui/debug-console';
import { Prefs } from './prefs';

export {
  translations,
  getTranslation,
  translateDOM,
  setAppLanguage,
  setupSearchHoverBehavior,
  loadAddonsAndPatches,
};

function updateNavButtonsForTab(tabName: string | null) {
  const importBtn = document.getElementById('importAddonBtn');
  const openModsBtn = document.getElementById('openModsFolder');
  const getAddonsBtn = document.getElementById('getAddonsBtn');
  if (!importBtn || !openModsBtn) return;
  importBtn.classList.toggle('hidden', tabName !== 'addons');
  getAddonsBtn?.classList.toggle('hidden', tabName !== 'addons');
  openModsBtn.classList.toggle('hidden', tabName !== 'mods');
}

const navTabs = document.querySelectorAll('.nav-tab');
const tabContents = document.querySelectorAll('.tab-content');
const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
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
    setupStoreEvents(loadAddonsAndPatches);
    setupMainSearchEvents();
    setupSearchHoverBehavior();
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
