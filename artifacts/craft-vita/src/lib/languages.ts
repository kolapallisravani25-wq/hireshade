/**
 * Language registry for HireShade sessions (G-021).
 *
 * One entry per selectable conversation language. Every entry carries the
 * fields the product needs at each hop:
 *
 *  - `code`             ISO 639-1 (or closest ISO 639 code) identifier
 *  - `englishName`      canonical English display name (also the value
 *                        persisted in the sessions.language column — the DB
 *                        column predates this registry and existing rows store
 *                        English names, so names are the stable storage key)
 *  - `nativeName`       endonym shown in pickers so a user can find their
 *                        language without reading English
 *  - `deepgramLanguage` the exact `language` value sent to Deepgram in the
 *                        ASR payload. Languages Deepgram cannot transcribe fall
 *                        back to `multi` (Deepgram's multilingual code) instead
 *                        of silently transcribing with an English model
 *  - `promptDirective`  instruction injected into the system prompt so the LLM
 *                        answers in that language regardless of transcript
 *                        language mixing
 *
 * Tier-1 languages (the ten the product markets and smoke-tests) are marked
 * with `tier1: true`; tests assert one entry each with the expected Deepgram
 * value.
 *
 * Adding a language: add one entry, keep English names/codes unique (a test
 * enforces both), and mirror the row in
 * `artifacts/api-server/src/lib/languages.ts` (the API validates + prompts from
 * that mirror; the two lists are asserted to stay in sync by the API test).
 */

export interface LanguageEntry {
  /** ISO 639-1 (or closest ISO 639) code, lowercase. */
  readonly code: string;
  /** Canonical English name. Also the persisted session value. */
  readonly englishName: string;
  /** Endonym shown next to the English name in pickers. */
  readonly nativeName: string;
  /** Value sent to Deepgram as the `language` query/stream parameter. */
  readonly deepgramLanguage: string;
  /** System-prompt instruction that forces the answer language. */
  readonly promptDirective: string;
  /** True for the ten languages the product markets and smoke-tests. */
  readonly tier1?: boolean;
  /** Alternate names/codes accepted from older clients or hand-written input. */
  readonly aliases?: readonly string[];
}

/** Languages Deepgram can transcribe directly (nova-2 family language list). */
const DEEPGRAM_LANGUAGES = new Set([
  "en", "es", "fr", "de", "pt", "hi", "ja", "ko", "zh", "ar",
  "ru", "it", "nl", "tr", "pl", "uk", "sv", "da", "no", "fi",
  "cs", "el", "hu", "ro", "sk", "bg", "hr", "lt", "lv", "et",
  "ca", "id", "ms", "th", "vi", "he", "fa", "ur", "ta", "te", "tl",
]);

interface LanguageSeed {
  code: string;
  englishName: string;
  nativeName: string;
  alias?: readonly string[];
  tier1?: boolean;
}

