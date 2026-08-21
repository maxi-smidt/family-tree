import { promises as fs } from "fs";
import path from "path";
import zlib from "zlib";

// Guards the initial-load budget the app committed to in docs/BUNDLE.md so a
// heavy dependency can't silently creep back into the eager payload. Run it
// after `npm run build`; it reads dist/ and fails the build when a budget is
// exceeded or a graph/map/chart library ships in the initial load.

const DIST = "dist";
const ASSETS = path.join(DIST, "assets");
const INDEX_HTML = path.join(DIST, "index.html");

// Budgets are gzipped transfer sizes in KiB. They sit ~15-20% above the sizes
// measured when the split landed, so ordinary churn passes but a heavy library
// landing in the eager payload fails. Revisit alongside docs/BUNDLE.md.
const BUDGETS_KB = {
  entry: 90, // the entry chunk (dist/assets/index-*.js)
  vendor: 190, // the shared React/UI runtime chunk (dist/assets/vendor-*.js)
  initialJs: 360, // every eagerly-loaded .js (entry + its modulepreloads)
};

// Heavy, view-only libraries that must never ship in the initial payload. Each
// marker is a class-name prefix the library emits into its bundle that survives
// minification, so finding it inside an eager chunk means the split regressed.
// (Markdown/remark has no such marker; the initialJs budget catches it — it
// adds ~48 KiB gzip if it leaks in.)
const FORBIDDEN_EAGER_MARKERS = [
  { name: "@xyflow/react (graph view)", marker: "react-flow" },
  { name: "leaflet (map view)", marker: "leaflet-" },
  { name: "recharts (statistics view)", marker: "recharts-" },
];

const kib = (bytes) => bytes / 1024;
const gzipKib = (buf) => kib(zlib.gzipSync(buf, { level: 9 }).length);
const fmt = (n) => `${n.toFixed(1)} KiB`;

async function main() {
  let html;
  try {
    html = await fs.readFile(INDEX_HTML, "utf8");
  } catch {
    console.error(`✗ ${INDEX_HTML} not found — run \`npm run build\` first.`);
    process.exit(1);
  }

  // The eager payload is the entry <script src> plus every modulepreload hint
  // Vite emits for the entry's static import graph.
  const entryFile = html.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/)?.[1];
  const eager = new Set(entryFile ? [entryFile] : []);
  for (const tag of html.matchAll(
    /<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g,
  )) {
    eager.add(tag[1]);
  }

  const files = (await fs.readdir(ASSETS)).filter((f) => f.endsWith(".js"));
  const rows = [];
  for (const file of files) {
    const buf = await fs.readFile(path.join(ASSETS, file));
    rows.push({
      file,
      raw: kib(buf.length),
      gzip: gzipKib(buf),
      eager: eager.has(file),
      text: buf.toString("latin1"),
    });
  }

  const byPrefix = (prefix) => rows.find((r) => r.file.startsWith(prefix));
  const entry = byPrefix("index-");
  const vendor = byPrefix("vendor-");
  const eagerRows = rows.filter((r) => r.eager).sort((a, b) => b.gzip - a.gzip);
  const initialGzip = eagerRows.reduce((sum, r) => sum + r.gzip, 0);

  const failures = [];
  const check = (label, gzip, budget) => {
    const ok = gzip <= budget;
    if (!ok) {
      failures.push(`${label}: ${fmt(gzip)} gzip exceeds ${fmt(budget)} budget`);
    }
    return `${ok ? "✓" : "✗"} ${label.padEnd(26)} ${fmt(gzip).padStart(12)}  (budget ${fmt(budget)})`;
  };

  console.log("\nInitial-load budget (gzipped)\n");
  if (entry) console.log(check("entry (index)", entry.gzip, BUDGETS_KB.entry));
  if (vendor) console.log(check("vendor", vendor.gzip, BUDGETS_KB.vendor));
  console.log(check("initial JS (eager total)", initialGzip, BUDGETS_KB.initialJs));

  console.log("\nEager chunks\n");
  for (const r of eagerRows) {
    console.log(`  ${r.file.padEnd(34)} ${fmt(r.raw).padStart(12)} raw  ${fmt(r.gzip).padStart(11)} gzip`);
  }

  const lazy = rows.filter((r) => !r.eager).sort((a, b) => b.gzip - a.gzip);
  console.log("\nLargest on-demand chunks\n");
  for (const r of lazy.slice(0, 6)) {
    console.log(`  ${r.file.padEnd(34)} ${fmt(r.raw).padStart(12)} raw  ${fmt(r.gzip).padStart(11)} gzip`);
  }

  // Structural guard: no graph/map/chart library may sit in an eager chunk.
  for (const { name, marker } of FORBIDDEN_EAGER_MARKERS) {
    const hit = eagerRows.find((r) => r.text.includes(marker));
    if (hit) {
      failures.push(
        `${name} shipped in the eager chunk ${hit.file} (found "${marker}") — it must stay lazy-loaded`,
      );
    }
  }

  if (failures.length) {
    console.error("\nBundle-size check failed:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(
      "\nSee docs/BUNDLE.md. If an increase is intentional, adjust the budgets there and in scripts/check-bundle-size.mjs.",
    );
    process.exit(1);
  }

  console.log("\n✓ Bundle within budget.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
