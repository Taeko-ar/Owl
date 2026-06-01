import { invoke } from '@tauri-apps/api/core';
import { CatalogAddon, AddonVersion, CurseForgeMod, CurseForgeFile } from '../types';

export async function searchCurseForgeApi(
  query: string,
  categoryId: number | null,
  gameVersion: string,
  isMock: boolean
): Promise<CatalogAddon[]> {
  const response = await invoke<{ data: CurseForgeMod[] }>('search_curseforge_addons', {
    query: encodeURIComponent(query),
    categoryId,
    gameVersion,
    isMock,
  });
  const mods = response.data || [];

  return mods.map((mod) => ({
    name: mod.name,
    title: mod.name,
    description: mod.summary || 'No description available',
    modId: mod.id,
    logoUrl: mod.logo?.thumbnailUrl || '',
    authors: mod.authors ? mod.authors.map((a) => a.name).join(', ') : 'Unknown',
    websiteUrl: mod.links?.websiteUrl || '',
    issuesUrl: mod.links?.issuesUrl || '',
    sourceUrl: mod.links?.sourceUrl || '',
    donationUrl: mod.links?.donationUrl || '',
  }));
}

export async function fetchCurseForgeVersions(
  modId: number,
  gameVersionStr: string,
  isMock: boolean
): Promise<AddonVersion[]> {
  const response = await invoke<{ data: CurseForgeFile[] }>('get_curseforge_mod_files', {
    modId,
    isMock,
  });
  const files = response.data || [];
  return files
    .filter((file) => {
      const hasDlUrl = !!(file.downloadUrl || (file.id && file.fileName));
      if (!file.gameVersions || !hasDlUrl) return false;
      return file.gameVersions.some((v: string) => {
        if (gameVersionStr === '1.12.1') {
          return v === '1.12' || v === '1.12.1' || v === '1.12.2';
        } else {
          return v === '3.3.5' || v === '3.3.5a' || v.startsWith('3.4.');
        }
      });
    })
    .map((file) => {
      let dlUrl = file.downloadUrl;
      if (!dlUrl && file.id && file.fileName) {
        const strId = String(file.id);
        if (strId.length >= 4) {
          const part1 = strId.substring(0, 4);
          const part2 = strId.substring(4);
          dlUrl = `https://edge.forgecdn.net/files/${part1}/${part2}/${encodeURIComponent(
            file.fileName
          )}`;
        }
      }
      return {
        id: String(file.id),
        displayName: file.displayName || file.fileName || 'Unknown Version',
        releaseType: file.releaseType || 1,
        downloadUrl: dlUrl || '',
      };
    });
}

export async function getCurseForgeModDescription(modId: number, isMock: boolean): Promise<string> {
  return invoke<string>('get_curseforge_mod_description', { modId, isMock });
}
