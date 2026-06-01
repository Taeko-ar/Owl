import { invoke } from '@tauri-apps/api/core';
import { formatWithColorCodes, escapeHtml, renderMarkdown } from '../utils';
import { AddonMeta } from '../types';

export function showAddonModal(meta: AddonMeta) {
  const gamePath = document.getElementById('gamePath') as HTMLInputElement | null;
  const statusFooter = document.getElementById('status') as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40';
  overlay.style.backdropFilter = 'blur(4px)';
  const depsHtml =
    meta.optional_deps && meta.optional_deps.length
      ? meta.optional_deps
          .map(
            (d: string, i: number) => `
        <div class="flex items-center gap-2"><span class="${meta.optional_deps_installed && meta.optional_deps_installed[i] ? 'text-emerald-400' : 'text-slate-500'}">${meta.optional_deps_installed && meta.optional_deps_installed[i] ? '✅' : '✖'}</span><span class="text-sm text-slate-300">${d}</span></div>
      `
          )
          .join('')
      : `<div class="text-slate-400 text-sm">No dependencies</div>`;

  overlay.innerHTML = `
    <div class="rounded-lg border border-slate-700 bg-slate-900 p-6 w-11/12 max-w-3xl max-h-[80vh] flex flex-col">
      <div class="flex items-start justify-between mb-4 flex-shrink-0">
        <div>
          <h3 class="text-lg font-bold">${formatWithColorCodes(meta.title || meta.name)}</h3>
          <p class="text-sm text-slate-400">${meta.author ? 'By ' + formatWithColorCodes(meta.author) : ''} ${meta.version ? ' • v' + escapeHtml(meta.version) : ''}</p>
        </div>
        <div class="flex gap-2">
          <button id="modal-open-folder" class="text-sm bg-slate-800 px-3 py-1 rounded">📁</button>
          <button id="modal-close" class="text-sm text-slate-400 hover:text-white">✕</button>
        </div>
      </div>
      <div class="overflow-y-auto flex-1 pr-1">
        <div class="mb-4">
          <h4 class="font-semibold">Dependencies</h4>
          <div class="mt-2">${depsHtml}</div>
        </div>
        <div>
          <h4 class="font-semibold mb-2">Readme</h4>
          <div class="text-sm text-slate-300">${meta.readme ? renderMarkdown(meta.readme, meta.path) : '<span class="text-slate-500">No readme found</span>'}</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('#modal-close') as HTMLElement;
  const openBtn = overlay.querySelector('#modal-open-folder') as HTMLElement;
  closeBtn?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });
  openBtn?.addEventListener('click', async () => {
    if (!gamePath) return;
    try {
      await invoke('open_addon_folder', { basePath: gamePath.value, addonName: meta.name });
      if (statusFooter) statusFooter.textContent = `Opened folder: ${meta.name}`;
    } catch (err) {
      if (statusFooter) statusFooter.textContent = `Error: ${err}`;
    }
  });
}
