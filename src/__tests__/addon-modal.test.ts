import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { showAddonModal } from '../ui/addon-modal';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../state', async () => {
  const actual = await vi.importActual<typeof import('../state')>('../state');
  return {
    ...actual,
    getInstalledAddonsMeta: vi.fn(() => []),
    getCurrentActiveSite: vi.fn(() => 'curseforge'),
  };
});

import { getInstalledAddonsMeta } from '../state';

describe('Addon Modal UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders modal with dependencies and readme, handles interactions', async () => {
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
    `;

    const meta = {
      name: 'TestAddon',
      title: 'Test Addon Title',
      author: 'TestAuthor',
      version: '1.0',
      path: '/mock/wow/Interface/AddOns/TestAddon',
      optional_deps: ['DepA', 'DepB'],
      optional_deps_installed: [true, false],
      readme: '# Readme Content',
      hasGit: false,
    };

    showAddonModal(meta);

    // Verify rendered content
    const heading = document.querySelector('h3');
    expect(heading?.textContent).toContain('Test Addon Title');
    expect(document.body.innerHTML).toContain('DepA');
    expect(document.body.innerHTML).toContain('DepB');
    expect(document.body.innerHTML).toContain('Readme Content');

    // Click backdrop (overlay)
    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    expect(overlay).not.toBeNull();

    // Click open folder
    const openBtn = overlay.querySelector('#modal-open-folder') as HTMLElement;
    (invoke as any).mockImplementationOnce(() => Promise.resolve());
    openBtn.click();
    expect(invoke).toHaveBeenCalledWith('open_addon_folder', {
      basePath: '/mock/wow',
      addonName: 'TestAddon',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById('status')?.textContent).toBe('Opened folder: TestAddon');

    // Open folder failure
    (invoke as any).mockImplementationOnce(() => Promise.reject('Open error'));
    openBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById('status')?.textContent).toBe('Error: Open error');

    // Click close button
    const closeBtn = overlay.querySelector('#modal-close') as HTMLElement;
    closeBtn.click();
    expect(document.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('closes modal when backdrop (overlay) is clicked directly', () => {
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
    `;
    const meta = {
      name: 'TestAddon',
      title: 'Test Addon Title',
      author: null,
      version: null,
      hasGit: false,
    };
    showAddonModal(meta);
    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    overlay.click();
    expect(document.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('exits early on folder open if gamePath input is missing', async () => {
    document.body.innerHTML = '';
    const meta = {
      name: 'TestAddon',
      title: 'Test Addon Title',
      author: null,
      version: null,
      hasGit: false,
    };
    showAddonModal(meta);
    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    const openBtn = overlay.querySelector('#modal-open-folder') as HTMLElement;
    openBtn.click();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('covers missing statusFooter and title fallback branch', async () => {
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
    `; // status is missing

    const meta = {
      name: 'TestAddonName',
      title: '', // missing title to test fallback
      author: null,
      version: null,
      hasGit: false,
    };

    showAddonModal(meta);
    const heading = document.querySelector('h3');
    expect(heading?.textContent).toContain('TestAddonName'); // fallback name used

    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    const openBtn = overlay.querySelector('#modal-open-folder') as HTMLElement;

    // 1. success without statusFooter
    (invoke as any).mockResolvedValueOnce(undefined);
    openBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 2. failure without statusFooter
    (invoke as any).mockRejectedValueOnce('Open error');
    openBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('adds a CurseForge link button when the installed addon has a modId', async () => {
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
    `;
    (getInstalledAddonsMeta as any).mockReturnValueOnce([{ name: 'TestAddon', modId: 123 }]);
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_curseforge_mod') {
        return Promise.resolve({ data: { links: { websiteUrl: 'https://curseforge.test/mod' } } });
      }
      return Promise.resolve();
    });

    showAddonModal({
      name: 'TestAddon',
      title: 'Test Addon',
      author: null,
      version: null,
      hasGit: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invoke).toHaveBeenCalledWith('get_curseforge_mod', { modId: 123, isMock: false });
    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    expect(overlay.querySelectorAll('#modal-header-buttons button').length).toBe(3);
  });

  it('adds no CurseForge link button when the lookup fails or returns no url', async () => {
    document.body.innerHTML = `
      <input id="gamePath" value="/mock/wow" />
    `;
    (getInstalledAddonsMeta as any).mockReturnValueOnce([{ name: 'TestAddon', modId: 123 }]);
    (invoke as any).mockImplementationOnce(() => Promise.reject('lookup failed'));

    showAddonModal({
      name: 'TestAddon',
      title: 'Test Addon',
      author: null,
      version: null,
      hasGit: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    expect(overlay.querySelectorAll('#modal-header-buttons button').length).toBe(2);
  });
});
