#!/usr/bin/env python3
"""Generates new curated donated-relic illustrations (and, separately,
accessory overlay illustrations) via Pollinations' free, keyless image API,
then cuts each one out to a true transparent PNG matching the existing
assets' style. A one-off DEV-TIME tool — never imported by the server, never
part of pnpm check/CI, same status as the historical tools/build-scenes.py
(see git history at a63b849) this is modeled on.

Pollinations returns a lossy JPEG on a green/teal backdrop the prompt
requests, but the model (currently "sana") does not reliably render it flat —
real output has gradient/vignette shading and faint mottling. A literal
exact-colour distance key fails on that, so this script instead keys by HUE:
it samples the hue of the image's own border ring (assumed to be background),
masks pixels within a hue distance of that, keeps only the mask region
connected to the border (so a hue-alike patch fully enclosed by the subject
is never treated as background), fills small holes (a silver/metal subject
can specular-reflect the backdrop colour, punching a false hole), then
feathers the edge to avoid hard aliasing from JPEG's lossy compression.

Nothing here is committed automatically: every generated image lands in a
gitignored staging folder (tools/sources/relic-gen/review/) for a manual
visual check — does the subject read correctly, is the cutout clean, does it
match the existing presets' Gothic/Victorian illustrated bar — before being
moved by hand into public/assets/donated-relics/ or public/assets/accessories/.

Run: python3 tools/generate-relic-assets.py [--only id,id,...]
"""
import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
STAGING = ROOT / "tools" / "sources" / "relic-gen"
RAW_DIR = STAGING / "raw"
REVIEW_DIR = STAGING / "review"
MANIFEST_PATH = STAGING / "manifest.json"

POLLINATIONS_URL = "https://image.pollinations.ai/prompt/{prompt}?width={w}&height={h}&nologo=true&seed={seed}"
GEN_SIZE = 900

# Pollinations' default model ("sana" — "flux" now 402s, payment required) does
# not reliably render a flat solid backdrop even when the prompt demands one —
# real output has gradient/vignette shading and faint mottling. So instead of
# keying one fixed RGB value, the background's actual hue is sampled live from
# the image's own border ring and keyed by hue distance (tolerant of shading),
# guarded by a saturation floor so grey/white/black subject regions (a silver
# spoon's specular highlight, bone, paper) are never mistaken for the backdrop
# just because a desaturated pixel's hue happens to land nearby.
HUE_DISTANCE_THRESHOLD = 0.15  # fraction of the hue circle (~54 degrees) — wide
# enough to also catch a faint secondary tonal variation in the backdrop
# texture itself (the "sana" model's backdrop isn't just gradient-shaded, it
# has a woven/leather micro-texture with small hue excursions — confirmed
# live this session: a patch of that texture right next to a spoon's bowl
# had enough hue drift to read as "not background" at a tighter threshold).
SATURATION_FLOOR = 0.06  # below this, a pixel is too desaturated to be "the green"
CLOSING_RADIUS = 7  # closes small backdrop-coloured speckle holes punched into
# a reflective subject (a polished metal handle can mirror the backdrop's own
# hue in a thin streak, briefly dropping below SATURATION_FLOOR or matching
# the key); plain binary_fill_holes can't bridge these because they're often
# open corridors to the true background, not fully enclosed holes.
MAX_FILLABLE_HOLE_AREA = 400  # px^2. A hole this size or smaller is treated as
# a reflection artifact and filled in; a larger one is left transparent —
# this only ever runs on holes binary_fill_holes finds inside `foreground`,
# i.e. backdrop-hue regions NOT already connected to the border (see below).
LARGE_ENCLOSED_BG_AREA_FRACTION = 0.008  # fraction of the full image area.
# A backdrop-hue region that does NOT touch the border is normally assumed
# to be a reflection speckle fully inside the subject (see
# MAX_FILLABLE_HOLE_AREA above) — but a real design hole with its own
# negative space (a key's bow/loop, a door-handle ring) is also
# border-disconnected, and is much bigger than any reflection speckle this
# session's test images ever produced. Confirmed live this session by
# measuring every backdrop-hue connected component's area on both a key
# render (its loop: ~12194px of a 589824px image, fraction ~0.021) and two
# spoon renders (largest reflection speckle on either: ~2151px, fraction
# ~0.0036) — this threshold sits between the two, well clear of either.
# Promoting a region this large straight to "true background" BEFORE
# `foreground` is even computed is the fix; the original border-connectivity
# rule alone left the key's loop interior inside `foreground` from the very
# start (never a "hole" relative to foreground, since foreground was never
# missing it), so no amount of tuning the post-fill_holes hole logic above
# could ever have reached it.
FEATHER_RADIUS = 1.2  # softens the cutout edge instead of a hard aliased line

