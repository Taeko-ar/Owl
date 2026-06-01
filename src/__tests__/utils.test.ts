import { knownConfigs, getConfigMetadata } from '../config/known-configs';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  debounce,
  escapeHtml,
  formatWithColorCodes,
  renderMarkdown,
  setLoadingState,
  clearLoadingState,
  showTextInputModal,
  showToast,
  parsePatchFilename,
} from '../utils';

describe('utils', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('escapes HTML entities correctly', () => {
    expect(escapeHtml('<div>&"</div>')).toBe('&lt;div&gt;&amp;&quot;&lt;/div&gt;');
    expect(escapeHtml('plain')).toBe('plain');
  });

  it('formats WoW color codes into spans and closes open tags', () => {
    const html = formatWithColorCodes('|cff00ff00Green|r and |cff0000ffBlue');
    expect(html).toContain('<span style="color:#00ff00">Green</span>');
    expect(html).toContain('<span style="color:#0000ff">Blue</span>');
  });

  it('returns an empty string for missing color code input', () => {
    expect(formatWithColorCodes('')).toBe('');
  });

  it('renders markdown headings, bold, code, links, and sanitizes scripts', () => {
    const html = renderMarkdown(
      '# Title\n\n**Bold** and `code`.\n\n[Link](https://example.com)\n\n<script>alert(1)</script>'
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<a href="https://example.com"');
    expect(html).not.toContain('<script>');
  });

  it('resolves addon-relative image src to file URI', () => {
    const html = renderMarkdown('![alt](./image.png)', 'C:\\game\\addon');
    expect(html).toContain('src="file:///C:/game/addon/image.png"');
    expect(html).toContain('alt="alt"');
  });

  it('friendlyConfigName converts camelCase, snake_case and kebab-case correctly', () => {
    expect(getConfigMetadata('test_config_value', 'test_config_value').alias).toBe(
      'Test Config Value'
    );
    expect(getConfigMetadata('anotherTestKey', 'anotherTestKey').alias).toBe('Another Test Key');
    expect(getConfigMetadata('yet-another.key', 'yet-another.key').alias).toBe('Yet Another Key');
  });

  it('getConfigMetadata returns known configs from alias or fullKey', () => {
    const meta = getConfigMetadata('gxRefresh', 'gxRefresh');
    expect(meta).toEqual(knownConfigs.gxRefresh);
    const fallback = getConfigMetadata('unknownKey', 'unknownKey');
    expect(fallback.alias).toBe('Unknown Key');
    expect(fallback.desc).toContain('Configuration option from config.wtf.');
  });

  it('returns metadata for video and interface config values', () => {
    expect(getConfigMetadata('farClip', 'farClip').alias).toBe('View Distance');
    expect(getConfigMetadata('farClip', 'farClip').type).toBe('number');
    expect(getConfigMetadata('mouseSpeed', 'mouseSpeed').alias).toBe('Mouse Speed');
    expect(getConfigMetadata('mouseSpeed', 'mouseSpeed').type).toBe('number');
  });

  it('includes numeric range metadata for known config controls', () => {
    const farClip = knownConfigs.farClip;
    expect(farClip).toBeDefined();
    expect(farClip.min).toBe(177);
    expect(farClip.max).toBe(1277);
    expect(farClip.step).toBe(1);

    const maxFPS = knownConfigs.maxFPS;
    expect(maxFPS).toBeDefined();
    expect(maxFPS.min).toBe(0);
    expect(maxFPS.max).toBe(240);
    expect(maxFPS.step).toBe(1);

    const mouseSpeed = knownConfigs.mouseSpeed;
    expect(mouseSpeed).toBeDefined();
    expect(mouseSpeed.min).toBe(0.5);
    expect(mouseSpeed.max).toBe(2.5);
    expect(mouseSpeed.step).toBe(0.01);
  });

  it('provides explicit options for WotLK-specific dropdowns', () => {
    expect(knownConfigs.gxRefresh.options).toEqual([
      { label: '60 Hz', value: '60' },
      { label: '75 Hz', value: '75' },
      { label: '144 Hz', value: '144' },
      { label: '240 Hz', value: '240' },
    ]);
    expect(knownConfigs.processAffinityMask.options).toEqual([
      { label: '2 cores (3)', value: '3' },
      { label: '4 cores (15)', value: '15' },
      { label: '8 cores (255)', value: '255' },
    ]);
  });

  it('debounce delays invocation and consolidates multiple calls', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced('a');
    debounced('b');
    debounced('c');

    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('setLoadingState sets status text and clamps progress', () => {
    const statusFooter = document.createElement('div');
    const activityProgress = document.createElement('div');
    setLoadingState('Loading...', 150, statusFooter, activityProgress);
    expect(statusFooter.textContent).toBe('Loading...');
    expect(activityProgress.style.width).toBe('100%');

    setLoadingState('Waiting', -50, statusFooter, activityProgress);
    expect(activityProgress.style.width).toBe('0%');
  });

  it('clearLoadingState resets status and progress', () => {
    const statusFooter = document.createElement('div');
    statusFooter.textContent = 'Busy';
    const activityProgress = document.createElement('div');
    activityProgress.style.width = '50%';
    clearLoadingState(statusFooter, activityProgress);
    expect(statusFooter.textContent).toBe('Ready');
    expect(activityProgress.style.width).toBe('0%');
  });

  it('showTextInputModal resolves with entered text and closes overlay', async () => {
    const promise = showTextInputModal({
      title: 'Test',
      label: 'Enter value',
      placeholder: 'value',
      submitText: 'OK',
      cancelText: 'Cancel',
    });

    const input = document.querySelector('#modalInput') as HTMLInputElement;
    const submit = document.querySelector('#modalSubmitBtn') as HTMLButtonElement;
    expect(input).not.toBeNull();
    input.value = 'hello';
    submit.click();

    const result = await promise;
    expect(result).toBe('hello');
    expect(document.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('showTextInputModal returns null when cancelled', async () => {
    const promise = showTextInputModal({
      title: 'Test',
      label: 'Enter value',
      placeholder: 'value',
    });

    const cancel = document.querySelector('#modalCancelBtn2') as HTMLButtonElement;
    expect(cancel).not.toBeNull();
    cancel.click();

    const result = await promise;
    expect(result).toBeNull();
    expect(document.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('showToast appends and removes a toast element', () => {
    vi.useFakeTimers();
    showToast('Hello', 100);
    const toast = document.querySelector('.toast');
    expect(toast).not.toBeNull();

    vi.advanceTimersByTime(100);
    vi.runOnlyPendingTimers();
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('parses patch filenames correctly to determine if they are enabled and get their display names', () => {
    expect(parsePatchFilename('patch-A.mpq')).toEqual({
      enabled: true,
      displayName: 'patch-A.mpq',
    });
    expect(parsePatchFilename('patch-B-disabled.mpq')).toEqual({
      enabled: false,
      displayName: 'patch-B.mpq',
    });
    expect(parsePatchFilename('customPatch-disabled.mpq')).toEqual({
      enabled: false,
      displayName: 'customPatch.mpq',
    });
    expect(parsePatchFilename('patch-C')).toEqual({
      enabled: true,
      displayName: 'patch-C',
    });
    expect(parsePatchFilename('patch-C-disabled')).toEqual({
      enabled: false,
      displayName: 'patch-C',
    });
  });
});
