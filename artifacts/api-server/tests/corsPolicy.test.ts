import { describe, expect, it } from "vitest";
import { buildCorsOptions } from "../src/lib/corsPolicy.js";

describe("buildCorsOptions", () => {
  it("fails closed in production when no allowlist is configured", () => {
    expect(buildCorsOptions(undefined, "production")).toEqual({ origin: false });
  });

  it("allows local development when no allowlist is configured", () => {
    expect(buildCorsOptions(undefined, "development")).toEqual({});
  });

  it("trims and applies configured origins", () => {
    expect(buildCorsOptions(" https://app.example,tauri://localhost ", "production")).toEqual({
      origin: ["https://app.example", "tauri://localhost"],
    });
  });
});
