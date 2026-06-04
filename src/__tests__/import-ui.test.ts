import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  setupImportModalEvents,
  parseAndTranslateImportError,
  showBundledWarningModal,
  showDependencyModal,
  handlePostInstallDependencyCheck,
  showReplaceWarningModal,
} from '../ui/import';
import { invoke } from '@tauri-apps/api/core';
import { showTextInputModal, showToast } from '../utils';
import { getCurrentActiveSite } from '../state';
import { getTranslation } from '../i18n/index';
import { handleImportString } from '../ui/import-export';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../utils', () => ({
  showToast: vi.fn(),
  showTextInputModal: vi.fn(),
}));

vi.mock('../ui/import-export', () => ({
  handleImportString: vi.fn().mockImplementation(() => Promise.resolve()),
}));

vi.mock('../tabs/addons', () => ({
  loadAddonsAndPatches: vi.fn().mockImplementation(() => Promise.resolve()),
}));

vi.mock('../state', () => ({
  getCurrentActiveSite: vi.fn().mockReturnValue('mock'),
}));

describe('Import UI Modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('handles the import main modal and option clicks', async () => {
    document.body.innerHTML = `
      <button id="importAddonBtn">Import</button>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
    `;

    setupImportModalEvents();

    const mainImportBtn = document.getElementById('importAddonBtn') as HTMLElement;
    mainImportBtn.click();
    mainImportBtn.click(); // Click again to verify early exit when overlay already exists (covers line 14)
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify modal overlay created
    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    expect(overlay).not.toBeNull();
    // Click Cancel Button to close overlay
    const cancelBtn = overlay.querySelector('#importCancelBtn') as HTMLElement;
    cancelBtn.click();
    expect(document.querySelector('.fixed.inset-0')).toBeNull(); // Modal closed

    // Reopen modal for Option 1
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlayAfterCancel = document.querySelector('.fixed.inset-0') as HTMLElement;

    // Option 1: Get Addons option
    let storeOpened = false;
    window.addEventListener(
      'open-store',
      () => {
        storeOpened = true;
      },
      { once: true }
    );

    const getAddonsBtn = overlayAfterCancel.querySelector('#importGetAddonsBtn') as HTMLElement;
    getAddonsBtn.click();
    expect(document.querySelector('.fixed.inset-0')).toBeNull(); // Modal closed
    expect(storeOpened).toBe(true);

    // Reopen modal
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay2 = document.querySelector('.fixed.inset-0') as HTMLElement;

    // Option 2: Github import (cancel path)
    const githubBtn = overlay2.querySelector('#importGithubBtn') as HTMLElement;
    (showTextInputModal as any).mockImplementationOnce(() => Promise.resolve(null));
    githubBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invoke).not.toHaveBeenCalled();

    // Reopen modal
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay3 = document.querySelector('.fixed.inset-0') as HTMLElement;

    // Option 3: Github import (success path)
    const githubBtnSuccess = overlay3.querySelector('#importGithubBtn') as HTMLElement;
    (showTextInputModal as any).mockImplementationOnce(() =>
      Promise.resolve('https://github.com/wow/addon')
    );
    (invoke as any).mockImplementationOnce(() => Promise.resolve());
    githubBtnSuccess.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(invoke).toHaveBeenCalledWith('import_addon', {
      basePath: '/mock/wow',
      repoUrl: 'https://github.com/wow/addon',
    });

    // Option 3b: Github import (failure path)
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const overlay3b = document.querySelector('.fixed.inset-0') as HTMLElement;
    const githubBtnFailure = overlay3b.querySelector('#importGithubBtn') as HTMLElement;
    (showTextInputModal as any).mockImplementationOnce(() =>
      Promise.resolve('https://github.com/wow/addon-fail')
    );
    (invoke as any).mockImplementationOnce(() => Promise.reject('Import failed'));
    githubBtnFailure.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.getElementById('status')?.textContent).toBe('Error: Import failed');

    // Reopen modal
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const overlay4 = document.querySelector('.fixed.inset-0') as HTMLElement;

    // Option 4: File import (success path)
    const fileBtn = overlay4.querySelector('#importFileBtn') as HTMLElement;
    (invoke as any).mockImplementationOnce((cmd: string) => {
      if (cmd === 'pick_files') return Promise.resolve(['/downloads/addon.zip']);
      return Promise.resolve();
    });
    fileBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(invoke).toHaveBeenCalledWith('import_addon_files', {
      basePath: '/mock/wow',
      filePaths: ['/downloads/addon.zip'],
    });

    // Option 4b: File import (failure path)
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const overlay4b = document.querySelector('.fixed.inset-0') as HTMLElement;
    const fileBtnFailure = overlay4b.querySelector('#importFileBtn') as HTMLElement;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'pick_files') return Promise.resolve(['/downloads/addon-fail.zip']);
      if (cmd === 'import_addon_files') return Promise.reject('File import failed');
      return Promise.resolve();
    });
    fileBtnFailure.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.getElementById('status')?.textContent).toBe('Error: File import failed');

    // Clean up invoke mock implementation
    (invoke as any).mockReset();

    // Reopen modal
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay5 = document.querySelector('.fixed.inset-0') as HTMLElement;

    // Option 5: String import
    const stringBtn = overlay5.querySelector('#importStringBtn') as HTMLElement;
    stringBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handleImportString).toHaveBeenCalled();
  });

  it('covers missing branches in import.ts when elements are missing or files array is empty', async () => {
    // Setup DOM with missing status element (but gamePath present)
    document.body.innerHTML = `
      <button id="importAddonBtn">Import</button>
      <input id="gamePath" value="/mock/wow" />
    `;

    setupImportModalEvents();

    const mainImportBtn = document.getElementById('importAddonBtn') as HTMLElement;
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    const githubBtn = overlay.querySelector('#importGithubBtn') as HTMLElement;

    // 1. Test Github Import click when statusFooter is missing (success)
    (showTextInputModal as any).mockImplementationOnce(() =>
      Promise.resolve('https://github.com/wow/addon')
    );
    (invoke as any).mockImplementationOnce(() => Promise.resolve());
    githubBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(invoke).toHaveBeenCalledWith('import_addon', {
      basePath: '/mock/wow',
      repoUrl: 'https://github.com/wow/addon',
    });

    // Reopen modal
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlayAfterGithubSuccess = document.querySelector('.fixed.inset-0') as HTMLElement;
    const githubBtnFailure = overlayAfterGithubSuccess.querySelector(
      '#importGithubBtn'
    ) as HTMLElement;

    // 2. Test Github Import click when statusFooter is missing (failure)
    (showTextInputModal as any).mockImplementationOnce(() =>
      Promise.resolve('https://github.com/wow/addon-fail')
    );
    (invoke as any).mockImplementationOnce(() => Promise.reject('Fail git'));
    githubBtnFailure.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Reopen modal
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlayFile = document.querySelector('.fixed.inset-0') as HTMLElement;
    const fileBtnSuccess = overlayFile.querySelector('#importFileBtn') as HTMLElement;

    // 3. Test File Import click when statusFooter is missing (success)
    (invoke as any).mockImplementationOnce((cmd: string) => {
      if (cmd === 'pick_files') return Promise.resolve(['/downloads/addon.zip']);
      return Promise.resolve();
    });
    fileBtnSuccess.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Reopen modal
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlayFileFail = document.querySelector('.fixed.inset-0') as HTMLElement;
    const fileBtnFailure = overlayFileFail.querySelector('#importFileBtn') as HTMLElement;

    // 4. Test File Import click when statusFooter is missing (failure)
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'pick_files') return Promise.resolve(['/downloads/addon-fail.zip']);
      if (cmd === 'import_addon_files') return Promise.reject('Fail file');
      return Promise.resolve();
    });
    fileBtnFailure.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Reopen modal and test pick_files returns empty list
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlayFileEmpty = document.querySelector('.fixed.inset-0') as HTMLElement;
    const fileBtnEmpty = overlayFileEmpty.querySelector('#importFileBtn') as HTMLElement;
    (invoke as any).mockResolvedValueOnce([]); // empty
    fileBtnEmpty.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 5. Test when gamePath is missing completely from the DOM
    document.body.innerHTML = `
      <button id="importAddonBtn">Import</button>
    `;
    setupImportModalEvents();
    const mainImportBtn2 = document.getElementById('importAddonBtn') as HTMLElement;
    mainImportBtn2.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlayNoPath = document.querySelector('.fixed.inset-0') as HTMLElement;

    const githubBtnNoPath = overlayNoPath.querySelector('#importGithubBtn') as HTMLElement;
    (showTextInputModal as any).mockImplementationOnce(() =>
      Promise.resolve('https://github.com/wow/addon')
    );
    githubBtnNoPath.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    mainImportBtn2.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlayNoPath2 = document.querySelector('.fixed.inset-0') as HTMLElement;
    const fileBtnNoPath = overlayNoPath2.querySelector('#importFileBtn') as HTMLElement;
    (invoke as any).mockImplementationOnce((cmd: string) => {
      if (cmd === 'pick_files') return Promise.resolve(['/downloads/addon.zip']);
      return Promise.resolve();
    });
    fileBtnNoPath.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('covers the BUNDLED error flow in file import option', async () => {
    document.body.innerHTML = `
      <button id="importAddonBtn">Import</button>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="bundledAddonModal" class="hidden">
        <div id="bundledAddonList"></div>
        <button id="confirmBundledInstallBtn"></button>
        <button id="confirmBundledCancelBtn"></button>
      </div>
    `;

    setupImportModalEvents();
    const mainImportBtn = document.getElementById('importAddonBtn') as HTMLElement;
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    const fileBtn = overlay.querySelector('#importFileBtn') as HTMLElement;

    // Mock BUNDLED: error
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'pick_files') return Promise.resolve(['/downloads/addon.zip']);
      if (cmd === 'import_addon_files') return Promise.reject('BUNDLED:temp_path|addon1,addon2');
      return Promise.resolve();
    });

    fileBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.getElementById('status')?.textContent).toBe(getTranslation('import.status.bundledAddon'));

    // Click confirm to trigger onComplete callback (covers line 119)
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'confirm_install_bundled') return Promise.resolve('Success');
      return Promise.resolve();
    });
    const confirmBtn = document.getElementById('confirmBundledInstallBtn') as HTMLElement;
    confirmBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Cover missing gamePath during BUNDLED error flow
    document.body.innerHTML = `
      <button id="importAddonBtn">Import</button>
      <div id="status"></div>
      <div id="bundledAddonModal" class="hidden">
        <div id="bundledAddonList"></div>
        <button id="confirmBundledInstallBtn"></button>
        <button id="confirmBundledCancelBtn"></button>
      </div>
    `;
    setupImportModalEvents();
    (document.getElementById('importAddonBtn') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'pick_files') return Promise.resolve(['/downloads/addon.zip']);
      if (cmd === 'import_addon_files') return Promise.reject('BUNDLED:temp_path|addon1,addon2');
      return Promise.resolve();
    });
    (document.querySelector('#importFileBtn') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Cover missing status during BUNDLED error flow
    document.body.innerHTML = `
      <button id="importAddonBtn">Import</button>
      <input id="gamePath" value="/mock/wow" />
      <div id="bundledAddonModal" class="hidden">
        <div id="bundledAddonList"></div>
        <button id="confirmBundledInstallBtn"></button>
        <button id="confirmBundledCancelBtn"></button>
      </div>
    `;
    setupImportModalEvents();
    (document.getElementById('importAddonBtn') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'pick_files') return Promise.resolve(['/downloads/addon.zip']);
      if (cmd === 'import_addon_files') return Promise.reject('BUNDLED:temp_path|addon1,addon2');
      return Promise.resolve();
    });
    (document.querySelector('#importFileBtn') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('covers parseAndTranslateImportError helper function', () => {
    expect(parseAndTranslateImportError('LOOSE_FILES:details')).toBe(getTranslation('import.error.looseFiles'));
    expect(parseAndTranslateImportError('NO_TOC:details')).toBe(getTranslation('import.error.noToc'));
    expect(parseAndTranslateImportError('CORRUPTED:details')).toBe(getTranslation('import.error.corrupted'));
    expect(parseAndTranslateImportError('SOME_OTHER_ERROR')).toBe('SOME_OTHER_ERROR');
  });

  it('covers showBundledWarningModal completely', async () => {
    document.body.innerHTML = `
      <div id="status"></div>
      <div id="bundledAddonModal" class="hidden">
        <div id="bundledAddonList"></div>
        <button id="confirmBundledInstallBtn"></button>
        <button id="confirmBundledCancelBtn"></button>
      </div>
    `;

    const onComplete = vi.fn().mockImplementation(() => Promise.resolve());

    // 1. Confirm button path (success)
    const p1 = showBundledWarningModal('/base/path', '/temp/path', ['A1', 'A2'], onComplete);
    
    // Check elements loaded
    const modal = document.getElementById('bundledAddonModal') as HTMLElement;
    expect(modal.classList.contains('hidden')).toBe(false);

    // Uncheck and check checkboxes to test updateConfirmBtn
    const checkboxes = document.querySelectorAll('.bundled-addon-checkbox') as NodeListOf<HTMLInputElement>;
    expect(checkboxes.length).toBe(2);
    const confirmBtn = document.getElementById('confirmBundledInstallBtn') as HTMLButtonElement;

    checkboxes[0].checked = false;
    checkboxes[0].dispatchEvent(new Event('change'));
    expect(confirmBtn.disabled).toBe(false);

    checkboxes[1].checked = false;
    checkboxes[1].dispatchEvent(new Event('change'));
    expect(confirmBtn.disabled).toBe(true);

    checkboxes[0].checked = true;
    checkboxes[0].dispatchEvent(new Event('change'));
    expect(confirmBtn.disabled).toBe(false);

    // Mock confirm invoke success
    (invoke as any).mockResolvedValueOnce('Success install');
    // Remove data-name from checkboxes[0] to cover falsy branch
    checkboxes[0].removeAttribute('data-name');
    confirmBtn.click();
    
    const res1 = await p1;
    expect(res1).toBe('Success install');
    expect(onComplete).toHaveBeenCalled();
    expect(modal.classList.contains('hidden')).toBe(true);

    // 2. Confirm button path (failure with missing status element)
    const p2 = showBundledWarningModal('/base/path', '/temp/path', ['A1'], onComplete);
    document.getElementById('status')?.remove();
    (invoke as any).mockRejectedValueOnce('Error installing bundled');
    const newConfirmBtn = document.getElementById('confirmBundledInstallBtn') as HTMLButtonElement;
    newConfirmBtn.click();
    const res2 = await p2;
    expect(res2).toBeNull();

    // 3. Cancel path (with missing status element)
    const p3 = showBundledWarningModal('/base/path', '/temp/path', ['A1'], onComplete);
    (invoke as any).mockResolvedValueOnce('Cleanup complete');
    const cancelBtn = document.getElementById('confirmBundledCancelBtn') as HTMLButtonElement;
    cancelBtn.click();
    const res3 = await p3;
    expect(res3).toBeNull();
    expect(invoke).toHaveBeenCalledWith('cleanup_temp_archive', { tempDirPath: '/temp/path' });

    // 4. Confirm success (with missing status element)
    const p4 = showBundledWarningModal('/base/path', '/temp/path', ['A1'], onComplete);
    (invoke as any).mockResolvedValueOnce('Success');
    const finalConfirmBtn = document.getElementById('confirmBundledInstallBtn') as HTMLButtonElement;
    finalConfirmBtn.click();
    const res4 = await p4;
    expect(res4).toBe('Success');

    // 5. Confirm failure (with status element present)
    const statusDiv = document.createElement('div');
    statusDiv.id = 'status';
    document.body.appendChild(statusDiv);
    const p5 = showBundledWarningModal('/base/path', '/temp/path', ['A1'], onComplete);
    (invoke as any).mockRejectedValueOnce('Error installing bundled 2');
    const finalConfirmBtn2 = document.getElementById('confirmBundledInstallBtn') as HTMLButtonElement;
    finalConfirmBtn2.click();
    const res5 = await p5;
    expect(res5).toBeNull();
    expect(document.getElementById('status')?.textContent).toBe('Error: Error installing bundled 2');

    // 6. Cancel path (with status element present)
    const p6 = showBundledWarningModal('/base/path', '/temp/path', ['A1'], onComplete);
    (invoke as any).mockResolvedValueOnce('Cleanup complete');
    const finalCancelBtn = document.getElementById('confirmBundledCancelBtn') as HTMLButtonElement;
    finalCancelBtn.click();
    const res6 = await p6;
    expect(res6).toBeNull();
    expect(document.getElementById('status')?.textContent).toBe(getTranslation('import.status.cancelled'));
  });

  it('covers showDependencyModal completely', async () => {
    document.body.innerHTML = `
      <div id="status"></div>
      <div id="dependencyModal" class="hidden">
        <div id="dependencyList"></div>
        <button id="dependencyInstallBtn"></button>
        <button id="dependencyCancelBtn"></button>
      </div>
    `;

    // 1. Cancel path
    const p1 = showDependencyModal('/base/path', ['Dep1']);
    const cancelBtn = document.getElementById('dependencyCancelBtn') as HTMLButtonElement;
    cancelBtn.click();
    await p1;
    expect(document.getElementById('dependencyModal')?.classList.contains('hidden')).toBe(true);

    // 2. Install path (success & failure branches)
    const p2 = showDependencyModal('/base/path', ['Dep1', 'Dep2']);
    
    // Cover active site throw error path (line 261)
    (getCurrentActiveSite as any).mockImplementationOnce(() => {
      throw new Error('State error');
    });
    
    // First dependency succeeds, second fails
    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === 'resolve_addon_dependency') {
        if (args.dependencyName === 'Dep1') return Promise.resolve('Success dep1');
        return Promise.reject('Failed dep2');
      }
      if (cmd === 'check_addon_dependencies') {
        return Promise.resolve([]);
      }
      return Promise.resolve();
    });

    const installBtn = document.getElementById('dependencyInstallBtn') as HTMLButtonElement;
    
    // Remove status element to cover missing status branch in dependency modal
    document.getElementById('status')?.remove();
    
    installBtn.click();
    await p2;
    expect(invoke).toHaveBeenCalledWith('resolve_addon_dependency', {
      basePath: '/base/path',
      dependencyName: 'Dep1',
      isMock: false,
    });
    expect(invoke).toHaveBeenCalledWith('resolve_addon_dependency', {
      basePath: '/base/path',
      dependencyName: 'Dep2',
      isMock: false,
    });

    // 3. Install path (normal path with status element present)
    const statusDiv = document.createElement('div');
    statusDiv.id = 'status';
    document.body.appendChild(statusDiv);

    const p3 = showDependencyModal('/base/path', ['Dep1']);
    (getCurrentActiveSite as any).mockReturnValueOnce('mock');
    
    const installBtn2 = document.getElementById('dependencyInstallBtn') as HTMLButtonElement;
    installBtn2.click();
    await p3;
    expect(invoke).toHaveBeenCalledWith('resolve_addon_dependency', {
      basePath: '/base/path',
      dependencyName: 'Dep1',
      isMock: true,
    });
  });

  it('covers handlePostInstallDependencyCheck completely', async () => {
    document.body.innerHTML = `
      <div id="status"></div>
      <div id="dependencyModal" class="hidden">
        <div id="dependencyList"></div>
        <button id="dependencyInstallBtn"></button>
        <button id="dependencyCancelBtn"></button>
      </div>
    `;

    // Check with empty message or unrelated message
    await handlePostInstallDependencyCheck('/base/path', 'Some normal message');
    expect(invoke).not.toHaveBeenCalled();

    // Check successMessage with ':' (multiple addons)
    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === 'check_addon_dependencies') {
        if (args.addonName === 'A1') return Promise.resolve(['DepX']);
        return Promise.resolve([]);
      }
      return Promise.resolve();
    });

    // Use a setTimeout to click the cancel button of the modal so it resolves
    setTimeout(() => {
      const cancelBtn = document.getElementById('dependencyCancelBtn');
      if (cancelBtn) cancelBtn.click();
    }, 10);

    await handlePostInstallDependencyCheck('/base/path', 'Imported:A1,A2');
    
    // Check successMessage with 'Imported addon ' format (this will not have missing deps, so no modal)
    await handlePostInstallDependencyCheck('/base/path', 'Imported addon A3 version 1');

    // Reject check_addon_dependencies to cover line 324 catch block
    (invoke as any).mockImplementationOnce((cmd: string) => {
      if (cmd === 'check_addon_dependencies') {
        return Promise.reject('Dependency check failed');
      }
      return Promise.resolve();
    });
    await handlePostInstallDependencyCheck('/base/path', 'Imported:A4');

    // Cover name is falsy block in 'Imported addon ' parsing
    await handlePostInstallDependencyCheck('/base/path', 'Imported addon ');
  });

  it('covers the REPLACE_WARNING error flow in file import option', async () => {
    document.body.innerHTML = `
      <button id="importAddonBtn">Import</button>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="replaceWarningModal" class="hidden">
        <div id="replaceWarningList"></div>
        <button id="replaceWarningConfirmBtn"></button>
        <button id="replaceWarningCancelBtn"></button>
      </div>
    `;

    setupImportModalEvents();
    const mainImportBtn = document.getElementById('importAddonBtn') as HTMLElement;
    mainImportBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    const fileBtn = overlay.querySelector('#importFileBtn') as HTMLElement;

    // Case 1: REPLACE_WARNING error and confirm replace
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'pick_files') return Promise.resolve(['/downloads/addon.zip']);
      if (cmd === 'import_addon_files') return Promise.reject('REPLACE_WARNING:temp_path|addon1,addon2');
      if (cmd === 'confirm_install_bundled') return Promise.resolve('Success');
      return Promise.resolve();
    });

    // Simulate clicking the confirm button when the warning modal appears
    setTimeout(() => {
      const confirmBtn = document.getElementById('replaceWarningConfirmBtn');
      if (confirmBtn) confirmBtn.click();
    }, 10);

    fileBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.getElementById('status')?.textContent).toBe(getTranslation('status.imported'));

    // Case 2: REPLACE_WARNING error and cancel replace
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'pick_files') return Promise.resolve(['/downloads/addon.zip']);
      if (cmd === 'import_addon_files') return Promise.reject('REPLACE_WARNING:temp_path|addon1,addon2');
      if (cmd === 'cleanup_temp_archive') return Promise.resolve();
      return Promise.resolve();
    });

    // Simulate clicking the cancel button
    setTimeout(() => {
      const cancelBtn = document.getElementById('replaceWarningCancelBtn');
      if (cancelBtn) cancelBtn.click();
    }, 10);

    fileBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.getElementById('status')?.textContent).toBe('Import cancelled.');
  });

  it('covers showReplaceWarningModal completely', async () => {
    document.body.innerHTML = `
      <div id="replaceWarningModal" class="hidden">
        <div id="replaceWarningList"></div>
        <button id="replaceWarningConfirmBtn"></button>
        <button id="replaceWarningCancelBtn"></button>
      </div>
    `;

    // 1. Confirm branch
    const p1 = showReplaceWarningModal('temp_path', ['addon1']);
    setTimeout(() => {
      document.getElementById('replaceWarningConfirmBtn')?.click();
    }, 10);
    const res1 = await p1;
    expect(res1).toBe(true);

    // 2. Cancel branch
    (invoke as any).mockImplementationOnce(() => Promise.resolve());
    const p2 = showReplaceWarningModal('temp_path', ['addon1']);
    setTimeout(() => {
      document.getElementById('replaceWarningCancelBtn')?.click();
    }, 10);
    const res2 = await p2;
    expect(res2).toBe(false);
    expect(invoke).toHaveBeenCalledWith('cleanup_temp_archive', { tempDirPath: 'temp_path' });
  });
});
