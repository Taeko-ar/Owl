import { Page, Locator } from '@playwright/test';

/**
 * Page Object for the top titlebar and navigation bar.
 * Covers: theme toggle, language selector, settings button,
 * update available button, tab navigation, and action buttons.
 */
export class NavbarPage {
  readonly page: Page;

  // Titlebar
  readonly themeToggleBtn: Locator;
  readonly settingsBtn: Locator;
  readonly langBtn: Locator;
  readonly langDropdown: Locator;
  readonly updateAvailableBtn: Locator;
  readonly minimizeBtn: Locator;
  readonly windowCloseBtn: Locator;

  // Nav tabs
  readonly addonsTab: Locator;
  readonly tweaksTab: Locator;
  readonly modsTab: Locator;

  // Action buttons (right side of nav)
  readonly getAddonsBtn: Locator;
  readonly importAddonBtn: Locator;
  readonly openFolderBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    this.themeToggleBtn = page.locator('#themeToggleBtn');
    this.settingsBtn = page.locator('#settingsBtn');
    this.langBtn = page.locator('#langBtn');
    this.langDropdown = page.locator('#langDropdown');
    this.updateAvailableBtn = page.locator('#updateAvailableBtn');
    this.minimizeBtn = page.locator('#minimizeBtn');
    this.windowCloseBtn = page.locator('#windowCloseBtn');

    this.addonsTab = page.locator('[data-tab="addons"]');
    this.tweaksTab = page.locator('[data-tab="tweaks"]');
    this.modsTab = page.locator('[data-tab="mods"]');

    this.getAddonsBtn = page.locator('#getAddonsBtn');
    this.importAddonBtn = page.locator('#importAddonBtn');
    this.openFolderBtn = page.locator('#openModsFolder');
  }

  async clickTab(tab: 'addons' | 'tweaks' | 'mods') {
    await this.page.locator(`[data-tab="${tab}"]`).click();
  }

  async openLanguageDropdown() {
    await this.langBtn.click();
  }

  async selectLanguage(lang: 'en' | 'es' | 'pt') {
    await this.langDropdown.locator(`[data-lang="${lang}"]`).click();
  }

  async toggleTheme() {
    await this.themeToggleBtn.click();
  }

  async openSettings() {
    await this.settingsBtn.click();
  }

  /** Returns true if the active nav tab is the one matching `tab` */
  async isTabActive(tab: 'addons' | 'tweaks' | 'mods'): Promise<boolean> {
    const el = this.page.locator(`[data-tab="${tab}"]`);
    const classes = await el.getAttribute('class');
    return (classes ?? '').includes('active');
  }
}