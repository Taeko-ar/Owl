import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  updateDetailsSelectionButton,
  loadAddonDetails,
  clearDetailsPane,
  renderStoreCatalog,
  isAddonInstalled,
} from '../store/catalog';
import {
  selectedAddons,
  setSelectedDetailAddon,
  setSelectedDetailAddonKey,
  setCurrentDetailVersions,
  setCurrentActiveSite,
  setDetectedGameVersion,
  setInstalledAddonsMeta,
} from '../state';
import { invoke } from '@tauri-apps/api/core';
import { getTranslation } from '../i18n';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('Store Catalog Module', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="storeListContainer"></div>
      <div id="storeListEmpty" class="hidden">No Addons</div>
      <div id="storeDetailsContent"></div>
    `;
    selectedAddons.clear();
    setSelectedDetailAddon(null);
    setSelectedDetailAddonKey('');
    setCurrentDetailVersions([]);
    setCurrentActiveSite('curseforge');
    setDetectedGameVersion('3.3.5a');

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [
            {
              id: 10101,
              displayName: 'v1.0',
              fileName: 'file.zip',
              downloadUrl: 'http://dl.com/file.zip',
              gameVersions: ['3.3.5a'],
            },
          ],
        });
      }
      return Promise.resolve();
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('updateDetailsSelectionButton handles missing elements gracefully', () => {
    const details = document.getElementById('storeDetailsContent') as HTMLDivElement;
    details.innerHTML = '<button id="detailSelectBtn">Old</button>';
    updateDetailsSelectionButton();
    const btn = document.getElementById('detailSelectBtn') as HTMLButtonElement;
    expect(btn.textContent).toBe('Old');
  });

  it('updateDetailsSelectionButton updates button text correctly', () => {
    const mockAddon: any = { id: 1, title: 'Questie' };
    setSelectedDetailAddon(mockAddon);
    setSelectedDetailAddonKey('cf-1');

    const details = document.getElementById('storeDetailsContent') as HTMLDivElement;
    details.innerHTML = '<button id="detailSelectBtn"></button>';

    updateDetailsSelectionButton();
    const btn = document.getElementById('detailSelectBtn') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe('Download');

    selectedAddons.set('cf-1', {
      addon: mockAddon,
      selectedVersion: { id: 1, displayName: 'v1', downloadUrl: 'url' } as any,
    });
    updateDetailsSelectionButton();
    expect(btn.textContent?.trim()).toBe('Queued');
  });

  it('clearDetailsPane resets details and HTML text', () => {
    clearDetailsPane();
    const details = document.getElementById('storeDetailsContent');
    expect(details?.innerHTML).toContain('Select an addon to view details');
  });

  it('renderStoreCatalog renders empty state when addons array is empty', () => {
    const emptyContainer = document.getElementById('storeListEmpty');
    renderStoreCatalog([], 'curseforge');
    expect(emptyContainer?.classList.contains('hidden')).toBe(false);
  });

  it('renderStoreCatalog renders items and registers event listeners', async () => {
    const addons: any[] = [
      {
        modId: 101,
        title: 'Questie',
        name: 'Questie',
        description: 'Quest helper',
        logoUrl: '',
      },
    ];

    renderStoreCatalog(addons, 'curseforge');

    const card = document.querySelector('.store-addon-card') as HTMLDivElement;
    expect(card).not.toBeNull();
    expect(card.innerHTML).toContain('Questie');

    // Click checkbox to select
    const cb = card.querySelector('.store-addon-checkbox') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));
    expect(selectedAddons.has('cf-101')).toBe(true);

    // Uncheck checkbox to deselect
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));
    expect(selectedAddons.has('cf-101')).toBe(false);

    // Click card to open details
    setSelectedDetailAddon(addons[0]);
    setSelectedDetailAddonKey('cf-101');
    card.click();
    expect(card.classList.contains('border-sky-500')).toBe(true);
  });

  it('loadAddonDetails fetches and displays CurseForge addon info and handles selection toggling', async () => {
    const mockAddon: any = {
      modId: 202,
      title: 'Questie',
      name: 'Questie',
      description: 'Helper',
    };

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [
            {
              id: 20201,
              displayName: 'v1.0',
              fileName: 'file.zip',
              downloadUrl: 'http://dl.com/file.zip',
              gameVersions: ['3.3.5a'],
              hashes: [{ algo: 1, value: 'sha1val' }],
            },
          ],
        });
      }
      if (cmd === 'get_curseforge_mod_description') {
        return Promise.resolve('<p>Description</p>');
      }
      return Promise.resolve();
    });

    const loadPromise = loadAddonDetails(mockAddon, 'cf-202');
    await loadPromise;

    const details = document.getElementById('storeDetailsContent') as HTMLDivElement;
    expect(details.innerHTML).toContain('Questie');
    expect(details.innerHTML).toContain('Description');

    const selectBtn = document.getElementById('detailSelectBtn') as HTMLButtonElement;
    expect(selectBtn.textContent?.trim()).toBe('Download');

    // Click to select
    selectBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(selectedAddons.has('cf-202')).toBe(true);
    expect(selectBtn.textContent?.trim()).toBe('Queued');

    // Add card to DOM before deselecting
    const card = document.createElement('div');
    card.className = 'store-addon-card selected';
    card.setAttribute('data-key', 'cf-202');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'store-addon-checkbox';
    cb.checked = true;
    card.appendChild(cb);
    document.body.appendChild(card);

    // Click to deselect
    selectBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(selectedAddons.has('cf-202')).toBe(false);
    expect(selectBtn.textContent?.trim()).toBe('Download');
    expect(card.classList.contains('selected')).toBe(false);
    expect(cb.checked).toBe(false);

    card.remove();
  });

  it('loadAddonDetails supports WotLK vs Classic versions', async () => {
    const mockAddon: any = {
      modId: 202,
      title: 'Questie',
      name: 'Questie',
      description: 'Helper',
    };

    setDetectedGameVersion('1.12.1');

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [
            {
              id: 20201,
              displayName: 'v1.0',
              fileName: 'file.zip',
              downloadUrl: '',
              gameVersions: ['1.12.1'],
            },
          ],
        });
      }
      if (cmd === 'get_curseforge_mod_description') {
        return Promise.resolve('<p>Description</p>');
      }
      return Promise.resolve();
    });

    await loadAddonDetails(mockAddon, 'cf-202');
    const select = document.getElementById('detailVersionSelect') as HTMLSelectElement;
    expect(select.options.length).toBe(1);
    expect(select.value).toContain('https://edge.forgecdn.net/files/20/201/file.zip');
  });

  it('loadAddonDetails version select change updates selection details version if already selected', async () => {
    const mockAddon: any = {
      modId: 202,
      title: 'Questie',
      name: 'Questie',
      description: 'Helper',
    };

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [
            {
              id: 20201,
              displayName: 'v1.0',
              fileName: 'file.zip',
              downloadUrl: 'http://dl.com/file.zip',
              gameVersions: ['3.3.5a'],
            },
            {
              id: 20202,
              displayName: 'v2.0',
              fileName: 'file2.zip',
              downloadUrl: 'http://dl.com/file2.zip',
              gameVersions: ['3.3.5a'],
            },
          ],
        });
      }
      return Promise.resolve();
    });

    selectedAddons.set('cf-202', {
      addon: mockAddon,
      selectedVersion: { id: 20201, downloadUrl: 'http://dl.com/file.zip' } as any,
    });

    await loadAddonDetails(mockAddon, 'cf-202');

    const select = document.getElementById('detailVersionSelect') as HTMLSelectElement;
    expect(select.options.length).toBe(2);

    select.value = 'http://dl.com/file2.zip';
    select.dispatchEvent(new Event('change'));

    expect(selectedAddons.get('cf-202')?.selectedVersion.id).toBe(20202);
  });

  it('loadAddonDetails handles github repository details loading and readme failure', async () => {
    const mockAddon: any = {
      modId: 999,
      title: 'Repo',
      name: 'owner/repo',
      description: 'GitHub addon',
    };
    setCurrentActiveSite('github');

    const oldFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    try {
      await loadAddonDetails(mockAddon, 'gh-999');
      const details = document.getElementById('storeDetailsContent');
      expect(details?.innerHTML).toContain('No description available');
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it('loadAddonDetails selectBtn click fallback branch when targetVersion not found or selectAddonForDownload errors', async () => {
    const mockAddon: any = {
      modId: 202,
      title: 'Questie',
      name: 'Questie',
    };

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [
            {
              id: 20201,
              displayName: 'v1.0',
              fileName: 'file.zip',
              downloadUrl: 'http://dl.com/file.zip',
              gameVersions: ['3.3.5a'],
            },
          ],
        });
      }
      return Promise.resolve();
    });

    await loadAddonDetails(mockAddon, 'cf-202');

    // Clear detail versions to force targetVersion undefined
    setCurrentDetailVersions([]);

    const selectBtn = document.getElementById('detailSelectBtn') as HTMLButtonElement;
    selectBtn.click();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('renderStoreCatalog checkbox change triggers selection button update if currently viewed', async () => {
    const addons: any[] = [{ modId: 101, title: 'Questie', name: 'Questie', description: 'Desc' }];
    setSelectedDetailAddon(addons[0]);
    setSelectedDetailAddonKey('cf-101');

    const details = document.getElementById('storeDetailsContent') as HTMLDivElement;
    details.innerHTML = '<button id="detailSelectBtn"></button>';

    renderStoreCatalog(addons, 'curseforge');
    const card = document.querySelector('.store-addon-card') as HTMLDivElement;
    const cb = card.querySelector('.store-addon-checkbox') as HTMLInputElement;

    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));

    const btn = document.getElementById('detailSelectBtn') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe('Queued');

    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.textContent?.trim()).toBe('Download');
  });

  it('loadAddonDetails load failure catch block test', async () => {
    const mockAddon: any = { modId: 202, title: 'Questie', name: 'Questie' };
    (invoke as any).mockImplementation(() => Promise.reject('Network Error'));

    await loadAddonDetails(mockAddon, 'cf-202');
    const details = document.getElementById('storeDetailsContent');
    expect(details?.innerHTML).toContain('Failed to load details: Network Error');
  });

  it('loadAddonDetails returns immediately if storeDetailsContent is missing', async () => {
    document.body.innerHTML = '';
    const mockAddon: any = { modId: 202, title: 'Questie', name: 'Questie' };
    const res = await loadAddonDetails(mockAddon, 'cf-202');
    expect(res).toBeUndefined();
  });

  it('loadAddonDetails handles github repository readme scenarios and website/issues/source URLs', async () => {
    const mockAddon: any = {
      modId: 999,
      title: 'Repo',
      name: 'owner/repo',
      description: 'GitHub addon',
      websiteUrl: 'http://website.com',
      issuesUrl: 'http://issues.com',
      sourceUrl: 'http://source.com',
    };
    setCurrentActiveSite('github');

    // 1. ok response
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('This is a readme description.'),
    });

    await loadAddonDetails(mockAddon, 'gh-999');
    let details = document.getElementById('storeDetailsContent');
    expect(details?.innerHTML).toContain('This is a readme description.');
    expect(details?.innerHTML).toContain('http://website.com');
    expect(details?.innerHTML).toContain('http://issues.com');
    expect(details?.innerHTML).toContain('http://source.com');

    // 2. non-ok response
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve(''),
    });

    await loadAddonDetails(mockAddon, 'gh-999');
    details = document.getElementById('storeDetailsContent');
    expect(details?.innerHTML).toContain('No description available');
  });

  it('loadAddonDetails filters out CurseForge files with missing gameVersions or downloadUrl', async () => {
    const mockAddon: any = {
      modId: 202,
      title: 'Questie',
      name: 'Questie',
    };

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [
            {
              id: 20201,
              displayName: 'v1.0',
              fileName: 'file.zip',
              downloadUrl: 'http://dl.com/file.zip',
              // missing gameVersions
            },
            {
              id: 20202,
              displayName: 'v2.0',
              // missing downloadUrl and fileName
              gameVersions: ['3.3.5a'],
            },
            {
              id: 20203,
              displayName: 'v3.0',
              fileName: 'file.zip',
              downloadUrl: 'http://dl.com/file.zip',
              gameVersions: ['3.3.5a'],
            },
          ],
        });
      }
      return Promise.resolve();
    });

    await loadAddonDetails(mockAddon, 'cf-202');
    const select = document.getElementById('detailVersionSelect') as HTMLSelectElement;
    expect(select.options.length).toBe(1);
  });

  it('loadAddonDetails matches other game versions like 3.3.5, 3.4.x, and handles fallbacks for displayName/fileName', async () => {
    const mockAddon: any = {
      modId: 202,
      title: 'Questie',
      name: 'Questie',
      donationUrl: 'http://donate.com',
    };
    setDetectedGameVersion('3.3.5a');

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [
            {
              id: 20201,
              fileName: 'file.zip',
              downloadUrl: 'http://dl.com/file.zip',
              gameVersions: ['3.3.5'],
              releaseType: 2,
            },
            {
              id: 20202,
              displayName: 'v2',
              fileName: 'file.zip',
              downloadUrl: 'http://dl.com/file.zip',
              gameVersions: ['3.4.2'],
              hashes: [{ algo: 2, value: 'other' }], // no algo 1
            },
            {
              id: 20204,
              downloadUrl: 'http://dl.com/file.zip',
              gameVersions: ['3.3.5a'],
              // missing displayName and fileName to trigger Unknown Version
            },
          ],
        });
      }
      return Promise.resolve();
    });

    await loadAddonDetails(mockAddon, 'cf-202');
    const select = document.getElementById('detailVersionSelect') as HTMLSelectElement;
    expect(select.options.length).toBe(3);
    const details = document.getElementById('storeDetailsContent');
    expect(details?.innerHTML).toContain('Unknown Version');
    expect(details?.innerHTML).toContain('http://donate.com');
  });

  it('renderStoreCatalog handles missing listContainer, checked card rendering, details rendering, and missing modId', () => {
    // 1. missing container
    document.body.innerHTML = '';
    renderStoreCatalog([], 'curseforge'); // should return

    // Re-populate
    document.body.innerHTML = `
      <div id="storeListContainer"></div>
      <div id="storeListEmpty" class="hidden">No Addons</div>
    `;

    const addons: any[] = [
      {
        modId: 101,
        title: 'Questie',
        name: 'Questie',
        description: 'Quest helper',
        logoUrl: '',
      },
      {
        modId: null, // missing modId
        title: 'MockAddon',
        name: 'MockAddon',
        description: 'Mock desc',
      },
    ];

    // Mark 101 as checked
    selectedAddons.set('cf-101', {} as any);
    // Mark 101 as selected detail addon
    setSelectedDetailAddon(addons[0]);

    renderStoreCatalog(addons, 'curseforge');
    const container = document.getElementById('storeListContainer');
    expect(container?.innerHTML).toContain('Questie');
    expect(container?.innerHTML).toContain('MockAddon');
  });

  it('covers remaining catalog branches', async () => {
    // 1. github site with addon name without slash
    setCurrentActiveSite('github');
    const mockGithubAddon: any = {
      modId: 999,
      title: 'GitAddonTitle',
      name: 'GitAddonNoSlash',
      description: 'Git desc',
      issuesUrl: 'http://issues.com',
    };
    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/releases'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      if (url.includes('/readme'))
        return Promise.resolve({ ok: true, text: () => Promise.resolve('Readme Html content') });
      return Promise.resolve({ ok: false });
    });
    vi.stubGlobal('fetch', mockFetch);

    await loadAddonDetails(mockGithubAddon, 'gh-GitAddonNoSlash');

    // 2. CurseForge filesRes.data is null/undefined
    setCurrentActiveSite('curseforge');
    const mockCFAddon: any = {
      modId: 303,
      title: 'CFAddon',
      name: 'CFAddon',
      sourceUrl: 'http://github.com/source',
    };
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') return Promise.resolve({});
      if (cmd === 'get_curseforge_mod_description') return Promise.resolve('Desc text');
      return Promise.resolve();
    });
    await loadAddonDetails(mockCFAddon, 'cf-303');
    const select = document.getElementById('detailVersionSelect') as HTMLSelectElement;
    expect(select.options[0].textContent).toContain(getTranslation('store.noVersions'));

    // 3. game versions filtering when gameVersion is 1.12.1
    setDetectedGameVersion('1.12.1');
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [
            {
              id: 30301,
              displayName: 'v1.0',
              fileName: 'file.zip',
              downloadUrl: 'http://dl.com/file.zip',
              gameVersions: ['1.12'],
            },
            {
              id: 30302,
              displayName: 'v1.1',
              fileName: 'file.zip',
              gameVersions: ['1.12.1'],
            },
          ],
        });
      }
      if (cmd === 'get_curseforge_mod_description') return Promise.resolve('Desc');
      return Promise.resolve();
    });
    await loadAddonDetails(mockCFAddon, 'cf-303');
    const select2 = document.getElementById('detailVersionSelect') as HTMLSelectElement;
    expect(select2.options.length).toBe(2);

    // 4. select details version change event with empty value
    const versionSelect = document.getElementById('detailVersionSelect') as HTMLSelectElement;
    selectedAddons.set('cf-303', { addon: mockCFAddon, selectedVersion: { id: 30301 } as any });
    versionSelect.value = '';
    versionSelect.dispatchEvent(new Event('change'));

    // 5. select details btn click when checkbox card has NO cb element
    document.body.innerHTML = `
      <div id="storeDetailsContent">
        <select id="detailVersionSelect"><option value=""></option></select>
        <button id="detailSelectBtn"></button>
      </div>
      <div class="store-addon-card selected" data-key="cf-303"></div> <!-- No cb checkbox -->
    `;
    // Re-setup loadAddonDetails listeners manually by loading details
    await loadAddonDetails(mockCFAddon, 'cf-303');
    const selectBtn = document.getElementById('detailSelectBtn') as HTMLElement;
    selectedAddons.set('cf-303', {
      addon: mockCFAddon,
      selectedVersion: { id: 30301, downloadUrl: 'http://dl.com/file.zip' } as any,
    });
    updateDetailsSelectionButton();
    selectBtn.click();
    await Promise.resolve();
    expect(selectedAddons.has('cf-303')).toBe(false);

    // 5b. select details btn click to deselect when card is completely missing from DOM
    selectedAddons.set('cf-303', {
      addon: mockCFAddon,
      selectedVersion: { id: 30301, downloadUrl: 'http://dl.com/file.zip' } as any,
    });
    updateDetailsSelectionButton();
    document.querySelector('.store-addon-card')?.remove();
    selectBtn.click();
    await Promise.resolve();
    expect(selectedAddons.has('cf-303')).toBe(false);

    // 6. select details btn click to select (targetVersion falsy) when versionSelect is missing
    selectedAddons.clear();
    document.body.innerHTML = `
      <div id="storeDetailsContent">
        <button id="detailSelectBtn"></button>
      </div>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [{ id: 30301, downloadUrl: 'http://dl.com/file.zip', gameVersions: ['1.12.1'] }],
        });
      }
      return Promise.resolve();
    });
    await loadAddonDetails(mockCFAddon, 'cf-303');
    // Remove versionSelect from DOM
    document.getElementById('detailVersionSelect')?.remove();
    const selectBtn2 = document.getElementById('detailSelectBtn') as HTMLElement;
    selectBtn2.click();
    await Promise.resolve();
    expect(selectedAddons.has('cf-303')).toBe(true);

    // 6b. select details btn click to select when versionSelect is missing but updatedItem becomes falsy
    selectedAddons.clear();
    await loadAddonDetails(mockCFAddon, 'cf-303');
    document.getElementById('detailVersionSelect')?.remove();
    const selectBtn2b = document.getElementById('detailSelectBtn') as HTMLElement;
    setTimeout(() => {
      selectedAddons.clear();
    }, 0);
    selectBtn2b.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(selectedAddons.has('cf-303')).toBe(false);

    // 10. select details btn click when targetVersion is undefined, but versionSelect is present
    selectedAddons.clear();
    document.body.innerHTML = `
      <div id="storeDetailsContent">
        <select id="detailVersionSelect"><option value="" selected></option></select>
        <button id="detailSelectBtn"></button>
      </div>
    `;
    await loadAddonDetails(mockCFAddon, 'cf-303');
    const versionSelect3 = document.getElementById('detailVersionSelect') as HTMLSelectElement;
    versionSelect3.value = '';
    const selectBtn3 = document.getElementById('detailSelectBtn') as HTMLElement;
    selectBtn3.click();
    await Promise.resolve();
    expect(selectedAddons.has('cf-303')).toBe(true);

    // Additional branches:
    // a. 1.12.2 game version filtering
    setDetectedGameVersion('1.12.1');
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [
            {
              id: 30303,
              displayName: 'v1.2',
              fileName: 'file.zip',
              gameVersions: ['1.12.2'],
            },
          ],
        });
      }
      return Promise.resolve();
    });
    await loadAddonDetails(mockCFAddon, 'cf-303');

    // b. versionSelect change when selectedAddons doesn't have key but targetVersion is found
    selectedAddons.delete('cf-303');
    const selectChangeEl = document.getElementById('detailVersionSelect') as HTMLSelectElement;
    if (selectChangeEl) {
      selectChangeEl.value = 'https://edge.forgecdn.net/files/30/303/file.zip';
      selectChangeEl.dispatchEvent(new Event('change'));
    }

    // c. versionSelect change when targetVersion is not found
    selectedAddons.set('cf-303', { addon: mockCFAddon, selectedVersion: { id: 30301 } as any });
    if (selectChangeEl) {
      selectChangeEl.value = 'non-existent-url';
      selectChangeEl.dispatchEvent(new Event('change'));
    }

    // d. selectBtn click when targetVersion is not found AND selectAddonForDownload does NOT add item (updatedItem is falsy)
    selectedAddons.clear();
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({ data: [] }); // return empty to prevent selection
      }
      return Promise.resolve();
    });
    await loadAddonDetails(mockCFAddon, 'cf-303');
    const selectBtn4 = document.getElementById('detailSelectBtn') as HTMLElement;
    selectBtn4.click();
    await Promise.resolve();
    expect(selectedAddons.has('cf-303')).toBe(false);

    // 7. renderStoreCatalog on GitHub site, and when selected details addon matches or partially mismatches
    document.body.innerHTML = `
      <div id="storeListContainer"></div>
      <div id="storeListEmpty" class="hidden">No Addons</div>
    `;
    setCurrentActiveSite('github');
    setSelectedDetailAddon({ modId: 999, name: 'GitAddonNoSlash' } as any);
    renderStoreCatalog([mockGithubAddon], 'github');

    // mismatch modId
    setSelectedDetailAddon({ modId: 888, name: 'GitAddonNoSlash' } as any);
    renderStoreCatalog([mockGithubAddon], 'github');

    // mismatch name
    setSelectedDetailAddon({ modId: 999, name: 'OtherName' } as any);
    renderStoreCatalog([mockGithubAddon], 'github');

    // fallback when fileName is missing in downloadUrl logic
    document.body.innerHTML = `
      <div id="storeListContainer"></div>
      <div id="storeListEmpty" class="hidden">No Addons</div>
      <div id="storeDetailsContent"></div>
    `;
    setCurrentActiveSite('curseforge');
    setDetectedGameVersion('1.12.1');
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [
            {
              id: 50505,
              downloadUrl: '',
              fileName: 'file.zip',
              gameVersions: ['1.12.1'],
            },
          ],
        });
      }
      if (cmd === 'get_curseforge_mod_description') {
        return Promise.resolve('Desc');
      }
      return Promise.resolve();
    });
    await loadAddonDetails(mockCFAddon, 'cf-303');
    const select3 = document.getElementById('detailVersionSelect') as HTMLSelectElement;
    expect(select3.value).toContain('https://edge.forgecdn.net/files/50/505/file.zip');

    vi.unstubAllGlobals();
  });

  it('isAddonInstalled correctly matches installed addons for curseforge and github', () => {
    // 1. CurseForge match by modId
    setInstalledAddonsMeta([{ name: 'Questie', folderName: 'Questie', modId: 101, gitUrl: '' }]);
    setCurrentActiveSite('curseforge');
    expect(isAddonInstalled({ modId: 101, title: 'Questie', name: 'Questie' } as any)).toBe(true);

    // 2. GitHub match by gitUrl
    setInstalledAddonsMeta([{ name: 'QuestieRepo', folderName: 'Questie', modId: 0, gitUrl: 'https://github.com/Questie/QuestieRepo.git' }]);
    setCurrentActiveSite('github');
    expect(isAddonInstalled({ modId: 0, title: 'QuestieRepo', name: 'Questie/QuestieRepo' } as any)).toBe(true);

    // 3. Fallback name match
    setInstalledAddonsMeta([{ name: 'QuestieTitle', folderName: 'Questie', modId: 0, gitUrl: '' }]);
    setCurrentActiveSite('curseforge');
    expect(isAddonInstalled({ modId: 999, title: 'QuestieTitle', name: 'Questie' } as any)).toBe(true);
  });

  it('renderStoreCatalog disables checkbox and renders Installed badge for installed addons', () => {
    setInstalledAddonsMeta([{ name: 'Questie', folderName: 'Questie', modId: 101, gitUrl: '' }]);
    setCurrentActiveSite('curseforge');

    const addons: any[] = [
      {
        modId: 101,
        title: 'Questie',
        name: 'Questie',
        description: 'Quest helper',
        logoUrl: '',
      },
    ];

    renderStoreCatalog(addons, 'curseforge');

    const card = document.querySelector('.store-addon-card') as HTMLDivElement;
    expect(card).not.toBeNull();
    expect(card.innerHTML).toContain('Questie');
    expect(card.innerHTML).toContain('Installed');
    
    const cb = card.querySelector('.store-addon-checkbox') as HTMLInputElement;
    expect(cb.disabled).toBe(true);
  });

  it('loadAddonDetails disables selection button and shows Installed for installed addons', async () => {
    setInstalledAddonsMeta([{ name: 'Questie', folderName: 'Questie', modId: 202, gitUrl: '' }]);
    setCurrentActiveSite('curseforge');

    const mockAddon: any = {
      modId: 202,
      title: 'Questie',
      name: 'Questie',
      description: 'Helper',
    };

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod_files') {
        return Promise.resolve({
          data: [
            {
              id: 20201,
              displayName: 'v1.0',
              fileName: 'file.zip',
              downloadUrl: 'http://dl.com/file.zip',
              gameVersions: ['3.3.5a'],
            },
          ],
        });
      }
      if (cmd === 'get_curseforge_mod_description') {
        return Promise.resolve('<p>Description</p>');
      }
      return Promise.resolve();
    });

    await loadAddonDetails(mockAddon, 'cf-202');

    const selectBtn = document.getElementById('detailSelectBtn') as HTMLButtonElement;
    expect(selectBtn.disabled).toBe(true);
    expect(selectBtn.textContent?.trim()).toBe('Installed');
  });
});
