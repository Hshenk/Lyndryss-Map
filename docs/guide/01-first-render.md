# Milestone 01 — First render

**Goal:** the 12 starter tiles drawn on the canvas, header showing the
manifest version, loading overlay gone.

You'll write three files this milestone: all of `js/tile-manager.js`, a first
version of `js/renderer.js`, and all of `js/main.js` (it never changes
again). `js/config.js` is already complete — read it first; everything
imports constants from it.

## Concepts first: fetch, Promises, async images

`fetch(url)` starts an HTTP request and immediately returns a **Promise** —
a token for a value that doesn't exist yet (Python's `asyncio.Future`).
`await` suspends the current `async` function until the value arrives. The
rest of the page keeps running; that's the whole point.

> **JS vs Python:** Python makes you *opt in* to async (start an event loop,
> `asyncio.run`). In the browser it's the default reality — there is no
> blocking `requests.get`. Anything that touches the network gives you a
> Promise whether you like it or not. The `async`/`await` keywords then read
> identically to Python's.

Images are sneakier: `new Image()` plus `img.src = url` starts a download
with **no Promise at all** — you get told via the `img.onload` callback,
whenever the bytes arrive. So "give me tile (3,2)" has three possible
answers: *here it is* (cached), *it doesn't exist* (not in the manifest), or
*not yet* (downloading — I'll call you back). That three-way answer is the
entire design of `getTileImage`, and the renderer is built around the
"not yet → call me back → redraw" case: the map visibly fills in as tiles
arrive.

## Type in: `js/tile-manager.js` (complete)

```js
/**
 * tile-manager.js — fetches the manifest and loads/caches tile images.
 */

import { MANIFEST_URL, DEFAULT_TILE_SIZE, tileUrl } from "./config.js";

// Module-level state. Because ES modules are singletons (imported once,
// shared everywhere), these act like a private namespace — closer to a
// Python module's globals than anything in C++.
let manifest = null;

// layer id -> Set of "x,y" strings. A Set gives O(1) membership tests,
// like Python's `in` on a set. We key by string because JS Sets compare
// objects/arrays by identity, not value — new Set([[0,0]]).has([0,0]) is
// false! Strings compare by value, so "0,0" works.
const tileIndex = new Map();

// "layer/x,y" -> { img: HTMLImageElement, loaded: boolean }
const imageCache = new Map();

/**
 * Fetch and parse data/manifest.json.
 */
export async function loadManifest() {
  // fetch() returns a Promise — `await` pauses this function (not the whole
  // page) until it resolves, just like Python's asyncio `await`.
  const response = await fetch(MANIFEST_URL, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Could not load manifest: HTTP ${response.status}`);
  }
  manifest = await response.json();

  // Defensive defaults so a sparse manifest doesn't crash the app.
  manifest.tileSize = manifest.tileSize ?? DEFAULT_TILE_SIZE;
  manifest.layers = manifest.layers ?? ["base"];
  manifest.tiles = manifest.tiles ?? {};

  // Build the fast lookup index.
  tileIndex.clear();
  for (const layer of manifest.layers) {
    const coords = manifest.tiles[layer] ?? [];
    // Destructuring: ([x, y]) unpacks each two-element array, like
    // Python's `for x, y in coords`.
    tileIndex.set(layer, new Set(coords.map(([x, y]) => `${x},${y}`)));
  }
  return manifest;
}

/** The loaded manifest (null before loadManifest resolves). */
export function getManifest() {
  return manifest;
}

/**
 * Does tile (x, y) exist on `layer` per the loaded manifest?
 * render() calls this for every tile in view, every frame — hence the Set.
 */
export function hasTile(layer, x, y) {
  const set = tileIndex.get(layer);
  return set !== undefined && set.has(`${x},${y}`);
}

/**
 * Get the Image for tile (x, y), loading it on first request.
 * Returns the cached HTMLImageElement if loaded, else null. If this call
 * started a load, `onReady` fires once when the image arrives so the
 * renderer can redraw. Never throws for a missing tile.
 */
export function getTileImage(layer, x, y, onReady) {
  if (!hasTile(layer, x, y)) return null;

  const key = `${layer}/${x},${y}`;
  let entry = imageCache.get(key);

  if (entry === undefined) {
    // First request: start an async load. Setting img.src kicks off the
    // download in the background; onload fires later via the event loop.
    const img = new Image();
    entry = { img, loaded: false };
    imageCache.set(key, entry);

    img.onload = () => {
      entry.loaded = true;
      if (onReady) onReady();
    };
    // A 404 here means manifest and tiles/ disagree. Swallow it — the
    // contract says a missing tile is just "not drawn", never an error.
    img.onerror = () => {};
    img.src = tileUrl(layer, x, y);
  }

  return entry.loaded ? entry.img : null;
}
```

> **JS vs Python:** `??` is the *nullish coalescing* operator:
> `a ?? b` is `b` only when `a` is `null` or `undefined`. It's the safe
> version of Python's `a or b` (which would also replace `0`, `""`, `false`).
> You'll see it everywhere in this codebase.

Two new exports beyond the original stub (`getManifest`) — `ui.js` and
`main.js` will need it later. Delete the stub's `getManifest`-less leftovers
if you kept any.

## Type in: `js/renderer.js` (version 1 — tiles only)

Replace the stub's `createRenderer` with this. Input handling, markers, and
badges come in milestones 02–03; this version only sizes the canvas,
transforms coordinates, and draws tiles.

```js
/**
 * renderer.js — the hand-rolled canvas renderer: viewport state, coordinate
 * transforms, pan/zoom input, and the draw loop.
 */

