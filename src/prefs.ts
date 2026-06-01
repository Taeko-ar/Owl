import { Lang } from './types';

export const Prefs = {
  getTheme: (): 'light' | 'dark' => (localStorage.getItem('theme') as 'light' | 'dark') ?? 'dark',
  setTheme: (theme: 'light' | 'dark') => localStorage.setItem('theme', theme),
  getLang: (): Lang => (localStorage.getItem('lang') as Lang) || 'en',
  setLang: (lang: Lang) => localStorage.setItem('lang', lang),
};
