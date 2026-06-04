import { invoke } from '@tauri-apps/api/core';
import { getTranslation, translateDOM } from '../i18n/index';
import { showToast, showTextInputModal } from '../utils';
import { loadAddonsAndPatches } from '../tabs/addons';
import { handleImportString } from './import-export';
import { getCurrentActiveSite } from '../state';

export function setupImportModalEvents() {
  const importAddonBtn = document.getElementById('importAddonBtn') as HTMLButtonElement | null;
  const statusFooter = document.getElementById('status') as HTMLElement | null;
  const gamePath = document.getElementById('gamePath') as HTMLInputElement | null;

  importAddonBtn?.addEventListener('click', async () => {
    if (document.getElementById('importModalOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'importModalOverlay';
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
          <button id="importGetAddonsBtn" class="w-full rounded bg-slate-800 px-4 py-3 text-left text-slate-100 hover:bg-slate-700">
            <div class="font-semibold" data-i18n="import.getAddonsOption">Get Addons</div>
            <div class="text-sm text-slate-400" data-i18n="import.getAddonsOptionDesc">Search and download addons from CurseForge or GitHub.</div>
          </button>
          <button id="importGithubBtn" class="w-full rounded bg-slate-800 px-4 py-3 text-left text-slate-100 hover:bg-slate-700">
            <div class="font-semibold" data-i18n="import.github">Import from GitHub</div>
            <div class="text-sm text-slate-400" data-i18n="import.githubDesc">Paste a GitHub repository URL for the addon.</div>
          </button>
          <button id="importFileBtn" class="w-full rounded bg-slate-800 px-4 py-3 text-left text-slate-100 hover:bg-slate-700">
            <div class="font-semibold" data-i18n="import.file">Import from file</div>
            <div class="text-sm text-slate-400" data-i18n="import.fileDesc">Select one or more archive files (.zip, .7z).</div>
          </button>
          <button id="importStringBtn" class="w-full rounded bg-slate-800 px-4 py-3 text-left text-slate-100 hover:bg-slate-700">
            <div class="font-semibold" data-i18n="import.string">Import from code string</div>
            <div class="text-sm text-slate-400" data-i18n="import.stringDesc">Paste an exported addon list base64 code string.</div>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    translateDOM();
    const closeOverlay = () => overlay.remove();
    const getAddonsOptionBtn = overlay.querySelector('#importGetAddonsBtn') as HTMLButtonElement;
    const githubBtn = overlay.querySelector('#importGithubBtn') as HTMLButtonElement;
    const fileBtn = overlay.querySelector('#importFileBtn') as HTMLButtonElement;
    const stringBtn = overlay.querySelector('#importStringBtn') as HTMLButtonElement;
    const cancelBtn = overlay.querySelector('#importCancelBtn') as HTMLButtonElement;

    cancelBtn.addEventListener('click', () => closeOverlay());

    getAddonsOptionBtn.addEventListener('click', () => {
      closeOverlay();
      window.dispatchEvent(new CustomEvent('open-store'));
    });

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
        if (statusFooter) statusFooter.textContent = getTranslation('status.importing');
        if (gamePath) {
          const res = await invoke<string>('import_addon', { basePath: gamePath.value, repoUrl });
          await loadAddonsAndPatches();
          if (statusFooter) statusFooter.textContent = getTranslation('status.imported');
          showToast(getTranslation('toast.imported'));
          await handlePostInstallDependencyCheck(gamePath.value, res);
        }
      } catch (err) {
        const errStr = String(err);
        const cleanErr = parseAndTranslateImportError(errStr);
        if (statusFooter) statusFooter.textContent = `Error: ${cleanErr}`;
      }
    });

    fileBtn.addEventListener('click', async () => {
      closeOverlay();
      try {
        const filePaths = await invoke<string[]>('pick_files');
        if (!filePaths || filePaths.length === 0) return;

        if (statusFooter) statusFooter.textContent = getTranslation('status.importingFiles');
        if (gamePath) {
          const res = await invoke<string>('import_addon_files', {
            basePath: gamePath.value,
            filePaths,
          });
          await loadAddonsAndPatches();
          if (statusFooter) statusFooter.textContent = getTranslation('status.imported');
          showToast(getTranslation('toast.imported'));
          await handlePostInstallDependencyCheck(gamePath.value, res);
        }
      } catch (err) {
        const errStr = String(err);
        if (errStr.startsWith('BUNDLED:')) {
          if (statusFooter) statusFooter.textContent = getTranslation('import.status.bundledAddon');
          const parts = errStr.substring(8).split('|');
          const tempPath = parts[0];
          const names = parts[1].split(',');
          showBundledWarningModal(
            (gamePath as HTMLInputElement).value,
            tempPath,
            names,
            async () => {
              await loadAddonsAndPatches();
            }
          );
        } else if (errStr.startsWith('REPLACE_WARNING:')) {
          if (statusFooter) statusFooter.textContent = 'Conflicting addon files detected.';
          const parts = errStr.substring(16).split('|');
          const tempPath = parts[0];
          const names = parts[1].split(',');
          const proceed = await showReplaceWarningModal(tempPath, names);
          if (proceed && gamePath) {
            try {
              if (statusFooter) statusFooter.textContent = 'Overwriting conflicting addons...';
              const res = await invoke<string>('confirm_install_bundled', {
                basePath: gamePath.value,
                tempDirPath: tempPath,
                allowedDirs: null,
              });
              await loadAddonsAndPatches();
              if (statusFooter) statusFooter.textContent = getTranslation('status.imported');
              showToast(getTranslation('toast.imported'));
              await handlePostInstallDependencyCheck(gamePath.value, res);
            } catch (confirmErr) {
              /* v8 ignore next */
              if (statusFooter) statusFooter.textContent = `Error: ${confirmErr}`;
            }
          } else {
            /* v8 ignore next */
            if (statusFooter) statusFooter.textContent = 'Import cancelled.';
          }
        } else {
          const cleanErr = parseAndTranslateImportError(errStr);
          if (statusFooter) statusFooter.textContent = `Error: ${cleanErr}`;
        }
      }
    });

    stringBtn.addEventListener('click', async () => {
      closeOverlay();
      await handleImportString();
    });
  });
}

