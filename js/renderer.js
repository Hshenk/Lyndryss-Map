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

import { MIN_SCALE, MAX_SCALE, OVERLAY_ALPHA } from "./config.js";
import { getVisibleMarkers, getCategoryIcon, hitTest as markerHitTest } from "./markers.js";
import { getAnnotations, addAnnotation, hitTest as annotationHitTest } from "./annotations.js";
import { getUIState, openMarkerPopup, openNotePopup, closePopups, setActiveTool } from "./ui.js";
import { getVisibleCells, forEachRing } from "./map-data.js";


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


/** Radius of the round badge markers/annotations are drawn in. */
const BADGE_RADIUS = 12;
const MARKER_RING = "#5aa9e6"; // GM markers
const ANNOTATION_RING = "#e0b75c"; // Player markers
/** Pointer movement (px) below which a press counts as a click, not a drag */
const CLICK_SLOP = 5;
/** Zoom factor per wheel notch. */
const WHEEL_STEP = 1.1;

/**
 * Create the renderer bound to a canvas.
 * @param {HTMLCanvasElement} canvas  #map-canvas
 * @param {import("./tile-manager.js").Manifest} manifest
 * @returns {Renderer}
 */
export function createRenderer(canvas, manifest) {

  // Grab the readout element 
  const coordsEl = document.getElementById("coords-readout");

  // Remember a ResizeObserver on the canvas parent + resize() keeps it crisp.
  const ctx = canvas.getContext("2d");

  // (view.x, view.y) is the world point at the center
  // scale = screen px per world px.
  const home = manifest.home ?? [0,0];
  const view = { x: home[0], y: home[1], scale: 1};

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

    // The visible rectangle in world px. 
    const tl = screenToWorld(0, 0);
    const br = screenToWorld(w, h);

    // --- base map: fill each visible cell with its baked color
    for (const cell of getVisibleCells(tl.x, tl.y, br.x, br.y)) {
      ctx.fillStyle = cell.properties.fill;
      ctx.fill(cellPath(cell));
    }

    // --- markers then annotations
    for (const m of getVisibleMarkers()) {
      drawBadge(m.x, m.y, getCategoryIcon(m.category), MARKER_RING);
    }
    for (const a of getAnnotations()) {
      drawBadge(a.x, a.y, `assets/icons/${a.icon}.svg`, ANNOTATION_RING);
    }
  }

  /**
   * Build a Path2d outline of one cell projected into screen px.
   * 
   */
  function cellPath(cell) {
    const path = new Path2D();
    forEachRing(cell.geometry, (ring) => {
      for (let i = 0; i < ring.length; i++) {
        const p = worldToScreen(ring[i][0], ring[i][1]);
        if (i === 0) path.moveTo(p.x, p.y);
        else path.lineTo(p.x, p.y);
      }
      path.closePath();
    });
    return path;
  }


  // Badges 
  const iconCache = new Map();

  function getIcon(path) {
    let img = iconCache.get(path);
    if (img === undefined) {
      img = new Image();
      img.onload = render;
      img.src = path;
      iconCache.set(path, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  function drawBadge(wx, wy, iconPath,ringColor) {
    const p = worldToScreen(wx, wy);
    const r = BADGE_RADIUS;
    
    //Skip badges that are off screen
    if (p.x < -r || p.y < -r || p.x > canvas.clientWidth + r || p.y > canvas.clientHeight + r) {
      return;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI *2);
    ctx.fillStyle = "rgba(20, 23, 28, 0.85)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = ringColor;
    ctx.stroke();

    const icon = getIcon(iconPath);
    if (icon) ctx.drawImage(icon, p.x - 8, p.y -8 , 16, 16);
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

  

  // zoom
  function zoomBy(factor, cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2) {
    // Zoom to cursor, the point under (cx, cy), but be the same screen position after scale change.
    const before = screenToWorld(cx, cy);
    view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    const after = screenToWorld(cx, cy);
    view.x += before.x - after.x;
    view.y += before.y - after.y;
    render();
  }

  function resetView() {
    view.x = home[0];
    view.y = home[1];
    view.scale = 1;
    render();
  }


  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY -rect.top };
  }

  // Set up pointers
  const pointers = new Map();
  let dragDistance = 0;
  let lastPinchDist = null;

  canvas.addEventListener("pointerdown", (e) => {
    // Keep receiving move/up for this pointer even if it leaves the canvas.
    try{
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    pointers.set(e.pointerId, canvasPoint(e));
    dragDistance = 0;
    if (pointers.size === 1) document.body.classList.add("is-panning");
    closePopups();
  });

  canvas.addEventListener("pointermove", (e) => {
    const cur = canvasPoint(e);

    // Coordinate readout (World coordinates that are under the cursor).
    const wpt = screenToWorld(cur.x, cur.y);
    coordsEl.textContent = `${Math.round(wpt.x)}, ${Math.round(wpt.y)}`;

    if (!pointers.has(e.pointerId)) return; // We're hovering, not holding click

    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, cur); 

    if (pointers.size === 1) {
      // Drag-to-pan. Screen moves right, world center moves left
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      dragDistance += Math.abs(dx) + Math.abs(dy);
      view.x -= dx / view.scale;
      view.y -= dy / view.scale;
      render();
    } else if (pointers.size === 2) {
      // Pinch Zoom scale by the ration of two finger distance.
      const [p1, p2] = [...pointers.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      if (lastPinchDist !== null && lastPinchDist > 0) {
        zoomBy(dist / lastPinchDist, mid.x, mid.y);
      }
      lastPinchDist = dist; 
      dragDistance = Infinity; // A pinch does not count as a click 
    }
  });

  // This just handles ending a pointer event for when we stop holding click
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinchDist = null;
    if (pointers.size === 0) {
      document.body.classList.remove("is-panning");
      if (e.type === "pointerup" && dragDistance < CLICK_SLOP) {
        const p = canvasPoint(e);
        handleClick(p.x, p.y);
      }
    }
  }

  // Events that would cause us to end a click
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  // Wheel zoom. { passive: false } 
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault(); // Don't scroll the actual page, we're trying to zoom instead
    const p = canvasPoint(e);
    zoomBy(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, p.x, p.y);
  }, {passive: false });

  // Click handling on the map
  function handleClick(sx, sy) {
    const wpt = screenToWorld(sx, sy);
    const ui = getUIState();

    // Placement tools (Icons and notes)
    if (ui.activeTool === "icon" || ui.activeTool === "note") {
      const annotation = {
        id: crypto.randomUUID(),
        kind: ui.activeTool,
        icon: ui.activeTool === "icon" ? ui.selectedIcon : "question",
        x: wpt.x,
        y: wpt.y,
        text: "",
      };
      addAnnotation(annotation);
      if (ui.activeTool === "note") openNotePopup(annotation, sx, sy);
      setActiveTool("pan")
      render();
      return;
    }


    // Normal click
    const radius = (BADGE_RADIUS + 4) / view.scale;
    const annotation = annotationHitTest(wpt.x, wpt.y, radius);
    if (annotation) {
      const p = worldToScreen(annotation.x, annotation.y);
      openNotePopup(annotation, p.x, p.y);
      return;
    }
    const marker = markerHitTest(wpt.x, wpt.y, radius);
    if (marker) {
      const p = worldToScreen(marker.x, marker.y);
      openMarkerPopup(marker, p.x, p.y);
    }
  }

  return { view, render, resize, worldToScreen, screenToWorld, zoomBy, resetView };
}