/**
 * Code-switch detection (G-039).
 *
 * Interviewers regularly drop a phrase of Hindi, Telugu, Spanish or Arabic into
 * an English question ("yaar can you explain kubernetes?", "como se usa
 * Redis?"). The transcript then mixes scripts/languages, and both the ASR
 * language hint and the answer language have to stay correct.
 *
 * This module detects the mixed tokens, reports primary + secondary language
 * hints, and keeps the answer language pinned to the session output language
 * (never the language the interviewer happened to switch into).
 */
import { findLanguage } from "../../lib/languages";

export interface CodeSwitchLanguageHint {
  code: string;
  name: string;
  /** Whether the hint came from a native script or from a romanized lexicon. */
  source: "script" | "lexicon";
  tokens: string[];
  score: number;
}

export interface CodeSwitchResult {
  isCodeSwitched: boolean;
  /** Majority language of the transcript tokens. */
  primaryLanguage: string;
  primaryLanguageName: string;
  /** Every other detected language, strongest first. */
  secondaryLanguages: CodeSwitchLanguageHint[];
  /** Session output language - the answer language never changes. */
  answerLanguage: string;
  answerLanguageName: string;
  /** Prompt directive describing the mix and the answer-language rule. */
  hint: string;
  confidence: number;
  tokensAnalyzed: number;
}

interface ScriptSpec {
  code: string;
  name: string;
  pattern: RegExp;
}

const SCRIPTS: readonly ScriptSpec[] = [
  { code: "hi", name: "Hindi", pattern: /[\u0900-\u097F]/u },
  { code: "bn", name: "Bengali", pattern: /[\u0980-\u09FF]/u },
  { code: "pa", name: "Punjabi", pattern: /[\u0A00-\u0A7F]/u },
  { code: "gu", name: "Gujarati", pattern: /[\u0A80-\u0AFF]/u },
  { code: "ta", name: "Tamil", pattern: /[\u0B80-\u0BFF]/u },
  { code: "te", name: "Telugu", pattern: /[\u0C00-\u0C7F]/u },
  { code: "kn", name: "Kannada", pattern: /[\u0C80-\u0CFF]/u },
  { code: "ml", name: "Malayalam", pattern: /[\u0D00-\u0D7F]/u },
  { code: "ar", name: "Arabic", pattern: /[\u0600-\u06FF]/u },
  { code: "he", name: "Hebrew", pattern: /[\u0590-\u05FF]/u },
  { code: "el", name: "Greek", pattern: /[\u0370-\u03FF]/u },
  { code: "ru", name: "Russian", pattern: /[\u0400-\u04FF]/u },
  { code: "th", name: "Thai", pattern: /[\u0E00-\u0E7F]/u },
  { code: "zh", name: "Chinese (Mandarin)", pattern: /[\u4E00-\u9FFF]/u },
  { code: "ja", name: "Japanese", pattern: /[\u3040-\u30FF]/u },
  { code: "ko", name: "Korean", pattern: /[\uAC00-\uD7AF]/u },
];

/**
 * High-frequency romanized words from languages that are commonly mixed into
 * Indian/Spanish/Arabic English. Deliberately small and high precision: false
 * positives are worse than misses here because the hint only steers the prompt.
 */
const ROMANIZED_LEXICONS: Readonly<Record<string, readonly string[]>> = {
  hi: [
    "yaar", "matlab", "kya", "kaise", "thoda", "accha", "nahi", "nahin", "hai",
    "ka", "ki", "ke", "bhai", "samajh", "karo", "raha", "rahi", "wala", "abhi",
    "kal", "log", "logon", "baat", "cheez", "kaam", "hoon", "hain", "toh",
    "bhi", "kuch", "sab", "theek", "chalo", "batao",
  ],
  te: [
    "andi", "em", "adi", "ela", "cheppandi", "kada", "manam", "konchem", "baga",
    "chala", "ledu", "undi", "chesta", "chestunna", "ayyo", "enti", "ekkada",
    "ikkada", "chey", "chesam", "vundi", "ra", "abbai",
  ],
  es: [
    "porque", "pero", "cuando", "trabajo", "equipo", "entonces", "gracias",
    "como", "que", "si", "muy", "tambien", "bien", "hola", "bueno", "hacer",
    "tengo", "para", "con", "sobre", "claro", "pues", "ahora", "también",
  ],
  ar: [
    "shukran", "habib", "wallah", "inshallah", "yaani", "khalas", "insha",
    "allah", "akhi", "mabrook", "sabr", "yalla", "habibi", "wallahi",
  ],
  fr: ["merci", "oui", "bonjour", "voila", "tres", "avec", "pour", "alors"],
  de: ["danke", "bitte", "aber", "auch", "nicht", "und", "vielleicht"],
  pt: ["obrigado", "obrigada", "voce", "você", "porque", "entao", "então", "muito"],
};

