import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { handleImportString, setupImportExportEvents } from '../ui/import-export';
import { invoke } from '@tauri-apps/api/core';
import { getTranslation } from '../i18n/index';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../main', () => ({
  loadAddonsAndPatches: vi.fn().mockImplementation(() => Promise.resolve()),
}));

describe('Import & Export UI', () => {
  let clipboardText = '';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clipboardText = '';
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockImplementation((txt) => {
          clipboardText = txt;
          return Promise.resolve();
        }),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('handleImportString prompts text input and validates base64 import string', async () => {
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="importPreviewModal" class="hidden"></div>
      <table id="import-preview-table-body"></table>
      <div id="importManualWarningContainer" class="hidden"></div>
      <div id="importManualList"></div>
    `;

    const payload = {
      v: 1,
      addons: [
        { name: 'MyAddonCF', enabled: true, source: 'curseforge', modId: 123, fileId: 456 },
        {
          name: 'MyAddonGit',
          enabled: false,
          source: 'github',
          gitUrl: 'git@github.com:foo/bar',
          branch: 'main',
        },
        { name: 'MyAddonManual', enabled: true, source: 'manual' },
      ],
    };

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'validate_import_string') {
        return Promise.resolve(payload);
      }
      if (cmd === 'get_addons') {
        return Promise.resolve(['MyAddonCF']); // MyAddonCF is already installed
      }
      return Promise.resolve();
    });

    const promise = handleImportString();

    // Verify modal prompt has been added to document body
    const textarea = document.getElementById('modalInput') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    textarea.value = 'base64StringHere';
    const submitBtn = document.getElementById('modalSubmitBtn') as HTMLButtonElement;
    submitBtn.click();

    await promise;

    // Verify modal overlay removed
    expect(document.getElementById('modalInput')).toBeNull();

    // Verify importPreviewModal opened
    const previewModal = document.getElementById('importPreviewModal');
    expect(previewModal?.classList.contains('hidden')).toBe(false);

    // Verify manual warning displayed
    const warningContainer = document.getElementById('importManualWarningContainer');
    expect(warningContainer?.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('importManualList')?.textContent).toBe('MyAddonManual');

    // Verify preview table row counts & status texts
    const tableBody = document.getElementById('import-preview-table-body');
    expect(tableBody?.children.length).toBe(3);
    const rows = tableBody?.querySelectorAll('tr');
    // Row 0: MyAddonCF - Status: Installed
    expect(rows?.[0].textContent).toContain(getTranslation('import.status.installed'));
    // Row 1: MyAddonGit - Status: Restorable
    expect(rows?.[1].textContent).toContain(getTranslation('import.status.restorable'));
    // Row 2: MyAddonManual - Status: Manual
    expect(rows?.[2].textContent).toContain(getTranslation('import.status.manual'));
  });

  it('handleImportString returns immediately if no string input is entered', async () => {
    const promise = handleImportString();
    const cancelBtn = document.getElementById('cancelImportStringModal') as HTMLElement;
    cancelBtn.click();
    await promise;
    expect(invoke).not.toHaveBeenCalled();
  });

  it('setupImportExportEvents registers copy buttons and confirm actions', async () => {
    document.body.innerHTML = `
      <button id="exportAddonsBtn">Export</button>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress" style="width: 0%;"></div>
      
      <!-- Export Modal -->
      <div id="exportModal" class="hidden">
        <button id="exportCloseBtn">✕</button>
        <button id="exportCopyBtn">Copy</button>
        <button id="exportCopyStringIconBtn">CopyIcon</button>
        <button id="exportCopyManualBtn">CopyManual</button>
        <textarea id="exportStringArea"></textarea>
        <div id="exportManualWarningContainer" class="hidden"></div>
        <div id="exportManualList"></div>
      </div>

      <!-- Import Preview Modal -->
      <div id="importPreviewModal" class="hidden">
        <button id="importPreviewCancelBtn">Cancel</button>
        <button id="importPreviewConfirmBtn">Confirm</button>
        <button id="importCopyManualBtn">CopyManualImport</button>
        <div id="importManualList">ImportManualListContent</div>
      </div>
    `;

    setupImportExportEvents();

    const payload = {
      v: 1,
      addons: [
        { name: 'MyAddonCF', enabled: true, source: 'curseforge', modId: 123, fileId: 456 },
        {
          name: 'MyAddonGit',
          enabled: false,
          source: 'github',
          gitUrl: 'git@github.com:foo/bar',
          branch: 'main',
        },
        { name: 'MyAddonManual', enabled: true, source: 'manual' },
      ],
    };
    const b64 = btoa(JSON.stringify(payload));

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'export_addon_list') return Promise.resolve(b64);
      if (cmd === 'validate_import_string') return Promise.resolve(payload);
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [
            { id: 456, downloadUrl: 'http://curseforge.com/addon.zip', fileName: 'addon.zip' },
          ],
        });
      }
      return Promise.resolve();
    });

    const exportBtn = document.getElementById('exportAddonsBtn') as HTMLElement;
    exportBtn.click();
    await vi.runAllTimersAsync();

    // Verify Export Modal visible
    const exportModal = document.getElementById('exportModal');
    expect(exportModal?.classList.contains('hidden')).toBe(false);
    expect((document.getElementById('exportStringArea') as HTMLTextAreaElement).value).toBe(b64);
    expect(
      document.getElementById('exportManualWarningContainer')?.classList.contains('hidden')
    ).toBe(false);
    expect(document.getElementById('exportManualList')?.textContent).toBe('MyAddonManual');

    // Clipboard Copy Test
    const exportCopyBtn = document.getElementById('exportCopyBtn') as HTMLElement;
    exportCopyBtn.click();
    expect(clipboardText).toBe(b64);

    const exportCopyStringIconBtn = document.getElementById(
      'exportCopyStringIconBtn'
    ) as HTMLElement;
    exportCopyStringIconBtn.click();
    expect(clipboardText).toBe(b64);

    const exportCopyManualBtn = document.getElementById('exportCopyManualBtn') as HTMLElement;
    exportCopyManualBtn.click();
    expect(clipboardText).toBe('MyAddonManual');

    const importCopyManualBtn = document.getElementById('importCopyManualBtn') as HTMLElement;
    importCopyManualBtn.click();
    expect(clipboardText).toBe('ImportManualListContent');

    // Export Modal Close via overlay click
    exportModal?.click();
    expect(exportModal?.classList.contains('hidden')).toBe(true);

    // Import Preview Confirm Flow
    // 1. Prompt string input first to set activePayloadToImport
    const importPromise = handleImportString();
    const textarea = document.getElementById('modalInput') as HTMLTextAreaElement;
    textarea.value = b64;
    (document.getElementById('modalSubmitBtn') as HTMLElement).click();
    await vi.runAllTimersAsync();
    await importPromise;

    // 2. Click confirm import btn
    const confirmBtn = document.getElementById('importPreviewConfirmBtn') as HTMLElement;
    confirmBtn.click();
    await vi.runAllTimersAsync();

    expect(invoke).toHaveBeenCalledWith('import_addon', {
      basePath: '/mock/wow',
      repoUrl: 'git@github.com:foo/bar',
    });
    expect(invoke).toHaveBeenCalledWith('change_addon_branch', {
      basePath: '/mock/wow',
      addonName: 'MyAddonGit',
      branchName: 'main',
    });
    expect(invoke).toHaveBeenCalledWith('download_and_extract_addon', {
      basePath: '/mock/wow',
      url: 'http://curseforge.com/addon.zip',
      sha1: null,
      modId: 123,
      fileId: 456,
    });
    expect(invoke).toHaveBeenCalledWith('toggle_addon', {
      basePath: '/mock/wow',
      addonName: 'MyAddonGit',
      enable: false,
    });

    expect(document.getElementById('status')?.textContent).toBe(getTranslation('status.ready'));
  });

  it('covers failure paths and fallback URLs in setupImportExportEvents', async () => {
    document.body.innerHTML = `
      <button id="exportAddonsBtn">Export</button>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress" style="width: 0%;"></div>
      
      <!-- Export Modal -->
      <div id="exportModal" class="hidden">
        <button id="exportCloseBtn">✕</button>
        <button id="exportCopyBtn">Copy</button>
        <button id="exportCopyStringIconBtn">CopyIcon</button>
        <button id="exportCopyManualBtn">CopyManual</button>
        <textarea id="exportStringArea"></textarea>
        <div id="exportManualWarningContainer" class="hidden"></div>
        <div id="exportManualList"></div>
      </div>

      <!-- Import Preview Modal -->
      <div id="importPreviewModal" class="hidden">
        <button id="importPreviewCancelBtn">Cancel</button>
        <button id="importPreviewConfirmBtn">Confirm</button>
        <button id="importCopyManualBtn">CopyManualImport</button>
        <div id="importManualList">ImportManualListContent</div>
      </div>
    `;

    setupImportExportEvents();

    // 1. handleImportString validation failure
    (invoke as any).mockImplementationOnce(() => Promise.reject('Decrypt failed'));
    const importPromise = handleImportString();
    const textarea = document.getElementById('modalInput') as HTMLTextAreaElement;
    textarea.value = 'invalidB64';
    (document.getElementById('modalSubmitBtn') as HTMLElement).click();
    await vi.runAllTimersAsync();
    await importPromise;
    // Toast should be shown (verified via cover logs, verify no crashes)

    // 2. export_addon_list failure path
    (invoke as any).mockImplementationOnce(() => Promise.reject('Export list failed'));
    const exportBtn = document.getElementById('exportAddonsBtn') as HTMLElement;
    exportBtn.click();
    await vi.runAllTimersAsync();
    expect(document.getElementById('status')?.textContent).toBe('Export error: Export list failed');

    // 3. Export with no manual addons (covers line 183)
    const payloadNoManual = {
      v: 1,
      addons: [{ name: 'AddonA', enabled: true, source: 'github', gitUrl: 'url' }],
    };
    const b64NoManual = btoa(JSON.stringify(payloadNoManual));
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'export_addon_list') return Promise.resolve(b64NoManual);
      if (cmd === 'validate_import_string') return Promise.resolve(payloadNoManual);
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'get_curseforge_mod_files') return Promise.resolve({ data: [] }); // Empty files list -> fallback default URL
      return Promise.resolve();
    });
    exportBtn.click();
    await vi.runAllTimersAsync();
    expect(
      document.getElementById('exportManualWarningContainer')?.classList.contains('hidden')
    ).toBe(true);

    // 4. Import confirm with 0 restorable (all already installed) (covers lines 261-262)
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'validate_import_string') return Promise.resolve(payloadNoManual);
      if (cmd === 'get_addons') return Promise.resolve(['AddonA']);
      return Promise.resolve();
    });
    const importPromise2 = handleImportString();
    const textarea2 = document.getElementById('modalInput') as HTMLTextAreaElement;
    textarea2.value = b64NoManual;
    (document.getElementById('modalSubmitBtn') as HTMLElement).click();
    await vi.runAllTimersAsync();
    await importPromise2;

    const confirmBtn = document.getElementById('importPreviewConfirmBtn') as HTMLElement;
    confirmBtn.click();
    await vi.runAllTimersAsync();
    // Toast: "No restorable addons to import!" covers 261-262

    // 5. CurseForge fileId length >= 4 edge URL (e.g. fileId 12345 -> part1=1234, part2=5)
    // And fallback URL default path + single download failure catch path (lines 315-319, 325, 348-350)
    const payloadCF = {
      v: 1,
      addons: [
        { name: 'CFAddon1', enabled: true, source: 'curseforge', modId: 101, fileId: 12345 },
        { name: 'CFAddon2', enabled: true, source: 'curseforge', modId: 102, fileId: 99 },
      ],
    };
    const b64CF = btoa(JSON.stringify(payloadCF));
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'validate_import_string') return Promise.resolve(payloadCF);
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'get_curseforge_mod_files') {
        // Return files list: one with match (fileId 12345), one with no match to trigger default URL fallback
        return Promise.resolve({
          data: [
            { id: 12345, fileName: 'cf1.zip' }, // matching but no downloadUrl -> triggers edge URL construction
          ],
        });
      }
      if (cmd === 'download_and_extract_addon') {
        // Mock download CFAddon2 to fail
        return Promise.reject('Download timeout');
      }
      return Promise.resolve();
    });

    const importPromise3 = handleImportString();
    const textarea3 = document.getElementById('modalInput') as HTMLTextAreaElement;
    textarea3.value = b64CF;
    (document.getElementById('modalSubmitBtn') as HTMLElement).click();
    await vi.runAllTimersAsync();
    await importPromise3;

    confirmBtn.click();
    await vi.runAllTimersAsync();

    expect(invoke).toHaveBeenCalledWith('download_and_extract_addon', {
      basePath: '/mock/wow',
      url: 'https://edge.forgecdn.net/files/0/99/CFAddon2.zip',
      sha1: null,
      modId: 102,
      fileId: 99,
    });
  });

  it('covers remaining import-export branches (missing elements, empty inputs, short CF file IDs)', async () => {
    // 1. prompt submission with empty/falsy text area
    const importPromise = handleImportString();
    const textarea = document.getElementById('modalInput') as HTMLTextAreaElement;
    textarea.value = '   ';
    (document.getElementById('modalSubmitBtn') as HTMLElement).click();
    // Modal should not close, close via cancel button
    (document.getElementById('cancelImportStringModal') as HTMLElement).click();
    await importPromise;

    // 2. exportBtn click with gamePathInput missing or empty
    document.body.innerHTML = `
      <button id="exportAddonsBtn">Export</button>
    `;
    setupImportExportEvents();
    (document.getElementById('exportAddonsBtn') as HTMLElement).click();
    expect(invoke).not.toHaveBeenCalled();

    // 3. exportBtn click with gamePathInput present but empty value
    document.body.innerHTML = `
      <button id="exportAddonsBtn">Export</button>
      <input id="gamePath" value="" />
    `;
    setupImportExportEvents();
    (document.getElementById('exportAddonsBtn') as HTMLElement).click();
    expect(invoke).not.toHaveBeenCalled();

    // 4. importConfirm click with activityProgress and statusFooter elements missing from DOM
    // also CurseForge fileId with length < 4 (e.g. 123)
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <button id="importPreviewConfirmBtn">Confirm</button>
      <!-- No status, no activityProgress -->
    `;
    setupImportExportEvents();
    const payloadShortCF = {
      v: 1,
      addons: [{ name: 'CFShort', enabled: true, source: 'curseforge', modId: 101, fileId: 123 }],
    };
    const b64ShortCF = btoa(JSON.stringify(payloadShortCF));

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'validate_import_string') return Promise.resolve(payloadShortCF);
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({ data: [{ id: 123, fileName: 'cf1.zip' }] });
      }
      return Promise.resolve();
    });

    // Setup activePayloadToImport
    const importPromise2 = handleImportString();
    const textarea2 = document.getElementById('modalInput') as HTMLTextAreaElement;
    textarea2.value = b64ShortCF;
    (document.getElementById('modalSubmitBtn') as HTMLElement).click();
    await vi.runAllTimersAsync();
    await importPromise2;

    // Trigger importConfirm without elements
    const confirmBtn = document.getElementById('importPreviewConfirmBtn') as HTMLElement;
    confirmBtn.click();
    await vi.runAllTimersAsync();

    // Verify it used fallback default Edge URL because length of '123' is < 4
    expect(invoke).toHaveBeenCalledWith(
      'download_and_extract_addon',
      expect.objectContaining({
        url: 'https://edge.forgecdn.net/files/0/123/CFShort.zip',
      })
    );
  });

  it('covers remaining import-export UI branches explicitly', async () => {
    // 1. handleImportString when gamePathInput is present but value is empty string
    document.body.innerHTML = `
      <input id="gamePath" value="" />
      <div id="importPreviewModal" class="hidden"></div>
      <table id="import-preview-table-body"></table>
      <div id="importManualWarningContainer" class="hidden"></div>
    `;
    const payload = {
      v: 1,
      addons: [{ name: 'ManualAddon', enabled: true, source: 'manual' }],
    };
    (invoke as any).mockResolvedValueOnce(payload).mockResolvedValueOnce([]);
    const importPromise = handleImportString();
    const textarea = document.getElementById('modalInput') as HTMLTextAreaElement;
    textarea.value = btoa(JSON.stringify(payload));
    (document.getElementById('modalSubmitBtn') as HTMLElement).click();
    await vi.runAllTimersAsync();
    await importPromise;

    // 2. exportBtn click and verify with missing statusFooter, missing exportStringArea, missing exportManualList
    document.body.innerHTML = `
      <button id="exportAddonsBtn">Export</button>
      <input id="gamePath" value="/mock/wow" />
      <div id="exportModal" class="hidden"></div>
    `;
    setupImportExportEvents();
    (invoke as any).mockResolvedValueOnce(btoa(JSON.stringify(payload)));
    (document.getElementById('exportAddonsBtn') as HTMLElement).click();
    await vi.runAllTimersAsync();

    // exportBtn click fails when statusFooter is missing
    (invoke as any).mockRejectedValueOnce('Export failed');
    (document.getElementById('exportAddonsBtn') as HTMLElement).click();
    await vi.runAllTimersAsync();

    // exportBtn click fails when statusFooter is present
    document.body.innerHTML = `
      <button id="exportAddonsBtn">Export</button>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
    `;
    setupImportExportEvents();
    (invoke as any).mockRejectedValueOnce('Export failed');
    (document.getElementById('exportAddonsBtn') as HTMLElement).click();
    await vi.runAllTimersAsync();

    // 3. export click handlers when elements are missing
    document.body.innerHTML = `
      <button id="exportCopyBtn">Copy</button>
      <button id="exportCopyStringIconBtn">CopyIcon</button>
      <button id="exportCopyManualBtn">CopyManual</button>
      <button id="importCopyManualBtn">CopyManualImport</button>
    `;
    setupImportExportEvents();
    (document.getElementById('exportCopyBtn') as HTMLElement).click();
    (document.getElementById('exportCopyStringIconBtn') as HTMLElement).click();
    (document.getElementById('exportCopyManualBtn') as HTMLElement).click();
    (document.getElementById('importCopyManualBtn') as HTMLElement).click();

    // 4. export click handlers when list textContent is empty
    document.body.innerHTML = `
      <button id="exportCopyManualBtn">CopyManual</button>
      <div id="exportManualList"></div>
    `;
    setupImportExportEvents();
    (document.getElementById('exportCopyManualBtn') as HTMLElement).click();

    // 5. backdrop clicks target mismatch and match
    document.body.innerHTML = `
      <div id="exportModal" class="hidden">
        <div id="exportContent"></div>
      </div>
      <div id="importPreviewModal" class="hidden">
        <div id="importContent"></div>
      </div>
    `;
    setupImportExportEvents();
    const exportModal = document.getElementById('exportModal') as HTMLElement;
    const exportContent = document.getElementById('exportContent') as HTMLElement;
    exportModal.classList.remove('hidden');
    exportContent.click();
    expect(exportModal.classList.contains('hidden')).toBe(false);
    exportModal.click(); // match click
    expect(exportModal.classList.contains('hidden')).toBe(true);

    const importPreviewModal = document.getElementById('importPreviewModal') as HTMLElement;
    const importContent = document.getElementById('importContent') as HTMLElement;
    importPreviewModal.classList.remove('hidden');
    importContent.click();
    expect(importPreviewModal.classList.contains('hidden')).toBe(false);
    importPreviewModal.click(); // match click
    expect(importPreviewModal.classList.contains('hidden')).toBe(true);

    // 6. importPreviewConfirmBtn click when addon.branch switch fails, and CurseForge missing modId/fileId
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <button id="importPreviewConfirmBtn">Confirm</button>
      <div id="status"></div>
      <table id="import-preview-table-body"></table>
    `;
    setupImportExportEvents();
    const payloadMixed = {
      v: 1,
      addons: [
        {
          name: 'GitAddon',
          enabled: true,
          source: 'github',
          gitUrl: 'git@github.com:foo/bar',
          branch: 'fail',
        },
        {
          name: 'GitAddonNoBranch',
          enabled: true,
          source: 'github',
          gitUrl: 'git@github.com:foo/bar2',
        }, // branch is undefined
        { name: 'CFAddonNoIds', enabled: true, source: 'curseforge' },
      ],
    };
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'validate_import_string') return Promise.resolve(payloadMixed);
      if (cmd === 'get_addons') return Promise.resolve([]);
      if (cmd === 'import_addon') return Promise.resolve();
      if (cmd === 'change_addon_branch') return Promise.reject('Branch change failed');
      return Promise.resolve();
    });
    const importPromise2 = handleImportString();
    const textarea2 = document.getElementById('modalInput') as HTMLTextAreaElement;
    textarea2.value = btoa(JSON.stringify(payloadMixed));
    (document.getElementById('modalSubmitBtn') as HTMLElement).click();
    await vi.runAllTimersAsync();
    await importPromise2;

    (document.getElementById('importPreviewConfirmBtn') as HTMLElement).click();
    await vi.runAllTimersAsync();

    // Click again when activePayloadToImport is null
    (document.getElementById('importPreviewConfirmBtn') as HTMLElement).click();
    await vi.runAllTimersAsync();
  });
});
