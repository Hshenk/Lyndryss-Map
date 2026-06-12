/**
 * config.js — shared constants. No logic lives here.
 */

/** Where the tile manifest lives, relative to the site root. */
export const MANIFEST_URL = "data/manifest.json";

/** Where the GM marker data lives. */
export const MARKERS_URL = "data/markers.json";

/**
 * Tile image URL pattern. Build with `tileUrl(layer, x, y)` below.
 * Files are named `{x}_{y}.png` and x/y may be negative (e.g. tiles/base/-1_2.png).
 */
export const TILES_ROOT = "tiles";

/** Fallback if the manifest omits tileSize. World px per tile edge. */
export const DEFAULT_TILE_SIZE = 480;

/** Zoom limits, expressed as scale factors (1 = one world px per screen px). */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

/** Multiplier applied per zoom-button click / wheel notch. */
export const ZOOM_STEP = 1.2;

/** Opacity used when drawing overlay layers (territory/culture/religion). */
export const OVERLAY_ALPHA = 0.55;

/** localStorage key for player annotations (see annotations.js). */
export const ANNOTATIONS_STORAGE_KEY = "lyndryss.annotations.v1";

/** localStorage key for remembered layer-toggle choices (optional). */
export const LAYER_PREFS_STORAGE_KEY = "lyndryss.layer-prefs.v1";

/**
 * Build the URL of one tile image.
 * @param {string} layer e.g. "base", "territory"
 * @param {number} x integer tile column (may be negative)
 * @param {number} y integer tile row (may be negative)
 * @returns {string}
 */
export function tileUrl(layer, x, y) {
  return `${TILES_ROOT}/${layer}/${x}_${y}.png`;
}
