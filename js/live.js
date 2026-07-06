/**
 * live.js — the realtime session layer.
 *
 * This is a new *data module*, peer to markers.js / annotations.js. It owns the
 * connection to Supabase and the local arrays of live, shared objects.
 * The renderer draws from it; ui.js drives it from GM tools.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  SESSION_ID,
  PING_LIFETIME_MS,
} from "./config.js";
import { forEachRing, mergeOverlays, forEachLine, setLiveBorderCells } from "./map-data.js";
import { getAnnotations, setAnnotations, setAnnotationBackend,
         clearLocalStorageAnnotations, loadAnnotations } from "./annotations.js";


let supabase = null; // the client
let pings = [];
let channel = null;  // realtime subscription 
let session = { signedIn: false, email: undefined, userId: undefined, isGM: false };
let notifyChange = () => {};
let tokens = [];
let tokenChannel = null;

// Province Data
let liveCells = [];
let revealChannel = null;
let revealedCells = new Set();
let liveRivers = [];
let liveRoutes = [];
let cellLevels = new Map();
let liveStateLabels = { solid: [], faded: []};
let liveProvinceLabels = { solid: [], faded: [] };
let pendingCells = new Map();
let pendingLocs = new Map();
let flushTimer = null;


// Locations and Markers
let liveMarkers = [];
let revealedLocationIds = new Set();

// Pings and public settings
let playerPings = true;
let settingsChannel = null;



function configured() {
  return !SUPABASE_URL.includes("YOUR-PROJECT")
      && !SUPABASE_PUBLISHABLE_KEY.includes("YOUR-PUBLISHABLE");
}


async function pageAll(makeQuery) {
  // Supabase caps a request at ~1000 rows. Page through them all
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
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

  // Sign-in / Sign-out / token-refresh
  supabase.auth.onAuthStateChange((event) => {
    if (event == "INITIAL_SESSION") return;
    applyAuth();
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
        addLocalPing(payload.new);
      },
    )
    .subscribe();
  
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
  

  // Session settings. Read once, then track
  const { data: settingsRow } = await supabase
    .from("session_settings").select("player_pings")
    .eq("session_id", SESSION_ID).maybeSingle();
  if (settingsRow) playerPings = settingsRow.player_pings;

  settingsChannel = supabase
    .channel(`settings-${SESSION_ID}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "session_settings",
        filter: `session_id=eq.${SESSION_ID}` },
      (payload) => {
        if (payload.eventType !== "DELETE") playerPings = payload.new.player_pings;
        notifyChange();
      },
    )
    .subscribe();

  // Auth + first reveal load.
  await applyAuth();
  revealChannel = supabase.channel("revealed_cells")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "revealed_cells" },
      queueCellChange)
    .subscribe();


  // Locations
  supabase.channel("revealed_locations")
    .on("postgres_changes", { event: "*", schema: "public", table: "revealed_locations" }, 
        queueLocationChange)
    .subscribe();
}


function addLocalPing(row) {
  if (pings.some((p) => p.id === row.id)) return; // De-dupe


  const createdAt = Date.now();
  pings.push({ id: row.id, x: row.x, y: row.y, color: row.color, created_at: createdAt });
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
export async function sendPing(x, y, color) {
  if (!supabase) return;
  const { error } = await supabase
    .from("pings")
    .insert({ session_id: SESSION_ID, x, y, color});
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

//   --- Annotations ---
const cloudBackend = {
  add(a)        { insertPlayerAnnotation(a); },
  update(id, a) { updatePlayerAnnotation(a); },
  remove(id)    { deletePlayerAnnotation(id); },
  clear()       { clearPlayerAnnotations(); },
};

async function insertPlayerAnnotation(a) {
  const { error } = await supabase.from("player_annotations").insert({
    id: a.id, user_id: session.userId,
    kind: a.kind, icon: a.icon, color: a.color ?? null, x: a.x, y: a.y, text: a.text ?? "",
  });
  if (error) console.warn("annotation save failed:", error.message);
}

async function updatePlayerAnnotation(a) {
  const { error } = await supabase.from("player_annotations").update({
    kind: a.kind, icon: a.icon, color: a.color ?? null, x: a.x, y:a.y, text: a.text ?? "",
    updated_at: new Date().toISOString(),
  }).eq("id", a.id);
  if (error) console.warn("annotation update failed:", error.message);
}
async function deletePlayerAnnotation(id) {
  const { error } = await supabase.from("player_annotations").delete().eq("id", id);
  if (error) console.warn("annotation delete failed:", error.message);
}

async function clearPlayerAnnotations() {
  const { error } = await supabase.from("player_annotations")
    .delete().eq("user_id", session.userId);
  if (error) console.warn("annotation clear failed:", error.message);
}

async function loadPlayerAnnotations() {
  const rows = await pageAll(() => supabase.from("player_annotations")
    .select("id, kind, icon, color, x, y, text").order("updated_at"));
  return rows.map((r) => ({
    id: r.id, kind: r.kind, icon: r.icon, color: r.color ?? null, x: r.x, y: r.y, text: r.text ?? "",
  }));
}

/** On first sign in: push any marks made while anonymous to the account, then drop local copy */
async function migrateLocalAnnotations() {
  const local = getAnnotations();
  if (!local.length) return;
  const rows = local.map((a) => ({
    id: a.id, user_id: session.userId,
    kind: a.kind, icon: a.icon, color: a.color ?? null, x: a.x, y: a.y, text: a.text ?? "",
  }));
  const { error } = await supabase.from("player_annotations")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true});
  if (error) { console.warn("annotation migrate failed:", error.message); return; }
  clearLocalStorageAnnotations();
}

