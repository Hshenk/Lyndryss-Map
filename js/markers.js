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


import { MARKERS_URL } from "./config.js";
import { isCategoryVisible } from "./layers.js";

let categories = [];
let markers = [];
const iconByCategory = new Map();


/**
 * Fetch and parse data/markers.json.
 * Suggested extras: index markers by id and by category; after loading,
 * ui.js will ask for categories to build the toggle list (with counts).
 * @returns {Promise<{categories: MarkerCategory[], markers: Marker[]}>}
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


/** @returns {MarkerCategory[]} loaded categories (empty before load) */
export function getCategories() {
  return categories;
}


export function getCategoryIcon(categoryId) {
  return iconByCategory.get(categoryId) ?? "assets/icons/question.svg";
}


export function getCategoryCount(categoryId) {
  return markers.filter((m) => m.category === categoryId).length;
}


/**
 * Markers that should be drawn right now (visible categories only —
 * check layers.js). The renderer calls this each frame.
 * @returns {Marker[]}
 */
export function getVisibleMarkers() {
  return markers.filter((m) => isCategoryVisible(m.category));
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
  let best = null;
  let bestDistSq = radius * radius;
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
 * ui.js renders the results under the sidebar search box.
 * @param {string} query
 * @param {number} [limit] max results, default ~10
 * @returns {Marker[]}
 */
export function searchMarkers(query, limit) {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  return markers
    .filter((m) => m.name.toLowerCase().includes(q))
    .slice(0, limit);
}

export function getMarkerById(id) {
  return markers.find((m) => m.id === id) ?? null;
}
