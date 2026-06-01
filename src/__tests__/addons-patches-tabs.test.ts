import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadAddonsAndPatches } from '../tabs/addons';
import { invoke } from '@tauri-apps/api/core';
import { checkSingleAddonGitStatus } from '../ui/git-status';
import { showAddonModal } from '../ui/addon-modal';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../ui/git-status', () => ({
  checkSingleAddonGitStatus: vi.fn().mockImplementation(() => Promise.resolve()),
}));

vi.mock('../ui/addon-modal', () => ({
  showAddonModal: vi.fn(),
}));

describe('Addons & Patches Tabs UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('exits early if core DOM elements are missing', async () => {
    document.body.innerHTML = '';
    const res = await loadAddonsAndPatches();
    expect(res).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('renders addons and patches list successfully', async () => {
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
      <button id="exportAddonsBtn"></button>
      <input id="addons-search" value="searchQuery" />
      <input id="patches-search" value="patchQuery" />
    `;

    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === 'get_addons') {
        return Promise.resolve(['MyAddon', 'Blizzard_CombatLog', 'GitAddon', 'BadAddon']);
      }
      if (cmd === 'get_patches') {
        return Promise.resolve(['patch-enUS-W.mpq', 'patch-enUS-X-disabled.mpq']);
      }
      if (cmd === 'parse_toc') {
        if (args.addonName === 'GitAddon') {
          return Promise.resolve({
            name: 'GitAddon',
            title: '|cff00ff00Git Addon|r',
            author: '|cff0000ffAuthorName|r',
            version: '1.2.3',
            hasGit: true,
          });
        }
        if (args.addonName === 'MyAddon') {
          return Promise.resolve({
            name: 'MyAddon',
            title: 'My Addon Title',
            author: null,
            version: '2.0.0',
            hasGit: false,
          });
        }
        return Promise.reject(new Error('Parse error'));
      }
      return Promise.resolve();
    });

    await loadAddonsAndPatches();
    // Flush microtasks for the background async self-invoking git status loop
    await new Promise((resolve) => setTimeout(resolve, 0));

    const addonsList = document.getElementById('addons-list');
    expect(addonsList?.innerHTML).toContain('MyAddon');
    expect(addonsList?.innerHTML).toContain('Git Addon');

    const patchesList = document.getElementById('patches-list');
    expect(patchesList?.innerHTML).toContain('patch-enUS-W.mpq');

    // Trigger details modal click
    const addonItem = document.querySelector('.addon-item[data-addon="MyAddon"]') as HTMLElement;
    addonItem.click();
    expect(invoke).toHaveBeenLastCalledWith('parse_toc', {
      basePath: '/mock/wow',
      addonName: 'MyAddon',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(showAddonModal).toHaveBeenCalled();

    // Trigger details modal click failure coverage
    (invoke as any).mockImplementationOnce((cmd: string) => {
      if (cmd === 'parse_toc') return Promise.reject('Failed to parse');
      return Promise.resolve();
    });
    const addonItem2 = document.querySelector('.addon-item[data-addon="GitAddon"]') as HTMLElement;
    addonItem2.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const statusFooter = document.getElementById('status');
    expect(statusFooter?.textContent).toContain('Error: Failed to parse');

    // Trigger folder open
    const openBtn = document.querySelector('.open-addon[data-addon="MyAddon"]') as HTMLElement;
    openBtn.click();
    expect(invoke).toHaveBeenCalledWith('open_addon_folder', {
      basePath: '/mock/wow',
      addonName: 'MyAddon',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(statusFooter?.textContent).toContain('Opened folder: MyAddon');

    // Trigger folder open failure
    (invoke as any).mockImplementationOnce(() => Promise.reject('Open failed'));
    openBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(statusFooter?.textContent).toContain('Error: Open failed');

    // Toggle addon change event
    const addonChk = document.querySelector(
      '.addon-toggle[data-addon="MyAddon"]'
    ) as HTMLInputElement;
    addonChk.checked = false;
    addonChk.dispatchEvent(new Event('change'));
    expect(invoke).toHaveBeenCalledWith('toggle_addon', {
      basePath: '/mock/wow',
      addonName: 'MyAddon',
      enable: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Toggle addon failure
    (invoke as any).mockImplementationOnce(() => Promise.reject('Toggle failed'));
    addonChk.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(statusFooter?.textContent).toContain('Error: Toggle failed');

    // Delete addon Flow (confirm, cancel, confirm delete)
    const delBtn = document.querySelector('.delete-addon[data-addon="MyAddon"]') as HTMLElement;
    delBtn.click();
    const normalActions = delBtn.parentElement;
    const confirmActions = normalActions?.nextElementSibling as HTMLElement;
    expect(normalActions?.classList.contains('hidden')).toBe(true);
    expect(confirmActions?.classList.contains('hidden')).toBe(false);

    // Cancel delete
    const cancelBtn = confirmActions.querySelector('.cancel-delete') as HTMLElement;
    cancelBtn.click();
    expect(normalActions?.classList.contains('hidden')).toBe(false);
    expect(confirmActions?.classList.contains('hidden')).toBe(true);

    // Confirm delete
    delBtn.click();
    const confirmDelBtn = confirmActions.querySelector('.confirm-delete') as HTMLElement;
    confirmDelBtn.click();
    expect(invoke).toHaveBeenCalledWith('delete_addon', {
      basePath: '/mock/wow',
      addonName: 'MyAddon',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Confirm delete failure
    (invoke as any).mockImplementationOnce(() => Promise.reject('Delete failed'));
    delBtn.click();
    confirmDelBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invoke).toHaveBeenCalledWith('delete_addon', {
      basePath: '/mock/wow',
      addonName: 'MyAddon',
    });

    // Git branch button dropdown toggle
    const gitBranchBtn = document.querySelector(
      '.addon-git-branch-btn[data-addon="GitAddon"]'
    ) as HTMLElement;
    gitBranchBtn.click();
    const dropdown = gitBranchBtn.nextElementSibling as HTMLElement;
    expect(dropdown.classList.contains('hidden')).toBe(false);
    gitBranchBtn.click();
    expect(dropdown.classList.contains('hidden')).toBe(true);

    // Document click hides dropdowns
    gitBranchBtn.click();
    expect(dropdown.classList.contains('hidden')).toBe(false);
    document.dispatchEvent(new Event('click'));
    expect(dropdown.classList.contains('hidden')).toBe(true);

    // Patches toggling/deleting
    const patchToggle = document.querySelector(
      '.patch-toggle[data-patch="patch-enUS-W.mpq"]'
    ) as HTMLInputElement;
    patchToggle.checked = false;
    patchToggle.dispatchEvent(new Event('change'));
    expect(invoke).toHaveBeenCalledWith('toggle_patch', {
      basePath: '/mock/wow',
      patchName: 'patch-enUS-W.mpq',
      enable: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Toggle patch failure
    (invoke as any).mockImplementationOnce(() => Promise.reject('Patch toggle failed'));
    patchToggle.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(statusFooter?.textContent).toContain('Error: Patch toggle failed');

    // Patch deletion
    const delPatchBtn = document.querySelector(
      '.delete-patch[data-patch="patch-enUS-W.mpq"]'
    ) as HTMLElement;
    delPatchBtn.click();
    const patchNormalActions = delPatchBtn.parentElement;
    const patchConfirmActions = patchNormalActions?.nextElementSibling as HTMLElement;
    expect(patchConfirmActions.classList.contains('hidden')).toBe(false);

    // Cancel patch delete
    const cancelPatchBtn = patchConfirmActions.querySelector('.cancel-delete') as HTMLElement;
    cancelPatchBtn.click();
    expect(patchConfirmActions.classList.contains('hidden')).toBe(true);

    // Confirm patch delete
    delPatchBtn.click();
    const confirmPatchDelBtn = patchConfirmActions.querySelector('.confirm-delete') as HTMLElement;
    confirmPatchDelBtn.click();
    expect(invoke).toHaveBeenCalledWith('delete_patch', {
      basePath: '/mock/wow',
      patchName: 'patch-enUS-W.mpq',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Confirm patch delete failure
    (invoke as any).mockImplementationOnce(() => Promise.reject('Patch delete failed'));
    delPatchBtn.click();
    confirmPatchDelBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invoke).toHaveBeenCalledWith('delete_patch', {
      basePath: '/mock/wow',
      patchName: 'patch-enUS-W.mpq',
    });
  });

  it('renders empty lists when lists are empty', async () => {
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
      <button id="exportAddonsBtn"></button>
    `;

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'get_patches') return Promise.resolve([]);
      return Promise.resolve();
    });

    await loadAddonsAndPatches();

    const addonEmpty = document.getElementById('addons-empty');
    expect(addonEmpty?.classList.contains('hidden')).toBe(false);
    const exportBtn = document.getElementById('exportAddonsBtn') as HTMLButtonElement;
    expect(exportBtn.getAttribute('disabled')).toBe('true');
  });

  it('handles load failure in try-catch block', async () => {
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
    `;

    (invoke as any).mockImplementation(() => Promise.reject('Fatal load error'));

    // Spy on status text setter or clearLoadingState
    const statusFooter = document.getElementById('status') as HTMLElement;
    const originalTextContent = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'textContent'
    );
    const capturedText: string[] = [];
    Object.defineProperty(statusFooter, 'textContent', {
      set(val) {
        capturedText.push(val);
        originalTextContent?.set?.call(statusFooter, val);
      },
      get() {
        return originalTextContent?.get?.call(statusFooter);
      },
    });

    await loadAddonsAndPatches();

    expect(capturedText).toContain('Error loading files: Fatal load error');
  });
});
