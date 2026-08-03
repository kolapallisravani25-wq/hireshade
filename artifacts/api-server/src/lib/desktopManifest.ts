export interface GhAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
}

export interface GhRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  assets: GhAsset[];
}

export function buildManifest(
  release: GhRelease,
  signatures: Record<string, string>,
  publicBaseUrl: string,
) {
  const base = publicBaseUrl.trim().replace(/\/+$/, "");
  const parsedBase = new URL(base);
  if (!/^https?:$/.test(parsedBase.protocol)) {
    throw new Error("PUBLIC_BACKEND_URL must use http or https");
  }

  const platforms: Record<string, { url: string; signature: string }> = {};
  const downloads: {
    mac?: { dmg?: { url: string }; appTarGz?: { url: string } };
    windows?: { exe?: { url: string }; msi?: { url: string } };
    linux?: { appImage?: { url: string }; deb?: { url: string }; rpm?: { url: string } };
  } = {};
  const urlFor = (name: string) =>
    `${base}/api/desktop/download/${encodeURIComponent(name)}`;
  const addSigned = (target: string, assetName: string) => {
    const signature = signatures[`${assetName}.sig`];
    if (signature) platforms[target] = { url: urlFor(assetName), signature };
  };

  for (const asset of release.assets) {
    const name = asset.name;
    const lower = name.toLowerCase();
    const url = urlFor(name);
    if (lower.endsWith(".sig")) continue;

    if (lower.endsWith(".app.tar.gz")) {
      downloads.mac = { ...downloads.mac, appTarGz: { url } };
      if (lower.includes("aarch64")) addSigned("darwin-aarch64", name);
      else if (lower.includes("x64") || lower.includes("x86_64")) {
        addSigned("darwin-x86_64", name);
      } else {
        addSigned("darwin-aarch64", name);
        addSigned("darwin-x86_64", name);
      }
    } else if (lower.endsWith(".msi.zip") || lower.endsWith(".nsis.zip")) {
      addSigned(lower.includes("aarch64") ? "windows-aarch64" : "windows-x86_64", name);
    } else if (lower.endsWith(".appimage.tar.gz")) {
      addSigned(lower.includes("aarch64") ? "linux-aarch64" : "linux-x86_64", name);
    } else if (lower.endsWith(".dmg")) {
      downloads.mac = { ...downloads.mac, dmg: { url } };
    } else if (lower.endsWith(".msi")) {
      downloads.windows = { ...downloads.windows, msi: { url } };
    } else if (lower.endsWith(".exe")) {
      downloads.windows = { ...downloads.windows, exe: { url } };
    } else if (lower.endsWith(".appimage")) {
      downloads.linux = { ...downloads.linux, appImage: { url } };
    } else if (lower.endsWith(".deb")) {
      downloads.linux = { ...downloads.linux, deb: { url } };
    } else if (lower.endsWith(".rpm")) {
      downloads.linux = { ...downloads.linux, rpm: { url } };
    }
  }

  return {
    version: release.tag_name.replace(/^v/, ""),
    notes: release.body ?? release.name ?? "",
    pub_date: release.published_at ?? undefined,
    platforms,
    downloads,
  };
}
