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

import { MANIFEST_URL } from "./config.js";
import { loadManifest, getManifest } from "./tile-manager.js";
import { loadMarkers } from "./markers.js";
import { createRenderer } from "./renderer.js";
import { loadAnnotations } from "./annotations.js";
import { readViewFromHash, onHashChange } from "./url-state.js";
import { onLayersChanged, setLayerVisible } from "./layers.js";
import { initUI, showError } from "./ui.js";

// How often to check for new map pushed to folder (In ms)
const UPDATE_POLL_MS = 60_000;


/**
 * Boot the app. Called once on DOMContentLoaded.
 * @returns {Promise<void>}
 */
async function init() {
  
  const loadingOverlay = document.getElementById("loading-overlay");
  try{
    // 1. Data first
    const manifest = await loadManifest();
    document.getElementById("map-version").textContent = `v${manifest.version}`;
    document.getElementById("map-updated").textContent = manifest.updated ?? "—";


    // It's okay if just the markers fail, continue to load the map
    try{
      await loadMarkers();
    } catch(err) {
      console.warn("markers failed to load:", err);
    }


    // 2. Player annotations 
    loadAnnotations();

    // 3. Renderer
    const canvas = document.getElementById("map-canvas");
    const renderer = createRenderer(canvas, manifest);

    // 4. If the URL carries a view, jump there.
    applyHashState(renderer, readViewFromHash());
    onHashChange((state) => applyHashState(renderer, state));

    // 5. UI wiring
    initUI(renderer);
    onLayersChanged(renderer.render);

    // 6. first frame, then reveal map
    renderer.render();
    loadingOverlay.classList.add("is-hidden");

    window.lyndryss = { renderer, manifest };

    // 7. Prompt the user if the GM has updated the map
    setInterval(async () => {
      if (await checkForUpdates()) {
        showError("The GM has updated the map - refresh to see what's new!");
      }
    }, UPDATE_POLL_MS);
  } catch (err){
    console.error(err);
    loadingOverlay.classList.add("is-hidden");
    showError("Could not load the map. Try refreshing the page.");
  }
}

/** Apply a parsed hash state (view + enabled overlays) to the map. */
function applyHashState(renderer, state) {
  if (state === null) return;
  renderer.view.x = state.x;
  renderer.view.y = state.y;
  renderer.view.scale = state.scale;
  for (const layerId of state.layers) {
    setLayerVisible(layerId, true);
    // Also reflect in the sidebar switch
    const input = document.querySelector(`.switch__input[data-layer="${layerId}"]`);
    if (input) input.checked = true;
  }
  renderer.render();
}




/**
 * Poll the manifest for a newer `version` and prompt the player to
 * refresh (or hot-swap tiles) when the GM pushes an update mid-session.
 * Call on an interval from init() if you want live updates without reloads.
 * @returns {Promise<boolean>} true if a newer manifest version exists
 */
export async function checkForUpdates() {
  try {
    // cache: "no-cache" forces a revalidation so we see the fresh file
    const response = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!response.ok) return false;
    const fresh = await response.json();
    const current = getManifest();
    return current !== null && fresh.version > current.version;
  } catch {
    return false; // Such as if we are offline. Try again next poll
  }
}

document.addEventListener("DOMContentLoaded", init);
