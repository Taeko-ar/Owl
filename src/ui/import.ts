import { invoke } from '@tauri-apps/api/core';
import { getTranslation } from '../i18n/index';
import { showToast, showTextInputModal } from '../utils';
import { loadAddonsAndPatches } from '../main';

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
        if (statusFooter) statusFooter.textContent = getTranslation('status.importing');
        if (gamePath) await invoke('import_addon', { basePath: gamePath.value, repoUrl });
        await loadAddonsAndPatches();
        if (statusFooter) statusFooter.textContent = getTranslation('status.imported');
        showToast(getTranslation('toast.imported'));
      } catch (err) {
        if (statusFooter) statusFooter.textContent = `Error: ${err}`;
      }
    });

    fileBtn.addEventListener('click', async () => {
      closeOverlay();
      try {
        const filePaths = await invoke<string[]>('pick_files');
        if (!filePaths || filePaths.length === 0) return;

        if (statusFooter) statusFooter.textContent = getTranslation('status.importingFiles');
        if (gamePath) await invoke('import_addon_files', { basePath: gamePath.value, filePaths });
        await loadAddonsAndPatches();
        if (statusFooter) statusFooter.textContent = getTranslation('status.imported');
        showToast(getTranslation('toast.imported'));
      } catch (err) {
        if (statusFooter) statusFooter.textContent = `Error: ${err}`;
      }
    });
  });
}
