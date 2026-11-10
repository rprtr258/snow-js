import {expect, test} from "bun:test";
import {CATALOG} from "./catalog.ts";
import {CATALOG_EFFECTS} from "./effect-metadata.ts";

test("effect metadata matches the checked-in catalog", () => {
  expect(Object.keys(CATALOG.effects).sort()).toEqual(Object.values(CATALOG_EFFECTS).flatMap(xs => xs).map(meta => meta.key).sort());
  for (const meta of Object.entries(CATALOG_EFFECTS).flatMap(([g, es]) => es.map(e => ({...e, group: g})))) {
    const effect = CATALOG.effects[meta.key]!;
    expect(effect.label).toBe(meta.label);
    expect(effect.group).toBe(meta.group);
  }
});
