import {/*FolderApi, */Pane} from "tweakpane";
import * as EssentialsPlugin from "@tweakpane/plugin-essentials";
import {Snow, type Options, type SnowOptions} from "snow-js";
import {
  Dust,
  dustDefaults,
  dustEffectGroups,
  type DustCollection,
  type DustEffectGroup,
  type DustOptions,
} from "snow-js/dust/src/embed.ts";

const mainContainer = document.querySelector<HTMLDivElement>(".container")!;
const effectContainer = document.querySelector<HTMLDivElement>(".effect-container")!;

type RGB = [number, number, number];
function parseHexColor(hex: string): RGB {
  if (hex[0] === '#')
    hex = hex.slice(1);

  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return [r/255, g/255, b/255];
  }

  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r/255, g/255, b/255];
  }

  throw new Error('Invalid hex color');
}

const commonOptions: {
  speed: number,
} = {
  speed: 10,
};
const options: {
  isDark: boolean,
  gradientIntensity: number,
  gradient: string,
  amount: number,
  size: number,
  opacity: number,
} = {
  isDark: true,
  gradient: "#00ccff",
  gradientIntensity: 0.3,
  amount: 0.5,
  size: 1,
  opacity: 1.0,
};
function toInner(): Options {
  return {
    isDark: options.isDark ? 1 : 0,
    gradientIntensity: options.gradientIntensity,
    iGradient: [...parseHexColor(options.gradient), 1],
    amount: options.amount,
    size: options.size,
    opacity: options.opacity,
  };
}

const snow2Options = {
  layers: 50,
  depth: .5,
  width: .3,
  speed: .6,
};

const snowState: {preset: "default" | "snow2"} = {preset: "default"};

function toSnowOptions(): SnowOptions {
  switch (snowState.preset) {
    case "default":
      return toInner();
    case "snow2":
      return {...snow2Options};
  }
}

const backgroundConfig = {
  color: "#000000",
  image: "",
  size: "cover",
  position: "50% 50%",
  repeat: "no-repeat",
};
const defaultBackgroundConfig = {...backgroundConfig};
function applyBackground() {
  effectContainer.style.backgroundColor = backgroundConfig.color;
  effectContainer.style.backgroundImage = backgroundConfig.image !== "" ? `url(${backgroundConfig.image})` : "none";
  effectContainer.style.backgroundSize = backgroundConfig.size;
  effectContainer.style.backgroundPosition = backgroundConfig.position;
  effectContainer.style.backgroundRepeat = backgroundConfig.repeat;
}
function resetBackground() {
  Object.assign(backgroundConfig, defaultBackgroundConfig);
  applyBackground();
  pane.refresh();
}

let snow = new Snow(effectContainer, commonOptions.speed, toSnowOptions(), false, snowState.preset);
snow.start();

function mountSnow(): void {
  // GL compiles the shader at construction, so preset switches rebuild it.
  snow.unmount();
  snow = new Snow(effectContainer, commonOptions.speed, toSnowOptions(), false, snowState.preset);
  snow.start();
}

/** card */
const cardConfig = {
  show: true,
};

/** active effect */
const effectState: {effect: "snow" | "dust" | "creation"} = {effect: "snow"};
let dust: Dust | null = null;
let dustBackgroundReset = false;

/** dust options */
const dustOptions = {
  collection: dustDefaults.collection,
  effect: dustDefaults.effect,
  speed: dustDefaults.speed,
  zoom: dustDefaults.zoom,
  core: dustDefaults.core,
  glow: dustDefaults.glow,
  useParticleColor: false,
  particleColor: "#ffffff",
  mathTrailScale: dustDefaults.mathTrailScale,
  seed: dustDefaults.seed,
  worldX: dustDefaults.x,
  worldY: dustDefaults.y,
};
const defaultDustEffect: Record<DustCollection, string> = {
  game: dustDefaults.effect,
  math: "math_penrose",
};
function toDustOptions(): Partial<DustOptions> {
  return {
    collection: dustOptions.collection,
    effect: dustOptions.effect,
    speed: dustOptions.speed,
    zoom: dustOptions.zoom,
    core: dustOptions.core,
    glow: dustOptions.glow,
    color: dustOptions.useParticleColor ? dustOptions.particleColor : null,
    background: backgroundConfig.color,
    mathTrailScale: dustOptions.mathTrailScale,
    seed: dustOptions.seed,
    x: dustOptions.worldX,
    y: dustOptions.worldY,
  };
}
function activateSnow() {
  dust?.unmount();
  dust = null;
  // The snow variable may hold the creation instance; rebuild the user's
  // snow from state instead of resuming.
  mountSnow();
  snowFolder.hidden = false;
  dustFolder.hidden = true;
}
function activateDust() {
  snow.stop();
  snowFolder.hidden = true;
  dustFolder.hidden = false;
  if (!dust) {
    // First pick: reset the shared background form so snow-time background
    // choices don't bleed into dust's rendered background.
    if (!dustBackgroundReset) {
      resetBackground();
      dustBackgroundReset = true;
    }
    dust = new Dust(effectContainer, toDustOptions());
  }
  dust.start();
}
function activateCreation() {
  dust?.unmount();
  dust = null;
  snow.unmount();
  snow = new Snow(effectContainer, commonOptions.speed, {}, false, "creation");
  snow.start();
  snowFolder.hidden = true;
  dustFolder.hidden = true;
}

