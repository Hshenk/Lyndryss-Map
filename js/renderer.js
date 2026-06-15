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

import { OVERLAY_ALPHA } from "./config.js";
import { getTileImage } from "./tile-manager.js";
import { isLayerVisible } from "./layers.js";


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
  // Remember a ResizeObserver on the canvas parent + resize() keeps it crisp.
  
  const ctx = canvas.getContext("2d");
  const tileSize = manifest.tileSize;

  // (view.x, view.y) is the world point at the center
  // scale = screen px per world px.

  const view = { x: tileSize / 2, y: tileSize / 2, scale: 1};

  // returns an x and y adjusted to the client view window and scale
  function worldToScreen(wx, wy) {
    return {
      x: (wx - view.x) * view.scale + canvas.clientWidth / 2,
      y: (wy - view.y) * view.scale + canvas.clientHeight / 2,
    }
  }


  function screenToWorld(sx, sy) {
    return {
      x: (sx - canvas.clientWidth / 2) / view.scale + view.x,
      y: (sy - canvas.clientHeight / 2) / view.scale + view.y,
    }
  }


  // Main render loop
  // We don't need to redraw all of the time, we just set a flag and let the browser call draw() before the next repaint
  let frameRequested = false;

  function render() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(draw);
  }

  function draw() {
    frameRequested = false;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // Find what tiles are in view

    const topLeft = screenToWorld(0, 0);
    const bottomRight = screenToWorld(w, h);
    const x0 = Math.floor(topLeft.x / tileSize);
    const x1 = Math.floor(bottomRight.x / tileSize);
    const y0 = Math.floor(topLeft.y / tileSize);
    const y1 = Math.floor(bottomRight.y / tileSize);

    for (const layer of manifest.layers) {
      if (!isLayerVisible(layer)) continue;
      ctx.globalAlpha = layer === "base" ? 1 : OVERLAY_ALPHA;

      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++){
          const img = getTileImage(layer, tx, ty, render);
          if (img === null) continue;
          
          const a = worldToScreen (tx * tileSize, ty * tileSize);
          const b = worldToScreen ((tx + 1) * tileSize, (ty + 1) * tileSize);
          const left = Math.round(a.x);
          const top = Math.round(a.y);
          ctx.drawImage(img, left, top, Math.round(b.x) - left, Math.round(b.y) - top);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // Sizing 
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();

  return { view, render, resize, worldToScreen, screenToWorld };
}
