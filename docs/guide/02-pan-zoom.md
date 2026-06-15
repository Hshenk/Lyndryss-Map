# Milestone 02 — Pan & zoom

**Goal:** drag to pan, wheel to zoom at the cursor, pinch on touch, working
zoom buttons, live coordinate readout.

Two files change: `js/renderer.js` grows its input section, and `js/ui.js`
gets its first real version (the chrome: sidebar toggle, zoom buttons, error
banner).

## Concepts first: events, and why there's no `self`

Browsers deliver input as **events**: you register a callback with
`element.addEventListener(type, fn)` and the browser calls `fn(event)`
whenever it happens. The `event` object carries everything about the
interaction (`clientX`, `deltaY`, `pointerId`, …) plus control methods like
`preventDefault()` ("I'm handling this — don't also scroll the page").

We use **pointer events** (`pointerdown`/`pointermove`/`pointerup`), which
unify mouse, touch, and stylus. Each contact gets a `pointerId`: a mouse is
one pointer, two fingers are two — track them in a `Map` and pinch-zoom
falls out naturally.

> **JS vs Python:** notice that the handlers below reach for `view`,
> `pointers`, `canvas` directly — no `self.view`. They're closures inside
> `createRenderer`, so they capture those variables from the enclosing call.
> This is also why we can pass `render` around as a bare value (to
> `requestAnimationFrame`, to `img.onload`) without Python's
> `functools.partial` or worrying about JS's `this` — the function carries
> its environment with it.

## Renderer additions

### 1. New imports and constants

Update the imports at the top of `js/renderer.js`:

```js
import { MIN_SCALE, MAX_SCALE, OVERLAY_ALPHA } from "./config.js";
import { getTileImage } from "./tile-manager.js";
import { isLayerVisible } from "./layers.js";
import { hitTest as markerHitTest } from "./markers.js";
import { addAnnotation, hitTest as annotationHitTest } from "./annotations.js";
import { getUIState, openMarkerPopup, openNotePopup, closePopups } from "./ui.js";
```

> **JS vs Python:** `import { hitTest as markerHitTest }` is
> `from markers import hitTest as marker_hit_test` — both data modules
> export a `hitTest`, so rename on import.

Add module-level constants above `createRenderer`:

```js
/** Radius (screen px) of the round badge markers/annotations are drawn in. */
const BADGE_RADIUS = 12;
/** Pointer movement (px) below which a press counts as a click, not a drag. */
const CLICK_SLOP = 5;
/** Zoom factor per wheel notch. */
const WHEEL_STEP = 1.1;
```

And grab the readout element near the top of `createRenderer`, next to `ctx`:

```js
const coordsEl = document.getElementById("coords-readout");
```

### 2. Zoom — the keep-the-cursor-fixed trick

Add below `resize()`. The math: the world point under the cursor must be at
the same screen position before and after the scale change. Convert the
cursor to world coords, change the scale, convert again — the difference is
exactly how far the view must shift to compensate.

```js
  // ---------- zoom ----------

  function zoomBy(factor, cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2) {
    // Zoom-to-cursor: the world point under (cx, cy) must be at the same
    // screen position after the scale change. Convert before, rescale,
    // convert after, and pan by the difference.
    const before = screenToWorld(cx, cy);
    view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    const after = screenToWorld(cx, cy);
    view.x += before.x - after.x;
    view.y += before.y - after.y;
    render();
  }

  function resetView() {
    view.x = tileSize / 2;
    view.y = tileSize / 2;
    view.scale = 1;
    render();
  }
```

(`cx = canvas.clientWidth / 2` in the parameter list is a default argument,
exactly like Python's — call `zoomBy(1.2)` and it zooms at the canvas
center, which is what the sidebar buttons want.)

### 3. Pointer input — pan, pinch, click detection

