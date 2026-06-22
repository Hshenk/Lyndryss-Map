import { MANIFEST_URL } from "./config.js";

const OVERLAY_ATTRIBUTE = { territory: "state", culture: "culture", religion: "religion" };


let manifest = null;
let cells = [];
let cellBoxes = [];
let rivers = [];
let riverBoxes = [];
let routes = [];
let routeBoxes = [];

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

    // Rivers and Routes
    rivers = await loadLines(manifest.data?.rivers);
    riverBoxes = rivers.map(lineBoundingBox);
    routes = await loadLines(manifest.data?.routes);
    routeBoxes = routes.map(lineBoundingBox);

    return manifest;
}

export function getManifest() {
    return manifest;
}

export function getCells() {
    return cells;
}

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
