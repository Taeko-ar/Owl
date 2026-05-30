import { test, expect } from '../fixtures/app-fixture';
import { testWithAddons } from '../fixtures/addons-fixture';
import { AddonsPage } from '../page/addons.page';
import { NavbarPage } from '../page/navbar.page';
import { PatchesPage } from '../page/patches.page';

test.describe('Addons Tab — Empty State', () => {
  let addons: AddonsPage;

  test.beforeEach(async ({ appPage }) => {
    addons = new AddonsPage(appPage);
  });

  test('shows empty message when no addons are installed', async () => {
    await expect(addons.emptyMessage).toBeVisible();
    await expect(addons.addonsList).toBeHidden();
  });

  test('search input is attached to the DOM in addons tab', async () => {
    await expect(addons.searchInput).toBeAttached();
  });
});

testWithAddons.describe('Addons Tab — With Installed Addons', () => {
  let addons: AddonsPage;

  testWithAddons.beforeEach(async ({ addonsPage }) => {
    addons = new AddonsPage(addonsPage);
  });

  testWithAddons('renders addon cards for all installed addons', async () => {
    await expect(addons.addonCards()).toHaveCount(3);
  });

  testWithAddons('each addon card has a toggle, delete, and open-folder button', async () => {
    await expect(addons.firstAddonToggle()).toBeAttached();
    await expect(addons.firstAddonDeleteBtn()).toBeVisible();
    await expect(addons.firstAddonOpenBtn()).toBeVisible();
  });

  testWithAddons('search input is visible when addon list has items', async () => {
    await addons.searchContainer.hover();
    await expect(addons.searchInput).toBeVisible();
  });

  testWithAddons('search clear button appears when typing and clears input', async () => {
    await expect(addons.searchClearBtn).toBeHidden();
    await addons.typeInSearch('GTFO');
    await expect(addons.searchClearBtn).toBeVisible();
    await addons.clearSearch();
    await expect(addons.searchInput).toHaveValue('');
    await expect(addons.searchClearBtn).toBeHidden();
  });
});

test.describe('Patches (Mods) Tab — Empty State', () => {
  let patches: PatchesPage;

  test.beforeEach(async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    patches = new PatchesPage(appPage);
    await navbar.clickTab('mods');
  });

  test('shows empty message when no patches are installed', async () => {
    await expect(patches.emptyMessage).toBeVisible();
    await expect(patches.list).toBeHidden();
  });

  test('search input is attached in patches tab', async () => {
    await expect(patches.searchInput).toBeAttached();
  });
});
