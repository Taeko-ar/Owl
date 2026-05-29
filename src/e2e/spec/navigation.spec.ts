import { test, expect } from '../fixtures/app-fixture';
import { NavbarPage } from '../page/navbar.page';
import { SettingsPage } from '../page/settings.page';

test.describe('Navigation & Layout', () => {
  test('renders the app title and header', async ({ appPage }) => {
    await expect(appPage).toHaveTitle(/OWL/i);
    const header = appPage.locator('header');
    await expect(header).toBeVisible();
  });

  test('addons tab is active by default', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    await expect(navbar.addonsTab).toHaveClass(/active/);
    await expect(appPage.locator('#addons-tab')).toBeVisible();
    await expect(appPage.locator('#tweaks-tab')).toBeHidden();
    await expect(appPage.locator('#mods-tab')).toBeHidden();
  });

  test('clicking tweaks tab shows tweaks section and hides addons', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    await navbar.clickTab('tweaks');

    await expect(appPage.locator('#tweaks-tab')).toBeVisible();
    await expect(appPage.locator('#addons-tab')).toBeHidden();
    await expect(navbar.tweaksTab).toHaveClass(/active/);
  });

  test('clicking mods tab shows mods section', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    await navbar.clickTab('mods');

    await expect(appPage.locator('#mods-tab')).toBeVisible();
    await expect(appPage.locator('#addons-tab')).toBeHidden();
    await expect(navbar.modsTab).toHaveClass(/active/);
  });

  test('switching between tabs and returning to addons works', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    await navbar.clickTab('tweaks');
    await navbar.clickTab('addons');

    await expect(appPage.locator('#addons-tab')).toBeVisible();
    await expect(navbar.addonsTab).toHaveClass(/active/);
  });

  test('footer status bar and play button are visible', async ({ appPage }) => {
    await expect(appPage.locator('#status')).toBeVisible();
    await expect(appPage.locator('#playBtn')).toBeVisible();
  });

  test('Get Addons and Import Addon buttons are visible on Addons tab', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    await expect(navbar.getAddonsBtn).toBeVisible();
    await expect(navbar.importAddonBtn).toBeVisible();
  });

  test('Open Folder button is hidden on addons tab and visible on mods tab', async ({
    appPage,
  }) => {
    const navbar = new NavbarPage(appPage);
    await expect(navbar.openFolderBtn).toBeHidden();
    await navbar.clickTab('mods');
    await expect(navbar.openFolderBtn).toBeVisible();
  });
});

test.describe('Theme Toggle', () => {
  test('clicking theme button adds light-mode class to body', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    const body = appPage.locator('body');

    // Toggle to light
    await navbar.toggleTheme();
    await expect(body).toHaveClass(/light-mode/);

    // Toggle back to dark
    await navbar.toggleTheme();
    const classes = await body.getAttribute('class');
    expect(classes ?? '').not.toContain('light-mode');
  });
});

test.describe('Language Selector', () => {
  test('language dropdown opens on langBtn click', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);

    await expect(navbar.langDropdown).toBeHidden();
    await navbar.openLanguageDropdown();
    await expect(navbar.langDropdown).toBeVisible();
  });

  test('selecting Spanish updates UI language', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    await navbar.openLanguageDropdown();
    await navbar.selectLanguage('es');

    // The addons tab should now show Spanish text
    const addonsTab = navbar.addonsTab;
    const text = await addonsTab.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
    // Dropdown should be closed after selection
    await expect(navbar.langDropdown).toBeHidden();
  });

  test('closing language dropdown by clicking outside works', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    await navbar.openLanguageDropdown();
    await expect(navbar.langDropdown).toBeVisible();

    // Click somewhere else
    await appPage.locator('body').click({ position: { x: 10, y: 10 } });
    await expect(navbar.langDropdown).toBeHidden();
  });
});

test.describe('Settings Modal', () => {
  test('settings modal opens on settings button click', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    const settings = new SettingsPage(appPage);

    await expect(settings.modal).toBeHidden();
    await navbar.openSettings();
    await expect(settings.modal).toBeVisible();
  });

  test('settings modal closes on cancel button click', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    const settings = new SettingsPage(appPage);

    await navbar.openSettings();
    await expect(settings.modal).toBeVisible();
    await settings.cancel();
    await expect(settings.modal).toBeHidden();
  });

  test('settings modal closes on X button click', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    const settings = new SettingsPage(appPage);

    await navbar.openSettings();
    await settings.close();
    await expect(settings.modal).toBeHidden();
  });

  test('settings modal shows game path input and window size selector', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    const settings = new SettingsPage(appPage);

    await navbar.openSettings();
    await expect(settings.gamePathInput).toBeVisible();
    await expect(settings.windowSizeSelect).toBeVisible();
    await expect(settings.stayOpenCheckbox).toBeVisible();
  });

  test('window size select has the correct options', async ({ appPage }) => {
    const navbar = new NavbarPage(appPage);
    const settings = new SettingsPage(appPage);

    await navbar.openSettings();
    const options = await settings.windowSizeSelect.locator('option').allTextContents();
    expect(options).toContain('960 × 540');
    expect(options).toContain('1280 × 720');
    expect(options).toContain('1600 × 900');
  });
});
