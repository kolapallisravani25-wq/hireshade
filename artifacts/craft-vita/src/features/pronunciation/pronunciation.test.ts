import { describe, expect, it } from "vitest";
import { doubleMetaphone } from "./doubleMetaphone";
import { phoneticallyEquivalent, phoneticKey, phoneticKeys } from "./phonetics";
import { buildVocabulary } from "./vocabulary";
import { rescueLowConfidenceWords } from "./rescue";
import { makeWordToken, wordsFromText } from "./text";
import { HIGH_CONFIDENCE_THRESHOLD, type WordToken } from "./types";
import {
  applyRepairSuggestions,
  createLlmRepairProvider,
  createMockRepairProvider,
  repairLowConfidenceSegment,
} from "./repair";
import { decideConfidenceGate } from "./confidenceGate";
import { detectCodeSwitch } from "./codeSwitch";
import { buildInterviewerSsml, buildSsml, buildTtsLexicon } from "./ttsLexicon";
import { understandTranscript } from "./understanding";
import { createMockAsrProvider } from "../../../../api-server/src/lib/mocks/mockAsr";
import {
  buildDeepgramListenUrl,
  mapDeepgramMessage,
} from "../../../../api-server/src/lib/mocks/asrDeepgram";
import type { LlmProvider } from "../../../../api-server/src/lib/mocks/types";

const VOCAB = buildVocabulary({
  resumeText:
    "Built a Redis-backed rate limiter for Postgres and Kubernetes. Worked with Nguyen on payments and Priya on the migration.",
  jobDescription: "Node.js, TypeScript, Terraform, Kafka, GraphQL observability.",
  companyNames: ["Northwind Labs"],
});

function word(raw: string, confidence: number, index = 0): WordToken {
  return makeWordToken({ index, raw, confidence, provenance: "asr" });
}

function lowSegment(): WordToken[] {
  return [
    word("Can", 0.95, 0),
    word("you", 0.95, 1),
    word("index", 0.62, 2),
    word("Postgres", 0.34, 3),
    word("in", 0.95, 4),
    word("Redis", 0.98, 5),
  ];
}

describe("vendored double metaphone", () => {
  it("returns primary and secondary codes and matches known homophones", () => {
    expect(phoneticKeys("Smith").primary).toBe("SM0");
    expect(phoneticKeys("Smyth").primary).toBe("SM0");
    expect(phoneticallyEquivalent("Kubernetes", "koobernetes")).toBe(true);
    expect(phoneticallyEquivalent("Postgres", "bostgres")).toBe(true);
    expect(phoneticallyEquivalent("Redis", "reddis")).toBe(true);
    expect(phoneticKey("Kafka")).toBe(phoneticKey("kavka"));
    // Nguyen/newen are not phonetic-code equivalent; that pair is handled by
    // the explicit domain variant map instead (covered by the corpus metrics).
    expect(phoneticKeys("Nguyen").primary.length).toBeGreaterThan(0);
  });
});

describe("vocabulary builder", () => {
  it("dedupes, canonicalises casing and carries phonetic keys", () => {
    const vocab = buildVocabulary({
      resumeText: "kubernetes KUBERNETES Kubernetes postgres",
      companyNames: ["northwind labs", "Northwind Labs"],
    });
    const kubernetes = vocab.entries.filter(
      (entry) => entry.normalized === "kubernetes",
    );
    expect(kubernetes).toHaveLength(1);
    expect(kubernetes[0]!.canonical).toBe("Kubernetes");
    expect(kubernetes[0]!.phonetic.length).toBeGreaterThan(0);
    const northwind = vocab.entries.filter(
      (entry) => entry.normalized === "northwind labs",
    );
    expect(northwind).toHaveLength(1);
    expect(northwind[0]!.canonical).toBe("Northwind Labs");
    expect(vocab.keywords.some((keyword) => keyword.term === "Kubernetes")).toBe(true);
  });
});

