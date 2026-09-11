import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { formatWithColorCodes, escapeHtml, renderMarkdown } from '../utils';
import { AddonMeta, AddonGitStatus } from '../types';
import { gitStatusCache, getInstalledAddonsMeta, getCurrentActiveSite } from '../state';
import { getCurseForgeModUrl } from '../store/curseforge';
import { githubIcon, curseforgeIcon, folderIcon } from './icons';

export function showAddonModal(meta: AddonMeta) {
  const gamePath = document.getElementById('gamePath') as HTMLInputElement | null;
  const statusFooter = document.getElementById('status') as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40';
  overlay.style.backdropFilter = 'blur(4px)';
  const depsChips =
    meta.optional_deps && meta.optional_deps.length
      ? meta.optional_deps
          .map((d: string, i: number) => {
            const installed = meta.optional_deps_installed && meta.optional_deps_installed[i];
            return `
        <span class="inline-flex items-center gap-1 text-xs bg-slate-800 rounded px-2 py-0.5">
          <span class="${installed ? 'text-emerald-400' : 'text-slate-500'}">${installed ? '✅' : '✖'}</span>
          <span class="text-slate-300">${d}</span>
        </span>
      `;
          })
          .join('')
      : '';

  overlay.innerHTML = `
    <div class="rounded-lg border border-slate-700 bg-slate-900 p-6 w-11/12 max-w-3xl max-h-[80vh] flex flex-col">
      <div class="flex items-start justify-between mb-4 flex-shrink-0">
        <div>
          <h3 class="text-lg font-bold">${formatWithColorCodes(meta.title || meta.name)}</h3>
          <p class="text-sm text-slate-400">${meta.author ? 'By ' + formatWithColorCodes(meta.author) : ''}${meta.version ? ' • v' + escapeHtml(meta.version) : ''}</p>
          ${depsChips ? `<div class="flex flex-wrap gap-1 mt-2">${depsChips}</div>` : ''}
        </div>
        <div id="modal-header-buttons" class="flex gap-2 flex-shrink-0">
          <button id="modal-open-folder" class="flex items-center justify-center bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded">${folderIcon}</button>
          <button id="modal-close" class="text-sm text-slate-400 hover:text-white">✕</button>
        </div>
      </div>
      <div class="overflow-y-auto flex-1 pr-1">
        <h4 class="font-semibold mb-2">Readme</h4>
        <div class="text-sm text-slate-300 border border-slate-700 rounded-md p-4 bg-slate-950/40 overflow-x-hidden break-words">${meta.readme ? renderMarkdown(meta.readme, meta.path) : '<span class="text-slate-500">No readme found</span>'}</div>
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

  addSourceLinkButton(overlay, meta, gamePath);
}

function insertHeaderLink(overlay: HTMLElement, url: string, iconSvg: string, title: string) {
  const btn = document.createElement('button');
  btn.title = title;
  btn.className =
    'flex items-center justify-center bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded';
  btn.innerHTML = iconSvg;
  btn.addEventListener('click', () => {
    openUrl(url).catch(() => {});
  });
  overlay.querySelector('#modal-header-buttons')?.prepend(btn);
}

async function addSourceLinkButton(
  overlay: HTMLElement,
  meta: AddonMeta,
  gamePath: HTMLInputElement | null
) {
  if (meta.hasGit) {
    let status: AddonGitStatus | null | undefined = gitStatusCache.get(meta.name);
    if (status === undefined && gamePath) {
      try {
        status = await invoke<AddonGitStatus>('check_addon_git_status', {
          basePath: gamePath.value,
          addonName: meta.name,
        });
        gitStatusCache.set(meta.name, status);
      } catch {
        status = null;
      }
    }
    if (status?.remoteUrl && overlay.isConnected) {
      insertHeaderLink(overlay, status.remoteUrl, githubIcon, 'Open Git remote');
    }
    return;
  }

  const installed = getInstalledAddonsMeta().find((a) => a.name === meta.name);
  if (installed?.modId) {
    const isMock = getCurrentActiveSite() === 'mock';
    try {
      const url = await getCurseForgeModUrl(installed.modId, isMock);
      if (url && overlay.isConnected) {
        insertHeaderLink(overlay, url, curseforgeIcon, 'Open on CurseForge');
      }
    } catch {
      // no link if the lookup fails
    }
  }
}
