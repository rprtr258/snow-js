// Static metadata for the effects that live in the checked-in catalog
// (static/assets/effects.json). Keeps the effect registry synchronous; the
// consistency with the catalog is guarded by effect-metadata.test.ts.
export type CatalogEffectMeta = {key: string; label: string};

export const CATALOG_GROUP_LABELS: Record<string, string> = {
  objects: "Objects & ambient effects",
  images: "Image-driven effects",
};

export const CATALOG_EFFECTS: Record<string, CatalogEffectMeta[]> = {
  "objects": [
    {key: "red_portal", label: "Red portal"},
    {key: "evil_eye", label: "Evil Eye"},
    {key: "orb_of_power", label: "Orb of Power"},
    {key: "dark_sun", label: "Dark Sun"},
    {key: "moon", label: "Moon"},
    {key: "treasure_chest", label: "Treasure chest"},
    {key: "perk_reroll", label: "Perk reroll"},
  ],
  "images": [
    {key: "img_heart", label: "Heart pickup"},
    {key: "img_chest", label: "Chest effect"},
    {key: "img_orb", label: "Orb pickup"},
    {key: "img_wand", label: "Wand pickup"},
    {key: "img_potion", label: "Potion pickup"},
    {key: "img_spell_refresh", label: "Spell refresh"},
    {key: "img_hourglass", label: "Hourglass image animation"},
    {key: "img_heart_fullhp", label: "Full-health heart"},
    {key: "img_chest_bad", label: "Bad chest"},
    {key: "img_acid_gas", label: "Acid gas cloud"},
    {key: "img_altar_curse", label: "Altar curse symbol"},
    {key: "img_magical_symbol", label: "Magical symbol"},
    {key: "img_magical_symbol_fast", label: "Magical symbol · fast"},
    {key: "img_perk_effect", label: "Perk pickup"},
    {key: "img_perk_pacifist", label: "Pacifist perk"},
    {key: "img_player_disappear_right", label: "Player disappear · right"},
    {key: "img_player_disappear_left", label: "Player disappear · left"},
    {key: "img_safe_haven", label: "Safe haven"},
    {key: "img_shop_effect", label: "Shop item effect"},
    {key: "img_transmutation", label: "Transmutation"},
    {key: "img_image_explosion", label: "Image explosion"},
  ],
};
