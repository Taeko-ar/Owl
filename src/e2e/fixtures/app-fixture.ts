import { test as base, expect, Page } from '@playwright/test';
import { TAURI_MOCK_SCRIPT } from '../fixtures/tauri-mock';

export const test = base.extend<{
  appPage: Page;

  setInvokeResponse: (cmd: string, response: unknown) => Promise<void>;

  setMockAddons: (addons: string[]) => Promise<void>;

  setMockPatches: (patches: string[]) => Promise<void>;
}>({
  appPage: async ({ page }, use) => {
    await page.addInitScript(TAURI_MOCK_SCRIPT);
    await page.goto('/');

    await page.waitForSelector('[data-tab="addons"]', { timeout: 8000 });
    await use(page);
  },

  setInvokeResponse: async ({ page }, use) => {
    const setter = async (cmd: string, response: unknown) => {
      await page.evaluate(
        ({ cmd, response }) => {
          (window as any).__OWL_INVOKE_OVERRIDES__[cmd] = () => Promise.resolve(response);
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
