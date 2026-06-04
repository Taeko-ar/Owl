import { invoke } from '@tauri-apps/api/core';
import { getTranslation, translateDOM } from '../i18n/index';
import { LauncherSettings, UpdateDetails } from '../types';
import { loadAddonsAndPatches } from '../main';
import { checkGamePathValidity } from './torrent';
import { getSettingsBackup, setSettingsBackup } from '../state';
import { Prefs } from '../prefs';

const defaultLauncherSize = '1280x720';
let cachedUpdate: UpdateDetails | null = null;

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

function parseMarkdownToHTML(markdown: string): string {
  return markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('### ')) {
        return `<h4 class="text-xs font-bold text-slate-100 mt-3 mb-1.5">${trimmed.slice(4)}</h4>`;
      }
      if (trimmed.startsWith('## ')) {
        return `<h3 class="text-sm font-bold text-slate-100 mt-4 mb-2 border-b border-slate-800 pb-1">${trimmed.slice(3)}</h3>`;
      }
      if (trimmed.startsWith('# ')) {
        return `<h2 class="text-base font-bold text-slate-100 mt-4 mb-2">${trimmed.slice(2)}</h2>`;
      }
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        return `<li class="ml-4 list-disc text-slate-300 my-1">${trimmed.slice(2)}</li>`;
      }
      if (trimmed === '') {
        return '<br/>';
      }
      return `<p class="text-slate-300 my-1">${trimmed}</p>`;
    })
    .join('\n');
}

function showUpdateDetails(update: UpdateDetails) {
  const modal = document.getElementById('updateDetailsModal');
  const title = document.getElementById('updateModalTitle');
  const body = document.getElementById('updateChangelogContent');
  /* v8 ignore next */
  if (!modal || !body) return;

  if (title) {
    title.textContent = `${getTranslation('settings.updateModalTitle')} (v${update.version})`;
  }
  /* v8 ignore next */
  body.innerHTML = parseMarkdownToHTML(update.body || 'No release notes provided.');
  modal.classList.remove('hidden');
}

export function wireUpdateLabelClick() {
  const label = document.getElementById('settingsUpdateLabel');
  if (label) {
    const newLabel = label.cloneNode(true);
    label.replaceWith(newLabel);
    newLabel.addEventListener('click', () => {
      if (cachedUpdate) {
        showUpdateDetails(cachedUpdate);
      } else {
        checkLauncherUpdates(true);
      }
    });
  }
}

