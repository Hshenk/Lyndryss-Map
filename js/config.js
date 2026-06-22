/**
 * config.js — shared constants. No logic lives here.
 */

/** Where the tile manifest lives, relative to the site root. */
export const MANIFEST_URL = "data/manifest.json";

/** Where the GM marker data lives. */
export const MARKERS_URL = "data/markers.json";



/** Zoom limits, expressed as scale factors (1 = one world px per screen px). */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 10;

/** Multiplier applied per zoom-button click / wheel notch. */
export const ZOOM_STEP = 1.2;

/** Opacity used when drawing overlay layers (territory/culture/religion). */
export const OVERLAY_ALPHA = 0.55;

/** localStorage keys. */
export const ANNOTATIONS_STORAGE_KEY = "lyndryss.annotations.v1";
export const LAYER_PREFS_STORAGE_KEY = "lyndryss.layer-prefs.v1";

