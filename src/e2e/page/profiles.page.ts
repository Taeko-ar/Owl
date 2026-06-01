import { Page, Locator } from '@playwright/test';

export class ProfilesPage {
  readonly page: Page;

  readonly selectorBtn: Locator;
  readonly dropdown: Locator;
  readonly saveBtn: Locator;
  readonly updateBtn: Locator;

  readonly modal: Locator;
  readonly modalTitle: Locator;
  readonly modalInput: Locator;
  readonly modalError: Locator;
  readonly modalConfirm: Locator;
  readonly modalCancel: Locator;

  readonly headerName: Locator;

  constructor(page: Page) {
    this.page = page;

    this.selectorBtn = page.locator('#profileSelectorBtn');
    this.dropdown = page.locator('#profileDropdown');
    this.saveBtn = page.locator('#saveProfileBtn');
    this.updateBtn = page.locator('#updateProfileBtn');

    this.modal = page.locator('#profileModal');
    this.modalTitle = page.locator('#profileModalTitle');
    this.modalInput = page.locator('#profileModalInput');
    this.modalError = page.locator('#profileModalError');
    this.modalConfirm = page.locator('#confirmProfileModal');
    this.modalCancel = page.locator('#cancelProfileModal');

    this.headerName = page.locator('#activeProfileHeaderName');
  }

  profileOption(name: string): Locator {
    return this.dropdown.locator(`[data-profile="${name}"]`).first();
  }

  renameBtn(name: string): Locator {
    return this.dropdown.locator(`.rename-profile-btn[data-profile="${name}"]`);
  }

  deleteBtn(name: string): Locator {
    return this.dropdown.locator(`.delete-profile-btn[data-profile="${name}"]`);
  }

  editInput(name: string): Locator {
    return this.dropdown.locator(`.profile-edit-input[data-old="${name}"]`);
  }

  confirmRenameBtn(name: string): Locator {
    return this.dropdown.locator(`.confirm-rename-btn[data-profile="${name}"]`);
  }

  cancelRenameBtn(): Locator {
    return this.dropdown.locator('.cancel-rename-btn');
  }

  confirmDeleteBtn(name: string): Locator {
    return this.dropdown.locator(`.confirm-delete-btn[data-profile="${name}"]`);
  }

  cancelDeleteBtn(): Locator {
    return this.dropdown.locator('.cancel-delete-btn');
  }
}
