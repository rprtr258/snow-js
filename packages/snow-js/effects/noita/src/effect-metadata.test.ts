import {expect, test} from "bun:test";
import {CATALOG} from "./catalog.ts";
import {CATALOG_EFFECTS} from "./effect-metadata.ts";

test("effect metadata matches the checked-in catalog", () => {
  expect(Object.keys(CATALOG.effects).sort()).toEqual(
    CATALOG_EFFECTS.map((meta) => meta.key).sort(),
  );
  for (const meta of CATALOG_EFFECTS) {
    const effect = CATALOG.effects[meta.key]!;
    expect(effect.label).toBe(meta.label);
    expect(effect.group).toBe(meta.group);
  }
});
