import { MIN_SCALE, MAX_SCALE, PING_LIFETIME_MS } from "./config.js";
import { getVisibleMarkers, getCategoryIcon, hitTest as markerHitTest } from "./markers.js";
import { getAnnotations, addAnnotation, hitTest as annotationHitTest } from "./annotations.js";
import { getUIState, openMarkerPopup, openNotePopup, openTokenPopup, closePopups, setActiveTool, openRevealPopup } from "./ui.js";
import { getVisibleCells, forEachRing, cellAt, overlayColor,
         getVisibleRivers, getVisibleRoutes, forEachLine, getStateLabels, getProvinceLabels, 
         riverAt, getStateBorders, getStateBordersFaded, getProvinceBorders, getProvinceBordersFaded } from "./map-data.js";
import { getActiveOverlay, isRiversVisible, isRoutesVisible, isLabelsVisible, isCategoryVisible } from "./layers.js";
import { getPings, sendPing, getTokens, placeToken, moveToken, tokenAt, getLiveCells,
         isCellRevealed, liveCellAt, revealScope, isGM, scopeInfo, getLiveRivers, getLiveRoutes,
        lineRevealed, getLiveProvinceLabels, getLiveProvinceLabelsFaded, getLiveStateLabels, getLiveStateLabelsFaded,
        getLiveMarkers, locationRevealed, liveMarkerAt } from "./live.js";





/** Radius of the round badge markers/annotations are drawn in. */
const BADGE_RADIUS = 12;
const SETTLEMENT_FILL = "#f4efe3";
const SETTLEMENT_STROKE = "#20242b";
const CAPITAL_FILL = "#e8c64a";
const MARKER_RING = "#5aa9e6"; // GM markers
const ANNOTATION_RING = "#e0b75c"; // Player markers
/** Pointer movement (px) below which a press counts as a click, not a drag */
const CLICK_SLOP = 5;
/** Zoom factor per wheel notch. */
const WHEEL_STEP = 1.1;

/** Rivers and Routes */
const RIVER_COLOR = "#3d6f9e";
const ROUTE_STYLES = {
  roads:     { color: "#9c7a4d", width: 1.6, dash: [] },
  trails:    { color: "#9c7a4d", width: 1.0, dash: [4, 3] },
  searoutes: { color: "#6f8fae", width: 1.0, dash: [2, 4] },
};

/** Labels */
const LABEL_COLOR = "#1c1f26";
const LABEL_HALO = "rgba(245, 242, 235, 0.40)";
const LABEL_FONT = "'Amarante', system-ui, sans-serif";

/** Borders */
const STATE_BORDER_COLOR = "rgba(45, 42, 38, 0.7)";
const STATE_BORDER_WIDTH = 1.6;
const PROVINCE_BORDER_COLOR = "rgba(70, 64, 58, 0.4)";
const PROVINCE_BORDER_WIDTH = 0.9;


// GM Tools
const PING_COLOR = "#ffd24a";
const TOKEN_RADIUS = 13;



/**
 * Create the renderer bound to a canvas.
 * @param {HTMLCanvasElement} canvas  #map-canvas
 * @param {import("./tile-manager.js").Manifest} manifest
 * @returns {Renderer}
 */
