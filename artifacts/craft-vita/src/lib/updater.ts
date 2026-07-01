import { isTauri } from "@/lib/utils";
import { getVersion } from "@tauri-apps/api/app";

export type UpdaterCheckResult =
  | { status: "not_tauri" }
  | { status: "up_to_date"; currentVersion: string }
  | { status: "update_installed"; currentVersion: string; availableVersion: string }
  | { status: "update_installed_restart_pending"; currentVersion: string; availableVersion: string }
  | { status: "update_available_skipped"; currentVersion: string; availableVersion: string }
  | { status: "error"; currentVersion: string; error: string };

const PENDING_UPDATE_KEY = "hireshade.pending_update";

type PendingUpdateInfo = {
  availableVersion: string;
  installedAt: string;
};

function logUpdater(event: string, payload?: Record<string, unknown>): void {
  if (payload) {
    console.log(`[updater] ${event}`, payload);
    return;
  }
  console.log(`[updater] ${event}`);
}

function emitPendingUpdateChanged(): void {
  window.dispatchEvent(new Event("updater:pending-changed"));
}

function setPendingUpdate(info: PendingUpdateInfo): void {
  localStorage.setItem(PENDING_UPDATE_KEY, JSON.stringify(info));
  emitPendingUpdateChanged();
}

function clearPendingUpdate(): void {
  localStorage.removeItem(PENDING_UPDATE_KEY);
  emitPendingUpdateChanged();
}

export function getPendingUpdate(): PendingUpdateInfo | null {
  try {
    const raw = localStorage.getItem(PENDING_UPDATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingUpdateInfo>;
    if (!parsed.availableVersion || !parsed.installedAt) return null;
    return {
      availableVersion: parsed.availableVersion,
      installedAt: parsed.installedAt,
    };
  } catch {
    return null;
  }
}

export async function restartToApplyDownloadedUpdate(): Promise<void> {
  if (!isTauri()) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  clearPendingUpdate();
  await relaunch();
}

/**
 * Check for app updates via the Tauri updater plugin.
 */
export async function checkForUpdates(onUserClick = false): Promise<UpdaterCheckResult> {
  if (!isTauri()) {
    if (onUserClick) {
      try {
        const { message } = await import("@tauri-apps/plugin-dialog");
        await message("Updater is unavailable because this runtime is not detected as Tauri.", {
          title: "Updater Unavailable",
          kind: "warning",
        });
      } catch {
        alert("Updater is unavailable because this runtime is not detected as Tauri.");
      }
    }
    return { status: "not_tauri" };
  }

  let currentVersion = "unknown";

  try {
    currentVersion = await getVersion().catch(() => "unknown");
    const pending = getPendingUpdate();
    if (!onUserClick && pending) {
      logUpdater("pendingUpdateAlreadyInstalled", {
        currentVersion,
        availableVersion: pending.availableVersion,
      });
      return {
        status: "update_installed_restart_pending",
        currentVersion,
        availableVersion: pending.availableVersion,
      };
    }

    logUpdater("updaterCheckStarted", { onUserClick });
    logUpdater("currentVersion", { currentVersion });

    const { check } = await import("@tauri-apps/plugin-updater");
    const { ask, message } = await import("@tauri-apps/plugin-dialog");
    const { relaunch } = await import("@tauri-apps/plugin-process");

    const update = await check();

    if (update === null) {
      logUpdater("updateCheckReturnedNull", { currentVersion });
      if (onUserClick) {
        await message("You are already on the latest version.", {
          title: "Up to Date",
          kind: "info",
        });
      }
      return { status: "up_to_date", currentVersion };
    }

    logUpdater("updateCheckRawResult", { currentVersion, update });

    logUpdater("updateAvailable", { currentVersion, availableVersion: update.version });
    logUpdater("availableVersion", { availableVersion: update.version });

    if (onUserClick) {
      const yes = await ask(
        `Version ${update.version} is available!\n\nRelease notes:\n${update.body ?? "No notes provided."}\n\nWould you like to download, install, and restart HireShade now?`,
        {
          title: "Update Available",
          okLabel: "Update & Restart",
          cancelLabel: "Later",
        },
      );

      if (!yes) {
        return {
          status: "update_available_skipped",
          currentVersion,
          availableVersion: update.version,
        };
      }

      logUpdater("downloadStarted", { availableVersion: update.version, mode: "manual" });
      await update.downloadAndInstall((event) => {
        if (event.event === "Progress") {
          logUpdater("downloadProgress", {
            chunkLength: event.data.chunkLength,
          });
        }
      });
      logUpdater("installStarted", { availableVersion: update.version, mode: "manual" });
      logUpdater("installCompleted", { availableVersion: update.version, mode: "manual" });
      logUpdater("relaunchRequested", { reason: "manual_update" });
      clearPendingUpdate();
      await relaunch();
      return {
        status: "update_installed",
        currentVersion,
        availableVersion: update.version,
      };
    }

    logUpdater("downloadStarted", { availableVersion: update.version, mode: "background" });
    await update.downloadAndInstall((event) => {
      if (event.event === "Progress") {
        logUpdater("downloadProgress", {
          chunkLength: event.data.chunkLength,
        });
      }
    });
    logUpdater("installStarted", { availableVersion: update.version, mode: "background" });
    logUpdater("installCompleted", { availableVersion: update.version, mode: "background" });

    const restartNow = await ask(
      `A new update (v${update.version}) has been downloaded and installed successfully.\n\nWould you like to restart HireShade now to apply the changes?`,
      {
        title: "Update Installed",
        okLabel: "Restart Now",
        cancelLabel: "Later",
      },
    );

    if (restartNow) {
      logUpdater("relaunchRequested", { reason: "background_update" });
      clearPendingUpdate();
      await relaunch();
    } else {
      setPendingUpdate({
        availableVersion: update.version,
        installedAt: new Date().toISOString(),
      });
      return {
        status: "update_installed_restart_pending",
        currentVersion,
        availableVersion: update.version,
      };
    }

    return {
      status: "update_installed",
      currentVersion,
      availableVersion: update.version,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logUpdater("updaterError", { currentVersion, message: errorMessage, onUserClick });

    if (onUserClick) {
      try {
        const { message } = await import("@tauri-apps/plugin-dialog");
        await message(`Update check failed:

${errorMessage}`, {
          title: "Updater Error",
          kind: "error",
        });
      } catch {
        // Fallback when dialog permission/plugin is unavailable.
        alert(`Update check failed: ${errorMessage}`);
      }
    }

    return { status: "error", currentVersion, error: errorMessage };
  }
}
