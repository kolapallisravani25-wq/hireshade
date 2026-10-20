/**
 * TTS pronunciation lexicon + SSML builder for the mock interviewer (G-039).
 *
 * Pure builder: given the question text, wrap every known domain term in an
 * SSML pronunciation override so the interviewer voice says "koo-ber-net-eez"
 * instead of spelling Kubernetes. Two modes:
 *   - "sub"     -> <sub alias="...">term</sub> (widest support: Azure, Polly v1)
 *   - "phoneme" -> <phoneme alphabet="ipa" ph="...">term</phoneme> (when IPA is known)
 *
 * No audio is produced here and no network is used; TtsProvider adapters consume
 * the returned SSML. Unknown terms are left untouched.
 */
import { DOMAIN_TERMS, normalizePhrase, type DomainTerm } from "./phonemeMap";

export interface TtsLexiconEntry {
  term: string;
  say: string;
  ipa?: string;
}

export interface TtsLexicon {
  entries: ReadonlyMap<string, TtsLexiconEntry>;
}

export interface BuildTtsLexiconOptions {
  /** Extra term -> respelling overrides (win over the domain map). */
  overrides?: Readonly<Record<string, string>>;
  /** Restrict the lexicon to these canonical terms (default: all domain terms). */
  terms?: readonly string[];
}

export function buildTtsLexicon(options: BuildTtsLexiconOptions = {}): TtsLexicon {
  const entries = new Map<string, TtsLexiconEntry>();
  for (const domain of DOMAIN_TERMS) {
    const key = normalizePhrase(domain.canonical);
    entries.set(key, {
      term: domain.canonical,
      say: domain.say,
      ...(domain.ipa ? { ipa: domain.ipa } : {}),
    });
  }
  for (const [term, say] of Object.entries(options.overrides ?? {})) {
    const key = normalizePhrase(term);
    const existing = entries.get(key);
    entries.set(key, {
      term: existing?.term ?? term,
      say,
      ...(existing?.ipa ? { ipa: existing.ipa } : {}),
    });
  }
  if (options.terms) {
    const allowed = new Set(options.terms.map((term) => normalizePhrase(term)));
    for (const key of [...entries.keys()]) {
      if (!allowed.has(key)) entries.delete(key);
    }
  }
  return { entries };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function attribute(value: string): string {
  return escapeXml(value).replace(/"/g, "&quot;");
}

export interface BuildSsmlOptions {
  lexicon?: TtsLexicon;
  /** "sub" (default) or "phoneme". */
  mode?: "sub" | "phoneme";
  /** Speaking rate as an SSML percentage (e.g. 100). */
  ratePercent?: number;
  /** Pitch in SSML semitones (e.g. -1). */
  pitchSemitones?: number;
  /** Language tag for the ssml root (e.g. "en-US"). */
  language?: string;
  /** Mock interviewer voice name (informational attribute only). */
  voice?: string;
}

/** Wraps known terms in the text with SSML pronunciation overrides. */
export function buildSsml(text: string, options: BuildSsmlOptions = {}): string {
  const lexicon = options.lexicon ?? buildTtsLexicon();
  const mode = options.mode ?? "sub";
  const entries = [...lexicon.entries.values()].sort(
    (a, b) => b.term.length - a.term.length,
  );
  if (!entries.length) {
    return wrapDocument(escapeXml(text), options);
  }

  // Match longest terms first, on word boundaries, case-insensitively, without
  // re-processing text that was already wrapped.
  const pattern = new RegExp(
    "\\b(" + entries.map((entry) => escapeRegExp(entry.term)).join("|") + ")\\b",
    "gi",
  );
  const byTerm = new Map(entries.map((entry) => [normalizePhrase(entry.term), entry]));
  const escapedText = escapeXml(text);
  const replaced = escapedText.replace(pattern, (match) => {
    const entry = byTerm.get(normalizePhrase(match));
    if (!entry) return match;
    if (mode === "phoneme" && entry.ipa) {
      return '<phoneme alphabet="ipa" ph="' + attribute(entry.ipa) + '">' + match + "</phoneme>";
    }
    return '<sub alias="' + attribute(entry.say) + '">' + match + "</sub>";
  });
  return wrapDocument(replaced, options);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wrapDocument(inner: string, options: BuildSsmlOptions): string {
  const language = options.language ?? "en-US";
  const attrs: string[] = ['xmlns="http://www.w3.org/2001/10/synthesis"', 'version="1.1"'];
  attrs.push('xml:lang="' + attribute(language) + '"');
  if (options.voice) attrs.push('data-voice="' + attribute(options.voice) + '"');
  const body: string[] = [];
  if (options.ratePercent !== undefined || options.pitchSemitones !== undefined) {
    const prosody: string[] = [];
    if (options.ratePercent !== undefined) prosody.push('rate="' + options.ratePercent + '%"');
    if (options.pitchSemitones !== undefined) prosody.push('pitch="' + options.pitchSemitones + 'st"');
    body.push("<prosody " + prosody.join(" ") + ">" + inner + "</prosody>");
  } else {
    body.push(inner);
  }
  return "<speak " + attrs.join(" ") + ">" + body.join("") + "</speak>";
}

/** Convenience for the mock interviewer path. */
export function buildInterviewerSsml(question: string, options: BuildSsmlOptions = {}): string {
  return buildSsml(question, {
    mode: "sub",
    ratePercent: 100,
    language: "en-US",
    ...options,
  });
}

/** Domain terms that carry an IPA override (used by tests/evidence). */
export function termsWithPronunciation(lexicon: TtsLexicon = buildTtsLexicon()): DomainTerm[] {
  return [...lexicon.entries.values()].map((entry) => ({
    canonical: entry.term,
    keys: [entry.term.toLowerCase()],
    say: entry.say,
    ...(entry.ipa ? { ipa: entry.ipa } : {}),
    variants: [],
    kind: "technology",
  }));
}
