import {
  AddonGitStatus,
  CatalogAddon,
  AddonVersion,
  StoreSite,
  InstalledAddonSourceMeta,
} from './types';

export const gitStatusCache = new Map<string, AddonGitStatus | null>();
export const selectedAddons = new Map<
  string,
  { addon: CatalogAddon; selectedVersion: AddonVersion }
>();

let settingsBackup: { path: string; windowSize: string; stayOpen: boolean } | null = null;
export function getSettingsBackup() {
  return settingsBackup;
}
export function setSettingsBackup(
  v: { path: string; windowSize: string; stayOpen: boolean } | null
) {
  settingsBackup = v;
}

let activeTweaksSubTab = 'presets';
export function getActiveTweaksSubTab() {
  return activeTweaksSubTab;
}
export function setActiveTweaksSubTab(v: string) {
  activeTweaksSubTab = v;
}

let currentActiveSite: StoreSite = 'curseforge';
export function getCurrentActiveSite() {
  return currentActiveSite;
}
export function setCurrentActiveSite(v: StoreSite) {
  currentActiveSite = v;
}

let selectedDetailAddon: CatalogAddon | null = null;
export function getSelectedDetailAddon() {
  return selectedDetailAddon;
}
export function setSelectedDetailAddon(v: CatalogAddon | null) {
  selectedDetailAddon = v;
}

let selectedDetailAddonKey = '';
export function getSelectedDetailAddonKey() {
  return selectedDetailAddonKey;
}
export function setSelectedDetailAddonKey(v: string) {
  selectedDetailAddonKey = v;
}

let currentDetailVersions: AddonVersion[] = [];
export function getCurrentDetailVersions() {
  return currentDetailVersions;
}
export function setCurrentDetailVersions(v: AddonVersion[]) {
  currentDetailVersions = v;
}

let detectedGameVersion = '3.3.5a';
export function getDetectedGameVersion() {
  return detectedGameVersion;
}
export function setDetectedGameVersion(v: string) {
  detectedGameVersion = v;
}

let installedAddonsMeta: InstalledAddonSourceMeta[] = [];
export function getInstalledAddonsMeta() {
  return installedAddonsMeta;
}
export function setInstalledAddonsMeta(v: InstalledAddonSourceMeta[]) {
  installedAddonsMeta = v;
}
