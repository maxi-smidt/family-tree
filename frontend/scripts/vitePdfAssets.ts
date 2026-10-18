import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Serve PDF.js fonts, character maps and scan decoders locally in dev and
 * production, using the installed version to avoid stale cached assets. */
export function pdfAssets(): Plugin {
  const root = path.resolve(import.meta.dirname, "../node_modules/pdfjs-dist");
  const { version } = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { version: string };
  const assets = new Map<string, string>();
  for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    for (const file of readdirSync(path.join(root, directory))) {
      assets.set(
        `pdfjs/${version}/${directory}/${file}`,
        path.join(root, directory, file),
      );
    }
  }
  return {
    name: "local-pdf-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = assets.get(
          (request.url ?? "").split("?")[0].replace(/^\//, ""),
        );
        if (!file) return next();
        response.setHeader(
          "Content-Type",
          file.endsWith(".wasm")
            ? "application/wasm"
            : file.endsWith(".js")
              ? "text/javascript"
              : "application/octet-stream",
        );
        response.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [fileName, file] of assets) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(file) });
      }
    },
  };
}
