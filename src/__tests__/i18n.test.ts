import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation((cmd) => {
    if (cmd === 'load_settings') {
      return Promise.resolve({});
    }
    return Promise.resolve();
  }),
}));

import { getTranslation, setAppLanguage, translateDOM, translations } from '../main';

describe('i18n', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('translates values matching dictionary keys correctly', () => {
    localStorage.setItem('lang', 'es');
    expect(getTranslation('tabs.addons')).toBe('Complementos');
    localStorage.setItem('lang', 'pt');
    expect(getTranslation('tabs.addons')).toBe('Addons');
    localStorage.setItem('lang', 'en');
    expect(getTranslation('tabs.addons')).toBe('Addons');
  });

  it('falls back to English when a key is missing in active language', () => {
    localStorage.setItem('lang', 'es');
    const esDict = translations.es;
    const originalValue = esDict['tabs.addons'];
    delete esDict['tabs.addons'];
    try {
      expect(getTranslation('tabs.addons')).toBe('Addons');
    } finally {
      esDict['tabs.addons'] = originalValue;
    }
  });

  it('handles dynamic replacements properly', () => {
    localStorage.setItem('lang', 'en');
    expect(getTranslation('git.switched', { branch: 'main' })).toBe('Switched to branch main');
    localStorage.setItem('lang', 'es');
    expect(getTranslation('git.switched', { branch: 'dev' })).toBe('Cambiado a la rama dev');
  });

  it('updates localized textContent on DOM elements with data-i18n', () => {
    const el = document.createElement('div');
    el.setAttribute('data-i18n', 'tabs.addons');
    el.textContent = 'Old Value';
    document.body.appendChild(el);

    localStorage.setItem('lang', 'es');
    translateDOM();
    expect(el.textContent).toBe('Complementos');

    localStorage.setItem('lang', 'pt');
    translateDOM();
    expect(el.textContent).toBe('Addons');
  });

  it('updates input value attribute for buttons and submit elements', () => {
    const input = document.createElement('input');
    input.type = 'button';
    input.setAttribute('data-i18n', 'buttons.play');
    input.value = 'Old Value';
    document.body.appendChild(input);

    localStorage.setItem('lang', 'es');
    translateDOM();
    expect(input.value).toBe('JUGAR');
  });

  it('sets application language and saves it to localStorage', () => {
    const el = document.createElement('div');
    el.setAttribute('data-i18n', 'tabs.tweaks');
    document.body.appendChild(el);

    setAppLanguage('es');
    expect(localStorage.getItem('lang')).toBe('es');
    expect(el.textContent).toBe('Ajustes');

    setAppLanguage('pt');
    expect(localStorage.getItem('lang')).toBe('pt');
    expect(el.textContent).toBe('Ajustes');
  });

  it('falls back to English when a language is not supported or key is missing', () => {
    localStorage.setItem('lang', 'fr');
    expect(getTranslation('tabs.addons')).toBe('Addons');
    expect(getTranslation('nonexistent.key')).toBe('nonexistent.key');
  });

  it('does not translate when data-i18n attribute is empty', () => {
    const el = document.createElement('div');
    el.setAttribute('data-i18n', '');
    el.textContent = 'Keep Me';
    document.body.appendChild(el);
    translateDOM();
    expect(el.textContent).toBe('Keep Me');
  });

  it('updates optgroup label attribute', () => {
    const optgroup = document.createElement('optgroup');
    optgroup.setAttribute('data-i18n', 'tabs.addons');
    optgroup.label = 'Old Label';
    document.body.appendChild(optgroup);

    localStorage.setItem('lang', 'es');
    translateDOM();
    expect(optgroup.label).toBe('Complementos');
  });

  it('updates placeholder attribute for inputs and textareas', () => {
    const input = document.createElement('input');
    input.setAttribute('data-i18n-placeholder', 'buttons.play');
    document.body.appendChild(input);

    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-i18n-placeholder', 'buttons.play');
    document.body.appendChild(textarea);

    localStorage.setItem('lang', 'es');
    translateDOM();
    expect(input.placeholder).toBe('JUGAR');
    expect(textarea.placeholder).toBe('JUGAR');
  });

  it('updates title attribute on elements with data-i18n-title', () => {
    const el = document.createElement('div');
    el.setAttribute('data-i18n-title', 'buttons.play');
    document.body.appendChild(el);

    localStorage.setItem('lang', 'es');
    translateDOM();
    expect(el.getAttribute('title')).toBe('JUGAR');
  });

  it('updates input value attribute for submit elements', () => {
    const input = document.createElement('input');
    input.type = 'submit';
    input.setAttribute('data-i18n', 'buttons.play');
    input.value = 'Old Value';
    document.body.appendChild(input);

    localStorage.setItem('lang', 'es');
    translateDOM();
    expect(input.value).toBe('JUGAR');
  });

  it('ignores placeholder and title translation when keys are empty or element is invalid', () => {
    const div = document.createElement('div');
    div.setAttribute('data-i18n-placeholder', 'buttons.play');
    div.setAttribute('data-i18n-title', '');
    document.body.appendChild(div);

    const input = document.createElement('input');
    input.setAttribute('data-i18n-placeholder', '');
    document.body.appendChild(input);

    localStorage.setItem('lang', 'es');
    translateDOM();
    expect(div.getAttribute('placeholder')).toBeNull();
    expect(div.getAttribute('title')).toBeNull();
    expect(input.placeholder).toBe('');
  });
});
