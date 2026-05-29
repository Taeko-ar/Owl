import { test as base, expect, Page } from '@playwright/test';
import { TAURI_MOCK_SCRIPT } from '../fixtures/tauri-mock';

/**
 * Extended Playwright test fixture that:
 * 1. Injects the Tauri invoke mock BEFORE the page loads
 * 2. Navigates to the app and waits for the UI to be ready
 * 3. Exposes helpers to set per-test invoke overrides
 */
export const test = base.extend<{
  /** Navigate to the app with mocks already injected */
  appPage: Page;
  /** Override a specific Tauri command response for this test */
  setInvokeResponse: (cmd: string, response: unknown) => Promise<void>;
  /** Inject mock addon list so the installed addons tab renders content */
  setMockAddons: (addons: string[]) => Promise<void>;
  /** Inject mock patches list */
  setMockPatches: (patches: string[]) => Promise<void>;
}>({
  appPage: async ({ page }, use) => {
    // Inject mock BEFORE navigation so the module is already stubbed when main.ts runs
    await page.addInitScript(TAURI_MOCK_SCRIPT);
    await page.goto('/');
    // Wait for the nav tabs to be mounted (app is ready)
    await page.waitForSelector('[data-tab="addons"]', { timeout: 8000 });
    await use(page);
  },

  setInvokeResponse: async ({ page }, use) => {
    const setter = async (cmd: string, response: unknown) => {
      await page.evaluate(
        ({ cmd, response }) => {
          (window as any).__OWL_INVOKE_OVERRIDES__[cmd] = () =>
            Promise.resolve(response);
        },
        { cmd, response }
      );
    };
    await use(setter);
  },

  setMockAddons: async ({ page }, use) => {
    const setter = async (addons: string[]) => {
      await page.evaluate((addons) => {
        (window as any).__OWL_MOCK_ADDONS__ = addons;
      }, addons);
    };
    await use(setter);
  },

  setMockPatches: async ({ page }, use) => {
    const setter = async (patches: string[]) => {
      await page.evaluate((patches) => {
        (window as any).__OWL_MOCK_PATCHES__ = patches;
      }, patches);
    };
    await use(setter);
  },
});

export { expect };
