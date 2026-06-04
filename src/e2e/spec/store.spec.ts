import { test, expect } from '../fixtures/app-fixture';
import { testWithAddons } from '../fixtures/addons-fixture';
import { NavbarPage } from '../page/navbar.page';
import { StorePage } from '../page/store.page';

test.describe('Store Modal — Open/Close', () => {
  let navbar: NavbarPage;
  let store: StorePage;

  test.beforeEach(async ({ appPage }) => {
    navbar = new NavbarPage(appPage);
    store = new StorePage(appPage);
  });

  test('store modal opens when clicking Get Addons', async () => {
    await expect(store.modal).toBeHidden();
    await navbar.openStore();
    await expect(store.modal).toBeVisible();
  });

  test('store modal closes when clicking Cancel', async () => {
    await navbar.openStore();
    await expect(store.modal).toBeVisible();
    await store.close();
    await expect(store.modal).toBeHidden();
  });

  test('store modal closes when clicking backdrop', async () => {
    await navbar.openStore();
    await expect(store.modal).toBeVisible();
    await store.closeViaBackdrop();
    await expect(store.modal).toBeHidden();
  });
});

test.describe('Store Modal — CurseForge Tab', () => {
  let store: StorePage;

  test.beforeEach(async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    store = new StorePage(appPage);
    await navbar.openStore();
    await store.addonCards().first().waitFor({ state: 'visible' });
  });

  test('renders CurseForge addon cards', async () => {
    await expect(store.addonCards()).toHaveCount(2);
    await expect(store.addonCard('Questie')).toBeVisible();
    await expect(store.addonCard('Deadly Boss Mods')).toBeVisible();
  });

  test('CurseForge tab is active by default and category filters are visible', async () => {
    await expect(store.curseforgeTab).toHaveClass(/active/);
    await expect(store.categoryFilters).toBeVisible();
    await expect(store.githubTagFilters).toBeHidden();
  });

  test('search input clears results and re-fetches', async () => {
    await store.search('Questie');
    await expect(store.searchClearBtn).toBeVisible();
    await store.clearSearch();
    await expect(store.searchInput).toHaveValue('');
    await expect(store.searchClearBtn).toBeHidden();
  });

  test('selecting a category triggers a new search', async () => {
    await store.selectCategory('1018');
    await expect(store.addonCards().first()).toBeVisible();
  });

  test('clicking an addon card loads version selector in details pane', async () => {
    await store.clickAddonCard('Questie');
    await expect(store.versionSelect).toBeVisible();
    await expect(store.selectBtn).toBeVisible();
  });

  test('details pane shows author info after clicking a card', async () => {
    await store.clickAddonCard('Questie');
    await expect(store.detailsContent).toContainText('QuestieDevs');
  });

  test('version selector has at least one option after selecting addon', async () => {
    await store.clickAddonCard('Questie');
    const optionCount = await store.versionOptionCount();
    expect(optionCount).toBeGreaterThan(0);
  });

  test('Download button text is "Download" initially', async () => {
    await store.clickAddonCard('Questie');
    expect(await store.selectBtnText()).toBe('Download');
  });

  test('clicking Download queues the addon and updates selected count', async () => {
    await expect(store.selectedCount).toHaveText('0');
    await expect(store.reviewBtn).toBeDisabled();
    await store.checkAddon(0);
    await expect(store.selectedCount).toHaveText('1');
    await expect(store.reviewBtn).toBeEnabled();
  });

  test('unchecking an addon decrements selected count', async () => {
    await store.checkAddon(0);
    await expect(store.selectedCount).toHaveText('1');
    await store.uncheckAddon(0);
    await expect(store.selectedCount).toHaveText('0');
    await expect(store.reviewBtn).toBeDisabled();
  });

  test('clicking Review Downloads opens review modal', async () => {
    await store.checkAddon(0);
    await store.openReview();
    await expect(store.reviewModal).toBeVisible();
  });

  test('review modal lists selected addons in table', async () => {
    await store.checkAddon(0);
    await store.openReview();
    await expect(store.reviewModalBody).toBeVisible();
    await expect(store.reviewModalRows()).toHaveCount(1);
  });

  test('cancelling review modal returns to store', async () => {
    await store.checkAddon(0);
    await store.openReview();
    await store.cancelReview();
    await expect(store.reviewModal).toBeHidden();
    await expect(store.modal).toBeVisible();
  });
});

