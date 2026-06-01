import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { setupImportModalEvents } from '../ui/import';
import { invoke } from '@tauri-apps/api/core';
import { showTextInputModal } from '../utils';
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

vi.mock('../main', () => ({
  loadAddonsAndPatches: vi.fn().mockImplementation(() => Promise.resolve()),
  translateDOM: vi.fn(),
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
});
