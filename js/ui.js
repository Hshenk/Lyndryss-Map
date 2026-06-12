/**
 * ui.js — wires DOM controls to the other modules. All element ids, classes,
 * and templates referenced here exist in index.html.
 *
 * Elements / hooks cheat sheet:
 *   #sidebar-toggle        → toggle .sidebar--collapsed on #sidebar,
 *                            mirror state to aria-expanded
 *   #zoom-in / #zoom-out   → renderer.zoomBy(ZOOM_STEP) / (1 / ZOOM_STEP)
 *   #zoom-reset            → renderer.resetView()
 *   #coords-readout        → update on canvas pointermove ("123, -456")
 *   #marker-search         → markers.searchMarkers() on input; results into
 *                            #search-results via template #tpl-search-result;
 *                            remove .is-hidden while there are results
 *   #overlay-toggle-list   → change events on .switch__input[data-layer]
 *                            → layers.setLayerVisible(); disable inputs whose
 *                            layer isn't in the manifest
 *   #icon-toggle-list      → rebuild from markers.getCategories() using
 *                            template #tpl-icon-toggle (set data-category,
 *                            .switch__icon src, .switch__label, .switch__count)
 *   #icons-show-all/#icons-hide-all → set every category switch + state
 *   #tool-place-icon / #tool-place-note → exclusive toggle: .is-active +
 *                            aria-pressed, body.is-placing while a tool is
 *                            armed (crosshair cursor)
 *   #annotation-icon-palette → .is-selected on the picked swatch (data-icon)
 *   #annotation-clear      → confirm(), then annotations.clearAnnotations()
 *   #popup-layer           → popups appended here; templates
 *                            #tpl-marker-popup / #tpl-note-popup
 *   #loading-overlay       → add .is-hidden once first render succeeds
 *   #error-banner          → showError() below; #error-banner-dismiss re-hides
 *   #map-updated / #map-version → fill from manifest
 */

/**
 * @typedef {Object} UIState
 * @property {"pan" | "icon" | "note"} activeTool
 * @property {string} selectedIcon  data-icon of the selected palette swatch
 */

/**
 * Bind every control. Call once from main.js after data + renderer exist.
 * @param {import("./renderer.js").Renderer} renderer
 */
export function initUI(renderer) {
  // TODO
}

/** @returns {UIState} current tool state (renderer click handling reads this) */
export function getUIState() {
  // TODO
  return { activeTool: "pan", selectedIcon: "flag" };
}

/**
 * Open a marker popup near a screen point (clamp so it stays in-viewport).
 * @param {import("./markers.js").Marker} marker
 * @param {number} sx screen px (canvas-relative)
 * @param {number} sy screen px
 */
export function openMarkerPopup(marker, sx, sy) {
  // TODO: clone #tpl-marker-popup, fill, append to #popup-layer
}

/**
 * Open the editable note popup for a (new or existing) annotation.
 * @param {import("./annotations.js").Annotation} annotation
 * @param {number} sx screen px
 * @param {number} sy screen px
 */
export function openNotePopup(annotation, sx, sy) {
  // TODO: clone #tpl-note-popup; Save → annotations.updateAnnotation,
  //       Delete → annotations.removeAnnotation
}

/** Close any open popup. */
export function closePopups() {
  // TODO
}

/**
 * Show the error banner with a message.
 * @param {string} message
 */
export function showError(message) {
  // TODO: set #error-banner-text, remove .is-hidden from #error-banner
}
