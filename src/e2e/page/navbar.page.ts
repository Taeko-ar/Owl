import { Page, Locator } from '@playwright/test';

export class NavbarPage {
  readonly page: Page;

  readonly header: Locator;
  readonly body: Locator;

  readonly themeToggleBtn: Locator;
  readonly settingsBtn: Locator;
  readonly langBtn: Locator;
  readonly langDropdown: Locator;
  readonly updateAvailableBtn: Locator;
  readonly minimizeBtn: Locator;
  readonly windowCloseBtn: Locator;

  readonly addonsTab: Locator;
  readonly tweaksTab: Locator;
  readonly modsTab: Locator;

  readonly addonsTabSection: Locator;
  readonly tweaksTabSection: Locator;
  readonly modsTabSection: Locator;

  readonly statusBar: Locator;
  readonly playBtn: Locator;

  readonly getAddonsBtn: Locator;
  readonly importAddonBtn: Locator;
  readonly openFolderBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    this.header = page.locator('header');
    this.body = page.locator('body');

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

    this.addonsTabSection = page.locator('#addons-tab');
    this.tweaksTabSection = page.locator('#tweaks-tab');
    this.modsTabSection = page.locator('#mods-tab');

    this.statusBar = page.locator('#status');
    this.playBtn = page.locator('#playBtn');

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

  async openStore() {
    await this.getAddonsBtn.click();
  }

  async addonsTabText(): Promise<string> {
    return this.addonsTab.innerText();
  }

  async clickOutside() {
    await this.page.locator('body').click({ position: { x: 10, y: 10 } });
  }

  async isTabActive(tab: 'addons' | 'tweaks' | 'mods'): Promise<boolean> {
    const el = this.page.locator(`[data-tab="${tab}"]`);
    const classes = await el.getAttribute('class');
    return (classes ?? '').includes('active');
  }
}
