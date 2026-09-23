// The spoken voice-entry language is a stored preference (localStorage),
// same host-layer reasoning as `currencySymbol.js`: it's not a budget-calc
// concept, just which ASR model/parsing grammar `VoiceCapture.jsx` should
// use. Deliberately a separate stored preference from `i18n/index.jsx`'s
// display locale -- someone may want the app displayed in English while
// speaking Mandarin transactions, or vice versa, so `LOCALES`/`setLocale`
// must not be reused here.

const STORAGE_KEY = 'bp:voiceLanguage';

export const DEFAULT_VOICE_LANGUAGE = 'en';

export const VOICE_LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'cmn', label: '普通话 (Mandarin)' },
  { id: 'yue', label: '廣東話 (Cantonese)' },
];

export function getVoiceLanguage() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return VOICE_LANGUAGES.some((l) => l.id === value) ? value : DEFAULT_VOICE_LANGUAGE;
  } catch {
    return DEFAULT_VOICE_LANGUAGE;
  }
}

export function setVoiceLanguage(language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Preference just won't survive the tab; the session still switches.
  }
}
