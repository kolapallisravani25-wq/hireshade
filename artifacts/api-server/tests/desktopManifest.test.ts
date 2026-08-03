import { describe, expect, it } from "vitest";
import { buildManifest } from "../src/lib/desktopManifest.js";

const release = {
  tag_name: "v0.1.22",
  name: "HireShade 0.1.22",
  body: "Security update",
  published_at: "2026-08-04T00:00:00Z",
  assets: [
    { id: 1, name: "HireShade_0.1.22_x64_en-US.msi", size: 1, browser_download_url: "" },
    { id: 2, name: "HireShade_0.1.22_x64_en-US.msi.zip", size: 1, browser_download_url: "" },
    { id: 3, name: "HireShade_0.1.22_x64_en-US.msi.zip.sig", size: 1, browser_download_url: "" },
  ],
};

describe("desktop updater manifest", () => {
  it("keeps the MSI as a manual download and advertises only the signed updater archive", () => {
    const manifest = buildManifest(
      release,
      { "HireShade_0.1.22_x64_en-US.msi.zip.sig": "trusted-signature" },
      "https://api.hireshade.example",
    );

    expect(manifest.downloads.windows?.msi?.url).toBe(
      "https://api.hireshade.example/api/desktop/download/HireShade_0.1.22_x64_en-US.msi",
    );
    expect(manifest.platforms["windows-x86_64"]).toEqual({
      url: "https://api.hireshade.example/api/desktop/download/HireShade_0.1.22_x64_en-US.msi.zip",
      signature: "trusted-signature",
    });
  });

  it("does not advertise an updater artifact when its detached signature is absent", () => {
    const manifest = buildManifest(release, {}, "https://api.hireshade.example");
    expect(manifest.platforms["windows-x86_64"]).toBeUndefined();
  });
});