describe("phonetic rescue — low-confidence only", () => {
  it("rescues a garbled domain term from the vocabulary", () => {
    const result = rescueLowConfidenceWords(
      [word("Can", 0.95), word("you", 0.95), word("kubernates", 0.4), word("index", 0.4)],
      VOCAB,
    );
    expect(result.rescues.length).toBeGreaterThanOrEqual(1);
    expect(result.words.map((item) => item.word)).toContain("Kubernetes");
    expect(result.highConfidenceUntouched).toBe(true);
  });

  it("never touches a high-confidence word, including in a phrase", () => {
    const input = [
      word("Why", 0.96),
      word("Redis", 0.99),
      word("kubernates", 0.35),
      word("here", 0.95),
    ];
    const result = rescueLowConfidenceWords(input, VOCAB);
    const redis = result.words.find((item) => item.word === "Redis");
    expect(redis?.confidence).toBe(0.99);
    expect(redis?.provenance).toBe("asr");
    expect(result.highConfidenceUntouched).toBe(true);
  });

  it("uses context to resolve the cache/cash homophone, and refuses without context", () => {
    const withCue = rescueLowConfidenceWords(
      [
        word("invalidated", 0.93, 0),
        word("the", 0.95, 1),
        word("cash", 0.38, 2),
        word("on", 0.95, 3),
        word("writes", 0.9, 4),
      ],
      VOCAB,
    );
    expect(withCue.words.map((item) => item.word)).toContain("cache");

    const noCue = rescueLowConfidenceWords(
      [word("cash", 0.38, 0), word("flow", 0.9, 1)],
      VOCAB,
    );
    expect(noCue.words[0]!.word).toBe("cash");
    expect(noCue.ambiguities.length).toBeGreaterThan(0);
  });
});

describe("targeted repair pass — hard rules", () => {
  it("repairs only low-confidence spans and preserves high-confidence words", async () => {
    const words = lowSegment();
    const provider = createMockRepairProvider({
      table: { postgres: "PostgreSQL" },
      simulateLatencyMs: 7,
    });
    const result = await repairLowConfidenceSegment(words, provider, { vocabulary: VOCAB });
    expect(result.skippedHighConfidence).toBe(false);
    expect(result.request?.editableSpans.map((span) => span.heard)).toEqual(["index Postgres"]);
    expect(result.applied.length).toBe(1);
    expect(result.words.map((item) => item.word)).toContain("PostgreSQL");
    expect(result.elapsedMs).toBeLessThan(150);
    for (const original of words) {
      if (original.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
        expect(result.words.some((item) => item.raw === original.raw)).toBe(true);
      }
    }
  });

  it("rejects a provider suggestion that touches a high-confidence word", () => {
    const words = [word("Why", 0.99), word("bostgres", 0.35)];
    const applied = applyRepairSuggestions(words, [
      { start: 0, end: 2, replacement: "What", confidence: 1 },
    ]);
    expect(applied.applied).toHaveLength(0);
    expect(applied.rejected[0]!.reason).toBe("high_confidence_protected");
    expect(applied.words[0]!.raw).toBe("Why");
  });

  it("preserves unverified named entities", () => {
    const words = [word("Nguyen", 0.4), word("feedback", 0.9)];
    const applied = applyRepairSuggestions(words, [
      { start: 0, end: 1, replacement: "Newton", confidence: 0.9 },
    ]);
    expect(applied.applied).toHaveLength(0);
    expect(applied.rejected[0]!.reason).toBe("named_entity_preserved");
    expect(applied.words[0]!.word).toBe("Nguyen");
  });

  it("skips the provider entirely for an all-high segment", async () => {
    let calls = 0;
    const provider = createMockRepairProvider();
    const spy = { ...provider, repair: async (request: Parameters<typeof provider.repair>[0]) => { calls += 1; return provider.repair(request); } };
    const result = await repairLowConfidenceSegment(wordsFromText("Why Redis here?"), spy);
    expect(result.skippedHighConfidence).toBe(true);
    expect(calls).toBe(0);
  });

  it("falls back to unchanged output when the provider exceeds the budget", async () => {
    const provider = {
      id: "slow",
      kind: "mock" as const,
      isConfigured: () => true,
      repair: () => new Promise<never>(() => {}),
    };
    const result = await repairLowConfidenceSegment([word("bostgres", 0.3)], provider, {
      budgetMs: 15,
    });
    expect(result.timedOut).toBe(true);
    expect(result.withinBudget).toBe(false);
    expect(result.words[0]!.word).toBe("bostgres");
  });

  it("wraps the LlmProvider seam and still enforces the high-confidence rule", async () => {
    const llm: LlmProvider = {
      id: "fake-llm",
      kind: "mock",
      isConfigured: () => true,
      async stream(_req, onDelta) {
        onDelta('[{"start":0,"end":1,"replacement":"What","confidence":0.9}]');
        return "[]";
      },
    };
    const provider = createLlmRepairProvider(llm);
    expect(provider.kind).toBe("llm");
    const result = await repairLowConfidenceSegment(
      [word("Why", 0.99), word("bostgres", 0.3)],
      provider,
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]!.reason).toBe("high_confidence_protected");
  });
});

