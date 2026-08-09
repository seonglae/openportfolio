import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The demo build swaps the Convex client for a fixture table, so the four views
// render real markup with invented numbers. Used for the screenshots and for
// the public demo page. The shipped app never resolves this alias.
// Served from /demo/ on the site, so asset URLs must be prefixed. With the
// default base of "/" the bundle 404s: it asks for /assets/, which on the
// deployed site is the marketing stylesheet and screenshots.
export default defineConfig({
  base: "/demo/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "convex/react": resolve(import.meta.dirname, "demo/convex-react.ts") },
  },
  build: {
    outDir: "dist-demo",
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, "demo.html") },
  },
  server: { port: 6102 },
  cacheDir: "./.vite-temp-demo",
});
