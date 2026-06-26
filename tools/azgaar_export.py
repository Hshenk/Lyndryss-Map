#!/usr/bin/env python3
"""
azgaar_export.py — turn an Azgaar GIS export into Lyndryss-Map vector data.

The vector site (see docs/vector-architecture.md) renders the world from GeoJSON
in *world pixels* instead of PNG tiles. This tool is the vector analogue of
slice-map.py: it takes Azgaar's raw multi-file GeoJSON export, applies the
coordinate transform, FILTERS to the regions players have discovered (the
secrecy boundary — unrevealed regions are dropped, not hidden), and writes the
player-safe files the renderer loads.

Azgaar exports several files (Cells, Markers, Rivers, Routes, Zones); keep the
whole export in the gitignored resources/ folder. This tool auto-detects the
newest of each by name, so you can just drop fresh exports in and re-run.

--------------------------------------------------------------------------------
COORDINATE MODEL
--------------------------------------------------------------------------------
Azgaar's polygon/line geometry is in lon/lat DEGREES, but every Marker feature
also carries Azgaar PIXEL coords (properties.x / .y). We fit degrees->pixels from
the markers (an exact linear/equirectangular fit), then map pixels->world px:

    world_x = (azgaar_px - origin_x) * scale
    world_y = (azgaar_py - origin_y) * scale

Defaults (origin 0,0 / scale 1.0) make world px == Azgaar px == the old broad-map
pixel space, so markers/annotations stay in one shared space. Set --origin-x/-y
to a pixel point if you'd rather anchor world (0,0) at the party's start.

--------------------------------------------------------------------------------
NAMES & COLORS
--------------------------------------------------------------------------------
Azgaar's GeoJSON gives state/province/culture/religion/biome as integer IDs only.
The real names and colors live in Azgaar's JSON map export — so ALSO export a
"Minimal" (or "Full") JSON from Azgaar into resources/. This tool reads
pack.states / pack.cultures / pack.religions / pack.provinces and biomesData from
it automatically; overlay palettes then carry the real campaign names and colors
with no manual step.

Resolution order for each id's name/color (highest priority first):
  data/lookups.json override  ->  Azgaar JSON export  ->  embedded biome defaults
  ->  auto-generated color + "State N" placeholder

data/lookups.json is now OPTIONAL — use it only to rename, recolor, or hide a
name from players. Run `emit-lookups` to scaffold it pre-filled from the JSON.
If neither a JSON export nor a lookups file is present, build still works using
auto colors.

--------------------------------------------------------------------------------
USAGE
--------------------------------------------------------------------------------
    # one-time: scaffold the names/colors table to edit
    python tools/azgaar_export.py emit-lookups

    # build the player-safe data for the currently revealed regions
    python tools/azgaar_export.py build --reveal 7 3 12
    python tools/azgaar_export.py build --reveal-all          # whole world (testing)

Reveal IDs are `state` IDs by default (`--by province` for finer grain). If you
omit --reveal, the tool reads manifest.json -> "revealed".

Stdlib only — no pip installs.
"""

import argparse
import colorsys
import datetime
import glob
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# ---------------------------------------------------------------------------
# Embedded palettes
# ---------------------------------------------------------------------------

# Azgaar's default 13 biomes (id -> name, color). Land cells reference these by
# `biome`; water cells are colored by WATER_COLORS instead. Override via lookups.
BIOME_DEFAULTS = {
    0:  ("Marine",                      "#466eab"),
    1:  ("Hot desert",                  "#fbe79f"),
    2:  ("Cold desert",                 "#b5b887"),
    3:  ("Savanna",                     "#d2d082"),
    4:  ("Grassland",                   "#c8d68f"),
    5:  ("Tropical seasonal forest",    "#b6d95d"),
    6:  ("Temperate deciduous forest",  "#29bc56"),
    7:  ("Tropical rainforest",         "#7dcb35"),
    8:  ("Temperate rainforest",        "#409c43"),
    9:  ("Taiga",                       "#4b6b32"),
    10: ("Tundra",                      "#96784b"),
    11: ("Glacier",                     "#d5e7eb"),
    12: ("Wetland",                     "#0b9131"),
}

# Base fill for water cells (by Azgaar feature `type`).
WATER_COLORS = {"ocean": "#3b6ea5", "lake": "#4d83c4"}

# Azgaar POI marker `type` -> one of the site's marker categories. Anything not
# listed falls back to "landmarks". Tune freely; this only seeds markers.json.
MARKER_CATEGORY = {
    "dungeons": "hazards", "lake-monsters": "hazards", "sea-monsters": "hazards",
    "hill-monsters": "hazards", "brigands": "hazards", "pirates": "hazards",
    "battlefields": "hazards", "necropolises": "hazards", "rifts": "hazards",
    "disturbed-burials": "hazards", "encounters": "hazards", "mines": "hazards",
}


# ---------------------------------------------------------------------------
# Loading / file discovery
# ---------------------------------------------------------------------------

def find_latest(resources_dir, keyword):
    """Newest `*<keyword>*.geojson` in resources_dir, or None. Azgaar names files
    like 'Lyndryss Cells 2026-06-20-21-10.geojson', so we match on the keyword."""
    hits = glob.glob(os.path.join(resources_dir, f"*{keyword}*.geojson"))
    hits += glob.glob(os.path.join(resources_dir, f"*{keyword}*.json"))
    if not hits:
        return None
    return max(hits, key=os.path.getmtime)


