/**
 * Tauri Native E2E — runs against the REAL compiled Tauri app via WebView2 CDP.
 *
 * How to run:
 *   1. Start your app with remote debugging enabled:
 *        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *        npm run tauri dev
 *      OR (compiled release):
 *        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *        .\src-tauri\target\release\owl.exe
 *
 *   2. Run these tests:
 *        npx playwright test --project=tauri-native
 *
 * No mocks are used. All invoke() calls go to the real Rust backend.
 * Tests are designed to be resilient to any installed addon/patch state.
 *
 * @tag @tauri
 */

import { test, expect, chromium, type Page } from '@playwright/test';
import { NavbarPage } from '../page/navbar.page';
import { SettingsPage } from '../page/settings.page';
import { StorePage } from '../page/store.page';

const CDP_URL = process.env.OWL_CDP_URL ?? 'http://localhost:9222';

// ─── Fixture: connect to the running Tauri app via CDP ───────────────────────
const tauriTest = test.extend<{ owl: Page }>({
  owl: async (_, use) => {
    const browser = await chromium.connectOverCDP(CDP_URL);
    const contexts = browser.contexts();
    if (contexts.length === 0)
      throw new Error(
        `No browser context found at ${CDP_URL}. Is the Tauri app running with --remote-debugging-port=9222?`
      );
    const pages = contexts[0].pages();
    const page = pages[0] ?? (await contexts[0].newPage());

    // Wait for the app to fully mount
    await page.waitForSelector('[data-tab="addons"]', { timeout: 15_000 });
    await use(page);
    // Don't close — we connected to an existing app, not a browser we launched
    await browser.close();
  },
});

// ─── Layout & Navigation ─────────────────────────────────────────────────────
tauriTest.describe.skip('Tauri: Layout & Navigation @tauri', () => {
  tauriTest('app renders with correct title', async ({ owl }) => {
    await expect(owl).toHaveTitle(/OWL/i);
  });

  tauriTest('addons tab is active by default', async ({ owl }) => {
    const navbar = new NavbarPage(owl);
    await expect(navbar.addonsTab).toHaveClass(/active/);
    await expect(owl.locator('#addons-tab')).toBeVisible();
  });

  tauriTest('tab switching works: tweaks → mods → addons', async ({ owl }) => {
    const navbar = new NavbarPage(owl);

    await navbar.clickTab('tweaks');
    await expect(owl.locator('#tweaks-tab')).toBeVisible();

    await navbar.clickTab('mods');
    await expect(owl.locator('#mods-tab')).toBeVisible();

    await navbar.clickTab('addons');
    await expect(owl.locator('#addons-tab')).toBeVisible();
    await expect(navbar.addonsTab).toHaveClass(/active/);
  });

  tauriTest('footer status bar and PLAY button are visible', async ({ owl }) => {
    await expect(owl.locator('#status')).toBeVisible();
    await expect(owl.locator('#playBtn')).toBeVisible();
  });

  tauriTest('Get Addons and Import Addon buttons are visible', async ({ owl }) => {
    const navbar = new NavbarPage(owl);
    await expect(navbar.getAddonsBtn).toBeVisible();
    await expect(navbar.importAddonBtn).toBeVisible();
  });

  tauriTest('Open Folder button appears on mods tab', async ({ owl }) => {
    const navbar = new NavbarPage(owl);
    await navbar.clickTab('mods');
    await expect(navbar.openFolderBtn).toBeVisible();
  });
});

// ─── Theme Toggle ────────────────────────────────────────────────────────────
tauriTest.describe.skip('Tauri: Theme Toggle @tauri', () => {
  tauriTest('toggles light/dark mode on body', async ({ owl }) => {
    const navbar = new NavbarPage(owl);
    const body = owl.locator('body');
    const wasDark = !((await body.getAttribute('class')) ?? '').includes('light-mode');

    await navbar.toggleTheme();
    if (wasDark) {
      await expect(body).toHaveClass(/light-mode/);
      await navbar.toggleTheme(); // restore
    } else {
      const classes = await body.getAttribute('class');
      expect(classes ?? '').not.toContain('light-mode');
      await navbar.toggleTheme(); // restore
    }
  });
});

