# Milestone 03 — Markers & layers

**Goal:** GM markers drawn as badges on the map, sidebar toggles built from
`markers.json` with live count badges, overlay switches wired, marker popups
on click, working search.

Four files change: `js/layers.js` and `js/markers.js` get written in full,
and `js/ui.js` + `js/renderer.js` each grow a section.

## Concepts first: `<template>` and module singletons as state holders

`index.html` contains `<template>` elements — inert chunks of markup the
browser parses but doesn't render. `template.content` is a
`DocumentFragment`; `cloneNode(true)` deep-copies it, you fill in the copy,
and `append` it into the page. It's string-formatting for DOM trees, without
the XSS hazards of building HTML strings. One gotcha worth tattooing
somewhere: **appending a fragment empties it** — query the nodes you need
*before* you append, or keep a reference to a real element inside it.

`layers.js` below is the smallest module in the app and the most
instructive: module-level `Set`s as state, exported getters/setters, and a
hand-rolled observer (`onLayersChanged`). The renderer reads this state
every frame; `ui.js` writes it; neither knows the other exists. That's the
whole architecture in miniature.

## Type in: `js/layers.js` (complete)

```js
/**
 * layers.js — visibility state for overlay layers and marker icon categories.
 * Single source of truth the renderer reads each frame; ui.js calls the
 * setters when switches flip.
 */

// Overlays the player has switched ON ("base" is always on and never stored).
const visibleOverlays = new Set();

// Categories the player has switched OFF (default-visible, so we store the
// exceptions — a new category from markers.json shows up enabled).
const hiddenCategories = new Set();

// Plain list of callbacks — a minimal observer pattern. main.js subscribes
// the renderer's render() here so any toggle repaints immediately.
const listeners = [];

function notify() {
  for (const callback of listeners) callback();
}

/** Is the given overlay layer visible? "base" always reports true. */
export function isLayerVisible(layerId) {
  return layerId === "base" || visibleOverlays.has(layerId);
}

/** Show/hide an overlay layer. */
export function setLayerVisible(layerId, visible) {
  if (layerId === "base") return; // the map itself can't be turned off
  if (visible) visibleOverlays.add(layerId);
  else visibleOverlays.delete(layerId);
  notify();
}

/** Overlay ids currently switched on (used for the shareable URL hash). */
export function getVisibleLayerIds() {
  return [...visibleOverlays]; // spread: Set -> Array, like list(s) in Python
}

/** Is a marker category visible? */
export function isCategoryVisible(categoryId) {
  return !hiddenCategories.has(categoryId);
}

/** Show/hide a marker category. */
export function setCategoryVisible(categoryId, visible) {
  if (visible) hiddenCategories.delete(categoryId);
  else hiddenCategories.add(categoryId);
  notify();
}

/** Register a callback fired after any visibility change. */
export function onLayersChanged(callback) {
  listeners.push(callback);
}
```

Storing *hidden* categories (not visible ones) is a deliberate choice: the
default for anything unknown is "visible", so when the GM adds a brand-new
category to `markers.json`, every player sees it without any migration.

## Type in: `js/markers.js` (complete)

```js
/**
 * markers.js — GM-authored markers: loading, lookup, hit-testing, search.
 */

import { MARKERS_URL } from "./config.js";
import { isCategoryVisible } from "./layers.js";

let categories = [];
let markers = [];
const iconByCategory = new Map(); // category id -> icon path

/**
 * Fetch and parse data/markers.json.
 */
export async function loadMarkers() {
  const response = await fetch(MARKERS_URL, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Could not load markers: HTTP ${response.status}`);
  }
  const data = await response.json();
  categories = data.categories ?? [];
  markers = data.markers ?? [];

  iconByCategory.clear();
  for (const cat of categories) iconByCategory.set(cat.id, cat.icon);

  return { categories, markers };
}

/** Loaded categories (empty before load). */
export function getCategories() {
  return categories;
}

/** Icon path for a category id (used by the renderer to draw markers). */
export function getCategoryIcon(categoryId) {
  return iconByCategory.get(categoryId) ?? "assets/icons/question.svg";
}

/** How many markers a category has (for the sidebar count badges). */
export function getCategoryCount(categoryId) {
  // filter + length, like len([m for m in markers if ...]) in Python
  return markers.filter((m) => m.category === categoryId).length;
}

/** Markers that should be drawn right now (visible categories only). */
export function getVisibleMarkers() {
  return markers.filter((m) => isCategoryVisible(m.category));
}

/**
 * Find the closest visible marker within `radius` world px of a point.
 */
export function hitTest(wx, wy, radius) {
  let best = null;
  let bestDistSq = radius * radius; // compare squared distances — no sqrt needed
  for (const m of getVisibleMarkers()) {
    const dx = m.x - wx;
    const dy = m.y - wy;
    const distSq = dx * dx + dy * dy;
    if (distSq <= bestDistSq) {
      best = m;
      bestDistSq = distSq;
    }
  }
  return best;
}

/**
 * Case-insensitive substring search over marker names.
 */