def load_features(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh).get("features", [])


_json_cache = {}


def _load_azgaar_json(resources_dir):
    """Parsed Azgaar JSON map export (Minimal preferred, Full fallback), memoized
    so the multi-MB file is read once per run. None if no export is present."""
    path = find_latest(resources_dir, "Minimal") or find_latest(resources_dir, "Full")
    if not path:
        return None
    if path not in _json_cache:
        with open(path, encoding="utf-8") as fh:
            _json_cache[path] = json.load(fh)
    return _json_cache[path]


def load_azgaar_tables(resources_dir):
    """Read names/colors from Azgaar's JSON map export (Minimal preferred, Full as
    fallback) in resources_dir. Returns a lookups-shaped dict:
        {"state": {id: {"name","color"}}, "culture": {...}, "religion": {...},
         "province": {...}, "biome": {id: {"name","color"}}}
    Empty dict if no JSON export is present (the tool still runs on GeoJSON only).
    The integer ids match the GeoJSON's state/culture/religion/province/biome."""
    data = _load_azgaar_json(resources_dir)
    if data is None:
        return {}

    pack = data.get("pack", {})
    tables = {}
    for key, arr_name in (("state", "states"), ("culture", "cultures"),
                          ("religion", "religions"), ("province", "provinces")):
        table = {}
        for e in pack.get(arr_name, []):
            if not isinstance(e, dict) or "i" not in e:
                continue  # skip the leading "0" placeholder some arrays carry
            # Short name (user-confirmed); fullName is intentionally dropped.
            table[str(e["i"])] = {
                "name": e.get("name") or f"{key.capitalize()} {e['i']}",
                "color": e.get("color") or "#cccccc",  # neutral (id 0) has null
            }
        tables[key] = table

    # biomesData carries parallel name[] / color[] arrays indexed by biome id.
    bd = data.get("biomesData", {})
    names, colors = bd.get("name", []), bd.get("color", [])
    tables["biome"] = {str(i): {"name": names[i], "color": colors[i]}
                       for i in range(min(len(names), len(colors)))}
    return tables


def load_azgaar_geo(resources_dir):
    """Burgs (settlements) and state/province label poles from the Azgaar JSON.
    Returns {"burgs": [...], "poles": {"state": {id: [x,y]}, "province": {...}}}.
    Coords are Azgaar pixels (same space as marker x/y). Empty if no JSON."""
    data = _load_azgaar_json(resources_dir)
    if data is None:
        return {"burgs": [], "poles": {"state": {}, "province": {}}}
    pack = data.get("pack", {})
    burgs = [b for b in pack.get("burgs", []) if isinstance(b, dict) and b.get("i")]
    poles = {"state": {}, "province": {}}
    full = {}   # state id -> full country name, for map labels
    for key, arr in (("state", "states"), ("province", "provinces")):
        for e in pack.get(arr, []):
            if not (isinstance(e, dict) and e.get("i")):
                continue
            if e.get("pole"):
                poles[key][e["i"]] = e["pole"]
            if key == "state":
                full[e["i"]] = e.get("fullName") or e.get("name")
    return {"burgs": burgs, "poles": poles, "state_fullnames": full}


def make_pixel_projector(scale, origin_x, origin_y):
    """Map an Azgaar PIXEL point (burgs, poles) to world px — the pixel analogue
    of make_projector, which handles degrees. Defaults are identity."""
    def to_world(px, py):
        return [round((px - origin_x) * scale, 2), round((py - origin_y) * scale, 2)]
    return to_world


def load_lake_names(resources_dir):
    """{cell_id: lake_name} from the Full JSON's per-cell feature ids. The Minimal
    export omits pack.cells, so lakes are named only when a Full export is present."""
    path = find_latest(resources_dir, "Full")
    if not path:
        return {}
    if path not in _json_cache:
        with open(path, encoding="utf-8") as fh:
            _json_cache[path] = json.load(fh)
    pack = _json_cache[path].get("pack", {})
    feats = {f["i"]: f for f in pack.get("features", [])
             if isinstance(f, dict) and "i" in f}
    out = {}
    for c in pack.get("cells", []):
        if not isinstance(c, dict):
            continue
        feat = feats.get(c.get("f"))
        if feat and feat.get("type") == "lake" and feat.get("name"):
            out[c["i"]] = feat["name"]
    return out


def merge_lookups(*sources):
    """Combine name/color tables, earlier sources winning per-id. Each source is
    a dict overlay_key -> {id_str: {name,color}}."""
    out = {}
    for src in sources:
        for key, table in src.items():
            dest = out.setdefault(key, {})
            for i, entry in table.items():
                dest.setdefault(i, entry)  # first writer (highest priority) wins
    return out


# ---------------------------------------------------------------------------
# Coordinate transform
# ---------------------------------------------------------------------------

def _linfit(xs, ys):
    """Least-squares slope/intercept for ys = a*xs + b."""
    n = len(xs)
    sx, sy = sum(xs), sum(ys)
    sxx = sum(x * x for x in xs)
    sxy = sum(x * y for x, y in zip(xs, ys))
    a = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    b = (sy - a * sx) / n
    return a, b


