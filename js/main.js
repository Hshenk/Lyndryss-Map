/**
 * main.js — entry point. Owns the boot sequence and nothing else.
 *
 * Suggested init order (implement in init() below):
 *   1. loadManifest()                          (tile-manager.js)
 *   2. loadMarkers()                           (markers.js)
 *   3. create the renderer bound to #map-canvas, sized to #map-container,
 *      initial viewport centered on tile (0,0)  (renderer.js)
 *   4. restore player annotations from localStorage (annotations.js)
 *   5. apply view state from the URL hash, if present (url-state.js)
 *   6. wire up all UI controls                 (ui.js)
 *   7. hide #loading-overlay (add .is-hidden) and render the first frame
 *
 * On any fatal load error: set #error-banner-text and un-hide #error-banner.
 */

// import { loadManifest } from "./tile-manager.js";
// import { loadMarkers } from "./markers.js";
// import { createRenderer } from "./renderer.js";
// import { loadAnnotations } from "./annotations.js";
// import { readViewFromHash } from "./url-state.js";
// import { initUI } from "./ui.js";

/**
 * Boot the app. Called once on DOMContentLoaded.
 * @returns {Promise<void>}
 */
async function init() {
  // TODO: implement the sequence described above.
  console.info("Lyndryss map: init() not implemented yet.");
}

/**
 * Optional: poll the manifest for a newer `version` and prompt the player to
 * refresh (or hot-swap tiles) when the GM pushes an update mid-session.
 * Call on an interval from init() if you want live updates without reloads.
 * @returns {Promise<boolean>} true if a newer manifest version exists
 */
export async function checkForUpdates() {
  // TODO: fetch MANIFEST_URL with cache: "no-cache", compare `version`.
  return false;
}

document.addEventListener("DOMContentLoaded", init);
