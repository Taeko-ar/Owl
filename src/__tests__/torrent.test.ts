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
});
