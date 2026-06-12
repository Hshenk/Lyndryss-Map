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

/**
 * Parse the current location.hash.
 * @returns {{x: number, y: number, scale: number, layers: string[]} | null}
 *          null when the hash is absent or malformed
 */
export function readViewFromHash() {
  // TODO: URLSearchParams works on hash.slice(1)
  return null;
}

/**
 * Write view state into the URL hash (debounced, replaceState).
 * Call from the renderer whenever the viewport settles, and from layers.js
 * change events.
 * @param {{x: number, y: number, scale: number, layers: string[]}} state
 */
export function writeViewToHash(state) {
  // TODO
}

/**
 * Subscribe to hashchange (user pastes/edits a link while the app is open)
 * so the view can jump there.
 * @param {(state: {x: number, y: number, scale: number, layers: string[]}) => void} callback
 */
export function onHashChange(callback) {
  // TODO
}