const pane = new Pane({
  document,
  expanded: true,
  title: document.title,
});
pane.registerPlugin(EssentialsPlugin);

pane.addBinding(cardConfig, "show", {label: "show card"}).on("change", ({value}) => {
  mainContainer.style.display = value ? "block" : "none";
});

pane.addBinding(effectState, "effect", {
  label: "effect",
  options: {
    "Snow": "snow",
    "Dust": "dust",
    "Creation": "creation",
  },
}).on("change", ({value}) => {
  if (value === "snow") {
    activateSnow();
  } else if (value === "dust") {
    activateDust();
  } else {
    activateCreation();
  }
});

/** snow options */
const snowFolder = pane.addFolder({title: "snow", expanded: true});
function rebuildSnowControls() {
  for (const child of [...snowFolder.children])
    snowFolder.remove(child);
  snowFolder.addBinding(snowState, "preset", {
    label: "preset",
    options: {
      "Default": "default",
      "Other snow example": "snow2",
    },
  }).on("change", ({value}) => {
    snowState.preset = value;
    mountSnow();
    // The rebuild disposes the blade that fired this event; defer it past
    // the dispatch so tweakpane never touches a disposed view.
    setTimeout(rebuildSnowControls, 0);
  });
  switch (snowState.preset) {
    case "default":
      snowFolder.addBinding(options, "isDark");
      snowFolder.addBinding(options, "gradientIntensity", {min: 0, max: 1});
      snowFolder.addBinding(options, "gradient");
      snowFolder.addBinding(options, "amount", {min: 0.01, max: 0.5});
      snowFolder.addBinding(options, "size", {min: 0.4, max: 2});
      snowFolder.addBinding(options, "opacity", {min: 0.3, max: 3});
      break;
    case "snow2":
      snowFolder.addBinding(snow2Options, "layers", {min: 50, max: 200});
      snowFolder.addBinding(snow2Options, "depth", {min: .1, max: .5});
      snowFolder.addBinding(snow2Options, "width", {min: .3, max: .8});
      snowFolder.addBinding(snow2Options, "speed", {min: .6, max: 1.5});
      break;
  }
  snowFolder.addBinding(commonOptions, "speed", {min: 0, max: 20});
  snowFolder.addBinding({get time(): number {return snow._time;}}, "time", {
    view: "number",
    label: "time",
    readonly: true,
  });
}
rebuildSnowControls();

/** dust options */
const dustFolder = pane.addFolder({title: "dust", expanded: true});
dustFolder.hidden = true;

