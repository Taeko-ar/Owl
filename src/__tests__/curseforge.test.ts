import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { getCurseForgeModUrl } from '../store/curseforge';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('getCurseForgeModUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mod website url when present', async () => {
    (invoke as any).mockResolvedValueOnce({
      data: { links: { websiteUrl: 'https://curseforge.test/mod' } },
    });
    const url = await getCurseForgeModUrl(123, false);
    expect(invoke).toHaveBeenCalledWith('get_curseforge_mod', { modId: 123, isMock: false });
    expect(url).toBe('https://curseforge.test/mod');
  });

  it('returns undefined when the response has no website url', async () => {
    (invoke as any).mockResolvedValueOnce({ data: { links: {} } });
    const url = await getCurseForgeModUrl(123, true);
    expect(url).toBeUndefined();
  });

  it('returns undefined when the response has no data', async () => {
    (invoke as any).mockResolvedValueOnce({});
    const url = await getCurseForgeModUrl(123, false);
    expect(url).toBeUndefined();
  });
});
