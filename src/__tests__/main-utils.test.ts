import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { setLauncherWindowSize } from '../main-utils';

describe('main-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      invoke as unknown as { mockResolvedValue: (value: unknown) => void; mockClear: () => void }
    ).mockClear();
    (invoke as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue(
      undefined
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets a valid window size using invoke', async () => {
    const result = await setLauncherWindowSize('1280x720');
    expect(result).toBe(true);
    expect(invoke).toHaveBeenCalledWith('set_window_size', {
      width: 1280,
      height: 720,
    });
  });

  it('returns false and does not call invoke for invalid size', async () => {
    const result = await setLauncherWindowSize('invalid-size');
    expect(result).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});
