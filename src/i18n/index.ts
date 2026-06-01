import { Prefs } from '../prefs';
import { translations } from './translations';
export { translations };

export function getTranslation(key: string, replacements?: Record<string, string>): string {
  const lang = Prefs.getLang();
  const dict = translations[lang] || translations['en'];
  let text = dict[key] || translations['en'][key] || key;
  if (replacements) {
    for (const [k, v] of Object.entries(replacements)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}

export function translateDOM() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const val = getTranslation(key);
    if (el instanceof HTMLInputElement && (el.type === 'button' || el.type === 'submit')) {
      el.value = val;
    } else if (el instanceof HTMLOptGroupElement) {
      el.label = val;
    } else {
      el.textContent = val;
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      el.placeholder = getTranslation(key);
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      el.setAttribute('title', getTranslation(key));
    }
  });
}

export function setAppLanguage(lang: 'en' | 'es' | 'pt') {
  Prefs.setLang(lang);
  translateDOM();
}
