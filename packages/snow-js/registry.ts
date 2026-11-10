// The effect registry: every effect the library ships, in dropdown order.
import type {EffectDefinition, EffectInstance} from "./effect.ts";
import creation from "./creation/index.ts";
import noita from "./noita/index.ts";
import snow from "./snow/index.ts";

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

export function getEffect(key: string): EffectDefinition | undefined {
  if (!isEffectKey(key))
    return undefined;
  return EFFECTS[key];
}

// Known keys get options checked against the effect's own schema; any other
// string key (e.g. a host UI's dropdown) is accepted with the erased bag.
export function createEffect<K extends EffectKey>(
  el: Element,
  key: K | (string & {}),
  options?: Partial<OptionsForKey<K>>,
): EffectInstance {
  const ef = getEffect(key);
  if (ef === undefined)
    throw new RangeError(`Unknown effect: ${key}`);
  return ef.create(el, options);
}