# Kept deliberately plain. An earlier version added "Victorian Gothic
# curiosity-cabinet museum-relic style, ornate detail" here and it reliably
# hijacked the model (currently Pollinations' "sana") into drawing an actual
# ornate cabinet/frame/mirror AROUND the subject instead of the subject
# itself plainly lit — confirmed live this session on multiple subjects. The
# model is small enough that stacking style adjectives competes with naming
# the subject; the Gothic/Victorian art-direction match to the rest of this
# repo's assets is judged later, by hand, in the staging review step, not
# forced here at generation time.
#
# Green is the default keying colour, but a couple of subjects render their
# OWN dominant colour close enough to green to defeat hue-keying (a burgundy
# diary came back dark green by the model's own default choice; brass/gold
# antique metal objects — a key, a pocket watch — often render with a faint
# green patina tint baked in) — BACKDROP_OVERRIDE below lets one asset swap
# to a hue far from its own subject colour instead of fighting the model on
# its colour choice for that subject.
def style_suffix(backdrop: str) -> str:
    return (
        f"isolated on a flat solid {backdrop} background, studio product photography, "
        "no other objects, no frame, no border, no vignette, no gradient, no shadow"
    )

# id -> (prompt subject, working title, kind). kind is "relic" (lands in
# public/assets/donated-relics/) or "accessory" (public/assets/accessories/).
ASSETS = {
    # Stage 2 — eight new relic presets, one per previously-uncovered subtype.
    "unfinished-charcoal-study": ("an unfinished charcoal portrait sketch on aged paper, in an ornate frame", "The Unfinished Charcoal Study", "relic"),
    "tarnished-silver-spoon": ("a single tarnished antique silver spoon", "The Tarnished Silver Spoon", "relic"),
    "key-that-opens-nothing": ("an ornate antique brass skeleton key", "The Key That Opens Nothing", "relic"),
    # These three originally produced a realistic "studio still life" photo —
    # the object sitting on a visible brown wooden table/surface in front of a
    # dark wall, confirmed live this session on all three raw generations —
    # which defeats hue-keying (the table isn't backdrop-coloured, so it
    # survives as an attached foreground blob). "mounted on a base",
    # "on a table", and "figure" all independently cue that composition in
    # the model's learned priors hard enough that STYLE_SUFFIX's own request
    # for a flat backdrop loses. Reworded to explicitly float the subject
    # and flatly forbid a table/surface, matching the successful spoon/key
    # prompts' plain subject-first wording instead of a staged-scene one.
    # "floating, no table, no surface" alone was not forceful enough — both
    # regenerations still rendered the subject resting on real photographed
    # wood grain (confirmed live this session) — the model's learned prior
    # for these two specific subjects (a mantel clock, a specimen mount) is
    # apparently stronger than that single negative instruction. Reworded to
    # explicitly put the subject'S OWN base in direct contact with the green
    # backdrop itself, never a separate surface material — telling the model
    # what IS touching the subject, not just what must not appear.
    # Dropped "mantel" entirely — the word itself (a clock that belongs ON a
    # mantelpiece) seems to be what cues the model toward a furniture/room
    # photo, stronger than any amount of "no table" negative instruction
    # could override (confirmed live this session: the raw image still had a
    # wood table even with that explicit negative clause attached). Even
    # without "mantel", "clock" alone proved unreliable across several more
    # regenerations this session — an ornate crown-like rim, a near-empty
    # sliver, and an ornate picture-frame with a blank oval where a face
    # should be (the model apparently conflating "ornate antique brass
    # [object] with a glass face" with an ornate frame/mirror composition).
    # Switched to "pocket watch": still round, brass, glass-faced and period-
    # appropriate for the gallery, but a shape the model doesn't associate
    # with a wall-mounted frame.
    "clock-that-keeps-no-hour": ("a small antique brass pocket watch with a cracked glass face", "A Clock That Keeps No Hour", "relic"),
    "fogged-hand-mirror": ("an ornate antique silver hand mirror, its glass fogged and dim", "The Fogged Hand Mirror", "relic"),
    "articulated-raven-skeleton": ("a small articulated raven skeleton on a tiny plain dark base, the base resting directly on the green backdrop, no wood, no table, no shelf", "The Articulated Raven Skeleton", "relic"),
    "clockwork-tin-soldier": ("an antique clockwork tin soldier toy figure, ornate Victorian design, floating, no table, no surface", "The Clockwork Tin Soldier", "relic"),
    # Explicitly burgundy, not left to the model's own default — the raw
    # generation for "leather-bound diary" with no colour specified came back
    # dark green, indistinguishable by hue from STYLE_SUFFIX's own green
    # backdrop (confirmed live this session: the keyer erased much of the
    # diary along with the real background). Every other asset's prompt is
    # left to the model's own colour choice; this is the one place a colour
    # is forced, specifically to stay clear of the keying hue.
    "locked-nursery-diary": ("a small antique burgundy red leather-bound diary with a tiny brass lock", "The Locked Nursery Diary", "relic"),
    # Stage 3 — accessory overlays (personalization).
    "accessory-glasses": ("a pair of antique wire-rimmed spectacles, front view, flat", "Spectacles", "accessory"),
    # Original raw generation sat on a visible olive table AND set a green
    # gemstone into the band (confirmed live this session) — both collide
    # with hue-keying the same way the clock's brass/patina did. Floated
    # explicitly and the gem colour pinned to red, clear of the green family.
    "accessory-ring": ("an ornate antique gold signet ring with a red gemstone, floating, no table, no surface", "Signet Ring", "accessory"),
    "accessory-hat": ("a small antique Victorian mourning hat, front view, flat", "Mourning Hat", "accessory"),
    # Three wrong subjects in a row: a green leather pouch/case, a whole
    # person's face wearing a masquerade mask, then a round goggle-like
    # object with a creature's face inside it (confirmed live this session
    # on all three) — "eye"/"eyepatch" keeps cueing a face or a worn photo
    # rather than a standalone object, even with "no face" stated outright.
    # Reframed around "pirate eye patch", a stock-photo-common phrase for
    # exactly this object alone, isolated on white, the same way a real
    # product listing would ask for it — avoiding "eye...for covering" and
    # "accessory" phrasing that seemed to be the trigger.
    # 7 wrong-subject results in a row for this id: a pouch, 3 masked/costumed
    # faces, a masquerade-costumed woman, anti-human negatives still returning
    # a woman's face, and dropping "eye" for "pirate costume accessory"
    # returned an unrelated round skull-medallion badge — every wording tried
    # that names eyes, patches, pirates, costumes, or masks collapses onto
    # some face/costume/badge composition, confirmed live this session across
    # 7 independent regenerations. Final attempt describes pure physical shape
    # with none of those trigger words at all — a small curved black leather
    # oval with an elastic strap — and leaves the object's actual identity
    # unstated; if this still fails, accepted as a known model limitation
    # (see ASSETS.md) rather than spending further attempts on this one id.
    "accessory-eyepatch": ("a small curved black leather oval shape with a thin elastic strap attached to its back, lying flat on its back, product photography, plain object, no face, no person, no mannequin, no badge, no logo, no text, no symbol", "Eyepatch", "accessory"),
}

