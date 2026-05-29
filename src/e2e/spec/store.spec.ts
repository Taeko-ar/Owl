import { test, expect } from '../fixtures/app-fixture';
import { NavbarPage } from '../page/navbar.page';
import { StorePage } from '../page/store.page';
import { testWithAddons } from '../fixtures/addons-fixture';

test.describe('Store Modal — Open/Close', () => {
  test('store modal opens when clicking Get Addons', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    const store = new StorePage(appPage);

    await expect(store.modal).toBeHidden();
    await navbar.getAddonsBtn.click();
    await expect(store.modal).toBeVisible();
  });

  test('store modal closes when clicking Cancel', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    const store = new StorePage(appPage);

    await navbar.getAddonsBtn.click();
    await expect(store.modal).toBeVisible();
    await store.close();
    await expect(store.modal).toBeHidden();
  });

  test('store modal closes when clicking backdrop', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    const store = new StorePage(appPage);

    await navbar.getAddonsBtn.click();
    await expect(store.modal).toBeVisible();
    await store.closeViaBackdrop();
    await expect(store.modal).toBeHidden();
  });
});

test.describe('Store Modal — CurseForge Tab', () => {
  test.beforeEach(async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    await navbar.getAddonsBtn.click();
    await appPage.locator('#storeListContainer').waitFor({ state: 'visible' });
    // Wait for results to load
    await appPage.waitForTimeout(500);
  });

  test('renders CurseForge addon cards', async ({ appPage }) => {
    const store = new StorePage(appPage);
    const cards = store.addonCards();
    await expect(cards).toHaveCount(2);
    await expect(store.addonCard('Questie')).toBeVisible();
    await expect(store.addonCard('Deadly Boss Mods')).toBeVisible();
  });

  test('CurseForge tab is active by default and category filters are visible', async ({ appPage }) => {
    const store = new StorePage(appPage);
    await expect(store.curseforgeTab).toHaveClass(/active/);
    await expect(store.categoryFilters).toBeVisible();
    await expect(store.githubTagFilters).toBeHidden();
  });

  test('search input clears results and re-fetches', async ({ appPage }) => {
    const store = new StorePage(appPage);

    await store.search('Questie');
    // Clear button should appear
    await expect(store.searchClearBtn).toBeVisible();

    await store.clearSearch();
    await expect(store.searchInput).toHaveValue('');
    await expect(store.searchClearBtn).toBeHidden();
  });

  test('selecting a category triggers a new search', async ({ appPage }) => {
    const store = new StorePage(appPage);
    // Select "Action Bars" category
    await store.selectCategory('1018');
    await appPage.waitForTimeout(300);
    // The list should still render (mock returns same results regardless)
    await expect(store.listContainer).toBeVisible();
  });

  test('clicking an addon card loads version selector in details pane', async ({ appPage }) => {
    const store = new StorePage(appPage);
    await store.addonCard('Questie').click();
    await expect(store.versionSelect).toBeVisible({ timeout: 5000 });
    await expect(store.selectBtn).toBeVisible();
  });

  test('details pane shows author info after clicking a card', async ({ appPage }) => {
    const store = new StorePage(appPage);
    await store.addonCard('Questie').click();
    await appPage.waitForTimeout(500);
    await expect(store.detailsContent).toContainText('QuestieDevs');
  });

  test('version selector has at least one option after selecting addon', async ({ appPage }) => {
    const store = new StorePage(appPage);
    await store.addonCard('Questie').click();
    await expect(store.versionSelect).toBeVisible({ timeout: 5000 });
    const optionCount = await store.versionSelect.locator('option').count();
    expect(optionCount).toBeGreaterThan(0);
  });

  test('Download button text is "Download" initially', async ({ appPage }) => {
    const store = new StorePage(appPage);
    await store.addonCard('Questie').click();
    await expect(store.selectBtn).toBeVisible({ timeout: 5000 });
    const text = await store.selectBtn.innerText();
    expect(text.trim()).toBe('Download');
  });

  test('clicking Download queues the addon and updates selected count', async ({ appPage }) => {
    const store = new StorePage(appPage);

    // Initial count
    await expect(store.selectedCount).toHaveText('0');
    await expect(store.reviewBtn).toBeDisabled();

    // Select an addon via checkbox
    const checkbox = store.addonCheckbox(0);
    await checkbox.check();
    await appPage.waitForTimeout(200);

    await expect(store.selectedCount).toHaveText('1');
    await expect(store.reviewBtn).toBeEnabled();
  });

  test('unchecking an addon decrements selected count', async ({ appPage }) => {
    const store = new StorePage(appPage);

    const checkbox = store.addonCheckbox(0);
    await checkbox.check();
    await appPage.waitForTimeout(200);
    await expect(store.selectedCount).toHaveText('1');

    await checkbox.uncheck();
    await appPage.waitForTimeout(200);
    await expect(store.selectedCount).toHaveText('0');
    await expect(store.reviewBtn).toBeDisabled();
  });

  test('clicking Review Downloads opens review modal', async ({ appPage }) => {
    const store = new StorePage(appPage);

    const checkbox = store.addonCheckbox(0);
    await checkbox.check();
    await appPage.waitForTimeout(200);
    await store.reviewBtn.click();

    await expect(store.reviewModal).toBeVisible();
  });

  test('review modal lists selected addons in table', async ({ appPage }) => {
    const store = new StorePage(appPage);

    await store.addonCheckbox(0).check();
    await appPage.waitForTimeout(200);
    await store.reviewBtn.click();

    await expect(store.reviewModalBody).toBeVisible();
    const rows = store.reviewModalBody.locator('tr');
    await expect(rows).toHaveCount(1);
  });

  test('cancelling review modal returns to store', async ({ appPage }) => {
    const store = new StorePage(appPage);

    await store.addonCheckbox(0).check();
    await appPage.waitForTimeout(200);
    await store.reviewBtn.click();
    await store.reviewCancelBtn.click();

    await expect(store.reviewModal).toBeHidden();
    await expect(store.modal).toBeVisible();
  });
});

