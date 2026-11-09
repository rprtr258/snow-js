// The effect registry: every effect the library ships, in dropdown order.
import type {EffectDefinition, EffectInstance, OptionValues} from "./effect.ts";
import creation from "./effects/creation/index.ts";
import noita from "./effects/noita/index.ts";
import snow from "./effects/snow/index.ts";

export const EFFECTS = {
  snow,
  creation,
  noita,
};

export type EffectKey = (keyof typeof EFFECTS);
type DefinitionForKey<K extends EffectKey> = (typeof EFFECTS)[K];
type OptionsForKey<K extends EffectKey> = DefinitionForKey<K> extends EffectDefinition<infer Options> ? Options : never;

// Narrows a dynamic key to the registry's keys without a type assertion.
function isEffectKey(key: string): key is EffectKey {
  return key in EFFECTS;
}

// Typed overload: options are checked against the effect's own schema.
export function createEffect<K extends EffectKey>(el: Element, key: K, options?: Partial<OptionsForKey<K>>): EffectInstance;
// Erased overload for dynamic keys (e.g. a host UI's dropdown).
export function createEffect(el: Element, key: string, options?: Partial<OptionValues>): EffectInstance;
export function createEffect(el: Element, key: string, options?: Partial<OptionValues>): EffectInstance {
  if (!isEffectKey(key))
    throw new RangeError(`Unknown effect: ${key}`);
  const definition: EffectDefinition = EFFECTS[key];
  return definition.create(el, options);
}

export function getEffect(key: string): EffectDefinition | undefined {
  if (!isEffectKey(key))
    return undefined;
  return EFFECTS[key];
}
