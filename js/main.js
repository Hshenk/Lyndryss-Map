/**
 * main.js — entry point.
 */

import { MANIFEST_URL } from "./config.js";
import { loadWorldData, getManifest } from "./map-data.js";
import { loadMarkers, getMarkerById } from "./markers.js";
import { createRenderer } from "./renderer.js";
import { loadAnnotations } from "./annotations.js";
import { readViewFromHash, writeViewToHash, onHashChange } from "./url-state.js";
import { onLayersChanged, setActiveOverlay, getVisibleLayerIds } from "./layers.js";
import { initUI, showError, refreshGMUI, refreshPlayerUI, openMarkerPopup } from "./ui.js";
import { initLive, getLiveMarkers } from "./live.js";

// How often to check for new map pushed to folder (In ms)
const UPDATE_POLL_MS = 60_000;

let pendingMarker = null; // marker id from a #marker= deep link

// Pan to an existing marker and open its popup, if it's loaded
function focusPendingMarker(renderer) {
  if (!pendingMarker) return;
  const marker = getMarkerById(pendingMarker)
    ?? getLiveMarkers().find((m) => m.id === pendingMarker);
  if (!marker) return;

  pendingMarker = null;
  renderer.view.x = marker.x;
  renderer.view.y = marker.y;
  if (renderer.view.scale < 2) renderer.view.scale = 2;
  renderer.render();
  const p = renderer.worldToScreen(marker.x, marker.y);
  openMarkerPopup(marker, p.x, p.y);
}

/**
 * Boot the app. Called once on DOMContentLoaded.
 * @returns {Promise<void>}
 */
async function init() {
  
  const loadingOverlay = document.getElementById("loading-overlay");
  try{
    // 1. Data first
    const manifest = await loadWorldData();
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
    const renderer = createRenderer(canvas, manifest, (view) => 
      writeViewToHash({
        x: view.x, y: view.y, scale: view.scale,
        layers: getVisibleLayerIds(),
      })
    );

    // 3.1 Reload for fonts
    if (document.fonts?.load) {
      document.fonts.load("16px Amarante").then(() => renderer.render());
    }

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

    // 7. Realtime session layer
    initLive(() => {
      renderer.render();
      refreshGMUI();
      refreshPlayerUI();
      focusPendingMarker(renderer);
    }).catch((err) => console.warn("live layer failed (map still works):", err));
    refreshGMUI();
    refreshPlayerUI();

    // 8. Prompt the user if the GM has updated the map
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
  if (Number.isFinite(state.x)) {
    renderer.view.x = state.x;
    renderer.view.y = state.y;
    renderer.view.scale = state.scale;
  }


  // hash carried at most one layer, default to biome
  const mode = state.layers[0] ?? "biome";
  setActiveOverlay(mode);
  for (const btn of document.querySelectorAll("#map-mode-list .map-mode")) {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  }

  if (state.marker) {
    pendingMarker = state.marker;
    focusPendingMarker(renderer);
  }
  renderer.render();
}




/**
 * Poll the manifest for a newer `version` and prompt the player to
 * refresh when the GM pushes an update mid-session.
 * Call on an interval from init() if you want live updates without reloads.
 * @returns {Promise<boolean>} true if a newer manifest version exists
 */
async function checkForUpdates() {
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