```js
  // ---------- pointer input (pan / pinch / click) ----------

  // Event coords -> canvas-relative CSS px. Don't use e.offsetX for this:
  // it's measured against whatever element the pointer is over (not always
  // the canvas), and misbehaves under page zoom. clientX minus the
  // canvas's bounding rect is reliable everywhere.
  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // All active pointers (a mouse is one; two fingers are two).
  const pointers = new Map(); // pointerId -> { x, y }
  let dragDistance = 0;       // accumulated movement, to tell click from drag
  let lastPinchDist = null;   // finger distance on the previous move event

  canvas.addEventListener("pointerdown", (e) => {
    // Capture: keep receiving move/up for this pointer even if it leaves
    // the canvas mid-drag. Can throw if the pointer is already gone
    // (e.g. a finger lifted in the same instant) — capture is just a
    // nicety, so don't let that break the handler.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    pointers.set(e.pointerId, canvasPoint(e));
    dragDistance = 0;
    if (pointers.size === 1) document.body.classList.add("is-panning");
    closePopups();
  });

  canvas.addEventListener("pointermove", (e) => {
    const cur = canvasPoint(e);

    // Coordinate readout (world coords under the cursor).
    const wpt = screenToWorld(cur.x, cur.y);
    coordsEl.textContent = `${Math.round(wpt.x)}, ${Math.round(wpt.y)}`;

    if (!pointers.has(e.pointerId)) return; // hovering, no button down

    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, cur);

    if (pointers.size === 1) {
      // Drag-to-pan. Screen moves right -> world center moves left,
      // and screen px convert to world px by dividing by scale.
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      dragDistance += Math.abs(dx) + Math.abs(dy);
      view.x -= dx / view.scale;
      view.y -= dy / view.scale;
      render();
    } else if (pointers.size === 2) {
      // Pinch zoom: scale by the ratio of finger distances, centered on
      // the midpoint between the fingers.
      const [p1, p2] = [...pointers.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      if (lastPinchDist !== null && lastPinchDist > 0) {
        zoomBy(dist / lastPinchDist, mid.x, mid.y);
      }
      lastPinchDist = dist;
      dragDistance = Infinity; // a pinch is never a click
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinchDist = null;
    if (pointers.size === 0) {
      document.body.classList.remove("is-panning");
      if (e.type === "pointerup" && dragDistance < CLICK_SLOP) {
        const p = canvasPoint(e);
        handleClick(p.x, p.y);
      }
    }
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  // Wheel zoom. { passive: false } tells the browser we really will call
  // preventDefault (otherwise scroll performance heuristics ignore it).
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault(); // don't scroll the page
      const p = canvasPoint(e);
      zoomBy(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, p.x, p.y);
    },
    { passive: false }
  );
```

Why does pinch work without special cases? Because `zoomBy` already knows
how to zoom around an arbitrary point — the pinch handler just feeds it the
finger midpoint and the distance ratio. Good decomposition pays out fast.

(The CSS already set `touch-action: none` on the canvas, which is what stops
the browser from hijacking touch gestures for page scrolling before your
handlers ever see them.)

### 4. Click routing

A "click" is a press that didn't move more than `CLICK_SLOP` px. This
function routes it: placement tools first (armed in milestone 04), then
hit-testing annotations and markers (alive in milestones 03–04 — today the
stubs return `null` and clicks do nothing, which is correct for an empty
map).

```js
  // ---------- click handling ----------

  function handleClick(sx, sy) {
    const wpt = screenToWorld(sx, sy);
    const ui = getUIState();

    // Placement tools (armed in the sidebar) win over hit-testing.
    if (ui.activeTool === "icon" || ui.activeTool === "note") {
      const annotation = {
        id: crypto.randomUUID(),
        kind: ui.activeTool,
        icon: ui.activeTool === "icon" ? ui.selectedIcon : "question",
        x: wpt.x,
        y: wpt.y,
        text: "",
      };
      addAnnotation(annotation);
      if (ui.activeTool === "note") openNotePopup(annotation, sx, sy);
      render();
      return;
    }

    // Normal click: annotations first (they're drawn on top), then markers.
    // The hit radius is the badge size converted to world px, so the click
    // target stays comfortable at any zoom.
    const radius = (BADGE_RADIUS + 4) / view.scale;
    const annotation = annotationHitTest(wpt.x, wpt.y, radius);
    if (annotation) {
      const p = worldToScreen(annotation.x, annotation.y);
      openNotePopup(annotation, p.x, p.y);
      return;
    }
    const marker = markerHitTest(wpt.x, wpt.y, radius);
    if (marker) {
      const p = worldToScreen(marker.x, marker.y);
      openMarkerPopup(marker, p.x, p.y);
    }
  }
```

### 5. Update the returned object

```js
  return { view, render, resize, worldToScreen, screenToWorld, zoomBy, resetView };
```

## Type in: `js/ui.js` (version 1 — chrome only)

