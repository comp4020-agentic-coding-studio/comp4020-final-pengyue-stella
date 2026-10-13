# MoGe depth-parallax prototype (isolated experiment)

Evaluates [Microsoft MoGe](https://github.com/microsoft/MoGe) as a way to turn
the existing Kambri Lawn scene photograph into a genuinely depth-parallaxed
3D view, as a candidate for the "depth-aware 3D visual upgrade" `CLAUDE.md`
names as out of scope for C9 and deferred to a later crit.

**This directory is not part of the shipped app.** It is not referenced by
`server/`, `public/`, the `Dockerfile`, or any CI workflow. Nothing here runs
in production. See "Scope boundary" below for the specifics that keep it
that way.

## What this is

A static three.js page (`index.html`) that renders the Kambri Lawn photo as a
depth-displaced 3D mesh — real per-vertex geometry from MoGe's point-map
output, not a 2-layer "sprite + background" fake — and moves a virtual camera
laterally as the pointer moves, producing actual motion parallax: near things
shift more than far things, and surfaces correctly occlude/reveal each other
as the viewpoint changes.

A "Flat" toggle switches to a static camera (zero parallax) as the direct
comparison baseline — closer to the production scene's current behaviour,
where panning translates a static image in CSS with no depth response at all.

## Scope boundary

- **Does not touch the Fly production container.** No change to `Dockerfile`,
  `server/`, `public/`, `fly.toml`, or anything CI builds and deploys. Python,
  the MoGe clone, and the model checkpoint all live only inside this
  directory's own `.venv` and Hugging Face cache — nothing is added to the
  app's dependency graph.
- **Does not touch C9.** No commit here modifies any file changed by the C9
  presence work, `docs/adr/0001-scene-scoped-presence.md`,
  `reflections/crit-9.md`, or `traces.jsonl`/`store.js`. This is committed as
  its own separate checkpoint, after C9 was already shipped and tagged.
- **Preserves the original photograph.** `tools/sources/kambri.jpg` (the same
  file `tools/build-scenes.py` already builds the production panorama from)
  is read, never modified. MoGe output and derived textures are written only
  under this directory's own `out/` and `assets/` (gitignored — large,
  regenerable by re-running `infer.py`, exactly like `tools/sources/` is
  already gitignored for the same reason).
- **Preserves existing trace coordinates.** The prototype doesn't invent new
  anchor semantics — see "Anchoring compatibility" below for how it tests
  against the real `{x, y}` scheme `server/src/scenes.js` and trace data
  already use.

## Licensing

- **MoGe itself**: MIT-licensed, except the bundled DINOv2 encoder code
  (`moge/model/modules/dinov2`), which Meta AI releases under Apache 2.0.
  Neither license restricts non-commercial experimentation or redistribution
  of outputs; both are compatible with being vendored into an isolated,
  unshipped prototype directory like this one.
