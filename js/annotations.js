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

/**
 * Load saved annotations from localStorage into module state.
 * Treat parse errors as "no annotations" — don't let bad data brick the app.
 * @returns {Annotation[]}
 */
export function loadAnnotations() {
  // TODO
  return [];
}

/** @returns {Annotation[]} current annotations for the renderer to draw */
export function getAnnotations() {
  // TODO
  return [];
}

/**
 * Add one annotation and persist.
 * @param {Annotation} annotation
 */
export function addAnnotation(annotation) {
  // TODO: push, save, request redraw
}

/**
 * Update an existing annotation (e.g. note text edited) and persist.
 * @param {string} id
 * @param {Partial<Annotation>} changes
 */
export function updateAnnotation(id, changes) {
  // TODO
}

/**
 * Remove one annotation and persist.
 * @param {string} id
 */
export function removeAnnotation(id) {
  // TODO
}

/** Remove everything (the "Clear all my marks" button). Confirm in ui.js first. */
export function clearAnnotations() {
  // TODO
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
  // TODO
  return null;
}