import { OVERLAY_ALPHA } from "./config.js";
import { getTileImage } from "./tile-manager.js";
import { isLayerVisible } from "./layers.js";

/**
 * Create the renderer bound to a canvas.
 *
 * This is a "closure-based object": every function below shares `view`,
 * `ctx`, etc. through the enclosing scope — no `this`, no class. It's the
 * JS equivalent of a Python class instance where the captured variables
 * are the attributes.
 */
export function createRenderer(canvas, manifest) {
  const ctx = canvas.getContext("2d");
  const tileSize = manifest.tileSize;

  // (view.x, view.y) = the world point at the canvas center.
  // scale = screen px per world px.
  const view = { x: tileSize / 2, y: tileSize / 2, scale: 1 };

  // ---------- coordinate transforms ----------

  function worldToScreen(wx, wy) {
    return {
      x: (wx - view.x) * view.scale + canvas.clientWidth / 2,
      y: (wy - view.y) * view.scale + canvas.clientHeight / 2,
    };
  }

  function screenToWorld(sx, sy) {
    return {
      x: (sx - canvas.clientWidth / 2) / view.scale + view.x,
      y: (sy - canvas.clientHeight / 2) / view.scale + view.y,
    };
  }

  // ---------- render loop (rAF-coalesced) ----------

  // Many things ask for a redraw (pan, zoom, a tile finishing its load,
  // a toggle flipping). Drawing immediately every time would waste work,
  // so render() just sets a flag and lets the browser call draw() once
  // before the next repaint via requestAnimationFrame.
  let frameRequested = false;

  function render() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(draw);
  }

  function draw() {
    frameRequested = false;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // Which tile coords are in view? Transform the two screen corners to
    // world space, divide by tileSize, floor — exactly like indexing into
    // a 2D grid in any language.
    const topLeft = screenToWorld(0, 0);
    const bottomRight = screenToWorld(w, h);
    const x0 = Math.floor(topLeft.x / tileSize);
    const x1 = Math.floor(bottomRight.x / tileSize);
    const y0 = Math.floor(topLeft.y / tileSize);
    const y1 = Math.floor(bottomRight.y / tileSize);

    for (const layer of manifest.layers) {
      if (!isLayerVisible(layer)) continue;
      ctx.globalAlpha = layer === "base" ? 1 : OVERLAY_ALPHA;

      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          // Passing render as onReady means: when this tile's PNG finishes
          // downloading, redraw — the map "fills in" as tiles arrive.
          const img = getTileImage(layer, tx, ty, render);
          if (img === null) continue;

          // Compute LEFT and RIGHT edges independently and round each,
          // then derive the width. If you instead round the position and
          // the size separately, neighbouring tiles drift apart by a
          // pixel at some zoom levels and you get seams.
          const a = worldToScreen(tx * tileSize, ty * tileSize);
          const b = worldToScreen((tx + 1) * tileSize, (ty + 1) * tileSize);
          const left = Math.round(a.x);
          const top = Math.round(a.y);
          ctx.drawImage(img, left, top, Math.round(b.x) - left, Math.round(b.y) - top);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- sizing / devicePixelRatio ----------

  // CSS stretches the canvas element to fill its container, but the canvas
  // BITMAP has its own resolution (canvas.width/height). On a 2x display,
  // a 800-CSS-px canvas needs a 1600-px bitmap or everything looks blurry.
  // setTransform(dpr, ...) then lets all drawing code keep thinking in
  // CSS px while the bitmap stays sharp.
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    // Setting canvas.width resets ALL canvas state, so re-apply the scale.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  new ResizeObserver(resize).observe(canvas.parentElement);
  resize(); // initial sizing

  // The object other modules talk to. Shorthand property names:
  // { view } means { view: view }.
  return { view, render, resize, worldToScreen, screenToWorld };
}
```

Why does `isLayerVisible` work when you haven't written `layers.js` yet?
Because the stub already returns `true` for `"base"` and `false` for
everything else — exactly right for now. This pattern repeats all guide
long: code against the interface, fill in modules when their milestone
comes.

The transforms deserve a minute of staring. Both are the same equation
solved for different variables:

```
screen = (world − view.center) · scale + canvasSize/2
world  = (screen − canvasSize/2) / scale + view.center
```

Pin them in your head now; every feature after this is built on them.

## Type in: `js/main.js` (complete — never changes again)

```js
/**
 * main.js — entry point. Owns the boot sequence and nothing else.
 */

import { MANIFEST_URL } from "./config.js";
import { loadManifest, getManifest } from "./tile-manager.js";
import { loadMarkers } from "./markers.js";
import { createRenderer } from "./renderer.js";
import { loadAnnotations } from "./annotations.js";
import { readViewFromHash, onHashChange } from "./url-state.js";
import { onLayersChanged, setLayerVisible } from "./layers.js";
import { initUI, showError } from "./ui.js";

/** How often to check whether the GM pushed a new map (ms). */
const UPDATE_POLL_MS = 60_000;

async function init() {
  const loadingOverlay = document.getElementById("loading-overlay");
  try {
    // 1. Data first — everything else depends on the manifest.
    const manifest = await loadManifest();
    document.getElementById("map-version").textContent = `v${manifest.version}`;
    document.getElementById("map-updated").textContent = manifest.updated ?? "—";

    // Markers failing shouldn't kill the map — catch, warn, move on.
    // (Until milestone 03 the stub throws, so this catch runs every boot.
    // That's fine and expected.)
    try {
      await loadMarkers();
    } catch (err) {
      console.warn("markers failed to load:", err);
    }

    // 2. Player annotations from localStorage (synchronous, can't fail).
    loadAnnotations();

    // 3. The renderer.
    const canvas = document.getElementById("map-canvas");
    const renderer = createRenderer(canvas, manifest);

    // 4. If the URL carries a view (shared link), jump there.
    //    (Inert until milestone 05 — the stub returns null.)
    applyHashState(renderer, readViewFromHash());
    onHashChange((state) => applyHashState(renderer, state));

    // 5. UI wiring, and repaint whenever a toggle changes.
    initUI(renderer);
    onLayersChanged(renderer.render);

    // 6. First frame, then reveal the map.
    renderer.render();
    loadingOverlay.classList.add("is-hidden");

    // Debug hook: lets you poke the app from the DevTools console, e.g.
    //   lyndryss.renderer.view.scale = 2; lyndryss.renderer.render()
    window.lyndryss = { renderer, manifest };

    // 7. Politely nag when the GM pushes an update mid-session.
    setInterval(async () => {
      if (await checkForUpdates()) {
        showError("The GM has updated the map — refresh to see what's new!");
      }
    }, UPDATE_POLL_MS);
  } catch (err) {
    console.error(err);
    loadingOverlay.classList.add("is-hidden");
    showError("Could not load the map. Try refreshing the page.");
  }
}

/** Apply a parsed hash state (view + enabled overlays) to the app. */
function applyHashState(renderer, state) {
  if (state === null) return;
  renderer.view.x = state.x;
  renderer.view.y = state.y;
  renderer.view.scale = state.scale;
  for (const layerId of state.layers) {
    setLayerVisible(layerId, true);
    // Reflect it in the sidebar switch too.
    const input = document.querySelector(`.switch__input[data-layer="${layerId}"]`);
    if (input) input.checked = true;
  }
  renderer.render();
}

/**
 * Has the GM pushed a manifest with a newer version than the one loaded?
 */
export async function checkForUpdates() {
  try {
    // cache: "no-cache" forces a revalidation so we see the fresh file.
    const response = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!response.ok) return false;
    const fresh = await response.json();
    const current = getManifest();
    return current !== null && fresh.version > current.version;
  } catch {
    return false; // offline etc. — just try again next poll
  }
}