export function parseAndTranslateImportError(err: string): string {
  if (err.startsWith('LOOSE_FILES:')) {
    return getTranslation('import.error.looseFiles');
  }
  if (err.startsWith('NO_TOC:')) {
    return getTranslation('import.error.noToc');
  }
  if (err.startsWith('CORRUPTED:')) {
    return getTranslation('import.error.corrupted');
  }
  return err;
}

export function showBundledWarningModal(
  basePath: string,
  tempPath: string,
  addonNames: string[],
  onComplete: () => Promise<void>
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const modal = document.getElementById('bundledAddonModal') as HTMLElement;
    const list = document.getElementById('bundledAddonList') as HTMLElement;
    const confirmBtn = document.getElementById('confirmBundledInstallBtn') as HTMLButtonElement;
    const cancelBtn = document.getElementById('confirmBundledCancelBtn') as HTMLButtonElement;

    list.innerHTML = addonNames
      .map(
        (name) => `
        <label class="flex items-center gap-2 py-1.5 border-b border-slate-800 last:border-0 cursor-pointer">
          <input type="checkbox" class="bundled-addon-checkbox w-4 h-4 accent-sky-500 rounded border-slate-700 bg-slate-800 cursor-pointer" data-name="${name}" checked />
          <span>${name}</span>
        </label>
      `
      )
      .join('');
    modal.classList.remove('hidden');

    const checkboxes = list.querySelectorAll(
      '.bundled-addon-checkbox'
    ) as NodeListOf<HTMLInputElement>;
    const updateConfirmBtn = () => {
      let count = 0;
      checkboxes.forEach((c) => {
        if (c.checked) count++;
      });
      confirmBtn.disabled = count === 0;
    };
    checkboxes.forEach((c) => c.addEventListener('change', updateConfirmBtn));
    updateConfirmBtn();

    const cleanup = () => {
      modal.classList.add('hidden');
      const newConfirmBtn = confirmBtn.cloneNode(true);
      const newCancelBtn = cancelBtn.cloneNode(true);
      confirmBtn.parentNode?.replaceChild(newConfirmBtn, confirmBtn);
      cancelBtn.parentNode?.replaceChild(newCancelBtn, cancelBtn);
    };

    document.getElementById('confirmBundledInstallBtn')?.addEventListener('click', async () => {
      const allowedDirs: string[] = [];
      checkboxes.forEach((cb) => {
        if (cb.checked) {
          const name = cb.getAttribute('data-name');
          if (name) allowedDirs.push(name);
        }
      });

      cleanup();
      const statusFooter = document.getElementById('status');
      try {
        if (statusFooter)
          statusFooter.textContent = getTranslation('import.status.installingBundled');
        const res = await invoke<string>('confirm_install_bundled', {
          basePath,
          tempDirPath: tempPath,
          allowedDirs,
        });
        if (statusFooter) statusFooter.textContent = getTranslation('status.imported');
        showToast(getTranslation('toast.imported'));
        await onComplete();
        resolve(res);
      } catch (err) {
        if (statusFooter) statusFooter.textContent = `Error: ${err}`;
        resolve(null);
      }
    });

    document.getElementById('confirmBundledCancelBtn')?.addEventListener('click', async () => {
      cleanup();
      await invoke('cleanup_temp_archive', { tempDirPath: tempPath });
      const statusFooter = document.getElementById('status');
      if (statusFooter) statusFooter.textContent = getTranslation('import.status.cancelled');
      resolve(null);
    });
  });
}

