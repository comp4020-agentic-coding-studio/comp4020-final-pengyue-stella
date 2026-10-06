#!/usr/bin/env python3
"""Builds the four real-photo scene panoramas in public/scenes/ from raw
source photographs. Replaces the earlier hand-illustrated SVG approach (see
CLAUDE.md) with real ANU campus photography, presented as a pseudo-panorama:
each photo is shown sharp at its natural aspect, centred on a wider canvas
whose sides are filled with a softly blurred, darkened extension of the same
photo (a standard "blurred letterbox" treatment) so there's real pan room
without inventing content that isn't there.

Sources are real photographs from Wikimedia Commons, all CC BY-SA — see the
attribution block below and in README.md. Raw downloads are NOT committed
(they're a few MB each and purely derivable); only the processed output in
public/scenes/ is. Re-run this after re-downloading the sources listed below
into tools/sources/ (gitignored) to reproduce byte-for-byte-similar output
(blur/JPEG encoding can vary slightly by Pillow version).

Run: python3 tools/build-scenes.py
"""
from pathlib import Path
from PIL import Image, ImageOps, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "tools" / "sources"
OUT = ROOT / "public" / "scenes"

CANVAS_HEIGHT = 1400
# width = height * aspect. Wide enough that the rendered image comfortably
# exceeds both marking viewports' width at the CSS viewport-height clamp
# (see .viewport in styles.css) — too narrow here and panning has nowhere to
# go (the image is already fully visible, so drag/arrow-keys do nothing).
CANVAS_ASPECT = 3.8
FEATHER = 90  # px over which the sharp centre fades into the blurred sides

# file, source URL, author, license — the attribution README.md repeats
SCENES = {
    "kambri": (
        "kambri.jpg",
        "https://commons.wikimedia.org/wiki/File:Sullivans_Creek_at_Kambri_ANU.jpg",
        "Alvinz", "CC BY-SA 4.0",
    ),
    "chifley": (
        "chifley.jpg",
        "https://commons.wikimedia.org/wiki/File:New_entrance_to_Chifley_library.jpg",
        "Nick-D", "CC BY-SA 4.0",
    ),
    "union": (
        "union.jpg",
        "https://commons.wikimedia.org/wiki/File:Union_Court_at_the_ANU_in_Feb_2016.jpg",
        "Nick-D", "CC BY-SA 3.0",
    ),
    "uniave": (
        "uniave.jpg",
        "https://commons.wikimedia.org/wiki/File:ANU_entrance_viewed_from_University_Avenue.jpg",
        "Bidgee", "CC BY-SA 2.5 AU",
    ),
}


def cover_crop(im: Image.Image, w: int, h: int) -> Image.Image:
    """Scale `im` up to cover a w×h box, then centre-crop to exactly that box."""
    src_w, src_h = im.size
    scale = max(w / src_w, h / src_h)
    im = im.resize((round(src_w * scale), round(src_h * scale)), Image.LANCZOS)
    x = (im.width - w) // 2
    y = (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def build(name: str, src_path: Path, out_path: Path) -> tuple[int, int]:
    im = ImageOps.exif_transpose(Image.open(src_path)).convert("RGB")

    canvas_w = round(CANVAS_HEIGHT * CANVAS_ASPECT)
    canvas_h = CANVAS_HEIGHT

    # The blurred background: a zoomed, cropped, softened copy filling the
    # whole canvas so the sharp photo never runs out against bare colour.
    bg = cover_crop(im, canvas_w, canvas_h)
    bg = bg.filter(ImageFilter.GaussianBlur(48))
    bg = ImageEnhance.Brightness(bg).enhance(0.55)
    bg = ImageEnhance.Color(bg).enhance(0.75)

    # The sharp foreground: the real photo at its own aspect, fit to the
    # canvas height, never cropped — this is the thing that has to read as
    # "an actual ANU place" at a glance.
    fg_h = canvas_h
    fg_w = round(im.width * (fg_h / im.height))
    fg = im.resize((fg_w, fg_h), Image.LANCZOS).convert("RGBA")

    # Feather fg's own left/right edges to transparent so it blends into bg
    # rather than sitting on it as a hard rectangle.
    alpha = Image.new("L", (fg_w, fg_h), 255)
    px = alpha.load()
    feather = min(FEATHER, fg_w // 4)
    for x in range(feather):
        a = round(255 * (x / feather))
        for y in range(fg_h):
            px[x, y] = a
            px[fg_w - 1 - x, y] = a
    fg.putalpha(alpha)

    canvas = bg.convert("RGBA")
    paste_x = (canvas_w - fg_w) // 2
    canvas.alpha_composite(fg, (paste_x, 0))
    canvas = canvas.convert("RGB")

    # A light unified grade across all four scenes, so four different
    # photographers' photos read as one app's photography.
    canvas = ImageEnhance.Contrast(canvas).enhance(1.05)
    canvas = ImageEnhance.Color(canvas).enhance(1.08)

    # Gentle vignette: darken the far corners a little, without touching the
    # sharp centre panel.
    vignette = Image.new("L", (canvas_w, canvas_h), 0)
    vpx = vignette.load()
    for x in range(canvas_w):
        edge = min(x, canvas_w - 1 - x) / (canvas_w / 2)
        shade = round(70 * max(0, 1 - edge * 1.6))
        if shade:
            for y in range(canvas_h):
                vpx[x, y] = shade
    dark = Image.new("RGB", (canvas_w, canvas_h), (0, 0, 0))
    canvas = Image.composite(dark, canvas, vignette)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, "JPEG", quality=86, optimize=True, progressive=True)
    return canvas_w, canvas_h


if __name__ == "__main__":
    for scene_id, (filename, url, author, license_) in SCENES.items():
        src = SOURCES / filename
        if not src.exists():
            raise SystemExit(
                f"missing {src} — download it from {url} ({author}, {license_}) "
                f"into tools/sources/ first"
            )
        w, h = build(scene_id, src, OUT / f"{scene_id}.jpg")
        size_kb = (OUT / f"{scene_id}.jpg").stat().st_size // 1024
        print(f"{scene_id}: {w}x{h}, {size_kb}KB  <- {filename} ({author}, {license_})")
