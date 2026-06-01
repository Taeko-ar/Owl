import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig, parseConfigToMap, activeTweaksSubTab, configGroups } from '../tabs/tweaks';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('Tweaks Tab UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('parseConfigToMap parses raw config text correctly', () => {
    const raw = `
      // This is a comment
      # Another comment
      -- SQL style comment
      
      SET gxResolution "1920x1080"
      SET gxWindow "1"
      maxFPS = 60
      customConfigKey customConfigValue
      SET shadowLevel "2"
    `;
    const map = parseConfigToMap(raw);
    expect(map['gxResolution']).toBe('1920x1080');
    expect(map['gxWindow']).toBe('1');
    expect(map['maxFPS']).toBe('60');
    expect(map['customConfigKey']).toBe('customConfigValue');
    expect(map['shadowLevel']).toBe('2');
  });

  it('exits early if core DOM elements are missing', async () => {
    document.body.innerHTML = '';
    await loadConfig();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('renders presets and handles applying preset values', async () => {
    document.body.innerHTML = `
      <div id="config-tree"></div>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
    `;

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'read_config') {
        return Promise.resolve('SET gxResolution "1920x1080"\nSET gxWindow "1"');
      }
      return Promise.resolve();
    });

    // Set subtab to presets
    // activeTweaksSubTab starts as 'presets'
    await loadConfig();

    const configTree = document.getElementById('config-tree');
    expect(configTree?.innerHTML).toContain('tweak-sidebar-btn');
    expect(configTree?.innerHTML).toContain('preset-btn');

    // Click Apply on performance preset
    const perfBtn = document.querySelector('.preset-btn[data-preset="performance"]') as HTMLElement;
    perfBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invoke).toHaveBeenCalledWith('set_config_value', {
      basePath: '/mock/wow',
      key: 'farClip',
      value: '177.000000',
    });

    // Test error when applying preset
    (invoke as any).mockImplementationOnce((cmd: string) => {
      if (cmd === 'set_config_value') return Promise.reject('Set value failed');
      return Promise.resolve();
    });
    perfBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Verify it doesn't crash
  });

  it('handles other subtabs and input/change events', async () => {
    document.body.innerHTML = `
      <div id="config-tree"></div>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
    `;

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'read_config') {
        return Promise.resolve('SET gxWindow "1"\nSET maxFPS "60"\nSET shadowLevel "4"');
      }
      return Promise.resolve();
    });

    await loadConfig();

    // Click on display subtab
    const displayTabBtn = document.querySelectorAll('.tweak-sidebar-btn')[1] as HTMLElement;
    displayTabBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify display card rendered
    const toggleInput = document.querySelector('.tweak-toggle') as HTMLInputElement;
    expect(toggleInput).not.toBeNull();
    toggleInput.checked = false;
    toggleInput.dispatchEvent(new Event('change'));
    // Wait for debounce saveFn (700ms, let's wait 800ms)
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(invoke).toHaveBeenCalledWith('set_config_value', {
      basePath: '/mock/wow',
      key: 'gxWindow',
      value: '0',
    });

    // Mock console.error to check call, and mock save fail
    const originalConsoleError = console.error;
    let consoleErrorCalled = false;
    console.error = () => {
      consoleErrorCalled = true;
    };
    (invoke as any).mockImplementationOnce((cmd: string) => {
      if (cmd === 'set_config_value') return Promise.reject('Save failed');
      return Promise.resolve();
    });
    toggleInput.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(consoleErrorCalled).toBe(true);
    console.error = originalConsoleError;

    // Click on performance subtab
    const perfTabBtn = document.querySelectorAll('.tweak-sidebar-btn')[2] as HTMLElement;
    perfTabBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const rangeInput = document.querySelector('.tweak-range') as HTMLInputElement;
    expect(rangeInput).not.toBeNull();
    rangeInput.value = '100';
    rangeInput.dispatchEvent(new Event('input'));
    rangeInput.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(invoke).toHaveBeenCalledWith('set_config_value', {
      basePath: '/mock/wow',
      key: 'maxFPS',
      value: '100',
    });

    // Click on quality subtab (which has shadowLevel select dropdown)
    const qualityTabBtn = document.querySelectorAll('.tweak-sidebar-btn')[3] as HTMLElement;
    qualityTabBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify custom option is added
    const selects = document.querySelectorAll('.tweak-select');
    const selectEl = selects[1] as HTMLSelectElement;
    expect(selectEl).not.toBeNull();
    expect(selectEl.innerHTML).toContain('Custom (4)');

    selectEl.value = '3';
    selectEl.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(invoke).toHaveBeenCalledWith('set_config_value', {
      basePath: '/mock/wow',
      key: 'shadowLevel',
      value: '3',
    });
  });

  it('handles loadConfig read_config failure gracefully', async () => {
    document.body.innerHTML = `
      <div id="config-tree"></div>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
      <div id="activityProgress"></div>
    `;

    (invoke as any).mockImplementation(() => Promise.reject('Read config error'));

    await loadConfig();

    const configTree = document.getElementById('config-tree');
    expect(configTree?.innerHTML).toContain('Read config error');
  });
});