Replace the stub file with this. The popup functions stay as placeholders —
the renderer imports them, so they must *exist*, but they get bodies in
milestones 03–04.

```js
/**
 * ui.js — wires DOM controls to the other modules.
 */

import { ZOOM_STEP } from "./config.js";

// The renderer instance, handed to us by main.js in initUI().
let renderer = null;

// Annotation tool state. renderer.handleClick reads this via getUIState().
const state = {
  activeTool: "pan", // "pan" | "icon" | "note"
  selectedIcon: "flag",
};

/** Snapshot of the tool state ({ ...state } copies it, like dict(state)). */
export function getUIState() {
  return { ...state };
}

/**
 * Bind every control. Call once from main.js after data + renderer exist.
 */
export function initUI(r) {
  renderer = r;
  bindSidebarToggle();
  bindZoomControls();
  bindErrorDismiss();
}

// ---------- header / sidebar chrome ----------

function bindSidebarToggle() {
  const button = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("sidebar");
  button.addEventListener("click", () => {
    // classList.toggle returns true if the class is now PRESENT
    const collapsed = sidebar.classList.toggle("sidebar--collapsed");
    button.setAttribute("aria-expanded", String(!collapsed));
  });
}

function bindZoomControls() {
  document.getElementById("zoom-in").addEventListener("click", () => {
    renderer.zoomBy(ZOOM_STEP);
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    renderer.zoomBy(1 / ZOOM_STEP);
  });
  document.getElementById("zoom-reset").addEventListener("click", () => {
    renderer.resetView();
  });
}

// ---------- popups ----------

function popupLayer() {
  return document.getElementById("popup-layer");
}

/** Close any open popup. */
export function closePopups() {
  popupLayer().replaceChildren();
}

/** Marker popup — implemented in milestone 03. */
export function openMarkerPopup(marker, sx, sy) {
  // TODO (milestone 03)
}

/** Note popup — implemented in milestone 04. */
export function openNotePopup(annotation, sx, sy) {
  // TODO (milestone 04)
}

// ---------- error banner ----------

function bindErrorDismiss() {
  document.getElementById("error-banner-dismiss").addEventListener("click", () => {
    document.getElementById("error-banner").classList.add("is-hidden");
  });
}

/**
 * Show the error banner with a message.
 */
export function showError(message) {
  document.getElementById("error-banner-text").textContent = message;
  document.getElementById("error-banner").classList.remove("is-hidden");
}
```

## Checkpoint

- Drag the map around; the cursor turns to a grabbing hand (`body.is-panning`
  + the CSS you already have).
- Wheel-zoom on a coastline: the point under your cursor stays put while the
  map scales around it. If it slides, your `zoomBy` is zooming around the
  center instead of the cursor.
- `+` / `−` buttons zoom at the center; the target button re-centers on
  tile (0,0).
- Bottom-left readout tracks the cursor in world coordinates: ~`0, 0` over
  the corner where the four starter tiles around the origin meet.
- The ☰ button collapses the sidebar; the zoom buttons slide right to fill
  the space (pure CSS reacting to the class your JS toggles).
- On a phone/touchscreen (or DevTools device mode): one finger pans, two
  fingers pinch-zoom.

## Common bugs

- **Click/zoom positions are off by a constant amount** — you used
  `e.offsetX`. It's measured against whatever element the event targets and
  lies under page zoom. Always go through `canvasPoint(e)`
  (`clientX − getBoundingClientRect().left`). Found this one the hard way
  while testing this exact code.
- **Wheel zoom also scrolls the page / Console warns about passive
  listeners** — missing `{ passive: false }` on the `wheel` listener;
  Chrome then ignores your `preventDefault()`.
- **Pan inverts** — flip the signs: dragging right means the *world point
  under the cursor* moves right, so the view center moves left
  (`view.x -= dx / scale`).
- **Zoom "drifts" at min/max scale** — clamp the scale *before* computing
  `after` (the code above does: the clamp happens on assignment, between
  the two `screenToWorld` calls). If you clamp afterwards, the compensation
  pan was computed for a scale change that didn't fully happen.
- **Drag keeps going after releasing the button outside the window** —
  you didn't hook `pointercancel`, or capture failed silently. Both
  `pointerup` and `pointercancel` must run `endPointer`.
- **`crypto.randomUUID is not a function`** — only available in secure
  contexts. `localhost` and GitHub Pages (https) are fine; a LAN IP over
  plain http is not. Develop on `localhost`.
