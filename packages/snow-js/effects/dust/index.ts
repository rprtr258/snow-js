// Dust effect definition: every Noita portal, catalog object/image effect and
// original math figure exposed through the abstract effect registry. The two
// selection levels (collection, effect) are ordinary select options; the
// effect list recomputes from the chosen collection.
import {
  action,
  bool,
  color,
  defineEffect,
  num,
  select,
  type InferOptions,
  type OptionValues,
  type SelectEntry,
  type SelectGroup,
} from "../../effect.ts";
import {Dust, type DustCollection} from "./src/embed.ts";
import {EFFECTS as PORTAL_EFFECTS} from "./src/portal-physics.ts";
import {MATH_EFFECTS, MATH_GROUPS} from "./src/math-figures.ts";
import {CATALOG_EFFECTS, CATALOG_GROUP_LABELS} from "./src/effect-metadata.ts";

function catalogEntries(group: string): SelectEntry[] {
  return CATALOG_EFFECTS
    .filter((meta) => meta.group === group)
    .map((meta) => ({value: meta.key, label: meta.label}));
}

function gameGroups(): SelectGroup[] {
  return [
    {
      label: "Portals",
      entries: Object.entries(PORTAL_EFFECTS).map(([key, e]) => ({value: key, label: e.label})),
    },
    {label: CATALOG_GROUP_LABELS["objects"]!, entries: catalogEntries("objects")},
    {label: CATALOG_GROUP_LABELS["images"]!, entries: catalogEntries("images")},
  ];
}

function mathGroups(): SelectGroup[] {
  return Object.entries(MATH_GROUPS).map(([key, label]) => ({
    label,
    entries: Object.entries(MATH_EFFECTS)
      .filter(([, e]) => e.group === key)
      .map(([figureKey, e]) => ({value: figureKey, label: e.label})),
  }));
}

const options = {
  collection: select<DustCollection>("game", {
    label: "collection",
    entries: [
      {value: "game", label: "Noita effects"},
      {value: "math", label: "Mathematical figures · original"},
    ],
  }),
  effect: select<string>("meditation", {
    label: "effect",
    entries: (values: OptionValues): SelectGroup[] =>
      values["collection"] === "math" ? mathGroups() : gameGroups(),
  }),
  speed: num(1, {label: "speed", min: 0.25, max: 2}),
  zoom: num(1, {label: "zoom", min: 1, max: 10, step: 1}),
  fullscreen: bool(false, {label: "fullscreen render"}),
  density: num(1, {label: "density", min: 0.25, max: 8, step: 0.25}),
  core: bool(true, {label: "guides"}),
  glow: bool(true, {label: "glow"}),
  portalSprite: bool(true, {label: "portal sprite"}),
  color: color(null, {label: "particles"}),
  mathTrailScale: num(1, {
    label: "trail scale",
    min: 0.5,
    max: 3,
    step: 0.1,
    visible: (values) => values["collection"] === "math",
  }),
  minTrailLifetime: num(0.35, {
    label: "min trail lifetime",
    min: 0,
    max: 10,
    step: 0.05,
  }),
  ambientRing: bool(true, {label: "ambient ring"}),
  fastParticles: bool(false, {label: "fast particles"}),
  cullInvisible: bool(false, {label: "cull invisible"}),
  particleMirror: bool(false, {label: "particle kernel"}),
  seed: num(0, {label: "seed", min: 0, max: 0xffffffff, step: 1}),
  x: num(0, {label: "worldX", min: -1e7, max: 1e7}),
  y: num(0, {label: "worldY", min: -1e7, max: 1e7}),
  restart: action("restart", (instance) => instance.restart?.()),
};
type DustValues = InferOptions<typeof options>;

export default defineEffect({
  label: "Dust",
  options,
  create: (el, values: DustValues) => new Dust(el, values),
});