async function enterCloudMode() {
  await migrateLocalAnnotations(); // upload local marks
  setAnnotationBackend(cloudBackend); // future writes go straight to supabase
  const rows = await loadPlayerAnnotations();
  setAnnotations(rows); // render happens via notifyChange()
}

function exitCloudMode() {
  setAnnotationBackend(null); // Switch back to localStorage
  loadAnnotations();
}

//   --- Login and Logout ---


/**
 * GM and Player Sign-in and Sign-out
 */
export async function signIn(email, password) {
  if (!supabase) return { ok: false, error: "Set your Supabase keys in config.js first." };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { ok: false, error: error.message } : { ok: true };
}
export async function signOut() {
  await supabase?.auth.signOut();
}


/**
 * Whether a GM is currently signed in (drives whether ui.js shows write tools).
 * @returns {boolean}
 */
export function isGM() { return session.isGM; }
export function gmEmail() { return session.email ?? ""; }

export function isSignedIn() { return session.signedIn; }
export function accountEmail() { return session.email ?? ""; }

/** Self-serve player registration with "Confirm email" on.
 *  No session exists until they confirm their email.
 */
export async function signUp(email, password) {
  if (!supabase) return { ok: false, error: "Set you Supabase keys in config.js first." };
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { ok: false, error: error.message };
  return { ok: true, needsConfirm: !data.session };
}

/** Read the current auth session and decide whether the user is a GM */
async function resolveSession() {
  const { data: { session: s } } = await supabase.auth.getSession();
  if (!s) {
    session = { signedIn: false, email: undefined, userId: undefined, isGM: false };
    return;
  }
  let gm = false;
  const { data, error } = await supabase.rpc("is_gm");
  if (error) console.warn("is_gm check failed:", error.message);
  else gm = data === true;
  session = { signedIn: true, email: s.user.email, userId: s.user.id, isGM: gm };
}

/** React to a sign-in / sign-out: re-resolve */
async function applyAuth() {
  const before = session.signedIn;
  await resolveSession();
  const after = session.signedIn;
  if (after && !before) await enterCloudMode();
  else if (!after && before) exitCloudMode();
  await refreshRevealed();
  notifyChange();
}