- **Pinned commit, not `main`**: this prototype clones MoGe at
  [`b942f00bdc`](https://github.com/microsoft/MoGe/commit/b942f00bdc) — the
  last commit before the repository moved to MoGe-3 packaging. `main` as of
  this writing hard-requires `flex-gemm` (Triton-based) as a base dependency
  and its own `pyproject.toml` explicitly excludes macOS
  (`environments = ["sys_platform == 'linux'", "sys_platform == 'win32'"]`,
  because "Triton publishes no macOS wheels"). The pinned commit's
  MoGe-2-era `pyproject.toml` depends on plain PyTorch/torchvision only, so
  it installs and runs on this Mac. See "Limitation found" below.
- **Model checkpoint**: `Ruicheng/moge-2-vits-normal` (35M params, the
  smallest MoGe-2 variant with metric scale + normal output), downloaded from
  Hugging Face at first run and cached outside this repo in the normal HF
  cache location — not committed.
- **Source photograph**: `tools/sources/kambri.jpg` — Wikimedia Commons, CC
  BY-SA 4.0, credited in the main repo's `README.md`. Unmodified by this
  prototype.

## Limitation found, and the practical alternative taken

MoGe's `main` branch (MoGe-3) cannot run on this machine: it depends on
FlexGEMM/Triton, and Triton ships no macOS wheels, so `main`'s own
`pyproject.toml` refuses the platform outright. This was identified **before**
proceeding further, per the task's instruction to report such a limitation
rather than push through it.

**Alternative taken**: pin to commit `b942f00bdc`, the last commit before the
MoGe-3 migration (MoGe-2 era). Verified concretely, not assumed:

```
$ python3 -c "from moge.model.v2 import MoGeModel; print('MoGeModel imported OK')"
MoGeModel imported OK
```

Installed cleanly via `pip install -e .` inside an isolated venv, no Triton or
FlexGEMM anywhere in the dependency list. Loaded the 35M-param checkpoint and
ran real inference on `tools/sources/kambri.jpg` (4000×1800) on Apple
Silicon MPS (`torch.backends.mps.is_available() == True` on this M3):

```
device: mps
model loaded in 0.7s
inference in 3.66s
  points: (1800, 4000, 3) torch.float32
  depth: (1800, 4000) torch.float32
  mask: (1800, 4000) torch.bool
  normal: (1800, 4000, 3) torch.float32
```

This is a genuine local alternative, not a workaround that skips the actual
evaluation — the same model family, same metric-depth output, same point-map
geometry MoGe-3 would also produce, just without the Linux/Windows-only
packaging MoGe-3's main branch currently ships.

## Reproducing

```sh
cd prototypes/moge-depth-parallax
python3 -m venv .venv && source .venv/bin/activate
pip install torch torchvision
git clone https://github.com/microsoft/MoGe.git MoGe-src
cd MoGe-src && git checkout b942f00bdc && pip install -e . && cd ..
python3 infer.py            # runs MoGe on tools/sources/kambri.jpg, writes out/
python3 export_assets.py    # downsamples out/ into browser-ready assets/
python3 -m http.server 8090 # serve this directory
# open http://localhost:8090/index.html
```

`MoGe-src/`, `.venv/`, `out/`, and `assets/` are all gitignored (large,
reproducible — same policy `tools/sources/` already uses for the raw photos).
Only `infer.py`, `index.html`, this README, and the `screenshots/` evidence
are committed.

## Evaluation

### Natural parallax between foreground and background

Genuine and correctly depth-ordered. A full pointer sweep was measured by
reprojecting five real-depth anchor points through the same camera each
frame (see "Anchoring compatibility" below) and recording their screen
trajectories:

| anchor | sampled depth | screen travel across full sweep |
|---|---|---|
| near-mid  | 9.3  | 308px |
| near-right| 9.6  | 299px |
| near-left | 12.8 | 225px |
| mid-right | 16.7 | 170px |
| far-sky   | 58.1 | 49px  |

Travel distance tracks depth closely — the nearest points move ~6× further
than the farthest one, which is the expected relationship for real monocular
depth driving parallax, not a tuned-by-eye effect.

### Occlusion and stretched-edge artefacts

Both appear, and are two faces of the same underlying cause: a regular grid
samples depth densely but triangulates uniformly, so a triangle spanning a
silhouette edge (a tree branch against sky, the deck railing against the
creek) naively bridges near and far depth into one long stretched shard.

The mitigation used here — culling any triangle whose three vertices disagree
on depth by more than 4% (`buildCulledIndices` in `index.html`) — removes the
stretching but trades it for visible gaps (black holes) at exactly those
edges, at the sampled mesh resolution (240×108, 23% of triangles culled on
this scene). See `screenshots/wireframe.png`: the holes sit precisely at
foliage/sky and deck/water boundaries, confirming the cause. A production
version would need either a much finer mesh with inpainted edge geometry, or
a proper mesh-repair step (MoGe's own `moge infer --export glb` pipeline does
this on the backend) — doing that well is real, further work, not a
parameter tweak.

**Occlusion itself works correctly**: comparing `screenshots/depth-left.png`
against `screenshots/depth-right.png`, the reed-covered creek bank reveals
and hides different slivers of water and lawn behind it as the viewpoint
shifts — genuine occlusion from real 3D geometry, which a 2-layer parallax
trick cannot produce (a 2-layer approach can shift a cutout layer but can't
reveal new background behind a near object's silhouette at a new angle the
original photo never captured).

### Stability of spatially anchored traces

Tested directly by reprojecting the same five anchor points (chosen to land
inside the sharp photo at varying real depths, not in the panorama's blurred
letterbox margins — see next section) through the camera on every frame
across a 20-step pointer sweep, then checking for jitter:

```
near-left  travel=(225px, 0px)  direction-reversals=0/19
near-mid   travel=(308px, 0px)  direction-reversals=0/19
far-sky    travel=(49px, 0px)   direction-reversals=0/19
mid-right  travel=(170px, 0px)  direction-reversals=0/19
near-right travel=(299px, 0px)  direction-reversals=0/19
```

Zero direction reversals on every anchor — each follows one smooth,
monotonic path as the pointer sweeps, with no jitter or teleporting. Anchors
would stay visually "pinned" to the surface they're anchored to.

### Browser performance and responsiveness

**A real caveat surfaced during testing, worth reporting plainly**: headless
Chromium (the only browser-automation path available in this environment)
uses SwiftShader software rendering, not the Mac's actual GPU, and measuring
performance under it gave a misleading ~40fps / 25ms-per-frame figure. Forcing
a headed browser with `--use-gl=angle --use-angle=metal` exposed the real
Apple M3 GPU (confirmed via `WEBGL_debug_renderer_info`:
`ANGLE Metal Renderer: Apple M3`), and under that, actual measured frame
timing was:

```
desktop 1280x720: avg 8.31ms/frame (≈120fps), max 9.60ms, 0/180 frames over 16.7ms
mobile  390x844:  avg 8.33ms/frame (≈120fps), max 9.60ms, 0/180 frames over 16.7ms
```

On real GPU hardware, this mesh (≈40K triangles post-culling) is a non-issue —
it's locked to the display's refresh ceiling with zero dropped frames at
both a desktop and a phone-class viewport. The headless/software-rendered
number is reported here specifically so it isn't mistaken for a real result
by a future reader of this prototype.

### Does it feel more immersive than the flat scene?

Judged, not measured — `screenshots/depth-center.png` vs
`screenshots/flat-left-baseline.png` are the two to compare directly, same
pointer position, same scene. The depth version visibly separates the creek,
reed bank, deck, and Kambri building into distinct planes that shift against
each other; the flat version is the same photo holding still regardless of
pointer position (faithfully reproducing today's production behaviour, where
panning moves the whole image as one rigid layer). The depth version reads as
looking *into* a place rather than at a picture of one — genuinely more
immersive on this one scene, at the mesh-resolution/edge-artefact cost
documented above.

## Anchoring compatibility

Production traces and exits anchor at `{x, y}` normalised 0–1 against the
*built panorama canvas* (5320×1400 for Kambri), not the raw source photo
MoGe ran on (4000×1800). Mapping the real Kambri exit anchors from
`server/src/scenes.js` through `tools/build-scenes.py`'s own placement math
found both existing exits sit in the panorama's **blurred letterbox margin**
(normalised local-x of 1.24 and -0.27 — both outside the sharp photo's
[0,1] range), because exits are deliberately placed near the pan range's
edges. That's a real fact about the current anchoring scheme, not a flaw in
this prototype: exits were never going to land inside MoGe's depth estimate,
since MoGe only sees the sharp central photo, not the synthetic blurred
sides. The five test anchors used above were instead chosen at normalised
coordinates known to fall inside the sharp photo at varying depths — the
same region actual *traces* (as opposed to exits) are overwhelmingly likely
to land in, since traces anchor to things a visitor actually clicked on in
the sharp, recognisable part of the photo.

**Implication for a real integration**: a depth-parallax upgrade would need
either (a) running MoGe on the full built panorama including its blurred
margins (lower quality depth there, since it's synthetic content, but
keeps the existing anchoring scheme unchanged), or (b) re-deriving exit/trace
anchors in source-photo-local space for the sharp region only and falling
back to the current flat behaviour at the margins. Both are real design
decisions for a future crit, not resolved here — this prototype only
establishes that the anchors that matter (traces, not exits) survive the
transform without drift once they're in-frame.

## Files

- `infer.py` — runs MoGe-2 on the Kambri source photo, dumps `out/*.npy`.
- `export_assets.py` — downsamples `out/` into `assets/` (a browser-sized
  color texture plus a binary grid of real 3D point-map vertices), filling
  MoGe's `inf`-valued invalid pixels (sky, thin foliage) with far-plane
  fallback geometry so the mesh never contains non-finite vertices.
- `index.html` — the three.js parallax viewer; loads `assets/`.
- `screenshots/` — evaluation evidence (committed, ~4MB): center/left/right
  pointer positions in depth mode, the flat-mode baseline at the same pointer
  position, and the culled wireframe mesh.
- `MoGe-src/`, `.venv/`, `out/`, `assets/` — gitignored, regenerable.

## Verdict

Feasible as a local, GPU-accelerated prototype; **not proposed for C10 or
production integration as-is**. The core technique (real depth-displaced mesh
+ translating virtual camera) produces genuine, correctly-ordered parallax
with stable anchors and negligible performance cost on real hardware. The
open problems are specific and bounded, not fundamental: edge-artefact
handling needs real mesh repair (not a tolerance tweak), and the anchoring
scheme needs an explicit decision about the panorama's blurred margins before
any trace/exit could be re-anchored against depth. Both are reasonable scope
for a dedicated future crit, which is exactly how `CLAUDE.md` already frames
this work ("the depth-aware 3D visual upgrade will be handled separately").
