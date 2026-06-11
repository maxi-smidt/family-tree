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
    // All node_modules land in a single vendor chunk (~810 kB minified,
    // ~250 kB gzip). Splitting vendors further creates circular chunk
    // warnings because every React library cross-imports react/react-dom.
    // The vendor chunk is cached aggressively and rarely invalidated;
    // heavy views are already code-split via dynamic import() below.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules")) return "vendor";
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
