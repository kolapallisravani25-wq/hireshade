import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const nlp = winkNLP(model);
const its = nlp.its;
const as = nlp.as;

const TERM_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "your",
  "their",
  "into",
  "about",
  "have",
  "will",
  "been",
  "were",
  "them",
  "then",
  "when",
  "what",
  "where",
  "which",
  "while",
]);

const KEYTERM_MAX_COUNT = 20;

function normalizeTerm(term: string): string {
  return (term || "")
    .toLowerCase()
    .replace(/[^a-z0-9.+#\-/\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulTerm(term: string): boolean {
  if (!term) return false;
  if (term.length < 3) return false;
  if (/^\d+$/.test(term)) return false;
  if (TERM_STOPWORDS.has(term)) return false;
  return true;
}

/**
 * Extract probable technical keyterms from unstructured interview context text.
 *
 * This is intentionally conservative: it keeps noun/proper-noun signals,
 * filters obvious filler terms, and caps output size to avoid over-biasing ASR.
 */
export function extractInterviewKeywords(text: string | null | undefined): string[] {
  if (!text || !text.trim()) return [];

  const doc = nlp.readDoc(text);

  const rawEntities = doc.entities().out(its.value) as string[];
  const rawNouns = doc
    .tokens()
    .filter((t) => {
      const pos = t.out(its.pos) as string;
      return pos === "PROPN" || pos === "NOUN";
    })
    .out(its.value) as string[];

  const normalized = [...rawEntities, ...rawNouns]
    .map(normalizeTerm)
    .filter(isUsefulTerm);

  // Preserve first-seen order after dedupe.
  const uniqueTerms = Array.from(new Set(normalized));
  return uniqueTerms.slice(0, KEYTERM_MAX_COUNT);
}

export function extractInterviewKeywordsFromParts(
  parts: Array<string | null | undefined>,
): string[] {
  const merged = parts
    .map((p) => (p || "").trim())
    .filter(Boolean)
    .join("\n");

  return extractInterviewKeywords(merged);
}

export function rankKeywordCandidatesByFreq(
  text: string | null | undefined,
): Array<[string, number]> {
  if (!text || !text.trim()) return [];
  const doc = nlp.readDoc(text);
  const nouns = doc
    .tokens()
    .filter((t) => {
      const pos = t.out(its.pos) as string;
      return pos === "PROPN" || pos === "NOUN";
    })
    .out(its.value, as.freqTable) as Array<[string, number]>;

  return nouns
    .map(([term, count]) => [normalizeTerm(term), count] as [string, number])
    .filter(([term]) => isUsefulTerm(term))
    .slice(0, KEYTERM_MAX_COUNT);
}
