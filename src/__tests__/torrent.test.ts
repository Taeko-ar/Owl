import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { setupTorrentEvents, checkGamePathValidity } from '../ui/torrent';

const mockInvoke = (globalThis as unknown as { mockInvoke: ReturnType<typeof vi.fn> }).mockInvoke;

describe('Torrent Downloader UI Module', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="gamePath" value="C:\\wow" />
      <button id="downloadGameNavBtn" class="hidden"></button>
      <button id="playBtn"></button>
      <input id="addons-search" />
      <input id="patches-search" />
      <button id="importAddonBtn"></button>
      <button class="nav-tab active" data-tab="addons"></button>
      <button class="nav-tab" data-tab="tweaks"></button>
      <div id="torrentModal" class="hidden">
        <input id="torrentSourceInput" />
        <button id="browseTorrentFileBtn"></button>
        <input id="torrentDestInput" />
        <button id="browseTorrentDestBtn"></button>
        <button id="torrentCancelBtn"></button>
        <button id="torrentStartBtn" disabled></button>
      </div>
      <div id="torrentDrawer" class="hidden">
        <div id="torrentDrawerHeader">
          <span id="torrentDrawerCount">0</span>
          <button id="torrentDrawerPauseAllBtn"></button>
          <button id="torrentDrawerResumeAllBtn" class="hidden"></button>
          <span id="torrentDrawerToggleIcon">▲</span>
        </div>
        <div id="torrentDrawerContent" class="hidden"></div>
      </div>
      <div id="status">Ready</div>
      <div id="activityProgress" style="width: 0%;"></div>
    `;
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('checkGamePathValidity hides button if path is valid', async () => {
    mockInvoke.mockResolvedValue(true);
    await checkGamePathValidity();
    expect(mockInvoke).toHaveBeenCalledWith('validate_game_path', { basePath: 'C:\\wow' });
    const btn = document.getElementById('playBtn');
    expect(btn?.textContent).toBe('PLAY');
    expect(btn?.getAttribute('data-action')).toBe('play');

    expect((document.getElementById('addons-search') as HTMLInputElement).disabled).toBe(false);
    expect((document.getElementById('patches-search') as HTMLInputElement).disabled).toBe(false);
    expect((document.getElementById('importAddonBtn') as HTMLButtonElement).disabled).toBe(false);
    expect(
      (document.querySelector('.nav-tab[data-tab="tweaks"]') as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('checkGamePathValidity shows button if path is invalid', async () => {
    mockInvoke.mockResolvedValue(false);

    // Set active tab to tweaks first to test auto-switching
    const tweaksTab = document.querySelector('.nav-tab[data-tab="tweaks"]') as HTMLButtonElement;
    const addonsTab = document.querySelector('.nav-tab[data-tab="addons"]') as HTMLButtonElement;
    addonsTab.classList.remove('active');
    tweaksTab.classList.add('active');

    const addonsSearch = document.getElementById('addons-search') as HTMLInputElement;
    const patchesSearch = document.getElementById('patches-search') as HTMLInputElement;
    addonsSearch.classList.add('active');
    patchesSearch.classList.add('active');

    // Click handler mock to simulate click trigger behavior
    tweaksTab.addEventListener('click', () => {
      if (tweaksTab.disabled) return;
    });
    addonsTab.addEventListener('click', () => {
      addonsTab.classList.add('active');
      tweaksTab.classList.remove('active');
    });

    await checkGamePathValidity();
    const btn = document.getElementById('playBtn');
    expect(btn?.textContent).toBe('INSTALL');
    expect(btn?.getAttribute('data-action')).toBe('install');

    expect(addonsSearch.disabled).toBe(true);
    expect(patchesSearch.disabled).toBe(true);
    expect(addonsSearch.classList.contains('active')).toBe(false);
    expect(patchesSearch.classList.contains('active')).toBe(false);
    expect((document.getElementById('importAddonBtn') as HTMLButtonElement).disabled).toBe(true);
    expect(tweaksTab.disabled).toBe(true);
    expect(addonsTab.classList.contains('active')).toBe(true);
  });

  it('setupTorrentEvents configures event listeners and manages modal', async () => {
    const reloadMock = vi.fn();
    mockInvoke.mockResolvedValue([]); // active downloads on init

    setupTorrentEvents(reloadMock);

    const btn = document.getElementById('downloadGameNavBtn');
    const modal = document.getElementById('torrentModal');
    const cancel = document.getElementById('torrentCancelBtn');
    const start = document.getElementById('torrentStartBtn') as HTMLButtonElement;
    const srcInput = document.getElementById('torrentSourceInput') as HTMLInputElement;
    const destInput = document.getElementById('torrentDestInput') as HTMLInputElement;

    // 1. Show modal
    btn?.click();
    expect(modal?.classList.contains('hidden')).toBe(false);

    // 2. Cancel modal
    cancel?.click();
    expect(modal?.classList.contains('hidden')).toBe(true);

    // 3. File Browse
    btn?.click();
    mockInvoke.mockResolvedValueOnce('C:\\Users\\Luke\\Downloads\\WoWPatagonia-enUS.torrent');
    const fileBtn = document.getElementById('browseTorrentFileBtn');
    await fileBtn?.dispatchEvent(new MouseEvent('click'));
    expect(mockInvoke).toHaveBeenCalledWith('pick_torrent_file', undefined);
    expect(srcInput.value).toBe('..\\Downloads\\WoWPatagonia-enUS.torrent');
    expect(srcInput.getAttribute('data-full-path')).toBe(
      'C:\\Users\\Luke\\Downloads\\WoWPatagonia-enUS.torrent'
    );

    // 4. Folder Browse
    mockInvoke.mockResolvedValueOnce('D:\\games');
    const folderBtn = document.getElementById('browseTorrentDestBtn');
    await folderBtn?.dispatchEvent(new MouseEvent('click'));
    expect(mockInvoke).toHaveBeenCalledWith('pick_folder', undefined);
    expect(destInput.value).toBe('D:\\games');

    // 5. Start Download
    expect(start.disabled).toBe(false);
    mockInvoke.mockResolvedValueOnce('info_hash_123'); // start_torrent_download
    mockInvoke.mockResolvedValueOnce([]); // refreshActiveDownloads
    await start.dispatchEvent(new MouseEvent('click'));
    expect(mockInvoke).toHaveBeenCalledWith('start_torrent_download', {
      magnetOrFile: 'C:\\Users\\Luke\\Downloads\\WoWPatagonia-enUS.torrent',
      destDir: 'D:\\games',
    });
    expect(modal?.classList.contains('hidden')).toBe(true);
  });

  it('setupTorrentEvents handles pause and resume all', async () => {
    mockInvoke.mockResolvedValue([]);
    setupTorrentEvents(vi.fn());

    const pauseBtn = document.getElementById('torrentDrawerPauseAllBtn');
    const resumeBtn = document.getElementById('torrentDrawerResumeAllBtn');

    await pauseBtn?.dispatchEvent(new MouseEvent('click'));
    expect(mockInvoke).toHaveBeenCalledWith('pause_torrent_downloads', undefined);
    expect(pauseBtn?.classList.contains('hidden')).toBe(true);
    expect(resumeBtn?.classList.contains('hidden')).toBe(false);

    await resumeBtn?.dispatchEvent(new MouseEvent('click'));
    expect(mockInvoke).toHaveBeenCalledWith('resume_torrent_downloads', undefined);
    expect(resumeBtn?.classList.contains('hidden')).toBe(true);
    expect(pauseBtn?.classList.contains('hidden')).toBe(false);
  });

  it('covers progress drawer visibility, cancellation, state rendering, and event listeners', async () => {
    const { listen } = await import('@tauri-apps/api/event');
    mockInvoke.mockResolvedValue([]);
    const reloadMock = vi.fn();
    setupTorrentEvents(reloadMock);

    // 1. Drawer Header click expands / collapses drawer content
    const drawerHeader = document.getElementById('torrentDrawerHeader');
    const drawerContent = document.getElementById('torrentDrawerContent');
    const toggleIcon = document.getElementById('torrentDrawerToggleIcon');
    expect(drawerContent?.classList.contains('hidden')).toBe(true);
    expect(toggleIcon?.textContent).toBe('▲');

    drawerHeader?.click();
    expect(drawerContent?.classList.contains('hidden')).toBe(false);
    expect(toggleIcon?.textContent).toBe('▼');

    drawerHeader?.click();
    expect(drawerContent?.classList.contains('hidden')).toBe(true);

    // 2. window.__triggerTorrentProgress triggers rendering and progress UI updates
    const trigger = window.__triggerTorrentProgress;
    expect(trigger).toBeTypeOf('function');

    // Case A: Allocated/initializing without downloaded bytes
    trigger!({
      downloads: [
        {
          infoHash: 'hash1',
          name: 'Torrent A',
          downloadedBytes: 0,
          totalBytes: 1000,
          speedBps: 0,
          peers: 0,
          isUnpacking: false,
          isPaused: false,
          error: null,
          state: 'initializing',
        },
      ],
    });
    expect(document.getElementById('playBtn')?.textContent).toContain('ALLOCATING...');

    // Case B: Verifying with downloaded bytes
    trigger!({
      downloads: [
        {
          infoHash: 'hash1',
          name: 'Torrent A',
          downloadedBytes: 500,
          totalBytes: 1000,
          speedBps: 0,
          peers: 0,
          isUnpacking: false,
          isPaused: false,
          error: null,
          state: 'initializing',
        },
      ],
    });
    expect(document.getElementById('playBtn')?.textContent).toContain('VERIFYING 50%');

    // Case C: Downloading client normal state
    trigger!({
      downloads: [
        {
          infoHash: 'hash1',
          name: 'Torrent A',
          downloadedBytes: 400,
          totalBytes: 1000,
          speedBps: 100,
          peers: 5,
          isUnpacking: false,
          isPaused: false,
          error: null,
          state: 'downloading',
        },
      ],
    });
    expect(document.getElementById('playBtn')?.textContent).toContain('DOWNLOADING 40%');
    expect(drawerContent?.innerHTML).toContain('400 Bytes / 1000 Bytes');

    // Case D: Unpacking / Extracting state
    trigger!({
      downloads: [
        {
          infoHash: 'hash1',
          name: 'Torrent A',
          downloadedBytes: 1000,
          totalBytes: 1000,
          speedBps: 0,
          peers: 0,
          isUnpacking: true,
          isPaused: false,
          error: null,
          state: 'unpacking',
        },
      ],
    });
    expect(document.getElementById('playBtn')?.textContent).toContain('EXTRACTING...');

    // Case E: Paused state
    trigger!({
      downloads: [
        {
          infoHash: 'hash1',
          name: 'Torrent A',
          downloadedBytes: 500,
          totalBytes: 1000,
          speedBps: 0,
          peers: 0,
          isUnpacking: false,
          isPaused: true,
          error: null,
          state: 'paused',
        },
      ],
    });
    expect(document.getElementById('playBtn')?.textContent).toContain('PAUSED');

    // Case F: Error state
    trigger!({
      downloads: [
        {
          infoHash: 'hash1',
          name: 'Torrent A',
          downloadedBytes: 500,
          totalBytes: 1000,
          speedBps: 0,
          peers: 0,
          isUnpacking: false,
          isPaused: false,
          error: 'Disk Full',
          state: 'error',
        },
      ],
    });
    expect(drawerContent?.innerHTML).toContain('Error: Disk Full');

    // 3. Cancel download button click handler
    mockInvoke.mockResolvedValueOnce(null); // cancel_torrent_download
    mockInvoke.mockResolvedValueOnce([]); // get_active_downloads inside refresh
    drawerHeader?.click(); // show content
    const cancelBtn = drawerContent?.querySelector('.cancel-dl-btn') as HTMLElement;
    expect(cancelBtn).not.toBeNull();
    cancelBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockInvoke).toHaveBeenCalledWith('cancel_torrent_download', { infoHash: 'hash1' });

    // Cancel download button click when mockInvoke fails
    trigger!({
      downloads: [
        {
          infoHash: 'hash1',
          name: 'Torrent A',
          downloadedBytes: 500,
          totalBytes: 1000,
          speedBps: 0,
          peers: 0,
          isUnpacking: false,
          isPaused: false,
          error: null,
          state: 'downloading',
        },
      ],
    });
    mockInvoke.mockRejectedValueOnce('Cancel failed');
    const cancelBtn2 = drawerContent?.querySelector('.cancel-dl-btn') as HTMLElement;
    cancelBtn2.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 4. Trigger events via listen mocks
    const listenMock = vi.mocked(listen);

    // torrent-progress event listener
    const progressCall = listenMock.mock.calls.find((c) => c[0] === 'torrent-progress');
    if (progressCall) {
      const progressCb = progressCall[1];
      progressCb({
        payload: {
          downloads: [
            {
              infoHash: 'hash2',
              name: 'Torrent B',
              downloadedBytes: 800,
              totalBytes: 1000,
              speedBps: 200,
              peers: 2,
              isUnpacking: false,
              isPaused: false,
              error: null,
              state: 'downloading',
            },
          ],
        },
      });
      expect(document.getElementById('playBtn')?.textContent).toContain('DOWNLOADING 80%');
    }

    // torrent-completed event listener
    const completedCall = listenMock.mock.calls.find((c) => c[0] === 'torrent-completed');
    if (completedCall) {
      const completedCb = completedCall[1];
      mockInvoke.mockResolvedValueOnce({ path: 'C:\\wow' }); // load_settings
      mockInvoke.mockResolvedValueOnce(true); // validate_game_path
      mockInvoke.mockResolvedValueOnce([]); // get_active_downloads
      await completedCb({ payload: 'Install completed' });
      expect(document.getElementById('status')?.textContent).toBe('Ready');
      expect(reloadMock).toHaveBeenCalled();
    }

    // torrent-completed event listener failure path
    if (completedCall) {
      const completedCb = completedCall[1];
      mockInvoke.mockRejectedValueOnce('Load settings failed');
      mockInvoke.mockResolvedValueOnce(true); // validate_game_path
      mockInvoke.mockResolvedValueOnce([]); // get_active_downloads
      await completedCb({ payload: 'Install completed' });
    }

    // torrent-error event listener
    const errorCall = listenMock.mock.calls.find((c) => c[0] === 'torrent-error');
    if (errorCall) {
      const errorCb = errorCall[1];
      errorCb({ payload: 'Download failed message' });
      expect(document.getElementById('status')?.textContent).toBe('Ready');
    }

    // 5. Test installChoiceModal events
    document.body.innerHTML += `
      <div id="installChoiceModal" class="hidden">
        <button id="installLocateBtn"></button>
        <button id="installTorrentBtn"></button>
        <button id="installChoiceCancelBtn"></button>
      </div>
      <input type="checkbox" id="stayOpen" />
      <select id="windowSize"><option value="1280x720"></option></select>
    `;
    setupTorrentEvents(reloadMock);

    // cancel button closes modal
    const locateModal = document.getElementById('installChoiceModal');
    locateModal?.classList.remove('hidden');
    document.getElementById('installChoiceCancelBtn')?.click();
    expect(locateModal?.classList.contains('hidden')).toBe(true);

    // backdrop click closes modal
    locateModal?.classList.remove('hidden');
    locateModal?.click();
    expect(locateModal?.classList.contains('hidden')).toBe(true);

    // installTorrentBtn click closes modal and opens torrent source
    locateModal?.classList.remove('hidden');
    document.getElementById('installTorrentBtn')?.click();
    expect(locateModal?.classList.contains('hidden')).toBe(true);

    // installLocateBtn click browse success
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'pick_folder') return Promise.resolve('C:\\new_path');
      if (cmd === 'save_settings') return Promise.resolve(null);
      if (cmd === 'validate_game_path') return Promise.resolve(true);
      if (cmd === 'get_active_downloads') return Promise.resolve([]);
      return Promise.resolve();
    });
    locateModal?.classList.remove('hidden');
    document.getElementById('installLocateBtn')?.dispatchEvent(new MouseEvent('click'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(locateModal?.classList.contains('hidden')).toBe(true);

    // installLocateBtn click fails
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'pick_folder') return Promise.reject('Browse error');
      return Promise.resolve();
    });
    locateModal?.classList.remove('hidden');
    document.getElementById('installLocateBtn')?.dispatchEvent(new MouseEvent('click'));
    await new Promise((resolve) => setTimeout(resolve, 15));
  });

  it('covers catch blocks and edge branches in torrent.ts', async () => {
    const reloadMock = vi.fn();
    mockInvoke.mockResolvedValue([]);
    setupTorrentEvents(reloadMock);

    // 1. checkGamePathValidity catch block
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'validate_game_path') return Promise.reject('Validation failed');
      return Promise.resolve();
    });
    // Set tweaks active to cover active tweaks tab reset path inside catch
    const tweaksTab = document.querySelector('.nav-tab[data-tab="tweaks"]') as HTMLButtonElement;
    tweaksTab.classList.add('active');
    await checkGamePathValidity();
    expect(document.getElementById('playBtn')?.textContent).toContain('INSTALL');

    // 2. shortenPath edge cases
    const { shortenPath } = await import('../ui/torrent');
    expect(shortenPath('C:\\wow\\')).toBe('..\\C:\\wow');
    expect(shortenPath('wow')).toBe('wow');
    expect(shortenPath('')).toBe('');

    // 3. input listeners
    const srcInput = document.getElementById('torrentSourceInput') as HTMLInputElement;
    const destInput = document.getElementById('torrentDestInput') as HTMLInputElement;
    srcInput.setAttribute('data-full-path', 'C:\\wow\\file.torrent');
    srcInput.dispatchEvent(new Event('input'));
    expect(srcInput.getAttribute('data-full-path')).toBeNull();
    destInput.dispatchEvent(new Event('input'));

    // 4. torrentModal backdrop click
    const torrentModal = document.getElementById('torrentModal') as HTMLElement;
    torrentModal.classList.remove('hidden');
    
    // Create a child element to click inside the modal
    const modalChild = document.createElement('div');
    torrentModal.appendChild(modalChild);
    modalChild.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(torrentModal.classList.contains('hidden')).toBe(false);
    
    // Dispatch click directly on torrentModal (backdrop)
    Object.defineProperty(MouseEvent.prototype, 'target', { value: torrentModal, configurable: true });
    torrentModal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(torrentModal.classList.contains('hidden')).toBe(true);

    // 5. error rejects in browse buttons
    // pick_torrent_file reject
    mockInvoke.mockRejectedValueOnce('Pick file error');
    await document.getElementById('browseTorrentFileBtn')?.dispatchEvent(new MouseEvent('click'));
    
    // pick_folder reject
    mockInvoke.mockRejectedValueOnce('Pick folder error');
    await document.getElementById('browseTorrentDestBtn')?.dispatchEvent(new MouseEvent('click'));

    // start_torrent_download reject
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'start_torrent_download') return Promise.reject('Start download error');
      return Promise.resolve();
    });
    srcInput.value = 'magnet:?xt=urn:btih:hash';
    destInput.value = 'D:\\games';
    await document.getElementById('torrentStartBtn')?.dispatchEvent(new MouseEvent('click'));

    // pause_torrent_downloads reject
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'pause_torrent_downloads') return Promise.reject('Pause downloads error');
      return Promise.resolve();
    });
    await document.getElementById('torrentDrawerPauseAllBtn')?.dispatchEvent(new MouseEvent('click'));

    // resume_torrent_downloads reject
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'resume_torrent_downloads') return Promise.reject('Resume downloads error');
      return Promise.resolve();
    });
    await document.getElementById('torrentDrawerResumeAllBtn')?.dispatchEvent(new MouseEvent('click'));

    // refreshActiveDownloads reject (get_active_downloads reject)
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'start_torrent_download') return Promise.resolve('hash');
      if (cmd === 'get_active_downloads') return Promise.reject('Get active downloads error');
      return Promise.resolve();
    });
    await document.getElementById('torrentStartBtn')?.dispatchEvent(new MouseEvent('click'));
  });

  it('covers missing elements in progress UI updates', async () => {
    mockInvoke.mockResolvedValue([]);
    setupTorrentEvents(vi.fn());

    // Remove playBtn, status, activityProgress from DOM
    document.getElementById('playBtn')?.remove();
    document.getElementById('status')?.remove();
    document.getElementById('activityProgress')?.remove();

    const trigger = window.__triggerTorrentProgress;
    
    // Allocating / Initializing
    trigger!({
      downloads: [
        {
          infoHash: 'hash1',
          name: 'Torrent A',
          downloadedBytes: 0,
          totalBytes: 1000,
          speedBps: 0,
          peers: 0,
          isUnpacking: false,
          isPaused: false,
          error: null,
          state: 'initializing',
        },
      ],
    });
    
    // Verifying
    trigger!({
      downloads: [
        {
          infoHash: 'hash1',
          name: 'Torrent A',
          downloadedBytes: 500,
          totalBytes: 1000,
          speedBps: 0,
          peers: 0,
          isUnpacking: false,
          isPaused: false,
          error: null,
          state: 'initializing',
        },
      ],
    });

    // Downloading
    trigger!({
      downloads: [
        {
          infoHash: 'hash1',
          name: 'Torrent A',
          downloadedBytes: 500,
          totalBytes: 1000,
          speedBps: 100,
          peers: 1,
          isUnpacking: false,
          isPaused: false,
          error: null,
          state: 'downloading',
        },
      ],
    });

    // Unpacking / Extracting
    trigger!({
      downloads: [
        {
          infoHash: 'hash1',
          name: 'Torrent A',
          downloadedBytes: 1000,
          totalBytes: 1000,
          speedBps: 0,
          peers: 0,
          isUnpacking: true,
          isPaused: false,
          error: null,
          state: 'unpacking',
        },
      ],
    });

    // Paused
    trigger!({
      downloads: [
        {
          infoHash: 'hash1',
          name: 'Torrent A',
          downloadedBytes: 500,
          totalBytes: 1000,
          speedBps: 0,
          peers: 0,
          isUnpacking: false,
          isPaused: true,
          error: null,
          state: 'paused',
        },
      ],
    });

    // Empty downloads
    trigger!({ downloads: [] });
  });
});
