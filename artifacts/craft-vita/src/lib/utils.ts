import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Returns true only when running inside the Tauri desktop runtime (v1/v2 safe). */
export const isTauri = () => {
  if (typeof window === "undefined") return false;

  const w = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
    __TAURI_IPC__?: unknown;
  };

  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__ || w.__TAURI_IPC__);
};