export async function checkLauncherUpdates(manual: boolean) {
  const badge = document.getElementById('settingsBadge');
  const updateContainer = document.getElementById('settingsUpdateContainer');
  if (!updateContainer) return;

  try {
    if (manual) {
      updateContainer.innerHTML = `<span class="text-xs text-slate-400 animate-pulse" data-i18n="settings.checkingUpdates">Checking updates...</span>`;
      translateDOM();
    }
    const update = await invoke<UpdateDetails | null>('check_update_details');
    if (update) {
      cachedUpdate = update;
      const skipped = Prefs.getSkippedVersion();
      if (manual || skipped !== update.version) {
        if (badge) badge.classList.remove('hidden');
        updateContainer.innerHTML = `<span id="settingsUpdateLabel" class="text-xs text-amber-400 font-semibold cursor-pointer hover:underline" data-i18n="settings.updateAvailable">Update available!</span>`;
      } else {
        /* v8 ignore next */
        if (badge) badge.classList.add('hidden');
        updateContainer.innerHTML = `<span id="settingsUpdateLabel" class="text-xs text-slate-400 cursor-pointer hover:underline" data-i18n="settings.checkUpdates">Check updates...</span>`;
      }
    } else {
      cachedUpdate = null;
      if (badge) badge.classList.add('hidden');
      if (manual) {
        updateContainer.innerHTML = `<span class="text-xs text-green-400 font-semibold" data-i18n="settings.upToDate">Launcher is up-to-date</span>`;
        setTimeout(() => {
          updateContainer.innerHTML = `<span id="settingsUpdateLabel" class="text-xs text-slate-400 cursor-pointer hover:underline" data-i18n="settings.checkUpdates">Check updates...</span>`;
          translateDOM();
          wireUpdateLabelClick();
        }, 3000);
      } else {
        updateContainer.innerHTML = `<span id="settingsUpdateLabel" class="text-xs text-slate-400 cursor-pointer hover:underline" data-i18n="settings.checkUpdates">Check updates...</span>`;
      }
    }
  } catch (err) {
    console.error('Check update failed', err);
    if (badge) badge.classList.add('hidden');
    /* v8 ignore next 8 */
    if (manual) {
      updateContainer.innerHTML = `<span class="text-xs text-red-400 font-semibold" data-i18n="settings.updateError">Check failed</span>`;
      setTimeout(() => {
        updateContainer.innerHTML = `<span id="settingsUpdateLabel" class="text-xs text-slate-400 cursor-pointer hover:underline" data-i18n="settings.checkUpdates">Check updates...</span>`;
        translateDOM();
        wireUpdateLabelClick();
      }, 3000);
    }
  }

  translateDOM();
  wireUpdateLabelClick();
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

  const updateDetailsModal = document.getElementById('updateDetailsModal');
  const skipVersionBtn = document.getElementById('skipVersionBtn');
  const closeUpdateDetails = document.getElementById('closeUpdateDetails');
  const confirmUpdateBtn = document.getElementById('confirmUpdateBtn');

  if (!settingsModal || !gamePath || !stayOpen) return;

  function restoreSettingsBackup() {
    const backup = getSettingsBackup();
    if (!backup) return;
    /* v8 ignore next */
    if (gamePath) gamePath.value = backup.path;
    /* v8 ignore next */
    if (windowSizeSelect) windowSizeSelect.value = backup.windowSize;
    /* v8 ignore next */
    if (stayOpen) stayOpen.checked = backup.stayOpen;
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

    const p = invoke<string>('get_app_version');
    if (p && typeof p.then === 'function') {
      p.then((version) => {
        if (version) {
          const settingsUpdateVersion = document.getElementById('settingsUpdateVersion');
          /* v8 ignore next */
          if (settingsUpdateVersion) settingsUpdateVersion.textContent = `v${version}`;
        }
      }).catch(console.error);
    }

    checkLauncherUpdates(false);
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
    await checkGamePathValidity();
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

  // Update modal events
  skipVersionBtn?.addEventListener('click', () => {
    if (cachedUpdate) {
      Prefs.setSkippedVersion(cachedUpdate.version);
      const badge = document.getElementById('settingsBadge');
      /* v8 ignore next */
      if (badge) badge.classList.add('hidden');
      const updateContainer = document.getElementById('settingsUpdateContainer');
      /* v8 ignore next 5 */
      if (updateContainer) {
        updateContainer.innerHTML = `<span id="settingsUpdateLabel" class="text-xs text-slate-400 cursor-pointer hover:underline" data-i18n="settings.checkUpdates">Check updates...</span>`;
        translateDOM();
        wireUpdateLabelClick();
      }
    }
    updateDetailsModal?.classList.add('hidden');
  });

  closeUpdateDetails?.addEventListener('click', () => {
    updateDetailsModal?.classList.add('hidden');
  });

  updateDetailsModal?.addEventListener('click', (e) => {
    if (e.target === updateDetailsModal) {
      updateDetailsModal.classList.add('hidden');
    }
  });

  confirmUpdateBtn?.addEventListener('click', () => {
    updateDetailsModal?.classList.add('hidden');
    const footer = document.getElementById('status');
    if (footer) footer.textContent = 'Updating...';
    invoke('install_update').catch((err) => {
      const footerErr = document.getElementById('status');
      if (footerErr) footerErr.textContent = `Update error: ${err}`;
    });
  });

  checkLauncherUpdates(false);
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
