import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import de from "./locales/de.json";

const LANGUAGE_STORAGE_KEY = "i18nextLng";
const SUPPORTED_LANGUAGES = ["en", "de"];
const DEFAULT_LANGUAGE = "de";

const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
const initialLanguage =
  storedLanguage && SUPPORTED_LANGUAGES.includes(storedLanguage)
    ? storedLanguage
    : DEFAULT_LANGUAGE;

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: initialLanguage,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

// Persist the chosen language so it survives reloads. Listening on the i18n
// event keeps this working no matter where the change is triggered from.
i18n.on("languageChanged", (lng) => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
});

export default i18n;