def derive_deg_to_pixel(markers):
    """Fit degrees->Azgaar-pixels from markers that carry both geometry (deg) and
    properties.x/.y (px). Returns (a, b, c, d): px = a*lon+b, py = c*lat+d."""
    lon, lat, px, py = [], [], [], []
    for m in markers:
        coords = m.get("geometry", {}).get("coordinates")
        pr = m.get("properties", {})
        if not coords or pr.get("x") is None or pr.get("y") is None:
            continue
        lon.append(coords[0]); lat.append(coords[1])
        px.append(pr["x"]); py.append(pr["y"])
    if len(lon) < 2:
        sys.exit("error: need >=2 markers with x/y to derive the transform.")
    a, b = _linfit(lon, px)
    c, d = _linfit(lat, py)
    # Report worst-case error so a bad export is caught early.
    rx = max(abs(a * l + b - x) for l, x in zip(lon, px))
    ry = max(abs(c * l + d - y) for l, y in zip(lat, py))
    print(f"  transform: px={a:.4f}*lon+{b:.2f}, py={c:.4f}*lat+{d:.2f} "
          f"(max residual {max(rx, ry):.3f}px over {len(lon)} markers)")
    return a, b, c, d


def make_projector(cal, scale, origin_x, origin_y):
    """Return f(lon, lat) -> [world_x, world_y], rounded to 2dp."""
    a, b, c, d = cal

    def project(lon, lat):
        wx = (a * lon + b - origin_x) * scale
        wy = (c * lat + d - origin_y) * scale
        return [round(wx, 2), round(wy, 2)]

    return project


def project_ring(ring, project):
    return [project(x, y) for x, y in ring]


def project_geometry(geom, project):
    """Project a Polygon/MultiPolygon/LineString geometry in place into world px."""
    t = geom["type"]
    c = geom["coordinates"]
    if t == "Polygon":
        return {"type": t, "coordinates": [project_ring(r, project) for r in c]}
    if t == "MultiPolygon":
        return {"type": t,
                "coordinates": [[project_ring(r, project) for r in poly] for poly in c]}
    if t == "LineString":
        return {"type": t, "coordinates": project_ring(c, project)}
    if t == "MultiLineString":
        return {"type": t, "coordinates": [project_ring(r, project) for r in c]}
    raise ValueError(f"unsupported geometry type: {t}")


# ---------------------------------------------------------------------------
# Spatial index over cell centroids (for "which cell is this point in?")
# ---------------------------------------------------------------------------

def cell_centroid(feature):
    """Average of a cell's outer ring vertices (in whatever space the geometry is
    in). Good enough for nearest-cell lookups since Azgaar cells are Voronoi."""
    geom = feature["geometry"]
    ring = (geom["coordinates"][0] if geom["type"] == "Polygon"
            else geom["coordinates"][0][0])
    sx = sum(p[0] for p in ring)
    sy = sum(p[1] for p in ring)
    n = len(ring)
    return sx / n, sy / n


class CentroidGrid:
    """Uniform-grid nearest-centroid lookup. Keyed in DEGREE space (pre-transform)
    so we can classify raw river/route/marker vertices by containing cell."""

    def __init__(self, cells, bucket=2.0):
        self.bucket = bucket
        self.buckets = {}
        self.points = []  # (cx, cy, cell_id)
        for f in cells:
            cx, cy = cell_centroid(f)
            cid = f["properties"]["id"]
            self.points.append((cx, cy, cid))
            self.buckets.setdefault(self._key(cx, cy), []).append((cx, cy, cid))

    def _key(self, x, y):
        return (math.floor(x / self.bucket), math.floor(y / self.bucket))

    def nearest_cell(self, x, y):
        """Cell id whose centroid is nearest (x, y). Searches expanding rings of
        buckets until a candidate is guaranteed closest."""
        bx, by = math.floor(x / self.bucket), math.floor(y / self.bucket)
        best_id, best_d = None, float("inf")
        r = 0
        while True:
            for gx in range(bx - r, bx + r + 1):
                for gy in range(by - r, by + r + 1):
                    if best_id is not None and max(abs(gx - bx), abs(gy - by)) < r:
                        continue  # already scanned this inner bucket
                    for cx, cy, cid in self.buckets.get((gx, gy), ()):
                        d = (cx - x) ** 2 + (cy - y) ** 2
                        if d < best_d:
                            best_d, best_id = d, cid
            # Once we have a hit, one more ring guarantees correctness, then stop.
            if best_id is not None and r >= 1:
                return best_id
            r += 1
            if r > 60:  # safety; world is finite
                return best_id


# ---------------------------------------------------------------------------
# Reveal set
# ---------------------------------------------------------------------------

def compute_revealed_cells(cells, revealed_ids, by, coast_ring):
    """Set of cell ids to publish: cells whose `by` field is in revealed_ids,
    optionally plus a one-ring border of neighboring water cells so coastlines
    render cleanly. revealed_ids empty => reveal everything."""
    by_id = {f["properties"]["id"]: f for f in cells}
    if not revealed_ids:
        return set(by_id)

    chosen = {cid for cid, f in by_id.items()
              if f["properties"].get(by) in revealed_ids}

    if coast_ring:
        border = set()
        for cid in chosen:
            for nb in by_id[cid]["properties"].get("neighbors", []):
                nf = by_id.get(nb)
                if nf and nf["properties"].get("type") in ("ocean", "lake"):
                    border.add(nb)
        chosen |= border
    return chosen


# ---------------------------------------------------------------------------
# Builders for each output file
# ---------------------------------------------------------------------------