// ISO 639-1 coverage + widely requested regional/community languages. Ordered
// tier-1 first, then alphabetically by English name, so the generated picker is
// predictable instead of following authoring order.
const SEEDS: readonly LanguageSeed[] = [
  { code: "en", englishName: "English", nativeName: "English", alias: ["en-US", "en-GB"], tier1: true },
  { code: "es", englishName: "Spanish", nativeName: "Español", alias: ["es-ES", "es-MX"], tier1: true },
  { code: "fr", englishName: "French", nativeName: "Français", alias: ["fr-FR"], tier1: true },
  { code: "de", englishName: "German", nativeName: "Deutsch", alias: ["de-DE"], tier1: true },
  { code: "pt", englishName: "Portuguese", nativeName: "Português", alias: ["pt-BR", "pt-PT"], tier1: true },
  { code: "hi", englishName: "Hindi", nativeName: "हिन्दी", tier1: true },
  { code: "ja", englishName: "Japanese", nativeName: "日本語", tier1: true },
  { code: "ko", englishName: "Korean", nativeName: "한국어", tier1: true },
  { code: "zh", englishName: "Chinese (Mandarin)", nativeName: "中文", alias: ["Chinese", "Mandarin", "zh-CN", "zh-Hans"], tier1: true },
  { code: "ar", englishName: "Arabic", nativeName: "العربية", alias: ["ar-SA"], tier1: true },

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
  { code: "tl", englishName: "Filipino", nativeName: "Filipino", alias: ["Tagalog"] },
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
  { code: "ckb", englishName: "Kurdish (Sorani)", nativeName: "کوردی", alias: ["Kurdish"] },
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
  { code: "nb", englishName: "Norwegian", nativeName: "Norsk bokmål", alias: ["no", "Norwegian Bokmål"] },
  { code: "fa", englishName: "Persian", nativeName: "فارسی", alias: ["Farsi"] },
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

function buildEntry(seed: LanguageSeed): LanguageEntry {
  const deepgramLanguage = DEEPGRAM_LANGUAGES.has(seed.code) ? seed.code : "multi";
  return {
    code: seed.code,
    englishName: seed.englishName,
    nativeName: seed.nativeName,
    deepgramLanguage,
    // Keep the directive explicit about the target language name AND its
    // native spelling; models otherwise slip back into English when the
    // transcript itself is mixed.
    promptDirective:
      seed.code === "en"
        ? "Respond in English."
        : `Respond entirely in ${seed.englishName} (${seed.nativeName}). Do not answer in English unless the user explicitly asks for English.`,
    ...(seed.tier1 ? { tier1: true } : {}),
    ...(seed.alias ? { aliases: seed.alias } : {}),
  };
}

/** The full registry. Size and code uniqueness are enforced by tests. */
export const LANGUAGES: readonly LanguageEntry[] = SEEDS.map(buildEntry);

const BY_CODE = new Map<string, LanguageEntry>();
const BY_NAME = new Map<string, LanguageEntry>();
for (const entry of LANGUAGES) {
  BY_CODE.set(entry.code.toLowerCase(), entry);
  BY_NAME.set(entry.englishName.toLowerCase(), entry);
  BY_NAME.set(entry.nativeName.toLowerCase(), entry);
  for (const alias of entry.aliases ?? []) {
    BY_NAME.set(alias.toLowerCase(), entry);
    const maybeCode = alias.length <= 6 ? BY_CODE.get(alias.toLowerCase()) : undefined;
    if (!maybeCode) BY_CODE.set(alias.toLowerCase(), entry);
  }
}

/** Tier-1 entries in the order the product smoke-tests them. */
export const TIER1_LANGUAGES: readonly LanguageEntry[] = LANGUAGES.filter(
  (entry) => entry.tier1 === true,
);

export const DEFAULT_LANGUAGE_CODE = "en";

/** Resolve an ISO code, English name, native name, or legacy alias. */
export function findLanguage(input?: string | null): LanguageEntry | undefined {
  if (!input) return undefined;
  const key = input.trim().toLowerCase();
  if (!key) return undefined;
  return BY_CODE.get(key) ?? BY_NAME.get(key);
}

/** Resolve any stored/legacy value to a registry entry, falling back to English. */
export function normalizeLanguage(input?: string | null): LanguageEntry {
  return (
    findLanguage(input) ??
    (BY_CODE.get(DEFAULT_LANGUAGE_CODE) as LanguageEntry)
  );
}

/** Legacy helper: language name/code -> Deepgram/ASR code. */
export function getLanguageCode(input?: string | null): string {
  return normalizeLanguage(input).deepgramLanguage;
}

/** Legacy helper: language -> English name persisted in the session row. */
export function getLanguageName(input?: string | null): string {
  return normalizeLanguage(input).englishName;
}

/**
 * Exact ASR payload fields — the single place language is threaded into ASR.
 * `language` uses the target-compatible `code[:domain]` format (T-14), e.g.
 * "es" or "es:medical"; `model` is the Deepgram model id. Real Deepgram
 * adapters must strip the `:domain` hint (it is an ASR vocabulary hint, not a
 * valid Deepgram language value) — see `deepgramLanguageForSpec`.
 */
export interface AsrLanguagePayload {
  /** Target-compatible `code[:domain]` language string (T-14). */
  language: string;
  /** Exact value a Deepgram adapter must send on the wire (`multi` fallback). */
  deepgramLanguage: string;
  /** Deepgram model id. */
  model: string;
}

export function buildDeepgramAsrPayload(
  input?: string | null,
  model = "nova-3",
  domain?: string | null,
): AsrLanguagePayload {
  const parsed = parseLanguageSpec(input);
  const normalizedDomain = normalizeLanguageDomain(domain ?? parsed.domain);
  return {
    language: normalizedDomain
      ? `${parsed.entry.code}:${normalizedDomain}`
      : parsed.entry.code,
    deepgramLanguage: parsed.entry.deepgramLanguage,
    model,
  };
}

/** Base Deepgram language value for a `code[:domain]` spec (drops the domain). */
export function deepgramLanguageForSpec(input?: string | null): string {
  return parseLanguageSpec(input).entry.deepgramLanguage;
}

export interface LanguageSpec {
  entry: LanguageEntry;
  /** Optional ASR domain hint, e.g. "medical", "finance", "software". */
  domain?: string;
  /** Canonical `code[:domain]` string passed to the ASR adapter. */
  spec: string;
}

const ASR_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Normalises an ASR domain hint; returns undefined when absent/invalid. */
export function normalizeLanguageDomain(domain?: string | null): string | undefined {
  const candidate = (domain ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!candidate) return undefined;
  return ASR_DOMAIN_RE.test(candidate) ? candidate : candidate.slice(0, 32);
}

/**
 * Parses the target-compatible ASR language format `code[:domain]` (T-14).
 * Accepts `en`, `en:medical`, `English`, `English:medical`, `pt-BR`, etc.
 * Unknown languages fall back to English but keep their domain hint.
 */
export function parseLanguageSpec(input?: string | null): LanguageSpec {
  const raw = (input ?? "").trim();
  const separator = raw.indexOf(":");
  const base = separator >= 0 ? raw.slice(0, separator) : raw;
  const domain = normalizeLanguageDomain(separator >= 0 ? raw.slice(separator + 1) : undefined);
  const entry = normalizeLanguage(base || raw);
  return {
    entry,
    ...(domain ? { domain } : {}),
    spec: domain ? `${entry.code}:${domain}` : entry.code,
  };
}

/** Formats a registry language (plus optional domain) as `code[:domain]`. */
export function formatAsrLanguage(input?: string | null, domain?: string | null): string {
  const parsed = parseLanguageSpec(input);
  const normalizedDomain = normalizeLanguageDomain(domain ?? parsed.domain);
  return normalizedDomain ? `${parsed.entry.code}:${normalizedDomain}` : parsed.entry.code;
}

/** Prompt fragment for the session answer engine. */
export function getLanguagePromptDirective(input?: string | null): string {
  return normalizeLanguage(input).promptDirective;
}

/**
 * Options for a 50+ item picker. `value` is the persisted English name; the
 * label carries the endonym so the list is usable for non-English speakers.
 */
export function languageSelectOptions(): { value: string; label: string; code: string }[] {
  return LANGUAGES.map((entry) => ({
    value: entry.englishName,
    label:
      entry.nativeName && entry.nativeName !== entry.englishName
        ? `${entry.englishName} — ${entry.nativeName}`
        : entry.englishName,
    code: entry.code,
  }));
}