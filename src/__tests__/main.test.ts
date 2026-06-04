import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { loadSavedSettings } from './../ui/settings';
import { loadAddonsAndPatches } from './../tabs/addons';
import { loadConfig } from './../tabs/tweaks';
import { Prefs } from './../prefs';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => {
  const listeners: Record<string, (...args: any[]) => any> = {};
  return {
    listen: vi.fn().mockImplementation((event: string, callback: (...args: any[]) => any) => {
      listeners[event] = callback;
      return Promise.resolve(() => {});
    }),
    _trigger: (event: string, data?: any) => {
      if (listeners[event]) listeners[event](data);
    },
  };
});

vi.mock('./../ui/settings', () => ({
  setupSettingsEvents: vi.fn(),
  loadSavedSettings: vi.fn().mockImplementation(() => Promise.resolve()),
  checkLauncherUpdates: vi.fn(),
}));

vi.mock('./../store', () => ({
  setupStoreEvents: vi.fn(),
}));

vi.mock('./../ui/search', () => ({
  setupMainSearchEvents: vi.fn(),
  setupSearchHoverBehavior: vi.fn(),
}));

vi.mock('./../ui/import', () => ({
  setupImportModalEvents: vi.fn(),
}));

vi.mock('./../ui/import-export', () => ({
  setupImportExportEvents: vi.fn(),
}));

vi.mock('./../ui/git-status', () => ({
  setupGitStatusEvents: vi.fn(),
}));

vi.mock('./../tabs/addons', () => ({
  loadAddonsAndPatches: vi.fn().mockImplementation(() => Promise.resolve()),
  setupAddonProfileEvents: vi.fn(),
}));

vi.mock('./../tabs/tweaks', () => ({
  loadConfig: vi.fn().mockImplementation(() => Promise.resolve()),
}));

vi.mock('./../ui/debug-console', () => ({
  setupDebugConsoleEvents: vi.fn(),
}));