let dustGroups: {game: DustEffectGroup[], math: DustEffectGroup[]} | null = null;
// Tweakpane lists are flat (no optgroups), so group context is prefixed into
// each label while values stay the raw effect keys.
function effectListOptions(groups: DustEffectGroup[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (const group of groups) {
    for (const entry of group.effects)
      options[`${group.label} · ${entry.label}`] = entry.key;
  }
  return options;
}
function rebuildDustControls() {
  for (const child of [...dustFolder.children])
    dustFolder.remove(child);
  dustFolder.addBinding(dustOptions, "collection", {
    label: "collection",
    options: {
      "Noita effects": "game",
      "Mathematical figures · original": "math",
    },
  }).on("change", ({value}) => {
    dustOptions.collection = value;
    dustOptions.effect = defaultDustEffect[dustOptions.collection];
    // The rebuild disposes the blade that fired this event; defer it past
    // the dispatch so tweakpane never touches a disposed view.
    setTimeout(rebuildDustControls, 0);
    dust?.update({collection: dustOptions.collection, effect: dustOptions.effect});
  });
  const groups = dustOptions.collection === "math" ? dustGroups?.math : dustGroups?.game;
  dustFolder.addBinding(dustOptions, "effect", {
    label: "effect",
    options: effectListOptions(groups ?? []),
  }).on("change", ({value}) => {
    dustOptions.effect = value;
    dust?.update({effect: dustOptions.effect});
  });

  dustFolder.addBinding(dustOptions, "speed", {min: 0.25, max: 2}).on("change", () => {
    dust?.update({speed: dustOptions.speed});
  });
  dustFolder.addBinding(dustOptions, "zoom", {min: 1, max: 10, step: 1}).on("change", () => {
    dust?.update({zoom: dustOptions.zoom});
  });
  dustFolder.addBinding(dustOptions, "core", {label: "portal sprite"}).on("change", () => {
    dust?.update({core: dustOptions.core});
  });
  dustFolder.addBinding(dustOptions, "glow").on("change", () => {
    dust?.update({glow: dustOptions.glow});
  });

  const particleBinding = dustFolder.addBinding(dustOptions, "particleColor", {label: "particles"});
  particleBinding.hidden = !dustOptions.useParticleColor;
  particleBinding.on("change", () => {
    if (dustOptions.useParticleColor)
      dust?.update({color: dustOptions.particleColor});
  });
  dustFolder.addBinding(dustOptions, "useParticleColor", {label: "custom particles"}).on("change", ({value}) => {
    particleBinding.hidden = !value;
    dust?.update({color: value ? dustOptions.particleColor : null});
  });

  const mathTrailBinding = dustFolder.addBinding(dustOptions, "mathTrailScale", {
    label: "trail scale",
    min: 0.5,
    max: 3,
    step: 0.1,
  });
  mathTrailBinding.hidden = dustOptions.collection !== "math";
  mathTrailBinding.on("change", () => {
    dust?.update({mathTrailScale: dustOptions.mathTrailScale});
  });

  dustFolder.addBinding(dustOptions, "seed", {min: 0, max: 0xffffffff, step: 1}).on("change", () => {
    dust?.update({seed: dustOptions.seed});
  });
  dustFolder.addBinding(dustOptions, "worldX", {min: -1e7, max: 1e7}).on("change", () => {
    dust?.update({x: dustOptions.worldX});
  });
  dustFolder.addBinding(dustOptions, "worldY", {min: -1e7, max: 1e7}).on("change", () => {
    dust?.update({y: dustOptions.worldY});
  });
  dustFolder.addButton({title: "restart"}).on("click", () => {
    dust?.restart();
  });
}
rebuildDustControls();
void dustEffectGroups().then((groups) => {
  dustGroups = groups;
  rebuildDustControls();
});

pane.on("change", (e) => {
  void e;
  if (effectState.effect !== "snow")
    return;
  snow.update(toSnowOptions());
  snow.speed = commonOptions.speed;
});

/** background */
const background = pane.addFolder({title: "background", expanded: false});
background.addBinding(backgroundConfig, "color").on("change", ({value}) => {
  effectContainer.style.backgroundColor = value;
  if (dust)
    dust.update({background: String(value)});
});
background.addBinding(backgroundConfig, "image").on("change", ({value}) => { effectContainer.style.backgroundImage = `url(${value})`; });
background.addBinding(backgroundConfig, "size").on("change", ({value}) => { effectContainer.style.backgroundSize = value; });
background.addBinding(backgroundConfig, "position").on("change", ({value}) => { effectContainer.style.backgroundPosition = value; });
background.addBinding(backgroundConfig, "repeat").on("change", ({value}) => { effectContainer.style.backgroundRepeat = value; });

/** monitors */
const monitors = pane.addFolder({title: "monitors", expanded: true});
const fpsGraph = monitors.addBlade({view: "fpsgraph", label: "fps"}) as unknown as {begin(): void, end(): void};
function updateGraph() {
  fpsGraph.begin();
  fpsGraph.end();
  requestAnimationFrame(updateGraph);
}
requestAnimationFrame(updateGraph);

/** fullscreen */
declare global {
  // eslint-disable-next-line no-restricted-syntax -- declaration merging; a type alias cannot augment Element
  interface Element {
    webkitRequestFullscreen?(): void,
    mozRequestFullScreen?(): void,
    msRequestFullscreen?(): void,
  }
}

document.addEventListener("keydown", (event) => {
  if (event.code === "F11") {
    event.preventDefault();

    if (effectContainer.requestFullscreen !== undefined) {
      void effectContainer.requestFullscreen();
    } else if (effectContainer.webkitRequestFullscreen) {
      effectContainer.webkitRequestFullscreen();
    } else if (effectContainer.mozRequestFullScreen) {
      effectContainer.mozRequestFullScreen();
    } else if (effectContainer.msRequestFullscreen) {
      effectContainer.msRequestFullscreen();
    }
  }
});
