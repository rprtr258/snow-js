import {Pane} from "tweakpane";
import type {FolderApi} from "tweakpane";
import * as EssentialsPlugin from "@tweakpane/plugin-essentials";
import {createEffect, EFFECTS, getEffect, type EffectInstance} from "@rprtr258/snow-js";
import {buildEffectForm} from "./form.ts";

const mainContainer = document.querySelector<HTMLDivElement>(".container")!;
const effectContainer = document.querySelector<HTMLDivElement>(".effect-container")!;

const backgroundConfig = {
  color: "#000000",
  image: "",
  gradient: "#00ccff",
  gradientIntensity: 0.3,
  size: "cover",
  position: "50% 50%",
  repeat: "no-repeat",
};

function withAlpha(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

// Gradient layer over image layer: the gradient used to be drawn by the snow
// shader on top of the page, so it keeps sitting above the image.
function applyBackgroundImage(): void {
  const layers: string[] = [];
  if (backgroundConfig.gradientIntensity > 0)
    layers.push(`linear-gradient(to top, ${withAlpha(backgroundConfig.gradient, backgroundConfig.gradientIntensity)}, transparent)`);
  if (backgroundConfig.image !== "")
    layers.push(`url(${backgroundConfig.image})`);
  effectContainer.style.backgroundImage = layers.join(", ");
}

/** active effect */
const effectState = {effect: "snow"};
let current: {instance: EffectInstance} | null = null;
let optionsFolder: FolderApi | null = null;
let currentForm: {dispose(): void} | null = null;

function activate(key: string): void {
  currentForm?.dispose();
  currentForm = null;
  current?.instance.unmount();
  current = null;
  if (optionsFolder !== null) {
    pane.remove(optionsFolder);
    optionsFolder = null;
  }
  const def = getEffect(key);
  if (def === undefined)
    return;
  const instance = createEffect(effectContainer, key);
  // Dust renders its own background; shader effects ignore the key.
  instance.update({background: backgroundConfig.color});
  instance.start();
  if (def.options.length > 0) {
    optionsFolder = pane.addFolder({title: def.label, expanded: true});
    currentForm = buildEffectForm(optionsFolder, def, instance, (changed) => {
      instance.update(changed);
    });
  }
  current = {instance};
}

/** card */
const cardConfig = {
  show: true,
};

const pane = new Pane({
  document,
});
pane.registerPlugin(EssentialsPlugin);

/** monitors */
const monitors = pane.addFolder({title: "monitors", expanded: true});
const fpsGraph = monitors.addBlade({view: "fpsgraph", label: "fps"}) as unknown as {begin(): void, end(): void};
function updateGraph() {
  fpsGraph.begin();
  fpsGraph.end();
  requestAnimationFrame(updateGraph);
}
requestAnimationFrame(updateGraph);

/** background */
const background = pane.addFolder({title: "background", expanded: false});
background.addBinding(backgroundConfig, "color").on("change", ({value}) => {
  effectContainer.style.backgroundColor = value;
  current?.instance.update({background: String(value)});
});
background.addBinding(backgroundConfig, "image").on("change", applyBackgroundImage);
background.addBinding(backgroundConfig, "gradient").on("change", applyBackgroundImage);
background.addBinding(backgroundConfig, "gradientIntensity", {min: 0, max: 1}).on("change", applyBackgroundImage);
background.addBinding(backgroundConfig, "size").on("change", ({value}) => { effectContainer.style.backgroundSize = value; });
background.addBinding(backgroundConfig, "position").on("change", ({value}) => { effectContainer.style.backgroundPosition = value; });
background.addBinding(backgroundConfig, "repeat").on("change", ({value}) => { effectContainer.style.backgroundRepeat = value; });
applyBackgroundImage();

/** snow-js */
const snowJs = pane.addFolder({title: "snow-js", expanded: true});
snowJs.addBinding(cardConfig, "show", {label: "show card"}).on("change", ({value}) => {
  mainContainer.style.display = value ? "block" : "none";
});

snowJs.addBinding(effectState, "effect", {
  label: "effect",
  options: Object.fromEntries(Object.entries(EFFECTS).map(([key, def]) => [def.label, key])),
}).on("change", ({value}) => {
  activate(value);
});
activate(effectState.effect);

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
