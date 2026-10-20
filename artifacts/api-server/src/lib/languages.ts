/**
 * Server-side language registry mirror (G-021).
 *
 * The client owns the full picker registry
 * (`artifacts/craft-vita/src/lib/languages.ts`). The API needs the same data to:
 *   1. validate/normalise the language a session is created/activated with,
 *   2. inject the correct answer-language directive into the system prompt.
 *
 * Both files list the same 80 languages; `tests/languages.test.ts` asserts size,
 * code uniqueness and the tier-1 expectations, and a parity test compares this
 * mirror against the client registry file so drift fails CI.
 *
 * Languages Deepgram cannot transcribe are stored with `deepgramLanguage: "multi"`
 * (Deepgram multilingual fallback) — the client uses the same fallback when it
 * builds the ASR payload.
 */

export interface SessionLanguage {
  readonly code: string;
  readonly englishName: string;
  readonly nativeName: string;
  readonly deepgramLanguage: string;
  readonly promptDirective: string;
  readonly aliases?: readonly string[];
}

const DEEPGRAM_LANGUAGES = new Set([
  "en", "es", "fr", "de", "pt", "hi", "ja", "ko", "zh", "ar",
  "ru", "it", "nl", "tr", "pl", "uk", "sv", "da", "no", "fi",
  "cs", "el", "hu", "ro", "sk", "bg", "hr", "lt", "lv", "et",
  "ca", "id", "ms", "th", "vi", "he", "fa", "ur", "ta", "te", "tl",
]);

interface Seed {
  code: string;
  englishName: string;
  nativeName: string;
  aliases?: readonly string[];
}