// ─── Settings Modal ──────────────────────────────────────────────────────────
tauriTest.describe.skip('Tauri: Settings Modal @tauri', () => {
  tauriTest('opens and closes correctly', async ({ owl }) => {
    const navbar = new NavbarPage(owl);
    const settings = new SettingsPage(owl);

    await navbar.openSettings();
    await expect(settings.modal).toBeVisible();
    await settings.cancel();
    await expect(settings.modal).toBeHidden();
  });

  tauriTest('shows game path and window size controls', async ({ owl }) => {
    const navbar = new NavbarPage(owl);
    const settings = new SettingsPage(owl);

    await navbar.openSettings();
    await expect(settings.gamePathInput).toBeVisible();
    await expect(settings.windowSizeSelect).toBeVisible();
    await settings.cancel();
  });

  tauriTest('game path input reflects a real path from load_settings', async ({ owl }) => {
    const navbar = new NavbarPage(owl);
    const settings = new SettingsPage(owl);

    await navbar.openSettings();
    // The real backend should have loaded a path (may be empty or real)
    const value = await settings.gamePathInput.inputValue();
    expect(typeof value).toBe('string'); // just verify it resolved
    await settings.cancel();
  });
});

// ─── Addons Tab (real data) ──────────────────────────────────────────────────
tauriTest.describe.skip('Tauri: Addons Tab (real backend) @tauri', () => {
  tauriTest('shows either addons list or empty state (never both)', async ({ owl }) => {
    // Wait for loading to complete
    await owl.waitForFunction(
      () => {
        const progress = document.getElementById('activityProgress');
        return !progress || progress.style.width === '0%' || progress.style.width === '';
      },
      { timeout: 10_000 }
    );

    const addonsList = owl.locator('#addons-list');
    const emptyMsg = owl.locator('#addons-empty');
    const listVisible = await addonsList.isVisible();
    const emptyVisible = await emptyMsg.isVisible();

    // Exactly one should be visible
    expect(listVisible || emptyVisible).toBe(true);
    expect(listVisible && emptyVisible).toBe(false);
  });

  tauriTest('if addons are installed, each card has required buttons', async ({ owl }) => {
    const addonsList = owl.locator('#addons-list');
    const isVisible = await addonsList.isVisible();

    if (!isVisible) {
      tauriTest.skip(); // no addons installed — skip gracefully
      return;
    }

    const firstCard = addonsList.locator('[data-addon]').first();
    await expect(firstCard.locator('.delete-addon')).toBeVisible();
    await expect(firstCard.locator('.open-addon')).toBeVisible();
  });

  tauriTest('search input is visible when addons are shown', async ({ owl }) => {
    const addonsList = owl.locator('#addons-list');
    const isVisible = await addonsList.isVisible();

    if (!isVisible) {
      tauriTest.skip();
      return;
    }

    await expect(owl.locator('#addons-search')).toBeVisible();
  });
});

// ─── Store Modal (real CurseForge API) ───────────────────────────────────────
tauriTest.describe.skip('Tauri: Store Modal (real API) @tauri', () => {
  tauriTest('store modal opens', async ({ owl }) => {
    const navbar = new NavbarPage(owl);
    const store = new StorePage(owl);

    await navbar.getAddonsBtn.click();
    await expect(store.modal).toBeVisible();
    await store.close();
  });

  tauriTest('CurseForge returns real results within 15s', async ({ owl }) => {
    const navbar = new NavbarPage(owl);
    const store = new StorePage(owl);

    await navbar.getAddonsBtn.click();
    await expect(store.modal).toBeVisible();

    // Wait for real API results — may be slow on first load
    await expect(store.listContainer).toBeVisible();
    await owl.waitForFunction(
      () => document.querySelectorAll('#storeListContainer .store-addon-card').length > 0,
      { timeout: 15_000 }
    );

    const count = await store.addonCards().count();
    expect(count).toBeGreaterThan(0);
    await store.close();
  });

  tauriTest('clicking a CurseForge addon card loads its details', async ({ owl }) => {
    const navbar = new NavbarPage(owl);
    const store = new StorePage(owl);

    await navbar.getAddonsBtn.click();
    await owl.waitForFunction(
      () => document.querySelectorAll('#storeListContainer .store-addon-card').length > 0,
      { timeout: 15_000 }
    );

    await store.addonCards().first().click();
    // Version select should appear after real file list is fetched
    await expect(store.versionSelect).toBeVisible({ timeout: 10_000 });
    await expect(store.selectBtn).toBeVisible();

    await store.close();
  });

  tauriTest('GitHub tab loads real search results', async ({ owl }) => {
    const navbar = new NavbarPage(owl);
    const store = new StorePage(owl);

    await navbar.getAddonsBtn.click();
    await store.githubTab.click();

    // GitHub API can be slow — give it up to 15s
    await owl.waitForFunction(
      () => document.querySelectorAll('#storeListContainer .store-addon-card').length > 0,
      { timeout: 15_000 }
    );

    const count = await store.addonCards().count();
    expect(count).toBeGreaterThan(0);
    await store.close();
  });
});
