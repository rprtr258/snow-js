// Generic tweakpane form built from an effect definition's option specs.
// The host stays ignorant of individual effects: every control, default,
// range, visibility rule and action comes from the specs.
import type {FolderApi} from "tweakpane";
import {
  initialValues,
  type EffectDefinition,
  type EffectInstance,
  type KeyedSpec,
  type OptionValues,
  type SelectEntries,
} from "@rprtr258/snow-js";

type Blade = {hidden: boolean};
type Tracked = {spec: KeyedSpec, blade: Blade, baseHidden?: () => boolean};

function flatOptions(entries: SelectEntries, values: OptionValues): Record<string, string> {
  const resolved = typeof entries === "function" ? entries(values) : entries;
  const options: Record<string, string> = {};
  for (const item of resolved) {
    if ("value" in item) {
      options[item.label] = item.value;
    } else {
      for (const entry of item.entries)
        options[`${item.label} · ${entry.label}`] = entry.value;
    }
  }
  return options;
}

export function buildEffectForm(
  folder: FolderApi,
  def: EffectDefinition,
  instance: EffectInstance,
  onChange: (changed: OptionValues) => void,
): () => void {
  const values: OptionValues = initialValues(def);
  // UI mirrors for nullable colors: a checkbox plus a color picker collapse
  // into one string | null option value.
  const mirrors: Record<string, {enabled: boolean, color: string}> = {};
  const signatures: Record<string, string> = {};
  const tracked: Tracked[] = [];
  const disposers: (() => void)[] = [];
  let rebuildScheduled = false;
  let disposed = false;

  for (const spec of def.options) {
    if (spec.kind === "color" && spec.default === null)
      mirrors[spec.key] = {enabled: false, color: "#ffffff"};
  }

  function bindNumber(spec: Extract<KeyedSpec, {kind: "number"}>): void {
    const blade = folder.addBinding(values, spec.key, {
      label: spec.label,
      min: spec.min,
      max: spec.max,
      step: spec.integer === true ? 1 : spec.step,
    });
    blade.on("change", ({value}) => {
      values[spec.key] = value;
      handleChange(spec.key);
    });
    tracked.push({spec, blade});
    disposers.push(() => folder.remove(blade));
  }

  function bindBoolean(spec: Extract<KeyedSpec, {kind: "boolean"}>): void {
    const blade = folder.addBinding(values, spec.key, {label: spec.label});
    blade.on("change", ({value}) => {
      values[spec.key] = value;
      handleChange(spec.key);
    });
    tracked.push({spec, blade});
    disposers.push(() => folder.remove(blade));
  }

  function bindColor(spec: Extract<KeyedSpec, {kind: "color"}>): void {
    if (spec.default !== null) {
      const blade = folder.addBinding(values, spec.key, {label: spec.label});
      blade.on("change", ({value}) => {
        values[spec.key] = value;
        handleChange(spec.key);
      });
      tracked.push({spec, blade});
      disposers.push(() => folder.remove(blade));
      return;
    }
    const mirror = mirrors[spec.key];
    const checkbox = folder.addBinding(mirror, "enabled", {label: spec.label});
    const picker = folder.addBinding(mirror, "color", {label: spec.label});
    picker.hidden = true;
    checkbox.on("change", ({value}) => {
      mirror.enabled = value;
      values[spec.key] = value ? mirror.color : null;
      handleChange(spec.key);
    });
    picker.on("change", ({value}) => {
      mirror.color = value;
      if (mirror.enabled) {
        values[spec.key] = value;
        handleChange(spec.key);
      }
    });
    tracked.push({spec, blade: checkbox});
    tracked.push({spec, blade: picker, baseHidden: () => !mirror.enabled});
    disposers.push(() => folder.remove(checkbox));
    disposers.push(() => folder.remove(picker));
  }

  function bindSelect(spec: Extract<KeyedSpec, {kind: "select"}>): void {
    const options = flatOptions(spec.entries, values);
    signatures[spec.key] = JSON.stringify(options);
    const blade = folder.addBinding(values, spec.key, {label: spec.label, options});
    blade.on("change", ({value}) => {
      values[spec.key] = value;
      handleChange(spec.key);
    });
    tracked.push({spec, blade});
    disposers.push(() => folder.remove(blade));
  }

  function bindAction(spec: Extract<KeyedSpec, {kind: "action"}>): void {
    const button = folder.addButton({title: spec.label});
    button.on("click", () => spec.run(instance));
    disposers.push(() => folder.remove(button));
  }

  function addAll(): void {
    for (const opt of def.options) {
      switch (opt.kind) {
        case "number": bindNumber(opt); break;
        case "boolean": bindBoolean(opt); break;
        case "color": bindColor(opt); break;
        case "select": bindSelect(opt); break;
        case "action": bindAction(opt); break;
        default: opt satisfies never;
      }
    }
    applyVisibility();
  }

  // Dynamic selects may yield different choices (e.g. noita's effect list
  // depends on its collection); when they change, the form is rebuilt and an
  // out-of-date value resets to the first available entry.
  function resolveSelects(pending: OptionValues): void {
    for (const spec of def.options) {
      if (spec.kind !== "select" || typeof spec.entries !== "function")
        continue;
      const options = flatOptions(spec.entries, values);
      const signature = JSON.stringify(options);
      if (signatures[spec.key] === signature)
        continue;
      signatures[spec.key] = signature;
      scheduleRebuild();
      const current = values[spec.key];
      const first = Object.values(options)[0];
      if ((typeof current !== "string" || !Object.values(options).includes(current)) && first !== undefined) {
        values[spec.key] = first;
        pending[spec.key] = first;
      }
    }
  }

  function applyVisibility(): void {
    for (const {spec, blade, baseHidden} of tracked) {
      if (spec.kind === "action")
        continue;
      blade.hidden = (baseHidden?.() ?? false) || (spec.visible !== undefined && !spec.visible(values));
    }
  }

  function scheduleRebuild(): void {
    if (rebuildScheduled)
      return;
    rebuildScheduled = true;
    // Deferred: the rebuild disposes blades while a change event may still be
    // dispatching through one of them.
    setTimeout(() => {
      rebuildScheduled = false;
      if (disposed)
        return;
      for (const dispose of disposers)
        dispose();
      disposers.length = 0;
      tracked.length = 0;
      addAll();
    }, 0);
  }

  function handleChange(key: string): void {
    const pending: OptionValues = {[key]: values[key]};
    resolveSelects(pending);
    applyVisibility();
    onChange(pending);
  }

  addAll();

  return () => disposed = true;
}
