import { describe, expect, it } from 'vitest';
import { Prefs } from '../prefs';
import {
  getSettingsBackup,
  setSettingsBackup,
  getActiveTweaksSubTab,
  setActiveTweaksSubTab,
  getCurrentActiveSite,
  setCurrentActiveSite,
  getSelectedDetailAddon,
  setSelectedDetailAddon,
  getSelectedDetailAddonKey,
  setSelectedDetailAddonKey,
  getCurrentDetailVersions,
  setCurrentDetailVersions,
  getDetectedGameVersion,
  setDetectedGameVersion,
} from '../state';
import * as storeIndex from '../store';

describe('Prefs & State', () => {
  it('exercises Prefs theme storage', () => {
    expect(storeIndex.STORE_INITIALIZED).toBe(true);
    Prefs.setTheme('light');
    expect(Prefs.getTheme()).toBe('light');
    Prefs.setTheme('dark');
    expect(Prefs.getTheme()).toBe('dark');
  });

  it('exercises State getters and setters', () => {
    // Settings backup
    expect(getSettingsBackup()).toBeNull();
    const backup = { path: '/path', windowSize: '800x600', stayOpen: true };
    setSettingsBackup(backup);
    expect(getSettingsBackup()).toEqual(backup);
    setSettingsBackup(null);
    expect(getSettingsBackup()).toBeNull();

    // Tweaks subtab
    expect(getActiveTweaksSubTab()).toBe('presets');
    setActiveTweaksSubTab('custom');
    expect(getActiveTweaksSubTab()).toBe('custom');

    // Current active site
    expect(getCurrentActiveSite()).toBe('curseforge');
    setCurrentActiveSite('github');
    expect(getCurrentActiveSite()).toBe('github');

    // Selected detail addon
    expect(getSelectedDetailAddon()).toBeNull();
    const mockAddon: any = { id: 123, name: 'Test Addon' };
    setSelectedDetailAddon(mockAddon);
    expect(getSelectedDetailAddon()).toEqual(mockAddon);

    // Selected detail addon key
    expect(getSelectedDetailAddonKey()).toBe('');
    setSelectedDetailAddonKey('key-123');
    expect(getSelectedDetailAddonKey()).toBe('key-123');

    // Current detail versions
    expect(getCurrentDetailVersions()).toEqual([]);
    const mockVersions: any[] = [{ id: 1, name: 'v1' }];
    setCurrentDetailVersions(mockVersions);
    expect(getCurrentDetailVersions()).toEqual(mockVersions);

    // Detected game version
    expect(getDetectedGameVersion()).toBe('3.3.5a');
    setDetectedGameVersion('1.12.1');
    expect(getDetectedGameVersion()).toBe('1.12.1');
  });
});
