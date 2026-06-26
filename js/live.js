/**
 * live.js — the realtime session layer (Phase 2). STUB: interface only, no logic.
 *
 * This is a new *data module*, peer to markers.js / annotations.js. It owns the
 * connection to Supabase and the local arrays of live, shared objects (pings now;
 * tokens later). The renderer draws from it; ui.js drives it from GM tools. It is
 * the ONLY module that talks to Supabase.
 *
 * Design mirrors annotations.js on purpose — placing a ping is structurally like
 * placing a player annotation, except it INSERTs to Supabase (so every connected
 * player sees it) instead of writing to localStorage (this browser only).
 *
 * Lifecycle (wired by you from main.js, after the renderer exists):
 *   1. initLive(onChange)   — create the client, fetch current pings, subscribe.
 *   2. subscription fires    — a row was inserted/deleted somewhere → update the
 *                              local array → call onChange() so main re-renders.
 *   3. GM acts (ui.js)       — signIn(), then sendPing(x, y) inserts a row.
 *
 * Security note: players never sign in, so RLS rejects their writes. The GM tools
 * in the UI stay hidden until signIn() succeeds, but RLS — not the hidden UI — is
 * the real gate. See docs/guide-phase2/01-supabase-setup.md.
 *
 * Implement this from docs/guide-phase2/02-the-ping.md. Until then every function
 * is a no-op, so importing this module changes nothing and the map runs as before.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  SESSION_ID,
  PING_LIFETIME_MS,
} from "./config.js";
import { forEachRing } from "./map-data.js";



let supabase = null; // the client
let pings = [];
let channel = null;  // realtime subscription 
let session = { signedIn: false, email: undefined };
let notifyChange = () => {};
let tokens = [];
let tokenChannel = null;

// Province Data
let liveCells = [];
let revealChannel = null;
let revealedCells = new Set();






function configured() {
  return !SUPABASE_URL.includes("YOUR-PROJECT")
      && !SUPABASE_PUBLISHABLE_KEY.includes("YOUR-PUBLISHABLE");
}


async function fetchAll(table, columns, orderCol) {
  // Supabase caps a request at ~1000 rows. Page through them all
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table).select(columns).order(orderCol, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.warn("reveal fetch failed:", error.message); break; }
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break; // last page
  }
  return out;
}


/**
 * Connect to Supabase, load current pings for SESSION_ID, and subscribe to
 * realtime INSERT/DELETE on the pings table. Call once from main.js.
 *
 * @param {() => void} onChange  called whenever the live data changes (so the
 *                               app can re-render). Wire it to renderer.render.
 * @returns {Promise<void>}
 */
export async function initLive(onChange) {
  notifyChange = onChange ?? (() => {});
  if (!configured()) return;

  supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  // Restore GM session the browser has one stored
  const { data: {session: existing } } = await supabase.auth.getSession();
  if (existing) session = { signedIn: true, email: existing.user.email };
  supabase.auth.onAuthStateChange((_event, s) => {
    session = s ? { signedIn: true, email: s.user.email } : { signedIn: false };
    refreshRevealed();
  });

  // Loads pings that are still within their lifetime
  const cutoff = new Date(Date.now() - PING_LIFETIME_MS).toISOString();
  const { data } = await supabase
    .from("pings").select("*")
    .eq("session_id", SESSION_ID)
    .gte("created_at", cutoff);
  if (data) for (const row of data) addLocalPing(row);

  // Subscribe: every INSERT for this session is published here in realtime
  channel = supabase
    .channel(`pings-${SESSION_ID}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "pings",
        filter: `session_id=eq.${SESSION_ID}` },
      (payload) => {
        console.log("realtime INSERT received:", payload.new);
        addLocalPing(payload.new);
      },
    )
    .subscribe((status) => console.log("realtime status:", status));
  
  // Load every token for this session
  const { data: tokenRows } = await supabase
    .from("tokens").select("*")
    .eq("session_id", SESSION_ID);
  tokens = (tokenRows ?? []).map(rowToToken);

  // Subscribe to token INSERT / UPDATE / DELETE
  tokenChannel = supabase
    .channel(`tokens-${SESSION_ID}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tokens",
        filter: `session_id=eq.${SESSION_ID}` },
      (payload) => {
        if (payload.eventType === "DELETE") removeLocalToken(payload.old.id);
        else upsertLocalToken(payload.new);
        notifyChange();
      },
    )
    .subscribe();
  

  // Cell/Province Data
  await refreshRevealed();
  revealChannel = supabase
    .channel("revealed_cells")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "revealed_cells" },
      () => refreshRevealed())
    .subscribe();
  
  // GM reads all hidden cells
  supabase.auth.onAuthStateChange((_event, s) => {
    session = s ? { signedIn: true, email: s.user.email } : { signedIn: false };
    refreshRevealed();
  });
}


function addLocalPing(row) {
  if (pings.some((p) => p.id === row.id)) return; // De-dupe


  const createdAt = Date.now();
  pings.push({ id: row.id, x: row.x, y: row.y, created_at: createdAt });
  notifyChange();

  // remove it once its pulse is over then re-render to clear it
  setTimeout(() => {
    pings = pings.filter((p) => p.id !== row.id);
    notifyChange();
  }, PING_LIFETIME_MS);
}



