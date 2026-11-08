// Background music for the museum: a single licensed audio track, looped,
// played through an HTMLAudioElement — see ASSETS.md for the track's title,
// creator, and source link. (An earlier version of this module synthesized
// its own ambience purely from Web Audio oscillators/noise so no audio file
// needed crediting at all; that approach was replaced with a real music
// track at the project owner's direction, so this file now credits its
// source the same way every other illustrated asset in ASSETS.md does.)
//
// Hard requirements this module still exists to satisfy (CLAUDE.md-adjacent
// brief, carried over from the previous version): never start audio before
// a real user gesture — `audio.play()` is only ever called from inside a
// genuine click/keydown handler, never on page load, never from a restored
// preference alone; a clear on/off control; the preference persists in
// localStorage; paused (not just silent) while the page is hidden, to avoid
// wasted decode/playback work on an unseen tab; and no interference with
// screen-reader or keyboard use.
//
// The default preference is now "on" (previously "off"): a visitor who has
// never chosen either way gets music starting on their very first gesture
// on the page, not silence until they find the toggle. An explicit choice
// (via the toggle) is always respected on return visits.

const STORAGE_KEY = "cursedMuseumAmbientOn";
const TRACK_URL = "/assets/audio/museum-ambient-theme.m4a";
const VOLUME = 0.35; // audible background music, not a buried atmosphere layer

function readPreference() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // No stored choice yet → default on. Only an explicit "0" (the visitor
    // used the toggle to turn it off) opts out.
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

function writePreference(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // private browsing / blocked storage — the preference just won't survive reload
  }
}

export function createAmbientSoundscape() {
  let audio = null;
  let on = false;
  let suspendedForHidden = false;

  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio(TRACK_URL);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = VOLUME;
    return audio;
  }

  function start() {
    if (on) return;
    on = true;
    writePreference(true);
    ensureAudio();
    audio.play().catch(() => {
      // Playback was refused (e.g. this wasn't actually inside a trusted
      // gesture after all) — reflect reality rather than claiming "on"
      // while nothing is audible.
      on = false;
    });
  }

  function stop() {
    if (!on) return;
    on = false;
    writePreference(false);
    if (audio) audio.pause();
  }

  function toggle() {
    if (on) stop();
    else start();
    return on;
  }

  // A single music track has no per-gallery tonal variation to retune; kept
  // as a no-op so existing call sites (scene-change, toggle click) don't
  // need to change.
  function setGallery() {}

  // While the tab is hidden, pause playback entirely so no decode/output
  // work runs on an unseen page — resumes automatically if the visitor had
  // it on when they return.
  document.addEventListener("visibilitychange", () => {
    if (!audio) return;
    if (document.hidden) {
      if (on && !audio.paused) {
        suspendedForHidden = true;
        audio.pause();
      }
    } else if (suspendedForHidden) {
      suspendedForHidden = false;
      if (on) audio.play().catch(() => {});
    }
  });

  return {
    toggle,
    start,
    stop,
    setGallery,
    get isOn() {
      return on;
    },
    get wasPreferredOn() {
      return readPreference();
    },
  };
}