export function searchMarkers(query, limit = 10) {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  return markers
    .filter((m) => m.name.toLowerCase().includes(q))
    .slice(0, limit);
}
```

> **JS vs Python:** `markers.filter((m) => …)` is the list comprehension
> workhorse. `filter`, `map`, `find`, `some`, `slice` cover most of what
> you'd do with comprehensions; they all return new arrays and chain
> nicely.

## Renderer additions: draw the badges

Markers keep a fixed *screen* size regardless of zoom (like the Genshin
map) — a dark disc, a colored ring, the category's SVG icon centered inside.
GM markers get the blue accent ring; player annotations (next milestone)
get gold, so the two are distinguishable at a glance.

### 1. Extend the imports

**Replace** the two data-module import statements from milestone 02 with
these fuller versions (a module can't be imported twice with the same
binding names — extend the existing statements, don't add new ones):

```js
import {
  getVisibleMarkers,
  getCategoryIcon,
  hitTest as markerHitTest,
} from "./markers.js";
import {
  getAnnotations,
  addAnnotation,
  hitTest as annotationHitTest,
} from "./annotations.js";
```

and two color constants next to `BADGE_RADIUS`:

```js
const MARKER_RING = "#5aa9e6";     // GM markers: accent blue
const ANNOTATION_RING = "#e0b75c"; // player marks: gold, so they stand apart
```

### 2. Badge drawing (new section inside `createRenderer`, after `draw`)

```js
  // ---------- badges (markers & annotations) ----------

  // Badges keep a fixed SCREEN size regardless of zoom (like the Genshin
  // map): a dark disc, a colored ring, the icon centered inside.
  const iconCache = new Map(); // path -> HTMLImageElement

  function getIcon(path) {
    let img = iconCache.get(path);
    if (img === undefined) {
      img = new Image();
      img.onload = render; // repaint once the SVG is ready
      img.src = path;
      iconCache.set(path, img);
    }
    // complete && naturalWidth > 0 — loaded successfully
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  function drawBadge(wx, wy, iconPath, ringColor) {
    const p = worldToScreen(wx, wy);
    const r = BADGE_RADIUS;
    // Skip badges that are entirely off-screen.
    if (p.x < -r || p.y < -r || p.x > canvas.clientWidth + r || p.y > canvas.clientHeight + r) {
      return;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(20, 23, 28, 0.85)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = ringColor;
    ctx.stroke();

    const icon = getIcon(iconPath);
    if (icon) ctx.drawImage(icon, p.x - 8, p.y - 8, 16, 16);
  }
```

### 3. Call it from `draw()` — add right after `ctx.globalAlpha = 1;`

```js
    // Markers (GM) then annotations (player) — annotations draw on top.
    for (const m of getVisibleMarkers()) {
      drawBadge(m.x, m.y, getCategoryIcon(m.category), MARKER_RING);
    }
    for (const a of getAnnotations()) {
      drawBadge(a.x, a.y, `assets/icons/${a.icon}.svg`, ANNOTATION_RING);
    }
```

(`getAnnotations()` is still a stub returning `[]` — annotations appear in
milestone 04 with zero further renderer changes.)

## ui.js additions: toggles, popups, search

### 1. Extend the imports

```js
import { getManifest } from "./tile-manager.js";
import {
  setLayerVisible,
  setCategoryVisible,
  isCategoryVisible,
} from "./layers.js";
import {
  getCategories,
  getCategoryCount,
  getCategoryIcon,
  searchMarkers,
} from "./markers.js";
```

### 2. Update `initUI`

```js
export function initUI(r) {
  renderer = r;
  bindSidebarToggle();
  bindZoomControls();
  bindOverlayToggles();
  buildIconToggles();
  bindBulkButtons();
  bindSearch();
  bindErrorDismiss();
}
```

### 3. The toggle bindings (new section)

```js
// ---------- layer & category toggles ----------

function bindOverlayToggles() {
  const manifest = getManifest();
  const inputs = document.querySelectorAll("#overlay-toggle-list .switch__input");
  for (const input of inputs) {
    const layer = input.dataset.layer; // data-layer="territory" -> "territory"
    // Grey out overlays that have no tiles yet.
    const tiles = manifest.tiles[layer] ?? [];
    input.disabled = tiles.length === 0;
    input.addEventListener("change", () => {
      setLayerVisible(layer, input.checked);
    });
  }
}

function buildIconToggles() {
  const list = document.getElementById("icon-toggle-list");
  const template = document.getElementById("tpl-icon-toggle");
  list.replaceChildren(); // drop the static example row

  for (const category of getCategories()) {
    // template.content is an inert DocumentFragment; clone it, fill it in,
    // and grab the input BEFORE appending (the fragment empties on append).
    const row = template.content.cloneNode(true);
    const input = row.querySelector(".switch__input");
    input.dataset.category = category.id;
    input.checked = isCategoryVisible(category.id);
    row.querySelector(".switch__icon").src = category.icon;
    row.querySelector(".switch__label").textContent = category.name;
    row.querySelector(".switch__count").textContent = getCategoryCount(category.id);

    input.addEventListener("change", () => {
      setCategoryVisible(category.id, input.checked);
    });
    list.append(row);
  }
}

function bindBulkButtons() {
  const setAll = (checked) => {
    const inputs = document.querySelectorAll("#icon-toggle-list .switch__input");
    for (const input of inputs) {
      input.checked = checked;
      setCategoryVisible(input.dataset.category, checked);
    }
  };
  document.getElementById("icons-show-all").addEventListener("click", () => setAll(true));
  document.getElementById("icons-hide-all").addEventListener("click", () => setAll(false));
}
```

> **JS vs Python:** `input.dataset.layer` reads the `data-layer="…"`
> attribute — `dataset` is a dict-like view of every `data-*` attribute,
> the standard way to attach your own data to HTML elements.

Notice there's no "redraw the map" call anywhere here. `setCategoryVisible`
notifies `layers.js`'s listeners, and `main.js` already subscribed
`renderer.render` in step 5 of `init()`. Flip a switch → state changes →
observer fires → repaint. Each module did one job.

### 4. Search (new section)

```js
// ---------- search ----------

function bindSearch() {
  const input = document.getElementById("marker-search");
  const resultsList = document.getElementById("search-results");
  const template = document.getElementById("tpl-search-result");

  input.addEventListener("input", () => {
    const matches = searchMarkers(input.value);
    resultsList.replaceChildren();
    resultsList.classList.toggle("is-hidden", matches.length === 0);

    for (const marker of matches) {
      const row = template.content.cloneNode(true);
      const button = row.querySelector(".search-result__btn");
      button.dataset.markerId = marker.id;
      row.querySelector(".search-result__icon").src = getCategoryIcon(marker.category);
      row.querySelector(".search-result__name").textContent = marker.name;

      // The arrow function closes over THIS loop iteration's `marker` —
      // const per iteration makes this safe (a classic JS gotcha with var).
      button.addEventListener("click", () => {
        renderer.view.x = marker.x;
        renderer.view.y = marker.y;
        if (renderer.view.scale < 1) renderer.view.scale = 1;
        renderer.render();
        resultsList.classList.add("is-hidden");
        input.value = "";
      });
      resultsList.append(row);
    }
  });

  // Hide the dropdown on Escape.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") resultsList.classList.add("is-hidden");
  });
}
```

### 5. The marker popup — replace the milestone-02 placeholder

```js
// Place a popup near a screen point, clamped so it never leaves the map area.
function positionPopup(popup, sx, sy) {
  const bounds = popupLayer().getBoundingClientRect();
  // offsetWidth/Height are only measurable AFTER the element is in the DOM.
  const w = popup.offsetWidth;
  const h = popup.offsetHeight;
  const left = Math.min(Math.max(8, sx + 16), bounds.width - w - 8);
  const top = Math.min(Math.max(8, sy - h / 2), bounds.height - h - 8);
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

/**
 * Open a marker popup near a screen point.
 */
export function openMarkerPopup(marker, sx, sy) {
  closePopups();
  const fragment = document.getElementById("tpl-marker-popup").content.cloneNode(true);
  const popup = fragment.querySelector(".popup");
  popup.querySelector(".popup__title").textContent = marker.name;
  popup.querySelector(".popup__body").textContent = marker.note ?? "";
  popup.querySelector(".popup__close").addEventListener("click", closePopups);
  popupLayer().append(popup);
  positionPopup(popup, sx, sy);
}
```

## Checkpoint

- Three blue-ringed badges on the map (Basecamp, Old Watchtower, Marsh of
  Teeth). They keep their size as you zoom; the *positions* track the map.
- The Icons section now lists three categories, each with its SVG and a
  count badge of `1`. The hardcoded "Settlements" example row is gone.
- Toggling a category off removes its badge instantly. Hide all / Show all
  work. The overlay switches are greyed out (their tile lists are empty in
  the manifest — correct).
- Click a badge → popup with the marker's name and note; click the map or
  start a drag → it closes; the × works too.
- Type "marsh" in the search box → one result; click it → the view jumps to
  the Marsh of Teeth.
- The boot-time `markers failed to load` warning is gone from the Console.

## Common bugs

- **Toggle rows appear but clicking them does nothing** — you queried the
  `<input>` *after* `list.append(row)`. The fragment is empty by then;
  `row.querySelector` returns null and your listener went nowhere. Query
  first, append last.
- **All toggles control the last category** — you used `var` (or hoisted the
  loop variable out). With `const category of getCategories()` each
  iteration gets its own binding and each arrow function captures its own.
- **Badges don't show until you wiggle the map** — `getIcon` isn't passing
  `render` as `img.onload`, so the first frame (icon not loaded yet) is
  never repainted.
- **Popup appears at the wrong corner or off-screen** — `positionPopup` ran
  before `append`, when `offsetWidth` is 0. Append first, then measure,
  then set `left/top`.
- **`manifest.tiles[layer] is undefined` crash** — `bindOverlayToggles` ran
  before `loadManifest` finished. Check `init()` order: data loads first,
  `initUI` runs after.
