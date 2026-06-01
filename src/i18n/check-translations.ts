import { translations } from './translations';

const baseKeys = Object.keys(translations.en);
let hasError = false;

for (const lang of ['es', 'pt']) {
  const langKeys = Object.keys(translations[lang]);
  const missing = baseKeys.filter((k) => !langKeys.includes(k));
  const extra = langKeys.filter((k) => !baseKeys.includes(k));

  if (missing.length > 0) {
    console.error(`Language '${lang}' is missing keys:`, missing);
    hasError = true;
  }
  if (extra.length > 0) {
    console.error(`Language '${lang}' has extra keys not in 'en':`, extra);
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
} else {
  console.log('i18n check passed: all languages have matching keys.');
}
