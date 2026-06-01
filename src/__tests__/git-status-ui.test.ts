import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  setupGitStatusEvents,
  renderGitStatusUI,
  checkSingleAddonGitStatus,
} from '../ui/git-status';
import { invoke } from '@tauri-apps/api/core';
import { gitStatusCache } from '../state';
import { getTranslation } from '../i18n/index';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('Git Status UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    gitStatusCache.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('setupGitStatusEvents registers document click handler to hide dropdowns', () => {
    document.body.innerHTML = `
      <div class="addon-branch-dropdown"></div>
      <div class="addon-branch-dropdown"></div>
    `;
    const dropdowns = document.querySelectorAll('.addon-branch-dropdown');
    dropdowns[0].classList.remove('hidden');
    dropdowns[1].classList.remove('hidden');

    setupGitStatusEvents();
    document.dispatchEvent(new Event('click'));

    expect(dropdowns[0].classList.contains('hidden')).toBe(true);
    expect(dropdowns[1].classList.contains('hidden')).toBe(true);
  });

  it('renders status when updateAvailable is true, switches branch, and handles update actions', async () => {
    document.body.innerHTML = `
      <div class="flex-col">
        <div id="git-status-container"></div>
        <div class="addon-branch-dropdown" data-addon="TestAddon"></div>
        <button class="addon-git-branch-btn" data-addon="TestAddon">
          <span class="addon-current-branch">OldBranch</span>
        </button>
      </div>
      <div id="status"></div>
    `;

    const container = document.getElementById('git-status-container') as HTMLElement;
    const branchContainer = document.querySelector('.addon-branch-dropdown') as HTMLElement;
    const branchBtn = document.querySelector('.addon-git-branch-btn') as HTMLButtonElement;
    const statusFooter = document.getElementById('status');

    const status = {
      updateAvailable: true,
      lastCommit: 'abc1234',
      branch: 'main',
      branches: ['main', 'dev', 'origin', 'remotes/origin', ''],
    };

    renderGitStatusUI(
      'TestAddon',
      container,
      branchContainer,
      branchBtn,
      status,
      '/mock/wow',
      statusFooter
    );

    // Verify render UI contents
    expect(container.innerHTML).toContain('update-addon');
    expect(container.innerHTML).toContain('abc1234');
    expect(branchBtn.querySelector('.addon-current-branch')?.textContent).toBe('main');

    // Click dev branch button
    const devBtn = branchContainer.querySelector('button[data-branch="dev"]') as HTMLElement;
    expect(devBtn).not.toBeNull();

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'change_addon_branch') return Promise.resolve('Branch changed');
      if (cmd === 'check_addon_git_status') return Promise.resolve(status);
      return Promise.resolve();
    });

    devBtn.click();
    expect(container.textContent).toContain(getTranslation('git.switching'));
    expect(invoke).toHaveBeenCalledWith('change_addon_branch', {
      basePath: '/mock/wow',
      addonName: 'TestAddon',
      branchName: 'dev',
    });
    await Promise.resolve();
    expect(statusFooter?.textContent).toBe('Branch changed');

    // Branch switch failure
    (invoke as any).mockImplementationOnce((cmd: string) => {
      if (cmd === 'change_addon_branch') return Promise.reject('Switch failed');
      return Promise.resolve();
    });
    devBtn.click();
    await Promise.resolve();
    expect(statusFooter?.textContent).toBe('Error: Switch failed');

    // Trigger update addon
    const updateBtn = container.querySelector('.update-addon') as HTMLElement;
    (invoke as any).mockImplementationOnce((cmd: string) => {
      if (cmd === 'update_addon') return Promise.resolve('Addon updated successfully');
      return Promise.resolve();
    });
    updateBtn.click();
    expect(container.textContent).toContain(getTranslation('git.updating'));
    expect(invoke).toHaveBeenCalledWith('update_addon', {
      basePath: '/mock/wow',
      addonName: 'TestAddon',
    });
    await Promise.resolve();
    expect(statusFooter?.textContent).toBe('Addon updated successfully');

    // Update addon failure
    (invoke as any).mockImplementationOnce((cmd: string) => {
      if (cmd === 'update_addon') return Promise.reject('Update error');
      return Promise.resolve();
    });
    updateBtn.click();
    await Promise.resolve();
    expect(statusFooter?.textContent).toBe('Error: Update error');
    expect(container.textContent).toContain('⚠️');

    // Verify timer triggers fallback call after failure
    vi.advanceTimersByTime(3000);
    await Promise.resolve();
    // Should run check_addon_git_status again
    expect(invoke).toHaveBeenCalledWith('check_addon_git_status', {
      basePath: '/mock/wow',
      addonName: 'TestAddon',
    });
  });

  it('renders status when updateAvailable is false and branches is empty', () => {
    const container = document.createElement('div');
    const branchContainer = document.createElement('div');
    const status = {
      updateAvailable: false,
      lastCommit: undefined,
      branch: undefined,
      branches: [],
    };
    renderGitStatusUI('TestAddon', container, branchContainer, null, status, '/mock/wow', null);
    expect(container.innerHTML).toContain(getTranslation('git.uptodate'));
    expect(branchContainer.innerHTML).toBe('');
  });

  it('renders nothing if status is null', () => {
    const container = document.createElement('div');
    const branchContainer = document.createElement('div');
    renderGitStatusUI('TestAddon', container, branchContainer, null, null, '/mock/wow', null);
    expect(container.innerHTML).toBe('');
    expect(branchContainer.innerHTML).toBe('');
  });

  it('checkSingleAddonGitStatus reads and writes to gitStatusCache', async () => {
    document.body.innerHTML = `
      <div class="flex-col">
        <div id="git-status-container"></div>
        <div class="addon-branch-dropdown" data-addon="TestAddon"></div>
        <button class="addon-git-branch-btn" data-addon="TestAddon">
          <span class="addon-current-branch">OldBranch</span>
        </button>
      </div>
      <div id="status"></div>
    `;

    const container = document.getElementById('git-status-container') as HTMLElement;
    const statusFooter = document.getElementById('status');

    const statusData = {
      updateAvailable: false,
      branch: 'main',
      branches: ['main'],
    };

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'check_addon_git_status') return Promise.resolve(statusData);
      return Promise.resolve();
    });

    // 1. Initial check (no cache)
    await checkSingleAddonGitStatus('TestAddon', container, '/mock/wow', statusFooter);
    expect(invoke).toHaveBeenCalledWith('check_addon_git_status', {
      basePath: '/mock/wow',
      addonName: 'TestAddon',
    });
    expect(gitStatusCache.has('TestAddon')).toBe(true);

    // Reset calls
    vi.clearAllMocks();

    // 2. Next check (should hit cache)
    await checkSingleAddonGitStatus('TestAddon', container, '/mock/wow', statusFooter);
    expect(invoke).not.toHaveBeenCalled();

    // 3. Force check (should skip cache)
    await checkSingleAddonGitStatus('TestAddon', container, '/mock/wow', statusFooter, true);
    expect(invoke).toHaveBeenCalledWith('check_addon_git_status', {
      basePath: '/mock/wow',
      addonName: 'TestAddon',
    });
  });

  it('handles check_addon_git_status failure gracefully', async () => {
    const container = document.createElement('div');
    (invoke as any).mockImplementation(() => Promise.reject('Check error'));

    await checkSingleAddonGitStatus('TestAddon', container, '/mock/wow', null, true);
    expect(container.innerHTML).toContain(getTranslation('git.checkfailed'));
  });

  it('covers remaining git-status branches (missing branchName, missing statusFooter, undefined branches list, null branch text)', async () => {
    // 1. undefined branches list, status.branch is falsy, parentContainer and branchSpan missing branches
    const container = document.createElement('div');
    const branchBtn = document.createElement('button'); // no .addon-current-branch span, no parent
    const status = {
      updateAvailable: true,
      lastCommit: 'abc1234',
      branch: undefined, // undefined to test fallback to unknown
      branches: undefined, // undefined to test fallback to empty list
    };

    renderGitStatusUI('TestAddon', container, null, branchBtn, status, '/mock/wow', null);

    // 2. updateBtn click and change_addon_branch click with statusFooter null
    const branchContainer = document.createElement('div');
    const statusWithBranches = {
      updateAvailable: true,
      lastCommit: 'abc1234',
      branch: 'main',
      branches: ['main', 'dev'],
    };
    renderGitStatusUI(
      'TestAddon',
      container,
      branchContainer,
      null,
      statusWithBranches,
      '/mock/wow',
      null
    );

    // trigger update click (statusFooter is null)
    const updateBtn = container.querySelector('.update-addon') as HTMLElement;
    (invoke as any).mockResolvedValueOnce('Updated');
    updateBtn.click();
    await Promise.resolve();

    // Re-render to get updateBtn back
    renderGitStatusUI(
      'TestAddon',
      container,
      branchContainer,
      null,
      statusWithBranches,
      '/mock/wow',
      null
    );

    // fail update click (statusFooter is null)
    const updateBtn2 = container.querySelector('.update-addon') as HTMLElement;
    (invoke as any).mockRejectedValueOnce('Update error');
    updateBtn2.click();
    await Promise.resolve();

    // Re-render for devBtn click
    renderGitStatusUI(
      'TestAddon',
      container,
      branchContainer,
      null,
      statusWithBranches,
      '/mock/wow',
      null
    );

    // click dev button to switch branch (statusFooter is null)
    (invoke as any).mockResolvedValue('Switched branch');
    const devBtn = branchContainer.querySelector('button[data-branch="dev"]') as HTMLElement;

    // remove data-branch to test missing branchName early return
    const originalBranch = devBtn.getAttribute('data-branch');
    devBtn.removeAttribute('data-branch');
    (invoke as any).mockClear();
    devBtn.click(); // returns immediately
    expect(invoke).not.toHaveBeenCalled();

    // restore branch and click
    devBtn.setAttribute('data-branch', originalBranch || 'dev');
    devBtn.click();
    await Promise.resolve();

    // Re-render for devBtn fail click
    renderGitStatusUI(
      'TestAddon',
      container,
      branchContainer,
      null,
      statusWithBranches,
      '/mock/wow',
      null
    );

    // fail branch switch (statusFooter is null)
    const devBtn2 = branchContainer.querySelector('button[data-branch="dev"]') as HTMLElement;
    (invoke as any).mockRejectedValueOnce('Switch error');
    devBtn2.click();
    await Promise.resolve();

    // 3. branchSpan exists, but status.branch is undefined/falsy
    const branchBtnWithSpan = document.createElement('button');
    const branchSpan = document.createElement('span');
    branchSpan.className = 'addon-current-branch';
    branchBtnWithSpan.appendChild(branchSpan);
    renderGitStatusUI(
      'TestAddon',
      container,
      null,
      branchBtnWithSpan,
      { updateAvailable: true, branch: undefined },
      '/mock/wow',
      null
    );
    expect(branchSpan.textContent).toBe(getTranslation('git.unknown'));

    // 4. updateBtn click with null branchContainer
    renderGitStatusUI('TestAddon', container, null, null, statusWithBranches, '/mock/wow', null);
    const updateBtnNoDropdown = container.querySelector('.update-addon') as HTMLElement;
    (invoke as any).mockResolvedValueOnce('Updated');
    updateBtnNoDropdown.click();
    await Promise.resolve();

    // 5. null status with null branchContainer
    renderGitStatusUI('TestAddon', container, null, null, null, '/mock/wow', null);
    expect(container.innerHTML).toBe('');
  });
});