test.describe('Store Modal — GitHub Tab', () => {
  let store: StorePage;

  test.beforeEach(async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    store = new StorePage(appPage);
    await navbar.openStore();
    await store.listContainer.waitFor({ state: 'visible' });
    await store.switchToGithub();
  });

  test('GitHub tab becomes active after clicking', async () => {
    await expect(store.githubTab).toHaveClass(/active/);
  });

  test('GitHub tag pills are visible after switching to GitHub tab', async () => {
    await expect(store.githubTagFilters).toBeVisible();
    await expect(store.categoryFilters).toBeHidden();
  });

  test('wotlk tag pill is active by default on GitHub tab', async () => {
    await expect(store.wotlkTagPill).toHaveClass(/active/);
  });

  test('GitHub warning tooltip is visible in the DOM', async () => {
    await expect(store.githubWarningTooltip).toBeAttached();
    const text = await store.githubWarningTooltipText();
    expect(text.length).toBeGreaterThan(0);
  });
});

test.describe('Store Modal — Installed Addon indicator', () => {
  let navbar: NavbarPage;
  let store: StorePage;

  test.beforeEach(async ({ appPage, setMockAddons }) => {
    navbar = new NavbarPage(appPage);
    store = new StorePage(appPage);
    await setMockAddons(['Questie']);
    await navbar.openStore();
    await store.addonCards().first().waitFor({ state: 'visible' });
  });

  test('displays Installed badge on card and disables selection', async () => {
    const questieCard = store.addonCard('Questie');
    await expect(questieCard.locator('span:has-text("Installed")')).toBeVisible();

    const checkbox = questieCard.locator('.store-addon-checkbox');
    await expect(checkbox).toBeDisabled();

    await store.clickAddonCard('Questie');
    await expect(store.selectBtn).toBeDisabled();
    await expect(store.selectBtn).toHaveText('Installed');
  });

  test('shows replacement warning modal when download_and_extract_addon returns REPLACE_WARNING', async ({
    appPage,
  }) => {
    // Override download_and_extract_addon to return REPLACE_WARNING
    await appPage.evaluate(() => {
      const win = window as unknown as { __OWL_INVOKE_OVERRIDES__: Record<string, () => unknown> };
      win.__OWL_INVOKE_OVERRIDES__['download_and_extract_addon'] = () => {
        return Promise.reject('REPLACE_WARNING:temp|Questie');
      };
      win.__OWL_INVOKE_OVERRIDES__['cleanup_temp_archive'] = () => Promise.resolve();
    });

    // Uncheck/check or select another addon since Questie is marked installed and disabled.
    // Actually, setMockAddons has ['Questie'], making Questie disabled. We can just use the checkbox of the second card (Deadly Boss Mods).
    await store.clickAddonCard('Deadly Boss Mods');
    await store.checkAddon(1); // Select Deadly Boss Mods (index 1)
    await store.openReview();

    // Click the confirm button in review modal to start installation
    const confirmBtn = appPage.locator('#store-modal-confirm');
    await confirmBtn.click();

    // Verify replaceWarningModal is shown
    const warningModal = appPage.locator('#replaceWarningModal');
    await expect(warningModal).toBeVisible();
    await expect(warningModal.locator('#replaceWarningList')).toContainText('Questie');

    // Click cancel button on warning modal
    const cancelBtn = appPage.locator('#replaceWarningCancelBtn');
    await cancelBtn.click();
    await expect(warningModal).toBeHidden();
  });
});

testWithAddons.describe('Store Modal — GitHub Tab Search', () => {
  let store: StorePage;

  testWithAddons.beforeEach(async ({ addonsPage }) => {
    const navbar = new NavbarPage(addonsPage);
    store = new StorePage(addonsPage);
    await navbar.openStore();
    await store.listContainer.waitFor({ state: 'visible' });
  });

  testWithAddons('GitHub search renders addon cards after tab switch', async () => {
    await store.switchToGithub();
    await expect(store.addonCards().first()).toBeVisible({ timeout: 6000 });
  });
});
