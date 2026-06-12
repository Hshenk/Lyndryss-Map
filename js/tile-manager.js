/**
 * tile-manager.js — fetches the manifest and loads/caches tile images.
 *
 * Data model recap (see data/SCHEMA.md):
 *   - The world is an infinite grid of tileSize×tileSize px squares.
 *   - Tile (x, y) covers world px [x*tileSize, (x+1)*tileSize) horizontally
 *     and [y*tileSize, (y+1)*tileSize) vertically. Coords may be negative.
 *   - manifest.tiles[layer] lists which tiles exist; anything else is
 *     unrevealed and simply isn't drawn (the dark page background shows).
 */

/**
 * @typedef {Object} Manifest
 * @property {number} version    bump on every GM push
 * @property {string} updated    ISO date of last update (for the header)
 * @property {number} tileSize   world px per tile edge
 * @property {string[]} layers   layer ids, "base" first, overlays after
 * @property {Object<string, [number, number][]>} tiles
 *           per-layer array of [x, y] tile coords that exist
 */

/**
 * Fetch and parse data/manifest.json.
 * Suggested extras: validate shape, store result in module state, and update
 * #map-version / #map-updated in the header.
 * @returns {Promise<Manifest>}
 */
export async function loadManifest() {
  // TODO
  throw new Error("not implemented");
}

/**
 * Does tile (x, y) exist on `layer` per the loaded manifest?
 * Tip: build a Set of "x,y" strings per layer at load time for O(1) lookups —
 * render() will call this for every tile in view, every frame.
 * @param {string} layer
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function hasTile(layer, x, y) {
  // TODO
  return false;
}

/**
 * Get the Image for tile (x, y) of `layer`, loading it on first request.
 *
 * Contract the renderer relies on:
 *   - returns the cached HTMLImageElement immediately if loaded
 *   - returns null if not yet loaded (or nonexistent), and — if a load was
 *     just started — calls `onReady` once the image arrives so the renderer
 *     can request a redraw. Never throws for a missing tile.
 *
 * Tip: cache by `${layer}/${x},${y}`; cap nothing — a westmarch map stays
 * small enough that evicting isn't worth the complexity yet.
 *
 * @param {string} layer
 * @param {number} x
 * @param {number} y
 * @param {() => void} [onReady] called (once) when a newly-requested tile finishes loading
 * @returns {HTMLImageElement | null}
 */
export function getTileImage(layer, x, y, onReady) {
  // TODO: check manifest via hasTile() first; build URL with tileUrl() from config.js
  return null;
}
