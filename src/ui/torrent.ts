import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getTranslation } from '../i18n/index';
import { showToast, setLoadingState, clearLoadingState } from '../utils';

interface ActiveDownload {
  id: number;
  name: string;
  destDir: string;
  infoHash: string;
  isUnpacking: boolean;
  isPaused: boolean;
  error: string | null;
}

interface TorrentProgressInfo {
  infoHash: string;
  name: string;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  peers: number;
  isUnpacking: boolean;
  isPaused: boolean;
  error: string | null;
  state: string;
}

interface TorrentProgressPayload {
  downloads: TorrentProgressInfo[];
}

declare global {
  interface Window {
    __triggerTorrentProgress?: (payload: TorrentProgressPayload) => void;
    checkGamePathValidity?: () => Promise<void>;
    __OWL_MOCK_VALIDATE_GAME_PATH__?: boolean;
    __OWL_MOCK_ACTIVE_DOWNLOADS__?: Array<{
      id: number;
      name: string;
      destDir: string;
      infoHash: string;
      isUnpacking: boolean;
      isPaused: boolean;
      error: string | null;
    }>;
  }
}

let isDrawerExpanded = false;

export async function checkGamePathValidity() {
  const gamePathInput = document.getElementById('gamePath') as HTMLInputElement | null;
  const playBtn = document.getElementById('playBtn') as HTMLButtonElement | null;
  const downloadGameNavBtn = document.getElementById(
    'downloadGameNavBtn'
  ) as HTMLButtonElement | null;
  if (!gamePathInput || !playBtn) return;

  const addonsSearch = document.getElementById('addons-search') as HTMLInputElement | null;
  const patchesSearch = document.getElementById('patches-search') as HTMLInputElement | null;
  const importAddonBtn = document.getElementById('importAddonBtn') as HTMLButtonElement | null;
  const tweaksTab = document.querySelector(
    '.nav-tab[data-tab="tweaks"]'
  ) as HTMLButtonElement | null;

  try {
    const isValid = await invoke<boolean>('validate_game_path', { basePath: gamePathInput.value });

    if (addonsSearch) {
      addonsSearch.disabled = !isValid;
      if (!isValid) addonsSearch.classList.remove('active');
    }
    if (patchesSearch) {
      patchesSearch.disabled = !isValid;
      if (!isValid) patchesSearch.classList.remove('active');
    }
    if (importAddonBtn) importAddonBtn.disabled = !isValid;

    if (tweaksTab) {
      tweaksTab.disabled = !isValid;
      if (!isValid && tweaksTab.classList.contains('active')) {
        const addonsTab = document.querySelector(
          '.nav-tab[data-tab="addons"]'
        ) as HTMLButtonElement | null;
        addonsTab?.click();
      }
    }

    if (isValid) {
      playBtn.setAttribute('data-i18n', 'buttons.play');
      playBtn.textContent = (getTranslation('buttons.play') || 'PLAY').toUpperCase();
      playBtn.removeAttribute('disabled');
      playBtn.className =
        'rounded bg-slate-700 px-6 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-600 transition-all duration-150 cursor-pointer';
      playBtn.setAttribute('data-action', 'play');
      if (downloadGameNavBtn) {
        downloadGameNavBtn.classList.add('hidden');
      }
    } else {
      playBtn.setAttribute('data-i18n', 'buttons.install');
      playBtn.textContent = (getTranslation('buttons.install') || 'INSTALL').toUpperCase();
      playBtn.removeAttribute('disabled');
      playBtn.className =
        'rounded bg-sky-600 px-6 py-2 text-sm font-semibold text-slate-100 hover:bg-sky-500 transition-all duration-150 cursor-pointer';
      playBtn.setAttribute('data-action', 'install');
      if (downloadGameNavBtn) {
        downloadGameNavBtn.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('Failed to validate game path:', err);

    if (addonsSearch) {
      addonsSearch.disabled = true;
      addonsSearch.classList.remove('active');
    }
    if (patchesSearch) {
      patchesSearch.disabled = true;
      patchesSearch.classList.remove('active');
    }
    if (importAddonBtn) importAddonBtn.disabled = true;

    if (tweaksTab) {
      tweaksTab.disabled = true;
      if (tweaksTab.classList.contains('active')) {
        const addonsTab = document.querySelector(
          '.nav-tab[data-tab="addons"]'
        ) as HTMLButtonElement | null;
        addonsTab?.click();
      }
    }

    playBtn.setAttribute('data-i18n', 'buttons.install');
    playBtn.textContent = (getTranslation('buttons.install') || 'INSTALL').toUpperCase();
    playBtn.removeAttribute('disabled');
    playBtn.className =
      'rounded bg-sky-600 px-6 py-2 text-sm font-semibold text-slate-100 hover:bg-sky-500 transition-all duration-150 cursor-pointer';
    playBtn.setAttribute('data-action', 'install');
    if (downloadGameNavBtn) {
      downloadGameNavBtn.classList.add('hidden');
    }
  }
}

export function shortenPath(path: string): string {
  if (!path) return '';
  const hasBackslash = path.includes('\\');
  const separator = hasBackslash ? '\\' : '/';
  const parts = path.split(/[/\\]/);
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  if (parts.length >= 2) {
    const fileName = parts[parts.length - 1];
    const parentFolder = parts[parts.length - 2];
    return `..${separator}${parentFolder}${separator}${fileName}`;
  }
  return path;
}

export function setupTorrentEvents(reloadCallback: () => Promise<void>) {
  const downloadGameNavBtn = document.getElementById('downloadGameNavBtn');
  const torrentModal = document.getElementById('torrentModal');
  const torrentCancelBtn = document.getElementById('torrentCancelBtn');
  const torrentStartBtn = document.getElementById('torrentStartBtn') as HTMLButtonElement | null;
  const torrentSourceInput = document.getElementById(
    'torrentSourceInput'
  ) as HTMLInputElement | null;
  const torrentDestInput = document.getElementById('torrentDestInput') as HTMLInputElement | null;
  const browseTorrentFileBtn = document.getElementById('browseTorrentFileBtn');
  const browseTorrentDestBtn = document.getElementById('browseTorrentDestBtn');

  const torrentDrawer = document.getElementById('torrentDrawer');
  const torrentDrawerHeader = document.getElementById('torrentDrawerHeader');
  const torrentDrawerContent = document.getElementById('torrentDrawerContent');
  const torrentDrawerCount = document.getElementById('torrentDrawerCount');
  const torrentDrawerPauseAllBtn = document.getElementById(
    'torrentDrawerPauseAllBtn'
  ) as HTMLButtonElement | null;
  const torrentDrawerResumeAllBtn = document.getElementById(
    'torrentDrawerResumeAllBtn'
  ) as HTMLButtonElement | null;
  const torrentDrawerToggleIcon = document.getElementById('torrentDrawerToggleIcon');

  const statusFooter = document.getElementById('status') as HTMLElement | null;
  const activityProgress = document.getElementById('activityProgress') as HTMLElement | null;

  if (!torrentModal || !torrentStartBtn || !torrentSourceInput || !torrentDestInput) return;

  function validateInputs() {
    const src = torrentSourceInput?.value.trim() || '';
    const dest = torrentDestInput?.value.trim() || '';
    if (src && dest) {
      torrentStartBtn?.removeAttribute('disabled');
    } else {
      torrentStartBtn?.setAttribute('disabled', 'true');
    }
  }

  torrentSourceInput?.addEventListener('input', () => {
    torrentSourceInput.removeAttribute('data-full-path');
    validateInputs();
  });
  torrentDestInput?.addEventListener('input', validateInputs);

  const openTorrent = () => {
    torrentSourceInput.value = '';
    torrentSourceInput.removeAttribute('data-full-path');
    torrentDestInput.value = '';
    torrentStartBtn.setAttribute('disabled', 'true');
    torrentModal.classList.remove('hidden');
  };

  downloadGameNavBtn?.addEventListener('click', openTorrent);
  window.addEventListener('open-torrent-modal', openTorrent);

  torrentCancelBtn?.addEventListener('click', () => {
    torrentModal.classList.add('hidden');
  });

  torrentModal.addEventListener('click', (e) => {
    if (e.target === torrentModal) {
      torrentModal.classList.add('hidden');
    }
  });

  // Install Choice Modal Events
  const installChoiceModal = document.getElementById('installChoiceModal');
  const installLocateBtn = document.getElementById('installLocateBtn');
  const installTorrentBtn = document.getElementById('installTorrentBtn');
  const installChoiceCancelBtn = document.getElementById('installChoiceCancelBtn');
  const gamePathInput = document.getElementById('gamePath') as HTMLInputElement | null;

  installChoiceCancelBtn?.addEventListener('click', () => {
    installChoiceModal?.classList.add('hidden');
  });

  installChoiceModal?.addEventListener('click', (e) => {
    if (e.target === installChoiceModal) {
      installChoiceModal.classList.add('hidden');
    }
  });

  installTorrentBtn?.addEventListener('click', () => {
    installChoiceModal?.classList.add('hidden');
    openTorrent();
  });

  installLocateBtn?.addEventListener('click', async () => {
    try {
      const selectedFolder = await invoke<string>('pick_folder');
      if (selectedFolder && gamePathInput) {
        gamePathInput.value = selectedFolder;

        const windowSizeSelect = document.getElementById('windowSize') as HTMLSelectElement | null;
        const stayOpen = document.getElementById('stayOpen') as HTMLInputElement | null;
        const settings = {
          path: selectedFolder,
          windowSize: windowSizeSelect?.value || '1280x720',
          stayOpen: stayOpen ? stayOpen.checked : true,
        };
        await invoke('save_settings', { settings });

        installChoiceModal?.classList.add('hidden');
        if (statusFooter) statusFooter.textContent = getTranslation('status.saved');
        await checkGamePathValidity();
        await reloadCallback();
      }
    } catch (error) {
      console.error('Locate local installation failed:', error);
    }
  });

  browseTorrentFileBtn?.addEventListener('click', async () => {
    try {
      const file = await invoke<string>('pick_torrent_file');
      if (file && torrentSourceInput) {
        torrentSourceInput.value = shortenPath(file);
        torrentSourceInput.setAttribute('data-full-path', file);
        validateInputs();
      }
    } catch (err) {
      showToast(String(err));
    }
  });

  browseTorrentDestBtn?.addEventListener('click', async () => {
    try {
      const folder = await invoke<string>('pick_folder');
      if (folder && torrentDestInput) {
        torrentDestInput.value = folder;
        validateInputs();
      }
    } catch (err) {
      showToast(String(err));
    }
  });

  torrentStartBtn.addEventListener('click', async () => {
    const fullPath = torrentSourceInput.getAttribute('data-full-path');
    const src = (fullPath && fullPath.trim()) || torrentSourceInput.value.trim();
    const dest = torrentDestInput.value.trim();
    if (!src || !dest) return;

    torrentModal.classList.add('hidden');
    if (statusFooter) statusFooter.textContent = getTranslation('torrent.startingDownload');

    try {
      await invoke<string>('start_torrent_download', {
        magnetOrFile: src,
        destDir: dest,
      });
      showToast(getTranslation('torrent.downloadStarted'));
      await refreshActiveDownloads();
    } catch (err) {
      showToast(getTranslation('torrent.failedToStart', { error: String(err) }));
      if (statusFooter) statusFooter.textContent = getTranslation('status.ready');
    }
  });

  // Drawer Toggle
  torrentDrawerHeader?.addEventListener('click', () => {
    if (!torrentDrawerContent || !torrentDrawerToggleIcon) return;
    isDrawerExpanded = !isDrawerExpanded;
    if (isDrawerExpanded) {
      torrentDrawerContent.classList.remove('hidden');
      torrentDrawerToggleIcon.textContent = '▼';
    } else {
      torrentDrawerContent.classList.add('hidden');
      torrentDrawerToggleIcon.textContent = '▲';
    }
  });

  torrentDrawerPauseAllBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await invoke('pause_torrent_downloads');
      torrentDrawerPauseAllBtn.classList.add('hidden');
      if (torrentDrawerResumeAllBtn) torrentDrawerResumeAllBtn.classList.remove('hidden');
    } catch (err) {
      showToast(String(err));
    }
  });

  torrentDrawerResumeAllBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await invoke('resume_torrent_downloads');
      torrentDrawerResumeAllBtn.classList.add('hidden');
      if (torrentDrawerPauseAllBtn) torrentDrawerPauseAllBtn.classList.remove('hidden');
    } catch (err) {
      showToast(String(err));
    }
  });

  async function refreshActiveDownloads() {
    try {
      const activeRaw = await invoke<ActiveDownload[]>('get_active_downloads');
      const active = activeRaw || [];
      updateDrawerVisibility(active.length);
      const mapped = active.map((a) => ({
        infoHash: a.infoHash,
        name: a.name,
        downloadedBytes: 0,
        totalBytes: 0,
        speedBps: 0,
        peers: 0,
        isUnpacking: a.isUnpacking,
        isPaused: a.isPaused,
        error: a.error,
        state: 'live',
      }));
      renderActiveDownloadsList(mapped);
      updateProgressUI(mapped);
    } catch (err) {
      console.error(err);
    }
  }

  function updateDrawerVisibility(count: number) {
    if (!torrentDrawer || !torrentDrawerCount) return;
    torrentDrawerCount.textContent = String(count);
    if (count > 0) {
      torrentDrawer.classList.remove('hidden');
    } else {
      torrentDrawer.classList.add('hidden');
    }
  }

  function formatBytes(bytes: number, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function renderActiveDownloadsList(downloads: TorrentProgressInfo[]) {
    if (!torrentDrawerContent) return;
    torrentDrawerContent.innerHTML = '';

    downloads.forEach((dl) => {
      const item = document.createElement('div');
      item.className =
        'flex flex-col gap-1.5 p-3 rounded bg-slate-950/40 border border-slate-800 text-xs';

      const percent =
        dl.totalBytes > 0 ? Math.round((dl.downloadedBytes / dl.totalBytes) * 100) : 0;

      let statusStr = '';
      if (dl.error) {
        statusStr = getTranslation('torrent.statusError', { error: dl.error });
      } else if (dl.isUnpacking) {
        statusStr = getTranslation('torrent.extracting');
      } else if (dl.isPaused) {
        statusStr = getTranslation('torrent.pausedStatus');
      } else if (dl.state === 'initializing') {
        if (dl.downloadedBytes > 0) {
          statusStr = getTranslation('torrent.verifyingPercent', { percent: String(percent) });
        } else {
          statusStr = getTranslation('torrent.allocating');
        }
      } else {
        statusStr = `${formatBytes(dl.downloadedBytes)} / ${formatBytes(dl.totalBytes)} (${formatBytes(dl.speedBps)}/s) — ${dl.peers} peers`;
      }

      item.innerHTML = `
        <div class="flex items-center justify-between font-semibold text-slate-200">
          <span class="truncate pr-4">${dl.name}</span>
          <button class="cancel-dl-btn text-red-400 hover:text-red-300 transition-colors cursor-pointer" data-hash="${dl.infoHash}">✕</button>
        </div>
        <div class="h-1 bg-slate-800 rounded-full overflow-hidden">
          <div class="h-full bg-sky-600 rounded-full" style="width: ${percent}%;"></div>
        </div>
        <div class="flex items-center justify-between text-[10px] text-slate-400">
          <span>${statusStr}</span>
          <span>${percent}%</span>
        </div>
      `;

      item.querySelector('.cancel-dl-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const hash = (e.target as HTMLElement).getAttribute('data-hash');
        if (hash) {
          try {
            await invoke('cancel_torrent_download', { infoHash: hash });
            showToast(getTranslation('torrent.downloadCanceled'));
            await refreshActiveDownloads();
          } catch (err) {
            showToast(String(err));
          }
        }
      });

      torrentDrawerContent.appendChild(item);
    });
  }

  function updateProgressUI(downloads: TorrentProgressInfo[]) {
    const playBtn = document.getElementById('playBtn') as HTMLButtonElement | null;
    if (downloads.length > 0) {
      const activeDls = downloads.filter((d) => !d.isPaused && !d.isUnpacking);
      if (activeDls.length > 0) {
        const totalDownloaded = downloads.reduce((acc, d) => acc + d.downloadedBytes, 0);
        const totalSize = downloads.reduce((acc, d) => acc + d.totalBytes, 0);
        const avgPercent = totalSize > 0 ? Math.round((totalDownloaded / totalSize) * 100) : 0;
        const totalSpeed = downloads.reduce((acc, d) => acc + d.speedBps, 0);

        const allInitializing = activeDls.every((d) => d.state === 'initializing');
        if (allInitializing) {
          const totalVerified = activeDls.reduce((acc, d) => acc + d.downloadedBytes, 0);
          if (totalVerified > 0) {
            setLoadingState(
              getTranslation('torrent.verifyingMetadata', {
                verified: formatBytes(totalVerified),
                total: formatBytes(totalSize),
                percent: String(avgPercent),
              }),
              avgPercent,
              statusFooter || undefined,
              activityProgress || undefined
            );
            if (playBtn) {
              playBtn.removeAttribute('data-i18n');
              playBtn.textContent = `VERIFYING ${avgPercent}%`;
              playBtn.disabled = true;
              playBtn.className =
                'rounded bg-sky-600/50 px-6 py-2 text-sm font-semibold text-slate-400 cursor-not-allowed';
            }
          } else {
            setLoadingState(
              getTranslation('torrent.allocating'),
              0,
              statusFooter || undefined,
              activityProgress || undefined
            );
            if (playBtn) {
              playBtn.removeAttribute('data-i18n');
              playBtn.textContent = 'ALLOCATING...';
              playBtn.disabled = true;
              playBtn.className =
                'rounded bg-sky-600/50 px-6 py-2 text-sm font-semibold text-slate-400 cursor-not-allowed';
            }
          }
        } else {
          setLoadingState(
            getTranslation('torrent.downloadingClient', {
              downloaded: formatBytes(totalDownloaded),
              total: formatBytes(totalSize),
              speed: formatBytes(totalSpeed),
            }),
            avgPercent,
            statusFooter || undefined,
            activityProgress || undefined
          );

          if (playBtn) {
            playBtn.removeAttribute('data-i18n');
            playBtn.textContent = `DOWNLOADING ${avgPercent}%`;
            playBtn.disabled = true;
            playBtn.className =
              'rounded bg-sky-600/50 px-6 py-2 text-sm font-semibold text-slate-400 cursor-not-allowed';
          }
        }
      } else {
        const unpackingDls = downloads.filter((d) => d.isUnpacking);
        if (unpackingDls.length > 0) {
          setLoadingState(
            getTranslation('torrent.extracting'),
            95,
            statusFooter || undefined,
            activityProgress || undefined
          );
          if (playBtn) {
            playBtn.removeAttribute('data-i18n');
            playBtn.textContent = 'EXTRACTING...';
            playBtn.disabled = true;
            playBtn.className =
              'rounded bg-sky-600/50 px-6 py-2 text-sm font-semibold text-slate-400 cursor-not-allowed';
          }
        } else {
          clearLoadingState(statusFooter || undefined, activityProgress || undefined);
          if (playBtn) {
            const allPaused = downloads.every((d) => d.isPaused);
            if (allPaused) {
              playBtn.removeAttribute('data-i18n');
              playBtn.textContent = 'PAUSED';
              playBtn.disabled = true;
              playBtn.className =
                'rounded bg-sky-600/50 px-6 py-2 text-sm font-semibold text-slate-400 cursor-not-allowed';
            } else {
              checkGamePathValidity();
            }
          }
        }
      }
    } else {
      clearLoadingState(statusFooter || undefined, activityProgress || undefined);
      checkGamePathValidity();
    }
  }

  // Progress Listener
  listen<TorrentProgressPayload>('torrent-progress', (event) => {
    const downloads = event.payload.downloads;
    updateDrawerVisibility(downloads.length);
    renderActiveDownloadsList(downloads);
    updateProgressUI(downloads);
  });

  // Completed Listener
  listen<string>('torrent-completed', async (event) => {
    showToast(event.payload);
    if (statusFooter) statusFooter.textContent = event.payload;
    clearLoadingState(statusFooter || undefined, activityProgress || undefined);

    const gamePathInput = document.getElementById('gamePath') as HTMLInputElement | null;
    try {
      const saved = await invoke<{ path?: string }>('load_settings');
      if (saved?.path && gamePathInput) {
        gamePathInput.value = saved.path;
      }
    } catch (e) {
      console.error('Failed to reload settings path:', e);
    }

    await checkGamePathValidity();
    await reloadCallback();
    await refreshActiveDownloads();
  });

  // Error Listener
  listen<string>('torrent-error', (event) => {
    showToast(event.payload);
    if (statusFooter) statusFooter.textContent = event.payload;
    clearLoadingState(statusFooter || undefined, activityProgress || undefined);
  });

  // Initialize
  refreshActiveDownloads();
  checkGamePathValidity();

  // Expose global hook for E2E tests to trigger progress updates
  window.__triggerTorrentProgress = (payload: TorrentProgressPayload) => {
    const downloads = payload.downloads;
    updateDrawerVisibility(downloads.length);
    renderActiveDownloadsList(downloads);
    updateProgressUI(downloads);
  };

  window.checkGamePathValidity = checkGamePathValidity;
}
