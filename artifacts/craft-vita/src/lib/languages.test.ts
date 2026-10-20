import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE_CODE,
  LANGUAGES,
  TIER1_LANGUAGES,
  buildDeepgramAsrPayload,
  deepgramLanguageForSpec,
  findLanguage,
  formatAsrLanguage,
  normalizeLanguageDomain,
  parseLanguageSpec,
  getLanguageCode,
  getLanguageName,
  getLanguagePromptDirective,
  languageSelectOptions,
  normalizeLanguage,
} from "./languages";

const TIER1_EXPECTED: Record<string, { code: string; deepgram: string }> = {
  English: { code: "en", deepgram: "en" },
  Spanish: { code: "es", deepgram: "es" },
  French: { code: "fr", deepgram: "fr" },
  German: { code: "de", deepgram: "de" },
  Portuguese: { code: "pt", deepgram: "pt" },
  Hindi: { code: "hi", deepgram: "hi" },
  Japanese: { code: "ja", deepgram: "ja" },
  Korean: { code: "ko", deepgram: "ko" },
  "Chinese (Mandarin)": { code: "zh", deepgram: "zh" },
  Arabic: { code: "ar", deepgram: "ar" },
};

describe("language registry", () => {
  it("ships at least 50 languages", () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(50);
  });

  it("has unique ISO codes", () => {
    const codes = LANGUAGES.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has unique English names (they are the persisted storage key)", () => {
    const names = LANGUAGES.map((entry) => entry.englishName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every language a native name and a prompt directive", () => {
    for (const entry of LANGUAGES) {
      expect(entry.nativeName.trim().length, entry.code).toBeGreaterThan(0);
      expect(entry.promptDirective.trim().length, entry.code).toBeGreaterThan(0);
      expect(entry.promptDirective.toLowerCase()).toContain(
        entry.code === "en" ? "english" : entry.nativeName.toLowerCase().split(" ")[0]!,
      );
    }
  });

  it("maps every language to a Deepgram language value", () => {
    for (const entry of LANGUAGES) {
      expect(entry.deepgramLanguage.trim().length, entry.code).toBeGreaterThan(0);
    }
  });

  it("marks exactly the ten tier-1 languages", () => {
    expect(TIER1_LANGUAGES).toHaveLength(10);
    expect(TIER1_LANGUAGES.map((entry) => entry.englishName)).toEqual(
      Object.keys(TIER1_EXPECTED),
    );
  });

  it("resolves every tier-1 language by name and by ISO code", () => {
    for (const [name, expected] of Object.entries(TIER1_EXPECTED)) {
      const byName = findLanguage(name);
      const byCode = findLanguage(expected.code);
      expect(byName, name).toBeDefined();
      expect(byCode, expected.code).toBeDefined();
      expect(byName!.code, name).toBe(expected.code);
      expect(byCode!.englishName, expected.code).toBe(name);
    }
  });
});

describe("tier-1 ASR payload", () => {
  it.each(Object.entries(TIER1_EXPECTED))(
    "threads %s (%o) into the Deepgram payload",
    (name, expected) => {
      expect(buildDeepgramAsrPayload(name)).toEqual({
        language: expected.deepgram,
        deepgramLanguage: expected.deepgram,
        model: "nova-3",
      });
      // ISO codes from an older client must resolve to the same payload.
      expect(buildDeepgramAsrPayload(expected.code)).toEqual({
        language: expected.deepgram,
        deepgramLanguage: expected.deepgram,
        model: "nova-3",
      });
    },
  );

  it("keeps non-tier-1 languages on their own Deepgram code where supported", () => {
    expect(buildDeepgramAsrPayload("German")).toMatchObject({
      language: "de",
      deepgramLanguage: "de",
    });
    expect(buildDeepgramAsrPayload("Turkish").language).toBe("tr");
    expect(buildDeepgramAsrPayload("Russian").language).toBe("ru");
  });

  it("falls back to Deepgram multilingual mode for unsupported languages", () => {
    expect(buildDeepgramAsrPayload("Welsh")).toEqual({
      language: "cy",
      deepgramLanguage: "multi",
      model: "nova-3",
    });
    expect(buildDeepgramAsrPayload("Zulu").deepgramLanguage).toBe("multi");
  });

  it("honours an explicit model override", () => {
    expect(buildDeepgramAsrPayload("Spanish", "nova-2").model).toBe("nova-2");
  });
});

