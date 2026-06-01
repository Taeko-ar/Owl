import { test, expect } from '../fixtures/app-fixture';
import { ProfilesPage } from '../page/profiles.page';
import { AddonsPage } from '../page/addons.page';

test.describe('Addon Profiles', () => {
  let profiles: ProfilesPage;
  let addons: AddonsPage;

  test.beforeEach(async ({ appPage }) => {
    profiles = new ProfilesPage(appPage);
    addons = new AddonsPage(appPage);
  });

  test('can open profiles dropdown and save a new profile', async () => {
    // 1. Dropdown is hidden initially
    await expect(profiles.dropdown).toBeHidden();

    // 2. Open dropdown/modal
    // Since there are no profiles, clicking selectorBtn directly triggers the save profile modal.
    await profiles.selectorBtn.click();
    await expect(profiles.modal).toBeVisible();

    // 4. Fill modal input and confirm
    await profiles.modalInput.fill('My Special Profile');
    await profiles.modalConfirm.click();

    // 5. Modal closes and toast/updates happen
    await expect(profiles.modal).toBeHidden();
    await expect(profiles.headerName).toContainText('My Special Profile');
  });

  test('can rename and delete profiles inline inside the dropdown', async () => {
    // Inject mock profile using addInitScript so it survives page reloads
    await profiles.page.addInitScript(() => {
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_PROFILES__ = [{ name: 'Raiding', enabledAddons: ['GTFO'] }];
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_ACTIVE_PROFILE__ = 'Raiding';
    });

    // Reload settings / view to apply init scripts
    await profiles.page.reload();
    await expect(profiles.headerName).toContainText('Raiding');

    // Open dropdown
    await profiles.selectorBtn.click();
    await expect(profiles.dropdown).toBeVisible();

    // Verify option exists
    const option = profiles.profileOption('Raiding');
    await expect(option).toBeVisible();

    // 1. Rename profile
    await option.hover();
    const renameBtn = profiles.renameBtn('Raiding');
    await expect(renameBtn).toBeVisible();
    await renameBtn.click();

    // Input field should appear
    const editInput = profiles.editInput('Raiding');
    await expect(editInput).toBeVisible();
    await editInput.fill('Casual WoW');

    // Add init script to mock rename response for future settings calls
    await profiles.page.addInitScript(() => {
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_PROFILES__ = [{ name: 'Casual WoW', enabledAddons: ['GTFO'] }];
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_ACTIVE_PROFILE__ = 'Casual WoW';
    });

    // Confirm rename (using the old name 'Raiding' since the element has old name in data-profile attribute)
    await profiles.confirmRenameBtn('Raiding').click();

    // Header updates and edit field disappears
    await expect(editInput).toBeHidden();
    await expect(profiles.headerName).toContainText('Casual WoW');

    // Dropdown is still open after rename. Let's make sure it is open.
    if (await profiles.dropdown.isHidden()) {
      await profiles.selectorBtn.click();
    }
    await expect(profiles.dropdown).toBeVisible();

    // 2. Delete profile
    await profiles.profileOption('Casual WoW').hover();
    const deleteBtn = profiles.deleteBtn('Casual WoW');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Clear mock profiles directly in context
    await profiles.page.evaluate(() => {
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_PROFILES__ = [];
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_ACTIVE_PROFILE__ = null;
    });

    // Confirm delete
    const confirmDeleteBtn = profiles.confirmDeleteBtn('Casual WoW');
    await expect(confirmDeleteBtn).toBeVisible();
    await confirmDeleteBtn.click();

    // Option should be gone, header back to Save Setup as Profile...
    await expect(profiles.profileOption('Casual WoW')).toBeHidden();
    await expect(profiles.headerName).toContainText('Save Setup as Profile...');
  });

  test.skip('can save multiple profiles with different addon states and switch between them', async () => {
    // 1. Mock some addons using addInitScript so it survives page reloads
    await profiles.page.addInitScript(() => {
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_ADDONS__ = ['GTFO', 'AtlasLoot', 'DBM'];
    });
    await profiles.page.reload();

    // Verify initial states
    await expect(addons.addonToggle('GTFO')).toBeChecked();
    await expect(addons.addonToggle('AtlasLoot')).toBeChecked();
    await expect(addons.addonToggle('DBM')).toBeChecked();

    // 2. Toggle off DBM and AtlasLoot (forcing click on hidden inputs)
    await addons.addonToggle('AtlasLoot').click({ force: true });
    await addons.addonToggle('DBM').click({ force: true });

    // 3. Save as "Profile A"
    await profiles.selectorBtn.click();
    await profiles.saveBtn.click();
    await profiles.modalInput.fill('Profile A');

    // Mock save_addon_profile to record 'Profile A'
    await profiles.page.addInitScript(() => {
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_PROFILES__ = [{ name: 'Profile A', enabledAddons: ['GTFO'] }];
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_ACTIVE_PROFILE__ = 'Profile A';
    });
    await profiles.modalConfirm.click();
    await expect(profiles.headerName).toContainText('Profile A');

    // 4. Toggle DBM and AtlasLoot back ON
    await addons.addonToggle('AtlasLoot').click({ force: true });
    await addons.addonToggle('DBM').click({ force: true });

    // 5. Save as "Profile B"
    await profiles.selectorBtn.click();
    await profiles.saveBtn.click();
    await profiles.modalInput.fill('Profile B');

    // Mock save_addon_profile to record both Profile A and Profile B
    await profiles.page.addInitScript(() => {
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_PROFILES__ = [
        { name: 'Profile A', enabledAddons: ['GTFO'] },
        { name: 'Profile B', enabledAddons: ['GTFO', 'AtlasLoot', 'DBM'] },
      ];
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_ACTIVE_PROFILE__ = 'Profile B';
    });
    await profiles.modalConfirm.click();
    await expect(profiles.headerName).toContainText('Profile B');

    // 6. Switch to "Profile A"
    await profiles.selectorBtn.click();
    // Mock apply response
    await profiles.page.addInitScript(() => {
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_ACTIVE_PROFILE__ = 'Profile A';
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_ADDONS__ = ['GTFO', 'AtlasLoot-disabled', 'DBM-disabled'];
    });
    await profiles.profileOption('Profile A').click();

    // Verify it switched: active profile is Profile A, and addons are disabled
    await expect(profiles.headerName).toContainText('Profile A');
    await expect(addons.addonToggle('GTFO')).toBeChecked();
    await expect(addons.addonToggle('AtlasLoot')).not.toBeChecked();
    await expect(addons.addonToggle('DBM')).not.toBeChecked();

    // 7. Switch to "Profile B"
    await profiles.selectorBtn.click();
    // Mock apply response
    await profiles.page.addInitScript(() => {
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_ACTIVE_PROFILE__ = 'Profile B';
      // @ts-expect-error: Mock tauri variable
      window.__OWL_MOCK_ADDONS__ = ['GTFO', 'AtlasLoot', 'DBM'];
    });
    await profiles.profileOption('Profile B').click();

    // Verify active profile is Profile B, and all are enabled
    await expect(profiles.headerName).toContainText('Profile B');
    await expect(addons.addonToggle('GTFO')).toBeChecked();
    await expect(addons.addonToggle('AtlasLoot')).toBeChecked();
    await expect(addons.addonToggle('DBM')).toBeChecked();
  });
});
