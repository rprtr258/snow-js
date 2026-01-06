import {/*FolderApi, */Pane} from "tweakpane";
import * as EssentialsPlugin from "@tweakpane/plugin-essentials";
import {Snow, type Options} from "snow-js";

const mainContainer = document.querySelector<HTMLDivElement>(".container")!;
const snowContainer = document.querySelector<HTMLDivElement>(".snow-container")!;

type RGB = [number, number, number];
function parseHexColor(hex: string): RGB {
  if (hex[0] === '#')
    hex = hex.slice(1);

  if (hex.length === 3) {
    // @ts-expect-error sosal
    const r = parseInt(hex[0] + hex[0], 16);
    // @ts-expect-error sosal
    const g = parseInt(hex[1] + hex[1], 16);
    // @ts-expect-error sosal
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

// const snow2Options = {
//   layers: 50,
//   depth: .5,
//   width: .3,
//   speed: .6,
// };

// type Params =
//   | {preset: "default", options: Options}
//   | {preset: "snow2", options: typeof snow2Options}
//   | {preset: "creation", options: []};
// const params = {
//   preset: "default",
//   options: options,
// };

const backgroundConfig = {
  color: "#000000",
  image: "",
  size: "cover",
  position: "50% 50%",
  repeat: "no-repeat",
  showBanner: true,
};

const snow = new Snow(snowContainer, commonOptions.speed, toInner(), false);
snow.start();

const pane = new Pane({
  document,
  expanded: true,
  title: document.title,
});
pane.registerPlugin(EssentialsPlugin);

/** options */
pane.addBinding(options, "isDark");
pane.addBinding(options, "gradientIntensity", {min: 0, max: 1});
pane.addBinding(options, "gradient");
pane.addBinding(options, "amount", {min: 0.01, max: 0.5});
pane.addBinding(options, "size", {min: 0.4, max: 2});
pane.addBinding(options, "opacity", {min: 0.3, max: 3});

const common = pane.addFolder({title: "Common options", expanded: true});
common.addBinding(commonOptions, "speed", {min: 0, max: 20});
common.addBinding({get time(): number {return snow._time;}}, "time", {
  view: "number",
  label: "time",
  readonly: true,
});

// const varsFolder: FolderApi = pane.addFolder({title: "Configuration"});

// function rebuild() {
//   for (const child of varsFolder.children)
//     varsFolder.remove(child);

//   varsFolder.addBinding(params, "preset", {
//     options: {
//       "Default": "default",
//       "Other snow example": "snow2",
//       "Creation": "creation",
//     },
//   });
//   switch (params.preset) {
//     case "default":
//       varsFolder.addBinding(options, "isDark");
//       varsFolder.addBinding(options, "gradientIntensity", {min: 0, max: 0.3});
//       varsFolder.addBinding(options, "amount", {min: 0.01, max: 0.5});
//       varsFolder.addBinding(options, "speed", {min: 1, max: 20});
//       varsFolder.addBinding(options, "size", {min: 0.4, max: 2});
//       varsFolder.addBinding(options, "opacity", {min: 0.3, max: 3});
//       break;
//     case "snow2":
//       varsFolder.addBinding(snow2Options, "layers", {min: 50, max: 200});
//       varsFolder.addBinding(snow2Options, "depth", {min: .1, max: .5});
//       varsFolder.addBinding(snow2Options, "width", {min: .3, max: .8});
//       varsFolder.addBinding(snow2Options, "speed", {min: .6, max: 1.5});
//       break;
//     case "creation":
//       break;
//   }
// }

// rebuild();
pane.on("change", (e) => {
  void e;
  // // @ts-expect-error sosi
  // if (e.target.label === "preset")
  //   rebuild();
  snow.update(toInner());
  snow.speed = commonOptions.speed;
});

/** background */
const background = pane.addFolder({title: "background", expanded: false});
background.addBinding(backgroundConfig, "showBanner", {label: "show banner"}).on("change", ({value}) => { mainContainer.style.display = value ? "block" : "none"; });
background.addBinding(backgroundConfig, "color").on("change", ({value}) => { snowContainer.style.backgroundColor = value; });
background.addBinding(backgroundConfig, "image").on("change", ({value}) => { snowContainer.style.backgroundImage = `url(${value})`; });
background.addBinding(backgroundConfig, "size").on("change", ({value}) => { snowContainer.style.backgroundSize = value; });
background.addBinding(backgroundConfig, "position").on("change", ({value}) => { snowContainer.style.backgroundPosition = value; });
background.addBinding(backgroundConfig, "repeat").on("change", ({value}) => { snowContainer.style.backgroundRepeat = value; });

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
  interface Element {
    webkitRequestFullscreen?(): void,
    mozRequestFullScreen?(): void,
    msRequestFullscreen?(): void,
  }
}

document.addEventListener("keydown", (event) => {
  if (event.code === "F11") {
    event.preventDefault();

    if (snowContainer.requestFullscreen !== undefined) {
      void snowContainer.requestFullscreen();
    } else if (snowContainer.webkitRequestFullscreen) {
      snowContainer.webkitRequestFullscreen();
    } else if (snowContainer.mozRequestFullScreen) {
      snowContainer.mozRequestFullScreen();
    } else if (snowContainer.msRequestFullscreen) {
      snowContainer.msRequestFullscreen();
    }
  }
});