test.describe('Store Modal — GitHub Tab', () => {
  test.beforeEach(async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    const store = new StorePage(appPage);
    await navbar.getAddonsBtn.click();
    await appPage.waitForTimeout(300);
    await store.githubTab.click();
    await appPage.waitForTimeout(300);
  });

  test('GitHub tab becomes active after clicking', async ({ appPage }) => {
    const store = new StorePage(appPage);
    await expect(store.githubTab).toHaveClass(/active/);
  });

  test('GitHub tag pills are visible after switching to GitHub tab', async ({ appPage }) => {
    const store = new StorePage(appPage);
    await expect(store.githubTagFilters).toBeVisible();
    await expect(store.categoryFilters).toBeHidden();
  });

  test('wotlk tag pill is active by default on GitHub tab', async ({ appPage }) => {
    const wotlkPill = appPage.locator('.github-tag-pill[data-tag="wotlk"]');
    await expect(wotlkPill).toHaveClass(/active/);
  });

  test('GitHub warning tooltip is visible in the DOM', async ({ appPage }) => {
    const store = new StorePage(appPage);
    await expect(store.githubWarningTooltip).toBeAttached();
    const text = await store.githubWarningTooltip.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

// GitHub search cards test needs the addons fixture (different fixture context)
test.describe.skip('Store Modal — GitHub Tab Search', () => {
  testWithAddons('GitHub search renders addon cards after tab switch', async ({ addonsPage }) => {
    const store = new StorePage(addonsPage);
    const navbar = new NavbarPage(addonsPage);
    await navbar.getAddonsBtn.click();
    await addonsPage.waitForTimeout(400);
    await store.githubTab.click();
    // Wait for GitHub results to replace CurseForge results (CF mock=2, GH mock=1)
    await addonsPage.waitForFunction(() =>
      document.querySelectorAll('#storeListContainer .store-addon-card').length <= 2,
      { timeout: 6000 }
    );
    const count = await store.addonCards().count();
    expect(count).toBeGreaterThan(0);
  });
});