def base_fill(props, lookups):
    """Pick the base (no-overlay) fill color for a cell."""
    if props.get("type") in WATER_COLORS:
        return WATER_COLORS[props["type"]]
    biome = props.get("biome", 0)
    look = lookups.get("biome", {}).get(str(biome))
    if look:
        return look["color"]
    return BIOME_DEFAULTS.get(biome, ("?", "#888888"))[1]


def _cell_to_feature(f, project, lookups, lake_names):
    """One Azgaar cell -> the trimmed, world-px GeoJSON Feature the renderer draws.
    Shared by the static build (build_cells) and the hidden-cell upload (cmd_upload)
    so live-revealed cells are byte-for-byte the same shape as static ones."""
    p = f["properties"]
    props = {
        "id": p["id"],
        "type": p.get("type"),
        "height": p.get("height"),
        "biome": p.get("biome"),
        "state": p.get("state"),
        "province": p.get("province"),
        "culture": p.get("culture"),
        "religion": p.get("religion"),
        "fill": base_fill(p, lookups),
    }
    if p["id"] in lake_names:
        props["name"] = lake_names[p["id"]]
    return {
        "type": "Feature",
        "geometry": project_geometry(f["geometry"], project),
        "properties": props,
    }


def build_cells(cells, revealed, project, lookups, lake_names):
    """world.geojson: revealed cells, world-px, trimmed props + baked base fill.
    Lake cells get a `name` (their feature name) when a Full export supplied it."""
    out = [_cell_to_feature(f, project, lookups, lake_names)
           for f in cells if f["properties"]["id"] in revealed]
    return {"type": "FeatureCollection", "features": out}


def build_lines(features, revealed, grid, project, keep_props):
    """Clip rivers/routes to revealed area: walk each line's vertices, classify
    each by nearest cell, and keep only the contiguous runs inside revealed
    cells. A line that crosses out and back yields multiple segments. Rivers keep
    their full geometry to the mouth — they're the same blue as the ocean, so any
    overshoot into water blends in."""
    out = []
    for f in features:
        geom = f["geometry"]
        lines = ([geom["coordinates"]] if geom["type"] == "LineString"
                 else geom["coordinates"])
        for line in lines:
            run = []
            for x, y in line:
                inside = grid.nearest_cell(x, y) in revealed
                if inside:
                    run.append(project(x, y))
                elif run:
                    _flush_run(out, run, f, keep_props)
                    run = []
            _flush_run(out, run, f, keep_props)
    return {"type": "FeatureCollection", "features": out}


def _flush_run(out, run, source, keep_props):
    if len(run) >= 2:
        out.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": run},
            "properties": {k: source["properties"].get(k) for k in keep_props},
        })


def build_hidden_lines(features, grid, project, keep_props, kind, min_level,
                       static_revealed, taper=False):
    """Split rivers/routes into PER-CELL segments for the hidden (not statically
    revealed) cells. Each segment is tagged with its cell + the discovery level
    needed to show it (river=2, route=3), so it can be gated individually by RLS —
    a river only appears in cells revealed far enough, never leaking the shape of
    unrevealed land. Mirrors build_lines but cuts a new segment whenever the
    nearest cell changes (boundary vertex shared so segments still meet).

    When taper=True (rivers), each vertex also carries `_t` — its position along
    the WHOLE river (0 source → 1 mouth) — so the client can restore the source→
    mouth taper even though the river is drawn as disjoint per-cell segments."""
    rows = []
    for f in features:
        props = {k: f["properties"].get(k) for k in keep_props}
        geom = f["geometry"]
        lines = ([geom["coordinates"]] if geom["type"] == "LineString"
                 else geom["coordinates"])
        for line in lines:
            n = len(line)
            cur, run, run_t = None, [], []
            for i, (x, y) in enumerate(line):
                cell = grid.nearest_cell(x, y)
                pt = project(x, y)
                t = min(1.0, i / (n - 2)) if (taper and n > 2) else 1.0  # along-river 0..1
                if cell != cur:
                    if cur is not None:
                        run.append(pt); run_t.append(t)        # close the run at the boundary
                        _flush_hidden_line(rows, run, run_t, cur, kind, min_level,
                                           props, static_revealed, taper)
                    cur, run, run_t = cell, [pt], [t]          # start the next cell's run here
                else:
                    run.append(pt); run_t.append(t)
            if cur is not None:
                _flush_hidden_line(rows, run, run_t, cur, kind, min_level,
                                   props, static_revealed, taper)
    return rows


def _flush_hidden_line(rows, run, run_t, cell, kind, min_level, props, static_revealed, taper):
    # Skip statically-revealed cells — their lines already ship in data/.
    if len(run) >= 2 and cell not in static_revealed:
        p = dict(props)
        if taper:
            p["_t"] = [round(t, 4) for t in run_t]   # per-vertex along-river position
        rows.append({
            "kind": kind, "cell_id": cell, "min_level": min_level,
            "data": {"type": "Feature",
                     "geometry": {"type": "LineString", "coordinates": run},
                     "properties": p},
        })


def burg_note(b):
    """A short human description for a settlement popup, led by its burg group."""
    pop = int(round((b.get("population") or 0) * 1000))
    group = (b.get("group") or "town").replace("_", " ")
    head = group[:1].upper() + group[1:]
    if b.get("port"):
        head += ", port"
    return f"{head}. Population ~{pop:,}."


