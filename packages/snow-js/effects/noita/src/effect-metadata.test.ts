import {expect, test} from "bun:test";
import {CATALOG_EFFECTS} from "./effect-metadata.ts";
import type {Catalog} from "./types.ts";

test("effect metadata matches the checked-in catalog", async () => {
  const catalog: Catalog = await Bun.file(
    new URL("../static/assets/effects.json", import.meta.url),
  ).json();
  expect(Object.keys(catalog.effects).sort()).toEqual(
    CATALOG_EFFECTS.map((meta) => meta.key).sort(),
  );
  for (const meta of CATALOG_EFFECTS) {
    const effect = catalog.effects[meta.key]!;
    expect(effect.label).toBe(meta.label);
    expect(effect.group).toBe(meta.group);
  }
});
