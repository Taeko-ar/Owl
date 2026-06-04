import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  loadAddonsAndPatches,
  setupAddonProfileEvents,
  resetProfilesInitializedForTesting,
} from '../tabs/addons';
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
    resetProfilesInitializedForTesting();
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

    // Patch toggle success (when statusFooter is null)
    (invoke as any).mockImplementation(() => Promise.resolve('Success'));
    if (patchToggle) {
      patchToggle.dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Patch delete success (when statusFooter is null)
    if (patchDelBtn) {
      patchDelBtn.click();
      const confirmActions = patchDelBtn.parentElement?.nextElementSibling as HTMLElement;
      const confirmBtn = confirmActions?.querySelector('.confirm-delete') as HTMLElement;
      confirmBtn?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Delete patch: parent is missing (btn parentElement is null)
    const loadPatchesModule = await import('../tabs/patches');
    await loadPatchesModule.loadPatches(['patch-1.mpq'], '/mock/wow', null);
    const deleteBtn = document.querySelector('.delete-patch') as HTMLElement;
    deleteBtn.remove();
    deleteBtn.click();

    // Delete patch: grandparent is missing (item is null)
    await loadPatchesModule.loadPatches(['patch-1.mpq'], '/mock/wow', null);
    const deleteBtn2 = document.querySelector('.delete-patch') as HTMLElement;
    const dummyParent1 = document.createElement('div');
    dummyParent1.appendChild(deleteBtn2);
    deleteBtn2.click();

    // Cancel delete: parent is missing (btn parentElement is null)
    await loadPatchesModule.loadPatches(['patch-1.mpq'], '/mock/wow', null);
    const cancelBtn = document.querySelector('.cancel-delete') as HTMLElement;
    cancelBtn.remove();
    cancelBtn.click();

    // Cancel delete: grandparent is missing (item is null)
    await loadPatchesModule.loadPatches(['patch-1.mpq'], '/mock/wow', null);
    const cancelBtn2 = document.querySelector('.cancel-delete') as HTMLElement;
    const dummyParent2 = document.createElement('div');
    dummyParent2.appendChild(cancelBtn2);
    cancelBtn2.click();

    // Cancel delete: normal case (truthy branch)
    await loadPatchesModule.loadPatches(['patch-1.mpq'], '/mock/wow', null);
    (document.querySelector('.cancel-delete') as HTMLElement)?.click();

    // Call loadPatches with empty array to cover 0-element list branches
    await loadPatchesModule.loadPatches([], '/mock/wow', null);
  });

  it('covers delete_patch early exit when data-patch is missing', async () => {
    // Setup simple patches HTML
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="patches-list">
        <div class="flex flex-col confirm-actions">
          <button class="confirm-delete">Yes</button>
        </div>
      </div>
      <div id="patches-empty"></div>
    `;
    const loadPatchesModule = await import('../tabs/patches');
    await loadPatchesModule.loadPatches(
      ['patch-enUS-W.mpq'],
      '/mock/wow',
      document.getElementById('status')
    );

    const confirmBtn = document.querySelector('.confirm-delete') as HTMLElement;
    confirmBtn.removeAttribute('data-patch'); // strip it
    confirmBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(invoke).not.toHaveBeenCalledWith('delete_patch', expect.any(Object));
  });

  it('covers profiles UI, dropdown interaction, rename, delete, and validation events', async () => {
    document.body.innerHTML = `
      <button id="profileSelectorBtn"></button>
      <div id="profileDropdown" class="hidden"></div>
      <div id="profileModal" class="hidden">
        <div id="profileModalTitle"></div>
        <input id="profileModalInput" />
        <div id="profileModalError" class="hidden"></div>
        <button id="cancelProfileModal"></button>
        <button id="confirmProfileModal"></button>
      </div>
      <div id="activeProfileHeaderName"></div>
      <div id="activeProfileHeaderContainer"></div>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
      <button id="exportAddonsBtn"></button>
    `;

    setupAddonProfileEvents();

    const selectorBtn = document.getElementById('profileSelectorBtn') as HTMLElement;
    const dropdown = document.getElementById('profileDropdown') as HTMLElement;
    const modal = document.getElementById('profileModal') as HTMLElement;

    // Toggle dropdown on click
    selectorBtn.click();
    expect(dropdown.classList.contains('hidden')).toBe(false);

    // Stop propagation inside dropdown click
    dropdown.click();
    expect(dropdown.classList.contains('hidden')).toBe(false);

    // Close on body click
    document.dispatchEvent(new Event('click'));
    expect(dropdown.classList.contains('hidden')).toBe(true);

    // Backdrop click on profileModal closes it
    modal.classList.remove('hidden');
    modal.click();
    expect(modal.classList.contains('hidden')).toBe(true);

    // Cancel button closes it
    modal.classList.remove('hidden');
    document.getElementById('cancelProfileModal')?.click();
    expect(modal.classList.contains('hidden')).toBe(true);

    // Trigger profile list rendering with an active profile and custom profiles
    const mockSettings = {
      activeProfile: 'My Profile',
      addonProfiles: [
        {
          name: 'My Profile',
          enabledAddons: ['MyAddon'],
          tweakConfigs: { option1: 'val1' },
          enabledPatches: ['patch-enUS-W.mpq'],
        },
      ],
    };

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon']);
      if (cmd === 'get_patches') return Promise.resolve(['patch-enUS-W.mpq']);
      if (cmd === 'load_settings') return Promise.resolve(mockSettings);
      if (cmd === 'parse_toc') return Promise.resolve({ name: 'MyAddon', title: 'My Addon Title' });
      if (cmd === 'read_config') return Promise.resolve('option1=val1');
      return Promise.resolve();
    });

    await loadAddonsAndPatches();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Save Profile Modal validation flows
    const saveBtn = document.getElementById('saveProfileBtn') as HTMLElement;
    saveBtn.click();
    expect(modal.classList.contains('hidden')).toBe(false);

    const input = document.getElementById('profileModalInput') as HTMLInputElement;
    const confirmBtn = document.getElementById('confirmProfileModal') as HTMLElement;
    const errorMsg = document.getElementById('profileModalError') as HTMLElement;

    // Empty validation
    input.value = '';
    confirmBtn.click();
    expect(errorMsg.classList.contains('hidden')).toBe(false);
    expect(errorMsg.textContent).not.toBe('');

    // Long validation
    input.value = 'a'.repeat(33);
    confirmBtn.click();
    expect(errorMsg.classList.contains('hidden')).toBe(false);

    // Duplicate name validation
    input.value = 'My Profile';
    confirmBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(errorMsg.classList.contains('hidden')).toBe(false);

    // Success save path
    input.value = 'New Profile';
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon']);
      if (cmd === 'get_patches') return Promise.resolve(['patch-enUS-W.mpq']);
      if (cmd === 'load_settings') return Promise.resolve(mockSettings);
      if (cmd === 'parse_toc') return Promise.resolve({ name: 'MyAddon', title: 'My Addon Title' });
      if (cmd === 'save_addon_profile') return Promise.resolve();
      return Promise.resolve();
    });
    confirmBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(modal.classList.contains('hidden')).toBe(true);

    // Save Profile Input keydown Enter key triggers confirm
    saveBtn.click();
    input.value = 'Another New Profile';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(modal.classList.contains('hidden')).toBe(true);

    // Update profile list DOM elements and trigger actions (Apply, Rename, Delete)
    await loadAddonsAndPatches();

    const row = document.querySelector(
      '.profile-item-row[data-profile="My Profile"]'
    ) as HTMLElement;
    expect(row).not.toBeNull();

    // Click profile name to Apply
    const applyLabel = row.querySelector('.profile-option-name') as HTMLElement;
    (invoke as any).mockResolvedValueOnce(null); // apply_addon_profile
    applyLabel.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(invoke).toHaveBeenCalledWith('apply_addon_profile', {
      basePath: '/mock/wow',
      name: 'My Profile',
    });

    // Click rename button to show edit view
    const renameBtn = row.querySelector('.rename-profile-btn') as HTMLElement;
    renameBtn.click();
    const editView = row.querySelector('.profile-edit-view') as HTMLElement;
    expect(editView.classList.contains('hidden')).toBe(false);

    // Cancel rename
    const cancelRename = row.querySelector('.cancel-rename-btn') as HTMLElement;
    cancelRename.click();
    expect(editView.classList.contains('hidden')).toBe(true);

    // Confirm rename empty validation
    renameBtn.click();
    const editInput = row.querySelector('.profile-edit-input') as HTMLInputElement;
    editInput.value = '';
    const confirmRename = row.querySelector('.confirm-rename-btn') as HTMLElement;
    confirmRename.click();

    // Confirm rename too long validation
    editInput.value = 'a'.repeat(33);
    confirmRename.click();

    // Confirm rename duplicate validation
    editInput.value = 'My Profile'; // duplicate of self is ok, but let's test duplicate of another
    const mockSettingsWithTwo = {
      activeProfile: 'My Profile',
      addonProfiles: [
        { name: 'My Profile', enabledAddons: [] },
        { name: 'Other Profile', enabledAddons: [] },
      ],
    };
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'load_settings') return Promise.resolve(mockSettingsWithTwo);
      return Promise.resolve();
    });
    editInput.value = 'Other Profile';
    confirmRename.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Confirm rename success
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'load_settings') return Promise.resolve(mockSettings);
      if (cmd === 'rename_addon_profile') return Promise.resolve();
      return Promise.resolve();
    });
    editInput.value = 'Renamed Profile';
    confirmRename.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Confirm rename keydown events (Enter, Escape, click)
    renameBtn.click();
    editInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); // cancels
    expect(editView.classList.contains('hidden')).toBe(true);

    renameBtn.click();
    editInput.click(); // stop propagation check
    editInput.value = 'Keydown Renamed';
    editInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); // confirms
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Delete profile interactions (Cancel, Confirm)
    const deleteBtn = row.querySelector('.delete-profile-btn') as HTMLElement;
    deleteBtn.click();
    const deleteView = row.querySelector('.profile-delete-view') as HTMLElement;
    expect(deleteView.classList.contains('hidden')).toBe(false);

    // Cancel delete
    const cancelDelete = row.querySelector('.cancel-delete-btn') as HTMLElement;
    cancelDelete.click();
    expect(deleteView.classList.contains('hidden')).toBe(true);

    // Confirm delete
    deleteBtn.click();
    const confirmDelete = row.querySelector('.confirm-delete-btn') as HTMLElement;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'delete_addon_profile') return Promise.resolve();
      if (cmd === 'load_settings') return Promise.resolve({ addonProfiles: [] });
      return Promise.resolve();
    });
    confirmDelete.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Update active profile button
    const modifiedSettings = {
      activeProfile: 'My Profile',
      addonProfiles: [
        {
          name: 'My Profile',
          enabledAddons: ['DifferentAddon'], // mismatch to trigger modified
        },
      ],
    };
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon']);
      if (cmd === 'get_patches') return Promise.resolve([]);
      if (cmd === 'load_settings') return Promise.resolve(modifiedSettings);
      if (cmd === 'parse_toc') return Promise.resolve({ name: 'MyAddon', title: 'My Addon Title' });
      return Promise.resolve();
    });
    await loadAddonsAndPatches();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updateProfileBtn = document.getElementById('updateProfileBtn') as HTMLElement;
    expect(updateProfileBtn.classList.contains('hidden')).toBe(false);
    updateProfileBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('covers setupAddonProfileEvents early exit when elements are missing', async () => {
    document.body.innerHTML = '';
    setupAddonProfileEvents();
  });

  it('covers mods tab activeTab state, profile setup error catch paths, empty profiles mapping, and comparison modifications', async () => {
    // 1. activeTab === 'mods'
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
      <div class="nav-tab active" data-tab="mods"></div>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_patches') return Promise.resolve(['patch-enUS-W.mpq']);
      return Promise.resolve();
    });
    await loadAddonsAndPatches();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 3. profiles list empty flow, click save profile button
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
      <button id="profileSelectorBtn"></button>
      <div id="profileDropdown" class="hidden"></div>
      <div id="profileModal" class="hidden">
        <div id="profileModalTitle"></div>
        <input id="profileModalInput" />
        <div id="profileModalError" class="hidden"></div>
        <button id="cancelProfileModal"></button>
        <button id="confirmProfileModal"></button>
      </div>
      <button id="exportAddonsBtn"></button>
    `;
    // setup events
    setupAddonProfileEvents();
    // Render list (which calls updateProfileDropdown inside loadAddonsAndPatches)
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'get_patches') return Promise.resolve([]);
      if (cmd === 'load_settings') return Promise.resolve({ addonProfiles: [] });
      return Promise.resolve();
    });
    await loadAddonsAndPatches();
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Click saveProfileBtn
    document.getElementById('saveProfileBtn')?.click();
    expect(document.getElementById('profileModal')?.classList.contains('hidden')).toBe(false);

    // Set input value to bypass empty check
    const profileModalInput = document.getElementById('profileModalInput') as HTMLInputElement;
    if (profileModalInput) profileModalInput.value = 'NewProfile';

    // 4. save_addon_profile catches error
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'load_settings') return Promise.resolve({ addonProfiles: [] });
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'save_addon_profile') return Promise.reject('Save profile fail');
      return Promise.resolve();
    });
    document.getElementById('confirmProfileModal')?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.getElementById('profileModalError')?.textContent).toBe('Save profile fail');

    // 5. updateProfileBtn catches error & rename/delete profile catches error
    const mockSettings = {
      activeProfile: 'My Profile',
      addonProfiles: [
        {
          name: 'My Profile',
          enabledAddons: ['MyAddon'],
          tweakConfigs: { opt: 'val' },
          enabledPatches: ['patch-enUS-W.mpq'],
        },
      ],
    };
    document.body.innerHTML = `
      <button id="profileSelectorBtn"></button>
      <div id="profileDropdown" class="hidden">
        <div id="profileList"></div>
      </div>
      <div id="profileModal" class="hidden">
        <div id="profileModalTitle"></div>
        <input id="profileModalInput" />
        <div id="profileModalError" class="hidden"></div>
        <button id="confirmProfileModal"></button>
      </div>
      <button id="updateProfileBtn" class="hidden"></button>
      <div id="activeProfileHeaderName"></div>
      <div id="activeProfileHeaderContainer"></div>
      <div id="activeProfileHeaderNameMods"></div>
      <div id="activeProfileHeaderContainerMods"></div>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
    `;
    setupAddonProfileEvents();

    // Tweaks comparison mismatch to cover tweak mismatch (line 440)
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon']);
      if (cmd === 'get_patches') return Promise.resolve(['patch-enUS-W.mpq']);
      if (cmd === 'load_settings') return Promise.resolve(mockSettings);
      if (cmd === 'parse_toc') return Promise.resolve({ name: 'MyAddon', title: 'My Addon Title' });
      if (cmd === 'read_config') return Promise.resolve('opt=val2');
      return Promise.resolve();
    });
    await loadAddonsAndPatches();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // trigger updateProfileBtn click failure
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'load_settings') return Promise.resolve(mockSettings);
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'save_addon_profile') return Promise.reject('Update profile error');
      return Promise.resolve();
    });
    document.getElementById('updateProfileBtn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Remove statusFooter and click updateProfileBtn again to cover falsy branch of line 647
    const statusFooter = document.getElementById('status');
    if (statusFooter) statusFooter.remove();
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'load_settings') return Promise.resolve(mockSettings);
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'save_addon_profile') return Promise.reject('Update profile error');
      return Promise.resolve();
    });
    document.getElementById('updateProfileBtn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Recreate status footer for other tests
    const status = document.createElement('div');
    status.id = 'status';
    document.body.appendChild(status);

    // Patches comparison mismatch to cover patch mismatch (line 466)
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon']);
      if (cmd === 'get_patches') return Promise.resolve(['patch-enUS-W.mpq', 'patch-enUS-Y.mpq']);
      if (cmd === 'load_settings') return Promise.resolve(mockSettings);
      if (cmd === 'parse_toc') return Promise.resolve({ name: 'MyAddon', title: 'My Addon Title' });
      if (cmd === 'read_config') return Promise.resolve('opt=val');
      return Promise.resolve();
    });
    await loadAddonsAndPatches();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // click profile list name item to apply profile (fails)
    (invoke as any).mockRejectedValueOnce('Apply profile error');
    const profileItemName = document.querySelector('.profile-option-name') as HTMLElement;
    profileItemName?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // click rename button and confirm rename (fails)
    const renameBtn = document.querySelector('.rename-profile-btn') as HTMLElement;
    const confirmRenameBtn = document.querySelector('.confirm-rename-btn') as HTMLElement;
    const editInput = document.querySelector('.profile-edit-input') as HTMLInputElement;
    renameBtn?.click();
    if (editInput) editInput.value = 'Different Name';
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'load_settings') return Promise.resolve(mockSettings);
      if (cmd === 'rename_addon_profile') return Promise.reject('Rename profile error');
      return Promise.resolve();
    });
    confirmRenameBtn?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // click delete button and confirm delete (fails)
    const deleteBtn = document.querySelector('.delete-profile-btn') as HTMLElement;
    const confirmDeleteBtn = document.querySelector('.confirm-delete-btn') as HTMLElement;
    deleteBtn?.click();
    (invoke as any).mockRejectedValueOnce('Delete profile error');
    confirmDeleteBtn?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('covers patches.ts statusFooter null branches', async () => {
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
    `;

    const loadPatchesModule = await import('../tabs/patches');
    await loadPatchesModule.loadPatches(['patch-1.mpq'], '/mock/wow', null);

    const toggle = document.querySelector('.patch-toggle') as HTMLInputElement;
    const deleteBtn = document.querySelector('.delete-patch') as HTMLElement;
    const confirmActions = deleteBtn.parentElement?.nextElementSibling as HTMLElement;
    const confirmBtn = confirmActions.querySelector('.confirm-delete') as HTMLElement;

    // 1. Toggle patch success
    (invoke as any).mockResolvedValueOnce('Success');
    toggle.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 2. Toggle patch fail
    (invoke as any).mockRejectedValueOnce('Error');
    toggle.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 3. Delete patch success
    (invoke as any).mockResolvedValueOnce(null);
    deleteBtn.click();
    confirmBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 4. Delete patch fail
    await loadPatchesModule.loadPatches(['patch-1.mpq'], '/mock/wow', null);
    const deleteBtn2 = document.querySelector('.delete-patch') as HTMLElement;
    const confirmActions2 = deleteBtn2.parentElement?.nextElementSibling as HTMLElement;
    const confirmBtn2 = confirmActions2.querySelector('.confirm-delete') as HTMLElement;
    (invoke as any).mockRejectedValueOnce('Error');
    deleteBtn2.click();
    confirmBtn2.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('covers remaining addons.ts and patches.ts edge branches', async () => {
    // 1. toggle, open, delete buttons with missing data-addon attribute
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list">
        <button class="open-addon" title="Open Folder">Open</button>
        <input type="checkbox" class="addon-toggle" />
        <button class="delete-addon" title="Delete Addon">Delete</button>
      </div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon']);
      if (cmd === 'get_patches') return Promise.resolve([]);
      if (cmd === 'parse_toc') return Promise.resolve({ name: 'MyAddon', title: 'My Addon Title' });
      return Promise.resolve();
    });
    await loadAddonsAndPatches();

    const openBtn = document.querySelector('.open-addon') as HTMLElement;
    openBtn.click(); // no data-addon

    const toggleInput = document.querySelector('.addon-toggle') as HTMLInputElement;
    toggleInput.dispatchEvent(new Event('change')); // no data-addon

    const deleteBtn = document.querySelector('.delete-addon') as HTMLElement;
    deleteBtn.click(); // no data-addon

    // 2. keydown event on profile modal input with key other than Enter
    document.body.innerHTML = `
      <button id="profileSelectorBtn"></button>
      <div id="profileDropdown" class="hidden"></div>
      <div id="profileModal" class="hidden">
        <div id="profileModalTitle"></div>
        <input id="profileModalInput" />
        <div id="profileModalError" class="hidden"></div>
        <button id="cancelProfileModal"></button>
        <button id="confirmProfileModal"></button>
      </div>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
    `;
    setupAddonProfileEvents();
    const inputEl = document.getElementById('profileModalInput') as HTMLInputElement;
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    // 3. confirmProfileModal when settings addonProfiles is undefined
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'load_settings') return Promise.resolve({}); // addonProfiles is undefined
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'save_addon_profile') return Promise.resolve();
      return Promise.resolve();
    });
    inputEl.value = 'NewProfile';
    const confirmBtn = document.getElementById('confirmProfileModal') as HTMLElement;
    confirmBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 4. activeProfile not found in profiles, activeProfile is null for header mods check
    document.body.innerHTML = `
      <button id="profileSelectorBtn"></button>
      <div id="profileDropdown" class="hidden"></div>
      <div id="activeProfileHeaderName"></div>
      <div id="activeProfileHeaderContainer"></div>
      <div id="activeProfileHeaderNameMods"></div>
      <div id="activeProfileHeaderContainerMods"></div>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
      <button id="exportAddonsBtn"></button>
    `;
    // Case 4a: activeProfile not found in profiles
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'get_patches') return Promise.resolve([]);
      if (cmd === 'load_settings')
        return Promise.resolve({ activeProfile: 'NonExistent', addonProfiles: [] });
      return Promise.resolve();
    });
    await loadAddonsAndPatches();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Case 4b: activeProfile is null/falsy
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'get_patches') return Promise.resolve([]);
      if (cmd === 'load_settings')
        return Promise.resolve({ activeProfile: null, addonProfiles: [] });
      return Promise.resolve();
    });
    await loadAddonsAndPatches();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 5. saveProfileBtn click when profileModal is missing
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
      <button id="profileSelectorBtn"></button>
      <div id="profileDropdown" class="hidden"></div>
      <button id="exportAddonsBtn"></button>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'get_patches') return Promise.resolve([]);
      if (cmd === 'load_settings') return Promise.resolve({ addonProfiles: [] });
      return Promise.resolve();
    });
    await loadAddonsAndPatches();
    document.getElementById('saveProfileBtn')?.click();

    // 6. updateProfileBtn click settings activeProfile is null
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
      <button id="profileSelectorBtn"></button>
      <div id="profileDropdown" class="hidden"></div>
      <button id="exportAddonsBtn"></button>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon']);
      if (cmd === 'get_patches') return Promise.resolve([]);
      if (cmd === 'load_settings')
        return Promise.resolve({
          activeProfile: 'My Profile',
          addonProfiles: [{ name: 'My Profile', enabledAddons: ['Different'] }],
        });
      if (cmd === 'parse_toc') return Promise.resolve({ name: 'MyAddon', title: 'My Addon Title' });
      return Promise.resolve();
    });
    await loadAddonsAndPatches();
    // mock settings again to return null activeProfile on click
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'load_settings') return Promise.resolve({ activeProfile: null });
      return Promise.resolve();
    });
    document.getElementById('updateProfileBtn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 7. updateProfileDropdown when #profileList is missing from DOM
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
      <button id="profileSelectorBtn"></button>
      <div id="profileDropdown" class="hidden"></div>
      <button id="exportAddonsBtn"></button>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'get_patches') return Promise.resolve([]);
      if (cmd === 'load_settings')
        return Promise.resolve({ addonProfiles: [{ name: 'Profile1', enabledAddons: [] }] });
      return Promise.resolve();
    });
    await loadAddonsAndPatches();
    // remove profileList
    document.getElementById('profileList')?.remove();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 8. performRename when load_settings returns null
    document.body.innerHTML = `
      <button id="profileSelectorBtn"></button>
      <div id="profileDropdown" class="hidden">
        <div id="profileList"></div>
      </div>
      <div id="activeProfileHeaderName"></div>
      <div id="activeProfileHeaderContainer"></div>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon']);
      if (cmd === 'get_patches') return Promise.resolve([]);
      if (cmd === 'load_settings')
        return Promise.resolve({
          activeProfile: 'My Profile',
          addonProfiles: [{ name: 'My Profile', enabledAddons: [] }],
        });
      if (cmd === 'parse_toc') return Promise.resolve({ name: 'MyAddon', title: 'My Addon Title' });
      return Promise.resolve();
    });
    await loadAddonsAndPatches();
    const renameBtn = document.querySelector('.rename-profile-btn') as HTMLElement;
    renameBtn?.click();
    const editInput = document.querySelector('.profile-edit-input') as HTMLInputElement;
    if (editInput) editInput.value = 'New Name';
    // mock load_settings to return null on rename click
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'load_settings') return Promise.reject('Error');
      return Promise.resolve();
    });
    const confirmRename = document.querySelector('.confirm-rename-btn') as HTMLElement;
    confirmRename?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 9. editInput keydown key other than Enter or Escape
    renameBtn?.click();
    editInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    // 10. patches.ts logical branch when patchesList is missing but patchesEmpty is present
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-empty"></div>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'get_patches') return Promise.resolve(['patch-1.mpq']);
      return Promise.resolve();
    });
    await loadAddonsAndPatches();
  });

  it('covers missing profile inputs, missing data-addon attributes, and parent element edge cases in addons.ts', async () => {
    // 1. profileModalTitle and profileModalInput are missing
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
      <button id="saveProfileBtn"></button>
      <div id="profileModal"></div>
      <div id="profileDropdown" class="hidden"></div>
      <button id="exportAddonsBtn"></button>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon']);
      if (cmd === 'get_patches') return Promise.resolve([]);
      if (cmd === 'load_settings')
        return Promise.resolve({ activeProfile: null, addonProfiles: [] });
      if (cmd === 'parse_toc') return Promise.resolve({ name: 'MyAddon', title: 'My Addon' });
      return Promise.resolve();
    });
    setupAddonProfileEvents();
    await loadAddonsAndPatches();

    document.getElementById('saveProfileBtn')?.click();

    // 2. data-addon missing on open-addon, addon-toggle, delete-addon elements
    const openBtn = document.createElement('button');
    openBtn.className = 'open-addon';
    document.body.appendChild(openBtn);
    openBtn.click();

    const toggleChk = document.createElement('input');
    toggleChk.type = 'checkbox';
    toggleChk.className = 'addon-toggle';
    document.body.appendChild(toggleChk);
    toggleChk.dispatchEvent(new Event('change'));

    // 3. delete-addon where parent element is missing
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-addon';
    deleteBtn.click();

    // 4. profile-item-row with missing data-profile
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
      <div id="profileList">
        <div class="profile-item-row"></div>
      </div>
      <button id="exportAddonsBtn"></button>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.resolve(['MyAddon']);
      if (cmd === 'get_patches') return Promise.resolve([]);
      if (cmd === 'load_settings')
        return Promise.resolve({
          activeProfile: null,
          addonProfiles: [{ name: '', enabledAddons: [] }],
        });
      if (cmd === 'parse_toc') return Promise.resolve({ name: 'MyAddon', title: 'My Addon' });
      return Promise.resolve();
    });
    await loadAddonsAndPatches();

    // 5. updateProfileBtn error path when load_settings succeeds but get_addons throws error
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
      <div id="addons-list"></div>
      <div id="addons-empty"></div>
      <div id="patches-list"></div>
      <div id="patches-empty"></div>
      <button id="updateProfileBtn"></button>
      <div id="profileDropdown"></div>
      <button id="exportAddonsBtn"></button>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_addons') return Promise.reject('Get addons failed');
      if (cmd === 'get_patches') return Promise.resolve([]);
      if (cmd === 'load_settings')
        return Promise.resolve({
          activeProfile: 'ActiveProfile',
          addonProfiles: [{ name: 'ActiveProfile', enabledAddons: [] }],
        });
      return Promise.resolve();
    });
    await loadAddonsAndPatches();
    document.getElementById('updateProfileBtn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
