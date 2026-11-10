// Public API: the effect registry and the schema vocabulary effects and hosts
// share. Each effect lives in <name>/ and is registered in
// registry.ts; hosts render forms from option specs and drive instances.
import {action, bool, color, defineEffect, initialValues, num, select} from "./effect.ts";
import {createEffect, EFFECTS, getEffect, type EffectKey} from "./registry.ts";

export {action, bool, color, defineEffect, initialValues, num, select};
export {createEffect, EFFECTS, getEffect};
export type {EffectKey};
export type {
  ActionSpec,
  BooleanSpec,
  ColorSpec,
  EffectDefinition,
  EffectInstance,
  InferOptions,
  InferValue,
  KeyedSpec,
  NumberSpec,
  OptionSpec,
  OptionValues,
  SelectEntries,
  SelectEntry,
  SelectGroup,
  SelectSpec,
} from "./effect.ts";
