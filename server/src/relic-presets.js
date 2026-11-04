// The curated donated-relic visual catalog — a small, fixed vocabulary (the
// same "never free-form, always a known id" discipline as constants.js's
// SUBTYPES_BY_CATEGORY) of real illustrated relic appearances a donor picks
// for their exhibit. A preset is now REQUIRED for a NEW donation (db.js's
// donateExhibit rejects a missing visualId outright with "visual_required")
// — the old "Classic" no-preset procedural look is retired as a visitor-
// facing choice. The procedural renderer (public/world/artifacts.js) is
// kept only as a defensive fallback for an exhibit that predates this
// requirement (donated/seeded before the catalog existed, or the rare race
// of a row inserted between migrations) — see db.js's `backfillLegacyVisualIds`.
//
// Each entry is validated server-side on donation (never trust a client-
// supplied visualId blindly, same discipline as subtype/surfaceId): a
// visualId must both exist in this catalog AND be listed in its matching
// gallery/category's `compatibleSubtypes`, so a donor can never attach an
// portrait's appearance to a toy-gallery donation.
//
// `naturalWidth`/`naturalHeight` are the source asset's own pixel
// dimensions (used to preserve aspect ratio client-side — CLAUDE.md-aligned
// brief: "do not stretch assets"); `anchor` describes how the asset's own
// artwork should be anchored against a placement surface ("wall" art reads
// as hanging, centred on the surface; "resting" art's own visual base sits
// at the surface's own point, like an object standing on a shelf).
// Each preset names exactly one subtype (never a list) — choosing a preset
// in the donor's visual picker IS choosing the relic's subtype, so the donor
// never juggles two separate, potentially-contradictory controls for "what
// is this" and "what does it look like."
export const RELIC_PRESETS = [
  {
    id: "cursed-gilt-portrait",
    name: "The Cursed Gilt Portrait",
    category: "portrait",
    subtype: "painting",
    compatibleSurfaceTypes: ["wall"],
    assetPath: "/assets/donated-relics/cursed-gilt-portrait.png",
    naturalWidth: 600,
    naturalHeight: 900,
    anchor: "wall",
    defaultScale: 1,
  },
  {
    id: "lunar-music-box",
    name: "The Lunar Music Box",
    category: "memento",
    subtype: "curiosity",
    compatibleSurfaceTypes: ["shelf", "tabletop", "cabinet"],
    assetPath: "/assets/donated-relics/lunar-music-box.png",
    naturalWidth: 900,
    naturalHeight: 600,
    anchor: "resting",
    defaultScale: 1,
  },
  {
    id: "impossible-botanical-jar",
    name: "The Impossible Botanical Jar",
    category: "specimen",
    subtype: "botanical",
    compatibleSurfaceTypes: ["cabinet", "shelf", "plinth"],
    assetPath: "/assets/donated-relics/impossible-botanical-jar.png",
    naturalWidth: 600,
    naturalHeight: 900,
    anchor: "resting",
    defaultScale: 1,
  },
  {
    id: "burgundy-porcelain-doll",
    name: "The Burgundy Porcelain Doll",
    category: "toy",
    subtype: "doll",
    compatibleSurfaceTypes: ["shelf", "tabletop", "plinth"],
    assetPath: "/assets/donated-relics/burgundy-porcelain-doll.png",
    naturalWidth: 900,
    naturalHeight: 822,
    anchor: "resting",
    defaultScale: 1,
  },
  // Eight presets below added so every one of the twelve fixed subtypes
  // (SUBTYPES_BY_CATEGORY in constants.js) has a curated look, not just the
  // original four — one preset per previously-uncovered subtype. Generated
  // via tools/generate-relic-assets.py (Pollinations + hue-based background
  // removal); see ASSETS.md for prompts/provenance.
  {
    id: "unfinished-charcoal-study",
    name: "The Unfinished Charcoal Study",
    category: "portrait",
    subtype: "sketch",
    compatibleSurfaceTypes: ["wall"],
    assetPath: "/assets/donated-relics/unfinished-charcoal-study.png",
    naturalWidth: 563,
    naturalHeight: 589,
    anchor: "wall",
    defaultScale: 1,
  },
  {
    id: "tarnished-silver-spoon",
    name: "The Tarnished Silver Spoon",
    category: "memento",
    subtype: "spoon",
    compatibleSurfaceTypes: ["shelf", "cabinet", "tabletop"],
    assetPath: "/assets/donated-relics/tarnished-silver-spoon.png",
    naturalWidth: 202,
    naturalHeight: 673,
    anchor: "resting",
    defaultScale: 1,
  },
  {
    id: "key-that-opens-nothing",
    name: "The Key That Opens Nothing",
    category: "memento",
    subtype: "key",
    compatibleSurfaceTypes: ["shelf", "cabinet", "tabletop"],
    assetPath: "/assets/donated-relics/key-that-opens-nothing.png",
    naturalWidth: 250,
    naturalHeight: 559,
    anchor: "resting",
    defaultScale: 1,
  },
  {
    id: "clock-that-keeps-no-hour",
    name: "A Clock That Keeps No Hour",
    category: "memento",
    subtype: "clock",
    compatibleSurfaceTypes: ["shelf", "cabinet", "tabletop"],
    assetPath: "/assets/donated-relics/clock-that-keeps-no-hour.png",
    naturalWidth: 658,
    naturalHeight: 731,
    anchor: "resting",
    defaultScale: 1,
  },
  {
    id: "fogged-hand-mirror",
    name: "The Fogged Hand Mirror",
    category: "memento",
    subtype: "mirror",
    compatibleSurfaceTypes: ["shelf", "cabinet", "tabletop"],
    assetPath: "/assets/donated-relics/fogged-hand-mirror.png",
    naturalWidth: 550,
    naturalHeight: 661,
    anchor: "resting",
    defaultScale: 1,
  },
  {
    id: "articulated-raven-skeleton",
    name: "The Articulated Raven Skeleton",
    category: "specimen",
    subtype: "biological",
    compatibleSurfaceTypes: ["cabinet", "shelf", "plinth"],
    assetPath: "/assets/donated-relics/articulated-raven-skeleton.png",
    naturalWidth: 280,
    naturalHeight: 481,
    anchor: "resting",
    defaultScale: 1,
  },
  {
    id: "clockwork-tin-soldier",
    name: "The Clockwork Tin Soldier",
    category: "toy",
    subtype: "toy",
    compatibleSurfaceTypes: ["shelf", "tabletop", "plinth"],
    assetPath: "/assets/donated-relics/clockwork-tin-soldier.png",
    naturalWidth: 439,
    naturalHeight: 558,
    anchor: "resting",
    defaultScale: 1,
  },
  {
    id: "locked-nursery-diary",
    name: "The Locked Nursery Diary",
    category: "toy",
    subtype: "book",
    compatibleSurfaceTypes: ["shelf", "cabinet", "tabletop"],
    assetPath: "/assets/donated-relics/locked-nursery-diary.png",
    naturalWidth: 546,
    naturalHeight: 658,
    anchor: "resting",
    defaultScale: 1,
  },
];

export const RELIC_PRESETS_BY_ID = new Map(RELIC_PRESETS.map((p) => [p.id, p]));

// Every preset compatible with a given category (+ optionally a surface
// type) — exactly the filtering a donor's visual picker needs, and exactly
// what the server re-derives to validate a donation's claimed visualId
// rather than trusting the client's own filter.
export function presetsFor(category, surfaceType) {
  return RELIC_PRESETS.filter(
    (p) => p.category === category && (!surfaceType || p.compatibleSurfaceTypes.includes(surfaceType)),
  );
}

export function isValidVisualChoice(visualId, category, subtype, surfaceType) {
  const preset = RELIC_PRESETS_BY_ID.get(visualId);
  if (!preset) return false;
  return preset.category === category && preset.subtype === subtype && preset.compatibleSurfaceTypes.includes(surfaceType);
}
