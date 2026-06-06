import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Backend the dev server proxies `/api` to. Override with VITE_PROXY_TARGET.
const apiTarget = process.env.VITE_PROXY_TARGET || "http://localhost:8000";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 1420,
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
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
