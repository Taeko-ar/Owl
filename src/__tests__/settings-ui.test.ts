import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  setLauncherWindowSize,
  setupSettingsEvents,
  loadSavedSettings,
  saveSettings,
} from '../ui/settings';
import { invoke } from '@tauri-apps/api/core';
import { getSettingsBackup, setSettingsBackup } from '../state';
import { loadAddonsAndPatches } from '../main';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../main', () => ({
  loadAddonsAndPatches: vi.fn().mockImplementation(() => Promise.resolve()),
}));

describe('Settings UI Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSettingsBackup(null);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('setLauncherWindowSize invokes set_window_size on correct values', async () => {
    (invoke as any).mockImplementationOnce(() => Promise.resolve());
    await setLauncherWindowSize('1024x768');
    expect(invoke).toHaveBeenCalledWith('set_window_size', { width: 1024, height: 768 });

    // Handles failure gracefully
    (invoke as any).mockImplementationOnce(() => Promise.reject('Invoke error'));
    await setLauncherWindowSize('800x600');
    expect(invoke).toHaveBeenCalledWith('set_window_size', { width: 800, height: 600 });
  });

  it('setupSettingsEvents early exits on missing elements', () => {
    document.body.innerHTML = '';
    setupSettingsEvents(async () => {});
    expect(invoke).not.toHaveBeenCalled();
  });

  it('setupSettingsEvents registers interactions and apply triggers', async () => {
    document.body.innerHTML = `
      <div id="settingsModal" class="hidden">
        <button id="closeSettings"></button>
        <button id="cancelSettings"></button>
        <button id="applySettings"></button>
        <button id="browseGamePathBtn"></button>
      </div>
      <button id="settingsBtn"></button>
      <input id="gamePath" value="/original/path" />
      <select id="windowSize">
        <option value="1280x720" selected>1280x720</option>
        <option value="1920x1080">1920x1080</option>
      </select>
      <input type="checkbox" id="stayOpen" checked />
      <div id="status"></div>
      
      <!-- Nav Tabs Mock -->
      <div class="nav-tab active" data-tab="addons"></div>
    `;

    const settingsModal = document.getElementById('settingsModal') as HTMLElement;
    const settingsBtn = document.getElementById('settingsBtn') as HTMLElement;
    const closeSettings = document.getElementById('closeSettings') as HTMLElement;
    const applySettings = document.getElementById('applySettings') as HTMLElement;
    const browseBtn = document.getElementById('browseGamePathBtn') as HTMLElement;
    const gamePath = document.getElementById('gamePath') as HTMLInputElement;

    const mockLoadConfig = vi.fn().mockImplementation(() => Promise.resolve());

    setupSettingsEvents(mockLoadConfig);

    // Click settingsBtn to open and check backup
    settingsBtn.click();
    expect(settingsModal.classList.contains('hidden')).toBe(false);
    expect(getSettingsBackup()).toEqual({
      path: '/original/path',
      windowSize: '1280x720',
      stayOpen: true,
    });

    // Modify values
    gamePath.value = '/modified/path';

    // Cancel settings or close restores backup
    closeSettings.click();
    expect(settingsModal.classList.contains('hidden')).toBe(true);
    expect(gamePath.value).toBe('/original/path');

    // Open again, test backdrop click
    settingsBtn.click();
    expect(settingsModal.classList.contains('hidden')).toBe(false);
    settingsModal.click(); // backdrop click
    expect(settingsModal.classList.contains('hidden')).toBe(true);

    // Browse game path button
    (invoke as any).mockImplementationOnce(() => Promise.resolve('/new/wow/path'));
    browseBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invoke).toHaveBeenCalledWith('pick_folder');
    expect(gamePath.value).toBe('/new/wow/path');

    // Browse game path failure
    const originalConsoleError = console.error;
    console.error = vi.fn();
    (invoke as any).mockImplementationOnce(() => Promise.reject('Pick folder error'));
    browseBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(console.error).toHaveBeenCalled();
    console.error = originalConsoleError;

    // Apply settings (when active tab is addons)
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'save_settings') return Promise.resolve();
      return Promise.resolve();
    });

    applySettings.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadAddonsAndPatches).toHaveBeenCalled();

    // Open again to modify settings
    settingsBtn.click();
    expect(settingsModal.classList.contains('hidden')).toBe(false);

    // Set active tab to tweaks
    const activeTab = document.querySelector('.nav-tab.active') as HTMLElement;
    activeTab.setAttribute('data-tab', 'tweaks');

    // Apply settings (when active tab is tweaks)
    applySettings.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invoke).toHaveBeenCalledWith('save_settings', {
      settings: {
        path: '/new/wow/path',
        windowSize: '1280x720',
        stayOpen: true,
      },
    });
    expect(mockLoadConfig).toHaveBeenCalled();
  });

  it('loadSavedSettings loads configurations and handles failures', async () => {
    document.body.innerHTML = `
      <input id="gamePath" value="" />
      <select id="windowSize">
        <option value="1280x720">1280x720</option>
      </select>
      <input type="checkbox" id="stayOpen" />
    `;

    (invoke as any).mockImplementationOnce(() =>
      Promise.resolve({
        path: '/saved/path',
        windowSize: '1280x720',
        stayOpen: true,
      })
    );

    await loadSavedSettings();
    expect(document.getElementById('gamePath')).toHaveProperty('value', '/saved/path');
    expect(document.getElementById('stayOpen')).toHaveProperty('checked', true);

    // Fail path
    (invoke as any).mockImplementationOnce(() => Promise.reject('Load fail'));
    await loadSavedSettings();
    expect((document.getElementById('windowSize') as HTMLSelectElement).value).toBe('1280x720');
  });

  it('saveSettings exits early if elements are missing', async () => {
    document.body.innerHTML = '';
    await saveSettings();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('covers remaining settings branches', async () => {
    // 1. setLauncherWindowSize with invalid size
    await setLauncherWindowSize('abc'); // width & height falsy

    // 2. restoreSettingsBackup when backup is null
    setSettingsBackup(null);
    document.body.innerHTML = `
      <div id="settingsModal" class="hidden">
        <button id="closeSettings"></button>
        <button id="cancelSettings"></button>
      </div>
      <input id="gamePath" value="/original" />
      <input type="checkbox" id="stayOpen" checked />
    `;
    setupSettingsEvents(async () => {});
    // click close, it calls restoreSettingsBackup which does nothing
    (document.getElementById('closeSettings') as HTMLElement).click();
    expect((document.getElementById('gamePath') as HTMLInputElement).value).toBe('/original');

    // 3. setupSettingsEvents windowSizeSelect is missing in DOM
    document.body.innerHTML = `
      <div id="settingsModal" class="hidden">
        <button id="closeSettings"></button>
        <button id="applySettings"></button>
      </div>
      <button id="settingsBtn"></button>
      <input id="gamePath" value="/original" />
      <input type="checkbox" id="stayOpen" checked />
      <!-- No status, and activeTab data-tab is "other" -->
      <div class="nav-tab active" data-tab="other"></div>
    `;
    setupSettingsEvents(async () => {});
    // click settingsBtn to open, should set fallback windowSize in backup
    const settingsBtn = document.getElementById('settingsBtn') as HTMLElement;
    settingsBtn.click();
    expect(getSettingsBackup()?.windowSize).toBe('1280x720');

    // click closeSettings to call restoreSettingsBackup when windowSizeSelect is null
    (document.getElementById('closeSettings') as HTMLElement).click();

    // click applySettings when windowSizeSelect and statusFooter are missing, and activeTab is "other"
    const applyBtn = document.getElementById('applySettings') as HTMLElement;
    applyBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // remove activeTab to test missing activeTab branch
    const tabEl = document.querySelector('.nav-tab.active');
    if (tabEl) tabEl.remove();
    applyBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 4. pick_folder returns empty/null with missing statusFooter
    document.body.innerHTML = `
      <div id="settingsModal" class="hidden">
        <button id="browseGamePathBtn"></button>
      </div>
      <input id="gamePath" value="/original" />
      <input type="checkbox" id="stayOpen" checked />
    `;
    setupSettingsEvents(async () => {});
    (invoke as any).mockResolvedValueOnce(null);
    (document.getElementById('browseGamePathBtn') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((document.getElementById('gamePath') as HTMLInputElement).value).toBe('/original');

    // pick_folder returns valid folder with missing statusFooter
    (invoke as any).mockResolvedValueOnce('/valid/path');
    (document.getElementById('browseGamePathBtn') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((document.getElementById('gamePath') as HTMLInputElement).value).toBe('/valid/path');

    // pick_folder fails with missing statusFooter
    (invoke as any).mockRejectedValueOnce('Folder error');
    const originalConsoleError = console.error;
    console.error = vi.fn();
    (document.getElementById('browseGamePathBtn') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(console.error).toHaveBeenCalled();
    console.error = originalConsoleError;

    // 5. loadSavedSettings when elements are missing
    document.body.innerHTML = '';
    await loadSavedSettings();

    // 6. loadSavedSettings when saved has no path, no windowSize, stayOpen undefined
    document.body.innerHTML = `
      <input id="gamePath" value="original" />
      <select id="windowSize"><option value="1280x720">1280x720</option></select>
      <input type="checkbox" id="stayOpen" />
    `;
    (invoke as any).mockResolvedValueOnce({
      path: null,
      windowSize: null,
      stayOpen: undefined,
    });
    await loadSavedSettings();
    expect((document.getElementById('gamePath') as HTMLInputElement).value).toBe('original');

    // 7. loadSavedSettings fails (catch block) when windowSizeSelect is null
    document.body.innerHTML = `
      <input id="gamePath" value="original" />
      <input type="checkbox" id="stayOpen" />
    `;
    (invoke as any).mockRejectedValueOnce('Load failed');
    await loadSavedSettings();

    // 9. loadSavedSettings fails, windowSizeSelect present, set_window_size fails to cover catch(() => undefined)
    document.body.innerHTML = `
      <input id="gamePath" value="original" />
      <select id="windowSize"><option value="1280x720">1280x720</option></select>
      <input type="checkbox" id="stayOpen" />
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'load_settings') return Promise.reject('Load fail');
      if (cmd === 'set_window_size') return Promise.reject('Resize fail');
      return Promise.resolve();
    });
    await loadSavedSettings();

    // 8. saveSettings when windowSizeSelect is missing
    document.body.innerHTML = `
      <input id="gamePath" value="/original" />
      <input type="checkbox" id="stayOpen" checked />
    `;
    await saveSettings();
    expect(invoke).toHaveBeenCalledWith('save_settings', expect.any(Object));
  });
});
