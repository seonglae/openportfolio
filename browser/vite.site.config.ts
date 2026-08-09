import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Builds ../site/assets/style.css from ../site/assets/site.css, the entry for
// the marketing pages and the docs: Tailwind, then the shared foundation that
// this package's own entry also imports, then the shapes only those pages use.
//
// It lives here rather than under site/ because vite resolves a config's imports
// from the config file's own directory, and vite plus the Tailwind plugin are
// installed in this package. A standalone Tailwind CLI would be the obvious
// alternative, but it pulls @parcel/watcher for watch mode, whose postinstall
// pnpm refuses to run unapproved, and `pnpm install` then exits 1 in CI.
//
// The output is committed: Cloudflare Pages serves site/ with no build
// configured, so whatever is in git is what ships.
const SITE = resolve(import.meta.dirname, "../site");

export default defineConfig({
  root: SITE,
  plugins: [tailwindcss()],
  build: {
    outDir: resolve(SITE, "assets"),
    // assets/ holds hand-written sources too, so a clean would take site.css and
    // mark.svg with it.
    emptyOutDir: false,
    cssMinify: true,
    rollupOptions: {
      input: resolve(SITE, "assets/site.css"),
      output: { assetFileNames: "style.css" },
    },
  },
});