def build_markers(markers, revealed, grid, project, burgs, to_world):
    """POI markers (landmarks/hazards, from the GeoJSON) plus burgs (settlements,
    from the JSON) in the site's markers.json schema. Settlements carry extra
    fields the renderer uses to pick a shape/size and show a burg link."""
    out = []
    for m in markers:
        lon, lat = m["geometry"]["coordinates"]
        if grid.nearest_cell(lon, lat) not in revealed:
            continue
        p = m["properties"]
        wx, wy = project(lon, lat)
        out.append({
            "id": p.get("id"),
            "category": MARKER_CATEGORY.get(p.get("type"), "landmarks"),
            "x": wx, "y": wy,
            "name": p.get("name") or p.get("type", "Marker"),
            "note": p.get("legend") or "",
        })

    # Burgs -> settlements. Filter by the burg's own cell (precise).
    for b in burgs:
        if b.get("cell") not in revealed:
            continue
        wx, wy = to_world(b["x"], b["y"])
        out.append({
            "id": f"burg{b['i']}",
            "category": "settlements",
            "x": wx, "y": wy,
            "name": b.get("name") or "Settlement",
            "note": burg_note(b),
            "link": b.get("link") or "",            # burg-preview href, if the GM set one
            "group": b.get("group") or "town",      # capital/city/town/village/fort/monastery/…
            "port": 1 if b.get("port") else 0,
            "population": int(round((b.get("population") or 0) * 1000)),
        })

    cat_defs = [
        {"id": "settlements", "name": "Settlements", "icon": "assets/icons/city.svg"},
        {"id": "landmarks", "name": "Landmarks", "icon": "assets/icons/landmark.svg"},
        {"id": "hazards", "name": "Hazards", "icon": "assets/icons/skull.svg"},
    ]
    return {"categories": cat_defs, "markers": out}


def build_labels(geo, revealed, to_world, lookups):
    """State and province text labels at their Azgaar 'pole' points, limited to
    states/provinces that have at least one revealed cell. Names come from the
    merged lookups so curation/renaming applies here too."""
    poles = geo.get("poles", {})
    full = geo.get("state_fullnames", {})
    revealed_states = {cells_by_id[c]["properties"].get("state") for c in revealed}
    revealed_provs = {cells_by_id[c]["properties"].get("province") for c in revealed}

    def collect(key, revealed_ids, prefer):
        table = lookups.get(key, {})
        out = []
        for sid, pole in poles.get(key, {}).items():
            if sid not in revealed_ids:
                continue
            # States use the full country name; provinces use the short name.
            name = prefer.get(sid) or (table.get(str(sid)) or {}).get("name")
            if not name:
                continue
            wx, wy = to_world(pole[0], pole[1])
            out.append({"id": sid, "name": name, "x": wx, "y": wy})
        return out

    return {"states": collect("state", revealed_states, full),
            "provinces": collect("province", revealed_provs, {})}


# ---------------------------------------------------------------------------
# Overlay palettes (for the manifest)
# ---------------------------------------------------------------------------

def auto_color(i):
    """Deterministic, visually-distinct color for integer id i (golden-angle hue)."""
    h = (i * 0.61803398875) % 1.0
    r, g, b = colorsys.hsv_to_rgb(h, 0.55, 0.85)
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))


def build_palette(cells, revealed, key, lookups):
    """id -> {name, color} for one overlay key, limited to ids present in the
    revealed cells. Uses lookups.json where available, else auto values."""
    ids = sorted({cells_by_id[c]["properties"].get(key)
                  for c in revealed} - {None})
    look = lookups.get(key, {})
    pal = {}
    for i in ids:
        entry = look.get(str(i))
        if entry:
            pal[str(i)] = entry
        elif key == "biome" and i in BIOME_DEFAULTS:
            name, color = BIOME_DEFAULTS[i]
            pal[str(i)] = {"name": name, "color": color}
        else:
            pal[str(i)] = {"name": f"{key.capitalize()} {i}", "color": auto_color(i)}
    return pal


# Overlay dimensions baked into each hidden cell so it's self-describing on reveal.
META_DIMS = ("biome", "state", "province", "culture", "religion")


def _cell_overlay_meta(props, full):
    """Per-cell {dimension: {id: {name,color}}} for this cell's own overlay ids.
    A trimmed static manifest omits hidden regions' palette entries, so each hidden
    cell carries its own — the client merges them into manifest.overlays when the
    cell is revealed, lighting up names + overlay colors + hover."""
    meta = {}
    for dim in META_DIMS:
        v = props.get(dim)
        if v is None:
            continue
        entry = full.get(dim, {}).get(str(v))
        if entry:
            meta.setdefault(dim, {})[str(v)] = entry
    return meta


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cells_by_id = {}  # module-level so build_palette can see full cell props


