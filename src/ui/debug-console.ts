import { escapeHtml, showToast } from '../utils';

export interface LogEntry {
  type: 'error' | 'warn' | 'log';
  message: string;
  timestamp: string;
}

export const debugLogs: LogEntry[] = [];
export const originalConsoleError = console.error;
export const originalConsoleWarn = console.warn;
export const originalConsoleLog = console.log;

export function updateDebugConsoleUI() {
  const container = document.getElementById('debugLogsContainer');
  if (!container) return;
  container.innerHTML = debugLogs
    .map((log) => {
      let classType = 'log-info';
      if (log.type === 'error') {
        classType = 'log-error';
      } else if (log.type === 'warn') {
        classType = 'log-warn';
      }
      return `<div class="${classType}">[${log.timestamp}] [${log.type.toUpperCase()}] ${escapeHtml(log.message)}</div>`;
    })
    .join('');
  container.scrollTop = container.scrollHeight;
}

export function addDebugLog(type: 'error' | 'warn' | 'log', ...args: unknown[]) {
  const message = args
    .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
    .join(' ');
  const timestamp = new Date().toLocaleTimeString();
  debugLogs.push({ type, message, timestamp });

  if (debugLogs.length > 500) {
    debugLogs.shift();
  }

  updateDebugConsoleUI();
}

console.error = function (...args: unknown[]) {
  addDebugLog('error', ...args);
  originalConsoleError(...args);
};

console.warn = function (...args: unknown[]) {
  addDebugLog('warn', ...args);
  originalConsoleWarn(...args);
};

console.log = function (...args: unknown[]) {
  addDebugLog('log', ...args);
  originalConsoleLog(...args);
};

window.addEventListener('error', (e) => {
  addDebugLog('error', `Uncaught Exception: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`);
});

window.addEventListener('unhandledrejection', (e) => {
  addDebugLog('error', `Unhandled Promise Rejection: ${e.reason}`);
});

export function toggleDebugConsole() {
  const modal = document.getElementById('debugConsoleModal');
  if (!modal) return;
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) {
    updateDebugConsoleUI();
  }
}

export function setupDebugConsoleEvents() {
  const closeBtn = document.getElementById('debugCloseBtn');
  const copyBtn = document.getElementById('debugCopyBtn');
  const clearBtn = document.getElementById('debugClearBtn');
  const modal = document.getElementById('debugConsoleModal');

  closeBtn?.addEventListener('click', toggleDebugConsole);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      toggleDebugConsole();
    }
  });

  clearBtn?.addEventListener('click', () => {
    debugLogs.length = 0;
    updateDebugConsoleUI();
  });

  copyBtn?.addEventListener('click', async () => {
    const text = debugLogs
      .map((log) => `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast('Logs copied to clipboard!');
    } catch (err) {
      originalConsoleError('Failed to copy logs:', err);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      toggleDebugConsole();
    }
  });
}
