import { Page, Locator } from '@playwright/test';

/**
 * Page Object for the Addons tab (installed addons view).
 */
export class AddonsPage {
  readonly page: Page;

  readonly section: Locator;
  readonly addonsList: Locator;
  readonly emptyMessage: Locator;
  readonly searchInput: Locator;
  readonly searchClearBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    this.section = page.locator('#addons-tab');
    this.addonsList = page.locator('#addons-list');
    this.emptyMessage = page.locator('#addons-empty');
    this.searchInput = page.locator('#addons-search');
    this.searchClearBtn = page.locator('#addons-search-clear');
  }

  /** Returns all rendered addon row elements */
  addonCards(): Locator {
    return this.addonsList.locator('[data-addon]');
  }

  /** Returns the card for a specific addon by name */
  addonCard(name: string): Locator {
    return this.addonsList.locator(`[data-addon="${name}"]`).first();
  }

  /** Toggle switch for a specific addon */
  addonToggle(name: string): Locator {
    return this.addonsList.locator(`.addon-toggle[data-addon="${name}"]`);
  }

  /** Delete button for a specific addon */
  deleteBtn(name: string): Locator {
    return this.addonsList.locator(`.delete-addon[data-addon="${name}"]`);
  }

  /** Open folder button for a specific addon */
  openFolderBtn(name: string): Locator {
    return this.addonsList.locator(`.open-addon[data-addon="${name}"]`);
  }

  async typeInSearch(text: string) {
    await this.searchInput.fill(text);
    await this.searchInput.dispatchEvent('input');
  }

  async clearSearch() {
    await this.searchClearBtn.click();
  }
}