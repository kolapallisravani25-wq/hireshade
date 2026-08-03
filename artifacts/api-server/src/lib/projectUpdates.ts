export type ProjectUpdates = {
  title?: string;
  description?: string;
  content?: unknown;
};

export function buildProjectUpdates(input: unknown): ProjectUpdates | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const body = input as Record<string, unknown>;
  const updates: ProjectUpdates = {};
  const title = body["title"] ?? body["position"];

  if (typeof title === "string" && title.trim()) updates.title = title.trim();
  if (typeof body["description"] === "string") {
    updates.description = body["description"];
  }
  if (body["content"] !== undefined) updates.content = body["content"];

  return Object.keys(updates).length ? updates : null;
}
