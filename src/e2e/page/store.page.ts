import { Page, Locator } from '@playwright/test';

/**
 * Page Object for the Addon Store modal (Get Addons).
 */
export class StorePage {
  readonly page: Page;

  // Modal container
  readonly modal: Locator;

  // Sidebar tabs
  readonly curseforgeTab: Locator;
  readonly githubTab: Locator;
  readonly githubWarningIcon: Locator;
  readonly githubWarningTooltip: Locator;

  // Search and filters
  readonly searchInput: Locator;
  readonly searchClearBtn: Locator;
  readonly categorySelect: Locator;
  readonly categoryFilters: Locator;
  readonly githubTagFilters: Locator;

  // Results list
  readonly listContainer: Locator;
  readonly emptyMessage: Locator;

  // Details pane
  readonly detailsContent: Locator;
  readonly versionSelect: Locator;
  readonly selectBtn: Locator;

  // Footer
  readonly selectedCount: Locator;
  readonly reviewBtn: Locator;
  readonly cancelBtn: Locator;

  // Review modal
  readonly reviewModal: Locator;
  readonly reviewModalBody: Locator;
  readonly reviewConfirmBtn: Locator;
  readonly reviewCancelBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    this.modal = page.locator('#storeModal');

    this.curseforgeTab = page.locator('.store-sidebar-tab[data-site="curseforge"]');
    this.githubTab = page.locator('.store-sidebar-tab[data-site="github"]');
    this.githubWarningIcon = page.locator('.store-sidebar-warning svg');
    this.githubWarningTooltip = page.locator('.store-sidebar-warning span[data-i18n]');

    this.searchInput = page.locator('#storeSearchInput');
    this.searchClearBtn = page.locator('#storeSearchClearBtn');
    this.categorySelect = page.locator('#curseforgeCategorySelect');
    this.categoryFilters = page.locator('#curseforgeCategoryFilters');
    this.githubTagFilters = page.locator('#githubTagFilters');

    this.listContainer = page.locator('#storeListContainer');
    this.emptyMessage = page.locator('#storeListEmpty');

    this.detailsContent = page.locator('#storeDetailsContent');
    this.versionSelect = page.locator('#detailVersionSelect');
    this.selectBtn = page.locator('#detailSelectBtn');

    this.selectedCount = page.locator('#storeSelectedCount');
    this.reviewBtn = page.locator('#storeReviewBtn');
    this.cancelBtn = page.locator('#storeCancelBtn');

    this.reviewModal = page.locator('#storeDownloadModal');
    this.reviewModalBody = page.locator('#store-modal-table-body');
    this.reviewConfirmBtn = page.locator('#store-modal-confirm');
    this.reviewCancelBtn = page.locator('#store-modal-cancel');
  }

  /** All addon cards in the list */
  addonCards(): Locator {
    return this.listContainer.locator('.store-addon-card');
  }

  /** A specific addon card by title text */
  addonCard(name: string): Locator {
    return this.listContainer.locator('.store-addon-card', { hasText: name });
  }

  /** Checkbox on a specific addon card */
  addonCheckbox(index = 0): Locator {
    return this.listContainer.locator('.store-addon-checkbox').nth(index);
  }

  async switchToGithub() {
    await this.githubTab.click();
    // Wait for the GitHub tag filters to become visible
    await this.githubTagFilters.waitFor({ state: 'visible', timeout: 3000 });
  }

  async switchToCurseforge() {
    await this.curseforgeTab.click();
    await this.categoryFilters.waitFor({ state: 'visible', timeout: 3000 });
  }

  async search(query: string) {
    await this.searchInput.fill(query);
    await this.searchInput.dispatchEvent('input');
  }

  async clearSearch() {
    await this.searchClearBtn.click();
  }

  async selectCategory(value: string) {
    await this.categorySelect.selectOption(value);
  }

  async clickAddonCard(name: string) {
    await this.addonCard(name).click();
    // Wait for the details pane to update
    await this.detailsContent.locator('#detailVersionSelect').waitFor({ timeout: 5000 });
  }

  async close() {
    await this.cancelBtn.click();
  }

  async closeViaBackdrop() {
    await this.modal.click({ position: { x: 5, y: 5 } });
  }

  isVisible(): Promise<boolean> {
    return this.modal.isVisible();
  }
}