/**
 * Live pings the renderer should draw right now (expired ones filtered out).
 * @returns {Ping[]}
 */
export function getPings() {
  const now = Date.now();
  return pings.filter((p) => now - p.created_at <= PING_LIFETIME_MS);
}

/**
 * GM: drop a ping at a world point. INSERTs a row; the realtime subscription
 * then delivers it back to every client (including this one) via getPings().
 * @param {number} x world px
 * @param {number} y world px
 * @returns {Promise<void>}
 */
export async function sendPing(x, y) {
  if (!supabase) return;
  const { error } = await supabase
    .from("pings")
    .insert({ session_id: SESSION_ID, x, y });
  if (error) console.warn("ping insert failed:", error.message);
}


//   --- Token Stuff ---


// Normalize a DB row
function rowToToken(row) {
  return {
    id: row.id, icon: row.icon, color: row.color,
    label: row.label ?? "", x: row.x, y: row.y,
  };
}

// Add a token or replace it if we already have that id
function upsertLocalToken(row) {
  const t = rowToToken(row);
  const i = tokens.findIndex((x) => x.id === t.id);
  if (i === -1) tokens.push(t);
  else tokens[i] = t;
}

function removeLocalToken(id) {
  tokens = tokens.filter((t) => t.id !== id);
}

export function getTokens() {
  return tokens;
}

export async function placeToken(x, y, icon, color, label) {
  if (!supabase) return;
  const { error } = await supabase.from("tokens").insert({
    session_id: SESSION_ID, icon, color, label: label || null, x, y
  });
  if (error) console.warn("token insert failed:", error.message);
}

export async function moveToken(id, x, y) {
  if (!supabase) return;
  const { error } = await supabase.from("tokens").update({ x, y }).eq("id", id);
  if (error) console.warn("token move failed:", error.message);
}

export async function removeToken(id) {
  if (!supabase) return;
  const { error } = await supabase.from("tokens").delete().eq("id", id);
  if (error) console.warn("token delete failed:", error.message);
}

export function tokenAt(wx, wy, radius) {
  let best = null;
  let bestDistSq = radius * radius;
  for (const t of tokens) {
    const dx = t.x - wx;
    const dy = t.y - wy;
    const distSq = dx * dx + dy * dy;
    if (distSq <= bestDistSq) {
      best = t;
      bestDistSq = distSq;
    }
  }
  return best;
}


/**
 * GM login (email + password — the default chosen for easy dev testing; you can
 * switch to magic-link later). On success, ui.js unlocks the GM write tools.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function signIn(email, password) {
  if (!supabase) return { ok: false, error: "Set you Supabase keys in config.js first." };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** GM logout. Re-hide the write tools. @returns {Promise<void>} */
export async function signOut() {
  await supabase?.auth.signOut();
}


/**
 * Whether a GM is currently signed in (drives whether ui.js shows write tools).
 * @returns {boolean}
 */
export function isGM() {
  return session.signedIn;
}


export function gmEmail() {
  return session.email ?? "";
}


//   --- Region/Province Data ---
async function refreshRevealed() {
  if (!supabase) return;
  const rc = await fetchAll("revealed_cells", "cell_id", "cell_id");
  revealedCells = new Set(rc.map((r) => r.cell_id));

  // Gem gets every hidden cell
  const rows = await fetchAll("hidden_cells", "data, id", "id");
  liveCells = rows.map((row) => prepCell(row.data));
  notifyChange();
}

export function getLiveCells() {
  return liveCells;
}

export function isCellRevealed(cell) {
  return revealedCells.has(cell.properties.id);
}

// Checks if region is under click
export function liveCellAt(wx, wy) {
  for (const cell of liveCells) {
    const b = cell._bbox;
    if (wx < b.minX || wx > b.maxX || wy < b.minY || wy > b.maxY) continue;
    if (pointInFeature(cell, wx, wy)) return cell;
  }
  return null;
}

function cellsInScope(cell, scope) {
  if (scope === "cell") return [cell];
  const key = scope === "province" ? "province" : "state";
  const val = cell.properties[key];
  return liveCells.filter((c) => c.properties[key] === val);
}

// Reveal or unreveal a scope around the clicked cell
export async function revealScope(cell, scope, on) {
  if (!supabase) return;
  const ids = cellsInScope(cell, scope).map((c) => c.properties.id);
  if (on) {
    await supabase.from("revealed_cells")
      .upsert(ids.map((id) => ({ cell_id: id})), { onConflict: "cell_id", ignoreDuplicates: true });
  } else {
    await supabase.from("revealed_cells").delete().in("cell_id", ids);
  }
}


export async function toggleReveal(cell) {
  if (!supabase) return;
  if (isCellRevealed(cell)) {
    await supabase.from("revealed_regions")
      .delete().eq("region_id", cell._region).eq("kind", cell._kind);
  } else {
    await supabase.from("revealed_regions")
      .insert({ region_id: cell._region, kind: cell._kind });
  }
}


function pointInFeature(cell, x, y) {
  let inside = false;
  forEachRing(cell.geometry, (ring) => {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const crosses = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (crosses) inside = !inside;
    }
  });
  return inside;
}

function prepCell(f) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  forEachRing(f.geometry, (ring) => {
    for (const [x, y] of ring) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  });
  f._bbox = { minX, minY, maxX, maxY };
  return f;
}
