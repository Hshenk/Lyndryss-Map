/**
 * config.js — shared constants. No logic lives here.
 */

/** Where the manifest lives, relative to the site root. */
export const MANIFEST_URL = "data/manifest.json";

/** Where the GM marker data lives. */
export const MARKERS_URL = "data/markers.json";



/** Zoom limits, expressed as scale factors (1 = one world px per screen px). */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 10;

/** Multiplier applied per zoom-button click / wheel notch. */
export const ZOOM_STEP = 1.2;


/** localStorage keys. */
export const ANNOTATIONS_STORAGE_KEY = "lyndryss.annotations.v1";


/** Supabase */
export const SUPABASE_URL = "https://dsdzymszhvdccbyalthw.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_YSnTkpuYcPax_VChpP3-OA_V_RYJ9ZE";

/** Which game session live rows belong to (lets you wipe/swap per session). */
export const SESSION_ID = "default";

/** How long a ping pulse lives on screen before it's ignored/removed (ms). */
export const PING_LIFETIME_MS = 4000;

/** Main site links */
export const WIKILORE_URL = "https://wikilore.lyndryss.com/";
export const MAP_URL = "https://map.lyndryss.com";

