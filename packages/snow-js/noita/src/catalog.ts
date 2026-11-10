// The checked-in catalog (static/assets/effects.json), statically imported
// and shared by every consumer; the effect data (effects.bin) is decoded per
// viewer from the embedded base64 because the runtime takes ownership of it.
import catalogJson from "../static/assets/effects.json";
import type { Catalog } from "./types";

export const CATALOG = catalogJson as Catalog;
