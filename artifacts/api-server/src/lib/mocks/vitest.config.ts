import { defineConfig } from "vitest/config";

// Unit tests for the mock provider layer live next to the modules (rather than
// in tests/, which is owned by the integration suite). Run with:
//   pnpm --dir artifacts/api-server exec vitest run --root src/lib/mocks
export default defineConfig({
  test: {
    include: ["*.test.ts"],
    environment: "node",
    testTimeout: 15_000,
  },
});
