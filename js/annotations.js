/**
 * annotations.js — player-placed icons and notes.
 * Client-side only: persisted to localStorage (ANNOTATIONS_STORAGE_KEY in
 * config.js), never shared between players. Drawing happens in renderer.js.
 */

/**
 * @typedef {Object} Annotation
 * @property {string} id        unique (crypto.randomUUID() is fine)
 * @property {"icon" | "note"} kind
 * @property {string} icon      palette id: "flag" | "skull" | "chest" | "question"
 *                              (notes can reuse "question" or get their own pin)
 * @property {number} x world px
 * @property {number} y world px
 * @property {string} [text]    note body, ≤500 chars (textarea enforces it)
 */


import { ANNOTATIONS_STORAGE_KEY } from "./config.js";

let annotations = [];


function save() {
  try {
    localStorage.setItem(ANNOTATIONS_STORAGE_KEY, JSON.stringify(annotations));
  } catch {
    // Storage unavailable - annotations won't survive refresh 
  }
}


/**
 * Load saved annotations from localStorage into module state.
 * Treat parse errors as "no annotations" — don't let bad data brick the app.
 * @returns {Annotation[]}
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

/** @returns {Annotation[]} current annotations for the renderer to draw */
export function getAnnotations() {
  return annotations;
}

/**
 * Add one annotation and persist.
 * @param {Annotation} annotation
 */
export function addAnnotation(annotation) {
  annotations.push(annotation);
  save();
}

/**
 * Update an existing annotation (e.g. note text edited) and persist.
 * @param {string} id
 * @param {Partial<Annotation>} changes
 */
export function updateAnnotation(id, changes) {
  const target = annotations.find((a) => a.id === id);
  if (target) {
    Object.assign(target, changes);
    save();
  }
}

/**
 * Remove one annotation and persist.
 * @param {string} id
 */
export function removeAnnotation(id) {
  annotations = annotations.filter((a) => a.id !== id);
  save();
}

/** Remove everything (the "Clear all my marks" button). Confirm in ui.js first. */
export function clearAnnotations() {
  annotations = [];
  save();
}

/**
 * Hit-test like markers.hitTest, so clicks can open/edit an existing
 * annotation instead of placing a new one on top of it.
 * @param {number} wx world px
 * @param {number} wy world px
 * @param {number} radius world px
 * @returns {Annotation | null}
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
