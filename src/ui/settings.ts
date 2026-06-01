import { invoke } from '@tauri-apps/api/core';
import { getTranslation } from '../i18n/index';
import { LauncherSettings } from '../types';
import { loadAddonsAndPatches } from '../main';
// Note: loadConfig will need to be imported later when tweaks.ts is extracted.
// For now, it is in main.ts. Since we can't import everything easily without circular deps,
// we will just define an init function.

import { getSettingsBackup, setSettingsBackup } from '../state';
const defaultLauncherSize = '1280x720';

export async function setLauncherWindowSize(size: string) {
  const [width, height] = size.split('x').map(Number);
  if (width && height) {
    try {
      await invoke('set_window_size', { width, height });
    } catch {
      // Ignore errors for unmanaged environments
    }
  }
}

export function setupSettingsEvents(loadConfig: () => Promise<void>) {
  const settingsModal = document.getElementById('settingsModal') as HTMLDivElement | null;
  const settingsBtn = document.getElementById('settingsBtn');
  const closeSettings = document.getElementById('closeSettings');
  const cancelSettingsButton = document.getElementById('cancelSettings');
  const applySettingsButton = document.getElementById('applySettings');
  const gamePath = document.getElementById('gamePath') as HTMLInputElement | null;
  const windowSizeSelect = document.getElementById('windowSize') as HTMLSelectElement | null;
  const stayOpen = document.getElementById('stayOpen') as HTMLInputElement | null;
  const statusFooter = document.getElementById('status') as HTMLElement | null;
  const browseGamePathBtn = document.getElementById('browseGamePathBtn');

  if (!settingsModal || !gamePath || !stayOpen) return;

  function restoreSettingsBackup() {
    const backup = getSettingsBackup();
    if (!backup) return;
    gamePath!.value = backup.path;
    if (windowSizeSelect) windowSizeSelect.value = backup.windowSize;
    stayOpen!.checked = backup.stayOpen;
  }

  const closeSettingsModal = () => {
    restoreSettingsBackup();
    settingsModal.classList.add('hidden');
  };

  settingsBtn?.addEventListener('click', () => {
    setSettingsBackup({
      path: gamePath.value,
      windowSize: windowSizeSelect?.value ?? defaultLauncherSize,
      stayOpen: stayOpen.checked,
    });
    settingsModal.classList.remove('hidden');
  });

  closeSettings?.addEventListener('click', closeSettingsModal);
  cancelSettingsButton?.addEventListener('click', closeSettingsModal);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeSettingsModal();
    }
  });

  applySettingsButton?.addEventListener('click', async () => {
    if (windowSizeSelect) {
      await setLauncherWindowSize(windowSizeSelect.value);
    }
    await saveSettings();
    setSettingsBackup(null);
    settingsModal.classList.add('hidden');
    if (statusFooter) statusFooter.textContent = getTranslation('status.saved');

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

  browseGamePathBtn?.addEventListener('click', async () => {
    try {
      const selectedFolder = await invoke<string>('pick_folder');
      if (selectedFolder) {
        gamePath.value = selectedFolder;
        if (statusFooter) statusFooter.textContent = getTranslation('status.ready');
      }
    } catch (error) {
      console.error('Browse game path failed', error);
      if (statusFooter) statusFooter.textContent = getTranslation('status.ready');
    }
  });
}

export async function loadSavedSettings() {
  const gamePath = document.getElementById('gamePath') as HTMLInputElement | null;
  const windowSizeSelect = document.getElementById('windowSize') as HTMLSelectElement | null;
  const stayOpen = document.getElementById('stayOpen') as HTMLInputElement | null;

  if (!gamePath || !stayOpen) return;

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
      setLauncherWindowSize(defaultLauncherSize);
    }
  }
}

export async function saveSettings() {
  const gamePath = document.getElementById('gamePath') as HTMLInputElement | null;
  const windowSizeSelect = document.getElementById('windowSize') as HTMLSelectElement | null;
  const stayOpen = document.getElementById('stayOpen') as HTMLInputElement | null;

  if (!gamePath || !stayOpen) return;

  const settings: LauncherSettings = {
    path: gamePath.value,
    windowSize: windowSizeSelect?.value || defaultLauncherSize,
    stayOpen: stayOpen.checked,
  };

  await invoke('save_settings', { settings });
}