//   --- Region/Province Data ---
async function refreshRevealed() {
  if (!supabase) return;

  // GM full detail
  if (isGM()) {
    const levels = await pageAll(() => 
      supabase.from("revealed_cells").select("cell_id, level").order("cell_id"));
    const levelByCell = new Map(levels.map((r) => [r.cell_id, r.level]));
    revealedCells = new Set(levelByCell.keys());
    cellLevels = levelByCell;

    const rows = await pageAll(() => 
      supabase.from("hidden_cells").select("data, id").order("id"));
    liveCells = rows.map((row) => {
      const f = prepCell(row.data);
      f._level = levelByCell.get(row.id) ?? 0;
      return f;
    });
  } else {
    // Players: returns only revealed cells, stripped to their level.
    const rows = await pageAll(() => supabase.rpc("get_visible_cells").order("id"));
    liveCells = rows.map((row) => prepCell(row.data));
    revealedCells = new Set(liveCells.map((c) => c.properties.id));
    cellLevels = new Map(liveCells.map((c) => [c.properties.id, c.properties.level]));
  }


  mergeLiveOverlays();
  recomputeDerived();


  // Rivers and Routes
  const lineRows = await pageAll(() => 
    supabase.from("hidden_lines").select("kind, cell_id, min_level, data").order("id"));
  liveRivers = lineRows.filter((r) => r.kind === "river").map(prepLine);
  liveRoutes = lineRows.filter((r) => r.kind === "route").map(prepLine);

  // Locations and POI
  const locRows = await pageAll(() => 
    supabase.from("hidden_locations").select("id, cell_id, data").order("id"));
  liveMarkers = locRows.map((r) => { const m = r.data; m._cell = r.cell_id; return m; });

  const relRows = await pageAll(() => 
    supabase.from("revealed_locations").select("location_id").order("location_id"));
  revealedLocationIds = new Set(relRows.map((r) => r.location_id));

  notifyChange();
}

function mergeLiveOverlays() {
  // Fold each revealed cell's baked palette entries into the live overlays
  const merged = {};
  for (const cell of liveCells) {
    const m = cell._meta;
    if (!m) continue;
    for (const dim in m) {
      merged[dim] = merged[dim] || {};
      Object.assign(merged[dim], m[dim]);
    }
  }
  mergeOverlays(merged);
}

export function getLiveCells() {
  return liveCells;
}

export function isCellRevealed(cell) {
  return revealedCells.has(cell.properties.id);
}

// Checks if cell is under click
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

// Set a discovery level for a scope around the clicked cell
export async function revealScope(cell, scope, level) {
  if (!supabase) return;
  const ids = cellsInScope(cell, scope).map((c) => c.properties.id);
  if (!level || level <= 0) {
    await supabase.from("revealed_cells").delete().in("cell_id", ids);
  } else {
    await supabase.from("revealed_cells")
      .upsert(ids.map((id) => ({ cell_id: id, level })), { onConflict: "cell_id" });
  }
}

function regionName(cell, dim) {
  const id = cell.properties[dim];
  return cell._meta?.[dim]?.[String(id)]?.name ?? `${dim} ${id}`;
}

