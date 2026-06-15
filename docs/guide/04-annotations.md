# Milestone 04 — Player annotations

**Goal:** players place gold-ringed icons and notes on the map, edit and
delete them, clear them all — and everything survives a refresh via
`localStorage`.

Two files change: `js/annotations.js` gets written in full, and `js/ui.js`
gets its last section. The renderer already draws annotations (milestone 03)
and already places them on click (milestone 02's `handleClick`) — this
milestone just makes the data real.

## Concepts first: localStorage

`localStorage` is a tiny per-site key→string store that survives reloads
and browser restarts. It's synchronous, it only holds strings, and it's
scoped to the origin — every player has their own private copy, which is
exactly the README's requirement ("not shared, not saved to the map").

> **JS vs Python:** `JSON.stringify(x)` is `json.dumps(x)`,
> `JSON.parse(s)` is `json.loads(s)`. The pairing with localStorage is
> idiomatic: serialize on write, parse on read, and treat anything that
> fails to parse as missing data — a player's old/corrupt storage must
> never brick the app. That's why every touch below is wrapped in
> try/catch.

## Type in: `js/annotations.js` (complete)

```js
/**
 * annotations.js — player-placed icons and notes, persisted to localStorage.
 */

import { ANNOTATIONS_STORAGE_KEY } from "./config.js";

let annotations = [];

// localStorage can throw (private browsing, quota) — never let persistence
// failures break the map, so every touch is wrapped in try/catch.
function save() {
  try {
    // localStorage only stores strings, so serialize — JSON.stringify is
    // Python's json.dumps; JSON.parse below is json.loads.
    localStorage.setItem(ANNOTATIONS_STORAGE_KEY, JSON.stringify(annotations));
  } catch {
    // Storage unavailable — annotations just won't survive a refresh.
  }
}

/**
 * Load saved annotations from localStorage into module state.
 * Bad/missing data degrades to "no annotations", never an error.
 */
export function loadAnnotations() {
  try {
    const raw = localStorage.getItem(ANNOTATIONS_STORAGE_KEY);
    const parsed = raw === null ? [] : JSON.parse(raw);
    annotations = Array.isArray(parsed) ? parsed : [];
  } catch {
    annotations = [];
  }
  return annotations;
}

/** Current annotations for the renderer to draw. */
export function getAnnotations() {
  return annotations;
}

/** Add one annotation and persist. */
export function addAnnotation(annotation) {
  annotations.push(annotation);
  save();
}

/** Update an existing annotation (e.g. note text edited) and persist. */
export function updateAnnotation(id, changes) {
  const target = annotations.find((a) => a.id === id);
  if (target) {
    Object.assign(target, changes); // like dict.update() in Python
    save();
  }
}

/** Remove one annotation and persist. */
export function removeAnnotation(id) {
  annotations = annotations.filter((a) => a.id !== id);
  save();
}

/** Remove everything (the "Clear all my marks" button). */
export function clearAnnotations() {
  annotations = [];
  save();
}

/**
 * Closest annotation within `radius` world px — same shape as
 * markers.hitTest so clicks can prefer annotations over markers.
 */
export function hitTest(wx, wy, radius) {
  let best = null;
  let bestDistSq = radius * radius;
  for (const a of annotations) {
    const dx = a.x - wx;
    const dy = a.y - wy;
    const distSq = dx * dx + dy * dy;
    if (distSq <= bestDistSq) {
      best = a;
      bestDistSq = distSq;
    }
  }
  return best;
}
```

## ui.js additions: tools, palette, note popup

### 1. Extend the imports

```js
import {
  updateAnnotation,
  removeAnnotation,
  clearAnnotations,
} from "./annotations.js";
```

### 2. Update `initUI` (final form)

```js
export function initUI(r) {
  renderer = r;
  bindSidebarToggle();
  bindZoomControls();
  bindOverlayToggles();
  buildIconToggles();
  bindBulkButtons();
  bindAnnotationTools();
  bindSearch();
  bindErrorDismiss();
}
```

### 3. The tools (new section)

How the pieces meet: these buttons only mutate `state`. The renderer's
`handleClick` (typed in back in milestone 02) reads that state on every
canvas click and does the placing. Sidebar arms the tool; canvas fires it.

```js
// ---------- annotation tools ----------

function bindAnnotationTools() {
  const toolButtons = [
    document.getElementById("tool-place-icon"),
    document.getElementById("tool-place-note"),
  ];

  for (const button of toolButtons) {
    button.addEventListener("click", () => {
      // Clicking the active tool disarms it; otherwise switch to it.
      const tool = button.dataset.tool;
      state.activeTool = state.activeTool === tool ? "pan" : tool;

      for (const b of toolButtons) {
        const active = b.dataset.tool === state.activeTool;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", String(active));
      }
      // Crosshair cursor over the map while a tool is armed.
      document.body.classList.toggle("is-placing", state.activeTool !== "pan");
    });
  }

  // Icon palette: remember the chosen swatch.
  const swatches = document.querySelectorAll("#annotation-icon-palette .icon-palette__swatch");
  for (const swatch of swatches) {
    swatch.addEventListener("click", () => {
      state.selectedIcon = swatch.dataset.icon;
      for (const s of swatches) {
        s.classList.toggle("is-selected", s === swatch);
      }
    });
  }
  swatches[0]?.classList.add("is-selected"); // default matches state.selectedIcon

  document.getElementById("annotation-clear").addEventListener("click", () => {
    // confirm() blocks like Python's input() — fine for a destructive action.
    if (confirm("Remove all of your marks and notes from this browser?")) {
      clearAnnotations();
      closePopups();
      renderer.render();
    }
  });
}
```

> **JS vs Python:** `swatches[0]?.classList` — optional chaining. If
> `swatches` were empty, `swatches[0]` is `undefined` and `?.` makes the
> whole expression a silent no-op instead of a TypeError. The safe
> navigation Python still doesn't have.

### 4. The note popup — replace the milestone-02 placeholder

```js
/**
 * Open the editable note popup for a (new or existing) annotation.
 * Works for icon annotations too — players can attach text to any mark.
 */
export function openNotePopup(annotation, sx, sy) {
  closePopups();
  const fragment = document.getElementById("tpl-note-popup").content.cloneNode(true);
  const popup = fragment.querySelector(".popup");
  const textarea = popup.querySelector(".popup__textarea");
  textarea.value = annotation.text ?? "";

  popup.querySelector(".popup__close").addEventListener("click", closePopups);
  popup.querySelector(".popup__save").addEventListener("click", () => {
    updateAnnotation(annotation.id, { text: textarea.value });
    closePopups();
  });
  popup.querySelector(".popup__delete").addEventListener("click", () => {
    removeAnnotation(annotation.id);
    closePopups();
    renderer.render();
  });

  popupLayer().append(popup);
  positionPopup(popup, sx, sy);
  textarea.focus();
}
```

## Checkpoint

- "Place icon" arms (highlight + crosshair over the map); clicking the map
  drops a gold-ringed flag. Pick the skull swatch, place another. Clicking
  the armed button again disarms.
- "Place note" → click the map → the note editor opens immediately; type,
  Save. Click the badge later → your text is still there.
- Click any gold badge in pan mode → editor opens; Delete removes it.
- **Refresh the page** → everything you placed is still on the map. In
  DevTools → Application → Local Storage you can watch
  `lyndryss.annotations.v1` change as you edit.
- "Clear all my marks" asks for confirmation, then empties the map and
  storage.
- A small drag that ends on a badge does *not* open it (that's `CLICK_SLOP`
  doing its job), and starting a drag closes any open popup.

## Common bugs

- **Annotations vanish on refresh** — `main.js` calls `loadAnnotations()`
  during `init()`; if you see this, you probably edited that call out, or
  storage is unavailable (private browsing) and `save()` is silently
  no-oping — check DevTools → Application → Local Storage.
- **Clicking an icon annotation places another annotation on top of it** —
  your tool stayed armed and placement runs before hit-testing (by design);
  disarm the tool to edit. If it happens in pan mode, your
  `handleClick` is missing the `annotationHitTest` branch.
- **Note text doesn't save** — the Save handler must read
  `textarea.value` *at click time* (the code above closes over the
  `textarea` element, then reads `.value` inside the handler — correct).
  If you captured `textarea.value` outside the handler you froze its
  initial value.
- **`confirm` never appears, clear happens instantly** — some popup
  blockers in kiosk-ish setups suppress it; acceptable. But if you want a
  prettier confirm later, build it from a `<template>` like the popups.
