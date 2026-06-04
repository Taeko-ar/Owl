import { invoke } from '@tauri-apps/api/core';
import { parsePatchFilename, escapeHtml, showToast } from '../utils';
import { getTranslation } from '../i18n';
import { loadAddonsAndPatches } from './addons';

export async function loadPatches(
  patches: string[],
  gamePathValue: string,
  statusFooter: HTMLElement | null
) {
  const patchesList = document.getElementById('patches-list') as HTMLDivElement;
  const patchesEmpty = document.getElementById('patches-empty') as HTMLDivElement;

  if (!patchesList || !patchesEmpty) return;

  if (patches.length > 0) {
    patchesEmpty.classList.add('hidden');
    patchesEmpty.style.display = 'none';
    patchesList.classList.remove('hidden');
    patchesList.style.display = '';
    patchesList.innerHTML = patches
      .map((patch) => {
        const { enabled, displayName } = parsePatchFilename(patch);
        return `
        <div class="flex flex-col justify-center border-b border-slate-800 py-2" data-patch="${patch}">
          <div class="flex items-center justify-between w-full">
            <div class="flex items-center gap-3 min-w-0">
              <label class="toggle-switch flex-shrink-0">
                <input type="checkbox" class="patch-toggle" data-patch="${patch}" ${enabled ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
              <span class="font-semibold text-slate-100 truncate text-sm">${escapeHtml(displayName)}</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-2 normal-actions">
                <button class="delete-patch p-1.5 rounded-md text-red-400 hover:text-red-300 hover:bg-red-950/30 transition-all duration-200" data-patch="${patch}" title="Delete Patch">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4 pointer-events-none">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
              <div class="flex items-center gap-1.5 confirm-actions hidden">
                <span class="text-xs text-red-400 font-semibold">${getTranslation('store.confirmDeleteShort')}</span>
                <button class="confirm-delete px-2 py-1 text-[11px] font-semibold bg-red-600 hover:bg-red-500 rounded text-slate-100 transition-all duration-150" data-patch="${patch}">
                  ${getTranslation('buttons.yes')}
                </button>
                <button class="cancel-delete px-2 py-1 text-[11px] font-semibold bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded text-slate-200 transition-all duration-150">
                  ${getTranslation('buttons.no')}
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
      })
      .join('');

    patchesList.querySelectorAll('.patch-toggle').forEach((chk) => {
      chk.addEventListener('change', async (e) => {
        const checkbox = e.target as HTMLInputElement;
        const patch = checkbox.getAttribute('data-patch');
        const enable = checkbox.checked;
        try {
          const res = await invoke<string>('toggle_patch', {
            basePath: gamePathValue,
            patchName: patch,
            enable,
          });
          if (statusFooter) statusFooter.textContent = res;
          showToast(getTranslation('toast.saved'));
          await loadAddonsAndPatches();
        } catch (err) {
          if (statusFooter) statusFooter.textContent = `Error: ${err}`;
        }
      });
    });

    patchesList.querySelectorAll('.delete-patch').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const parent = btn.parentElement;
        const item = parent ? parent.parentElement : null;
        if (item) {
          item.querySelector('.normal-actions')!.classList.add('hidden');
          item.querySelector('.confirm-actions')!.classList.remove('hidden');
        }
      });
    });

    patchesList.querySelectorAll('.confirm-actions .cancel-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const parent = btn.parentElement;
        const item = parent ? parent.parentElement : null;
        if (item) {
          item.querySelector('.confirm-actions')!.classList.add('hidden');
          item.querySelector('.normal-actions')!.classList.remove('hidden');
        }
      });
    });

    patchesList.querySelectorAll('.confirm-actions .confirm-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const patch = (e.currentTarget as HTMLButtonElement).getAttribute('data-patch');
        if (!patch) return;
        try {
          await invoke('delete_patch', { basePath: gamePathValue, patchName: patch });
          await loadAddonsAndPatches();
          if (statusFooter) statusFooter.textContent = `Deleted patch: ${patch}`;
        } catch (err) {
          if (statusFooter) statusFooter.textContent = `Error: ${err}`;
        }
      });
    });
  } else {
    patchesEmpty.classList.remove('hidden');
    patchesEmpty.style.display = 'flex';
    patchesEmpty.classList.add('flex', 'flex-1', 'items-center', 'justify-center');
    patchesList.classList.add('hidden');
    patchesList.style.display = 'none';
    patchesList.innerHTML = '';
  }
}