# asset id -> backdrop colour word, for the rare subject whose own dominant
# colour collides with the default green closely enough to defeat hue-keying.
# "clock-that-keeps-no-hour" (a brass pocket watch) kept rendering with a
# faint green patina/reflection baked into the brass and glass across several
# regenerations this session — confirmed live by inspecting three separate
# raw generations, all with a visible green cast on the watch face/case —
# magenta is far enough from both brass-gold and the watch's own green cast
# to key cleanly without touching the shared default for every other asset.
BACKDROP_OVERRIDE = {
    "clock-that-keeps-no-hour": "magenta",
    # Same gold-vs-green collision as the clock above — the raw render's
    # backdrop drifted into an olive/amber cast close enough to the ring's
    # own gold band hue that keying erased nearly the entire ring (confirmed
    # live this session via direct hue sampling across the band: 0.08-0.18,
    # overlapping the sampled backdrop hue of ~0.127 well inside
    # HUE_DISTANCE_THRESHOLD). Magenta was tried first but then collided with
    # the prompt's own red gemstone (red and magenta sit close together on
    # the hue circle) — confirmed live this session, the backdrop rendered
    # magenta-red and nearly erased the gem along with it. Blue sits equally
    # far from gold as magenta does, without that second collision.
    "accessory-ring": "blue",
}


