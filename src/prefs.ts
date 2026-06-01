import { Lang } from './types';

export const Prefs = {
  getTheme: () => localStorage.getItem('theme'),
  setTheme: (theme: 'light' | 'dark') => localStorage.setItem('theme', theme),
  getLang: (): Lang => (localStorage.getItem('lang') as Lang) || 'en',
  setLang: (lang: Lang) => localStorage.setItem('lang', lang),
};
