import { test, expect } from '../fixtures/app-fixture';
import { TorrentPage } from '../page/torrent.page';
import { TAURI_MOCK_SCRIPT } from '../fixtures/tauri-mock';

declare global {
  interface Window {
    checkGamePathValidity?: () => Promise<void>;
    __OWL_MOCK_VALIDATE_GAME_PATH__?: boolean;
    __OWL_MOCK_ACTIVE_DOWNLOADS__?: Array<{
      id: number;
      name: string;
      destDir: string;
      infoHash: string;
      isUnpacking: boolean;
      isPaused: boolean;
      error: string | null;
    }>;
    __triggerTorrentProgress?: (payload: {
      downloads: Array<{
        infoHash: string;
        name: string;
        downloadedBytes: number;
        totalBytes: number;
        speedBps: number;
        peers: number;
        isUnpacking: boolean;
        isPaused: boolean;
        error: string | null;
        state: string;
      }>;
    }) => void;
  }
}

test.describe('Torrent Client Downloader', () => {
  test('Download Game button is visible if game path is invalid/empty', async ({ page }) => {
    await page.addInitScript(TAURI_MOCK_SCRIPT);
    await page.addInitScript(() => {
      window.__OWL_MOCK_VALIDATE_GAME_PATH__ = false;
    });
    await page.goto('/');
    await page.waitForSelector('[data-tab="addons"]', { timeout: 8000 });

    const torrentPage = new TorrentPage(page);
    await expect(torrentPage.playBtn).toHaveText('INSTALL', { ignoreCase: true });
  });

  test('opens torrent modal, handles folder picker and cancels', async ({ page }) => {
    await page.addInitScript(TAURI_MOCK_SCRIPT);
    await page.addInitScript(() => {
      window.__OWL_MOCK_VALIDATE_GAME_PATH__ = false;
    });
    await page.goto('/');
    await page.waitForSelector('[data-tab="addons"]', { timeout: 8000 });

    const torrentPage = new TorrentPage(page);
    await expect(torrentPage.playBtn).toHaveText('INSTALL', { ignoreCase: true });
    await torrentPage.openModal();
    await expect(torrentPage.modal).toBeVisible();
    await expect(torrentPage.startBtn).toBeDisabled();

    // Fill source and destination
    await torrentPage.fillSource('magnet:?xt=urn:btih:test');
    await torrentPage.destInput.evaluate((el: HTMLInputElement) => {
      el.value = 'C:\\Downloads';
      el.dispatchEvent(new Event('input'));
    });
    await expect(torrentPage.startBtn).toBeEnabled();

    await torrentPage.closeModal();
    await expect(torrentPage.modal).toBeHidden();
  });

  test('torrent progress list updates drawer UI', async ({ appPage, page }) => {
    const torrentPage = new TorrentPage(appPage);
    await page.waitForFunction(() => typeof window.checkGamePathValidity === 'function');

    // Emit progress event
    await page.evaluate(() => {
      // Mock active downloads response
      window.__OWL_MOCK_ACTIVE_DOWNLOADS__ = [
        {
          id: 1,
          name: 'World of Warcraft 3.3.5a',
          destDir: 'C:\\Games',
          infoHash: 'info_hash_abc',
          isUnpacking: false,
          isPaused: false,
          error: null,
        },
      ];

      // Dispatch tauri event
      const eventPayload = {
        downloads: [
          {
            infoHash: 'info_hash_abc',
            name: 'World of Warcraft 3.3.5a',
            downloadedBytes: 524288000,
            totalBytes: 1048576000,
            speedBps: 5242880,
            peers: 12,
            isUnpacking: false,
            isPaused: false,
            error: null,
            state: 'live',
          },
        ],
      };

      // Dispatch progress using test hook
      const trigger = window.__triggerTorrentProgress;
      if (trigger) {
        trigger(eventPayload);
      }
    });

    await expect(torrentPage.drawer).toBeVisible();
    await expect(torrentPage.drawerCount).toHaveText('1');
  });
});
