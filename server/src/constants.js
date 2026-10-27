// Shared, small, deliberately fixed — the museum's fixed vocabulary.

// A gallery's exhibits are all one category; this keeps "which gallery does
// this donation belong in" always unambiguous, no free-form taxonomy.
export const GALLERY_CATEGORY = {
  portraits: "portrait",
  memento: "memento",
  specimen: "specimen",
  childhood: "toy",
};

// Within a category, a donor also picks a subtype — which bespoke artifact
// model family (see public/world/scene.js's ARTIFACT_BUILDERS) their relic
// is built from. Kept as a fixed, small vocabulary per category (not
// free-form) for the same reason GALLERY_CATEGORY is fixed: the server can
// validate a donation's subtype against its gallery without a client ever
// being trusted to supply one the scene has no model for.
export const SUBTYPES_BY_CATEGORY = {
  portrait: ["painting", "sketch"],
  memento: ["spoon", "key", "clock", "mirror", "curiosity"],
  specimen: ["botanical", "biological", "curiosity"],
  toy: ["doll", "toy", "book"],
};
export const SUBTYPE_SET = new Set(Object.values(SUBTYPES_BY_CATEGORY).flat());

export const ACCOUNT_KINDS = [
  "original",
  "testimony",
  "contradiction",
  "revision",
  "counter-evidence",
];
export const ACCOUNT_KIND_SET = new Set(ACCOUNT_KINDS);

export const VERDICTS = ["Believable", "Suspicious", "Definitely Cursed"];
export const VERDICT_SET = new Set(VERDICTS);

export const MAX_NAME_LENGTH = 40;
export const MAX_TITLE_LENGTH = 80;
export const MAX_ACCOUNT_LENGTH = 600;
export const MAX_CLAIM_LENGTH = 240;

// Cheap per-visitor spam guard, not a moderation system.
export const DONATE_COOLDOWN_MS = 4000;
export const ACCOUNT_COOLDOWN_MS = 2000;
// Shared between PATCH (edit) and DELETE on an owned exhibit — both are rare,
// deliberate actions, so one shared cooldown (not two) is enough to stop a
// rapid-fire retry loop without being a real obstacle to normal use.
export const EXHIBIT_EDIT_COOLDOWN_MS = 2000;

// Scene-presence reports: bounded frequency. A visitor who posts faster
// than this is simply dropped until the window passes — the server stays
// authoritative over what it relays, never over how fast a client *tries*
// to post. Scene navigation is a discrete, infrequent action (not a
// per-frame stream like the old continuous movement was), so this floor is
// generous, not a performance-critical rate limit.
export const PRESENCE_MIN_INTERVAL_MS = 150;

// A visitor focusing/opening an interactive object (hover-dwell, click, or
// keyboard focus) is a lightweight ephemeral signal for "other visitors in
// this room see that silhouette turn/pulse and the object briefly glow" —
// never raw cursor coordinates, never a new field of personal information.
// Throttled the same way scene-presence is, generously, since this is still
// a discrete per-interaction event, not a per-frame stream.
export const FOCUS_MIN_INTERVAL_MS = 150;

// The Séance panel's fixed, small reaction vocabulary (POST
// /api/presence/interact with { kind: "reaction", reactionId }) — a client
// can never send free-form reaction text, only one of these ids, the same
// "fixed vocabulary, not free text" discipline ACCOUNT_KINDS/VERDICTS
// already apply elsewhere. Kept small and Gothic-appropriate rather than a
// generic emoji picker. `label` is what the client renders via textContent
// (never innerHTML) in the reaction picker and in the animated cue the
// recipient sees.
export const REACTIONS = [
  { id: "wave", label: "Wave" },
  { id: "bow", label: "Bow" },
  { id: "candle", label: "🕯️ Offer a candle" },
  { id: "heart", label: "❤️ Fond regard" },
  { id: "gasp", label: "😮 Gasp" },
];
export const REACTION_ID_SET = new Set(REACTIONS.map((r) => r.id));

export const MAX_INTERACTION_MESSAGE_LENGTH = 160;

// Ephemeral, per-sender Séance cooldowns (never persisted — see sse.js's
// broadcastToRoom doc comment). A reaction/reach-out is a single click
// with no typing involved, so it gets a short floor purely against an
// accidental or deliberate rapid-fire double-send; a message takes actual
// typing to produce, so its own floor is a little longer, matching the
// existing DONATE/ACCOUNT_COOLDOWN_MS "typed content gets a longer cooldown
// than a one-click action" pattern already used elsewhere in this file.
// Deliberately its own constant, never reused from FOCUS_MIN_INTERVAL_MS —
// CLAUDE.md's "a dedupe/seen-set is scoped to one concern" lesson applies
// just as much to a cooldown Map as to a seen-set: focus and Séance
// interactions are two different concerns and must never share one clock.
export const INTERACTION_REACTION_COOLDOWN_MS = 600;
export const INTERACTION_MESSAGE_COOLDOWN_MS = 1500;
