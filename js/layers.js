/**
 * layers.js — visibility state for overlay layers and marker icon categories.
 *
 * Single source of truth the renderer reads each frame; ui.js calls the
 * setters when switches flip. Keep it dumb: state + change notification.
 * Optionally persist to LAYER_PREFS_STORAGE_KEY so choices survive refresh.
 */

/**
 * Is the given overlay layer (e.g. "territory") currently visible?
 * "base" should always report true.
 * @param {string} layerId
 * @returns {boolean}
 */
export function isLayerVisible(layerId) {
  // TODO
  return layerId === "base";
}

/**
 * Show/hide an overlay layer.
 * @param {string} layerId
 * @param {boolean} visible
 */
export function setLayerVisible(layerId, visible) {
  // TODO: update state, then notify (see onLayersChanged)
}

/**
 * Is a marker category (e.g. "settlements") currently visible?
 * @param {string} categoryId
 * @returns {boolean}
 */
export function isCategoryVisible(categoryId) {
  // TODO
  return true;
}

/**
 * Show/hide a marker category.
 * @param {string} categoryId
 * @param {boolean} visible
 */
export function setCategoryVisible(categoryId, visible) {
  // TODO
}

/**
 * Register a callback fired after any visibility change — main.js should
 * subscribe the renderer's render() here so toggles repaint immediately.
 * @param {() => void} callback
 */
export function onLayersChanged(callback) {
  // TODO
}
