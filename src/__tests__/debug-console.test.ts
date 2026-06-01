import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const mockInvoke = vi.fn().mockImplementation((cmd) => {
  if (cmd === 'load_settings') {
    return Promise.resolve({ path: 'C:\\wow', windowSize: '1280x720', stayOpen: false });
  }
  return Promise.resolve();
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

const mockWriteText = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: mockWriteText,
  },
  writable: true,
});

describe('Debug Console', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockWriteText.mockClear();

    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    document.body.innerHTML = html;

    vi.resetModules();
    await import('../main');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('toggles debug console modal visibility via Ctrl + Shift + J', () => {
    const modal = document.getElementById('debugConsoleModal') as HTMLDivElement;
    expect(modal.classList.contains('hidden')).toBe(true);

    const event = new KeyboardEvent('keydown', {
      key: 'j',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(modal.classList.contains('hidden')).toBe(false);

    window.dispatchEvent(event);
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('intercepts console.log, console.warn, and console.error and displays them in the logs container', () => {
    const logsContainer = document.getElementById('debugLogsContainer') as HTMLDivElement;

    const event = new KeyboardEvent('keydown', {
      key: 'j',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    console.log('This is a test log');
    console.warn('This is a test warning');
    console.error('This is a test error');

    const logsHtml = logsContainer.innerHTML;
    expect(logsHtml).toContain('[LOG] This is a test log');
    expect(logsHtml).toContain('[WARN] This is a test warning');
    expect(logsHtml).toContain('[ERROR] This is a test error');
  });

  it('intercepts uncaught window exceptions and unhandled promise rejections', () => {
    const logsContainer = document.getElementById('debugLogsContainer') as HTMLDivElement;

    const event = new KeyboardEvent('keydown', {
      key: 'j',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    const errorEvent = new ErrorEvent('error', {
      message: 'Uncaught error occurred',
      filename: 'test.js',
      lineno: 42,
      colno: 7,
    });
    window.dispatchEvent(errorEvent);

    const rejectionEvent = new Event('unhandledrejection');
    Object.defineProperty(rejectionEvent, 'reason', { value: 'Rejected promise test' });
    window.dispatchEvent(rejectionEvent);

    const logsHtml = logsContainer.innerHTML;
    expect(logsHtml).toContain('Uncaught Exception: Uncaught error occurred at test.js:42:7');
    expect(logsHtml).toContain('Unhandled Promise Rejection: Rejected promise test');
  });

  it('clears logs when the clear button is clicked', () => {
    const logsContainer = document.getElementById('debugLogsContainer') as HTMLDivElement;
    const clearBtn = document.getElementById('debugClearBtn') as HTMLButtonElement;

    const event = new KeyboardEvent('keydown', {
      key: 'j',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    console.log('Temporary log message');
    expect(logsContainer.innerHTML).toContain('Temporary log message');

    clearBtn.click();
    expect(logsContainer.innerHTML).toBe('');
  });

  it('copies logs to clipboard when copy button is clicked', async () => {
    const copyBtn = document.getElementById('debugCopyBtn') as HTMLButtonElement;

    const event = new KeyboardEvent('keydown', {
      key: 'j',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    console.log('Copy log test');

    copyBtn.click();
    await new Promise((r) => setTimeout(r, 50));

    expect(mockWriteText).toHaveBeenCalled();
    const copiedText = mockWriteText.mock.calls[0][0];
    expect(copiedText).toContain('[LOG] Copy log test');
  });

  it('covers remaining debug console branches like log limit, backdrop click, and copy logs failure', async () => {
    const { debugLogs, addDebugLog } = await import('../ui/debug-console');

    const originalHtml = document.body.innerHTML;

    // 1. log limit: push 505 logs to trigger length > 500 branch (debugLogs.shift())
    document.body.innerHTML = '';
    debugLogs.length = 0; // reset
    for (let i = 0; i < 505; i++) {
      addDebugLog('log', `Log ${i}`);
    }
    expect(debugLogs.length).toBe(500);
    expect(debugLogs[0].message).toBe('Log 5'); // 0-4 shifted out

    document.body.innerHTML = originalHtml;
    const { setupDebugConsoleEvents } = await import('../ui/debug-console');
    setupDebugConsoleEvents();

    // 2. backdrop click
    const modal = document.getElementById('debugConsoleModal') as HTMLDivElement;
    modal.classList.remove('hidden');
    modal.click(); // clicks modal backdrop directly
    expect(modal.classList.contains('hidden')).toBe(true);

    // 3. clipboard copy error
    mockWriteText.mockRejectedValueOnce(new Error('Clipboard block'));
    const copyBtn = document.getElementById('debugCopyBtn') as HTMLButtonElement;
    copyBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 4. toggleDebugConsole when modal is missing
    document.body.innerHTML = '';
    const { toggleDebugConsole } = await import('../ui/debug-console');
    toggleDebugConsole();

    // 5. keydown event that does not match
    const eventNonMatch = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });
    window.dispatchEvent(eventNonMatch);
  });
});
