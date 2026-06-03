import { Page, Locator } from '@playwright/test';

export class TorrentPage {
  readonly page: Page;

  readonly downloadGameNavBtn: Locator;
  readonly playBtn: Locator;
  readonly modal: Locator;
  readonly sourceInput: Locator;
  readonly browseFileBtn: Locator;
  readonly destInput: Locator;
  readonly browseDestBtn: Locator;
  readonly cancelBtn: Locator;
  readonly startBtn: Locator;

  readonly drawer: Locator;
  readonly drawerHeader: Locator;
  readonly drawerCount: Locator;
  readonly drawerPauseAllBtn: Locator;
  readonly drawerResumeAllBtn: Locator;
  readonly drawerContent: Locator;

  readonly installChoiceModal: Locator;
  readonly installLocateBtn: Locator;
  readonly installTorrentBtn: Locator;
  readonly installChoiceCancelBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    this.downloadGameNavBtn = page.locator('#downloadGameNavBtn');
    this.playBtn = page.locator('#playBtn');
    this.modal = page.locator('#torrentModal');
    this.sourceInput = page.locator('#torrentSourceInput');
    this.browseFileBtn = page.locator('#browseTorrentFileBtn');
    this.destInput = page.locator('#torrentDestInput');
    this.browseDestBtn = page.locator('#browseTorrentDestBtn');
    this.cancelBtn = page.locator('#torrentCancelBtn');
    this.startBtn = page.locator('#torrentStartBtn');

    this.drawer = page.locator('#torrentDrawer');
    this.drawerHeader = page.locator('#torrentDrawerHeader');
    this.drawerCount = page.locator('#torrentDrawerCount');
    this.drawerPauseAllBtn = page.locator('#torrentDrawerPauseAllBtn');
    this.drawerResumeAllBtn = page.locator('#torrentDrawerResumeAllBtn');
    this.drawerContent = page.locator('#torrentDrawerContent');

    this.installChoiceModal = page.locator('#installChoiceModal');
    this.installLocateBtn = page.locator('#installLocateBtn');
    this.installTorrentBtn = page.locator('#installTorrentBtn');
    this.installChoiceCancelBtn = page.locator('#installChoiceCancelBtn');
  }

  async openModal() {
    await this.playBtn.click();
    await this.installTorrentBtn.click();
  }

  async closeModal() {
    await this.cancelBtn.click();
  }

  async fillSource(src: string) {
    await this.sourceInput.fill(src);
  }

  async fillDest(dest: string) {
    await this.destInput.fill(dest);
  }

  async clickStart() {
    await this.startBtn.click();
  }
}
