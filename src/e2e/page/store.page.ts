import { Page, Locator } from '@playwright/test';

export class StorePage {
  readonly page: Page;

  readonly modal: Locator;

  readonly curseforgeTab: Locator;
  readonly githubTab: Locator;
  readonly githubWarningIcon: Locator;
  readonly githubWarningTooltip: Locator;

  readonly searchInput: Locator;
  readonly searchClearBtn: Locator;
  readonly categorySelect: Locator;
  readonly categoryFilters: Locator;
  readonly githubTagFilters: Locator;
  readonly wotlkTagPill: Locator;

  readonly listContainer: Locator;
  readonly emptyMessage: Locator;

  readonly detailsContent: Locator;
  readonly versionSelect: Locator;
  readonly selectBtn: Locator;

  readonly selectedCount: Locator;
  readonly reviewBtn: Locator;
  readonly cancelBtn: Locator;

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
    this.wotlkTagPill = page.locator('.github-tag-pill[data-tag="wotlk"]');

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

  addonCards(): Locator {
    return this.listContainer.locator('.store-addon-card');
  }

  addonCard(name: string): Locator {
    return this.listContainer.locator('.store-addon-card', { hasText: name });
  }

  addonCheckbox(index = 0): Locator {
    return this.listContainer.locator('.store-addon-checkbox').nth(index);
  }

  reviewModalRows(): Locator {
    return this.reviewModalBody.locator('tr');
  }

  async versionOptionCount(): Promise<number> {
    return this.versionSelect.locator('option').count();
  }

  async selectBtnText(): Promise<string> {
    return (await this.selectBtn.innerText()).trim();
  }

  async githubWarningTooltipText(): Promise<string> {
    return (await this.githubWarningTooltip.innerText()).trim();
  }

  async checkAddon(index = 0) {
    await this.addonCheckbox(index).check();
  }

  async uncheckAddon(index = 0) {
    await this.addonCheckbox(index).uncheck();
  }

  async openReview() {
    await this.reviewBtn.click();
  }

  async cancelReview() {
    await this.reviewCancelBtn.click();
  }

  async switchToGithub() {
    await this.githubTab.click();
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