def cmd_build(args):
    resources = args.resources
    out_dir = args.out
    os.makedirs(out_dir, exist_ok=True)

    cells_path = find_latest(resources, "Cells")
    markers_path = find_latest(resources, "Markers")
    rivers_path = find_latest(resources, "Rivers")
    routes_path = find_latest(resources, "Routes")
    if not cells_path or not markers_path:
        sys.exit(f"error: need at least Cells + Markers exports in {resources}")
    print(f"cells:   {os.path.basename(cells_path)}")
    print(f"markers: {os.path.basename(markers_path)}")

    cells = load_features(cells_path)
    markers = load_features(markers_path)
    global cells_by_id
    cells_by_id = {f["properties"]["id"]: f for f in cells}

    # Reveal set
    if args.reveal_all:
        revealed_ids = set()
    elif args.reveal is not None:
        revealed_ids = set(args.reveal)
    else:
        revealed_ids = set(_read_manifest_revealed(out_dir))
    revealed = compute_revealed_cells(cells, revealed_ids, args.by, args.coast_ring)
    print(f"revealed: {len(revealed)} cells "
          f"({'ALL' if not revealed_ids else f'{args.by} in {sorted(revealed_ids)}'})")

    # Transform (derived from markers, in degree space) + projector to world px
    cal = derive_deg_to_pixel(markers)
    project = make_projector(cal, args.scale, args.origin_x, args.origin_y)
    grid = CentroidGrid(cells)  # built in degree space, before projection

    # Names/colors: data/lookups.json overrides win, then the Azgaar JSON export,
    # then (inside build_palette) embedded biome defaults / auto colors.
    lookups = merge_lookups(_load_lookups(args.lookups, out_dir),
                            load_azgaar_tables(resources))

    # Outputs
    lake_names = load_lake_names(resources)   # needs a Full JSON; else lakes unnamed
    world = build_cells(cells, revealed, project, lookups, lake_names)
    _write_json(os.path.join(out_dir, "world.geojson"), world)
    print(f"  wrote world.geojson ({len(world['features'])} cells)")

    if rivers_path:
        # Keep the width fields so the renderer can taper rivers source->mouth.
        rivers = build_lines(load_features(rivers_path), revealed, grid, project,
                             keep_props=("id", "name", "type",
                                         "sourceWidth", "widthFactor", "discharge"))
        _write_json(os.path.join(out_dir, "rivers.geojson"), rivers)
        print(f"  wrote rivers.geojson ({len(rivers['features'])} segments)")
    if routes_path:
        routes = build_lines(load_features(routes_path), revealed, grid, project,
                             keep_props=("id", "group", "name"))
        _write_json(os.path.join(out_dir, "routes.geojson"), routes)
        print(f"  wrote routes.geojson ({len(routes['features'])} segments)")
    geo = load_azgaar_geo(resources)
    to_world = make_pixel_projector(args.scale, args.origin_x, args.origin_y)
    if args.markers:
        mk = build_markers(markers, revealed, grid, project, geo["burgs"], to_world)
        _write_json(os.path.join(out_dir, "markers.json"), mk)
        settle = sum(1 for m in mk["markers"] if m["category"] == "settlements")
        print(f"  wrote markers.json ({len(mk['markers'])} markers, {settle} settlements)")

    labels = build_labels(geo, revealed, to_world, lookups)
    _write_json(os.path.join(out_dir, "labels.json"), labels)
    print(f"  wrote labels.json ({len(labels['states'])} state, "
          f"{len(labels['provinces'])} province labels)")

    # Distance scale for the measuring tool: Azgaar's distanceScale is units per
    # Azgaar px; world px = azgaar px * scale, so per-world-px = scale / args.scale.
    settings = (_load_azgaar_json(resources) or {}).get("settings", {})
    distance = None
    if settings.get("distanceScale"):
        distance = {"perPixel": float(settings["distanceScale"]) / args.scale,
                    "unit": settings.get("distanceUnit", "mi")}

    _write_manifest(out_dir, args, revealed, revealed_ids, cells, lookups, world, distance)
    print("done.")


def _write_manifest(out_dir, args, revealed, revealed_ids, cells, lookups, world, distance=None):
    path = os.path.join(out_dir, "manifest.json")
    prev = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                prev = json.load(fh)
        except (OSError, ValueError):
            prev = {}

    # Bounds + a sensible default home (centroid of all revealed cell vertices).
    xs, ys = [], []
    for f in world["features"]:
        for ring in (f["geometry"]["coordinates"]
                     if f["geometry"]["type"] == "Polygon" else []):
            for x, y in ring:
                xs.append(x); ys.append(y)
    bounds = [min(xs), min(ys), max(xs), max(ys)] if xs else [0, 0, 0, 0]
    home = prev.get("home") or [round((bounds[0] + bounds[2]) / 2, 2),
                                round((bounds[1] + bounds[3]) / 2, 2)]

    manifest = {
        "version": int(prev.get("version", 0)) + 1,
        "updated": datetime.date.today().isoformat(),
        "generator": "azgaar_export.py",
        "by": args.by,
        "revealed": sorted(revealed_ids),
        "home": home,
        "bounds": [round(v, 2) for v in bounds],
        "distance": distance,   # {perPixel, unit} for the measuring tool, or null
        "data": {
            "cells": "data/world.geojson",
            "rivers": "data/rivers.geojson",
            "routes": "data/routes.geojson",
            "labels": "data/labels.json",
        },
        "overlays": {
            "biome": build_palette(cells, revealed, "biome", lookups),
            "state": build_palette(cells, revealed, "state", lookups),
            "province": build_palette(cells, revealed, "province", lookups),
            "culture": build_palette(cells, revealed, "culture", lookups),
            "religion": build_palette(cells, revealed, "religion", lookups),
        },
    }
    _write_json(path, manifest)
    print(f"  wrote manifest.json (version {manifest['version']}, "
          f"home {home}, {len(revealed)} cells)")


# ---------------------------------------------------------------------------
# Live reveal: upload hidden regions to Supabase (Phase 2, milestone 05b)
# ---------------------------------------------------------------------------

