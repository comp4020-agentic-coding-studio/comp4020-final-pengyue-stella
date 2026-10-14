// Shared, small, deliberately fixed — the museum's fixed vocabulary.

// A gallery's exhibits are all one category; this keeps "which gallery does
// this donation belong in" always unambiguous, no free-form taxonomy.
export const GALLERY_CATEGORY = {
  portraits: "portrait",
  memento: "memento",
  specimen: "specimen",
  childhood: "toy",
};

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

// Movement reports: bounded frequency and size. A visitor who posts faster
// than this is simply dropped until the window passes — the server stays
// authoritative over what it relays, never over how fast a client *tries*
// to post.
export const MOVE_MIN_INTERVAL_MS = 80;
