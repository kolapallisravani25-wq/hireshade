import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

const DEFAULT_UPDATES_MANIFEST_URL =
  "https://pub-992f115513ba42f681595c2ca5fac628.r2.dev/tauri-updates/latest.json";
const UPDATES_MANIFEST_URL = DEFAULT_UPDATES_MANIFEST_URL;

type DownloadArtifact = {
  url: string;
  signature?: string;
};

type UpdateManifest = {
  platforms?: Record<string, DownloadArtifact>;
  downloads?: {
    mac?: {
      dmg?: DownloadArtifact;
      appTarGz?: DownloadArtifact;
    };
    windows?: {
      exe?: DownloadArtifact;
      msi?: DownloadArtifact;
      msiZip?: DownloadArtifact;
      nsisZip?: DownloadArtifact;
    };
    linux?: {
      appImage?: DownloadArtifact;
      deb?: DownloadArtifact;
      rpm?: DownloadArtifact;
    };
  };
};

/**
 * Fetches the latest manifest and opens the download URL for the given platform/format.
 * Throws (instead of silently redirecting to the JSON) when no URL is found.
 */
async function openLatestDesktopDownload(
  platform: "mac" | "windows" | "linux",
  format?: "exe" | "msi" | "appimage" | "deb" | "rpm",
) {
  let res: Response;
  try {
    res = await fetch(UPDATES_MANIFEST_URL, { cache: "no-store" });
  } catch (err) {
    alert(
      "Could not load the Cloudflare update manifest. Please try again. If this continues, Cloudflare R2 CORS may be blocking browser access.",
    );
    console.error("[download] fetch failed:", err);
    return;
  }

  if (!res.ok) {
    alert(`Update manifest returned an error (${res.status}). Please try again later.`);
    return;
  }

  const manifest = (await res.json()) as UpdateManifest;
  const platforms = manifest.platforms ?? {};
  const downloads = manifest.downloads ?? {};
  const entries = Object.entries(platforms);

  let url: string | undefined;

  if (platform === "mac") {
    // Preferred web installers: DMG, then updater tarball.
    url = downloads.mac?.dmg?.url;
    if (!url) {
      url = downloads.mac?.appTarGz?.url;
    }
    if (!url) {
      const match = entries.find(([key]) => key.startsWith("darwin"));
      url = match?.[1]?.url;
    }
  } else if (platform === "windows") {
    if (format === "msi") {
      url = downloads.windows?.msi?.url || downloads.windows?.msiZip?.url;
    } else if (format === "exe") {
      url = downloads.windows?.exe?.url || downloads.windows?.nsisZip?.url;
    }

    // Fallback to updater windows entry if explicit installer not present.
    if (!url) {
      const match = entries.find(([key]) => key.startsWith("windows"));
      url = match?.[1]?.url;
    }
  } else if (platform === "linux") {
    if (format === "appimage") {
      url = downloads.linux?.appImage?.url;
    } else if (format === "deb") {
      url = downloads.linux?.deb?.url;
    } else if (format === "rpm") {
      url = downloads.linux?.rpm?.url;
    }

    // Only AppImage is allowed to fallback to updater linux key.
    if (!url && format === "appimage") {
      const match = entries.find(([key]) => key.startsWith("linux"));
      url = match?.[1]?.url;
    }
  }

  if (!url) {
    alert(
      `No ${platform}${format ? ` (${format.toUpperCase()})` : ""} download is available for this release yet.`,
    );
    console.error(
      `[download] No matching URL for platform="${platform}" format="${format}". Available keys:`,
      {
        platforms: Object.keys(platforms),
        downloads,
      },
    );
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export function DownloadApp() {
  return (
    <div className="w-full max-w-6xl mx-auto py-8 sm:py-10 lg:py-12 px-5 sm:px-8 lg:px-10 bg-linear-to-br from-brand to-blue-700 rounded-2xl sm:rounded-3xl overflow-hidden relative shadow-2xl shadow-brand/20 my-4 sm:my-8 border border-white/10">
      {/* Background decorative blobs */}
      <div className="absolute top-0 -left-1/4 w-1/2 h-full bg-white/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 -right-1/4 w-1/2 h-full bg-blue-400/20 blur-[120px] rounded-full pointer-events-none" />

      <div className="relative z-10 flex flex-col gap-8 sm:gap-10">
        <div className="w-full max-w-3xl text-center lg:text-left space-y-4">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white tracking-tight leading-tight">
            Take HireShade Anywhere
          </h2>
          <p className="text-blue-50 text-base sm:text-lg md:text-xl max-w-2xl mx-auto lg:mx-0 leading-relaxed font-medium">
            Get the full power of HireShade with native performance, global
            shortcuts, and seamless interview assistance directly from your
            desktop.
          </p>
        </div>

        <div className="w-full grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {/* ── Mac ── */}
          <Button
            size="lg"
            type="button"
            onClick={() => void openLatestDesktopDownload("mac")}
            className="w-full h-14 sm:h-15 px-6 sm:px-8 bg-white hover:bg-blue-50 text-brand group rounded-xl transition-all font-bold"
          >
            <AppleIcon className="w-5 h-5 mr-3 transition-transform group-hover:-translate-y-0.5" />
            Download for Mac
          </Button>

          {/* ── Windows ── */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="lg"
                type="button"
                className="w-full h-14 sm:h-15 px-6 sm:px-8 bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-800 group rounded-xl transition-all font-semibold shadow-lg flex items-center justify-center"
              >
                <WindowsIcon className="w-5 h-5 mr-3 transition-transform group-hover:-translate-y-0.5 text-[#00a4ef]" />
                Download for Windows
                <ChevronDown className="ml-3 h-4 w-4 opacity-70 group-hover:translate-y-0.5 transition-transform" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="w-64 bg-zinc-950 border-white/10 text-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] p-1.5 backdrop-blur-xl"
            >
              <DropdownMenuItem
                onClick={() => void openLatestDesktopDownload("windows", "exe")}
                className="group cursor-pointer rounded-xl py-3 px-4 flex flex-col items-start gap-1 transition-all outline-none border-none hover:bg-white/10 focus:bg-white/10 data-[highlighted]:bg-white/10 [&_*]:!text-white"
              >
                <span className="font-bold text-sm">Windows (EXE / NSIS)</span>
                <span className="text-xs text-zinc-400">
                  Standard installer for most users
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void openLatestDesktopDownload("windows", "msi")}
                className="group cursor-pointer rounded-xl py-3 px-4 flex flex-col items-start gap-1 transition-all outline-none border-none hover:bg-white/10 focus:bg-white/10 data-[highlighted]:bg-white/10 [&_*]:!text-white"
              >
                <span className="font-bold text-sm">Windows (MSI)</span>
                <span className="text-xs text-zinc-400">
                  Ideal for enterprise / corporate installs
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* ── Linux (NEW) ── */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="lg"
                type="button"
                className="w-full h-14 sm:h-15 px-6 sm:px-8 bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-800 group rounded-xl transition-all font-semibold shadow-lg flex items-center justify-center"
              >
                <LinuxIcon className="w-5 h-5 mr-3 transition-transform group-hover:-translate-y-0.5 text-yellow-400" />
                Download for Linux
                <ChevronDown className="ml-3 h-4 w-4 opacity-70 group-hover:translate-y-0.5 transition-transform" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="w-64 bg-zinc-950 border-white/10 text-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] p-1.5 backdrop-blur-xl"
            >
              <DropdownMenuItem
                onClick={() => void openLatestDesktopDownload("linux", "appimage")}
                className="group cursor-pointer rounded-xl py-3 px-4 flex flex-col items-start gap-1 transition-all outline-none border-none hover:bg-white/10 focus:bg-white/10 data-[highlighted]:bg-white/10 [&_*]:!text-white"
              >
                <span className="font-bold text-sm">AppImage (Universal)</span>
                <span className="text-xs text-zinc-400">
                  Works on most distros, no install needed
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void openLatestDesktopDownload("linux", "deb")}
                className="group cursor-pointer rounded-xl py-3 px-4 flex flex-col items-start gap-1 transition-all outline-none border-none hover:bg-white/10 focus:bg-white/10 data-[highlighted]:bg-white/10 [&_*]:!text-white"
              >
                <span className="font-bold text-sm">.deb (Ubuntu / Debian)</span>
                <span className="text-xs text-zinc-400">
                  For apt-based distributions
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void openLatestDesktopDownload("linux", "rpm")}
                className="group cursor-pointer rounded-xl py-3 px-4 flex flex-col items-start gap-1 transition-all outline-none border-none hover:bg-white/10 focus:bg-white/10 data-[highlighted]:bg-white/10 [&_*]:!text-white"
              >
                <span className="font-bold text-sm">.rpm (Fedora / RHEL)</span>
                <span className="text-xs text-zinc-400">
                  For dnf/yum-based distributions
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function AppleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 384 512" fill="currentColor" {...props}>
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function WindowsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 448 512" fill="currentColor" {...props}>
      <path d="M0 93.7l183.6-25.3v177.4H0V93.7zm0 324.6l183.6 25.3V268.4H0v149.9zm203.8 28L448 480V268.4H203.8v177.9zm0-380.6v180.1H448V32L203.8 65.7z" />
    </svg>
  );
}

function LinuxIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 448 512" fill="currentColor" {...props}>
      <path d="M220.8 123.3c1 .5 1.8 1.7 3 1.7 1.1 0 2.8-.4 2.9-1.5.2-1.4-1.9-2.3-3.2-2.9-1.7-.7-3.9-1-5.5-.1-.4.2-.8.7-.6 1.1.3 1.3 2.3 1.1 3.4 1.7zm-21.9 1.7c1.2 0 2-1.2 3-1.7 1.1-.6 3.1-.4 3.5-1.6.2-.4-.2-.9-.6-1.1-1.6-.9-3.8-.6-5.5.1-1.3.6-3.4 1.5-3.2 2.9.1 1 1.8 1.5 2.8 1.4zM420 403.8c-3.6-4-5.3-11.6-7.2-19.7-1.8-8.1-3.9-16.8-10.5-22.4-1.3-1.1-2.6-2.1-4-2.9-1.3-.8-2.7-1.5-4.1-2 9.2-27.3 5.6-54.5-3.7-79.1-11.4-30.1-31.3-56.4-46.5-74.4-17.1-21.5-33.7-41.9-33.4-72C311.1 85.4 315.7 .1 234.8 0 132.4-.2 158 103.4 156.9 135.2c-1.7 23.4-6.4 43.8-22.5 64.7-18.1 23.6-39.7 45.6-54.2 73.4-22.4 41.8-18.7 88.3-4.6 123.8-1.3.6-2.6 1.3-3.9 2.1-1.4.8-2.7 1.8-4 2.9-6.6 5.6-8.7 14.3-10.5 22.4-1.9 8.1-3.6 15.7-7.2 19.7-6.6 7.2-15.5 9.1-14.5 26.9 1.1 17.8 15.8 20.1 22.8 20.9 7 .8 13.9 1.6 19.6 4.3 5.8 2.7 13.2 8.4 20.4 8.4 7.2 0 14.1-4.2 19.2-5.4 5.1-1.2 9.5-.5 13.3 2.3 3.7 2.8 7.1 6.7 12.1 9.3 4.9 2.6 10.6 4.4 16.4 4.4 5.8 0 11.5-1.7 15.3-4.1 5.1-3.3 8.6-7.8 11.8-9.8 3.2-2 5.6-2.5 10.9-1.1 5.3 1.4 11.5 5.2 18.1 5.2s12.8-3.8 18.1-5.2c5.3-1.4 7.7-.9 10.9 1.1 3.2 2 6.7 6.5 11.8 9.8 3.8 2.4 9.5 4.1 15.3 4.1 5.8 0 11.5-1.8 16.4-4.4 5-2.6 8.4-6.5 12.1-9.3 3.8-2.8 8.2-3.5 13.3-2.3 5.1 1.2 12 5.4 19.2 5.4 7.2 0 14.6-5.7 20.4-8.4 5.7-2.7 12.6-3.5 19.6-4.3 7-.8 21.7-3.1 22.8-20.9 1.1-17.8-7.8-19.7-14.4-26.9zM148.9 359.6c-4.2-9.7-7-20.3-8.4-31.4-1.9-14.5-1.1-28.5 2.3-41 7.1 1.5 14.2 2.9 21.4 3.2-5.8 11.1-8.6 24.4-8.3 39.4.2 7.6 1.6 15.6 4.2 24-.9 1.6-3 3.8-11.2 5.8zm13.9-104.7c-4.7-6.1-9.4-12.2-13.5-18.6 2.2-3.1 4.5-6.2 6.8-9.4 5.6-7.9 12.3-16.7 18.7-26 8.4-12.7 17.1-26.9 22.5-42.3 1.6.7 3.1 1.7 4.6 2.9 9.6 8.2 14.4 21.9 18.8 35.4 4.3 13.3 8.1 27.2 18.7 36.5-1.2 3.4-2.4 6.8-3.5 10.3-12.4-6.1-26.8-8.1-42.3-5.2-9.9 1.8-20.4 6.5-30.8 16.4zm63.9 124.8c-1.8.3-4.4 1.2-6.9 2.5-3.4 1.8-7.2 4.6-10.6 4.6-3.5 0-7.2-2.9-10.6-4.6-3.2-1.7-6.5-2.6-9.5-2.5 2.2-11.1 4.7-22.1 7.3-33 2.5-10.5 4.9-20.8 6.6-30.2 1.8.3 3.8.6 5.5.8 1.6.2 3.2.4 4.7.5l5.7.3c2 0 3.9-.1 5.7-.2 1.2-.1 2.4-.2 3.6-.4 2.2 12.2 5.2 24.5 8 36.2 2.5 10.4 5 20.8 6.8 30.5-1.9-.5-4.1-1.3-6.3-1z" />
    </svg>
  );
}
