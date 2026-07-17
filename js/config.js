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


// ===================== Phase 2: realtime (Supabase) =====================
// These identify your Supabase project to the browser. Both are PUBLIC and meant
// to ship in client code — the publishable key is NOT a secret; Row-Level Security
// is what protects the data (see docs/guide-phase2/01-supabase-setup.md).
// Paste your own values from the Supabase dashboard:
//   URL              → Project Settings → Data API (or the API/Connect dialog)
//   publishable key  → Project Settings → API Keys  (looks like sb_publishable_...)
// Use the PUBLISHABLE key (the modern replacement for the legacy "anon" key) —
// NOT the secret key. Until you fill these, live.js stays inert and the rest of
// the map works exactly as before.
export const SUPABASE_URL = "https://dsdzymszhvdccbyalthw.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_YSnTkpuYcPax_VChpP3-OA_V_RYJ9ZE";

/** Which game session live rows belong to (lets you wipe/swap per session). */
export const SESSION_ID = "default";

/** How long a ping pulse lives on screen before it's ignored/removed (ms). */
export const PING_LIFETIME_MS = 4000;

export const WIKILORE_URL = "https://hshenk.github.io/WikiLore/";