const LEXICON_BY_LANGUAGE = new Map<string, Set<string>>(
  Object.entries(ROMANIZED_LEXICONS).map(([code, words]) => [code, new Set(words)]),
);

/** Tokenizes into lowercase word cores. */
function tokenize(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-z0-9\u0080-\uFFFF]+|[^a-z0-9\u0080-\uFFFF]+$/g, ""))
    .filter(Boolean);
}

function languageName(code: string, fallback: string): string {
  return findLanguage(code)?.englishName ?? fallback;
}

export function detectCodeSwitch(
  text: string,
  sessionLanguage = "en",
): CodeSwitchResult {
  const tokens = tokenize(text);
  const scores = new Map<string, CodeSwitchLanguageHint>();
  const add = (code: string, name: string, source: "script" | "lexicon", token: string, weight: number): void => {
    const current = scores.get(code) ?? {
      code,
      name: languageName(code, name),
      source,
      tokens: [],
      score: 0,
    };
    current.score += weight;
    if (!current.tokens.includes(token)) current.tokens.push(token);
    // Script evidence is stronger than lexicon evidence for the label.
    if (source === "script") current.source = "script";
    scores.set(code, current);
  };

  for (const token of tokens) {
    let matchedScript = false;
    for (const script of SCRIPTS) {
      if (!script.pattern.test(token)) continue;
      add(script.code, script.name, "script", token, 2);
      matchedScript = true;
      break;
    }
    if (matchedScript) continue;
    for (const [code, lexicon] of LEXICON_BY_LANGUAGE) {
      if (lexicon.has(token)) {
        add(code, languageName(code, code), "lexicon", token, 1);
        break;
      }
    }
  }

  // English is the residual language: every Latin token that is not a known
  // romanized foreign word counts towards English. This keeps an English
  // sentence with one borrowed word from flipping the primary language.
  const foreignLatinTokens = new Set<string>();
  for (const hint of scores.values()) {
    if (hint.source === "lexicon") for (const token of hint.tokens) foreignLatinTokens.add(token);
  }
  const englishTokens = tokens.filter(
    (token) => /^[a-z0-9]+$/.test(token) && !foreignLatinTokens.has(token),
  );
  if (englishTokens.length) {
    add("en", "English", "lexicon", englishTokens[0]!, englishTokens.length * 0.5);
    const englishHint = scores.get("en");
    if (englishHint) englishHint.tokens = englishTokens;
  }

  const ranked = [...scores.values()].sort((a, b) => b.score - a.score);
  const primary = ranked[0];
  const secondary = ranked.slice(1).filter((hint) => hint.score > 0);
  const primaryCode = primary?.code ?? "en";
  const primaryName = primary?.name ?? "English";
  const answerLanguage = findLanguage(sessionLanguage)?.code ?? sessionLanguage;
  const answerLanguageName = languageName(answerLanguage, "English");
  const isCodeSwitched =
    secondary.length > 0 || (primaryCode !== answerLanguage && primaryCode !== "en");
  const confidence = tokens.length
    ? Math.max(0.2, Math.min(1, (primary?.score ?? 0) / Math.max(1, tokens.length)))
    : 0;

  const hint = isCodeSwitched
    ? "Code-switching detected: " +
      primaryName +
      (secondary.length ? " mixed with " + secondary.map((item) => item.name).join(", ") : "") +
      ". Answer in " +
      answerLanguageName +
      " (the session output language), preserve the code-switched named entities, and do not translate them."
    : "Transcript language: " + primaryName + ". Answer in " + answerLanguageName + ".";

  return {
    isCodeSwitched,
    primaryLanguage: primaryCode,
    primaryLanguageName: primaryName,
    secondaryLanguages: secondary,
    answerLanguage,
    answerLanguageName,
    hint,
    confidence: Math.round(confidence * 100) / 100,
    tokensAnalyzed: tokens.length,
  };
}
