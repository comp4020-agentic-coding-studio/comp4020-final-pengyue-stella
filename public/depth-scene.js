// Depth-parallax rendering for one scene (currently only Kambri Lawn — see
// docs/adr/0002-kambri-depth-parallax.md). Everything three.js-specific
// lives here so app.js never needs to know this library exists; it only
// calls the small interface createDepthScene() returns.
//
// Mesh geometry comes from a precomputed static asset (tools/build-depth.py,
// run by hand against the built scene panorama, never in CI or the Docker
// image) — a real depth-displaced grid from Microsoft MoGe's monocular
// geometry estimate, not a 2-layer parallax trick. Verified against an
// isolated prototype first (prototypes/moge-depth-parallax/) before this
// integration: real parallax that tracks depth, stable reprojected anchors,
// genuine occlusion, negligible performance cost on real GPU hardware.
//
// three.js itself is vendored as a static file (public/vendor/), not an npm
// dependency — see public/vendor/README.md.

const BIN_HEADER_BYTES = 12; // u32 gridWidth, u32 gridHeight, f32 verticalFovDegrees

// Depth-continuity triangle cull: a regular grid triangulates straight
// across every silhouette edge (a branch against sky, a railing against
// water), bridging near and far depth into one stretched triangle. Dropping
// triangles whose three vertices disagree on depth trades that stretching
// for small gaps at exactly those edges instead — a visible, deliberate
// trade-off (see the prototype's README for the fuller writeup), not a bug.
// 0.08 chosen empirically against the Kambri asset: 0.04 (the prototype's
// own value, tuned on the raw source photo) left a noticeably large gap
// along this scene's tree-canopy silhouette once run on the wider built
// panorama; 0.08 shrinks that gap with no visible stretching reappearing,
// confirmed by comparing panned-left/panned-right screenshots at both
// values (see docs/adr/0002-kambri-depth-parallax.md's verification
// section). Reusing tools/build-depth.py's old constant of the same name
// (also 0.04, unused there — the cull itself happens client-side on the
// uncut mesh this ships) would have silently kept the worse value.
const DEPTH_TOLERANCE = 0.08;

function buildCulledIndices(gw, gh, positions, tolerance) {
  const indices = [];
  const zAt = (x, y) => positions[(y * gw + x) * 3 + 2];
  for (let y = 0; y < gh - 1; y++) {
    for (let x = 0; x < gw - 1; x++) {
      const i00 = y * gw + x, i10 = i00 + 1, i01 = i00 + gw, i11 = i01 + 1;
      const z00 = zAt(x, y), z10 = zAt(x + 1, y), z01 = zAt(x, y + 1), z11 = zAt(x + 1, y + 1);
      const coherent = (a, b, c) => {
        const zs = [a, b, c];
        return Math.max(...zs) - Math.min(...zs) < tolerance * Math.max(...zs);
      };
      if (coherent(z00, z10, z11)) indices.push(i00, i10, i11);
      if (coherent(z00, z11, z01)) indices.push(i00, i11, i01);
    }
  }
  return indices;
}

