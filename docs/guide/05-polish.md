# Milestone 05 — Shareable links & live updates

**Goal:** the URL always encodes the current view so any player can copy a
link to exactly what they're looking at; the GM-update poll comes alive.

One new file (`js/url-state.js`) and a two-line renderer change. `main.js`
steps 4 and 7 — typed in back in milestone 01 — switch on by themselves.

## Concepts first: the hash, and debouncing

Everything after `#` in a URL (the *hash*) belongs to the page: changing it
doesn't reload anything, and it's the classic place to stash client-side
state. lotrproject.com's map does exactly this — that's where the idea
comes from.

Two APIs matter:

- `history.replaceState(null, "", "#…")` swaps the URL **without** adding a
  browser-history entry. If you assigned `location.hash` instead, every pan
  frame would become a history entry and the Back button would replay your
  entire mouse movement.
- The `hashchange` event fires when something *else* edits the hash — a
  player pasting a link into the open tab.

**Debouncing:** the renderer wants to write the hash on every frame of a
pan (60×/s). Writing that often is wasteful, so `writeViewToHash` resets a
timer each call and only really writes after the view has been still for
250 ms. `clearTimeout`/`setTimeout` is the whole trick — a pattern you'll
reuse constantly (search-as-you-type, autosave, resize handlers).

## Type in: `js/url-state.js` (complete)

```js
/**
 * url-state.js — shareable view links via the URL hash, e.g.
 *   #zoom=1.500&x=240&y=-120&layers=territory,culture
 */

let debounceTimer = null;

/**
 * Parse the current location.hash.
 * Returns null when the hash is absent or malformed.
 */
export function readViewFromHash() {
  if (location.hash.length < 2) return null;
  // URLSearchParams parses "a=1&b=2" strings — the hash minus its "#".
  const params = new URLSearchParams(location.hash.slice(1));
  const x = parseFloat(params.get("x"));
  const y = parseFloat(params.get("y"));
  const scale = parseFloat(params.get("zoom"));
  // parseFloat(null/garbage) gives NaN; reject anything non-finite.
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale)) {
    return null;
  }
  const layersParam = params.get("layers") ?? "";
  const layers = layersParam.split(",").filter((s) => s !== "");
  return { x, y, scale, layers };
}

/**
 * Write view state into the URL hash — debounced, so panning (which calls
 * this every frame) only touches the URL once the view settles for 250ms.
 * history.replaceState swaps the URL without adding a history entry;
 * assigning location.hash instead would make Back walk through every pan.
 */
export function writeViewToHash(state) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const params = new URLSearchParams();
    params.set("zoom", state.scale.toFixed(3));
    params.set("x", String(Math.round(state.x)));
    params.set("y", String(Math.round(state.y)));
    if (state.layers.length > 0) params.set("layers", state.layers.join(","));
    history.replaceState(null, "", `#${params.toString()}`);
  }, 250);
}

/**
 * Subscribe to hashchange (user pastes/edits a link while the app is open).
 * Only fires the callback for hashes that parse.
 */
export function onHashChange(callback) {
  window.addEventListener("hashchange", () => {
    const state = readViewFromHash();
    if (state !== null) callback(state);
  });
}
```

> **JS vs Python:** `parseFloat` is permissive (`parseFloat("3abc")` → 3)
> and returns `NaN` instead of raising on garbage. `NaN` is contagious and
> `NaN === NaN` is false, so the idiomatic validity check is
> `Number.isFinite(x)`, which is `False` for `NaN`, `±Infinity`, and
> non-numbers.

## Renderer: publish the view after every draw

Two import lines at the top of `js/renderer.js`:

```js
import { isLayerVisible, getVisibleLayerIds } from "./layers.js";  // extend the existing layers import
import { writeViewToHash } from "./url-state.js";                   // new
```

…and at the very end of `draw()` (after the annotation loop):

```js
    // Keep the shareable URL in sync (debounced inside url-state.js).
    writeViewToHash({
      x: view.x,
      y: view.y,
      scale: view.scale,
      layers: getVisibleLayerIds(),
    });
```

That's the whole milestone. Look back at `main.js`: step 4
(`applyHashState(renderer, readViewFromHash())` + `onHashChange`) has been
waiting since milestone 01 for `readViewFromHash` to return something other
than `null`; step 7's poll has been calling `checkForUpdates` all along.
Both are now live.

## Checkpoint

- Pan somewhere, stop, watch the address bar update ~a quarter second later.
- Copy the URL, open it in a private window → same view, same zoom.
- Add `&layers=territory` by hand → nothing visible changes *yet* (the
  territory layer has no tiles), but the switch flips on in the sidebar —
  `applyHashState` at work.
- Edit the hash in the address bar while the page is open and press Enter →
  the view jumps (`hashchange` path).
- The update poll: bump `"version"` in `data/manifest.json` to `2` and save.
  Within a minute the banner appears: *"The GM has updated the map —
  refresh to see what's new!"* (Put it back to 1 after.)
- Back/forward buttons do **not** replay your panning — that's
  `replaceState` doing its job.

## Common bugs

- **The Back button steps through every pan you ever made** — you assigned
  `location.hash` somewhere instead of using `replaceState`.
- **Hash updates lag forever / never appear** — the debounce timer is being
  reset by something that calls `writeViewToHash` continuously. Check you
  didn't put the call inside `pointermove` directly; it belongs in `draw()`.
- **Shared link opens at the default view** — `readViewFromHash` runs in
  `init()` *before* the first `render()`; if you reordered `init`, the
  reset in `createRenderer` may be clobbering the restored view.
- **`zoom=NaN` in the URL** — `view.scale` went bad somewhere upstream
  (usually a zoom handler dividing by zero); `Number.isFinite` guards on
  read, but fix the source.

---

# Where to go next

The app is feature-complete against the README. Ideas, roughly in order of
bang-for-buck:

1. **Implement `tools/slice-map.py`** (the stub documents the whole
   algorithm — Pillow's `Image.crop` does the work). That unlocks the real
   GM loop: slice → copy revealed tiles → update manifest → push.
2. **Overlay content** — produce one `tiles/territory/{x}_{y}.png`, add its
   coords to the manifest, and watch the whole overlay pipeline you already
   built light up.
3. **Smooth zoom animation** — lerp `view.scale` toward a target over a few
   frames instead of stepping. `requestAnimationFrame` loop + easing; very
   satisfying, ~20 lines.
4. **Marker permalinks** — `#marker=basecamp` that opens the popup on load.
   You have all the pieces (`url-state`, `markers`, `openMarkerPopup`).
5. **Hot tile reload** — when `checkForUpdates()` finds a new version,
   re-run `loadManifest()` and `render()` instead of asking for a refresh.
   The tile cache keying already tolerates it.
6. **A favicon-grade map screenshot** — `canvas.toBlob()` → download link;
   players love posting "where we are" shots.
