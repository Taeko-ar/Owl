import { test, expect } from '../fixtures/app-fixture';
import { testWithAddons } from '../fixtures/addons-fixture';

test.describe('Addons Import/Export — Empty State', () => {
  test('export button is disabled when there are no addons installed', async ({ appPage }) => {
    const exportBtn = appPage.locator('#exportAddonsBtn');
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toBeDisabled();
    await expect(exportBtn).toHaveAttribute(
      'title',
      'Cannot export because you have no addons installed.'
    );
  });
});

testWithAddons.describe('Addons Import/Export — With Installed Addons', () => {
  testWithAddons(
    'export generates a base64 string and warns about manual addons',
    async ({ addonsPage }) => {
      const exportBtn = addonsPage.locator('#exportAddonsBtn');
      await expect(exportBtn).toBeVisible();
      await expect(exportBtn).not.toBeDisabled();

      // Trigger export
      await exportBtn.click();

      // Verify modal is shown
      const exportModal = addonsPage.locator('#exportModal');
      await expect(exportModal).toBeVisible();

      // Verify manual warning is visible since our mock metadata for TestAddon will be manual
      const warning = addonsPage.locator('#exportManualWarningContainer');
      await expect(warning).toBeVisible();
      const manualList = addonsPage.locator('#exportManualList');
      await expect(manualList).toContainText('TestAddon'); // Export mock string has TestAddon as manual

      // Verify textarea has the base64 string
      const stringArea = addonsPage.locator('#exportStringArea');
      await expect(stringArea).not.toBeEmpty();

      // Close modal
      await addonsPage.locator('#exportCloseBtn').click();
      await expect(exportModal).toBeHidden();
    }
  );

  testWithAddons('import from string validates and shows preview', async ({ addonsPage }) => {
    const importBtn = addonsPage.locator('#importAddonBtn');
    await importBtn.click();

    const stringBtn = addonsPage.locator('#importStringBtn');
    await expect(stringBtn).toBeVisible({ timeout: 2000 });

    // Directly submit mock code via clicking and filling input
    await stringBtn.click();
    const input = addonsPage.locator('#modalInput');
    await expect(input).toBeAttached({ timeout: 3000 });
    await input.fill('valid-string');
    await addonsPage.locator('#modalSubmitBtn').click();

    // Verify preview modal is open
    const previewModal = addonsPage.locator('#importPreviewModal');
    await expect(previewModal).toBeVisible();

    // Verify warning for manual addons in import preview
    const warning = addonsPage.locator('#importManualWarningContainer');
    await expect(warning).toBeVisible();

    const tableRows = addonsPage.locator('#import-preview-table-body tr');
    await expect(tableRows).toHaveCount(1);

    // Clean up
    await addonsPage.locator('#importPreviewCancelBtn').click();
    await expect(previewModal).toBeHidden();
  });
});
