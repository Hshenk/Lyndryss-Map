# Data formats

## Coordinate system

The world is an infinite grid of square tiles, `tileSize` pixels on a side.

- **Tile coords** are integers and may be negative. Tile `(0, 0)` is the
  starting tile (the party's base); the world grows outward in every
  direction as tiles are revealed.
- **World pixels** are the shared space for markers and annotations.
  World `(0, 0)` is the **top-left corner of tile (0, 0)**, so tile `(x, y)`
  covers world px `[x·tileSize, (x+1)·tileSize)` × `[y·tileSize, (y+1)·tileSize)`.
- Y grows downward (screen convention).

## Tile files

```
tiles/{layer}/{x}_{y}.png      e.g. tiles/base/-1_2.png
```

Every tile PNG is exactly `tileSize × tileSize` px. Edge tiles cut from a
master map that doesn't divide evenly are padded with transparency.
A tile that isn't listed in the manifest (or whose file is missing) is
simply not drawn — that area stays unrevealed.

Overlay layers (`territory`, `culture`, `religion`) use the same scheme and
should be semi-transparent PNGs; the client also applies a global alpha when
drawing them.

## manifest.json

```jsonc
{
  "version": 1,             // bump on every push — clients use it to detect updates
  "updated": "2026-06-12",  // ISO date shown in the header
  "tileSize": 480,          // world px per tile edge
  "layers": ["base", "territory", "culture", "religion"], // "base" must be first
  "tiles": {                // per-layer list of [x, y] tile coords that exist
    "base": [[0, 0], [1, 0]],
    "territory": []
  }
}
```

The reveal model is: **a tile the players can see = a tile listed here whose
PNG is committed.** Nothing else needs to change.

## markers.json

```jsonc
{
  "categories": [
    { "id": "settlements", "name": "Settlements", "icon": "assets/icons/city.svg" }
  ],
  "markers": [
    {
      "id": "basecamp",        // unique, stable (used by search/permalinks)
      "category": "settlements",
      "x": 40, "y": -60,        // world px (see coordinate system above)
      "name": "Basecamp",
      "note": "Popup body text." // optional
    }
  ]
}
```

Markers are drawn by the client and toggled per-category, so icons must NOT
be baked into tile art. Only commit markers the players are allowed to see.

## GM publish loop

1. Reveal new area: slice the master map (`tools/slice-map.py`) and copy the
   newly revealed `{x}_{y}.png` files into `tiles/base/` (and any overlay
   folders).
2. Add those `[x, y]` coords to `tiles.<layer>` in `manifest.json`, bump
   `version`, set `updated`.
3. Add/edit markers in `markers.json` if anything was discovered.
4. Commit and push — GitHub Pages redeploys automatically; players see the
   new map on refresh.
