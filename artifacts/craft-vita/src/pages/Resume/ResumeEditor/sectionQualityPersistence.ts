import type { ResumeFields, SectionQuality } from "@/store/resumeBuilderSlice";

export const SECTION_VALIDATION_FIELD_KEY = "_sectionValidation";

export type PersistedResumeFields = Partial<ResumeFields> & {
  [SECTION_VALIDATION_FIELD_KEY]?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSectionQuality(value: unknown): value is SectionQuality {
  if (!isRecord(value)) return false;
  return (
    typeof value.score === "number" &&
    typeof value.status === "string" &&
    Array.isArray(value.issues) &&
    Array.isArray(value.suggestions) &&
    isRecord(value.constraints) &&
    typeof value.wordCount === "number"
  );
}

function parseSectionValidation(value: unknown): Record<string, SectionQuality> | undefined {
  const parsed = typeof value === "string" ? safeJsonParse(value) : value;
  if (!isRecord(parsed)) return undefined;

  const entries = Object.entries(parsed).filter((entry): entry is [string, SectionQuality] =>
    typeof entry[0] === "string" && isSectionQuality(entry[1]),
  );

  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function readPersistedSectionValidation(source: unknown): Record<string, SectionQuality> | undefined {
  if (!isRecord(source)) return undefined;

  const direct = parseSectionValidation(source.sectionValidation);
  if (direct) return direct;

  if (!isRecord(source.fields)) return undefined;
  return parseSectionValidation(source.fields[SECTION_VALIDATION_FIELD_KEY]);
}

export function stripPersistedSectionValidation(
  fields: Partial<ResumeFields> | undefined,
): Partial<ResumeFields> | undefined {
  if (!fields) return fields;
  const nextFields = { ...fields } as PersistedResumeFields;
  delete nextFields[SECTION_VALIDATION_FIELD_KEY];
  return nextFields;
}

export function withPersistedSectionValidation(
  fields: ResumeFields,
  sectionValidation: Record<string, SectionQuality>,
): PersistedResumeFields {
  return {
    ...fields,
    [SECTION_VALIDATION_FIELD_KEY]: JSON.stringify(sectionValidation),
  };
}
