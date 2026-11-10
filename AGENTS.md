# AGENTS.md

Bun workspaces monorepo. `packages/snow-js` is the library (TypeScript source,
zero runtime dependencies, ships uncompiled `.ts` — consumers bundle it).
`packages/website` is the Vite + Tweakpane demo that renders each effect's
settings form automatically from its option specs.

## Commands

```bash
bun install
bun run dev:website        # demo site with live playground
bun run lint               # eslint + knip, both packages
bun run lint:fix
bun run typecheck          # bun check, both packages
bun run check:wasm         # CI: committed wasm matches src/render-kernel.wat
bun test                   # all workspaces; ~6s: schema, noita kernel, render snapshot tests
```

CI (PRs and pushes to `master`) runs: check:wasm, lint, typecheck, website
build, tests. Pushes to `master` also deploy the website build to gh-pages.

After editing `packages/snow-js/noita/src/render-kernel.wat`, rebuild the
committed binary: `cd packages/snow-js/noita && bun scripts/build-render-kernel.ts`,
then commit the new `static/assets/render-kernel.wasm` (CI fails on stale wasm).

## Architecture

- `effect.ts` — core vocabulary: option schema helpers (`num`/`bool`/`color`/
  `select`/`action`), `defineEffect`, `InferOptions`, `EffectInstance`
  (`start`/`stop`/`update`/`restart?`/`unmount`).
- `registry.ts` — `EFFECTS` object, `createEffect`/`getEffect`. Registry is
  synchronous; async asset loading stays inside effect instances.
- `index.ts` — public API re-exports; keep new exports here.
- `glsl.ts` / `glsl-effect.ts` — WebGL quad renderer + shared lifecycle for
  fragment-shader effects (time accumulation, uniform updates).
- Effects: `snow/` (presets `snow` and `snowfall`), `creation/`, `noita/`.
- `noita/src/` — ported Noita simulation + software renderer; `embed.ts` is the
  browser-side embed and the only file the registry layer drives.
  `noita/static/assets/` holds committed wasm + effect catalog read at runtime.
- `website/` — `index.ts` wires the dropdown + Tweakpane pane;
  `form.ts` builds forms from option specs.

Adding an effect: create `packages/snow-js/<name>/index.ts` (default-export a
`defineEffect` definition), register it in `registry.ts`. The website picks it
up automatically — no per-effect UI code.

## Code style (enforced by eslint in packages/snow-js, except noita/)

- Type aliases only — `interface` is lint-prohibited. No function overloads.
  No `.forEach` — use `for..of` or value-returning methods.
- No type assertions (`as`/`<>` are errors). Strict boolean expressions.
- Semicolons always, 2-space indent, trailing commas on multiline, comma
  delimiters in type members, `{x}` braces (no inner spaces).
- Imports end in `.ts` (`import ... from "./effect.ts"`).
- knip fails on unused files/exports; test files and `noita/scripts/*.ts` are
  declared entry points in `knip.json`.
- `noita/src/` and `noita/scripts/` are ported sources with their own style
  (spaces in braces, no semicolons); only `no-explicit-any` is enforced there.
  Do not restyle them.

## Gotchas

- Bun's own `bun check` is the typechecker (no `tsc` step).
