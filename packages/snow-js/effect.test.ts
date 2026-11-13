import {describe, expect, expectTypeOf, test} from "bun:test";
import {action, bool, color, defineEffect, initialValues, num, select, type InferOptions} from "./effect.ts";

const schema = {
  speed: num(10, {label: "speed", min: 0, max: 20}),
  isDark: bool(true, {label: "isDark"}),
  tint: color(null, {label: "tint"}),
  mode: select<string>("a", {label: "mode", entries: [{value: "a", label: "A"}, {value: "b", label: "B"}]}),
  go: action("go", () => {}),
};
type TestOptions = InferOptions<typeof schema>;

describe("defineEffect", () => {
  const def = defineEffect({
    label: "Test",
    options: schema,
    create: () => ({start() {}, stop() {}, update() {}}),
  });

  test("injects keys in schema order", () => {
    expect(def.options.map((spec) => spec.key)).toEqual(["speed", "isDark", "tint", "mode", "go"]);
  });

  test("initial values come from spec defaults, actions excluded", () => {
    expect(initialValues(def)).toEqual({speed: 10, isDark: true, tint: null, mode: "a"});
  });

  test("InferOptions maps specs to plain values", () => {
    const check: TestOptions = {speed: 1, isDark: false, tint: null, mode: "b"};
    expectTypeOf(check).toEqualTypeOf<TestOptions>();
  });
});
