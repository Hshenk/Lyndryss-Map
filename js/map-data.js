import { MANIFEST_URL } from "./config.js";

const OVERLAY_ATTRIBUTE = { territory: "state", province: "province", culture: "culture", religion: "religion" };


let manifest = null;
let cells = [];
let cellBoxes = [];
let stateBorders = []
let provinceBorders = []
let rivers = [];
let riverBoxes = [];
let routes = [];
let routeBoxes = [];
let labels = { states: [], provinces: [] };

/**
 * Fetch the manifest, then call GeoJSON it points to. 
 * Return the manifest
 */
export async function loadWorldData() {
    const rest = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!rest.ok) throw new Error(`Could not load manifest: HTTP ${rest.status}`);
    manifest = await rest.json();

    // The manifest then tells us where to get the geometry
    const cellsUrl = manifest.data?.cells ?? "data/world.geojson";
    const cellsRes = await fetch(cellsUrl, { cache: "no-cache" });
    if (!cellsRes.ok) throw new Error(`Could not load cells: HTTP ${cellsRes.status}`);
    const fc = await cellsRes.json();
    cells = fc.features ?? [];

    cellBoxes = cells.map(boundingBox);

    computeBorders();

    // Rivers and Routes
    rivers = await loadLines(manifest.data?.rivers);
    riverBoxes = rivers.map(lineBoundingBox);
    routes = await loadLines(manifest.data?.routes);
    routeBoxes = routes.map(lineBoundingBox);

    // Labels
    const labelsUrl = manifest.data?.labels;
    if (labelsUrl) {
        const res = await fetch(labelsUrl, { cache: "no-cache" });
        if (res.ok) labels = await res.json();
    }

    return manifest;
}

export function getManifest() {
    return manifest;
}

export function getCells() {
    return cells;
}

export function getStateLabels() { return labels.states; }
export function getProvinceLabels() { return labels.provinces; }

/**
 * Cells whose bounding box overlaps the given world-px rectangle. The
 * Renderer passes the on-screen rectangle so we skip everything off screen.
 * 
 * Linear scan is fine for a westmarch. If it stutters with the full map revealed, 
 * bucket cellBoxes into a grid here - the renderer never needs to know.
 */
export function getVisibleCells(minX, minY, maxX, maxY) {
    const out = [];
    for (let i = 0; i < cells.length; i++) {
        const b = cellBoxes[i];
        if (b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY> maxY) continue;
        out.push(cells[i]);
    }
    return out;
}

// ------ Helpers ------

/**
 * Walks every ring of a polygon and returns its world-px bounding box.
 */
function boundingBox(feature) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    forEachRing(feature.geometry, (ring) => {
        for (const [x, y] of ring) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    });
    return { minX, minY, maxX, maxY };
}

/**
 * Call fn(ring) for each linear ring in a polygon
 * Centralizing this means the rest of the file never branches on geometry type
 */
export function forEachRing(geometry, fn) {
    if (geometry.type === "Polygon") {
        for (const ring of geometry.coordinates) fn(ring);
    } else if (geometry.type === "MultiPolygon") {
        for (const poly of geometry.coordinates) for (const ring of poly) fn(ring);
    }
}


/**
 * the cell containing world-px point (wx, wy), or null. uses the bbox index to
 * skip cells the point can't be in, then a precise point-in-polygon test on the survivors.
 */
export function cellAt(wx, wy) {
    for (let i = 0; i < cells.length; i++) {
        const b = cellBoxes[i];
        if (wx < b.minX || wx > b.maxX || wy < b.minY || wy > b.maxY) continue;
        if (pointInCell(cells[i], wx, wy)) return cells[i];
    }
    return null;
}


/**
 * Ray-casting point-in-polygon. Counts edge crossing of a ray from (x,y);
 * odd = inside. Testing every ring means holes flip the parity for free.
 */
function pointInCell(cell, x, y) {
    let inside = false;
    forEachRing(cell.geometry, (ring) => {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            const crosses =
                (yi > y) !== (yj > y) &&
                x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
            if (crosses) inside = !inside;
        }
    });
    return inside;
}


/**
 * The fill color for a cell in a given map-mode
 */
export function overlayColor(cell, overlayId) {
    if (overlayId === "heightmap") return heightColor(cell.properties.height);
    const key = OVERLAY_ATTRIBUTE[overlayId];
    if (!key) return null;
    const id = cell.properties[key];
    return manifest.overlays?.[key]?.[id]?.color ?? null;
}

export function overlayPalette(overlayId) {
    const key = OVERLAY_ATTRIBUTE[overlayId];
    return (key && manifest.overlays?.[key]) || {};
}


//   --- Rivers and Routes ---


/** Fetch GeoJSON line file's features */
async function loadLines(url) {
    if (!url) return [];
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return [];
    const fc = await res.json();
    return fc.features ?? [];
}