export function scopeInfo(cell, scope) {
  const count = cellsInScope(cell, scope).length;
  let label;
  if (scope === "cell")          label = `Cell #${cell.properties.id}`;
  else if (scope === "province") label = `Province: ${regionName(cell, "province")}`;
  else                           label = `State: ${regionName(cell, "state")}`;
  return { label, count, currentLevel: cell._level ?? 0 };
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

function prepLine(row) {
  const f = row.data;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  forEachLine(f.geometry, (coords) => {
    for (const [x, y] of coords) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  });
  f._bbox = { minX, minY, maxX, maxY };
  f._cell = row.cell_id;
  f._min = row.min_level;
  return f;
}

export function getLiveRivers() { return liveRivers; }
export function getLiveRoutes() { return liveRoutes; }
export function lineRevealed(seg) {
  return (cellLevels.get(seg._cell) ?? 0) >= seg._min;
}


// --- Labels ---
function labelsByDim(dim) {
  const groups = new Map();
  for (const cell of liveCells) {
    const id = cell.properties[dim];
    if (id == null) continue;
    const b = cell._bbox;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const revealed = (cellLevels.get(cell.properties.id) ?? 0) >= 3;

    let g = groups.get(id);
    if (!g) { g = { name: regionName(cell, dim), aX: 0, aY: 0, aN: 0, rX: 0, rY: 0, rN: 0 };
                  groups.set(id, g); }
    g.aX += cx; g.aY += cy; g.aN += 1;                  // All Cells
    if (revealed) { g.rX += cx; g.rY += cy; g.rN += 1}  // Revealed Only
  }

  const solid = [], faded = [];
  for (const g of groups.values()) {
    if (!g.name) continue;
    if (g.rN > 0) solid.push({ name: g.name, x: g.rX / g.rN, y: g.rY / g.rN });
    else          faded.push({ name: g.name, x: g.aX / g.aN, y: g.aY / g.aN })
  }
  return { solid, faded };
}

function computeLiveLabels() {
  liveStateLabels = labelsByDim("state");
  liveProvinceLabels = labelsByDim("province");
}

export function getLiveStateLabels() { return liveStateLabels.solid; }
export function getLiveStateLabelsFaded() { return liveStateLabels.faded; }
export function getLiveProvinceLabels() { return liveProvinceLabels.solid; }
export function getLiveProvinceLabelsFaded() { return liveProvinceLabels.faded; }


//   --- Locations and POI ---
export function getLiveMarkers() { return liveMarkers; }
export function locationRevealed(m) {
  if (revealedLocationIds.has(m.id)) return true;
  if (m.category === "settlements") return (cellLevels.get(m._cell) ?? 0) >= 3;
  return false;
}
export function liveMarkerAt(wx, wy, radius) {
  let best = null, bestSq = radius * radius;
  for (const m of liveMarkers) {
    const dx = m.x - wx, dy = m.y - wy, d = dx * dx + dy * dy;
    if (d <= bestSq) { best = m; bestSq = d; }
  }
  return best;
}
/** GM reveal single location */
export async function revealLocation(m, on) {
  if (!supabase) return;
  if (on) {
    await supabase.from("revealed_locations")
      .upsert([{ location_id: m.id }], { onConflict: "location_id", ignoreDuplicates: true });
  } else {
    await supabase.from("revealed_locations").delete().eq("location_id", m.id);
  }
}
export function locationIndividuallyRevealed(m) {
  return revealedLocationIds.has(m.id);
}


//   --- Queue to prevent recalling DB every change ---

/** Recompute everything derived from liveCells + celllevels (no DB) */
function recomputeDerived() {
  for (const c of liveCells)
    c.properties._rev = (cellLevels.get(c.properties.id) ?? 0) >= 3;
  setLiveBorderCells(liveCells);
  computeLiveLabels();
}

function queueCellChange(payload) {
  if (payload.eventType === "DELETE") pendingCells.set(payload.old.cell_id, null);
  else pendingCells.set(payload.new.cell_id, payload.new.level);
  scheduleFlush();
}

function queueLocationChange(payload) {
  if (payload.eventType === "DELETE") pendingLocs.set(payload.old.location_id, null);
  else pendingLocs.set(payload.new.location_id, true);
  scheduleFlush();
}

function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushReveals, 150);
}

// GM applies locally, players refetch once
async function flushReveals() {
  const cells = pendingCells; const locs = pendingLocs;
  pendingCells = new Map(); pendingLocs = new Map();

  if (isGM()) {
    // GM holds the whole catalog, just update the reveal sets, no fetch
    for (const [id, level] of cells) {
      if (level === null) { revealedCells.delete(id); cellLevels.delete(id); }
      else { revealedCells.add(id); cellLevels.set(id, level); }
    }
    for (const [id, on] of locs) {
      if (on === null) revealedLocationIds.delete(id); else revealedLocationIds.add(id);
    }
    recomputeDerived();
    notifyChange();
  } else{
    // Players can't hold the full catalog so refetch the visible set, but only once per burst
    await refreshRevealed();
  }
}


//   --- Pings ---
export function playerPingsEnabled() { return playerPings; }
export async function setPlayerPingsEnabled(on) {
  if (!supabase) return;
  playerPings = on;
  const { error } = await supabase.from("session_settings").upsert(
    { session_id: SESSION_ID, player_pings: on, updated_at: new Date().toISOString() },
    { onConflict: "session_id" },
  );
  if (error) console.warn("settings update failed:", error.message);
}