async function loadMesh(meshUrl) {
  const res = await fetch(meshUrl);
  if (!res.ok) throw new Error(`mesh fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const gw = new Uint32Array(buf, 0, 1)[0];
  const gh = new Uint32Array(buf, 4, 1)[0];
  // MoGe's own reconstructed vertical FOV for this panorama (tools/build-
  // depth.py computes it from the model's output intrinsics) — using a
  // fixed guess here instead left visible empty canvas above and below the
  // mesh on this scene's wide, short aspect (measured ~31° true vertical
  // FOV against a 50° guess), caught by screenshotting the first
  // integration attempt rather than predicted up front.
  const verticalFovDeg = new Float32Array(buf, 8, 1)[0];
  const raw = new Float32Array(buf, BIN_HEADER_BYTES);
  // MoGe's OpenCV camera coordinates are X-right, Y-down, Z-forward;
  // three.js is Y-up, so Y is negated on load — otherwise the whole relief
  // renders upside down (verified the hard way in the prototype: skipping
  // this flip produces giant inverted spikes, not a subtly wrong picture).
  const positions = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    positions[i] = raw[i];
    positions[i + 1] = -raw[i + 1];
    positions[i + 2] = raw[i + 2];
  }
  return { gw, gh, positions, verticalFovDeg };
}

function sampleGridPosition(gw, gh, positions, nx, ny) {
  const gx = nx * (gw - 1);
  const gy = ny * (gh - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, gw - 1), y1 = Math.min(y0 + 1, gh - 1);
  const fx = gx - x0, fy = gy - y0;
  const at = (x, y) => {
    const i = (y * gw + x) * 3;
    return [positions[i], positions[i + 1], positions[i + 2]];
  };
  const p00 = at(x0, y0), p10 = at(x1, y0), p01 = at(x0, y1), p11 = at(x1, y1);
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const top = lerp3(p00, p10, fx);
  const bot = lerp3(p01, p11, fx);
  return lerp3(top, bot, fy);
}

// Samples the average colour of the image's own top strip (the sky, in
// every one of these outdoor campus photos) via an offscreen canvas, so a
// gap in the mesh reads as plausible atmosphere rather than a flat colour
// picked without reference to the actual photo. Falls back to a generic
// overcast grey-blue if canvas 2D access ever fails (a sandboxed iframe,
// for instance) — cosmetic only, never allowed to throw and break the
// scene over it.
function sampleSkyColor(THREE, image) {
  try {
    const w = 32, h = 8; // a coarse average is all this needs
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(image, 0, 0, image.width, Math.max(1, Math.round(image.height * 0.12)), 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let r = 0, g = 0, b = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
  } catch {
    return new THREE.Color(0.55, 0.6, 0.65);
  }
}

// Window-model parallax: translate the camera laterally without rotating it.
// MoGe reconstructs points in the original photographing camera's own
// frame, which sits at (0,0,0) looking down +Z — the physically correct
// vantage point to render from (not a fraction of the mesh's own bounding
// box, which the prototype's first attempt tried and which put the camera
// almost inside the nearest geometry). No re-aiming at a scene centre as
// the pan fraction changes: that would rotate the camera, bending straight
// lines in the photo, unlike real head-tracked motion parallax.
// Metres of lateral camera travel at full pan range. 2.2 (the prototype's
// own value, tuned against the raw source photo's narrower field of view)
// read as excessive here: at this panorama's full pan range it swings the
// camera far enough to expose large areas the single photo never captured
// (no real geometry behind a leaf, around a trunk, etc.), which read as
// grey sky-coloured gap patches precisely where the "camera" has moved
// past what the photo actually shows — not a rendering bug, but a
// motion-amount problem; the single-photo source simply doesn't support
// that much lateral travel. 0.6 keeps the parallax clearly perceptible
// (foreground visibly shifts against background on a drag) while keeping
// the exposed-gap area small enough to read as a natural depth cue rather
// than a view into missing geometry, confirmed by panning screenshots.
const PARALLAX_STRENGTH = 0.6;

export async function createDepthScene({ host, meshUrl, textureUrl }) {
  let THREE;
  try {
    THREE = await import("three");
  } catch {
    return { supported: false, reason: "three.js failed to load" };
  }

  let canvas, renderer;
  try {
    canvas = document.createElement("canvas");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch {
    return { supported: false, reason: "WebGL unavailable" };
  }

  let meshData;
  try {
    meshData = await loadMesh(meshUrl);
  } catch {
    return { supported: false, reason: "depth mesh unavailable" };
  }

  let colorTex;
  try {
    const texLoader = new THREE.TextureLoader();
    colorTex = await texLoader.loadAsync(textureUrl);
    colorTex.colorSpace = THREE.SRGBColorSpace;
    // The source photo is far higher resolution than the 360x160 mesh grid
    // — anisotropic filtering keeps it reading sharp at the shallow viewing
    // angles the parallax camera creates toward the ground/water, instead of
    // the default filtering's blur at those angles.
    colorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  } catch {
    return { supported: false, reason: "scene texture unavailable" };
  }

  const { gw, gh, positions, verticalFovDeg } = meshData;
  const culledIndices = buildCulledIndices(gw, gh, positions, DEPTH_TOLERANCE);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(verticalFovDeg, 1, 0.05, 500);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, 1);

  const geometry = new THREE.PlaneGeometry(1, 1, gw - 1, gh - 1);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(culledIndices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({ map: colorTex, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // A gap the edge-coherence cull leaves (a deliberate trade-off against
  // the stretched-silhouette alternative — see DEPTH_TOLERANCE's comment)
  // shows the renderer's own clear colour through it. A tried alternative —
  // a second, loosely-culled "backdrop" copy of the mesh pushed behind the
  // real one — made this worse, not better: any tolerance loose enough to
  // fill a meaningful fraction of the gaps reintroduced visible stretching
  // at genuine depth discontinuities (confirmed by screenshot: streaking
  // into the sky at BACKDROP_TOLERANCE=0.3, the same artefact the cull
  // exists to prevent, just smaller). Sampling the photo's own sky tone and
  // using it as the clear colour instead means a gap reads as "a hazy
  // patch of actual sky colour", not a geometric glitch or a black hole —
  // cheap, and never wrong in a way that draws the eye.
  scene.background = sampleSkyColor(THREE, colorTex.image);

  canvas.style.cssText = "display:block;width:100%;height:100%;";
  host.appendChild(canvas);

  let panFraction = 0.5; // 0..1, same ratio app.js already computes (pan / maxPan)
  let raf = null;
  let destroyed = false;

  function applyCamera() {
    const dx = (panFraction - 0.5) * 2; // -1..1
    camera.position.set(dx * PARALLAX_STRENGTH, 0, 0);
    camera.lookAt(camera.position.x, camera.position.y, camera.position.z + 1);
  }

  function render() {
    if (destroyed) return;
    applyCamera();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(render);
  }
  render();

  // host (#depth-host) starts the `hidden` attribute set (app.js only
  // unhides it once createDepthScene resolves as supported), so its
  // clientWidth/clientHeight read 0 at the moment this function runs — a
  // one-shot resize() call here would permanently lock the WebGL render
  // buffer at whatever tiny default the renderer falls back to (observed:
  // 300x150, stretched by CSS to the real box, which is exactly what made
  // the first integration attempt look severely blurred/pixelated). A
  // ResizeObserver instead reacts to the real size host settles into right
  // after app.js unhides it, and again on every later resize (window
  // resize, orientation change, devtools panel toggling) — self-contained
  // here rather than relying on app.js to remember to call resize() at the
  // right moment.
  function applySize(w, h) {
    if (w === 0 || h === 0) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function resize() {
    applySize(host.clientWidth, host.clientHeight);
  }
  const resizeObserver = new ResizeObserver((entries) => {
    const box = entries[0]?.contentBoxSize?.[0];
    if (box) applySize(box.inlineSize, box.blockSize);
    else resize();
  });
  resizeObserver.observe(host);
  resize();

  return {
    supported: true,
    canvas,

    setPanFraction(frac) {
      panFraction = Math.min(1, Math.max(0, frac));
    },

    projectPoint(nx, ny) {
      const [x, y, z] = sampleGridPosition(gw, gh, positions, nx, ny);
      const p = new THREE.Vector3(x, y, z).project(camera);
      const w = host.clientWidth, h = host.clientHeight;
      return {
        x: (p.x * 0.5 + 0.5) * w,
        y: (-p.y * 0.5 + 0.5) * h,
        visible: p.z <= 1 && p.z >= -1,
      };
    },

    // The inverse of projectPoint: given a click/tap at (clientX, clientY)
    // in viewport pixels, raycast against the real mesh and return the
    // normalised (x, y) on the ORIGINAL photo that point corresponds to —
    // this is what a compose-bubble click needs, since the visible surface
    // under the pointer has moved with the parallax camera and no longer
    // sits at a fixed linear fraction of the canvas the way a flat image
    // would. Returns null on a miss (e.g. a gap left by the edge cull).
    //
    // three.js's PlaneGeometry gives vertex (row r, col c) the UV
    // (c/(gw-1), 1 - r/(gh-1)) by construction (verified empirically, not
    // just assumed) — so a hit's uv.x is already the normalised x we want,
    // and ny is 1 - uv.y.
    pickPoint(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(mesh, false);
      if (hits.length === 0 || !hits[0].uv) return null;
      const { uv } = hits[0];
      return { x: Math.min(1, Math.max(0, uv.x)), y: Math.min(1, Math.max(0, 1 - uv.y)) };
    },

    resize,

    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      colorTex.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
