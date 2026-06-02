import { invoke } from '@tauri-apps/api/core';
import { getTranslation } from '../i18n/index';
import { showToast, showTextInputModal } from '../utils';
import { loadAddonsAndPatches } from '../main';
import { handleImportString } from './import-export';

export function setupImportModalEvents() {
  const importAddonBtn = document.getElementById('importAddonBtn') as HTMLButtonElement | null;
  const statusFooter = document.getElementById('status') as HTMLElement | null;
  const gamePath = document.getElementById('gamePath') as HTMLInputElement | null;

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
    const { translateDOM } = await import('../main');
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
        let res = '';
        if (gamePath) {
          res = await invoke<string>('import_addon', { basePath: gamePath.value, repoUrl });
        }
        await loadAddonsAndPatches();
        if (statusFooter) statusFooter.textContent = getTranslation('status.imported');
        showToast(getTranslation('toast.imported'));
        if (gamePath) {
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
        let res = '';
        if (gamePath) {
          res = await invoke<string>('import_addon_files', { basePath: gamePath.value, filePaths });
        }
        await loadAddonsAndPatches();
        if (statusFooter) statusFooter.textContent = getTranslation('status.imported');
        showToast(getTranslation('toast.imported'));
        if (gamePath) {
          await handlePostInstallDependencyCheck(gamePath.value, res);
        }
      } catch (err) {
        const errStr = String(err);
        if (errStr.startsWith('BUNDLED:')) {
          if (statusFooter)
            statusFooter.textContent = 'Bundled addon detected. Waiting for confirmation.';
          const parts = errStr.substring(8).split('|');
          const tempPath = parts[0];
          const names = parts[1].split(',');
          if (gamePath) {
            showBundledWarningModal(gamePath.value, tempPath, names, async () => {
              await loadAddonsAndPatches();
            });
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
) {
  const modal = document.getElementById('bundledAddonModal') as HTMLElement;
  const list = document.getElementById('bundledAddonList') as HTMLElement;
  const confirmBtn = document.getElementById('confirmBundledInstallBtn') as HTMLButtonElement;
  const cancelBtn = document.getElementById('confirmBundledCancelBtn') as HTMLButtonElement;

  list.innerHTML = addonNames
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

  document.getElementById('confirmBundledInstallBtn')?.addEventListener('click', async () => {
    cleanup();
    const statusFooter = document.getElementById('status');
    try {
      if (statusFooter) statusFooter.textContent = 'Installing bundled addons...';
      const res = await invoke<string>('confirm_install_bundled', {
        basePath,
        tempDirPath: tempPath,
      });
      if (statusFooter) statusFooter.textContent = 'Addon imported successfully';
      showToast(getTranslation('toast.imported'));
      await onComplete();
      await handlePostInstallDependencyCheck(basePath, res);
    } catch (err) {
      if (statusFooter) statusFooter.textContent = `Error: ${err}`;
    }
  });

  document.getElementById('confirmBundledCancelBtn')?.addEventListener('click', async () => {
    cleanup();
    await invoke('cleanup_temp_archive', { tempDirPath: tempPath });
    const statusFooter = document.getElementById('status');
    if (statusFooter) statusFooter.textContent = 'Installation cancelled.';
  });
}

export function showDependencyModal(basePath: string, dependencyNames: string[]) {
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
      const { getCurrentActiveSite } = await import('../state');
      isMock = getCurrentActiveSite() === 'mock';
    } catch (err) {
      console.warn('Could not determine active site', err);
    }

    for (const dep of dependencyNames) {
      try {
        if (statusFooter) statusFooter.textContent = `Downloading dependency: ${dep}...`;
        const res = await invoke<string>('resolve_addon_dependency', {
          basePath,
          dependencyName: dep,
          isMock,
        });
        showToast(`Installed dependency: ${dep}`);
        await handlePostInstallDependencyCheck(basePath, res);
      } catch (err) {
        showToast(`Failed to resolve dependency ${dep}: ${err}`);
      }
    }
    if (statusFooter) statusFooter.textContent = 'Dependency resolution complete.';
    await loadAddonsAndPatches();
  });

  document.getElementById('dependencyCancelBtn')?.addEventListener('click', () => {
    cleanup();
  });
}

export async function handlePostInstallDependencyCheck(basePath: string, successMessage: string) {
  let names: string[] = [];
  if (successMessage.includes(':')) {
    const parts = successMessage.split(':');
    if (parts.length > 1) {
      names = parts[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
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
    showDependencyModal(basePath, Array.from(allMissing));
  }
}
