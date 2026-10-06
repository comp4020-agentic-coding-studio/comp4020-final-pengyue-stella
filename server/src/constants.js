// Shared, small, deliberately fixed. A trace is one of these kinds — no
// free-form category text, so composing a trace is picking a vibe and typing
// a line, not filling in a form.
export const TRACE_TYPES = [
  { id: "tip", emoji: "💡", label: "Tip" },
  { id: "memory", emoji: "🧡", label: "Memory" },
  { id: "story", emoji: "📖", label: "Story" },
  { id: "spark", emoji: "✨", label: "Spark" },
];

export const TRACE_TYPE_IDS = new Set(TRACE_TYPES.map((t) => t.id));

export function emojiForType(typeId) {
  return TRACE_TYPES.find((t) => t.id === typeId)?.emoji ?? "💬";
}

export const MAX_BODY_LENGTH = 240;

// One trace per visitor per this many milliseconds — cheap spam guard, not a
// moderation system.
export const POST_COOLDOWN_MS = 3000;
