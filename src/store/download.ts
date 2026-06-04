import { invoke } from '@tauri-apps/api/core';
import { getTranslation } from '../i18n/index';
import { showToast, setLoadingState, clearLoadingState } from '../utils';
import { CatalogAddon, AddonVersion, CurseForgeFile } from '../types';
import { selectedAddons, getCurrentActiveSite, getDetectedGameVersion } from '../state';
import { fetchGithubReleases } from './github';
import { updateFooterState } from './index';
import {
  showBundledWarningModal,
  showReplaceWarningModal,
  parseAndTranslateImportError,
  handlePostInstallDependencyCheck,
} from '../ui/import';

const getStatusFooter = () => document.getElementById('status') as HTMLElement;
const getActivityProgress = () => document.getElementById('activityProgress') as HTMLElement | null;
const gamePathInput = () => document.getElementById('gamePath') as HTMLInputElement;

export async function selectAddonForDownload(
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
    if (getCurrentActiveSite() === 'github') {
      compatible = await fetchGithubReleases(addon.name);
    } else {
      const isMock = getCurrentActiveSite() === 'mock';
      const response = await invoke<{ data: CurseForgeFile[] }>('get_curseforge_mod_files', {
        modId: addon.modId,
        isMock,
      });
      const files = response.data || [];
      compatible = files
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
            `https://edge.forgecdn.net/files/${Math.floor(file.id / 1000)}/${file.id % 1000}/${encodeURIComponent(file.fileName!)}`;
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

export async function installSelectedAddons() {
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

  const confirmBtn = document.getElementById('store-modal-confirm') as HTMLButtonElement;
  confirmBtn.disabled = true;
  const originalConfirmText = confirmBtn.textContent || 'Confirm & Install';
  confirmBtn.textContent = 'Downloading...';

  const storeReviewBtn = document.getElementById('storeReviewBtn') as HTMLButtonElement | null;
  let originalReviewText = '';
  if (storeReviewBtn) {
    storeReviewBtn.disabled = true;
    originalReviewText = storeReviewBtn.textContent || '';
    storeReviewBtn.textContent = 'Downloading...';
  }

  const cancelBtn = document.getElementById('store-modal-cancel') as HTMLButtonElement | null;
  if (cancelBtn) cancelBtn.disabled = true;

  setLoadingState('Downloading addons...', 10, getStatusFooter(), getActivityProgress());

  let successCount = 0;
  // Collect (basePath, successMessage) pairs for dep checks — run sequentially after all downloads.
  const pendingDepChecks: { basePath: string; res: string }[] = [];

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
    getStatusFooter().textContent = getTranslation('status.downloadingAddon', {
      name: addon.title,
    });

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
      getStatusFooter().textContent = getTranslation('status.installingAddon', {
        name: addon.title,
      });

      const res = await invoke<string>('download_and_extract_addon', {
        basePath: gamePathInput().value,
        url: version.downloadUrl,
        sha1: version.sha1 || null,
        modId: addon.modId || null,
        fileId:
          typeof version.id === 'number' ? version.id : parseInt(version.id as string, 10) || null,
      });

      if (statusCell) {
        statusCell.innerHTML = `<span class="text-emerald-400 font-bold">✓ Complete</span>`;
      }
      successCount++;
      // Queue dep check — do NOT show modal yet.
      pendingDepChecks.push({ basePath: gamePathInput().value, res });
    } catch (err) {
      console.error(err);
      const errStr = String(err);
      if (errStr.startsWith('BUNDLED:')) {
        if (statusCell) {
          statusCell.innerHTML = `<span class="text-yellow-400 font-bold">Bundled Warning</span>`;
        }
        const parts = errStr.substring(8).split('|');
        const tempPath = parts[0];
        const names = parts[1].split(',');
        const res = await showBundledWarningModal(
          gamePathInput().value,
          tempPath,
          names,
          async () => {
            window.dispatchEvent(new Event('reload-addons'));
          }
        );
        if (res) {
          if (statusCell) {
            statusCell.innerHTML = `<span class="text-emerald-400 font-bold">✓ Complete</span>`;
          }
          successCount++;
          pendingDepChecks.push({ basePath: gamePathInput().value, res });
        } else {
          if (statusCell) {
            statusCell.innerHTML = `<span class="text-red-400 font-bold">❌ Cancelled</span>`;
          }
        }
      } else if (errStr.startsWith('REPLACE_WARNING:')) {
        if (statusCell) {
          statusCell.innerHTML = `<span class="text-yellow-400 font-bold">Replace Warning</span>`;
        }
        const parts = errStr.substring(16).split('|');
        const tempPath = parts[0];
        const names = parts[1].split(',');
        const proceed = await showReplaceWarningModal(tempPath, names);
        if (proceed) {
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
            const res = await invoke<string>('confirm_install_bundled', {
              basePath: gamePathInput().value,
              tempDirPath: tempPath,
              allowedDirs: null,
            });
            if (statusCell) {
              statusCell.innerHTML = `<span class="text-emerald-400 font-bold">✓ Complete</span>`;
            }
            successCount++;
            pendingDepChecks.push({ basePath: gamePathInput().value, res });
          } catch (confirmErr) {
            if (statusCell) {
              statusCell.innerHTML = `<span class="text-red-400 font-bold" title="${confirmErr}">❌ Failed</span>`;
            }
          }
        } else {
          if (statusCell) {
            statusCell.innerHTML = `<span class="text-red-400 font-bold">❌ Cancelled</span>`;
          }
        }
      } else {
        const cleanErr = parseAndTranslateImportError(errStr);
        if (statusCell) {
          statusCell.innerHTML = `<span class="text-red-400 font-bold" title="${cleanErr}">❌ Failed</span>`;
        }
      }
    }
  }

  getStatusFooter().textContent = `Completed downloading. Installed ${successCount} of ${itemsToDownload.length} successfully.`;
  showToast(`Installed ${successCount} addons!`);

  const cancelBtn2 = document.getElementById('store-modal-cancel') as HTMLButtonElement | null;
  if (cancelBtn2) cancelBtn2.disabled = false;

  setTimeout(async () => {
    const storeDownloadModal = document.getElementById('storeDownloadModal');
    const storeModal = document.getElementById('storeModal');

    // Add transitions for smooth fade out
    if (storeDownloadModal) {
      storeDownloadModal.style.transition = 'opacity 0.3s ease';
      storeDownloadModal.style.opacity = '0';
    }
    if (storeModal) {
      storeModal.style.transition = 'opacity 0.3s ease';
      storeModal.style.opacity = '0';
    }

    setTimeout(async () => {
      if (storeDownloadModal) {
        storeDownloadModal.classList.add('hidden');
        storeDownloadModal.style.opacity = '';
        storeDownloadModal.style.transition = '';
      }
      if (storeModal) {
        storeModal.classList.add('hidden');
        storeModal.style.opacity = '';
        storeModal.style.transition = '';
      }

      // Re-enable/reset button state here after modal is fully closed and reset
      confirmBtn.disabled = false;
      confirmBtn.textContent = originalConfirmText;
      if (storeReviewBtn) {
        storeReviewBtn.disabled = false;
        storeReviewBtn.textContent = originalReviewText;
      }

      clearLoadingState(getStatusFooter(), getActivityProgress());
      window.dispatchEvent(new Event('reload-addons'));

      // Show dependency modals one at a time — wait for user to accept each before showing the next.
      for (const { basePath, res } of pendingDepChecks) {
        await handlePostInstallDependencyCheck(basePath, res);
      }
    }, 300);
  }, 1200);
}
