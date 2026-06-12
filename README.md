# Lyndryss-Map
This is a map of Lyndryss, a world developed for the homebrewed Pathfinder game 'Aye Dark Overlord'.

## Basic concept
A westmarch is a TTRPG game where the players gradually explore an unknown world, developing a map as they go. This site will be used to host the most up-to-date map displaying what the players have discovered so far. The map will start with just a single tile around their base and, as the session goes along, it new 'tiles' will be added to expand outward. 'Expanding' the map can mean many things, from charting basic land features, to finding new buildings or settlements, to the players changing the world in some way. Regardless, there needs to be a way for the game master to push an updated tile set to this page reflecting that new information.

## Features for GM
The GM needs to be able to push individuals tiles to the repository in a way where the player-accessible webpage reflects those changes. The world map needs to be split into tiles so that only a few are displayed to the players at a given moment, but new tiles can be added easily. There needs to be layers to the map so that icons can be toggled on/off (Currently icons are baked into the test png map, but that will change). 


# Features for players
The players who access the site can not see any tiles beyond what is meant to be made public. This can just be done by only pushing certain tiles to the github repository. Players also need to be able to switch on/off relevant icons and potentially overlays to the map as a whole (I'd like, at some point to add culture, territorial control, and religion map overlays). They also need to be able to easily zoom in and pan around the map. Finally, if possible, I want to make it so players can leave their own custom icons, and maybe notes, on the map, even if these cannot be saved between sessions.

# Site structure

```
index.html          app shell (header, canvas, sidebar, templates)
css/style.css       dark UI theme; state classes documented at the top
js/                 ES modules — stubs with documented interfaces, logic TBD
  config.js         constants and tile URL helper
  main.js           boot sequence
  tile-manager.js   manifest + tile image loading/caching
  renderer.js       canvas viewport, transforms, pan/zoom, draw loop
  layers.js         overlay / icon-category visibility state
  markers.js        GM markers: load, hit-test, search
  annotations.js    player icons & notes (localStorage only)
  ui.js             DOM wiring for every control
  url-state.js      shareable view links via the URL hash
data/
  manifest.json     which tiles exist, per layer (the reveal model)
  markers.json      GM marker data
  SCHEMA.md         data format + coordinate system reference
tiles/{layer}/      revealed tile PNGs, named {x}_{y}.png
assets/icons/       UI and marker SVGs
tools/slice-map.py  master-map → tiles slicer (stub)
resources/          GM-private master maps — gitignored, never push these
```

## GM publish workflow

1. Slice newly revealed area from the master map and copy the new
   `{x}_{y}.png` files into `tiles/base/` (see `tools/slice-map.py` and
   `data/SCHEMA.md` for the coordinate rules).
2. Add the new tile coords to `data/manifest.json`, bump `version`, update
   `updated`. Add any new markers to `data/markers.json`.
3. Commit and push to `main`. GitHub Pages redeploys automatically; players
   refresh and see the new map.

**One-time setup:** repo Settings → Pages → Deploy from branch → `main`,
folder `/ (root)`.

**Secrecy note:** this is a public repo — anything committed is visible to
players, including history. The full master map lives in `resources/`, which
is gitignored. Only ever commit individual revealed tiles.

## Local development

Serve the repo root with any static server (modules won't load from `file://`):

```
python -m http.server 8000
```

then open http://localhost:8000.