import { invoke } from '@tauri-apps/api/core';
import { getTranslation } from '../i18n/index';
import { showToast } from '../utils';
import { AddonGitStatus } from '../types';

import { gitStatusCache } from '../state';

export function setupGitStatusEvents() {
  document.addEventListener('click', () => {
    document.querySelectorAll('.addon-branch-dropdown').forEach((d) => {
      d.classList.add('hidden');
    });
  });
}

export function renderGitStatusUI(
  addonName: string,
  container: HTMLElement,
  branchContainer: HTMLElement | null,
  branchBtn: HTMLButtonElement | null,
  status: AddonGitStatus | null | undefined,
  gamePathValue: string,
  statusFooter: HTMLElement | null
) {
  if (status) {
    const hasUpdate = status.updateAvailable;
    let statusHtml = '';
    if (hasUpdate) {
      statusHtml = `
        <span class="inline-block w-2 h-2 bg-sky-500 border border-sky-600 rounded-full animate-pulse"></span>
        <button class="update-addon text-sky-400 hover:text-sky-300 font-semibold" data-addon="${addonName}">${getTranslation('git.update')}</button>
      `;
    } else {
      statusHtml = `
        <span class="inline-block w-2 h-2 bg-green-500 border border-green-600 rounded-full"></span>
        <span class="text-slate-400">${getTranslation('git.uptodate')}</span>
      `;
    }

    if (status.lastCommit) {
      statusHtml += `<span class="text-slate-500 text-[11px] font-normal ml-1">(${status.lastCommit})</span>`;
    }
    container.innerHTML = statusHtml;

    const validBranches = (status.branches || []).filter(
      (b: string) => b && b.trim() !== '' && b !== 'origin' && b !== 'remotes/origin'
    );

    if (branchBtn) {
      const branchSpan = branchBtn.querySelector('.addon-current-branch') as HTMLSpanElement;
      if (branchSpan) branchSpan.textContent = status.branch || getTranslation('git.unknown');

      const parentContainer = branchBtn.parentElement;
      if (parentContainer) {
        if (validBranches.length > 1) {
          parentContainer.classList.remove('hidden');
        } else {
          parentContainer.classList.add('hidden');
        }
      }
    }

    if (validBranches.length > 0 && branchContainer) {
      branchContainer.innerHTML = validBranches
        .map((b: string) => {
          const activeClass =
            b === status.branch ? 'bg-slate-800 text-slate-100 font-semibold' : 'text-slate-300';
          return `
             <button class="w-full text-left px-3 py-1.5 hover:bg-slate-800 ${activeClass} text-xs transition-colors duration-150 block cursor-pointer outline-none truncate" data-branch="${b}" title="${b}">
               ${b}
             </button>
           `;
        })
        .join('');

      branchContainer.querySelectorAll('button[data-branch]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const selectedBranch = btn.getAttribute('data-branch');
          if (!selectedBranch) return;

          branchContainer.classList.add('hidden');

          try {
            container.innerHTML = `<span class="text-xs text-slate-500 animate-pulse">${getTranslation('git.switching')}</span>`;
            const res = await invoke<string>('change_addon_branch', {
              basePath: gamePathValue,
              addonName: addonName,
              branchName: selectedBranch,
            });
            if (statusFooter) statusFooter.textContent = res;
            showToast(getTranslation('git.switched', { branch: selectedBranch }));
            await checkSingleAddonGitStatus(
              addonName,
              container,
              gamePathValue,
              statusFooter,
              true
            );
          } catch (err) {
            if (statusFooter) statusFooter.textContent = `Error: ${err}`;
            showToast(getTranslation('git.failed', { error: String(err) }));
            await checkSingleAddonGitStatus(
              addonName,
              container,
              gamePathValue,
              statusFooter,
              true
            );
          }
        });
      });
    } else if (branchContainer) {
      branchContainer.innerHTML = '';
    }

    const updateBtn = container.querySelector('.update-addon');
    updateBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        container.innerHTML = `<span class="text-xs text-slate-400 animate-pulse">${getTranslation('git.updating')}</span>`;
        if (branchContainer) branchContainer.classList.add('hidden');

        const res = await invoke<string>('update_addon', {
          basePath: gamePathValue,
          addonName: addonName,
        });
        if (statusFooter) statusFooter.textContent = res;
        showToast(res);
        await checkSingleAddonGitStatus(addonName, container, gamePathValue, statusFooter, true);
      } catch (err) {
        if (statusFooter) statusFooter.textContent = `Error: ${err}`;
        container.innerHTML = `<span class="text-xs text-red-400" title="${err}">⚠️ ${getTranslation('git.updatefailed')}</span>`;
        setTimeout(
          () => checkSingleAddonGitStatus(addonName, container, gamePathValue, statusFooter, true),
          3000
        );
      }
    });
  } else {
    container.innerHTML = '';
    if (branchContainer) {
      branchContainer.innerHTML = '';
    }
  }
}

export async function checkSingleAddonGitStatus(
  addonName: string,
  container: HTMLElement,
  gamePathValue: string,
  statusFooter: HTMLElement | null,
  forceCheck = false
) {
  const parentRow = container.closest('.flex-col') as HTMLElement;
  const branchContainer = parentRow?.querySelector(
    `.addon-branch-dropdown[data-addon="${addonName}"]`
  ) as HTMLElement;
  const branchBtn = parentRow?.querySelector(
    `.addon-git-branch-btn[data-addon="${addonName}"]`
  ) as HTMLButtonElement | null;

  if (!forceCheck && gitStatusCache.has(addonName)) {
    const cachedStatus = gitStatusCache.get(addonName);
    renderGitStatusUI(
      addonName,
      container,
      branchContainer,
      branchBtn,
      cachedStatus,
      gamePathValue,
      statusFooter
    );
    return;
  }

  try {
    const status = await invoke<AddonGitStatus>('check_addon_git_status', {
      basePath: gamePathValue,
      addonName: addonName,
    });
    gitStatusCache.set(addonName, status);
    renderGitStatusUI(
      addonName,
      container,
      branchContainer,
      branchBtn,
      status,
      gamePathValue,
      statusFooter
    );
  } catch (err) {
    container.innerHTML = `<span class="inline-block w-2 h-2 bg-red-500 border border-red-600 rounded-full"></span> <span class="text-xs text-red-400" title="${err}">⚠️ ${getTranslation('git.checkfailed')}</span>`;
  }
}
