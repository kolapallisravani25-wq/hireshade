import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_LANGUAGE,
  SESSION_LANGUAGES,
  findSessionLanguage,
  normalizeSessionLanguage,
  sessionLanguageName,
  sessionLanguagePromptDirective,
} from "../src/lib/languages.js";
import { buildInterviewSystemPrompt } from "../src/lib/interviewPrompt.js";
import { LANGUAGES as CLIENT_LANGUAGES } from "../../craft-vita/src/lib/languages";

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    userId: "u1",
    companyName: "",
    round: null,
    jobDescription: "",
    language: "English",
    simpleLanguage: false,
    extraContext: "",
    instructions: "",
    aiModel: null,
    resumeId: null,
    documentId: null,
    projectIds: [],
    primaryProjectId: null,
    ...overrides,
  } as never;
}

const TIER1: Record<string, { code: string; deepgram: string }> = {
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

describe("server language registry", () => {
  it("ships at least 50 languages with unique ISO codes", () => {
    expect(SESSION_LANGUAGES.length).toBeGreaterThanOrEqual(50);
    expect(new Set(SESSION_LANGUAGES.map((entry) => entry.code)).size).toBe(
      SESSION_LANGUAGES.length,
    );
    expect(new Set(SESSION_LANGUAGES.map((entry) => entry.englishName)).size).toBe(
      SESSION_LANGUAGES.length,
    );
  });

  it("stays byte-for-byte in sync with the client registry", () => {
    expect(SESSION_LANGUAGES.length).toBe(CLIENT_LANGUAGES.length);
    for (let i = 0; i < SESSION_LANGUAGES.length; i += 1) {
      const server = SESSION_LANGUAGES[i]!;
      const client = CLIENT_LANGUAGES[i]!;
      expect({
        code: server.code,
        englishName: server.englishName,
        nativeName: server.nativeName,
        deepgramLanguage: server.deepgramLanguage,
        promptDirective: server.promptDirective,
      }).toEqual({
        code: client.code,
        englishName: client.englishName,
        nativeName: client.nativeName,
        deepgramLanguage: client.deepgramLanguage,
        promptDirective: client.promptDirective,
      });
    }
  });

  it("resolves every tier-1 language by name and ISO code", () => {
    for (const [name, expected] of Object.entries(TIER1)) {
      expect(findSessionLanguage(name)?.code, name).toBe(expected.code);
      expect(findSessionLanguage(expected.code)?.englishName, expected.code).toBe(name);
      expect(findSessionLanguage(name)?.deepgramLanguage, name).toBe(expected.deepgram);
    }
  });

  it("resolves legacy names and code[:domain] specs", () => {
    expect(sessionLanguageName("Chinese")).toBe("Chinese (Mandarin)");
    expect(findSessionLanguage("en:medical")?.code).toBe("en");
    expect(findSessionLanguage("es-MX")?.code).toBe("es");
    expect(findSessionLanguage("Tagalog")?.code).toBe("tl");
  });

  it("defaults blank input to English and rejects unknown languages", () => {
    expect(normalizeSessionLanguage("")).toBe(DEFAULT_SESSION_LANGUAGE);
    expect(normalizeSessionLanguage(undefined)).toBe(DEFAULT_SESSION_LANGUAGE);
    expect(normalizeSessionLanguage("Klingon")).toBeUndefined();
  });
});

describe("language is threaded into the prompt", () => {
  it("injects the registry directive for a non-English language", () => {
    const prompt = buildInterviewSystemPrompt({
      session: makeSession({ language: "Spanish" }),
    });
    expect(prompt).toContain("Respond entirely in Spanish (Español)");
  });

  it("resolves a legacy stored language name to its registry directive", () => {
    const prompt = buildInterviewSystemPrompt({
      session: makeSession({ language: "Chinese" }),
    });
    expect(prompt).toContain("Respond entirely in Chinese (Mandarin) (中文)");
  });

  it("adds no forcing directive for English", () => {
    const prompt = buildInterviewSystemPrompt({
      session: makeSession({ language: "English" }),
    });
    expect(prompt).not.toContain("Respond entirely in");
    expect(prompt).not.toContain("Respond in English.");
  });

  it("exposes a directive helper for every language", () => {
    for (const entry of SESSION_LANGUAGES) {
      expect(sessionLanguagePromptDirective(entry.englishName), entry.code).toContain(
        entry.code === "en" ? "English" : entry.nativeName,
      );
    }
  });
});