document.addEventListener("DOMContentLoaded", init);
```

Read the numbered steps and notice how much of this file is calls into
modules that are still stubs (`initUI`, `loadAnnotations`,
`readViewFromHash`, …). All safe no-ops. As you complete milestones 02–05,
features switch on without `main.js` changing — that's the payoff of
defining module interfaces before implementations.

> **JS vs Python:** `60_000` — numeric underscore separators, same as
> Python. And `document.addEventListener("DOMContentLoaded", init)` is the
> browser's `if __name__ == "__main__"`: run `init` once the HTML is parsed.

## Checkpoint

Serve, open <http://localhost:8000>, and you should see:

- the 12 starter tiles rendered as one seamless map, centered near tile (0,0)
- `v1` and the date in the header
- the loading overlay gone
- in the Console: one `markers failed to load` warning (expected until
  milestone 03) and nothing red
- in the Console, `lyndryss.renderer.view.scale = 0.4` then
  `lyndryss.renderer.render()` zooms the map out — your transforms work

## Common bugs

- **Blank page, Console says "Failed to fetch" / CORS** — you opened
  `index.html` as a file. Modules require HTTP; use the local server.
- **`[object Promise]` in the header, or `.version` is undefined** — a
  missing `await`. You stored the Promise instead of the value.
- **Map is blurry** — `resize()` isn't multiplying by `devicePixelRatio`,
  or you sized the canvas with CSS only and never set `canvas.width`.
- **Map draws once at the wrong size after a window resize** — remember
  `canvas.width = …` wipes the context's transform; `setTransform` must be
  re-applied inside `resize()`, not once at startup.
- **Tiles 404 in the Network tab** — manifest coords and `tiles/base/`
  filenames disagree. The filename format is `{x}_{y}.png`, negatives
  included: `-1_0.png`.
- **Some tiles never appear until you nudge the view** — you forgot to pass
  `render` as the `onReady` argument in the draw loop, so late-arriving
  tiles never trigger a repaint.
