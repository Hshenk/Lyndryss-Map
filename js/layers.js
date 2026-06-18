/**
 * layers.js — visibility state for overlay layers and marker icon categories.
 *
 * Single source of truth the renderer reads each frame; ui.js calls the
 * setters when switches flip. Keep it dumb: state + change notification.
 * Optionally persist to LAYER_PREFS_STORAGE_KEY so choices survive refresh.
 */


const visibleOverlays = new Set();
const hiddenCategories = new Set();

const listeners = [];


function notify() {
  for (const callback of listeners) callback();
}



/**
 * Is the given overlay layer (e.g. "territory") currently visible?
 * "base" should always report true.
 * @param {string} layerId
 * @returns {boolean}
 */
export function isLayerVisible(layerId) {
  return layerId === "base" || visibleOverlays.has(layerId);
}

/**
 * Show/hide an overlay layer.
 * @param {string} layerId
 * @param {boolean} visible
 */
export function setLayerVisible(layerId, visible) {
  if (layerId === "base") return; // Can't turn off the map itself
  if (visible) visibleOverlays.add(layerId);
  else visibleOverlays.delete(layerId);
  notify();
}


export function getVisibleLayerIds() {
  return [...visibleOverlays];
}


/**
 * Is a marker category (e.g. "settlements") currently visible?
 * @param {string} categoryId
 * @returns {boolean}
 */
export function isCategoryVisible(categoryId) {
  return !hiddenCategories.has(categoryId);
}

/**
 * Show/hide a marker category.
 * @param {string} categoryId
 * @param {boolean} visible
 */
export function setCategoryVisible(categoryId, visible) {
  if (visible) hiddenCategories.delete(categoryId);
  else hiddenCategories.add(categoryId);
  notify();
}

/**
 * Register a callback fired after any visibility change — main.js should
 * subscribe the renderer's render() here so toggles repaint immediately.
 * @param {() => void} callback
 */
export function onLayersChanged(callback) {
  listeners.push(callback);
}
