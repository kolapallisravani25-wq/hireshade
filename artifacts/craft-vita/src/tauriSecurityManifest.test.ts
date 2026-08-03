import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "../..");

describe("Tauri security and release manifests", () => {
  it("scopes capabilities to the four real application windows", () => {
    const capability = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "src-tauri/capabilities/default.json"), "utf8"),
    ) as { windows: string[] };
    expect(capability.windows.sort()).toEqual(["floating", "launcher", "main", "mini"]);
    expect(capability.windows).not.toContain("*");
  });

  it("uses a Windows-compatible frontend build command", () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "src-tauri/tauri.conf.json"), "utf8"),
    ) as { build: { beforeBuildCommand: string } };
    expect(config.build.beforeBuildCommand).not.toMatch(/^env\s/);
  });

  it("does not mutate version files as a side effect of packaging", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as { scripts: { tauri: string } };
    expect(packageJson.scripts.tauri).toBe("tauri");
    expect(fs.existsSync(path.join(packageRoot, "scripts/tauri-wrapper.cjs"))).toBe(false);
  });

  it("publishes the signed Windows updater archive without mutating checked-out source", () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, ".github/workflows/desktop-build.yml"),
      "utf8",
    );
    expect(workflow).toContain("*.msi.zip");
    expect(workflow).toContain("*.msi.zip.sig");
    expect(workflow).not.toContain("Apply CI Tauri compatibility patch");
    expect(workflow).not.toContain("VITE_DEEPGRAM_API_KEY");
  });
});
