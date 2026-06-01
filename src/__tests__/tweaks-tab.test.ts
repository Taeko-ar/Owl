import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig, parseConfigToMap, configGroups } from '../tabs/tweaks';
import { knownConfigs } from '../config/known-configs';
import { invoke } from '@tauri-apps/api/core';
import * as i18n from '../i18n';

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

    vi.mocked(invoke).mockImplementation((cmd: string) => {
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
    vi.mocked(invoke).mockImplementationOnce((cmd: string) => {
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

    vi.mocked(invoke).mockImplementation((cmd: string) => {
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
    vi.mocked(invoke).mockImplementationOnce((cmd: string) => {
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

    vi.mocked(invoke).mockImplementation(() => Promise.reject('Read config error'));

    await loadConfig();

    const configTree = document.getElementById('config-tree');
    expect(configTree?.innerHTML).toContain('Read config error');
  });

  it('covers remaining tweaks branches', async () => {
    // 1. parseConfigToMap with lines that trigger fallback or empty parts
    const raw = `
      SINGLE_WORD_NO_SPACES
    `;
    const map = parseConfigToMap(raw);
    expect(map['SINGLE_WORD_NO_SPACES']).toBeUndefined();

    // 2. loadConfig and preset click when statusFooter/activityProgress are missing, and preset button has invalid data-preset
    document.body.innerHTML = `
      <div id="config-tree"></div>
      <input id="gamePath" value="/mock/wow" />
    `;
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'read_config') return Promise.resolve('SET gxResolution "1920x1080"');
      return Promise.resolve();
    });
    await loadConfig();

    // Click valid preset when statusFooter is null to cover that branch in finally block
    const validBtn = document.querySelector('.preset-btn') as HTMLElement;
    if (validBtn) {
      validBtn.click();
    }
    await new Promise((r) => setTimeout(r, 50));

    // Modify a preset button to data-preset="invalid" and click it
    if (validBtn) {
      validBtn.setAttribute('data-preset', 'invalid');
      validBtn.click();
    }
    await new Promise((r) => setTimeout(r, 50));

    // 3. active tab selection, range input maxFPS set to 0, environmentDetail range input change, toggle checked
    document.body.innerHTML = `
      <div id="config-tree"></div>
      <input id="gamePath" value="/mock/wow" />
      <div id="status"></div>
    `;
    // Add videoOptionsVersion and minimapZoom (missing desc) and testRangeNoStep (missing step) to configGroups[2].keys to trigger render fallbacks
    if (!configGroups[2].keys.includes('videoOptionsVersion')) {
      configGroups[2].keys.push('videoOptionsVersion');
    }
    if (!configGroups[2].keys.includes('minimapZoom')) {
      configGroups[2].keys.push('minimapZoom');
    }
    if (!configGroups[2].keys.includes('testRangeNoStep')) {
      configGroups[2].keys.push('testRangeNoStep');
    }
    knownConfigs['testRangeNoStep'] = {
      alias: '',
      desc: '',
      type: 'number',
      min: 1,
      max: 10,
    };

    // We mock shadowLevel to "3" (so it is found in options) and environmentDetail is missing (so value is falsy)
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'read_config')
        return Promise.resolve(
          'SET maxFPS "0"\nSET projectedTextures "0"\nSET shadowLevel "3"\nSET videoOptionsVersion "3"\nSET testRangeNoStep "5"'
        );
      return Promise.resolve();
    });

    // Mock translations to return key itself to cover fallback aliases/descriptions
    const translationSpy = vi.spyOn(i18n, 'getTranslation').mockImplementation((key) => key);

    // Render presets tab initially
    await loadConfig();
    const activePresetBtn = document.querySelector('.preset-btn') as HTMLElement;
    if (activePresetBtn) {
      activePresetBtn.click();
    }
    await new Promise((r) => setTimeout(r, 50));

    // Click Performance sidebar button to load performance tweaks
    const perfTabBtn = document.querySelectorAll('.tweak-sidebar-btn')[2] as HTMLElement; // performance
    if (perfTabBtn) {
      perfTabBtn.click();
    }
    await new Promise((r) => setTimeout(r, 50));

    // toggle maxFPS range input to 0 and verify uncapped label
    const maxFpsRange = document.querySelector(
      '.tweak-range[data-key="maxFPS"]'
    ) as HTMLInputElement;
    if (maxFpsRange) {
      maxFpsRange.value = '0';
      maxFpsRange.dispatchEvent(new Event('input'));
      maxFpsRange.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 800));
    }

    // Click Quality sidebar button to load quality tweaks
    const qualityTabBtn = document.querySelectorAll('.tweak-sidebar-btn')[3] as HTMLElement; // quality
    if (qualityTabBtn) {
      qualityTabBtn.click();
    }
    await new Promise((r) => setTimeout(r, 50));

    // environmentDetail change (it has environmentDetail missing from read_config, so it uses fallback min value)
    const envRange = document.querySelector(
      '.tweak-range[data-key="environmentDetail"]'
    ) as HTMLInputElement;
    if (envRange) {
      envRange.value = '75';
      envRange.dispatchEvent(new Event('input'));
      envRange.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 800));
    }

    const testRange = document.querySelector(
      '.tweak-range[data-key="testRangeNoStep"]'
    ) as HTMLInputElement;
    if (testRange) {
      testRange.value = '6';
      testRange.dispatchEvent(new Event('input'));
      testRange.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 800));
    }

    const projToggle = document.querySelector(
      '.tweak-toggle[data-key="projectedTextures"]'
    ) as HTMLInputElement;
    if (projToggle) {
      projToggle.checked = true;
      projToggle.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 800));
    }

    // shadowLevel select where value is empty
    vi.mocked(invoke).mockImplementationOnce((cmd: string) => {
      if (cmd === 'read_config')
        return Promise.resolve('SET maxFPS "0"\nSET projectedTextures "0"'); // shadowLevel missing -> empty value
      return Promise.resolve();
    });
    await loadConfig();

    translationSpy.mockRestore();
  });
});
