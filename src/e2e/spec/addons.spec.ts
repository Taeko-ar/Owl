import { test, expect } from '../fixtures/app-fixture';
import { testWithAddons } from '../fixtures/addons-fixture';
import { AddonsPage } from '../page/addons.page';

test.describe('Addons Tab — Empty State', () => {
  test('shows empty message when no addons are installed', async ({ appPage }) => {
    const addons = new AddonsPage(appPage);
    await expect(addons.emptyMessage).toBeVisible();
    await expect(addons.addonsList).toBeHidden();
  });

  test('search input is attached to the DOM in addons tab', async ({ appPage }) => {
    const addons = new AddonsPage(appPage);
    // The search-input may be CSS-hidden in empty state; verify it exists in the DOM
    await expect(addons.searchInput).toBeAttached();
  });
});

test.describe.skip('Addons Tab — With Installed Addons', () => {
  testWithAddons('renders addon cards for all installed addons', async ({ addonsPage }) => {
    const addons = new AddonsPage(addonsPage);
    await expect(addons.addonCards()).toHaveCount(3);
  });

  testWithAddons('each addon card has a toggle, delete, and open-folder button', async ({ addonsPage }) => {
    const addons = new AddonsPage(addonsPage);
    const firstCard = addons.addonCards().first();
    await expect(firstCard.locator('.addon-toggle')).toBeAttached();
    await expect(firstCard.locator('.delete-addon')).toBeVisible();
    await expect(firstCard.locator('.open-addon')).toBeVisible();
  });

  testWithAddons('search input is visible when addon list has items', async ({ addonsPage }) => {
    const addons = new AddonsPage(addonsPage);
    await expect(addons.searchInput).toBeVisible();
  });

  testWithAddons('search clear button appears when typing and clears input', async ({ addonsPage }) => {
    const addons = new AddonsPage(addonsPage);
    await expect(addons.searchClearBtn).toBeHidden();
    await addons.typeInSearch('GTFO');
    await expect(addons.searchClearBtn).toBeVisible();
    await addons.clearSearch();
    await expect(addons.searchInput).toHaveValue('');
    await expect(addons.searchClearBtn).toBeHidden();
  });
});

test.describe('Patches (Mods) Tab — Empty State', () => {
  test('shows empty message when no patches are installed', async ({ appPage }) => {
    await appPage.locator('[data-tab="mods"]').click();
    await expect(appPage.locator('#patches-empty')).toBeVisible();
    await expect(appPage.locator('#patches-list')).toBeHidden();
  });

  test('search input is attached in patches tab', async ({ appPage }) => {
    await appPage.locator('[data-tab="mods"]').click();
    await expect(appPage.locator('#patches-search')).toBeAttached();
  });
});