describe("confidence gate", () => {
  it("answers a confident, unambiguous segment", () => {
    const words = [word("Why", 0.99), word("Redis", 0.97), word("here", 0.98)];
    const gate = decideConfidenceGate({ segmentId: "s", rawText: "Why Redis here?", words });
    expect(gate.decision).toBe("answer");
    expect(gate.answerLanguage).toBe("en");
  });

  it("clarifies instead of answering a low-confidence ambiguous question", () => {
    const words = [word("did", 0.95), word("you", 0.95), word("cash", 0.35), word("it", 0.9)];
    const gate = decideConfidenceGate({
      segmentId: "s",
      rawText: "did you cash it",
      words,
      ambiguities: [
        { start: 2, end: 3, heard: "cash", readings: ["cache", "cash"], scores: [0.74, 0.72] },
      ],
      sessionLanguage: "hi",
    });
    expect(gate.decision).toBe("clarify");
    expect(gate.clarificationText).toContain("I heard");
    expect(gate.clarificationText).toContain("did you mean");
    expect(gate.answerLanguage).toBe("hi");
  });

  it("never answers confidently when low-band words remain without alternatives", () => {
    const words = [word("the", 0.95), word("blorp", 0.2), word("thing", 0.95)];
    const gate = decideConfidenceGate({ segmentId: "s", rawText: "the blorp thing", words });
    expect(gate.decision).not.toBe("answer");
    expect(gate.answerLanguage).toBe("en");
  });
});

describe("code-switch detection", () => {
  it("detects Hindi/Telugu/Spanish/Arabic mixed into English and pins the answer language", () => {
    const hindi = detectCodeSwitch("yaar can you explain kubernetes", "en");
    expect(hindi.isCodeSwitched).toBe(true);
    expect(hindi.primaryLanguage).toBe("en");
    expect(hindi.secondaryLanguages.map((item) => item.code)).toContain("hi");
    expect(hindi.answerLanguage).toBe("en");

    const telugu = detectCodeSwitch("adi ela chesta andi", "en");
    expect(telugu.isCodeSwitched).toBe(true);
    expect(telugu.answerLanguage).toBe("en");
    // Session language is pinned even when the transcript language matches it.
    expect(detectCodeSwitch("adi ela chesta andi", "te").answerLanguage).toBe("te");

    const spanish = detectCodeSwitch("como se usa el equipo cuando hay un bug", "en");
    expect(
      [spanish.primaryLanguage, ...spanish.secondaryLanguages.map((item) => item.code)],
    ).toContain("es");

    const arabic = detectCodeSwitch("shukran habib, why Redis?", "en");
    expect(
      [arabic.primaryLanguage, ...arabic.secondaryLanguages.map((item) => item.code)],
    ).toContain("ar");

    const english = detectCodeSwitch("Why did you use Redis?", "en");
    expect(english.isCodeSwitched).toBe(false);
    expect(english.answerLanguage).toBe("en");
  });
});

describe("TTS pronunciation lexicon / SSML", () => {
  it("wraps known terms with pronunciation aliases and leaves unknown words alone", () => {
    const ssml = buildInterviewerSsml("Why did you pick Kubernetes over Docker for Northwind?");
    expect(ssml.startsWith("<speak")).toBe(true);
    expect(ssml).toContain('<sub alias=\"koo-ber-net-eez\">Kubernetes</sub>');
    expect(ssml).toContain("Northwind");
    expect(ssml).toContain("<prosody");
    expect(ssml).not.toContain("</sub><sub");
  });

  it("escapes XML and supports phoneme mode and custom lexicons", () => {
    const ssml = buildSsml("Kubernetes & Redis < 3", { mode: "phoneme" });
    expect(ssml).toContain("&amp;");
    expect(ssml).toContain("<phoneme alphabet=\"ipa\"");
    const lexicon = buildTtsLexicon({ overrides: { Kubernetes: "custom-say" } });
    expect(buildSsml("Kubernetes", { lexicon, mode: "sub" })).toContain('alias="custom-say"');
  });
});

