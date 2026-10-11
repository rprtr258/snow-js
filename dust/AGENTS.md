# dust

Browser renderer for Noita's portal/effect animations: a deterministic CPU
rasterizer ported from the game's shipped JavaScript, plus GIF export.

## Orientation

**The ported code is the spec.** `src/` was restored from the shipped game JS
and is fully annotated: `tsconfig.json` sets `strict` on, and `bun run lint`
(also run by `bun run typecheck`) rejects explicit `any` via
`@typescript-eslint/no-explicit-any`. The `Math.fround` calls and the
`byteRound` quantization boundaries are deliberate. The software renderer's
image is the **reference**.

**Grid and demo paths are GIF-only.** `grid-runtime` / `demo-runtime` /
`shift-runtime` are reached solely through GIF export (`gif-create` →
`gif-renderer`). `ui-shell.ts` and `fullscreen.ts` still speak of a second demo
page that has been removed — `static/index.html`, the single-effect preview, is
the only page.

**`static/assets/` are game-shipped inputs** (`effects.bin`, `effects.json`,
`raster.wasm`, `export-loops.json`); nothing in this repo generates them.

## Invariants

**Derive every preview size from `src/render-resolution.ts`.** Render buffer,
canvas backing store, and display size all follow from `PREVIEW_WIDTH/HEIGHT` ×
`RESOLUTION_SCALE`. HTML and CSS cannot import the constants, so JS must apply
them — a hardcoded size silently clips and off-centres the figure as soon as the
scale changes.

## Verifying

There is no test suite. Run `bun run typecheck` and `bun run build`.

`bun run dev` watches `src/` and `static/`, rebuilds `dist/`, and reloads the
browser — a manual build alongside it **races** the watcher, and browsers cache
the rebuilt modules and workers, so re-test on a fresh port. `scripts/serve.ts`
serves `dist/` only, so build first.

Repo is jj-colocated; `jj` is the VCS and `.git` mirrors it.