describe("legacy language resolution", () => {
  it("normalises legacy names to registry entries", () => {
    expect(getLanguageName("Chinese")).toBe("Chinese (Mandarin)");
    expect(getLanguageCode("Chinese")).toBe("zh");
    expect(getLanguageName("Brazilian Portuguese")).toBe("English");
    expect(getLanguageName("pt-BR")).toBe("Portuguese");
  });

  it("falls back to English for missing/unknown values", () => {
    for (const input of ["", "   ", null, undefined, "Klingon"]) {
      const entry = normalizeLanguage(input);
      expect(entry.code).toBe(DEFAULT_LANGUAGE_CODE);
      expect(entry.englishName).toBe("English");
    }
  });

  it("returns an English prompt directive and a native-language one", () => {
    expect(getLanguagePromptDirective("English")).toBe("Respond in English.");
    expect(getLanguagePromptDirective("French")).toContain("Français");
    expect(getLanguagePromptDirective("Japanese")).toContain("日本語");
  });
});

describe("language picker options", () => {
  it("offers 50+ options with the persisted English name as value", () => {
    const options = languageSelectOptions();
    expect(options.length).toBeGreaterThanOrEqual(50);
    expect(options[0]).toMatchObject({ value: "English", code: "en" });
    const spanish = options.find((option) => option.value === "Spanish");
    expect(spanish?.label).toBe("Spanish — Español");
    expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
  });
});

describe("target-compatible ASR language spec (code[:domain])", () => {
  it("formats a plain language as its ISO code", () => {
    expect(formatAsrLanguage("Spanish")).toBe("es");
    expect(formatAsrLanguage("zh")).toBe("zh");
  });

  it("keeps an optional domain suffix", () => {
    expect(formatAsrLanguage("Spanish", "medical")).toBe("es:medical");
    expect(buildDeepgramAsrPayload("German", "nova-3", "finance")).toEqual({
      language: "de:finance",
      deepgramLanguage: "de",
      model: "nova-3",
    });
  });

  it("parses code[:domain] and name[:domain] input", () => {
    const fromCode = parseLanguageSpec("en:medical");
    expect(fromCode.entry.englishName).toBe("English");
    expect(fromCode.domain).toBe("medical");
    expect(fromCode.spec).toBe("en:medical");

    const fromName = parseLanguageSpec("Hindi:pharma");
    expect(fromName.entry.code).toBe("hi");
    expect(fromName.spec).toBe("hi:pharma");

    const plain = parseLanguageSpec("Japanese");
    expect(plain.domain).toBeUndefined();
    expect(plain.spec).toBe("ja");
  });

  it("sanitises invalid domain hints instead of passing junk to the ASR", () => {
    expect(normalizeLanguageDomain("  Medical / Oncology ")).toBe("medical-oncology");
    expect(normalizeLanguageDomain("!!!")).toBeUndefined();
    expect(formatAsrLanguage("English", "!!!")).toBe("en");
  });

  it("drops the domain for the Deepgram wire value", () => {
    expect(deepgramLanguageForSpec("es:medical")).toBe("es");
    expect(deepgramLanguageForSpec("Welsh:legal")).toBe("multi");
  });

  it("falls back to English for an unknown language but preserves the domain", () => {
    expect(parseLanguageSpec("Klingon:legal")).toMatchObject({
      domain: "legal",
      spec: "en:legal",
    });
  });
});
