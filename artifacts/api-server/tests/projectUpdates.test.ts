import { describe, expect, it } from "vitest";
import { buildProjectUpdates } from "../src/lib/projectUpdates.js";

describe("buildProjectUpdates", () => {
  it("whitelists writable fields and maps the frontend position alias", () => {
    expect(
      buildProjectUpdates({
        position: "  Senior Engineer  ",
        description: "Updated",
        content: { safe: true },
        userId: "attacker",
        version: 99,
      }),
    ).toEqual({
      title: "Senior Engineer",
      description: "Updated",
      content: { safe: true },
    });
  });

  it("rejects empty or non-string updates", () => {
    expect(buildProjectUpdates({ userId: "attacker" })).toBeNull();
    expect(buildProjectUpdates({ title: "   " })).toBeNull();
    expect(buildProjectUpdates({ description: 42 })).toBeNull();
  });
});
