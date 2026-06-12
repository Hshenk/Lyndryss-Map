/**
 * renderer.js — the hand-rolled canvas renderer: viewport state, coordinate
 * transforms, pan/zoom input, and the draw loop.
 *
 * Coordinate systems:
 *   world px  — fixed map space; world (0,0) = top-left corner of tile (0,0)
 *   screen px — CSS pixels relative to the canvas; multiply by
 *               devicePixelRatio when sizing the canvas backing store
 *
 * Viewport state:
 *   { x, y, scale } where (x, y) is the world point at the canvas center and
 *   scale = screen px per world px (clamped to MIN_SCALE..MAX_SCALE).
 *
 *   worldToScreen: sx = (wx - view.x) * scale + canvasW / 2
 *   screenToWorld: wx = (sx - canvasW / 2) / scale + view.x
 *
 * Draw order per frame:
 *   1. clear
 *   2. base tiles in view (loop the visible tile-coord range, getTileImage())
 *   3. enabled overlay layers at OVERLAY_ALPHA
 *   4. GM markers for enabled categories (markers.js provides the list)
 *   5. player annotations (annotations.js provides the list)
 *
 * Input to handle on the canvas (pointer events; touch-action is disabled
 * in CSS so you own gestures):
 *   - drag to pan (add body.is-panning while dragging for the cursor)
 *   - wheel to zoom centered on the cursor
 *   - pinch to zoom (track two pointers)
 *   - click → forward to markers.js hit-test / annotation placement,
 *     depending on the active tool (ui.js owns tool state)
 */

/**
 * @typedef {Object} Viewport
 * @property {number} x world px at canvas center
 * @property {number} y world px at canvas center
 * @property {number} scale screen px per world px
 */

/**
 * @typedef {Object} Renderer
 * @property {Viewport} view
 * @property {() => void} render            draw one frame (cheap to call; coalesce with rAF)
 * @property {() => void} resize            re-measure container, fix devicePixelRatio, redraw
 * @property {(wx: number, wy: number) => {x: number, y: number}} worldToScreen
 * @property {(sx: number, sy: number) => {x: number, y: number}} screenToWorld
 * @property {(factor: number, cx?: number, cy?: number) => void} zoomBy
 *           multiply scale by factor, keeping screen point (cx, cy) fixed
 *           (defaults to canvas center)
 * @property {() => void} resetView         back to tile (0,0) at scale 1
 */

/**
 * Create the renderer bound to a canvas.
 * @param {HTMLCanvasElement} canvas  #map-canvas
 * @param {import("./tile-manager.js").Manifest} manifest
 * @returns {Renderer}
 */
export function createRenderer(canvas, manifest) {
  // TODO: state, transforms, event listeners, rAF-coalesced render loop.
  // Remember a ResizeObserver on the canvas parent + resize() keeps it crisp.
  throw new Error("not implemented");
}
