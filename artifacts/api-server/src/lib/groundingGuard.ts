/**
 * Grounding guard — post-generation sanity check for fabrication.
 *
 * The answer engine must only state companies, clients, industries, and metrics
 * that are supported by the provided grounding context (resume, project, JD,
 * documents, session prompt, transcript).
 *
 * IMPORTANT — this is a GENERIC STRUCTURAL backstop, not a blacklist. A known
 * incident had the model invent "Hilton"/"INFY" + "1TB+"/"99.9%"/"438 days",
 * but a fixed blacklist of names/values only catches previously-seen signatures.
 * A model that invents a *different* fake client story, different fake numbers,
 * or different generic architecture each time sails right through a blacklist.
 * So the guard flags fabrication by STRUCTURE:
 *   - unexplained percentages           ("reduced query time by 30%")
 *   - unexplained data-volume claims     ("1TB+ daily", "500 GB")
 *   - unexplained specific artifact counts ("20+ PySpark transformations")
 *   - invented client industry/domain descriptors ("a large hospitality client")
 *   - plus a still-useful list of commonly hallucinated employer brands
 * A claim is only flagged when its supporting token does NOT appear anywhere in
 * the grounding context supplied for that session.
 *
 * This is intentionally NON-destructive: it detects and reports unsupported
 * claims so they can be logged/observed. Rewriting a streamed answer after the
 * fact risks corrupting a good answer, so the primary defense stays in the
 * system prompt (generic-mode when context is thin); this guard is the
 * observability net that makes regressions visible in logs.
 */

// Well-known employer / brand names that models love to hallucinate. Presence
// of one of these in an answer, when it is NOT in the grounding context, is a
// strong fabrication signal. This is a supplement to the structural checks
// below, not the primary defense.
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
  "hcl",
  "tech mahindra",
  "mindtree",
  "ibm",
  "oracle",
  "sap",
  "adobe",
  "salesforce",
  "cisco",
  "intel",
  "nvidia",
  "samsung",
  "apple",
  "phonepe",
  "razorpay",
  "byju",
  "byjus",
  "myntra",
  "ola",
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
  /\b\d+(?:\.\d+)?\s?(?:million|billion|thousand|lakh|crore|k|m|b)\b\+?/gi, // "5 million users", "10k requests"
];

// Specific artifact counts — "20+ PySpark transformations", "15 microservices",
// "10 pipelines". These are a favourite fabrication that carries no unit so it
// slips past the metric patterns. Up to two adjectives may sit between the
// number and the noun ("20+ optimized PySpark transformations").
const ARTIFACT_NOUNS =
  "transformations?|pipelines?|models?|microservices?|services?|tables?|jobs?|reports?|dashboards?|apis?|endpoints?|integrations?|workflows?|queries|datasets?|data\\s?sets?|connectors?|notebooks?|features?|modules?|components?|scripts?|clusters?|nodes?|environments?|repositories|repos";
const COUNT_PATTERN = new RegExp(
  `\\b(\\d+)\\+?\\s+(?:[a-z][a-z-]*\\s+){0,2}(?:${ARTIFACT_NOUNS})\\b`,
  "gi",
);

// Client / customer industry descriptors. Models invent a plausible customer
// vertical to make a story concrete ("a large hospitality client",
// "a leading healthcare company", "for a retail operations account"). Flag the
// descriptor when the industry word is NOT in the grounding context.
const INDUSTRIES =
  "hospitality|healthcare|health\\s?care|retail|banking|financial|finance|fintech|insurance|logistics|e-?commerce|telecom(?:munications)?|manufacturing|automotive|pharmaceuticals?|pharma|aviation|airline|travel|hotel|hospital|education|edtech|media|entertainment|energy|oil\\s?&?\\s?gas|mining|real\\s?estate|government|defen[cs]e|gaming|automotive|agriculture|construction";
const INDUSTRY_DESCRIPTOR_PATTERN = new RegExp(
  `\\b(?:a|an|the|our|large|leading|major|global|top|reputed)?\\s*(${INDUSTRIES})\\s+(?:client|clients|customer|customers|company|companies|firm|firms|organi[sz]ations?|domain|sector|operations|account|accounts|enterprise|business|giant|major|player|platform)\\b`,
  "gi",
);

function normalize(text: string): string {
  return (text || "").toLowerCase();
}

export interface FabricationFinding {
  type: "employer" | "metric" | "count" | "industry";
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

  // Metrics (percentages, data volumes, durations, scale figures, money).
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

  // Specific artifact counts ("20+ PySpark transformations").
  const seenCounts = new Set<string>();
  for (const match of answer.matchAll(COUNT_PATTERN)) {
    const phrase = match[0].trim();
    const numeric = (match[1] ?? "").trim();
    const key = phrase.toLowerCase().replace(/\s+/g, " ");
    if (seenCounts.has(key)) continue;
    seenCounts.add(key);
    if (numeric && ctx.includes(numeric)) continue; // real count present in context
    findings.push({ type: "count", value: phrase });
  }

  // Invented client industry/domain descriptors.
  const seenIndustries = new Set<string>();
  for (const match of answer.matchAll(INDUSTRY_DESCRIPTOR_PATTERN)) {
    const phrase = match[0].trim();
    const industry = normalize(match[1] ?? "");
    const key = phrase.toLowerCase().replace(/\s+/g, " ");
    if (seenIndustries.has(key)) continue;
    seenIndustries.add(key);
    // Supported only if the industry word itself is in the grounding context.
    const industryBare = industry.replace(/\s+/g, "");
    if (industry && (ctx.includes(industry) || ctx.replace(/\s+/g, "").includes(industryBare))) {
      continue;
    }
    findings.push({ type: "industry", value: phrase });
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
    const countByType = (type: FabricationFinding["type"]) =>
      findings.filter((finding) => finding.type === type).length;
    const meta = {
      sessionId: opts.sessionId,
      unsupportedEmployers: countByType("employer"),
      unsupportedMetrics: countByType("metric"),
      unsupportedCounts: countByType("count"),
      unsupportedIndustries: countByType("industry"),
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
