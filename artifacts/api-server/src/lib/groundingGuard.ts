/**
 * Grounding guard — post-generation sanity check for fabrication.
 *
 * The answer engine must only state companies, clients, and metrics that are
 * supported by the provided grounding context (resume, project, JD, documents,
 * session prompt, transcript). Real incidents this catches: the model invented
 * employers such as "Hilton"/"INFY" and fake metrics such as "1TB+", "99.9%",
 * "438 days" that appeared nowhere in the candidate's context.
 *
 * This is intentionally NON-destructive: it detects and reports unsupported
 * claims so they can be logged/observed. Rewriting a streamed answer after the
 * fact risks corrupting a good answer, so the primary defense stays in the
 * system prompt; this guard is the observability net that makes regressions
 * visible in logs.
 */

// Well-known employer / brand names that models love to hallucinate. Presence
// of one of these in an answer, when it is NOT in the grounding context, is a
// strong fabrication signal.
const COMMON_FABRICATED_EMPLOYERS = [
  "hilton",
  "infy",
  "infosys",
  "tcs",
  "wipro",
  "accenture",
  "cognizant",
  "deloitte",
  "capgemini",
  "amazon",
  "google",
  "microsoft",
  "meta",
  "facebook",
  "netflix",
  "walmart",
  "jpmorgan",
  "goldman sachs",
  "morgan stanley",
  "citibank",
  "hsbc",
  "barclays",
  "uber",
  "airbnb",
  "flipkart",
  "paytm",
  "swiggy",
  "zomato",
];

// Numeric/metric patterns that read as fabricated interview "achievements".
// e.g. "1TB+", "99.9% uptime", "438 days", "reduced latency by 40%".
const METRIC_PATTERNS: RegExp[] = [
  /\b\d+(?:\.\d+)?\s?(?:tb|gb|pb|petabytes?|terabytes?|gigabytes?)\b\+?/gi,
  /\b\d{1,3}(?:\.\d+)?\s?%/g,
  /\b\d+\s?(?:days?|weeks?|months?|hours?)\b/gi,
  /\b\d+(?:,\d{3})+\b/g, // large comma-grouped numbers e.g. 1,200,000
  /\b\d+\s?(?:x|times)\b/gi, // "10x", "3 times faster"
  /\$\s?\d[\d,]*/g, // dollar figures
];

function normalize(text: string): string {
  return (text || "").toLowerCase();
}

export interface FabricationFinding {
  type: "employer" | "metric";
  value: string;
}

/**
 * Returns claims in `answer` that are NOT supported by `context`.
 * `context` should be the concatenation of every grounding source that was
 * available to the model (resume, project, JD, documents, prompt, transcript).
 */
export function detectUnsupportedClaims(
  answer: string,
  context: string,
): FabricationFinding[] {
  const findings: FabricationFinding[] = [];
  if (!answer?.trim()) return findings;
  const ctx = normalize(context);
  const ans = normalize(answer);

  for (const employer of COMMON_FABRICATED_EMPLOYERS) {
    if (ans.includes(employer) && !ctx.includes(employer)) {
      findings.push({ type: "employer", value: employer });
    }
  }

  const seenMetrics = new Set<string>();
  for (const pattern of METRIC_PATTERNS) {
    const matches = answer.match(pattern) || [];
    for (const raw of matches) {
      const metric = raw.trim();
      const key = metric.toLowerCase().replace(/\s+/g, "");
      if (seenMetrics.has(key)) continue;
      seenMetrics.add(key);
      // Supported if the exact numeric token appears in context.
      const numeric = metric.replace(/[^\d.]/g, "");
      if (numeric && ctx.includes(numeric)) continue;
      findings.push({ type: "metric", value: metric });
    }
  }

  return findings;
}

/**
 * Convenience wrapper: detect + emit a structured warning log. Returns the
 * findings so callers can attach them to their own telemetry if desired.
 */
export function auditAnswerGrounding(opts: {
  sessionId?: string;
  answer: string;
  context: string;
  log?: (msg: string, meta: Record<string, unknown>) => void;
}): FabricationFinding[] {
  const findings = detectUnsupportedClaims(opts.answer, opts.context);
  if (findings.length > 0) {
    const meta = {
      sessionId: opts.sessionId,
      unsupportedEmployers: findings.filter((f) => f.type === "employer").map((f) => f.value),
      unsupportedMetrics: findings.filter((f) => f.type === "metric").map((f) => f.value),
    };
    if (opts.log) {
      opts.log("[groundingGuard] unsupported claims detected in generated answer", meta);
    } else {
      // eslint-disable-next-line no-console
      console.warn("[groundingGuard] unsupported claims detected in generated answer", meta);
    }
  }
  return findings;
}