describe("mock ASR degradation + Deepgram extended params", () => {
  function replay(provider: ReturnType<typeof createMockAsrProvider>, chunks: number) {
    const clock = { wall: 0 };
    const stream = provider.openStream({
      sampleRate: 16_000,
      script: [{ id: "u1", startMs: 0, endMs: 1_000, text: "Can you explain Kubernetes indexing in Postgres?" }],
      endpointSilenceMs: 100,
      now: () => clock.wall,
      keywords: ["Kubernetes", { term: "Postgres", boost: 3 }],
    });
    const events = [];
    for (let i = 0; i < chunks; i++) {
      clock.wall += 10;
      events.push(...stream.pushAudio(new Int16Array(160)));
    }
    return events;
  }

  it("emits realistic low-confidence/garbled words deterministically", () => {
    const provider = createMockAsrProvider({
      pronunciation: { profile: "south_indian" },
    });
    const first = replay(provider, 120);
    const final = first.find((event) => event.isFinal)!;
    expect(final.text).not.toBe("Can you explain Kubernetes indexing in Postgres?");
    expect(final.text.toLowerCase()).toContain("koobernetes");
    expect(final.words?.length).toBeGreaterThan(0);
    expect(final.words?.some((word) => word.confidence < 0.62)).toBe(true);
    expect(final.alternatives?.length).toBeGreaterThan(1);
    expect(provider.lastStream?.keywordCount).toBe(2);
    expect(provider.lastStream?.pronunciationProfile).toBe("south_indian");

    const second = replay(createMockAsrProvider({ pronunciation: { profile: "south_indian" } }), 120);
    expect(second.find((event) => event.isFinal)!.text).toBe(final.text);
  });

  it("keeps the default mock ASR output unchanged (no words/n-best)", () => {
    const provider = createMockAsrProvider();
    const events = replay(provider, 120);
    const final = events.find((event) => event.isFinal)!;
    expect(final.text).toBe("Can you explain Kubernetes indexing in Postgres?");
    expect(final.words).toBeUndefined();
    expect(final.alternatives).toBeUndefined();
  });

  it("adds keywords/n-best to the Deepgram listen URL only when requested", () => {
    const plain = new URL(buildDeepgramListenUrl());
    expect(plain.searchParams.has("keywords")).toBe(false);
    expect(plain.searchParams.has("alternatives")).toBe(false);

    const boosted = new URL(
      buildDeepgramListenUrl({
        keywords: ["Kubernetes", { term: "Postgres", boost: 3 }],
        nBestAlternatives: 3,
      }),
    );
    expect(boosted.searchParams.getAll("keywords")).toEqual(["Kubernetes:2", "Postgres:3"]);
    expect(boosted.searchParams.get("alternatives")).toBe("3");
  });

  it("maps Deepgram word confidence and n-best alternatives", () => {
    const event = mapDeepgramMessage(
      {
        type: "Results",
        is_final: true,
        channel: {
          alternatives: [
            {
              transcript: "kubernates indexing",
              confidence: 0.71,
              words: [
                { word: "kubernates", confidence: 0.31, start: 0.1, end: 0.4 },
                { word: "indexing", confidence: 0.94, start: 0.4, end: 0.7 },
              ],
            },
            { transcript: "kubernetes indexing", confidence: 0.52 },
          ],
        },
      },
      "seg-1",
      0,
      0,
    );
    expect(event?.words).toHaveLength(2);
    expect(event?.words?.[0]?.confidence).toBeCloseTo(0.31);
    expect(event?.alternatives?.map((alt) => alt.text)).toEqual([
      "kubernates indexing",
      "kubernetes indexing",
    ]);
  });
});

describe("orchestrator", () => {
  it("recovers a degraded question and records the hard-rule check", async () => {
    const degraded = {
      segmentId: "s1",
      text: "why did you use kavka for streaming",
      words: [
        { word: "why", confidence: 0.97 },
        { word: "did", confidence: 0.97 },
        { word: "you", confidence: 0.97 },
        { word: "use", confidence: 0.96 },
        { word: "kavka", confidence: 0.4 },
        { word: "for", confidence: 0.95 },
        { word: "streaming", confidence: 0.9 },
      ],
    };
    const result = await understandTranscript(degraded, { vocabulary: VOCAB });
    expect(result.finalText.toLowerCase()).toContain("kafka");
    expect(result.highConfidenceUntouched).toBe(true);
    expect(result.gate.decision).toBe("answer");
    expect(result.answerLanguage).toBe("en");
  });
});
