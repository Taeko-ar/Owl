export interface AddonMeta {
  name: string;
  title: string;
  author: string | null;
  version: string | null;
  hasGit: boolean;
  readme?: string;
  optional_deps?: string[];
  optional_deps_installed?: boolean[];
  requiredDeps?: string[];
  enabled?: boolean;
  displayName?: string;
  path?: string;
  isDependency?: boolean;
}

export interface AddonGitStatus {
  updateAvailable: boolean;
  lastCommit?: string;
  branch?: string;
  branches?: string[];
}

export interface AddonProfile {
  name: string;
  enabledAddons: string[];
  tweakConfigs?: Record<string, string>;
  enabledPatches?: string[];
}

export interface LauncherSettings {
  path?: string;
  windowSize?: string;
  stayOpen?: boolean;
  addonProfiles?: AddonProfile[];
  activeProfile?: string;
}

export interface CatalogAddon {
  name: string;
  title: string;
  description: string;
  downloadUrl?: string;
  modId?: number;
  logoUrl?: string;
  authors?: string;
  websiteUrl?: string;
  issuesUrl?: string;
  sourceUrl?: string;
  donationUrl?: string;
}

export interface AddonVersion {
  id: number | string;
  displayName: string;
  fileName?: string;
  releaseType: number;
  downloadUrl: string;
  gameVersions?: string[];
  sha1?: string | null;
}

export interface LogEntry {
  type: 'error' | 'warn' | 'log';
  message: string;
  timestamp: string;
}

export type StoreSite = 'curseforge' | 'mock' | 'github';
export type Lang = 'en' | 'es' | 'pt';

export interface CurseForgeAddonLogo {
  thumbnailUrl?: string;
}

export interface CurseForgeAddonLinks {
  websiteUrl?: string;
  issuesUrl?: string;
  sourceUrl?: string;
  donationUrl?: string;
}

export interface CurseForgeAuthor {
  name: string;
}

export interface CurseForgeMod {
  id: number;
  name: string;
  summary?: string;
  logo?: CurseForgeAddonLogo;
  authors?: CurseForgeAuthor[];
  links?: CurseForgeAddonLinks;
}

export interface CurseForgeFileHash {
  algo: number;
  value: string;
}

export interface CurseForgeFile {
  id: number;
  displayName?: string;
  fileName?: string;
  releaseType?: number;
  downloadUrl?: string;
  gameVersions?: string[];
  hashes?: CurseForgeFileHash[];
}

export interface GitHubAsset {
  id: number;
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  id: number;
  name: string | null;
  tag_name: string;
  prerelease: boolean;
  assets?: GitHubAsset[];
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  owner?: {
    avatar_url?: string;
    login?: string;
  };
  html_url: string;
  has_issues: boolean;
}

export interface UpdateDetails {
  version: string;
  body: string | null;
}
