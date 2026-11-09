// Static metadata for the effects that live in the checked-in catalog
// (static/assets/effects.json). Keeps the effect registry synchronous; the
// consistency with the catalog is guarded by effect-metadata.test.ts.
export type CatalogEffectMeta = {key: string; label: string; group: string};

export const CATALOG_GROUP_LABELS: Record<string, string> = {
  objects: "Objects & ambient effects",
  images: "Image-driven effects",
};

export const CATALOG_EFFECTS: CatalogEffectMeta[] = [
  {key: "red_portal", label: "Red portal", group: "objects"},
  {key: "evil_eye", label: "Evil Eye", group: "objects"},
  {key: "orb_of_power", label: "Orb of Power", group: "objects"},
  {key: "dark_sun", label: "Dark Sun", group: "objects"},
  {key: "moon", label: "Moon", group: "objects"},
  {key: "treasure_chest", label: "Treasure chest", group: "objects"},
  {key: "perk_reroll", label: "Perk reroll", group: "objects"},
  {key: "img_heart", label: "Heart pickup", group: "images"},
  {key: "img_chest", label: "Chest effect", group: "images"},
  {key: "img_orb", label: "Orb pickup", group: "images"},
  {key: "img_wand", label: "Wand pickup", group: "images"},
  {key: "img_potion", label: "Potion pickup", group: "images"},
  {key: "img_spell_refresh", label: "Spell refresh", group: "images"},
  {key: "img_hourglass", label: "Hourglass image animation", group: "images"},
  {key: "img_heart_fullhp", label: "Full-health heart", group: "images"},
  {key: "img_chest_bad", label: "Bad chest", group: "images"},
  {key: "img_acid_gas", label: "Acid gas cloud", group: "images"},
  {key: "img_altar_curse", label: "Altar curse symbol", group: "images"},
  {key: "img_magical_symbol", label: "Magical symbol", group: "images"},
  {key: "img_magical_symbol_fast", label: "Magical symbol · fast", group: "images"},
  {key: "img_perk_effect", label: "Perk pickup", group: "images"},
  {key: "img_perk_pacifist", label: "Pacifist perk", group: "images"},
  {key: "img_player_disappear_right", label: "Player disappear · right", group: "images"},
  {key: "img_player_disappear_left", label: "Player disappear · left", group: "images"},
  {key: "img_safe_haven", label: "Safe haven", group: "images"},
  {key: "img_shop_effect", label: "Shop item effect", group: "images"},
  {key: "img_transmutation", label: "Transmutation", group: "images"},
  {key: "img_image_explosion", label: "Image explosion", group: "images"},
];