# Pollinations' free tier is rate-limited to 1 image per 45s per IP
# (confirmed live this session via a 402 FREE_LIMIT response); back off and
# retry rather than letting a batch run fail partway through.
RATE_LIMIT_BACKOFF_SECONDS = 50
MAX_FETCH_ATTEMPTS = 3


def fetch(subject: str, size: int, backdrop: str = "green") -> bytes:
    prompt = f"{subject}, {style_suffix(backdrop)}"
    encoded = urllib.parse.quote(prompt)
    # A random seed, not a fixed one: Pollinations returns an identical cached
    # image for an identical (prompt, size) pair otherwise, confirmed live
    # this session re-requesting the same clock prompt twice in a row — which
    # would make a --only retry after a misfire pointless.
    seed = random.randint(0, 2**31 - 1)
    url = POLLINATIONS_URL.format(prompt=encoded, w=size, h=size, seed=seed)
    for attempt in range(1, MAX_FETCH_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 402 and attempt < MAX_FETCH_ATTEMPTS:
                print(f"  rate-limited, waiting {RATE_LIMIT_BACKOFF_SECONDS}s...", file=sys.stderr)
                time.sleep(RATE_LIMIT_BACKOFF_SECONDS)
                continue
            raise
    raise RuntimeError("unreachable")


def chroma_key_to_alpha(im: Image.Image) -> Image.Image:
    # Local imports: only this function needs the heavier numeric stack.
    import numpy as np
    from scipy import ndimage
    from skimage.color import rgb2hsv
    from skimage.morphology import binary_closing, disk

    im = im.convert("RGBA")
    rgb_255 = np.asarray(im)[:, :, :3].astype(np.float64)
    rgb = rgb_255 / 255.0
    hsv = rgb2hsv(rgb)
    hue, sat = hsv[:, :, 0], hsv[:, :, 1]

    # Estimate the backdrop's actual hue (for keying) and RGB (for edge
    # decontamination below) from the image's own border ring — robust to
    # the gradient/vignette shading the model actually renders, instead of
    # assuming a fixed value the model doesn't reliably hit.
    border = 12
    border_mask = np.zeros(hue.shape, dtype=bool)
    border_mask[:border, :] = border_mask[-border:, :] = True
    border_mask[:, :border] = border_mask[:, -border:] = True
    border_sat_ok = border_mask & (sat > SATURATION_FLOOR)
    if not border_sat_ok.any():
        border_sat_ok = border_mask  # degrade gracefully if the border reads as unsaturated
    bg_hue = float(np.median(hue[border_sat_ok]))
    bg_rgb = np.median(rgb_255[border_mask].reshape(-1, 3), axis=0)

    hue_dist = np.abs(hue - bg_hue)
    hue_dist = np.minimum(hue_dist, 1 - hue_dist)  # hue is circular (0 == 1)
    looks_like_backdrop = (hue_dist < HUE_DISTANCE_THRESHOLD) & (sat > SATURATION_FLOOR)

    # Only treat a backdrop-coloured region as real background if it connects
    # back to the border — a hue-alike patch fully enclosed by the subject
    # (unlikely here, but cheap to guard) is never carved out of the middle —
    # UNLESS it's large enough to be a real design hole rather than a
    # reflection speckle (see LARGE_ENCLOSED_BG_AREA_FRACTION above).
    labeled, n_bgish = ndimage.label(looks_like_backdrop)
    border_labels = set(np.unique(labeled[border_mask])) - {0}
    total_area = hue.shape[0] * hue.shape[1]
    min_enclosed_area = total_area * LARGE_ENCLOSED_BG_AREA_FRACTION
    large_enclosed_labels: set[int] = set()
    if n_bgish:
        sizes = ndimage.sum(looks_like_backdrop, labeled, range(1, n_bgish + 1))
        large_enclosed_labels = {
            i + 1
            for i, s in enumerate(sizes)
            if s >= min_enclosed_area and (i + 1) not in border_labels
        }
    bg_labels = border_labels | large_enclosed_labels
    true_background = np.isin(labeled, list(bg_labels)) if bg_labels else looks_like_backdrop

    foreground = ~true_background
    # A specular highlight/reflection on metal or glass can pick up the
    # backdrop's own hue in a thin streak, punching speckle holes or a full
    # corridor to the border through a narrow part of the subject (e.g. a
    # spoon's handle) — a plain fill_holes can't bridge an open corridor, so
    # close first (bridges gaps up to ~2*CLOSING_RADIUS px), then fill
    # whatever's left fully enclosed.
    foreground = binary_closing(foreground, disk(CLOSING_RADIUS))
    filled = ndimage.binary_fill_holes(foreground)
    holes = filled & ~foreground
    hole_labels, n_holes = ndimage.label(holes)
    if n_holes:
        hole_sizes = ndimage.sum(holes, hole_labels, range(1, n_holes + 1))
        small_hole_labels = [i + 1 for i, s in enumerate(hole_sizes) if s <= MAX_FILLABLE_HOLE_AREA]
        foreground = foreground | np.isin(hole_labels, small_hole_labels)
    else:
        foreground = filled

    # Pollinations stamps a "pollinations.ai" wordmark in a lower corner of
    # every generated image regardless of the documented nologo=true param
    # (confirmed live: present on every test generation this session) — its
    # near-black/near-white pixels are too desaturated to match the backdrop
    # hue, so without this step it would survive keying as its own isolated
    # foreground island. Every prompt here asks for "single centered object",
    # so the real subject is always the single largest connected foreground
    # component; dropping every other component removes the watermark (and
    # any other stray noise speckle) without hardcoding a corner region.
    labeled_fg, n_fg = ndimage.label(foreground)
    if n_fg > 1:
        sizes = ndimage.sum(foreground, labeled_fg, range(1, n_fg + 1))
        largest_label = int(np.argmax(sizes)) + 1
        foreground = labeled_fg == largest_label

    alpha = np.where(foreground, 255, 0).astype("uint8")
    alpha_img = Image.fromarray(alpha, mode="L").filter(ImageFilter.GaussianBlur(FEATHER_RADIUS))
    alpha_f = np.asarray(alpha_img).astype(np.float64) / 255.0

    # Decontaminate the feathered edge ring: a partially-transparent pixel
    # there still holds its ORIGINAL pixel colour (subject blended with
    # background by JPEG compression/anti-aliasing, not yet by the alpha
    # we just assigned), so naively keeping that RGB leaves a visible
    # backdrop-coloured halo once composited onto a real (non-backdrop)
    # scene — confirmed live this session: a teal fringe survived around a
    # spoon's bowl silhouette until this step was added. Assuming
    # src = alpha*subject + (1-alpha)*bg, solve for the subject's true
    # colour and clamp; alpha_safe keeps near-zero-alpha pixels (fully
    # background, discarded anyway) from blowing up the division.
    alpha_safe = np.clip(alpha_f, 0.12, 1.0)[:, :, None]
    decontaminated = (rgb_255 - (1 - alpha_safe) * bg_rgb[None, None, :]) / alpha_safe
    decontaminated = np.clip(decontaminated, 0, 255)

    out_rgba = np.dstack([decontaminated, alpha_f * 255]).astype("uint8")
    return Image.fromarray(out_rgba, mode="RGBA")


def crop_to_content(im: Image.Image) -> Image.Image:
    bbox = im.getbbox()
    if bbox:
        return im.crop(bbox)
    return im


# If the keyed-out cutout's bounding box covers less than this fraction of the
# source image's area, something went wrong upstream (most likely: the
# subject's own colour landed close enough to the backdrop hue that most of
# it got keyed out too, as happened in dev testing on an ad-hoc prompt that
# skipped style_suffix()'s explicit green-backdrop request) — surfaced as a
# loud failure rather than silently saving a near-empty or sliver PNG into
# the review folder for a human to not notice.
MIN_SUBJECT_AREA_FRACTION = 0.03


def generate_one(asset_id: str, subject: str) -> dict:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)

    backdrop = BACKDROP_OVERRIDE.get(asset_id, "green")
    raw_bytes = fetch(subject, GEN_SIZE, backdrop)
    raw_path = RAW_DIR / f"{asset_id}-raw.jpg"
    raw_path.write_bytes(raw_bytes)

    im = Image.open(raw_path)
    source_area = im.width * im.height
    im = chroma_key_to_alpha(im)
    im = crop_to_content(im)

    if (im.width * im.height) < source_area * MIN_SUBJECT_AREA_FRACTION:
        raise RuntimeError(
            f"cutout suspiciously small ({im.width}x{im.height} of a "
            f"{raw_path.name} source) — background keying likely misfired; "
            f"inspect {raw_path} by hand before retrying"
        )

    out_path = REVIEW_DIR / f"{asset_id}.png"
    im.save(out_path)

    return {
        "id": asset_id,
        "subject": subject,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "raw_path": str(raw_path.relative_to(ROOT)),
        "review_path": str(out_path.relative_to(ROOT)),
        "width": im.width,
        "height": im.height,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", help="comma-separated asset ids to (re)generate; default: all")
    args = parser.parse_args()

    targets = list(ASSETS.keys())
    if args.only:
        requested = set(args.only.split(","))
        unknown = requested - set(ASSETS.keys())
        if unknown:
            print(f"unknown asset id(s): {', '.join(sorted(unknown))}", file=sys.stderr)
            sys.exit(1)
        targets = [t for t in targets if t in requested]

    manifest = []
    if MANIFEST_PATH.exists():
        manifest = json.loads(MANIFEST_PATH.read_text())
        manifest = [m for m in manifest if m["id"] not in targets]

    for i, asset_id in enumerate(targets):
        if i > 0:
            time.sleep(RATE_LIMIT_BACKOFF_SECONDS)  # stay under the 1-per-45s free-tier cap
        subject, title, kind = ASSETS[asset_id]
        print(f"generating {asset_id} ({title}, {kind})...")
        try:
            entry = generate_one(asset_id, subject)
            entry["title"] = title
            entry["kind"] = kind
            manifest.append(entry)
            print(f"  -> {entry['review_path']} ({entry['width']}x{entry['height']})")
        except Exception as exc:  # noqa: BLE001 - a dev tool, report and continue
            print(f"  FAILED: {exc}", file=sys.stderr)

    STAGING.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))
    print(f"\nmanifest written to {MANIFEST_PATH.relative_to(ROOT)}")
    print("Review each PNG in tools/sources/relic-gen/review/ before promoting it into")
    print("public/assets/donated-relics/ or public/assets/accessories/.")


if __name__ == "__main__":
    main()
