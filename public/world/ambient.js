// A small, original, procedural ambient soundscape — a low drone, occasional
// distant metallic chimes, and rare filtered-noise creaks — built entirely
// from Web Audio oscillators/noise buffers so no copyrighted audio file is
// ever introduced (CLAUDE.md's zero-runtime-dependency stance applies to
// audio assets too, not just npm packages). Each gallery gets a slightly
// different drone pitch/chime timbre (derived from its own accent colour,
// so no new per-gallery audio data is needed) for "different tonal
// variation per gallery" without a single new server field.
//
// Hard requirements this module exists to satisfy (CLAUDE.md-adjacent
// brief): never start audio before a real user gesture (AudioContext is
// only ever constructed inside a click handler); a clear on/off control;
// the preference persists in localStorage; restrained starting volume;
// paused (not just silent) while the page is hidden, to avoid burning CPU
// on an unseen tab; and no interference with screen-reader or keyboard use
// — the toggle is a plain, already-focusable `<button>`, and nothing here
// ever steals focus or announces itself audibly without the visitor having
// explicitly turned it on.

const STORAGE_KEY = "cursedMuseumAmbientOn";
const MASTER_VOLUME = 0.16; // restrained — this is atmosphere, not a soundtrack
const DRONE_VOLUME = 0.5; // relative to MASTER_VOLUME
const CHIME_MIN_INTERVAL_MS = 9000;
const CHIME_MAX_INTERVAL_MS = 22000;
const CREAK_MIN_INTERVAL_MS = 16000;
const CREAK_MAX_INTERVAL_MS = 40000;

// Deterministic per-gallery tonal variation from the gallery's own id, so no
// new server data is needed and the mapping is stable across sessions.
function hashSeed(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function toneFor(galleryId) {
  const seed = hashSeed(galleryId ?? "hall");
  const dronePitch = 42 + (seed % 7); // low, near-infrasonic hum, Hz
  const chimePitch = 740 + (seed % 11) * 35; // a distant, faint metallic chime
  return { dronePitch, chimePitch };
}

function readPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
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
  let ctx = null;
  let masterGain = null;
  let droneGain = null;
  let droneOsc = null;
  let droneOsc2 = null;
  let chimeTimer = null;
  let creakTimer = null;
  let on = false;
  let currentGalleryId = null;
  let suspendedForHidden = false;

  function scheduleChime() {
    const delay = CHIME_MIN_INTERVAL_MS + Math.random() * (CHIME_MAX_INTERVAL_MS - CHIME_MIN_INTERVAL_MS);
    chimeTimer = window.setTimeout(() => {
      playChime();
      scheduleChime();
    }, delay);
  }

  function scheduleCreak() {
    const delay = CREAK_MIN_INTERVAL_MS + Math.random() * (CREAK_MAX_INTERVAL_MS - CREAK_MIN_INTERVAL_MS);
    creakTimer = window.setTimeout(() => {
      playCreak();
      scheduleCreak();
    }, delay);
  }

  function playChime() {
    if (!ctx || !on) return;
    const { chimePitch } = toneFor(currentGalleryId);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = chimePitch * (0.97 + Math.random() * 0.06);
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.5);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 3.6);
  }

  function playCreak() {
    if (!ctx || !on) return;
    // A short burst of filtered noise — a distant creak/groan, not a click.
    const duration = 0.9 + Math.random() * 0.6;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 180 + Math.random() * 120;
    filter.Q.value = 4;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.045, now + duration * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    noise.start(now);
    noise.stop(now + duration);
  }

  function retuneDrone() {
    if (!ctx || !droneOsc || !droneOsc2) return;
    const { dronePitch } = toneFor(currentGalleryId);
    const now = ctx.currentTime;
    droneOsc.frequency.linearRampToValueAtTime(dronePitch, now + 2.5);
    droneOsc2.frequency.linearRampToValueAtTime(dronePitch * 1.5, now + 2.5);
  }

  function buildGraph() {
    masterGain = ctx.createGain();
    masterGain.gain.value = 0; // fades in once started, never a hard start
    masterGain.connect(ctx.destination);

    droneGain = ctx.createGain();
    droneGain.gain.value = DRONE_VOLUME;
    droneGain.connect(masterGain);

    const { dronePitch } = toneFor(currentGalleryId);
    droneOsc = ctx.createOscillator();
    droneOsc.type = "sine";
    droneOsc.frequency.value = dronePitch;
    droneOsc2 = ctx.createOscillator();
    droneOsc2.type = "triangle";
    droneOsc2.frequency.value = dronePitch * 1.5;
    const droneOsc2Gain = ctx.createGain();
    droneOsc2Gain.gain.value = 0.35;

    droneOsc.connect(droneGain);
    droneOsc2.connect(droneOsc2Gain);
    droneOsc2Gain.connect(droneGain);

    droneOsc.start();
    droneOsc2.start();
  }

  function start() {
    if (on) return;
    on = true;
    writePreference(true);
    if (!ctx) {
      ctx = new (window.AudioContext ?? window.webkitAudioContext)();
      buildGraph();
    }
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(MASTER_VOLUME, now + 1.2);
    scheduleChime();
    scheduleCreak();
  }

  function stop() {
    if (!on) return;
    on = false;
    writePreference(false);
    if (ctx && masterGain) {
      const now = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(0, now + 0.6);
    }
    if (chimeTimer) window.clearTimeout(chimeTimer);
    if (creakTimer) window.clearTimeout(creakTimer);
    chimeTimer = null;
    creakTimer = null;
  }

  function toggle() {
    if (on) stop();
    else start();
    return on;
  }

  // Changing gallery retunes the drone/chime pitch rather than restarting
  // the graph, so the transition is a glide, not a cut.
  function setGallery(galleryId) {
    currentGalleryId = galleryId;
    retuneDrone();
  }

  // While the tab is hidden, suspend the AudioContext entirely (not just
  // mute it) so no oscillator/scheduling work runs on an unseen page —
  // resumes automatically if the visitor had it on when they return.
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) {
      if (ctx.state === "running") {
        suspendedForHidden = true;
        ctx.suspend();
      }
    } else if (suspendedForHidden) {
      suspendedForHidden = false;
      if (on) ctx.resume();
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
