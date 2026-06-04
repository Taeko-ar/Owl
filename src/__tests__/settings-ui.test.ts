import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  setLauncherWindowSize,
  setupSettingsEvents,
  loadSavedSettings,
  saveSettings,
  checkLauncherUpdates,
  wireUpdateLabelClick,
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

  it('covers updater logic, markdown rendering, and modal action events', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="settingsModal" class="hidden">
        <button id="settingsBtn"></button>
      </div>
      <div id="settingsUpdateContainer">
        <span id="settingsUpdateLabel">Check updates...</span>
      </div>
      <div id="settingsBadge" class="hidden"></div>
      <div id="settingsUpdateVersion"></div>
      <input id="gamePath" value="/original" />
      <input type="checkbox" id="stayOpen" checked />
      <div id="status"></div>

      <!-- Update Details Modal elements -->
      <div id="updateDetailsModal" class="hidden">
        <div id="updateModalTitle"></div>
        <div id="updateChangelogContent"></div>
        <button id="skipVersionBtn"></button>
        <button id="closeUpdateDetails"></button>
        <button id="confirmUpdateBtn"></button>
      </div>
    `;

    setupSettingsEvents(async () => {});

    // 1. checkLauncherUpdates manual check with update available
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'check_update_details') {
        return Promise.resolve({
          version: '1.5.0',
          body: '# Release 1.5.0\n## Features\n- Cool stuff\n### Detail\n* Bullet item\n- Bullet item 2\n\nEmpty line check',
        });
      }
      if (cmd === 'get_app_version') return Promise.resolve('1.0.0');
      return Promise.resolve();
    });

    await checkLauncherUpdates(true);
    const label = document.getElementById('settingsUpdateLabel') as HTMLElement;
    expect(label.textContent).toBe('Update available!');

    // 2. Click update label to trigger showUpdateDetails and test markdown rendering
    label.click();
    const updateModal = document.getElementById('updateDetailsModal');
    expect(updateModal?.classList.contains('hidden')).toBe(false);
    const changelog = document.getElementById('updateChangelogContent');
    expect(changelog?.innerHTML).toContain('Release 1.5.0');
    expect(changelog?.innerHTML).toContain('Bullet item');

    // 3. Click skipVersionBtn to skip
    const skipBtn = document.getElementById('skipVersionBtn') as HTMLElement;
    skipBtn.click();
    expect(updateModal?.classList.contains('hidden')).toBe(true);

    // 4. checkLauncherUpdates auto check (should match skipped version and not show update label)
    await checkLauncherUpdates(false);
    expect(document.getElementById('settingsBadge')?.classList.contains('hidden')).toBe(true);

    // 5. checkLauncherUpdates manual check (no updates available)
    (invoke as any).mockResolvedValueOnce(null);
    await checkLauncherUpdates(true);
    expect(document.getElementById('settingsUpdateContainer')?.innerHTML).toContain(
      'Launcher is up-to-date'
    );
    // Run timeouts to restore label
    vi.runAllTimers();
    expect(document.getElementById('settingsUpdateLabel')).not.toBeNull();

    // Cover wireUpdateLabelClick when cachedUpdate is null
    wireUpdateLabelClick();
    const labelNull = document.getElementById('settingsUpdateLabel') as HTMLElement;
    (invoke as any).mockResolvedValueOnce(null);
    labelNull.click();
    await Promise.resolve();

    // 6. checkLauncherUpdates manual check fails
    (invoke as any).mockRejectedValueOnce('Update API Down');
    await checkLauncherUpdates(true);
    expect(document.getElementById('settingsUpdateContainer')?.innerHTML).toContain('Check failed');
    vi.runAllTimers();
    expect(document.getElementById('settingsUpdateLabel')).not.toBeNull();

    // 7. Test backdrop clicks on updateDetailsModal
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'check_update_details') {
        return Promise.resolve({
          version: '1.5.0',
          body: '# Release 1.5.0',
        });
      }
      if (cmd === 'get_app_version') return Promise.resolve('1.0.0');
      return Promise.resolve();
    });
    await checkLauncherUpdates(true);
    const label2 = document.getElementById('settingsUpdateLabel') as HTMLElement;
    label2.click();
    expect(updateModal?.classList.contains('hidden')).toBe(false);
    updateModal?.click(); // backdrop click
    expect(updateModal?.classList.contains('hidden')).toBe(true);

    // 8. Test closeUpdateDetails click
    label2.click();
    expect(updateModal?.classList.contains('hidden')).toBe(false);
    document.getElementById('closeUpdateDetails')?.click();
    expect(updateModal?.classList.contains('hidden')).toBe(true);

    // 9. Test confirmUpdateBtn click (success path)
    label2.click();
    (invoke as any).mockResolvedValueOnce(null);
    document.getElementById('confirmUpdateBtn')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById('status')?.textContent).toBe('Updating...');

    // 10. Test confirmUpdateBtn click (fail path)
    label2.click();
    (invoke as any).mockRejectedValueOnce('Install error');
    document.getElementById('confirmUpdateBtn')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById('status')?.textContent).toContain('Update error');

    // 11. Trigger get_app_version resolution on settingsBtn click
    const settingsBtn = document.getElementById('settingsBtn') as HTMLElement;
    settingsBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById('settingsUpdateVersion')?.textContent).toBe('v1.0.0');

    // 12. Trigger get_app_version catch path on settingsBtn click
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_app_version') return Promise.reject('App version error');
      return Promise.resolve();
    });
    settingsBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    // 13. checkLauncherUpdates when settingsBadge is null
    const settingsBadge = document.getElementById('settingsBadge');
    if (settingsBadge) settingsBadge.remove();

    (invoke as any).mockResolvedValueOnce({ version: '1.6.0', body: 'New version' });
    await checkLauncherUpdates(true);

    // checkLauncherUpdates with null update when settingsBadge is null
    (invoke as any).mockResolvedValueOnce(null);
    await checkLauncherUpdates(true);

    // checkLauncherUpdates error path when settingsBadge is null
    (invoke as any).mockRejectedValueOnce('Error');
    await checkLauncherUpdates(true);

    // 14. skipVersionBtn when cachedUpdate is null
    (invoke as any).mockResolvedValueOnce(null);
    await checkLauncherUpdates(true);

    const badge2 = document.getElementById('settingsBadge');
    if (badge2) badge2.remove();
    const updateContainer3 = document.getElementById('settingsUpdateContainer');
    if (updateContainer3) updateContainer3.remove();

    document.getElementById('skipVersionBtn')?.click();

    // 15. confirmUpdateBtn click when statusFooter is null
    const statusFooter = document.getElementById('status');
    if (statusFooter) statusFooter.remove();

    (invoke as any).mockResolvedValueOnce(undefined);
    document.getElementById('confirmUpdateBtn')?.click();
    await Promise.resolve();

    (invoke as any).mockRejectedValueOnce('Err');
    document.getElementById('confirmUpdateBtn')?.click();
    await Promise.resolve();

    vi.useRealTimers();
  });

  it('covers remaining settings.ts edge branches', async () => {
    // 1. showUpdateDetails when #updateModalTitle element is missing
    document.body.innerHTML = `
      <div id="updateDetailsModal" class="hidden">
        <div id="updateChangelogContent"></div>
      </div>
      <div id="settingsUpdateContainer">
        <span id="settingsUpdateLabel">Check updates...</span>
      </div>
    `;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'check_update_details') {
        return Promise.resolve({ version: '1.5.0', body: 'New version info' });
      }
      return Promise.resolve();
    });
    // Check update to populate cachedUpdate
    await checkLauncherUpdates(true);
    // Click label (it has no title in DOM now)
    document.getElementById('settingsUpdateLabel')?.click();
    expect(document.getElementById('updateDetailsModal')?.classList.contains('hidden')).toBe(false);

    // 2. setLauncherWindowSize with invalid width/height
    await setLauncherWindowSize('1024x');
    await setLauncherWindowSize('x768');

    // 3. settings apply when activeTab has no data-tab attribute
    document.body.innerHTML = `
      <div id="settingsModal" class="hidden">
        <button id="applySettings"></button>
      </div>
      <input id="gamePath" value="/original" />
      <input type="checkbox" id="stayOpen" checked />
      <div class="nav-tab active"></div> <!-- no data-tab attribute -->
    `;
    setupSettingsEvents(async () => {});
    (invoke as any).mockResolvedValue(undefined);
    document.getElementById('applySettings')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
