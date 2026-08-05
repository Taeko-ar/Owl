import { vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockImplementation(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn().mockReturnValue({
    startDragging: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockInvoke = vi.fn();
(globalThis as unknown as { mockInvoke: typeof mockInvoke }).mockInvoke = mockInvoke;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    return (globalThis as unknown as { mockInvoke: typeof mockInvoke }).mockInvoke(cmd, args);
  }),
}));
