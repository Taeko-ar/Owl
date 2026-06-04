import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { selectAddonForDownload, installSelectedAddons } from '../store/download';
import { selectedAddons, setCurrentActiveSite, setDetectedGameVersion } from '../state';
import { invoke } from '@tauri-apps/api/core';
import { CatalogAddon, AddonVersion } from '../types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../ui/import', () => ({
  showBundledWarningModal: vi
    .fn()
    .mockImplementation(async (gamePath, tempPath, names, callback) => {
      if (callback) await callback();
      return true;
    }),
  showReplaceWarningModal: vi.fn(),
  parseAndTranslateImportError: vi.fn().mockImplementation((e) => e),
  handlePostInstallDependencyCheck: vi.fn().mockImplementation(() => Promise.resolve()),
}));

describe('Store Download Module', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="gamePath" value="C:\\wow" />
      <div id="status">Ready</div>
      <div id="activityProgress" style="width: 0%;"></div>
      <button id="store-modal-confirm"></button>
      <button id="store-modal-cancel"></button>
      <table>
        <tr data-key="cf-101">
          <td class="store-status-cell"></td>
          <td><input type="checkbox" class="confirm-addon-checkbox" data-key="cf-101" checked /></td>
        </tr>
      </table>
    `;
    selectedAddons.clear();
    setCurrentActiveSite('curseforge');
    setDetectedGameVersion('3.3.5a');
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('selectAddonForDownload handles CurseForge download selection and no compatible versions', async () => {
    const mockAddon = { modId: 101, title: 'Questie', name: 'Questie' } as unknown as CatalogAddon;

    document.body.innerHTML += `
      <div class="store-addon-card" data-key="cf-101">
        <input type="checkbox" class="store-addon-checkbox" checked />
      </div>
    `;

    // Case 1: no compatible version
    vi.mocked(invoke).mockResolvedValue({ data: [] });
    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(false);
    const cb = document.querySelector('.store-addon-checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(false);

    // Case 2: compatible version found
    vi.mocked(invoke).mockResolvedValue({
      data: [
        {
          id: 10101,
          displayName: 'Questie v1',
          fileName: 'questie.zip',
          downloadUrl: 'http://dl.com/questie.zip',
          gameVersions: ['3.3.5'],
        },
      ],
    });
    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(true);
    expect(selectedAddons.get('cf-101')?.selectedVersion.id).toBe(10101);
  });

  it('selectAddonForDownload supports classic game versions and github active site', async () => {
    const mockAddon = {
      modId: 102,
      title: 'QuestieClassic',
      name: 'QuestieClassic',
    } as unknown as CatalogAddon;
    setCurrentActiveSite('github');
    setDetectedGameVersion('1.12.1');

    vi.mocked(invoke).mockResolvedValue([
      {
        id: 10201,
        displayName: 'v1.0-classic',
        fileName: 'classic.zip',
        downloadUrl: 'http://gh.com/classic.zip',
        gameVersions: ['1.12.1'],
      },
    ]);

    await selectAddonForDownload('gh-102', mockAddon);
    expect(selectedAddons.has('gh-102')).toBe(true);
  });

  it('installSelectedAddons loops through checked items and calls Tauri invoke', async () => {
    vi.useFakeTimers();
    const mockAddon = { modId: 101, title: 'Questie', name: 'Questie' } as unknown as CatalogAddon;
    const mockVersion = {
      id: 10101,
      downloadUrl: 'http://dl.com/questie.zip',
      sha1: 'sha1',
    } as unknown as AddonVersion;
    selectedAddons.set('cf-101', { addon: mockAddon, selectedVersion: mockVersion });

    vi.mocked(invoke).mockResolvedValue('Success');

    await installSelectedAddons();
    vi.runAllTimers();
    expect(invoke).toHaveBeenCalledWith('download_and_extract_addon', {
      basePath: 'C:\\wow',
      url: 'http://dl.com/questie.zip',
      sha1: 'sha1',
      modId: 101,
      fileId: 10101,
    });
    vi.useRealTimers();
  });

  it('installSelectedAddons handles invoke failures gracefully', async () => {
    const mockAddon = { modId: 101, title: 'Questie', name: 'Questie' } as unknown as CatalogAddon;
    const mockVersion = {
      id: 10101,
      downloadUrl: 'http://dl.com/questie.zip',
    } as unknown as AddonVersion;
    selectedAddons.set('cf-101', { addon: mockAddon, selectedVersion: mockVersion });

    vi.mocked(invoke).mockRejectedValue('Download error');

    await installSelectedAddons();
    const statusCell = document.querySelector('.store-status-cell');
    expect(statusCell?.textContent).toContain('Failed');
  });

  it('selectAddonForDownload filters CurseForge files for Classic game version and fallback hashes', async () => {
    const mockAddon = {
      modId: 105,
      title: 'QuestieClassicCF',
      name: 'QuestieClassicCF',
    } as unknown as CatalogAddon;
    setDetectedGameVersion('1.12.1');

    vi.mocked(invoke).mockResolvedValue({
      data: [
        {
          id: 10501,
          displayName: 'Questie v1.12',
          fileName: 'questie.zip',
          downloadUrl: 'http://dl.com/questie.zip',
          gameVersions: ['1.12'],
          hashes: [{ algo: 2, value: 'sha256' }],
        },
      ],
    });

    await selectAddonForDownload('cf-105', mockAddon);
    expect(selectedAddons.has('cf-105')).toBe(true);
    expect(selectedAddons.get('cf-105')?.selectedVersion.sha1).toBeNull();
  });

  it('selectAddonForDownload handles fetching errors gracefully', async () => {
    const mockAddon = { modId: 101, title: 'Questie' } as unknown as CatalogAddon;
    vi.mocked(invoke).mockRejectedValue('Network Timeout');

    document.body.innerHTML += `
      <div class="store-addon-card" data-key="cf-101">
        <input type="checkbox" class="store-addon-checkbox" checked />
      </div>
    `;

    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(false);
    const cb = document.querySelector('.store-addon-checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it('selectAddonForDownload handles specificVersion branches and missing card/checkbox elements', async () => {
    const mockAddon = { modId: 101, title: 'Questie' } as unknown as CatalogAddon;
    const version = { id: 10101, downloadUrl: 'url' } as unknown as AddonVersion;

    // 1. specificVersion branch with card present but checkbox missing
    document.body.innerHTML = `
      <div class="store-addon-card" data-key="cf-101"></div>
    `;
    await selectAddonForDownload('cf-101', mockAddon, version);
    expect(selectedAddons.has('cf-101')).toBe(true);

    // 2. specificVersion branch with no card in DOM
    document.body.innerHTML = '';
    selectedAddons.clear();
    await selectAddonForDownload('cf-101', mockAddon, version);
    expect(selectedAddons.has('cf-101')).toBe(true);

    // 3. no compatible version branch with no card in DOM
    selectedAddons.clear();
    vi.mocked(invoke).mockResolvedValue({ data: [] });
    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(false);

    // 4. fetch error branch with no card in DOM
    vi.mocked(invoke).mockRejectedValue('Network error');
    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(false);
  });

  it('selectAddonForDownload handles CurseForge download selection with empty response data and 3.4.x / invalid game versions', async () => {
    const mockAddon = { modId: 101, title: 'Questie' } as unknown as CatalogAddon;

    // response.data is undefined
    vi.mocked(invoke).mockResolvedValue({});
    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(false);

    // match gameVersions with 3.4.x and check fallback display name
    vi.mocked(invoke).mockResolvedValue({
      data: [
        {
          id: 10102,
          fileName: 'questie_wotlk.zip',
          downloadUrl: '', // empty to trigger alternate downloadUrl generation
          gameVersions: ['3.4.1'],
        },
      ],
    });
    setDetectedGameVersion('3.3.5a');
    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(true);
    expect(selectedAddons.get('cf-101')?.selectedVersion.displayName).toBe('questie_wotlk.zip');
  });

  it('installSelectedAddons handles empty check, missing modal buttons, missing rows/cells, string version IDs and missing sha1/modId', async () => {
    // 1. itemsToDownload length is 0
    document.body.innerHTML = '<input type="checkbox" class="confirm-addon-checkbox" checked />'; // checked but key missing
    const resEmpty = await installSelectedAddons();
    expect(resEmpty).toBeUndefined();

    // 2. confirm/cancel buttons and status elements missing in DOM, string/invalid version id, missing sha1/modId
    vi.useFakeTimers();
    document.body.innerHTML = `
      <input id="gamePath" value="C:\\wow" />
      <div id="status">Ready</div>
      <button id="store-modal-confirm"></button>
      <input type="checkbox" class="confirm-addon-checkbox" data-key="cf-101" checked />
      <input type="checkbox" class="confirm-addon-checkbox" data-key="cf-102" />
    `;
    const mockAddon = { modId: undefined, title: 'Questie' } as unknown as CatalogAddon;
    const mockVersion = {
      id: 'abc',
      downloadUrl: 'http://dl.com/questie.zip',
    } as unknown as AddonVersion; // non-parseable version id, missing sha1
    selectedAddons.set('cf-101', { addon: mockAddon, selectedVersion: mockVersion });

    vi.mocked(invoke).mockResolvedValue('Success');

    await installSelectedAddons();
    vi.runAllTimers();
    expect(invoke).toHaveBeenCalledWith('download_and_extract_addon', {
      basePath: 'C:\\wow',
      url: 'http://dl.com/questie.zip',
      sha1: null,
      modId: null,
      fileId: null, // should fall back to null on 'abc'
    });
    vi.useRealTimers();
  });

  it('covers remaining download branches', async () => {
    // 1. gameVersions filter for Classic cover 1.12.2 and cover filter out when missing gameVersions / hasDlUrl false
    setDetectedGameVersion('1.12.1');
    const mockAddon = { modId: 101, title: 'Questie' } as unknown as CatalogAddon;

    vi.mocked(invoke).mockResolvedValue({
      data: [
        {
          id: 10101,
          displayName: 'v1.12.2',
          fileName: 'questie.zip',
          downloadUrl: 'http://dl.com/questie.zip',
          gameVersions: ['1.12.2'],
        },
        {
          id: 10102,
          displayName: 'missing-game-versions',
          fileName: 'questie.zip',
          downloadUrl: 'http://dl.com/questie.zip',
          // missing gameVersions
        },
        {
          id: 10103,
          displayName: 'missing-dlurl-and-filename',
          gameVersions: ['1.12.1'],
          // missing downloadUrl and fileName
        },
      ],
    });

    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(true);
    expect(selectedAddons.get('cf-101')?.selectedVersion.id).toBe(10101);

    // 2. card present but checkbox missing (select success, select no version, select error)
    document.body.innerHTML = `
      <div class="store-addon-card" data-key="cf-101"></div> <!-- card present, no cb -->
    `;
    selectedAddons.clear();
    vi.mocked(invoke).mockResolvedValue({
      data: [
        {
          id: 10101,
          fileName: 'questie.zip',
          downloadUrl: 'http://dl.com/questie.zip',
          gameVersions: ['1.12.2'],
        },
      ],
    });
    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(true);

    // no compatible version, card present, no cb
    selectedAddons.clear();
    vi.mocked(invoke).mockResolvedValue({ data: [] });
    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(false);

    // error path, card present, no cb
    vi.mocked(invoke).mockRejectedValue('Some error');
    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(false);

    // 3. installSelectedAddons: checked checkbox with data-key but not in selectedAddons
    document.body.innerHTML = `
      <input id="gamePath" value="C:\\wow" />
      <div id="status">Ready</div>
      <button id="store-modal-confirm"></button>
      <input type="checkbox" class="confirm-addon-checkbox" data-key="cf-101" checked />
    `;
    selectedAddons.clear();
    const res = await installSelectedAddons();
    expect(res).toBeUndefined();

    // 4. installSelectedAddons: download fails but statusCell is missing
    document.body.innerHTML = `
      <input id="gamePath" value="C:\\wow" />
      <div id="status">Ready</div>
      <button id="store-modal-confirm"></button>
      <input type="checkbox" class="confirm-addon-checkbox" data-key="cf-101" checked />
      <table>
        <tr data-key="cf-101">
          <!-- no status-cell -->
        </tr>
      </table>
    `;
    selectedAddons.set('cf-101', {
      addon: mockAddon,
      selectedVersion: { id: 10101, downloadUrl: 'url' } as unknown as AddonVersion,
    });
    vi.mocked(invoke).mockRejectedValue('Download error');
    await installSelectedAddons();

    // 5. installSelectedAddons: storeReviewBtn present, BUNDLED error handled (confirm path), modal transitions covered
    vi.useFakeTimers();
    document.body.innerHTML = `
      <input id="gamePath" value="C:\\wow" />
      <div id="status">Ready</div>
      <div id="activityProgress" style="width: 0%;"></div>
      <button id="store-modal-confirm"></button>
      <button id="store-modal-cancel"></button>
      <button id="storeReviewBtn">Review</button>
      <div id="storeDownloadModal"></div>
      <div id="storeModal"></div>
      <input type="checkbox" class="confirm-addon-checkbox" data-key="cf-101" checked />
      <table>
        <tr data-key="cf-101">
          <td class="store-status-cell"></td>
        </tr>
      </table>
    `;
    const importModule = await import('../ui/import');
    vi.mocked(importModule.showBundledWarningModal).mockImplementation(
      async (gamePath, tempPath, names, callback) => {
        if (callback) await callback();
        return 'success';
      }
    ); // user confirms
    vi.mocked(invoke).mockRejectedValue('BUNDLED:temp|A1,A2');

    selectedAddons.set('cf-101', {
      addon: mockAddon,
      selectedVersion: { id: 10101, downloadUrl: 'url' } as unknown as AddonVersion,
    });

    await installSelectedAddons();
    // Verify storeReviewBtn disabled state and text
    const reviewBtn = document.getElementById('storeReviewBtn') as HTMLButtonElement;
    expect(reviewBtn.disabled).toBe(true);
    expect(reviewBtn.textContent).toBe('Downloading...');

    // Run timers for the post-download fadeout transition
    vi.runAllTimers();
    expect(importModule.showBundledWarningModal).toHaveBeenCalledWith(
      'C:\\wow',
      'temp',
      ['A1', 'A2'],
      expect.any(Function)
    );
    expect(reviewBtn.disabled).toBe(false);
    expect(reviewBtn.textContent).toBe('Review');

    // 6a. installSelectedAddons: BUNDLED error (cancel path + status cell present)
    selectedAddons.set('cf-101', {
      addon: mockAddon,
      selectedVersion: { id: 10101, downloadUrl: 'url' } as unknown as AddonVersion,
    });
    vi.mocked(importModule.showBundledWarningModal).mockResolvedValue(null); // user cancels
    await installSelectedAddons();
    vi.runAllTimers();

    // 6b. installSelectedAddons: BUNDLED error (cancel path + missing status cell + empty review button text)
    document.querySelector('table')?.remove(); // remove status cell
    if (reviewBtn) reviewBtn.textContent = ''; // empty textContent to cover line 133
    selectedAddons.set('cf-101', {
      addon: mockAddon,
      selectedVersion: { id: 10101, downloadUrl: 'url' } as unknown as AddonVersion,
    });
    await installSelectedAddons();
    vi.runAllTimers();

    // 7. BUNDLED error (confirm path + missing status cell)
    selectedAddons.set('cf-101', {
      addon: mockAddon,
      selectedVersion: { id: 10101, downloadUrl: 'url' } as unknown as AddonVersion,
    });
    vi.mocked(importModule.showBundledWarningModal).mockImplementation(
      async (gamePath, tempPath, names, callback) => {
        if (callback) await callback();
        return 'success';
      }
    );
    await installSelectedAddons();
    vi.runAllTimers();

    // 8a. REPLACE_WARNING error (confirm path)
    document.body.innerHTML = `
      <input id="gamePath" value="C:\\\\wow" />
      <div id="status">Ready</div>
      <div id="activityProgress" style="width: 0%;"></div>
      <button id="store-modal-confirm"></button>
      <button id="store-modal-cancel"></button>
      <button id="storeReviewBtn">Review</button>
      <div id="storeDownloadModal"></div>
      <div id="storeModal"></div>
      <input type="checkbox" class="confirm-addon-checkbox" data-key="cf-101" checked />
      <table>
        <tr data-key="cf-101">
          <td class="store-status-cell"></td>
        </tr>
      </table>
    `;
    selectedAddons.set('cf-101', {
      addon: mockAddon,
      selectedVersion: { id: 10101, downloadUrl: 'url' } as unknown as AddonVersion,
    });
    vi.mocked(importModule.showReplaceWarningModal).mockResolvedValue(true);
    vi.mocked(invoke).mockRejectedValueOnce('REPLACE_WARNING:temp|A1');
    vi.mocked(invoke).mockResolvedValueOnce('Success'); // confirm_install_bundled
    await installSelectedAddons();
    vi.runAllTimers();

    // 8b. REPLACE_WARNING error (confirm path, confirm failure)
    document.body.innerHTML = `
      <input id="gamePath" value="C:\\\\wow" />
      <div id="status">Ready</div>
      <div id="activityProgress" style="width: 0%;"></div>
      <button id="store-modal-confirm"></button>
      <button id="store-modal-cancel"></button>
      <button id="storeReviewBtn">Review</button>
      <div id="storeDownloadModal"></div>
      <div id="storeModal"></div>
      <input type="checkbox" class="confirm-addon-checkbox" data-key="cf-101" checked />
      <table>
        <tr data-key="cf-101">
          <td class="store-status-cell"></td>
        </tr>
      </table>
    `;
    selectedAddons.set('cf-101', {
      addon: mockAddon,
      selectedVersion: { id: 10101, downloadUrl: 'url' } as unknown as AddonVersion,
    });
    vi.mocked(importModule.showReplaceWarningModal).mockResolvedValue(true);
    vi.mocked(invoke).mockRejectedValueOnce('REPLACE_WARNING:temp|A1');
    vi.mocked(invoke).mockRejectedValueOnce('Confirm failed'); // confirm_install_bundled fails
    await installSelectedAddons();
    vi.runAllTimers();

    // 8c. REPLACE_WARNING error (cancel path)
    document.body.innerHTML = `
      <input id="gamePath" value="C:\\\\wow" />
      <div id="status">Ready</div>
      <div id="activityProgress" style="width: 0%;"></div>
      <button id="store-modal-confirm"></button>
      <button id="store-modal-cancel"></button>
      <button id="storeReviewBtn">Review</button>
      <div id="storeDownloadModal"></div>
      <div id="storeModal"></div>
      <input type="checkbox" class="confirm-addon-checkbox" data-key="cf-101" checked />
      <table>
        <tr data-key="cf-101">
          <td class="store-status-cell"></td>
        </tr>
      </table>
    `;
    selectedAddons.set('cf-101', {
      addon: mockAddon,
      selectedVersion: { id: 10101, downloadUrl: 'url' } as unknown as AddonVersion,
    });
    vi.mocked(importModule.showReplaceWarningModal).mockResolvedValue(false);
    vi.mocked(invoke).mockRejectedValueOnce('REPLACE_WARNING:temp|A1');
    await installSelectedAddons();
    vi.runAllTimers();

    // 8d. REPLACE_WARNING error (confirm path + missing status cell)
    document.body.innerHTML = `
      <input id="gamePath" value="C:\\\\wow" />
      <div id="status">Ready</div>
      <div id="activityProgress" style="width: 0%;"></div>
      <button id="store-modal-confirm"></button>
      <button id="store-modal-cancel"></button>
      <button id="storeReviewBtn">Review</button>
      <div id="storeDownloadModal"></div>
      <div id="storeModal"></div>
      <input type="checkbox" class="confirm-addon-checkbox" data-key="cf-101" checked />
    `;
    selectedAddons.set('cf-101', {
      addon: mockAddon,
      selectedVersion: { id: 10101, downloadUrl: 'url' } as unknown as AddonVersion,
    });
    vi.mocked(importModule.showReplaceWarningModal).mockResolvedValue(true);
    vi.mocked(invoke).mockRejectedValueOnce('REPLACE_WARNING:temp|A1');
    vi.mocked(invoke).mockResolvedValueOnce('Success'); // confirm_install_bundled
    await installSelectedAddons();
    vi.runAllTimers();

    // 8e. REPLACE_WARNING error (confirm path + missing status cell + confirm failure)
    document.body.innerHTML = `
      <input id="gamePath" value="C:\\\\wow" />
      <div id="status">Ready</div>
      <div id="activityProgress" style="width: 0%;"></div>
      <button id="store-modal-confirm"></button>
      <button id="store-modal-cancel"></button>
      <button id="storeReviewBtn">Review</button>
      <div id="storeDownloadModal"></div>
      <div id="storeModal"></div>
      <input type="checkbox" class="confirm-addon-checkbox" data-key="cf-101" checked />
    `;
    selectedAddons.set('cf-101', {
      addon: mockAddon,
      selectedVersion: { id: 10101, downloadUrl: 'url' } as unknown as AddonVersion,
    });
    vi.mocked(importModule.showReplaceWarningModal).mockResolvedValue(true);
    vi.mocked(invoke).mockRejectedValueOnce('REPLACE_WARNING:temp|A1');
    vi.mocked(invoke).mockRejectedValueOnce('Confirm failed'); // confirm_install_bundled fails
    await installSelectedAddons();
    vi.runAllTimers();

    vi.useRealTimers();
  });
});