/** Call fn(coords) for each line */
export function forEachLine(geometry, fn) {
    if (geometry.type === "LineString") fn(geometry.coordinates);
    else if (geometry.type === "MultiLineString") {
        for (const line of geometry.coordinates) fn(line);
    }
}

/** World-px bounding box of a line feature */
function lineBoundingBox(feature) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    forEachLine(feature.geometry, (coords) => {
        for (const [x, y] of coords) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y
        }
    });
    return { minX, minY, maxX, maxY };
}

/** Does a precomputed box overlap the query rectangle? */
function overlaps(b, minX, minY, maxX, maxY) {
    return !(b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY > maxY);
}

/** Rivers whose box overlaps the world-px rectangle */
export function getVisibleRivers(minX, minY, maxX, maxY) {
    const out = [];
    for (let i = 0; i < rivers.length; i++) {
        if (overlaps(riverBoxes[i], minX, minY, maxX, maxY)) out.push(rivers[i]);
    }
    return out;
}

/** Routes whose box overlaps the world-px rectangle */
export function getVisibleRoutes(minX, minY, maxX, maxY) {
    const out = [];
    for (let i = 0; i < routes.length; i++) {
        if (overlaps(routeBoxes[i], minX, minY, maxX, maxY)) out.push(routes[i]);
    }
    return out;
}



/** Heigh Map  */
const HEIGHT_RAMP = [
  [0.00, [ 70,  96, 168]],  // low — blue
  [0.16, [ 76, 145, 190]],  // blue
  [0.32, [ 96, 190, 170]],  // teal
  [0.48, [170, 212, 120]],  // green
  [0.60, [240, 238, 165]],  // pale yellow (mid)
  [0.74, [242, 165,  80]],  // orange
  [0.88, [214,  72,  50]],  // red
  [1.00, [112,  20,  52]],  // high — dark maroon
];

/** Gets the minimum and maximum heights present */
let heightRange = null;
function getHeightRange() {
    if (!heightRange) {
        let lo = Infinity, hi = -Infinity;
        for (const c of cells) {
            if (c.properties.type !== "island") continue;
            const h = c.properties.height;
            if (h < lo) lo = h;
            if (h > hi) hi = h;
        }
        heightRange = [Math.max(lo, 1), Math.max(hi, 2)];
    }
    return heightRange;
}

function heightColor(h) {
    const [lo, hi] = getHeightRange();
    const t = Math.min(1, Math.max(0,
        (Math.log(Math.max(h, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))));
    let a = HEIGHT_RAMP[0], b = HEIGHT_RAMP[HEIGHT_RAMP.length - 1];
    for (let i = 0; i < HEIGHT_RAMP.length - 1; i++) {
        if (t >= HEIGHT_RAMP[i][0] && t <= HEIGHT_RAMP[i + 1][0]) { a = HEIGHT_RAMP[i]; b = HEIGHT_RAMP[i + 1]; break;}
    }
    const f = (t - a[0]) / ((b[0] - a[0]) || 1);
    const c = a[1].map((ca, k) => Math.round(ca + (b[1][k] - ca) * f));
    return `rgb(${c[0]},${c[1]},${c[2]})`; 
}

 
/** nearest river within 'tol' world px of (wx, wy) */
export function riverAt(wx, wy, tol) {
    let best = null, bestD = tol * tol;
    for (const r of rivers) {

        forEachLine(r.geometry, (coords) => {
            for (let i = 0; i < coords.length - 1; i++) {
                const d = distToSegmentSq(wx, wy, coords[i], coords[i + 1]);
                if (d < bestD) { bestD = d; best = r; }
            }
        });
    }
    return best;
}

/** Squared distance from point to segment  */
function distToSegmentSq(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a[0] + t * dx, cy = a[1] + t * dy;
    return (px - cx) ** 2 + (py - cy) ** 2;
}

/** Computes borders for adding thicker lines to states and provinces */
function computeBorders() {
    const edges = new Map();
    for (const cell of cells) {
        const ring = cell.geometry.coordinates[0];
        const p = cell.properties;
        for (let i = 0; i < ring.length - 1; i++) {
            const a = ring[i], b = ring[i + 1];

            //order-independent key so both cells hash the shared edge to one entry
            const key = (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]))
                ? `${a[0]}_${a[1]}_${b[0]}_${b[1]}`
                : `${b[0]}_${b[1]}_${a[0]}_${a[1]}`;
            const e = edges.get(key);
            if (e) e.q = p;
            else edges.set(key, { a, b, p });
        }
    }
    const st = [], pr = [];
    for (const e of edges.values()) {
        if (!e.q) continue;
        if (e.p.state !== e.q.state) st.push(e.a[0], e.a[1], e.b[0], e.b[1]);
        if (e.p.province !== e.q.province) pr.push(e.a[0], e.a[1], e.b[0], e.b[1]);
    }
    stateBorders = st;
    provinceBorders = pr;
}

export function getStateBorders() { return stateBorders; }
export function getProvinceBorders() {return provinceBorders; }