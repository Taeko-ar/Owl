import { test, expect } from '../fixtures/app-fixture';
import { NavbarPage } from '../page/navbar.page';
import { SettingsPage } from '../page/settings.page';

test.describe('Navigation & Layout', () => {
  let navbar: NavbarPage;

  test.beforeEach(async ({ appPage }) => {
    navbar = new NavbarPage(appPage);
  });

  test('renders the app title and header', async () => {
    await expect(navbar.page).toHaveTitle(/OWL/i);
    await expect(navbar.header).toBeVisible();
  });

  test('addons tab is active by default', async () => {
    await expect(navbar.addonsTab).toHaveClass(/active/);
    await expect(navbar.addonsTabSection).toBeVisible();
    await expect(navbar.tweaksTabSection).toBeHidden();
    await expect(navbar.modsTabSection).toBeHidden();
  });

  test('clicking tweaks tab shows tweaks section and hides addons', async () => {
    await navbar.clickTab('tweaks');
    await expect(navbar.tweaksTabSection).toBeVisible();
    await expect(navbar.addonsTabSection).toBeHidden();
    await expect(navbar.tweaksTab).toHaveClass(/active/);
  });

  test('clicking mods tab shows mods section', async () => {
    await navbar.clickTab('mods');
    await expect(navbar.modsTabSection).toBeVisible();
    await expect(navbar.addonsTabSection).toBeHidden();
    await expect(navbar.modsTab).toHaveClass(/active/);
  });

  test('switching between tabs and returning to addons works', async () => {
    await navbar.clickTab('tweaks');
    await navbar.clickTab('addons');
    await expect(navbar.addonsTabSection).toBeVisible();
    await expect(navbar.addonsTab).toHaveClass(/active/);
  });

  test('footer status bar and play button are visible', async () => {
    await expect(navbar.statusBar).toBeVisible();
    await expect(navbar.playBtn).toBeVisible();
  });

  test('Get Addons and Import Addon buttons are visible on Addons tab', async () => {
    await expect(navbar.getAddonsBtn).toBeVisible();
    await expect(navbar.importAddonBtn).toBeVisible();
  });

  test('Open Folder button is hidden on addons tab and visible on mods tab', async () => {
    await expect(navbar.openFolderBtn).toBeHidden();
    await navbar.clickTab('mods');
    await expect(navbar.openFolderBtn).toBeVisible();
  });
});

test.describe('Theme Toggle', () => {
  let navbar: NavbarPage;

  test.beforeEach(async ({ appPage }) => {
    navbar = new NavbarPage(appPage);
  });

  test('clicking theme button adds light-mode class to body', async () => {
    await navbar.toggleTheme();
    await expect(navbar.body).toHaveClass(/light-mode/);
    await navbar.toggleTheme();
    await expect(navbar.body).not.toHaveClass(/light-mode/);
  });
});

test.describe('Language Selector', () => {
  let navbar: NavbarPage;

  test.beforeEach(async ({ appPage }) => {
    navbar = new NavbarPage(appPage);
  });

  test('language dropdown opens on langBtn click', async () => {
    await expect(navbar.langDropdown).toBeHidden();
    await navbar.openLanguageDropdown();
    await expect(navbar.langDropdown).toBeVisible();
  });

  test('selecting Spanish updates UI language', async () => {
    await navbar.openLanguageDropdown();
    await navbar.selectLanguage('es');
    const text = await navbar.addonsTabText();
    expect(text.trim().length).toBeGreaterThan(0);
    await expect(navbar.langDropdown).toBeHidden();
  });

  test('closing language dropdown by clicking outside works', async () => {
    await navbar.openLanguageDropdown();
    await expect(navbar.langDropdown).toBeVisible();
    await navbar.clickOutside();
    await expect(navbar.langDropdown).toBeHidden();
  });
});

test.describe('Settings Modal', () => {
  let navbar: NavbarPage;
  let settings: SettingsPage;

  test.beforeEach(async ({ appPage }) => {
    navbar = new NavbarPage(appPage);
    settings = new SettingsPage(appPage);
    await navbar.openSettings();
  });

  test('settings modal opens on settings button click', async () => {
    await expect(settings.modal).toBeVisible();
  });

  test('settings modal closes on cancel button click', async () => {
    await settings.cancel();
    await expect(settings.modal).toBeHidden();
  });

  test('settings modal closes on X button click', async () => {
    await settings.close();
    await expect(settings.modal).toBeHidden();
  });

  test('settings modal shows game path input and window size selector', async () => {
    await expect(settings.gamePathInput).toBeVisible();
    await expect(settings.windowSizeSelect).toBeVisible();
    await expect(settings.stayOpenCheckbox).toBeVisible();
  });

  test('window size select has the correct options', async () => {
    const options = await settings.windowSizeOptions();
    expect(options).toContain('960 × 540');
    expect(options).toContain('1280 × 720');
    expect(options).toContain('1600 × 900');
  });
});
