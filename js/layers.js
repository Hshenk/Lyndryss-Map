/**
 * layers.js — visibility state for overlay layers and marker icon categories.
 *
 * Single source of truth the renderer reads each frame; ui.js calls the
 * setters when switches flip. Keep it dumb: state + change notification.
 */


let activeOverlay = "biome";  // Default map-mode
const hiddenCategories = new Set();
const listeners = [];

// Rivers and routes
let riversVisible = true;
let routesVisible = true;

let labelsVisible = true;


function notify() {
  for (const callback of listeners) callback();
}

export function getActiveOverlay() {
  return activeOverlay;
}


export function setActiveOverlay(id) {
  activeOverlay = id;
  notify();
}


export function getVisibleLayerIds() {
  return activeOverlay && activeOverlay !== "biome" ? [activeOverlay] : [];
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


// Rivers and Routes
export function isRiversVisible() { return riversVisible; }
export function setRiversVisible(v) { riversVisible = v; notify(); }

export function isRoutesVisible() { return routesVisible; }
export function setRoutesVisible(v) { routesVisible = v; notify(); }

export function isLabelsVisible() { return labelsVisible; }
export function setLabelsVisible(v) { labelsVisible = v; notify(); }