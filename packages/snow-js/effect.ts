// Effect abstraction: every visual effect is a definition carrying its own
// typed options schema. Hosts (the website, or any consumer) render forms and
// drive instances purely from the specs; effects own their implementation.

export type SelectEntry<V extends string = string> = {value: V, label: string};
export type SelectGroup<V extends string = string> = {label: string, entries: SelectEntry<V>[]};
// Select choices, optionally grouped; a function recomputes them from the
// current values (e.g. noita's effect list depends on its collection).
export type SelectEntries<V extends string = string> =
  | SelectEntry<V>[]
  | SelectGroup<V>[]
  | ((values: OptionValues) => SelectEntry<V>[] | SelectGroup<V>[]);

// The erased value bag shared by every effect: what a host form edits.
export type OptionValues = Record<string, number | boolean | string | null>;

type Visible = (values: OptionValues) => boolean;

export type NumberSpec = {
  kind: "number",
  label: string,
  default: number,
  min?: number,
  max?: number,
  step?: number,
  integer?: boolean,
  visible?: Visible,
};
export type BooleanSpec = {
  kind: "boolean",
  label: string,
  default: boolean,
  visible?: Visible,
};
// Null default = nullable: the host form renders a checkbox plus a picker and
// the value becomes null when unchecked.
export type ColorSpec<Default extends string | null = string | null> = {
  kind: "color",
  label: string,
  default: Default,
  visible?: Visible,
};
export type SelectSpec<V extends string = string> = {
  kind: "select",
  label: string,
  default: V,
  entries: SelectEntries<V>,
  visible?: Visible,
};
// A form button, not a value: the host renders it and forwards clicks.
export type ActionSpec = {
  kind: "action",
  label: string,
  run: (instance: EffectInstance) => void,
};
export type OptionSpec = NumberSpec | BooleanSpec | ColorSpec | SelectSpec | ActionSpec;
export type KeyedSpec = OptionSpec & {key: string};
export type OptionsSchema = Record<string, OptionSpec>;

export type InferValue<S> = S extends {kind: "action"} ? never
  : S extends {default: infer D} ? D
  : never;
// The plain values struct a lib user fills, inferred from a schema object.
export type InferOptions<S> = {
  [K in keyof S as InferValue<S[K]> extends never ? never : K]: InferValue<S[K]>
};

export type EffectInstance = {
  start(): void,
  stop(): void,
  update(options: Partial<OptionValues>): void,
  restart?(): void,
  unmount(): void,
};

export type EffectDefinition<O extends OptionValues = OptionValues> = {
  label: string,
  group: string,
  description?: string,
  options: KeyedSpec[],
  create(el: Element, options?: Partial<O>): EffectInstance,
};

export function num(value: number, opts: Omit<NumberSpec, "kind" | "default">): NumberSpec {
  return {kind: "number", default: value, ...opts};
}
export function bool(value: boolean, opts: Omit<BooleanSpec, "kind" | "default">): BooleanSpec {
  return {kind: "boolean", default: value, ...opts};
}
export function color<T extends string | null>(value: T, opts: Omit<ColorSpec, "kind" | "default">): ColorSpec<T> {
  return {kind: "color", default: value, ...opts};
}
export function select<V extends string>(value: V, opts: Omit<SelectSpec<V>, "kind" | "default">): SelectSpec<V> {
  return {kind: "select", default: value, ...opts};
}
export function action(label: string, run: (instance: EffectInstance) => void): ActionSpec {
  return {kind: "action", label, run};
}

// Schema → plain values bridge (spec defaults keyed by option key).
function resolveDefaults<S extends OptionsSchema>(options: S): InferOptions<S> {
  const values: Record<string, number | boolean | string | null> = {};
  for (const [key, spec] of Object.entries(options)) {
    if (spec.kind === "action")
      continue;
    values[key] = spec.default;
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the schema types guarantee every entry matches its spec's default type
  return values as InferOptions<S>;
}

// Initial option values for a definition, for hosts that build forms.
export function initialValues(def: Pick<EffectDefinition, "options">): OptionValues {
  const schema: Record<string, OptionSpec> = Object.fromEntries(
    def.options.map((spec) => [spec.key, spec]),
  );
  return resolveDefaults(schema);
}

export function defineEffect<S extends OptionsSchema>(def: {
  label: string,
  group?: string,
  description?: string,
  options: S,
  create(el: Element, options: InferOptions<S>): EffectInstance,
}): EffectDefinition<InferOptions<S>> {
  const options: KeyedSpec[] = Object.entries(def.options).map(([key, spec]) => ({...spec, key}));
  const defaults = resolveDefaults(def.options);
  return {
    label: def.label,
    group: def.group ?? "",
    description: def.description,
    options,
    create: (el, values = {}) => def.create(el, {...defaults, ...values}),
  };
}
