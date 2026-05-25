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
});
