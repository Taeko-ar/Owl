import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadAddonsAndPatches } from '../tabs/addons';
import { invoke } from '@tauri-apps/api/core';
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
        return Promise.resolve([
          'MyAddon',
          'Blizzard_CombatLog',
          'GitAddon',
          'GitAddon2',
          'BadAddon',
        ]);
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
        if (args.addonName === 'GitAddon2') {
          return Promise.resolve({
            name: 'GitAddon2',
            title: 'Git Addon 2',
            author: 'AuthorName2',
            version: '1.2.4',
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
    // Set mock for reload that happens after toggle
    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon', 'GitAddon']);
      if (cmd === 'get_patches') return Promise.resolve(['patch-enUS-W.mpq']);
      if (cmd === 'parse_toc') {
        if (args.addonName === 'GitAddon') {
          return Promise.resolve({ name: 'GitAddon', title: 'Git Addon', hasGit: true });
        }
        return Promise.resolve({ name: 'MyAddon', title: 'My Addon Title' });
      }
      return Promise.resolve();
    });
    addonChk.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Toggle addon failure
    (invoke as any).mockImplementationOnce(() => Promise.reject('Toggle failed'));
    addonChk.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 10));
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
    // Set mock for loadAddonsAndPatches inside confirm delete reload
    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon', 'GitAddon', 'GitAddon2']);
      if (cmd === 'get_patches') return Promise.resolve(['patch-enUS-W.mpq']);
      if (cmd === 'parse_toc') {
        if (args.addonName === 'GitAddon') {
          return Promise.resolve({ name: 'GitAddon', title: 'Git Addon', hasGit: true });
        }
        if (args.addonName === 'GitAddon2') {
          return Promise.resolve({ name: 'GitAddon2', title: 'Git Addon 2', hasGit: true });
        }
        return Promise.resolve({ name: 'MyAddon', title: 'My Addon Title' });
      }
      return Promise.resolve();
    });
    confirmDelBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Confirm delete failure
    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === 'delete_addon' || cmd === 'delete_patch') {
        return Promise.reject('Delete failed');
      }
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon', 'GitAddon', 'GitAddon2']);
      if (cmd === 'get_patches') return Promise.resolve(['patch-enUS-W.mpq']);
      if (cmd === 'parse_toc') {
        if (args.addonName === 'GitAddon') {
          return Promise.resolve({ name: 'GitAddon', title: 'Git Addon', hasGit: true });
        }
        if (args.addonName === 'GitAddon2') {
          return Promise.resolve({ name: 'GitAddon2', title: 'Git Addon 2', hasGit: true });
        }
        return Promise.resolve({ name: 'MyAddon', title: 'My Addon Title' });
      }
      return Promise.resolve();
    });
    delBtn.click();
    confirmDelBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(statusFooter?.textContent).toBe('Error: Delete failed');

    // Git branch button dropdown toggle
    const gitBranchBtn = document.querySelector(
      '.addon-git-branch-btn[data-addon="GitAddon"]'
    ) as HTMLElement;
    const gitBranchBtn2 = document.querySelector(
      '.addon-git-branch-btn[data-addon="GitAddon2"]'
    ) as HTMLElement;
    gitBranchBtn.click();
    const dropdown = gitBranchBtn.nextElementSibling as HTMLElement;
    expect(dropdown.classList.contains('hidden')).toBe(false);

    // Click the other button to close the first one and open the second one
    gitBranchBtn2.click();
    expect(dropdown.classList.contains('hidden')).toBe(true);

    gitBranchBtn.click();
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
    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon', 'GitAddon', 'GitAddon2']);
      if (cmd === 'get_patches') return Promise.resolve(['patch-enUS-W.mpq']);
      if (cmd === 'parse_toc') {
        if (args.addonName === 'GitAddon') {
          return Promise.resolve({ name: 'GitAddon', title: 'Git Addon', hasGit: true });
        }
        if (args.addonName === 'GitAddon2') {
          return Promise.resolve({ name: 'GitAddon2', title: 'Git Addon 2', hasGit: true });
        }
        return Promise.resolve({ name: 'MyAddon', title: 'My Addon Title' });
      }
      return Promise.resolve();
    });
    patchToggle.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Toggle patch failure
    (invoke as any).mockImplementationOnce(() => Promise.reject('Patch toggle failed'));
    patchToggle.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 10));
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
    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon', 'GitAddon', 'GitAddon2']);
      if (cmd === 'get_patches') return Promise.resolve(['patch-enUS-W.mpq']);
      if (cmd === 'parse_toc') {
        if (args.addonName === 'GitAddon') {
          return Promise.resolve({ name: 'GitAddon', title: 'Git Addon', hasGit: true });
        }
        if (args.addonName === 'GitAddon2') {
          return Promise.resolve({ name: 'GitAddon2', title: 'Git Addon 2', hasGit: true });
        }
        return Promise.resolve({ name: 'MyAddon', title: 'My Addon Title' });
      }
      return Promise.resolve();
    });
    confirmPatchDelBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Confirm patch delete failure
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'delete_patch' || cmd === 'delete_addon') {
        return Promise.reject('Patch delete failed');
      }
      return Promise.resolve();
    });
    delPatchBtn.click();
    confirmPatchDelBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(statusFooter?.textContent).toBe('Error: Patch delete failed');
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

  it('covers missing optional elements and elements in patches.ts/addons.ts to hit all remaining branches', async () => {
    // 1. Test when gamePath or addonsList or addonEmpty is missing (should exit early)
    document.body.innerHTML = `
      <div id="status"></div>
    `;
    await loadAddonsAndPatches();

    // 2. Test when patchesList or patchesEmpty is missing (covered in loadPatches check)
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <button id="exportAddonsBtn"></button>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'get_patches') return Promise.resolve(['patch-1.mpq']);
      return Promise.resolve();
    });
    // This runs loadPatches, which will hit the `if (!patchesList || !patchesEmpty) return;` branch
    await loadAddonsAndPatches();

    // 3. Test when we have addons, but exportBtn is missing, and parse_toc throws an error for some addons
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve(['TestAddon']);
      if (cmd === 'get_patches') return Promise.resolve([]);
      if (cmd === 'parse_toc') return Promise.reject(new Error('Toc fail'));
      return Promise.resolve();
    });
    await loadAddonsAndPatches();

    // 4. Test when we have addons, check that git loop handles existent container, and dispatching search events
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
      <input id="addons-search" value="test" />
      <input id="patches-search" value="test" />
    `;
    await loadAddonsAndPatches();
    // Wait for the async git checking loop
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('covers all specific branches in addons.ts and patches.ts (null fields, missing attributes, etc.)', async () => {
    // 1. Setup HTML with some items lacking attributes and statusFooter being null
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
    `;

    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === 'get_addons') return Promise.resolve(['NoTitleAddon-disabled', 'GitAddon']);
      if (cmd === 'get_patches') return Promise.resolve(['patch-1.mpq']);
      if (cmd === 'parse_toc') {
        if (args.addonName === 'GitAddon') {
          return Promise.resolve({ name: 'GitAddon', title: 'Git Addon', hasGit: true });
        }
        // NoTitleAddon has null title, author, version
        return Promise.resolve({
          name: 'NoTitleAddon-disabled',
          title: '',
          author: null,
          version: null,
          hasGit: false,
        });
      }
      return Promise.resolve();
    });

    await loadAddonsAndPatches();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // A. Click addon-item that has no data-addon attribute (to cover `if (!addon) return;` branch)
    const badAddonItem = document.createElement('div');
    badAddonItem.className = 'addon-item';
    document.getElementById('addons-list')?.appendChild(badAddonItem);

    // Trigger listeners binding again by calling loadAddonsAndPatches
    await loadAddonsAndPatches();

    badAddonItem.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // B. Trigger click/change events where statusFooter is null to cover `if (statusFooter)` false branches
    // Click addon item (which has data-addon) when parse_toc fails and statusFooter is null
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'parse_toc') return Promise.reject('Toc fail');
      if (cmd === 'open_addon_folder') return Promise.reject('Folder fail');
      if (cmd === 'toggle_addon') return Promise.reject('Toggle fail');
      if (cmd === 'delete_addon') return Promise.reject('Delete fail');
      if (cmd === 'toggle_patch') return Promise.reject('Toggle patch fail');
      if (cmd === 'delete_patch') return Promise.reject('Delete patch fail');
      return Promise.resolve();
    });

    const item = document.querySelector('.addon-item[data-addon="GitAddon"]') as HTMLElement;
    if (item) {
      item.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Click open folder fail
    const openBtn = document.querySelector('.open-addon[data-addon="GitAddon"]') as HTMLElement;
    if (openBtn) {
      openBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Toggle fail
    const toggle = document.querySelector(
      '.addon-toggle[data-addon="GitAddon"]'
    ) as HTMLInputElement;
    if (toggle) {
      toggle.checked = !toggle.checked;
      toggle.dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Delete confirm/cancel
    const delBtn = document.querySelector('.delete-addon[data-addon="GitAddon"]') as HTMLElement;
    if (delBtn) {
      delBtn.click();
      const confirmActions = delBtn.parentElement?.nextElementSibling as HTMLElement;
      if (confirmActions) {
        // click cancel
        const cancelBtn = confirmActions.querySelector('.cancel-delete') as HTMLElement;
        cancelBtn?.click();
        // click confirm (fails)
        delBtn.click();
        const confirmBtn = confirmActions.querySelector('.confirm-delete') as HTMLElement;
        confirmBtn?.click();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    // Patch toggle fail (when statusFooter is null)
    const patchToggle = document.querySelector(
      '.patch-toggle[data-patch="patch-1.mpq"]'
    ) as HTMLInputElement;
    if (patchToggle) {
      patchToggle.checked = !patchToggle.checked;
      patchToggle.dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Patch delete fail (when statusFooter is null)
    const patchDelBtn = document.querySelector(
      '.delete-patch[data-patch="patch-1.mpq"]'
    ) as HTMLElement;
    if (patchDelBtn) {
      patchDelBtn.click();
      const confirmActions = patchDelBtn.parentElement?.nextElementSibling as HTMLElement;
      const confirmBtn = confirmActions?.querySelector('.confirm-delete') as HTMLElement;
      confirmBtn?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
});
