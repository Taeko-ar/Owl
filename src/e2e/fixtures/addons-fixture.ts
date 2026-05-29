import { test as base } from '@playwright/test';
import { TAURI_MOCK_SCRIPT } from './tauri-mock';

/**
 * A fixture that sets up an addon-populated page by injecting mock data
 * BEFORE navigation via addInitScript. Use this when tests need the
 * installed addons list to be populated on load.
 */
export const testWithAddons = base.extend<{ addonsPage: import('@playwright/test').Page }>({
  addonsPage: async ({ page }, use) => {
    await page.addInitScript(TAURI_MOCK_SCRIPT);
    await page.addInitScript(() => {
      (window as any).__OWL_MOCK_ADDONS__ = ['Questie', 'GTFO', 'AtlasLoot'];
      (window as any).__OWL_INVOKE_OVERRIDES__ = {
        parse_toc: async (args: any) => ({
          name: args.addonName,
          title: args.addonName,
          author: 'TestAuthor',
          version: '1.0.0',
          hasGit: false,
          description: 'A great addon',
        }),
      };
    });
    await page.goto('http://localhost:4173/');
    await page.waitForSelector('[data-tab="addons"]', { timeout: 8000 });
    await page.waitForSelector('#addons-list [data-addon]', { timeout: 8000 });
    await use(page);
  },
});
