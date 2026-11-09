# snow-js

An effects library: every visual effect (shader screensavers, particle
simulations) is a self-contained **effect definition** carrying its own typed
options schema. Consumers list effects from a registry, instantiate them
behind one tiny interface, and build configuration UIs from the option specs —
no per-effect frontend code.

## Usage

```ts
import {createEffect, EFFECTS} from "snow-js";

// List effects (key, label, option specs) and drive instances:
for (const def of EFFECTS)
  console.log(def.label);

const instance = createEffect(container, "snow", {speed: 5});
instance.start();
instance.update({amount: 0.2}); // live option updates
instance.unmount();
```

Effects available: `snow`, `creation`, `dust` — each fills its own
options struct (checked against the effect's schema at compile time via the
typed `createEffect` overload). `snow` ships two presets selectable via its
`preset` option: `snow` (flat snow, the default) and `snowfall`
(layered blizzard); the visible settings follow the chosen preset.

## Adding a new effect

1. Create `packages/snow-js/effects/<name>/index.ts` with a default-exported
   definition. The option schema is a plain object built from the `num` /
   `bool` / `color` / `select` / `action` helpers; defaults live in the schema
   and `InferOptions` derives the options struct from it:

   ```ts
   import {defineEffect, num} from "../../effect.ts";
   import {createShaderEffect} from "../snow-runner.ts";

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

2. Register it in `packages/snow-js/registry.ts` (`EFFECTS` array).

That is all: the website picks the effect up in its dropdown and renders its
form automatically. An effect instance implements `start` / `stop` / `update`
/ `unmount` (plus optional `restart`); everything else — WebGL plumbing,
worker pipelines, asset loading — is the effect's internal business. Async
loading (dust's wasm/catalog assets) happens inside the instance; the registry
itself is synchronous.

## Structure

```
packages/snow-js/
  effect.ts            abstraction: specs, schema helpers, defineEffect
  registry.ts          EFFECTS list, createEffect/getEffect
  glsl.ts              WebGL quad renderer (shader effects)
  effects/
    snow-runner.ts     shared lifecycle for fragment-shader effects
    snow/              "Snow" — preset "snow": flat snow
                       (shadertoy 4sX3z2); preset "snowfall": layered
                       blizzard (shadertoy ldsGDn)
      snowfall.ts      the snowfall shader + options, used by snow's
                       "snowfall" preset (not a standalone effect)
    creation/          "Creation" — psychedelic tunnel (pouet 57245)
    dust/              "Dust" — Noita portals, objects, original math figures
      src/             ported simulation + software renderer + embed viewer
      static/assets/   checked-in effect catalog (effects.json/bin) + wasm
```

## Development

```bash
bun install
bun run dev:website   # website with the tweakpane playground
bun lint              # eslint + knip
bun typecheck
bun test              # dust kernels, render snapshots, schema tests
```

Dust's browser side is its embed viewer (effects/dust/src/embed.ts); the
simulation and raster code are untouched by the registry layer.
