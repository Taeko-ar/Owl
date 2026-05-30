import { Page, Locator } from '@playwright/test';

export class PatchesPage {
  readonly page: Page;

  readonly emptyMessage: Locator;
  readonly list: Locator;
  readonly searchInput: Locator;

  constructor(page: Page) {
    this.page = page;

    this.emptyMessage = page.locator('#patches-empty');
    this.list = page.locator('#patches-list');
    this.searchInput = page.locator('#patches-search');
  }
}
