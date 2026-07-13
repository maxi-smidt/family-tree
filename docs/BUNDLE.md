# Frontend bundle budget

The frontend is a single-page app, so the **initial payload** — the JavaScript
the browser must download and execute before it can render the login screen or a
public tree — sets the floor for time-to-interactive. This document records the
budget for that payload, how the build stays under it, and the numbers behind
the split introduced for [#673](https://github.com/maxi-smidt/family-tree/issues/673).

## The rule

Login, the public-tree viewer and other lightweight routes must **not** download
the heavy libraries that only the authenticated graph, map, chart and Markdown
views use. Those libraries are code-split into on-demand chunks and fetched the
first time their view opens.

Concretely:

| Library (chunk)                | Loaded                                   |
| ------------------------------ | ---------------------------------------- |
| `@xyflow/react` (graph)        | on demand — tree view / linked-trees dialog |
| `leaflet` + `react-leaflet` (map) | on demand — map view                  |
| `recharts` (chart)             | on demand — statistics view              |
| `react-markdown` + remark/rehype (editor) | on demand — first Markdown render |

## How the split works

Two mechanisms keep the heavy code out of the initial load:

1. **Route/view code-splitting.** Views are lazily imported in
   [`MainPanel.tsx`](../frontend/src/components/layout/MainPanel.tsx) and
   [`PublicTreeViewer.tsx`](../frontend/src/components/public/PublicTreeViewer.tsx),
   and the Markdown renderer is lazily imported inside
   [`MarkdownContent.tsx`](../frontend/src/components/shared/MarkdownContent.tsx)
   (the login screen's legal dialog renders Markdown, so the renderer itself had
   to move behind a lazy boundary — not just its callers).

2. **Chunking strategy in [`vite.config.ts`](../frontend/vite.config.ts).** The
   React runtime plus the UI/i18n/state libraries every route shares are pinned
   to one long-term-cached `vendor` chunk. Everything else is left to Rolldown,
   which places each heavy library in the lazy view chunk that imports it.

   > Do **not** give the heavy libraries their own named `manualChunks`. Because
   > every React library cross-imports React, naming them makes Rolldown
   > duplicate the React runtime into that chunk and drag it into the eager
   > payload — the exact regression this split removes.

## Budgets

Enforced by [`scripts/check-bundle-size.mjs`](../frontend/scripts/check-bundle-size.mjs)
(run as the **Bundle size budget** CI step after the build). Values are gzipped
transfer sizes and sit ~15–20 % above the measured sizes so ordinary churn
passes while a heavy dependency re-entering the initial load fails the build.

| Budget (gzip)              | Limit   | Measured |
| -------------------------- | ------- | -------- |
| entry chunk (`index`)      | 95 KiB  | ~77 KiB  |
| `vendor` chunk             | 190 KiB | ~157 KiB |
| initial JS (eager total)   | 360 KiB | ~300 KiB |

The checker also fails if `@xyflow`, `leaflet` or `recharts` are detected inside
any eager chunk, regardless of the size numbers.

Authenticated-view chunks are intentionally **not** budgeted by size — they load
on demand, so their weight does not affect initial load. Keep an eye on them via
the "Largest on-demand chunks" table the checker prints.

## Before / after (#673)

Measured with `npm run build` (gzip, level 9). The vendor chunk was the
1.63 MB (raw) offender called out in the issue.

| Metric                       | Before      | After       | Change        |
| ---------------------------- | ----------- | ----------- | ------------- |
| **Initial JS (eager total)** | 592 KiB     | 300 KiB     | **−49 %**     |
| `vendor` chunk               | 473 KiB     | 157 KiB     | **−67 %**     |
| entry (`index`) chunk        | 57 KiB      | 77 KiB      | +20 KiB\*     |
| Largest single chunk         | 473 KiB (vendor, eager) | 115 KiB (statistics, on demand) | eager → lazy |

\* The entry chunk grows slightly because a few shared libraries that used to sit
in `vendor` now co-locate with the entry. The **eager total still drops by
~292 KiB gzip** (~1 MB raw), which is what the browser actually downloads before
first paint.

Heavy libraries, now fetched only when their view opens (gzip): statistics /
recharts ~115 KiB, map / leaflet ~65 KiB, graph / @xyflow ~51 KiB, Markdown
~46 KiB. None of these are in the login or public-tree initial load.

## Updating the budget

If an increase is intentional (e.g. a new always-on dependency), update the
numbers in `scripts/check-bundle-size.mjs` **and** the tables above in the same
PR, with a one-line justification.
