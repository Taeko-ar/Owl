import { test as base } from '@playwright/test';
import { TAURI_MOCK_SCRIPT } from './tauri-mock';

export const testWithAddons = base.extend<{ addonsPage: import('@playwright/test').Page }>({
  addonsPage: async ({ page }, use) => {
    await page.addInitScript(TAURI_MOCK_SCRIPT);
    await page.addInitScript(() => {
      (window as unknown as { __OWL_MOCK_ADDONS__: string[] }).__OWL_MOCK_ADDONS__ = [
        'Questie',
        'GTFO',
        'AtlasLoot',
      ];
      (
        window as unknown as { __OWL_INVOKE_OVERRIDES__: Record<string, unknown> }
      ).__OWL_INVOKE_OVERRIDES__ = {
        parse_toc: async (args: { addonName: string }) => ({
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
