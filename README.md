# @rprtr258/snow-js

A browser effects library where every visual effect — falling snow, a
psychedelic tunnel, a Noita-style dust simulation — is a self-contained
**effect definition** carrying its own typed options schema. List effects
from a registry, drive them through one tiny instance interface, and build
configuration UIs straight from the option specs: adding an effect is one
file plus a registry entry, with no per-effect frontend code.

- **Live demo.** [rprtr258.github.io/snow-js](https://rprtr258.github.io/snow-js/)
  — the showcase site renders every effect's settings form automatically
  from its option specs.
- **Typed options.** Schemas are built from `num` / `bool` / `color` /
  `select` / `action` helpers; `InferOptions` derives the options struct from
  the schema, so `createEffect` calls are checked at compile time.
- **One tiny interface.** Instances expose `start` / `stop` / `update` /
  `unmount` (plus optional `restart`); WebGL plumbing, workers and wasm stay
  inside each effect.
- **Zero runtime dependencies.** Ships as TypeScript source.
- **Three effects built in.** `snow` (flat snow + layered `snowfall`
  blizzard preset), `creation` (psychedelic tunnel), `noita` (Noita-style
  portals, objects and math figures).

```ts
import {createEffect} from "@rprtr258/snow-js";

const instance = createEffect(container, "snow", {speed: 5}); // checked against snow's schema
instance.start();
instance.update({amount: 0.3}); // live option updates, no remount
instance.unmount();
```

## Getting started

Add the library to a project:

```bash
bun add @rprtr258/snow-js   # or: npm i @rprtr258/snow-js
```

or straight from git:

```bash
bun add github:rprtr258/snow-js
```

To hack on the library itself, run the demo website from the repo:

```bash
git clone https://github.com/rprtr258/snow-js
cd snow-js && bun install
bun run dev:website   # website with the tweakpane playground
```

## Adding a new effect

1. Create `packages/snow-js/<name>/index.ts` with a default-exported
   definition. The option schema is a plain object built from the `num` /
   `bool` / `color` / `select` / `action` helpers; defaults live in the schema
   and `InferOptions` derives the options struct from it:

   ```ts
   import {defineEffect, num} from "../../effect.ts";
   import {createShaderEffect} from "../glsl-effect.ts";

   const options = {
     speed: num(10, {label: "speed", min: 0, max: 20}),
   };

   export default defineEffect({
     key: "my-effect",
     label: "My effect",
     options,
     create: (el, values) => createShaderEffect(el, {
       fragment: FRAGMENT_GLSL,
       values,
       toUniforms: () => ({}),
       speedOf: (v) => v.speed,
     }),
   });
   ```

2. Register it in `packages/snow-js/registry.ts` (`EFFECTS` object).

That is all: the website picks the effect up in its dropdown and renders its
form automatically. An effect instance implements `start` / `stop` / `update`
/ `unmount` (plus optional `restart`); everything else — WebGL plumbing,
worker pipelines, asset loading — is the effect's internal business. Async
loading (noita's wasm/catalog assets) happens inside the instance; the registry
itself is synchronous.

## Structure

```
packages/snow-js/
  effect.ts            abstraction: specs, schema helpers, defineEffect
  registry.ts          EFFECTS object, createEffect/getEffect
  glsl.ts              WebGL quad renderer (shader effects)
  glsl-effect.ts       shared lifecycle for fragment-shader effects
  snow/                "Snow" — preset "snow": flat snow
                       (shadertoy 4sX3z2); preset "snowfall": layered
                       blizzard (shadertoy ldsGDn)
    snowfall.ts        the snowfall shader + options, used by snow's
                       "snowfall" preset (not a standalone effect)
  creation/            "Creation" — psychedelic tunnel (pouet 57245)
  noita/               "Noita" — Noita portals, objects, original math figures
    src/               ported simulation + software renderer + embed viewer
    static/assets/     checked-in effect catalog (effects.json/bin) + wasm
```

## Development

```bash
bun install
bun run dev:website   # website with the tweakpane playground
bun run lint          # eslint + knip (both packages)
bun run typecheck     # both packages
cd packages/snow-js && bun test   # noita kernels, render snapshots, schema tests
```

Noita's browser side is its embed viewer (noita/src/embed.ts); the
simulation and raster code are untouched by the registry layer.