export function showDependencyModal(basePath: string, dependencyNames: string[]): Promise<void> {
  return new Promise<void>((resolve) => {
    const modal = document.getElementById('dependencyModal') as HTMLElement;
    const list = document.getElementById('dependencyList') as HTMLElement;
    const confirmBtn = document.getElementById('dependencyInstallBtn') as HTMLButtonElement;
    const cancelBtn = document.getElementById('dependencyCancelBtn') as HTMLButtonElement;

    list.innerHTML = dependencyNames
      .map((name) => `<div class="py-1 border-b border-slate-800 last:border-0">${name}</div>`)
      .join('');
    modal.classList.remove('hidden');

    const cleanup = () => {
      modal.classList.add('hidden');
      const newConfirmBtn = confirmBtn.cloneNode(true);
      const newCancelBtn = cancelBtn.cloneNode(true);
      confirmBtn.parentNode?.replaceChild(newConfirmBtn, confirmBtn);
      cancelBtn.parentNode?.replaceChild(newCancelBtn, cancelBtn);
    };

    document.getElementById('dependencyInstallBtn')?.addEventListener('click', async () => {
      cleanup();
      const statusFooter = document.getElementById('status');

      let isMock = false;
      try {
        isMock = getCurrentActiveSite() === 'mock';
      } catch (err) {
        console.warn('Could not determine active site', err);
      }

      for (const dep of dependencyNames) {
        try {
          if (statusFooter)
            statusFooter.textContent = getTranslation('import.status.downloadingDependency', {
              name: dep,
            });
          const res = await invoke<string>('resolve_addon_dependency', {
            basePath,
            dependencyName: dep,
            isMock,
          });
          showToast(getTranslation('import.toast.installedDependency', { name: dep }));
          await handlePostInstallDependencyCheck(basePath, res);
        } catch (err) {
          showToast(
            getTranslation('import.toast.failedDependency', { name: dep, error: String(err) })
          );
        }
      }
      if (statusFooter)
        statusFooter.textContent = getTranslation('import.status.dependencyComplete');
      await loadAddonsAndPatches();
      resolve();
    });

    document.getElementById('dependencyCancelBtn')?.addEventListener('click', () => {
      cleanup();
      resolve();
    });
  });
}

export async function handlePostInstallDependencyCheck(basePath: string, successMessage: string) {
  let names: string[] = [];
  if (successMessage.includes(':')) {
    const parts = successMessage.split(':');
    names = parts[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } else if (successMessage.includes('Imported addon ')) {
    const name = successMessage.replace('Imported addon ', '').split(' ')[0].trim();
    if (name) names.push(name);
  }

  if (names.length === 0) return;

  const allMissing = new Set<string>();
  for (const name of names) {
    try {
      const missing = await invoke<string[]>('check_addon_dependencies', {
        basePath,
        addonName: name,
      });
      for (const dep of missing) {
        allMissing.add(dep);
      }
    } catch (e) {
      console.error('Error checking deps for', name, e);
    }
  }

  if (allMissing.size > 0) {
    await showDependencyModal(basePath, Array.from(allMissing));
  }
}

export function showReplaceWarningModal(
  tempPath: string,
  conflictingNames: string[]
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const modal = document.getElementById('replaceWarningModal') as HTMLElement;
    const list = document.getElementById('replaceWarningList') as HTMLElement;
    const confirmBtn = document.getElementById('replaceWarningConfirmBtn') as HTMLButtonElement;
    const cancelBtn = document.getElementById('replaceWarningCancelBtn') as HTMLButtonElement;

    list.innerHTML = conflictingNames
      .map((name) => `<div class="py-1 border-b border-slate-800 last:border-0">${name}</div>`)
      .join('');
    modal.classList.remove('hidden');

    const cleanup = () => {
      modal.classList.add('hidden');
      const newConfirmBtn = confirmBtn.cloneNode(true);
      const newCancelBtn = cancelBtn.cloneNode(true);
      confirmBtn.parentNode?.replaceChild(newConfirmBtn, confirmBtn);
      cancelBtn.parentNode?.replaceChild(newCancelBtn, cancelBtn);
    };

    document.getElementById('replaceWarningConfirmBtn')?.addEventListener('click', () => {
      cleanup();
      resolve(true);
    });

    document.getElementById('replaceWarningCancelBtn')?.addEventListener('click', async () => {
      cleanup();
      await invoke('cleanup_temp_archive', { tempDirPath: tempPath });
      resolve(false);
    });
  });
}
