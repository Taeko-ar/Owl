import { Page, Locator } from '@playwright/test';

export class SettingsPage {
  readonly page: Page;

  readonly modal: Locator;
  readonly closeBtn: Locator;
  readonly cancelBtn: Locator;
  readonly applyBtn: Locator;

  readonly gamePathInput: Locator;
  readonly browseBtn: Locator;
  readonly windowSizeSelect: Locator;
  readonly stayOpenCheckbox: Locator;

  constructor(page: Page) {
    this.page = page;

    this.modal = page.locator('#settingsModal');
    this.closeBtn = page.locator('#closeSettings');
    this.cancelBtn = page.locator('#cancelSettings');
    this.applyBtn = page.locator('#applySettings');

    this.gamePathInput = page.locator('#gamePath');
    this.browseBtn = page.locator('#browseGamePathBtn');
    this.windowSizeSelect = page.locator('#windowSize');
    this.stayOpenCheckbox = page.locator('#stayOpen');
  }

  async windowSizeOptions(): Promise<string[]> {
    return this.windowSizeSelect.locator('option').allTextContents();
  }

  isVisible(): Promise<boolean> {
    return this.modal.isVisible();
  }

  async setGamePath(path: string) {
    await this.gamePathInput.fill(path);
  }

  async setWindowSize(value: '960x540' | '1280x720' | '1600x900') {
    await this.windowSizeSelect.selectOption(value);
  }

  async apply() {
    await this.applyBtn.click();
  }

  async cancel() {
    await this.cancelBtn.click();
  }

  async close() {
    await this.closeBtn.click();
  }
}
