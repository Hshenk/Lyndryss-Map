/**
 * markers.js — GM-authored markers: loading, lookup, hit-testing, search.
 * Drawing happens in renderer.js; popups are opened by ui.js.
 */

/**
 * @typedef {Object} MarkerCategory
 * @property {string} id      e.g. "settlements"
 * @property {string} name    display name
 * @property {string} icon    path to an SVG under assets/icons/
 */

/**
 * @typedef {Object} Marker
 * @property {string} id
 * @property {string} category MarkerCategory.id
 * @property {number} x world px
 * @property {number} y world px
 * @property {string} name
 * @property {string} [note] body text for the popup
 */

/**
 * Fetch and parse data/markers.json.
 * Suggested extras: index markers by id and by category; after loading,
 * ui.js will ask for categories to build the toggle list (with counts).
 * @returns {Promise<{categories: MarkerCategory[], markers: Marker[]}>}
 */
export async function loadMarkers() {
  // TODO
  throw new Error("not implemented");
}

/** @returns {MarkerCategory[]} loaded categories (empty before load) */
export function getCategories() {
  // TODO
  return [];
}

/**
 * Markers that should be drawn right now (visible categories only —
 * check layers.js). The renderer calls this each frame.
 * @returns {Marker[]}
 */
export function getVisibleMarkers() {
  // TODO
  return [];
}

/**
 * Find the topmost marker within `radius` world px of a world point —
 * used to open a popup on canvas click.
 * Tip: radius should scale with 1/viewport.scale so the click target stays
 * a comfortable ~12 screen px at any zoom.
 * @param {number} wx world px
 * @param {number} wy world px
 * @param {number} radius world px
 * @returns {Marker | null}
 */
export function hitTest(wx, wy, radius) {
  // TODO
  return null;
}

/**
 * Case-insensitive substring search over marker names (Genshin-map style).
 * ui.js renders the results under the sidebar search box.
 * @param {string} query
 * @param {number} [limit] max results, default ~10
 * @returns {Marker[]}
 */
export function searchMarkers(query, limit) {
  // TODO
  return [];
}
