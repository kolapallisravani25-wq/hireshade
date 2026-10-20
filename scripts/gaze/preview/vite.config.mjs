import path from "node:path";

const root = import.meta.dirname;

/** Vite build config for the standalone W4 gaze preview (plain object: no vite import needed). */
export default {
  root,
  base: "./",
  publicDir: false,
  build: {
    outDir: path.resolve(root, "..", "..", "..", "docs", "evidence", "gaze", "preview-dist"),
    emptyOutDir: true,
    assetsDir: "assets",
    target: "chrome120",
  },
};
