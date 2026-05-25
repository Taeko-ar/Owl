import { invoke } from '@tauri-apps/api/core';

export async function setLauncherWindowSize(size: string) {
  const [width, height] = size.split('x').map((n) => parseInt(n, 10));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  await invoke('set_window_size', { width, height });
  return true;
}
