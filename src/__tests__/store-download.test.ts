import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { selectAddonForDownload, installSelectedAddons } from '../store/download';
import { selectedAddons, setCurrentActiveSite, setDetectedGameVersion } from '../state';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
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
    const mockAddon: any = { modId: 101, title: 'Questie', name: 'Questie' };

    document.body.innerHTML += `
      <div class="store-addon-card" data-key="cf-101">
        <input type="checkbox" class="store-addon-checkbox" checked />
      </div>
    `;

    // Case 1: no compatible version
    (invoke as any).mockResolvedValue({ data: [] });
    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(false);
    const cb = document.querySelector('.store-addon-checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(false);

    // Case 2: compatible version found
    (invoke as any).mockResolvedValue({
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
    const mockAddon: any = { modId: 102, title: 'QuestieClassic', name: 'QuestieClassic' };
    setCurrentActiveSite('github');
    setDetectedGameVersion('1.12.1');

    (invoke as any).mockResolvedValue([
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
    const mockAddon: any = { modId: 101, title: 'Questie', name: 'Questie' };
    const mockVersion: any = { id: 10101, downloadUrl: 'http://dl.com/questie.zip', sha1: 'sha1' };
    selectedAddons.set('cf-101', { addon: mockAddon, selectedVersion: mockVersion });

    (invoke as any).mockResolvedValue('Success');

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
    const mockAddon: any = { modId: 101, title: 'Questie', name: 'Questie' };
    const mockVersion: any = { id: 10101, downloadUrl: 'http://dl.com/questie.zip' };
    selectedAddons.set('cf-101', { addon: mockAddon, selectedVersion: mockVersion });

    (invoke as any).mockRejectedValue('Download error');

    await installSelectedAddons();
    const statusCell = document.querySelector('.store-status-cell');
    expect(statusCell?.textContent).toContain('Failed');
  });

  it('selectAddonForDownload filters CurseForge files for Classic game version and fallback hashes', async () => {
    const mockAddon: any = { modId: 105, title: 'QuestieClassicCF', name: 'QuestieClassicCF' };
    setDetectedGameVersion('1.12.1');

    (invoke as any).mockResolvedValue({
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
    const mockAddon: any = { modId: 101, title: 'Questie' };
    (invoke as any).mockRejectedValue('Network Timeout');

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
    const mockAddon: any = { modId: 101, title: 'Questie' };
    const version: any = { id: 10101, downloadUrl: 'url' };

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
    (invoke as any).mockResolvedValue({ data: [] });
    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(false);

    // 4. fetch error branch with no card in DOM
    (invoke as any).mockRejectedValue('Network error');
    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(false);
  });

  it('selectAddonForDownload handles CurseForge download selection with empty response data and 3.4.x / invalid game versions', async () => {
    const mockAddon: any = { modId: 101, title: 'Questie' };

    // response.data is undefined
    (invoke as any).mockResolvedValue({});
    await selectAddonForDownload('cf-101', mockAddon);
    expect(selectedAddons.has('cf-101')).toBe(false);

    // match gameVersions with 3.4.x and check fallback display name
    (invoke as any).mockResolvedValue({
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
    `;
    const mockAddon: any = { modId: null, title: 'Questie' };
    const mockVersion: any = { id: 'abc', downloadUrl: 'http://dl.com/questie.zip' }; // non-parseable version id, missing sha1
    selectedAddons.set('cf-101', { addon: mockAddon, selectedVersion: mockVersion });

    (invoke as any).mockResolvedValue('Success');

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
});
