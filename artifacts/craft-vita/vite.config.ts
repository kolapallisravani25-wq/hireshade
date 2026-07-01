import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const rawPort = process.env.PORT ?? "23480";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

// Tauri's CLI sets this when running beforeDevCommand/beforeBuildCommand for the
// desktop app. In that case we want the real @tauri-apps/* packages (native
// bridge), not the browser stubs used by the plain web build.
const isTauri = process.env.TAURI_ENV_PLATFORM !== undefined;

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      ...(isTauri
        ? {}
        : {
            "@tauri-apps/plugin-dialog": path.resolve(import.meta.dirname, "src/tauri-stubs/plugin-dialog.ts"),
            "@tauri-apps/plugin-fs": path.resolve(import.meta.dirname, "src/tauri-stubs/plugin-fs.ts"),
            "@tauri-apps/plugin-updater": path.resolve(import.meta.dirname, "src/tauri-stubs/plugin-updater.ts"),
            "@tauri-apps/plugin-process": path.resolve(import.meta.dirname, "src/tauri-stubs/plugin-process.ts"),
            "@tauri-apps/plugin-opener": path.resolve(import.meta.dirname, "src/tauri-stubs/plugin-opener.ts"),
            "@tauri-apps/plugin-deep-link": path.resolve(import.meta.dirname, "src/tauri-stubs/plugin-deep-link.ts"),
            "@tauri-apps/api/core": path.resolve(import.meta.dirname, "src/tauri-stubs/api-core.ts"),
            "@tauri-apps/api/event": path.resolve(import.meta.dirname, "src/tauri-stubs/api-event.ts"),
            "@tauri-apps/api/webviewWindow": path.resolve(import.meta.dirname, "src/tauri-stubs/api-webviewWindow.ts"),
            "@tauri-apps/api/window": path.resolve(import.meta.dirname, "src/tauri-stubs/api-window.ts"),
            "@tauri-apps/api/app": path.resolve(import.meta.dirname, "src/tauri-stubs/api-app.ts"),
            "@fabianlars/tauri-plugin-oauth": path.resolve(import.meta.dirname, "src/tauri-stubs/tauri-plugin-oauth.ts"),
          }),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    ...(isTauri
      ? {
          rollupOptions: {
            input: {
              main: path.resolve(import.meta.dirname, "index.html"),
              floating: path.resolve(import.meta.dirname, "floating.html"),
              launcher: path.resolve(import.meta.dirname, "launcher.html"),
            },
          },
        }
      : {}),
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