export function createRenderer(canvas, manifest, onViewChange) {

  // Grab the readout element 
  const coordsEl = document.getElementById("coords-readout");
  const statusEl = document.getElementById("status-readout");

  // Remember a ResizeObserver on the canvas parent + resize() keeps it crisp.
  const ctx = canvas.getContext("2d");

  // (view.x, view.y) is the world point at the center
  // scale = screen px per world px.
  const home = manifest.home ?? [0,0];
  const view = { x: home[0], y: home[1], scale: 1};

  // Measuring Tool
  let measure = null;
  let measureTracking = false;

  // returns an x and y adjusted to the client view window and scale
  function worldToScreen(wx, wy) {
    return {
      x: (wx - view.x) * view.scale + canvas.clientWidth / 2,
      y: (wy - view.y) * view.scale + canvas.clientHeight / 2,
    }
  }

  // Build the readout text for a world point
  function describeAt(wpt, cell) {
    const xy = `${Math.round(wpt.x)}, ${Math.round(wpt.y)}`;
    if (!cell) return xy;
    const p = cell.properties;
    const biome = manifest.overlays?.biome?.[p.biome]?.name;

    // In heightmap mode, show elevation
    if (getActiveOverlay() === "heightmap") {
      const elev = `${Math.round(p.height).toLocaleString()} ft`;
      return [xy, ...[biome, elev].filter(Boolean)].join(" · ");
    }


    // const province = p.province ? manifest.overlays?.province?.[p.province]?.name : null;
    // // State 0 is neutrals
    // const state = p.state ? manifest.overlays?.state?.[p.state]?.name : null;

    const parts = [biome].filter(Boolean);
    return parts.length ? `${xy} · ${parts.join(" · ")}` : xy;
  }


  /** Gets the text to display in a status text at the bottom of the page */
  function statusText(cell, river) {
    if (river) return `${river.properties.name} River` || "River";
    if (!cell || cell.properties.type === "ocean") return "";
    const p = cell.properties;
    if (p.biome === 11 || manifest.overlays?.province?.[p.province]?.name === "Province 0") return "";
    if (p.type === "lake") return `${p.name} Lake` || "Lake";

    const mode = getActiveOverlay();
    if (mode === "culture") {
      const c = manifest.overlays?.culture?.[p.culture]?.name;
      return c ? `Culture: ${c}` : "";
    }
    if (mode === "religion") {
      const r = manifest.overlays?.religion?.[p.religion]?.name;
      return r ? `Religion: ${r}` : "";
    }
    const prov = manifest.overlays?.province?.[p.province]?.name;
    const state = p.state ? manifest.overlays?.state?.[p.state]?.name : null;
    return [prov, state].filter(Boolean).join(", ");
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
    onViewChange?.(view);
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
    const overlay = getActiveOverlay(); // Will be null, or "territory/culture/religion"


    // Draw all of the provinces that have been revealed to our client
    for (const cell of getVisibleCells(tl.x, tl.y, br.x, br.y)) paintCell(cell, overlay);

    const gm = isGM();
    for (const cell of getLiveCells()) {
      const b = cell._bbox;
      if (b.maxX < tl.x || b.minX > br.x || b.maxY < tl.y || b.minY > br.y) continue;
      if (isCellRevealed(cell)) {
        paintCell(cell, overlay);
      } else if (gm && !isWaterCell(cell)) {
        ctx.globalAlpha = 0.35; // Partially hidden to indicate it is a hidden tile
        paintCell(cell,overlay);
        ctx.globalAlpha = 1;
      }
    }

    drawBorders(tl, br);


    // --- Rivers and Routes ---
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.strokeStyle = RIVER_COLOR;
    ctx.setLineDash([]);
    if (isRiversVisible()) {
      for (const river of getVisibleRivers(tl.x, tl.y, br.x, br.y)) {
        drawRiver(river);
      }

      for (const seg of getLiveRivers()) {
        const b = seg._bbox;
        if (b.maxX < tl.x || b.minX > br.x || b.maxY < tl.y || b.minY > br.y) continue;
        ctx.globalAlpha = lineRevealed(seg) ? 1 : 0.35;
        drawLiveRiver(seg);
      }
      ctx.globalAlpha = 1;

      // Re-cover lakes so rivers passing over them don't show
      for (const cell of getVisibleCells(tl.x, tl.y, br.x, br.y)) {
        if (cell.properties.type === "lake") {
          ctx.fillStyle = cell.properties.fill;
          ctx.fill(cellPath(cell));
        }
      }
    }


    if (isRoutesVisible()) {
      for (const route of getVisibleRoutes(tl.x, tl.y, br.x, br.y)) {
        const s = ROUTE_STYLES[route.properties.group] ?? ROUTE_STYLES.trails;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.setLineDash(s.dash);
        ctx.stroke(linePath(route));
      }
      for (const seg of getLiveRoutes()) {
        const b = seg._bbox;
        if (b.maxX < tl.x || b.minX > br.x || b.maxY < tl.y || b.minY > br.y) continue;
        const s = ROUTE_STYLES[seg.properties.group] ?? ROUTE_STYLES.trails;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.setLineDash(s.dash);
        ctx.stroke(linePath(seg));
      }
    }

    ctx.setLineDash([]); // Reset so marker-ring strokes are not dashed


    // --- markers then annotations
    for (const m of getVisibleMarkers()) {
      if (m.category === "settlements") {
        if (settlementVisibleAt(m, view.scale)) drawSettlement(m);
      } else {
        drawBadge(m.x, m.y, getCategoryIcon(m.category), MARKER_RING);
      }
    }
    for (const a of getAnnotations()) {
      drawBadge(a.x, a.y, `assets/icons/${a.icon}.svg`, ANNOTATION_RING);
    }

    for (const token of getTokens()) drawToken(token);

    // Live markers and locations
    for (const m of getLiveMarkers()) {
      if (!isCategoryVisible(m.category)) continue;
      const revealed = locationRevealed(m);
      if (!revealed && !gm) continue; // Should never happen as players should not have this info
      ctx.globalAlpha = revealed ? 1 : 0.4;
      if (m.category === "settlements") {
        if (settlementVisibleAt(m, view.scale)) drawSettlement(m);
      } else {
        drawBadge(m.x, m.y, getCategoryIcon(m.category), MARKER_RING);
      }
      ctx.globalAlpha = 1;
    }

    // Draw pings
    const nowMs = Date.now();
    for (const ping of getPings()) {
      if (!drawOffscreenPing(ping, nowMs, w, h)) drawPing(ping, nowMs);
    }
  
    drawLabels();

    // Measuring Tool
    if (measure && getUIState().activeTool === "measure") drawMeasure()

    // Pings
    if (getPings().length > 0 && !frameRequested) {
      frameRequested = true; 
      requestAnimationFrame(draw);    
    }
  }

  const MODE_MIN_LEVEL = { heightmap: 2, territory: 3, province: 3, culture: 4, religion: 4 };
  function cellInMode(cell, mode) {
    // A cell only participates in a map mode once its level of discovery reaches that mode's threshold
    const lvl = cell.properties.level;
    if (lvl == null) return true; 
    return lvl >= (MODE_MIN_LEVEL[mode] ?? 1);
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

  /** Fill one cell with its base color, or the overlay color when a mode is active */
  function paintCell(cell, overlay) {
    const path = cellPath(cell);
    let fill = cell.properties.fill ?? "#444";  // No fill (level 1) fills as grey silhouette
    const isWater = cell.properties.type === "ocean" || cell.properties.type === "lake";


    if (overlay && !isWater) {
      if (cellInMode(cell, overlay)) {
        fill = overlayColor(cell, overlay) ?? fill;
      } else if (cell.properties.level != null) {
        fill = "#444";                         // Live cell below this mode's level
      }
    }
    ctx.fillStyle = fill;
    ctx.fill(path);

    // Hairline separator per cell
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = "rgba(20, 23, 28, 0.22)";
    ctx.stroke(path);
  }

  /** Build a Path2D of a line feature */
  function linePath(feature) {
    const path = new Path2D();
    forEachLine(feature.geometry, (coords) => {
      for (let i = 0; i < coords.length; i++) {
        const p = worldToScreen(coords[i][0], coords[i][1]);
        if (i === 0) path.moveTo(p.x, p.y);
        else path.lineTo(p.x, p.y);
      }
    });
    return path;
  }

  function drawRiver(feature) {
    const p = feature.properties;
    const sourceW = 0.5;

    // sqrt keeps a huge river from dwarfing the rest; tune 0.13 to taste
    const mouthW = Math.min(8, sourceW + Math.sqrt(p.discharge ?? 0) * 0.23 * (p.widthFactor ?? 1));
    forEachLine(feature.geometry, (coords) => {
      const n = coords.length;
      for (let i = 0; i < n - 1; i++) {
        const a = worldToScreen(coords[i][0], coords[i][1]);
        const b = worldToScreen(coords[i + 1][0], coords[i+1][1]);
        const t = n > 2 ? i / (n - 2) : 1; // 0 at source 1 at mouth
        ctx.lineWidth = Math.max(0.4, (sourceW + (mouthW - sourceW) * t) * view.scale);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    });
  }

  function drawLiveRiver(feature) {
    const p = feature.properties;
    const sourceW = 0.5;
    const mouthW = Math.min(8, sourceW + Math.sqrt(p.discharge ?? 0) * 0.23 * (p.widthFactor ?? 1));
    const ts = p._t;
    forEachLine(feature.geometry, (coords) => {
      for (let i = 0; i < coords.length - 1; i++){
        const a = worldToScreen(coords[i][0], coords[i][1]);
        const b = worldToScreen(coords[i + 1][0], coords[i + 1][1]);
        const t = ts ? ts[i] : 1;
        ctx.lineWidth = Math.max(0.4, (sourceW + (mouthW - sourceW) * t) * view.scale);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke()
      }
    });
  }


  function drawBorders(tl, br) {
    ctx.setLineDash([]);
    ctx.lineJoin = "round";
    if (view.scale >= 0.5) {
      strokeBorders(getProvinceBorders(), tl, br, PROVINCE_BORDER_COLOR, PROVINCE_BORDER_WIDTH);
    }
    strokeBorders(getStateBorders(), tl, br, STATE_BORDER_COLOR, STATE_BORDER_WIDTH);

    if (isGM()) {
      ctx.globalAlpha = 0.4;
      if (view.scale >= 0.5) {
        strokeBorders(getProvinceBordersFaded(), tl, br, PROVINCE_BORDER_COLOR, PROVINCE_BORDER_WIDTH);
      }
      strokeBorders(getStateBordersFaded(), tl, br, STATE_BORDER_COLOR, STATE_BORDER_WIDTH);
      ctx.globalAlpha = 1;
    }
  }


  function strokeBorders(flat, tl, br, color, width) {
    const path = new Path2D();
    for (let i = 0; i < flat.length; i += 4) {
      const ax = flat[i], ay = flat[i + 1], bx = flat[i + 2], by = flat[i + 3];
      if ((ax < tl.x && bx < tl.x) || (ax > br.x && bx > br.x) ||
          (ay < tl.y && by < tl.y) || (ay > br.y && by > br.y)) continue;
      const pa = worldToScreen(ax, ay), pb = worldToScreen(bx, by);
      path.moveTo(pa.x, pa.y);
      path.lineTo(pb.x, pb.y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke(path);
  }


  // Measuring Tool
  function drawMeasure() {
    const a = worldToScreen(measure.x1, measure.y1);
    const b = worldToScreen(measure.x2, measure.y2);
    ctx.save();

    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Endpoints 
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#20242b";
      ctx.stroke();
    }

    const dx = measure.x2 - measure.x1, dy = measure.y2 - measure.y1;
    const dist = Math.hypot(dx, dy) * (manifest.distance?.perPixel ?? 1);
    const unit = manifest.distance?.unit ?? "mi";
    const label = `${Math.round(dist).toLocaleString()} ${unit}`;

    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    ctx.font = "600 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(20, 23, 28, 0.9)"; // Halo
    ctx.strokeText(label, mx, my - 8);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, mx, my - 8);

    ctx.restore();
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

  // --- Pings ---
  function drawPing(ping, now) {
    const p = worldToScreen(ping.x, ping.y);
    const t = Math.min((now - ping.created_at) / PING_LIFETIME_MS, 1);
    const r = 6 + t * 34; // Ring grows outward
    const alpha = 1 - t; // and fades out

    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = PING_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath(); // Solid center dot
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = PING_COLOR;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function edgePoint(px, py, w, h, margin) {
    const cx = w / 2;
    const cy = h / 2;
    const dx = px - cx;
    const dy = py - cy;
    if (dx === 0 && dy === 0) return null;

    const halfW = w / 2 - margin;
    const halfH = h / 2 - margin;
    const scale = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);

    return { x: cx + dx * scale, y: cy + dy * scale, angle: Math.atan2(dy, dx) };
  }

  // Draw an edge arrow pointing toward off screen pings. Return true if off screen, and thus handled
  function drawOffscreenPing(ping, now, w, h) {
    const p = worldToScreen(ping.x, ping.y);
    const onScreen = p.x >= 0 && p.x <= w && p.y >= 0 && p.y <=h;
    if (onScreen) return false;

    const e = edgePoint(p.x, p.y, w, h, 22);
    if (!e) return true;

    const t = Math.min((now - ping.created_at) / PING_LIFETIME_MS, 1);
    const pulse = 0.7 + 0.3 * Math.sin(now / 140);

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    ctx.globalAlpha = (1 - t) * pulse;

    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-7, -9);
    ctx.lineTo(-7, 9);
    ctx.closePath();
    ctx.fillStyle = PING_COLOR;
    ctx.fill();

    ctx.restore();
    ctx.globalAlpha = 1;
    return true;
  }

  // --- GM Tokens ---
  function drawToken(token) {
    const p = worldToScreen(token.x, token.y);
    const r = TOKEN_RADIUS;
    if (p.x < -r || p.y < -r || p.x > canvas.clientWidth + r || p.y > canvas.clientHeight + r) {
      return;
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba( 20, 23, 28, 0.85)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = token.color || "#e06c5c";
    ctx.stroke();

    const icon = getIcon(`assets/icons/${token.icon}.svg`);
    if (icon) ctx.drawImage(icon, p.x - 9, p.y - 9, 18, 18);
  }



  // --- Burgs ---
  /** Determine if the settlement is large enough by population to display in current scale */
  function settlementVisibleAt(m, scale) {
    if (m.group === "capital") return true;
    if (scale >= 1.5) return true;
    if (scale >= 0.7) return m.population >= 2000;
    return m.population >= 8000;
  }

  /** Shape by burg type */
  function settlementShape(m) {
    switch (m.group) {
      case "capital": return "square";
      case "fort":
      case "trading_post":
      case "caravanserai" : return "triangle";
      case "monastery" : return "cross";
      default: return "circle"; // City, town, village, hamlet
    }
  }

  function settlementRadius(m) {
    return Math.max(2.5, Math.min(7, 2 + Math.sqrt(m.population || 0) / 45));
  }

  function isWaterCell(cell) {
    const t = cell.properties.type;
    return t === "ocean" || t === "lake";
  }

  function drawSettlement(m) {
    const p = worldToScreen(m.x, m.y);
    const r = settlementRadius(m);
    if (p.x < -r || p.y < -r || p.x > canvas.clientWidth + r || p.y > canvas.clientHeight + r) return;

    ctx.beginPath();
    switch (settlementShape(m)) {
      case "square":
        ctx.rect(p.x - r, p.y -r, r * 2, r * 2);
        break;
      case "triangle":
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y + r);
        ctx.lineTo(p.x - r, p.y + r);
        ctx.closePath();
        break;
      case "cross": {
        const a = r * 0.4
        const pts = [[-a,-r],[a,-r],[a,-a],[r,-a],[r,a],[a,a],[a,r],[-a,r],[-a,a],[-r,a],[-r,-a],[-a,-a]];
        pts.forEach(([dx, dy], i) =>
          i === 0 ? ctx.moveTo(p.x + dx, p.y + dy) : ctx.lineTo(p.x + dx, p.y + dy));
        ctx.closePath();
        break;
      }
      default:
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = m.group === "capital" ? CAPITAL_FILL : SETTLEMENT_FILL;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = SETTLEMENT_STROKE;
    ctx.stroke();
  }


  // --- Labels ---
  /** Determine what label tiers to draw at current scale and map-mode */
  function labelPlan(mode, scale) {
    if (mode === "biome" || mode === "heightmap") return {}; // No labels for heightmap and biomes
    const burgs = scale >= 1.5;
    if (mode === "province") return { provinces: scale >= 0.5, burgs };
    return { states: scale <= 1.5, burgs };
  }

  function drawLabels() {
    if (!isLabelsVisible()) return;
    const plan = labelPlan(getActiveOverlay(), view.scale);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    if (plan.states) {
      for (const l of getStateLabels()) drawLabel(l.name, l.x, l.y, 25, 700);
      for (const l of getLiveStateLabels()) drawLabel(l.name, l.x, l.y, 25, 700);
      if (isGM()) {
        ctx.globalAlpha = 0.4;
        for (const l of getLiveStateLabelsFaded()) drawLabel(l.name, l.x, l.y, 25, 700);
        ctx.globalAlpha = 1;
      }
    }
    if (plan.provinces) {
      for (const l of getProvinceLabels()) drawLabel(l.name, l.x, l.y, 12, 600);
      for (const l of getLiveProvinceLabels()) drawLabel(l.name, l.x, l.y, 12, 600);
      if (isGM()) {
        ctx.globalAlpha = 0.4;
        for (const l of getLiveProvinceLabelsFaded()) drawLabel(l.name, l.x, l.y, 12, 600);
        ctx.globalAlpha = 1;
      }
    }
    if (plan.burgs) {
      for (const m of getVisibleMarkers()) {
        if (m.category !== "settlements") continue;
        if (!settlementVisibleAt(m, view.scale)) continue;
        drawLabel(m.name, m.x, m.y, m.group === "capital" ? 12 : 10, 500, settlementRadius(m) + 9);
      }
      // Live settlements
      const gm = isGM();
      for (const m of getLiveMarkers()) {
        if (m.category !== "settlements") continue;
        if (!settlementVisibleAt(m, view.scale)) continue;
        const revealed = locationRevealed(m);
        if (!revealed && !gm) continue;
        ctx.globalAlpha = revealed ? 1 : 0.4;
        drawLabel(m.name, m.x, m.y, m.group === "capital" ? 12 : 10, 500, settlementRadius(m) + 9);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Draws an individual label */
  function drawLabel(text, wx, wy, fontPx, weight, dy = 0) {
    const p = worldToScreen(wx, wy);
    if (p.x < 0 || p.y < 0 || p.x > canvas.clientWidth || p.y > canvas.clientHeight) return;
    ctx.font = `${weight} ${fontPx}px ${LABEL_FONT}`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = LABEL_HALO;
    ctx.strokeText(text, p.x, p.y + dy); // Place a halo first
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(text, p.x, p.y + dy); // ... then fill the text on top
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
    targetScale = view.scale;
    if (zoomRAF !== null) { cancelAnimationFrame(zoomRAF); zoomRAF = null; }
    render();
  }


  let targetScale = view.scale;
  let zoomAnchor = { cx: canvas.clientWidth / 2, cy: canvas.clientHeight / 2 };
  let zoomRAF = null;

  function zoomSmooth(factor, cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2) {
    targetScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, targetScale * factor));
    zoomAnchor = { cx, cy };
    if (zoomRAF === null) zoomRAF = requestAnimationFrame(zoomStep);
  }

  function zoomStep() {
    const before = screenToWorld(zoomAnchor.cx, zoomAnchor.cy);
    view.scale += (targetScale - view.scale) * 0.4; // lower = slower
    if (Math.abs(targetScale - view.scale) < 0.0005) view.scale = targetScale;
    const after = screenToWorld(zoomAnchor.cx, zoomAnchor.cy);
    view.x += before.x - after.x;
    view.y += before.y - after.y;
    draw();
    if (view.scale !== targetScale) {
      zoomRAF = requestAnimationFrame(zoomStep);
    } else {
      zoomRAF = null;
      onViewChange?.(view);
    }
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
  let draggingToken = null;
  let tokenGrabOrigin = null;

  canvas.addEventListener("pointerdown", (e) => {
    // Keep receiving move/up for this pointer even if it leaves the canvas.
    try{
      canvas.setPointerCapture(e.pointerId);
    } catch {}

    // Let the GM grab a token
    if (isGM() && getUIState().activeTool === "pan") {
      const cp = canvasPoint(e);
      const w = screenToWorld(cp.x, cp.y);
      const grab = tokenAt(w.x, w.y, (TOKEN_RADIUS + 4) / view.scale);
      if (grab) {
        draggingToken = grab;
        tokenGrabOrigin = { x: grab.x, y: grab.y };
        closePopups();
        return;
      }
    }

    pointers.set(e.pointerId, canvasPoint(e));
    dragDistance = 0;
    if (pointers.size === 1) document.body.classList.add("is-panning");
    closePopups();
  });

  canvas.addEventListener("pointermove", (e) => {
    const cur = canvasPoint(e);

    // Coordinate readout (World coordinates that are under the cursor).
    const wpt = screenToWorld(cur.x, cur.y);
    const cell = cellAt(wpt.x, wpt.y) ?? liveCellAt(wpt.x, wpt.y);
    const river = riverAt(wpt.x, wpt.y, 5 / view.scale);
    coordsEl.textContent = describeAt(wpt, cell);
    statusEl.textContent = statusText(cell, river);

    if (measureTracking && !pointers.has(e.pointerId)) {
      measure.x2 = wpt.x;
      measure.y2 = wpt.y;
      render();
    }


    // Dragging a token (GM)
    if (draggingToken) {
      const w = screenToWorld(cur.x, cur.y);
      draggingToken.x = w.x;
      draggingToken.y = w.y;
      render();
      return;
    }


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

    // Token Dragging (GM)
    if (draggingToken) {
      const movedScreen = Math.hypot(
        draggingToken.x - tokenGrabOrigin.x,
        draggingToken.y - tokenGrabOrigin.y,
      ) * view.scale;

      if (movedScreen < CLICK_SLOP) {
        // Barely moved -> count as a click
        draggingToken.x = tokenGrabOrigin.x;
        draggingToken.y = tokenGrabOrigin.y;
        const p = worldToScreen(draggingToken.x, draggingToken.y);
        openTokenPopup(draggingToken, p.x, p.y);
        render();
      } else {
        moveToken(draggingToken.id, draggingToken.x, draggingToken.y); // send to database to persist 
      }

      draggingToken = null;
      tokenGrabOrigin = null;
      return;
    }

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
    zoomSmooth(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, p.x, p.y);
  }, {passive: false });

  // Click handling on the map
  function handleClick(sx, sy) {
    const wpt = screenToWorld(sx, sy);
    const ui = getUIState();

    // Measuring Tool
    if (ui.activeTool === "measure") {
      if (!measureTracking) {
        measure = { x1: wpt.x, y1: wpt.y, x2: wpt.x, y2: wpt.y };
        measureTracking = true;
      } else {
        measure.x2 = wpt.x;
        measure.y2 = wpt.y;
        measureTracking = false;
      }
      render();
      return;
    }


    // GM live ping
    if (ui.activeTool === "ping") {
      sendPing(wpt.x, wpt.y);
      return;
    }

    // GM tokens
    if (ui.activeTool === "token") {
      placeToken(wpt.x, wpt.y, ui.selectedTokenIcon, ui.selectedTokenColor, ui.tokenLabel);
      return;
    }

    // GM Reveal Tool - Open Menu
    const REVEAL_SCOPE = { "reveal-cell": "cell", "reveal-province": "province", "reveal-state": "state" };
    const scope = REVEAL_SCOPE[ui.activeTool];
    if (scope) {
      const cell = liveCellAt(wpt.x, wpt.y);
      if (cell && !isWaterCell(cell)) {
        openRevealPopup(scopeInfo(cell, scope), sx, sy,
          (level) => revealScope(cell, scope, level));
      }
      return;
    }
    // Reveal Water tool
    if (ui.activeTool === "reveal-water") {
      const cell = liveCellAt(wpt.x, wpt.y);
      if (cell && isWaterCell(cell)) {
        revealScope(cell, "cell", isCellRevealed(cell) ? 0 : 2)
      }
      return;
    }

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
    const token = tokenAt(wpt.x, wpt.y, radius);
    if (token) {
      const p = worldToScreen(token.x, token.y);
      openTokenPopup(token, p.x, p.y);
      return;
    }
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
      return;
    }
    const liveMarker = liveMarkerAt(wpt.x, wpt.y, radius);
    if (liveMarker) {
      const p = worldToScreen(liveMarker.x, liveMarker.y);
      openMarkerPopup(liveMarker, p.x, p.y);
      return;
    }
  }

  return { view, render, resize, worldToScreen, screenToWorld, zoomBy, zoomSmooth, resetView };
}