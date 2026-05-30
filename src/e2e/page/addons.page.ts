import { Page, Locator } from '@playwright/test';

export class AddonsPage {
  readonly page: Page;

  readonly section: Locator;
  readonly addonsList: Locator;
  readonly emptyMessage: Locator;
  readonly searchContainer: Locator;
  readonly searchInput: Locator;
  readonly searchClearBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    this.section = page.locator('#addons-tab');
    this.addonsList = page.locator('#addons-list');
    this.emptyMessage = page.locator('#addons-empty');
    this.searchContainer = page.locator('#addons-tab .search-container');
    this.searchInput = page.locator('#addons-search');
    this.searchClearBtn = page.locator('#addons-search-clear');
  }

  addonCards(): Locator {
    return this.addonsList.locator(':scope > [data-addon]');
  }

  addonCard(name: string): Locator {
    return this.addonsList.locator(`[data-addon="${name}"]`).first();
  }

  addonToggle(name: string): Locator {
    return this.addonsList.locator(`.addon-toggle[data-addon="${name}"]`);
  }

  deleteBtn(name: string): Locator {
    return this.addonsList.locator(`.delete-addon[data-addon="${name}"]`);
  }

  openFolderBtn(name: string): Locator {
    return this.addonsList.locator(`.open-addon[data-addon="${name}"]`);
  }

  firstAddonToggle(): Locator {
    return this.addonCards().first().locator('.addon-toggle');
  }

  firstAddonDeleteBtn(): Locator {
    return this.addonCards().first().locator('.delete-addon');
  }

  firstAddonOpenBtn(): Locator {
    return this.addonCards().first().locator('.open-addon');
  }

  async typeInSearch(text: string) {
    await this.searchContainer.hover();
    await this.searchInput.click();
    await this.searchInput.fill(text);
    await this.searchInput.dispatchEvent('input');
  }

  async clearSearch() {
    await this.searchClearBtn.click();
  }
}