// Mirrors the client SEEDS list (same order, same names). Keep in sync.
const SEEDS: readonly Seed[] = [
  { code: "en", englishName: "English", nativeName: "English", aliases: ["en-US", "en-GB"] },
  { code: "es", englishName: "Spanish", nativeName: "Español", aliases: ["es-ES", "es-MX"] },
  { code: "fr", englishName: "French", nativeName: "Français", aliases: ["fr-FR"] },
  { code: "de", englishName: "German", nativeName: "Deutsch", aliases: ["de-DE"] },
  { code: "pt", englishName: "Portuguese", nativeName: "Português", aliases: ["pt-BR", "pt-PT"] },
  { code: "hi", englishName: "Hindi", nativeName: "हिन्दी" },
  { code: "ja", englishName: "Japanese", nativeName: "日本語" },
  { code: "ko", englishName: "Korean", nativeName: "한국어" },
  { code: "zh", englishName: "Chinese (Mandarin)", nativeName: "中文", aliases: ["Chinese", "Mandarin", "zh-CN", "zh-Hans"] },
  { code: "ar", englishName: "Arabic", nativeName: "العربية", aliases: ["ar-SA"] },
  { code: "af", englishName: "Afrikaans", nativeName: "Afrikaans" },
  { code: "sq", englishName: "Albanian", nativeName: "Shqip" },
  { code: "am", englishName: "Amharic", nativeName: "አማርኛ" },
  { code: "hy", englishName: "Armenian", nativeName: "Հայերեն" },
  { code: "az", englishName: "Azerbaijani", nativeName: "Azərbaycanca" },
  { code: "eu", englishName: "Basque", nativeName: "Euskara" },
  { code: "bn", englishName: "Bengali", nativeName: "বাংলা" },
  { code: "bs", englishName: "Bosnian", nativeName: "Bosanski" },
  { code: "bg", englishName: "Bulgarian", nativeName: "Български" },
  { code: "my", englishName: "Burmese", nativeName: "မြန်မာ" },
  { code: "ca", englishName: "Catalan", nativeName: "Català" },
  { code: "hr", englishName: "Croatian", nativeName: "Hrvatski" },
  { code: "cs", englishName: "Czech", nativeName: "Čeština" },
  { code: "da", englishName: "Danish", nativeName: "Dansk" },
  { code: "nl", englishName: "Dutch", nativeName: "Nederlands" },
  { code: "et", englishName: "Estonian", nativeName: "Eesti" },
  { code: "tl", englishName: "Filipino", nativeName: "Filipino", aliases: ["Tagalog"] },
  { code: "fi", englishName: "Finnish", nativeName: "Suomi" },
  { code: "gl", englishName: "Galician", nativeName: "Galego" },
  { code: "ka", englishName: "Georgian", nativeName: "ქართული" },
  { code: "el", englishName: "Greek", nativeName: "Ελληνικά" },
  { code: "gu", englishName: "Gujarati", nativeName: "ગુજરાતી" },
  { code: "ha", englishName: "Hausa", nativeName: "Hausa" },
  { code: "he", englishName: "Hebrew", nativeName: "עברית" },
  { code: "hu", englishName: "Hungarian", nativeName: "Magyar" },
  { code: "is", englishName: "Icelandic", nativeName: "Íslenska" },
  { code: "ig", englishName: "Igbo", nativeName: "Igbo" },
  { code: "id", englishName: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "ga", englishName: "Irish", nativeName: "Gaeilge" },
  { code: "it", englishName: "Italian", nativeName: "Italiano" },
  { code: "kn", englishName: "Kannada", nativeName: "ಕನ್ನಡ" },
  { code: "kk", englishName: "Kazakh", nativeName: "Қазақша" },
  { code: "km", englishName: "Khmer", nativeName: "ខ្មែរ" },
  { code: "ckb", englishName: "Kurdish (Sorani)", nativeName: "کوردی", aliases: ["Kurdish"] },
  { code: "lo", englishName: "Lao", nativeName: "ລາວ" },
  { code: "lv", englishName: "Latvian", nativeName: "Latviešu" },
  { code: "lt", englishName: "Lithuanian", nativeName: "Lietuvių" },
  { code: "mk", englishName: "Macedonian", nativeName: "Македонски" },
  { code: "ms", englishName: "Malay", nativeName: "Bahasa Melayu" },
  { code: "ml", englishName: "Malayalam", nativeName: "മലയാളം" },
  { code: "mt", englishName: "Maltese", nativeName: "Malti" },
  { code: "mr", englishName: "Marathi", nativeName: "मराठी" },
  { code: "mn", englishName: "Mongolian", nativeName: "Монгол" },
  { code: "ne", englishName: "Nepali", nativeName: "नेपाली" },
  { code: "nb", englishName: "Norwegian", nativeName: "Norsk bokmål", aliases: ["no", "Norwegian Bokmål"] },
  { code: "fa", englishName: "Persian", nativeName: "فارسی", aliases: ["Farsi"] },
  { code: "pl", englishName: "Polish", nativeName: "Polski" },
  { code: "pa", englishName: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
  { code: "ro", englishName: "Romanian", nativeName: "Română" },
  { code: "ru", englishName: "Russian", nativeName: "Русский" },
  { code: "sr", englishName: "Serbian", nativeName: "Српски" },
  { code: "si", englishName: "Sinhala", nativeName: "සිංහල" },
  { code: "sk", englishName: "Slovak", nativeName: "Slovenčina" },
  { code: "sl", englishName: "Slovenian", nativeName: "Slovenščina" },
  { code: "so", englishName: "Somali", nativeName: "Soomaali" },
  { code: "sw", englishName: "Swahili", nativeName: "Kiswahili" },
  { code: "sv", englishName: "Swedish", nativeName: "Svenska" },
  { code: "ta", englishName: "Tamil", nativeName: "தமிழ்" },
  { code: "te", englishName: "Telugu", nativeName: "తెలుగు" },
  { code: "th", englishName: "Thai", nativeName: "ไทย" },
  { code: "tr", englishName: "Turkish", nativeName: "Türkçe" },
  { code: "uk", englishName: "Ukrainian", nativeName: "Українська" },
  { code: "ur", englishName: "Urdu", nativeName: "اردو" },
  { code: "uz", englishName: "Uzbek", nativeName: "Oʻzbekcha" },
  { code: "vi", englishName: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "cy", englishName: "Welsh", nativeName: "Cymraeg" },
  { code: "yo", englishName: "Yoruba", nativeName: "Yorùbá" },
  { code: "zu", englishName: "Zulu", nativeName: "isiZulu" },
];

function build(seed: Seed): SessionLanguage {
  const deepgramLanguage = DEEPGRAM_LANGUAGES.has(seed.code) ? seed.code : "multi";
  return {
    code: seed.code,
    englishName: seed.englishName,
    nativeName: seed.nativeName,
    deepgramLanguage,
    promptDirective:
      seed.code === "en"
        ? "Respond in English."
        : `Respond entirely in ${seed.englishName} (${seed.nativeName}). Do not answer in English unless the user explicitly asks for English.`,
    ...(seed.aliases ? { aliases: seed.aliases } : {}),
  };
}

export const SESSION_LANGUAGES: readonly SessionLanguage[] = SEEDS.map(build);

const BY_CODE = new Map<string, SessionLanguage>();
const BY_NAME = new Map<string, SessionLanguage>();
for (const entry of SESSION_LANGUAGES) {
  BY_CODE.set(entry.code.toLowerCase(), entry);
  BY_NAME.set(entry.englishName.toLowerCase(), entry);
  BY_NAME.set(entry.nativeName.toLowerCase(), entry);
  for (const alias of entry.aliases ?? []) {
    BY_NAME.set(alias.toLowerCase(), entry);
    if (!BY_CODE.has(alias.toLowerCase())) BY_CODE.set(alias.toLowerCase(), entry);
  }
}

export const DEFAULT_SESSION_LANGUAGE = SESSION_LANGUAGES[0]!;

/** Resolve by ISO code, English name, native name, legacy alias or `code[:domain]`. */
export function findSessionLanguage(input?: string | null): SessionLanguage | undefined {
  if (!input) return undefined;
  const raw = input.trim();
  if (!raw) return undefined;
  const base = raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : raw;
  const key = base.trim().toLowerCase();
  return BY_CODE.get(key) ?? BY_NAME.get(key);
}

/**
 * Normalise a language for persistence. Returns `undefined` for unknown input so
 * routes can reject it explicitly instead of silently storing a language the
 * prompt builder cannot handle.
 */
export function normalizeSessionLanguage(input?: string | null): SessionLanguage | undefined {
  if (!input || !input.trim()) return DEFAULT_SESSION_LANGUAGE;
  return findSessionLanguage(input);
}

/** Directive injected into the answer system prompt. */
export function sessionLanguagePromptDirective(input?: string | null): string {
  return (findSessionLanguage(input) ?? DEFAULT_SESSION_LANGUAGE).promptDirective;
}

/** English display name persisted in sessions.language. */
export function sessionLanguageName(input?: string | null): string {
  return (findSessionLanguage(input) ?? DEFAULT_SESSION_LANGUAGE).englishName;
}