describe('Main Application Entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Populate required elements in the DOM before importing
    document.body.innerHTML = `
      <div class="nav-tab active" data-tab="addons">Addons Tab Button</div>
      <div class="nav-tab" data-tab="tweaks">Tweaks Tab Button</div>
      <div class="tab-content" id="addons-tab">Addons Tab Content</div>
      <div class="tab-content hidden" id="tweaks-tab">Tweaks Tab Content</div>
      <button id="playBtn">Play</button>
      <button id="minimizeBtn">Min</button>
      <button id="windowCloseBtn">Close</button>
      <input id="gamePath" value="/mock/wow" />
      <input type="checkbox" id="stayOpen" />
      <div id="status"></div>
      <div id="activityProgress" style="width: 0%;"></div>
      <button id="openModsFolder" class="hidden">Open Mods</button>
      <button id="langBtn">Lang</button>
      <div id="langDropdown" class="hidden">
        <button class="lang-option" data-lang="en">EN</button>
        <button class="lang-option" data-lang="es">ES</button>
      </div>
      <button id="themeToggleBtn">Theme</button>
      <button id="updateAvailableBtn" class="hidden">Update</button>
      <div class="titlebar">Title</div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('runs startup routines and setups event listeners', async () => {
    // Import main to trigger top-level registration
    const mainMod = await import('../main');

    // Verify startup settings call and translateDOM export
    expect(loadSavedSettings).toHaveBeenCalled();
    expect(mainMod.translateDOM).toBeDefined();

    // Verify tab switching
    const tweaksTabBtn = document.querySelector('.nav-tab[data-tab="tweaks"]') as HTMLElement;
    tweaksTabBtn.click();
    await Promise.resolve();

    expect(tweaksTabBtn.classList.contains('active')).toBe(true);
    expect(loadConfig).toHaveBeenCalled();

    // Verify play button triggers launch_game
    const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'launch_game') return Promise.resolve();
      return Promise.resolve();
    });

    playBtn.click();
    expect(invoke).toHaveBeenCalledWith('launch_game', {
      basePath: '/mock/wow',
      stayOpen: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Game finished with stayOpen = false -> closes window
    expect(invoke).toHaveBeenCalledWith('close_window');

    // Minimize window
    const minimizeBtn = document.getElementById('minimizeBtn') as HTMLElement;
    minimizeBtn.click();
    expect(invoke).toHaveBeenCalledWith('minimize_window');

    // Close window
    const closeBtn = document.getElementById('windowCloseBtn') as HTMLElement;
    closeBtn.click();
    expect(invoke).toHaveBeenCalledWith('close_window');

    // Double click titlebar (no ops but listener covered)
    const titlebar = document.querySelector('.titlebar') as HTMLElement;
    titlebar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    // Open mods folder
    const openModsBtn = document.getElementById('openModsFolder') as HTMLElement;
    openModsBtn.click();
    expect(invoke).toHaveBeenCalledWith('open_folder', {
      basePath: '/mock/wow',
      relPath: 'Data',
    });

    // Theme toggling
    const themeBtn = document.getElementById('themeToggleBtn') as HTMLElement;
    themeBtn.click();
    expect(document.body.classList.contains('light-mode')).toBe(true);
    expect(Prefs.getTheme()).toBe('light');

    // Lang button click toggles dropdown
    const langBtn = document.getElementById('langBtn') as HTMLElement;
    const langDropdown = document.getElementById('langDropdown') as HTMLElement;
    langBtn.click();
    expect(langDropdown.classList.contains('hidden')).toBe(false);

    // Switch active tab back to addons to cover line 160
    const addonsTabBtn = document.querySelector('.nav-tab[data-tab="addons"]') as HTMLElement;
    addonsTabBtn.click();
    await Promise.resolve();

    // Lang option selection (addons tab active)
    const esOption = document.querySelector('.lang-option[data-lang="es"]') as HTMLElement;
    esOption.click();
    expect(langDropdown.classList.contains('hidden')).toBe(true);

    // Switch active tab to tweaks and select language again to cover line 162
    const tweaksTabBtn2 = document.querySelector('.nav-tab[data-tab="tweaks"]') as HTMLElement;
    tweaksTabBtn2.click();
    await Promise.resolve();
    langBtn.click();
    esOption.click();
    expect(langDropdown.classList.contains('hidden')).toBe(true);

    // Tauri Event trigger: update-available
    const eventMod = await import('@tauri-apps/api/event');
    (eventMod as any)._trigger('update-available');
    const updateAvailableBtn = document.getElementById('updateAvailableBtn') as HTMLElement;
    expect(updateAvailableBtn.classList.contains('hidden')).toBe(false);

    // Install update click
    updateAvailableBtn.click();
    expect(invoke).toHaveBeenCalledWith('install_update');

    // --- Error and Fallback Paths ---
    // 1. Minimize fail
    (invoke as any).mockImplementationOnce(() => Promise.reject('Min fail'));
    minimizeBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 2. Close fail
    (invoke as any).mockImplementationOnce(() => Promise.reject('Close fail'));
    closeBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 3. Play game launch fail
    (invoke as any).mockImplementationOnce(() => Promise.reject('Launch fail'));
    playBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const statusFooter = document.getElementById('status') as HTMLElement;
    expect(statusFooter.textContent).toContain('Error: Launch fail');

    // 4. Open mods folder folder open fail
    (invoke as any).mockImplementationOnce(() => Promise.reject('Open folder fail'));
    openModsBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(statusFooter.textContent).toContain('Error: Open folder fail');

    // 5. Update fail
    (invoke as any).mockImplementationOnce(() => Promise.reject('Update install fail'));
    updateAvailableBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(statusFooter.textContent).toContain('Update error: Update install fail');

    // 6. Navigation tabs addon click
    addonsTabBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(loadAddonsAndPatches).toHaveBeenCalled();
  });

  it('handles startup with light mode theme', async () => {
    vi.resetModules();
    Prefs.setTheme('light');

    // Re-populate required elements for the new module execution instance
    document.body.innerHTML = `
      <div class="nav-tab active" data-tab="addons">Addons</div>
      <div class="tab-content" id="addons-tab">Addons Content</div>
      <button id="playBtn">Play</button>
      <input id="gamePath" value="/mock/wow" />
      <input type="checkbox" id="stayOpen" />
      <div id="status">Status</div>
      <button id="themeToggleBtn">Theme</button>
    `;

    await import('../main');
    expect(document.body.classList.contains('light-mode')).toBe(true);
  });

  it('covers main.ts branches with empty DOM elements during module import', async () => {
    vi.resetModules();
    // 1. Omit activeTab but include statusFooter to cover line 179 falsy branch
    document.body.innerHTML = `
      <div id="status"></div>
    `;
    await import('../main');
    await new Promise((resolve) => setTimeout(resolve, 20));

    // trigger update-available event when updateAvailableBtn is missing
    const eventMod = await import('@tauri-apps/api/event');
    (eventMod as any)._trigger('update-available');

    // 2. Omit statusFooter but include updateAvailableBtn to cover line 193/196 falsy branches
    vi.resetModules();
    document.body.innerHTML = `
      <button id="updateAvailableBtn"></button>
    `;
    await import('../main');
    const updateAvailableBtn = document.getElementById('updateAvailableBtn') as HTMLElement;

    // success path
    (invoke as any).mockResolvedValueOnce(undefined);
    updateAvailableBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // failure path
    (invoke as any).mockRejectedValueOnce('Fail');
    updateAvailableBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('covers main.ts play button with stayOpen checked, real Error objects, double theme click, missing active tab and missing language attributes', async () => {
    vi.resetModules();
    Prefs.setTheme('dark');
    document.body.innerHTML = `
      <button id="playBtn">Play</button>
      <input id="gamePath" value="/mock/wow" />
      <input type="checkbox" id="stayOpen" checked />
      <div id="status">Ready</div>
      <div id="activityProgress" style="width: 0%;"></div>
      <button id="themeToggleBtn">Theme</button>
      <button id="langBtn">Lang</button>
      <div id="langDropdown" class="hidden">
        <button class="lang-option" id="emptyLangBtn"></button>
        <button class="lang-option" data-lang="en">EN</button>
      </div>
      <div class="nav-tab active" data-tab="other"></div>
    `;

    await import('../main');

    const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
    const statusFooter = document.getElementById('status') as HTMLElement;

    // 1. playBtn click with stayOpen = true
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'launch_game') return Promise.resolve();
      return Promise.resolve();
    });
    playBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Should NOT close window
    expect(invoke).not.toHaveBeenCalledWith('close_window');

    // 2. playBtn click with real Error object thrown to cover error instanceof Error
    (invoke as any).mockImplementationOnce(() => Promise.reject(new Error('Real Launch Error')));
    playBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(statusFooter.textContent).toBe('Error: Real Launch Error');

    // 3. toggle theme button twice to cover light -> dark -> light
    const themeBtn = document.getElementById('themeToggleBtn') as HTMLElement;
    themeBtn.click(); // to light-mode
    themeBtn.click(); // back to dark-mode
    expect(Prefs.getTheme()).toBe('dark');

    // 4. click lang-option with missing data-lang attribute
    const emptyLangBtn = document.getElementById('emptyLangBtn') as HTMLElement;
    emptyLangBtn.click();

    // 5. click lang-option with data-lang when activeTab data-tab is "other"
    const enLangBtn = document.querySelector('.lang-option[data-lang="en"]') as HTMLElement;
    enLangBtn.click();

    // 6. click lang-option with data-lang but missing active tab element in DOM
    const tabEl = document.querySelector('.nav-tab.active');
    if (tabEl) tabEl.remove();
    enLangBtn.click();
  });

  it('covers playBtn install/download actions, contextmenu prevention, and browser fallback internals', async () => {
    vi.resetModules();
    document.body.innerHTML = `
      <button id="playBtn" data-action="install">Play</button>
      <div id="installChoiceModal" class="hidden"></div>
      <div id="status"></div>
      <button class="nav-tab" id="disabledTab" data-tab="addons" disabled></button>
      <button class="nav-tab active" id="addonsTab" data-tab="addons"></button>
      <button class="nav-tab" id="tweaksTab" data-tab="tweaks"></button>
      <button class="nav-tab" id="modsTab" data-tab="mods"></button>
      <div id="addons-list"><div>dummy</div></div>
      <div id="patches-list"><div>dummy</div></div>
      <div id="config-tree"><div>dummy</div></div>
      <div id="addons-tab" class="tab-content"></div>
      <div id="mods-tab" class="tab-content hidden"></div>
      <div id="tweaks-tab" class="tab-content hidden"></div>
    `;

    await import('../main');

    // 0. Trigger tab clicks to cover disabled tab, and children checks
    const disabledTab = document.getElementById('disabledTab') as HTMLButtonElement;
    disabledTab.dispatchEvent(new Event('click')); // JSDOM click() might be blocked on disabled but event listener can be forced

    const addonsTab = document.getElementById('addonsTab') as HTMLButtonElement;
    addonsTab.click();

    const tweaksTab = document.getElementById('tweaksTab') as HTMLButtonElement;
    tweaksTab.click();

    const modsTab = document.getElementById('modsTab') as HTMLButtonElement;
    modsTab.click();

    const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
    const installModal = document.getElementById('installChoiceModal') as HTMLElement;

    // 1. playBtn with action="install"
    playBtn.click();
    expect(installModal.classList.contains('hidden')).toBe(false);

    // 2. playBtn with action="download"
    playBtn.setAttribute('data-action', 'download');
    let torrentModalOpened = false;
    const handler = () => {
      torrentModalOpened = true;
    };
    window.addEventListener('open-torrent-modal', handler);
    playBtn.click();
    expect(torrentModalOpened).toBe(true);
    window.removeEventListener('open-torrent-modal', handler);

    // 3. contextmenu prevention
    const contextEvent = new MouseEvent('contextmenu', { cancelable: true });
    document.dispatchEvent(contextEvent);
    expect(contextEvent.defaultPrevented).toBe(true);

    // 4. browser fallback internals
    const win = window as any;
    expect(win.__TAURI_INTERNALS__).toBeDefined();
    expect(win.__TAURI_EVENT_PLUGIN_INTERNALS__).toBeDefined();

    // Call transformCallback
    const callbackId = win.__TAURI_INTERNALS__.transformCallback(() => {});
    expect(callbackId).toBeDefined();
    expect(typeof win[callbackId]).toBe('function');
    win[callbackId](); // execute the callback to cover it

    // Call postMessage
    win.__TAURI_INTERNALS__.postMessage();
    win.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener();

    // Call invoke mock override
    win.__OWL_INVOKE_MOCK__ = vi.fn().mockResolvedValue('mocked_override');
    const overrideRes = await win.__TAURI_INTERNALS__.invoke('some_command');
    expect(overrideRes).toBe('mocked_override');
    win.__OWL_INVOKE_MOCK__ = undefined;

    // Test cases in fallback invoke switch
    await win.__TAURI_INTERNALS__.invoke('load_settings');
    await win.__TAURI_INTERNALS__.invoke('get_addon_profiles');
    await win.__TAURI_INTERNALS__.invoke('get_addons');
    await win.__TAURI_INTERNALS__.invoke('get_patches');

    win.__OWL_MOCK_VALIDATE_GAME_PATH__ = undefined;
    await win.__TAURI_INTERNALS__.invoke('validate_game_path');
    win.__OWL_MOCK_VALIDATE_GAME_PATH__ = false;
    await win.__TAURI_INTERNALS__.invoke('validate_game_path');

    await win.__TAURI_INTERNALS__.invoke('get_active_downloads');
    await win.__TAURI_INTERNALS__.invoke('check_update_details');
    await win.__TAURI_INTERNALS__.invoke('get_app_version');
    await win.__TAURI_INTERNALS__.invoke('git_status');
    await win.__TAURI_INTERNALS__.invoke('read_config');
    await win.__TAURI_INTERNALS__.invoke('parse_toc');
    await win.__TAURI_INTERNALS__.invoke('parse_toc', { addonName: 'Other' });

    // save_addon_profile
    win.__OWL_MOCK_PROFILES__ = undefined;
    await win.__TAURI_INTERNALS__.invoke('save_addon_profile', {
      name: 'New',
      enabledAddons: ['b'],
    });
    win.__OWL_MOCK_PROFILES__ = [{ name: 'Existing', enabledAddons: [] }];
    await win.__TAURI_INTERNALS__.invoke('save_addon_profile', {
      name: 'Existing',
      enabledAddons: ['a'],
    });

    // apply_addon_profile
    await win.__TAURI_INTERNALS__.invoke('apply_addon_profile', { name: 'All Addons' });
    await win.__TAURI_INTERNALS__.invoke('apply_addon_profile', { name: 'Custom' });

    // delete_addon_profile
    await win.__TAURI_INTERNALS__.invoke('delete_addon_profile', { name: 'Custom' });

    // rename_addon_profile
    win.__OWL_MOCK_ACTIVE_PROFILE__ = 'Existing';
    await win.__TAURI_INTERNALS__.invoke('rename_addon_profile', {
      oldName: 'Existing',
      newName: 'Renamed',
    });

    // search_curseforge_addons
    await win.__TAURI_INTERNALS__.invoke('search_curseforge_addons');

    // get_curseforge_mod_files
    await win.__TAURI_INTERNALS__.invoke('get_curseforge_mod_files');

    // get_curseforge_mod_description
    await win.__TAURI_INTERNALS__.invoke('get_curseforge_mod_description');

    // search_github_addons
    await win.__TAURI_INTERNALS__.invoke('search_github_addons');

    // get_github_releases
    await win.__TAURI_INTERNALS__.invoke('get_github_releases');

    // download_curseforge_addon / return null cases
    await win.__TAURI_INTERNALS__.invoke('download_curseforge_addon');

    // confirm_install_bundled / resolve_addon_dependency
    await win.__TAURI_INTERNALS__.invoke('confirm_install_bundled');

    // check_addon_dependencies / check_orphaned_dependencies
    await win.__TAURI_INTERNALS__.invoke('check_addon_dependencies');

    // export_addon_list
    await win.__TAURI_INTERNALS__.invoke('export_addon_list');

    // get_installed_addons_source_meta
    win.__OWL_MOCK_ADDONS__ = ['Questie', 'SomeAddon-disabled'];
    await win.__TAURI_INTERNALS__.invoke('get_installed_addons_source_meta');
    win.__OWL_MOCK_ADDONS__ = undefined;
    await win.__TAURI_INTERNALS__.invoke('get_installed_addons_source_meta');

    // save_addon_profile
    await win.__TAURI_INTERNALS__.invoke('save_addon_profile');
    await win.__TAURI_INTERNALS__.invoke('save_addon_profile', { enabledAddons: undefined });

    // delete_addon_profile
    win.__OWL_MOCK_PROFILES__ = undefined;
    win.__OWL_MOCK_ACTIVE_PROFILE__ = 'some_profile';
    await win.__TAURI_INTERNALS__.invoke('delete_addon_profile', { name: 'other_name' });

    // rename_addon_profile
    await win.__TAURI_INTERNALS__.invoke('rename_addon_profile');
    win.__OWL_MOCK_PROFILES__ = undefined;
    await win.__TAURI_INTERNALS__.invoke('rename_addon_profile', { oldName: 'a', newName: 'b' });
    win.__OWL_MOCK_PROFILES__ = [{ name: 'a', enabledAddons: [] }];
    await win.__TAURI_INTERNALS__.invoke('rename_addon_profile', {
      oldName: 'nonexistent',
      newName: 'b',
    });
    await win.__TAURI_INTERNALS__.invoke('rename_addon_profile', {
      oldName: 'a',
      newName: undefined,
    });

    // validate_import_string
    await win.__TAURI_INTERNALS__.invoke('validate_import_string', { importStr: 'valid' });
    try {
      await win.__TAURI_INTERNALS__.invoke('validate_import_string', { importStr: 'invalid' });
    } catch {
      // expected
    }

    // default case
    await win.__TAURI_INTERNALS__.invoke('unknown_cmd');
  });
});
