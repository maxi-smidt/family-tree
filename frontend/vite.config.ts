import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Backend the dev server proxies `/api` to. Override with VITE_PROXY_TARGET.
const apiTarget = process.env.VITE_PROXY_TARGET || "http://127.0.0.1:8000";
// Polling is needed for reliable file watching when running inside Docker
// (bind mounts on macOS/Windows don't emit native fs events).
const usePolling = !!process.env.VITE_USE_POLLING;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 1420,
    host: true,
    watch: usePolling ? { usePolling: true } : undefined,
    // Proxy API + media calls to FastAPI so the SPA can use same-origin
    // relative URLs (e.g. /api/media/...) in both dev and production.
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@/constants": path.resolve(__dirname, "./constants.json"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Keep the eager payload lean. The common React/UI runtime shared by every
    // route lives in one long-term-cached `vendor` chunk, while the heavy
    // libraries that only a single lazy-loaded view (or the lazy Markdown
    // renderer) needs get their own on-demand chunks. This keeps the login and
    // public-tree entry points from downloading the graph, map, chart and
    // Markdown code they never use. Budgets and the report live in
    // docs/BUNDLE.md and are enforced by scripts/check-bundle-size.mjs.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return;

          // Pin the React runtime and the UI/i18n/state libraries that the
          // login screen and every view share into one long-term-cached
          // `vendor` chunk. Keeping React here (rather than letting it be
          // co-located) is what prevents it from being duplicated into a heavy
          // feature chunk and dragged into the eager payload.
          //
          // Everything else is deliberately left to Rolldown. The heavy,
          // view-specific libraries — @xyflow (graph), leaflet (map), recharts
          // (charts) and react-markdown (editor) — are reachable only through a
          // lazy-loaded view or the lazy Markdown renderer, so Rolldown places
          // them (and their transitive deps) in that view's on-demand chunk,
          // keeping the graph/map/chart/Markdown code out of the initial load.
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-is|scheduler|use-sync-external-store|zustand|i18next|react-i18next|@radix-ui|radix-ui|@floating-ui|aria-hidden|react-remove-scroll|react-remove-scroll-bar|get-nonce|lucide-react|sonner|next-themes|class-variance-authority|tailwind-merge|clsx|date-fns|@dagrejs)[\\/]/.test(
              id,
            )
          )
            return "vendor";

          // NOTE: do not hand the heavy view-only libraries (@xyflow, leaflet,
          // recharts, react-markdown) their own named manualChunks. Doing so
          // makes Rolldown duplicate the React runtime into that chunk and pull
          // it into the eager payload. Left unnamed, Rolldown code-splits each
          // into the lazy view chunk that imports it, which is exactly what we
          // want. See docs/BUNDLE.md.
          return;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