def _supabase_request(method, url, key, body=None, extra_headers=None):
    """Minimal PostgREST call over stdlib urllib. Returns (status, text)."""
    import urllib.request
    import urllib.error
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    for k, v in (extra_headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


def cmd_upload(args):
    """Push the NOT-statically-revealed regions' cells into Supabase `hidden_cells`,
    where RLS keeps them secret until the GM reveals the region live. Reuses the
    exact static reveal logic, so what ships in git and what's uploaded never
    overlap. Credentials come from env vars (the secret key bypasses RLS to write;
    never commit it):
        SUPABASE_URL          e.g. https://abcd.supabase.co   (same as config.js)
        SUPABASE_SERVICE_KEY  the SECRET key (sb_secret_... / service_role)
    """
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not args.dry_run and (not url or not key):
        sys.exit("error: set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars "
                 "(the SECRET key — never commit it). Use --dry-run to preview "
                 "without uploading.")

    resources = args.resources
    cells_path = find_latest(resources, "Cells")
    markers_path = find_latest(resources, "Markers")
    if not cells_path or not markers_path:
        sys.exit(f"error: need Cells + Markers exports in {resources}")
    cells = load_features(cells_path)
    markers = load_features(markers_path)

    # Static reveal set (same logic as build): these ship in git, so they are the
    # regions we must NOT upload — only what's hidden goes to Supabase.
    if args.reveal_all:
        revealed_ids = set()
    elif args.reveal is not None:
        revealed_ids = set(args.reveal)
    else:
        revealed_ids = set(_read_manifest_revealed(args.out))
    static_revealed = compute_revealed_cells(cells, revealed_ids, args.by, args.coast_ring)

    cal = derive_deg_to_pixel(markers)
    project = make_projector(cal, args.scale, args.origin_x, args.origin_y)
    lookups = merge_lookups(_load_lookups(args.lookups, args.out),
                            load_azgaar_tables(resources))
    lake_names = load_lake_names(resources)

    # Full overlay palettes (every id), so each hidden cell can carry the name +
    # color for its own biome/state/province/culture/religion — merged into
    # manifest.overlays on reveal (the trimmed static manifest omits them).
    global cells_by_id
    cells_by_id = {f["properties"]["id"]: f for f in cells}
    all_ids = set(cells_by_id.keys())
    full = {dim: build_palette(cells, all_ids, dim, lookups) for dim in META_DIMS}

    rows = []
    for f in cells:
        if f["properties"]["id"] in static_revealed:
            continue                          # already public via git — not hidden
        region_id = f["properties"].get(args.by)
        if not region_id:                     # 0 / None => water or neutral, no region
            continue
        feat = _cell_to_feature(f, project, lookups, lake_names)
        feat["_meta"] = _cell_overlay_meta(f["properties"], full)   # self-describing on reveal
        rows.append({
            "id": f["properties"]["id"],
            "region_id": region_id,
            "kind": args.by,
            "data": feat,
        })

    regions = sorted({r["region_id"] for r in rows})
    print(f"hidden cells: {len(rows)} across {len(regions)} {args.by}(s) "
          f"(everything not in the static reveal)")

    # Rivers/routes split per cell for live reveal, gated by discovery level
    # (rivers show at level >= 2, routes at >= 3). Same clip math as build_lines.
    grid = CentroidGrid(cells)
    line_rows = []
    rivers_path = find_latest(resources, "Rivers")
    routes_path = find_latest(resources, "Routes")
    if rivers_path:
        line_rows += build_hidden_lines(
            load_features(rivers_path), grid, project,
            ("id", "name", "type", "sourceWidth", "widthFactor", "discharge"),
            "river", 2, static_revealed, taper=True)
    if routes_path:
        line_rows += build_hidden_lines(
            load_features(routes_path), grid, project,
            ("id", "group", "name"), "route", 3, static_revealed)
    n_river = sum(1 for r in line_rows if r["kind"] == "river")
    print(f"hidden line segments: {len(line_rows)} "
          f"({n_river} river, {len(line_rows) - n_river} route)")

    if args.dry_run:
        # Previews go in resources/ (gitignored) — they hold SECRET hidden data and
        # must never land in committed data/. Names avoid export keywords so
        # find_latest() (case-insensitive on Windows) won't mistake them for exports.
        _write_json(os.path.join(resources, "upload-preview.json"), rows)
        _write_json(os.path.join(resources, "upload-lines-preview.json"), line_rows)
        print(f"dry run: wrote previews to resources/ "
              f"({len(rows)} cells, {len(line_rows)} line segments), nothing uploaded")
        return

    _replace_table(url, key, "hidden_cells", rows)
    _replace_table(url, key, "hidden_lines", line_rows)
    print("done. hidden cells + lines synced; reveal from the map (or set "
          "revealed_cells levels) to show them.")


def _replace_table(url, key, table, rows):
    """Clear a table then bulk-insert rows in batches (a full publish of that set).
    id>=0 matches every row; PostgREST requires a filter to allow DELETE."""
    status, msg = _supabase_request(
        "DELETE", f"{url}/rest/v1/{table}?id=gte.0", key,
        extra_headers={"Prefer": "return=minimal"})
    if status >= 300:
        sys.exit(f"error: clearing {table} failed ({status}): {msg}")

    BATCH = 1000
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        status, msg = _supabase_request(
            "POST", f"{url}/rest/v1/{table}", key, body=chunk,
            extra_headers={"Prefer": "return=minimal"})
        if status >= 300:
            sys.exit(f"error: insert into {table} (batch at {i}) failed ({status}): {msg}")
        print(f"  {table}: uploaded {min(i + BATCH, len(rows))}/{len(rows)}")


def cmd_emit_lookups(args):
    """Scaffold data/lookups.template.json from every id present in the export."""
    resources = args.resources
    cells_path = find_latest(resources, "Cells")
    if not cells_path:
        sys.exit(f"error: no Cells export found in {resources}")
    cells = load_features(cells_path)

    # Pre-fill from the Azgaar JSON export (real names/colors) where available.
    azgaar = load_azgaar_tables(resources)

    template = {}
    for key in ("biome", "state", "province", "culture", "religion"):
        ids = sorted({f["properties"].get(key) for f in cells} - {None})
        look = azgaar.get(key, {})
        table = {}
        for i in ids:
            entry = look.get(str(i))
            if entry:
                name, color = entry["name"], entry["color"]
            elif key == "biome" and i in BIOME_DEFAULTS:
                name, color = BIOME_DEFAULTS[i]
            else:
                name, color = f"{key.capitalize()} {i}", auto_color(i)
            table[str(i)] = {"name": name, "color": color}
        template[key] = table

    out = args.out or os.path.join(ROOT, "data", "lookups.template.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    _write_json(out, template)
    print(f"wrote {out}")
    print("Edit it with real names/colors (delete anything players shouldn't see),")
    print("then save it as data/lookups.json so `build` picks it up.")


# ---------------------------------------------------------------------------
# Small IO helpers
# ---------------------------------------------------------------------------

def _write_json(path, obj):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


def _read_manifest_revealed(out_dir):
    path = os.path.join(out_dir, "manifest.json")
    if not os.path.exists(path):
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh).get("revealed", [])
    except (OSError, ValueError):
        return []


def _load_lookups(explicit, out_dir):
    path = explicit or os.path.join(out_dir, "lookups.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            print(f"  lookups: {os.path.basename(path)}")
            return json.load(fh)
    return {}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Turn an Azgaar GIS export into Lyndryss vector data.")
    sub = parser.add_subparsers(dest="command", required=True)

    res_arg = argparse.ArgumentParser(add_help=False)
    res_arg.add_argument("--resources", default=os.path.join(ROOT, "resources"),
                         help="folder holding the raw Azgaar export (gitignored)")

    b = sub.add_parser("build", parents=[res_arg],
                       help="build world.geojson + friends for revealed regions")
    b.add_argument("--out", default=os.path.join(ROOT, "data"),
                   help="output folder for the player-safe data (default data/)")
    g = b.add_mutually_exclusive_group()
    g.add_argument("--reveal", type=int, nargs="*",
                   help="region IDs to reveal (default: read manifest 'revealed')")
    g.add_argument("--reveal-all", action="store_true",
                   help="reveal the whole world (testing only)")
    b.add_argument("--by", choices=["state", "province"], default="state",
                   help="what a reveal ID refers to (default: state)")
    b.add_argument("--coast-ring", dest="coast_ring", action="store_true",
                   default=True, help="include a 1-ring water border (default on)")
    b.add_argument("--no-coast-ring", dest="coast_ring", action="store_false")
    b.add_argument("--scale", type=float, default=1.0,
                   help="world px per Azgaar px (default 1.0)")
    b.add_argument("--origin-x", type=float, default=0.0,
                   help="Azgaar px mapped to world x=0 (default 0)")
    b.add_argument("--origin-y", type=float, default=0.0,
                   help="Azgaar px mapped to world y=0 (default 0)")
    b.add_argument("--lookups", default=None,
                   help="names/colors file (default: <out>/lookups.json if present)")
    b.add_argument("--markers", action="store_true",
                   help="also regenerate markers.json from Azgaar POI markers")
    b.set_defaults(func=cmd_build)

    u = sub.add_parser("upload", parents=[res_arg],
                       help="push hidden (not-statically-revealed) regions to Supabase "
                            "for live reveal")
    u.add_argument("--out", default=os.path.join(ROOT, "data"),
                   help="data folder, to read manifest 'revealed' + lookups (default data/)")
    ug = u.add_mutually_exclusive_group()
    ug.add_argument("--reveal", type=int, nargs="*",
                    help="statically-revealed region IDs to EXCLUDE (default: manifest 'revealed')")
    ug.add_argument("--reveal-all", action="store_true",
                    help="treat everything as statically revealed (uploads nothing)")
    u.add_argument("--by", choices=["state", "province"], default="state",
                   help="what a region ID refers to — must match your build + manifest (default: state)")
    u.add_argument("--coast-ring", dest="coast_ring", action="store_true",
                   default=True, help="match the build's coast-ring setting (default on)")
    u.add_argument("--no-coast-ring", dest="coast_ring", action="store_false")
    u.add_argument("--scale", type=float, default=1.0, help="world px per Azgaar px (match build)")
    u.add_argument("--origin-x", type=float, default=0.0, help="match build")
    u.add_argument("--origin-y", type=float, default=0.0, help="match build")
    u.add_argument("--lookups", default=None,
                   help="names/colors file (default: <out>/lookups.json if present)")
    u.add_argument("--dry-run", action="store_true",
                   help="write data/hidden_cells.preview.json instead of uploading")
    u.set_defaults(func=cmd_upload)

    e = sub.add_parser("emit-lookups", parents=[res_arg],
                       help="scaffold the names/colors table to edit")
    e.add_argument("--out", default=None,
                   help="output path (default data/lookups.template.json)")
    e.set_defaults(func=cmd_emit_lookups)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
