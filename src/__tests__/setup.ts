import { vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockImplementation(() => Promise.resolve(() => {})),
}));

const mockInvoke = vi.fn();
(globalThis as any).mockInvoke = mockInvoke;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation((cmd, args) => {
    return (globalThis as any).mockInvoke(cmd, args);
  }),
}));
