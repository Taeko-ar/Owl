import { invoke } from '@tauri-apps/api/core';
import { getTranslation } from '../i18n/index';
import { showToast, escapeHtml } from '../utils';
import { CurseForgeFile } from '../types';
import { loadAddonsAndPatches } from '../tabs/addons';

export interface ExportedAddon {
  name: string;
  enabled: boolean;
  source: string;
  gitUrl?: string;
  branch?: string;
  commitSha?: string;
  modId?: number;
  fileId?: number;
}

export interface ExportPayload {
  v: number;
  addons: ExportedAddon[];
}

let activePayloadToImport: ExportPayload | null = null;

export async function handleImportString() {
  const gamePathInput = document.getElementById('gamePath') as HTMLInputElement | null;
  const importPreviewModal = document.getElementById('importPreviewModal');
  const importPreviewTableBody = document.getElementById('import-preview-table-body');
  const importManualWarningContainer = document.getElementById('importManualWarningContainer');
  const importManualList = document.getElementById('importManualList');

  const codeStr = await new Promise<string | null>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
    overlay.innerHTML = `
      <div class="w-full max-w-lg rounded-lg bg-slate-900 border border-slate-700 p-6 shadow-2xl flex flex-col">
        <div class="flex items-center justify-between mb-4 flex-shrink-0">
          <h3 class="text-base font-bold text-slate-100">${getTranslation('import.string')}</h3>
          <button type="button" class="text-slate-400 hover:text-slate-200" id="closeImportStringModal">✕</button>
        </div>
        <p class="text-xs text-slate-400 mb-3 flex-shrink-0">${getTranslation('import.stringDesc')}</p>
        <textarea id="modalInput" placeholder="Paste base64 code string here..." class="w-full h-32 bg-slate-950 border border-slate-700 rounded p-2 text-xs font-mono text-slate-300 outline-none resize-none mb-4 focus:border-slate-500 transition-colors"></textarea>
        <div class="flex justify-end gap-3 flex-shrink-0">
          <button id="cancelImportStringModal" class="rounded border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer outline-none">${getTranslation('settings.cancel')}</button>
          <button id="modalSubmitBtn" class="rounded bg-sky-600 px-5 py-2 text-xs font-bold text-slate-100 hover:bg-sky-500 cursor-pointer outline-none">${getTranslation('export.decryptBtn')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    const textarea = overlay.querySelector('#modalInput') as HTMLTextAreaElement;
    const submitBtn = overlay.querySelector('#modalSubmitBtn') as HTMLButtonElement;
    const cancelBtns = overlay.querySelectorAll(
      '#closeImportStringModal, #cancelImportStringModal'
    );

    const close = () => {
      overlay.remove();
      resolve(null);
    };

    cancelBtns.forEach((btn) => btn.addEventListener('click', close));
    submitBtn.addEventListener('click', () => {
      const val = textarea.value.trim();
      if (!val) return;
      overlay.remove();
      resolve(val);
    });

    textarea.focus();
  });

  if (!codeStr) return;

  try {
    const payload = await invoke<ExportPayload>('validate_import_string', { importStr: codeStr });
    activePayloadToImport = payload;

    // Fetch current addons to see what is already installed
    const currentAddons = await invoke<string[]>('get_addons', {
      basePath: gamePathInput?.value || '',
    });
    const currentSet = new Set(currentAddons.map((a) => a.toLowerCase().replace(/-disabled$/, '')));

    if (importPreviewTableBody) {
      importPreviewTableBody.innerHTML = '';
    }

    const manualAddons = payload.addons.filter((a) => a.source === 'manual').map((a) => a.name);
    if (manualAddons.length > 0) {
      if (importManualList) {
        importManualList.textContent = manualAddons.join('\n');
      }
      importManualWarningContainer?.classList.remove('hidden');
    } else {
      importManualWarningContainer?.classList.add('hidden');
    }

    payload.addons.forEach((addon) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-800 hover:bg-slate-900/40 transition-colors';
      const nameLower = addon.name.toLowerCase();
      let statusText = '';
      let statusClass = '';

      if (currentSet.has(nameLower)) {
        statusText = getTranslation('import.status.installed');
        statusClass = 'text-slate-400';
      } else if (addon.source === 'manual') {
        statusText = getTranslation('import.status.manual');
        statusClass = 'text-amber-500 font-semibold';
      } else {
        statusText = getTranslation('import.status.restorable');
        statusClass = 'text-sky-400 font-semibold';
      }

      const provider =
        addon.source === 'github'
          ? 'GitHub'
          : addon.source === 'curseforge'
            ? 'CurseForge'
            : 'Manual';

      tr.innerHTML = `
        <td class="p-2 font-semibold text-slate-200">${escapeHtml(addon.name)}</td>
        <td class="p-2 ${statusClass}">${statusText}</td>
        <td class="p-2"><span class="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-slate-400">${provider}</span></td>
      `;
      importPreviewTableBody?.appendChild(tr);
    });

    importPreviewModal?.classList.remove('hidden');
  } catch (err) {
    showToast(getTranslation('export.status.error', { error: String(err) }));
  }
}

export function setupImportExportEvents() {
  const exportBtn = document.getElementById('exportAddonsBtn') as HTMLButtonElement | null;
  const gamePathInput = document.getElementById('gamePath') as HTMLInputElement | null;
  const statusFooter = document.getElementById('status') as HTMLElement | null;

  // Export Modal Elements
  const exportModal = document.getElementById('exportModal');
  const exportCloseBtn = document.getElementById('exportCloseBtn');
  const exportCopyBtn = document.getElementById('exportCopyBtn') as HTMLButtonElement | null;
  const exportStringArea = document.getElementById(
    'exportStringArea'
  ) as HTMLTextAreaElement | null;
  const exportManualWarningContainer = document.getElementById('exportManualWarningContainer');
  const exportManualList = document.getElementById('exportManualList');

  // Import Preview Elements
  const importPreviewModal = document.getElementById('importPreviewModal');
  const importPreviewCancelBtn = document.getElementById('importPreviewCancelBtn');
  const importPreviewConfirmBtn = document.getElementById(
    'importPreviewConfirmBtn'
  ) as HTMLButtonElement | null;
  const importCopyManualBtn = document.getElementById('importCopyManualBtn');
  const importManualList = document.getElementById('importManualList');

  exportBtn?.addEventListener('click', async () => {
    if (!gamePathInput || !gamePathInput.value) return;
    try {
      if (statusFooter) statusFooter.textContent = getTranslation('export.status.generating');
      const b64 = await invoke<string>('export_addon_list', { basePath: gamePathInput.value });
      if (statusFooter) statusFooter.textContent = getTranslation('status.ready');

      // Decode base64 to check for manual addons
      const decoded = atob(b64);
      const payload = JSON.parse(decoded) as ExportPayload;
      const manualAddons = payload.addons.filter((a) => a.source === 'manual').map((a) => a.name);

      if (exportStringArea) {
        exportStringArea.value = b64;
      }

      if (manualAddons.length > 0) {
        if (exportManualList) {
          exportManualList.textContent = manualAddons.join('\n');
        }
        exportManualWarningContainer?.classList.remove('hidden');
      } else {
        exportManualWarningContainer?.classList.add('hidden');
      }

      exportModal?.classList.remove('hidden');
    } catch (err) {
      if (statusFooter)
        statusFooter.textContent = getTranslation('export.status.error', { error: String(err) });
      showToast(getTranslation('export.status.error', { error: String(err) }));
    }
  });

  const closeExport = () => exportModal?.classList.add('hidden');
  exportCloseBtn?.addEventListener('click', closeExport);
  exportModal?.addEventListener('click', (e) => {
    if (e.target === exportModal) closeExport();
  });

  exportCopyBtn?.addEventListener('click', () => {
    if (exportStringArea) {
      exportStringArea.select();
      navigator.clipboard.writeText(exportStringArea.value).then(() => {
        showToast(getTranslation('toast.copiedToClipboard'));
      });
    }
  });

  const exportCopyStringIconBtn = document.getElementById('exportCopyStringIconBtn');
  exportCopyStringIconBtn?.addEventListener('click', () => {
    if (exportStringArea) {
      exportStringArea.select();
      navigator.clipboard.writeText(exportStringArea.value).then(() => {
        showToast(getTranslation('toast.copiedToClipboard'));
      });
    }
  });

  const exportCopyManualBtn = document.getElementById('exportCopyManualBtn');
  exportCopyManualBtn?.addEventListener('click', () => {
    if (exportManualList && exportManualList.textContent) {
      navigator.clipboard.writeText(exportManualList.textContent).then(() => {
        showToast(getTranslation('toast.manualListCopied'));
      });
    }
  });

  importCopyManualBtn?.addEventListener('click', () => {
    if (importManualList && importManualList.textContent) {
      navigator.clipboard.writeText(importManualList.textContent).then(() => {
        showToast(getTranslation('toast.manualListCopied'));
      });
    }
  });

  const closeImportPreview = () => importPreviewModal?.classList.add('hidden');
  importPreviewCancelBtn?.addEventListener('click', closeImportPreview);
  importPreviewModal?.addEventListener('click', (e) => {
    if (e.target === importPreviewModal) closeImportPreview();
  });

  importPreviewConfirmBtn?.addEventListener('click', async () => {
    if (!activePayloadToImport || !gamePathInput) return;

    closeImportPreview();
    const payload = activePayloadToImport;
    activePayloadToImport = null;

    // Get currently installed addons
    const currentAddons = await invoke<string[]>('get_addons', { basePath: gamePathInput.value });
    const currentSet = new Set(currentAddons.map((a) => a.toLowerCase().replace(/-disabled$/, '')));

    let successCount = 0;
    let failedCount = 0;
    const failedList: string[] = [];

    const restorable = payload.addons.filter(
      (a) => a.source !== 'manual' && !currentSet.has(a.name.toLowerCase())
    );

    if (restorable.length === 0) {
      showToast(getTranslation('import.toast.noRestorable'));
      return;
    }

    const total = restorable.length;
    if (statusFooter) {
      statusFooter.textContent = getTranslation('import.status.starting', { total: String(total) });
    }

    const activityProgress = document.getElementById('activityProgress');
    if (activityProgress) {
      activityProgress.style.width = '0%';
    }

    for (let i = 0; i < restorable.length; i++) {
      const addon = restorable[i];
      const percent = Math.round((i / total) * 100);

      if (statusFooter) {
        statusFooter.textContent = getTranslation('status.downloadingAddon', { name: addon.name });
      }
      if (activityProgress) {
        activityProgress.style.width = `${percent}%`;
      }

      try {
        if (addon.source === 'github' && addon.gitUrl) {
          // GitHub download
          await invoke('import_addon', {
            basePath: gamePathInput.value,
            repoUrl: addon.gitUrl,
          });
          // If we had a specific branch checkout/metadata, changing branch is standard.
          // Note: Change branch requires it to be a git clone.
          if (addon.branch) {
            try {
              await invoke('change_addon_branch', {
                basePath: gamePathInput.value,
                addonName: addon.name,
                branchName: addon.branch,
              });
            } catch {
              // Ignore branch switch fail for non-git fallback zip
            }
          }
        } else if (addon.source === 'curseforge' && addon.modId && addon.fileId) {
          // Fetch CurseForge file downloadUrl if not preset, or build Edge URL
          const isMock = false; // standard is CurseForge
          const filesResponse = await invoke<{ data: CurseForgeFile[] }>(
            'get_curseforge_mod_files',
            {
              modId: addon.modId,
              isMock,
            }
          );
          const fileObj = filesResponse.data?.find((f: CurseForgeFile) => f.id === addon.fileId);
          let dlUrl = fileObj?.downloadUrl;
          if (!dlUrl && fileObj && fileObj.id && fileObj.fileName) {
            const strId = String(fileObj.id);
            if (strId.length >= 4) {
              const part1 = strId.substring(0, 4);
              const part2 = strId.substring(4);
              dlUrl = `https://edge.forgecdn.net/files/${part1}/${part2}/${encodeURIComponent(fileObj.fileName)}`;
            }
          }

          if (!dlUrl) {
            // Fallback default
            dlUrl = `https://edge.forgecdn.net/files/${Math.floor(addon.fileId / 1000)}/${addon.fileId % 1000}/${addon.name}.zip`;
          }

          await invoke('download_and_extract_addon', {
            basePath: gamePathInput.value,
            url: dlUrl,
            sha1: null,
            modId: addon.modId,
            fileId: addon.fileId,
          });
        }

        // Toggle disabled state if it was exported disabled
        if (!addon.enabled) {
          await invoke('toggle_addon', {
            basePath: gamePathInput.value,
            addonName: addon.name,
            enable: false,
          });
        }

        successCount++;
      } catch (err) {
        console.error(`Failed to import ${addon.name}:`, err);
        failedCount++;
        failedList.push(addon.name);
      }
    }

    if (activityProgress) {
      activityProgress.style.width = '100%';
    }

    const summary =
      getTranslation('import.status.finished', {
        success: String(successCount),
        fail: String(failedCount),
      }) +
      (failedCount > 0
        ? getTranslation('import.status.failedList', { list: failedList.join(', ') })
        : '');

    if (statusFooter) {
      statusFooter.textContent = summary;
    }
    showToast(getTranslation('import.toast.completed', { count: String(successCount) }));

    setTimeout(() => {
      if (activityProgress) {
        activityProgress.style.width = '0%';
      }
      if (statusFooter) {
        statusFooter.textContent = getTranslation('status.ready');
      }
    }, 4000);

    await loadAddonsAndPatches();
  });
}
