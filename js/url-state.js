/**
 * url-state.js — shareable view links, lotrproject-style.
 *
 * Encodes the viewport (and optionally enabled layers) in the URL hash so a
 * player can paste a link that opens the map at the same spot:
 *
 *   #zoom=1.5&x=240&y=-120&layers=territory,culture
 *
 * Use history.replaceState (not location.hash =) when writing, so panning
 * doesn't flood the browser history. Debounce writes (~250ms after the view
 * stops changing).
 */

const DEBOUNCE_MS = 250;


/**
 * Parse the current location.hash.
 * @returns {{x: number, y: number, scale: number, layers: string[]} | null}
 *          null when the hash is absent or malformed
 */
export function readViewFromHash() {
  const raw = location.hash.slice(1);
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  const x = Number(p.get("x"));
  const y = Number(p.get("y"));
  const scale = Number(p.get("zoom"));
  if (![x, y, scale].every(Number.isFinite)) return null;
  const layers = (p.get("layers") ?? "").split(",").filter(Boolean);
  return { x, y, scale, layers };
}


let timer = null;


/**
 * Write view state into the URL hash (debounced, replaceState).
 * Call from the renderer whenever the viewport settles, and from layers.js
 * change events.
 * @param {{x: number, y: number, scale: number, layers: string[]}} state
 */
export function writeViewToHash(state) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const p = new URLSearchParams();
    p.set("zoom", state.scale.toFixed(3));
    p.set("x", String(Math.round(state.x)));
    p.set("y", String(Math.round(state.y)));
    if (state.layers.length) p.set("layers", state.layers.join(","));
    history.replaceState(null, "", `#${p.toString()}`);
  }, DEBOUNCE_MS);
}

/**
 * Subscribe to hashchange (user pastes/edits a link while the app is open)
 * so the view can jump there.
 * @param {(state: {x: number, y: number, scale: number, layers: string[]}) => void} callback
 */
export function onHashChange(callback) {
  window.addEventListener("hashchange", () => {
    const state = readViewFromHash();
    if (state) callback(state);
  });
}
