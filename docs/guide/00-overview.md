# Implementation Guide — Overview

This guide walks you through implementing every stub in `js/`, milestone by
milestone. Each milestone ends with a working, visible result. The code shown
is complete and tested — type it in (don't paste; typing is the point), read
the comments, and use the **Checkpoint** sections to confirm you're on track.

| Milestone | You build | You see |
|---|---|---|
| [01 — First render](01-first-render.md) | `tile-manager.js`, minimal `renderer.js`, `main.js` | the map on screen |
| [02 — Pan & zoom](02-pan-zoom.md) | input handling, `ui.js` part 1 | a navigable map |
| [03 — Markers & layers](03-markers-layers.md) | `markers.js`, `layers.js`, `ui.js` part 2 | toggleable icons + popups |
| [04 — Annotations](04-annotations.md) | `annotations.js`, `ui.js` part 3 | player marks that persist |
| [05 — Polish](05-polish.md) | `url-state.js` + final wiring | shareable links, live updates |

## The trick that makes this work: stubs are safe no-ops

Every stub in `js/` already exports the right names, and almost all of them
do nothing harmlessly (return `null`, `[]`, `false`). That means a module can
*call* functions you haven't written yet — the call just does nothing until
you implement it. This is why `main.js` gets typed in once, in milestone 1,
in its final form: the search box, popups, and URL features simply "light up"
as later milestones fill in the modules they depend on.

The two exceptions that throw (`loadManifest`, `loadMarkers`) are handled in
milestone 1.

## Your dev loop

1. Serve the repo root (ES modules refuse to load from `file://`):
   ```
   python -m http.server 8000
   ```
   then open <http://localhost:8000>.
2. Edit a file, save, **refresh the browser**. No build step, ever.
3. Live in DevTools (F12):
   - **Console** — errors land here. An error in a module prevents the whole
     module (and its importers) from loading, so one typo can blank the app.
     Always check here first.
   - **Network** — see every tile/JSON request. A red 404 on a tile means the
     manifest and the `tiles/` folder disagree.
   - **Sources** — set breakpoints by clicking line numbers. Step through
     `draw()` once early on; it will teach you more than any document.
4. From milestone 1 onward there's a debug hook — poke the app from the
   Console:
   ```js
   lyndryss.renderer.view.scale = 2; lyndryss.renderer.render()
   ```

## Architecture recap

```
                 data/manifest.json      data/markers.json     localStorage
                        │                       │                   │
                  tile-manager.js          markers.js        annotations.js
                        │                       │ ▲                 │ ▲
        tiles/*.png ────┘                       │ │                 │ │
                        ▼                       ▼ │                 ▼ │
   config.js ─────► renderer.js ◄────────── layers.js ◄────────── ui.js ◄── DOM events
   (constants)      (draw loop,             (what's visible)      (wires every
                     pan/zoom,                                     button/switch)
                     click routing)                ▲
                        │                          │
                        ▼                          │
                  url-state.js ────────────────────┘
                  (#zoom=…&x=…&y=…)        main.js (boot order; owns nothing else)
```

Two coordinate systems rule everything (see `data/SCHEMA.md`):

- **world px** — fixed map space; world (0,0) is the top-left corner of tile
  (0,0); y grows downward. Markers, annotations, and the viewport center are
  stored in world px.
- **screen px** — CSS pixels relative to the canvas. Only the renderer's two
  transform functions ever convert between the spaces. If you're debugging a
  position bug, the question is always "which space is this number in?"

## JS crash course for a Python/C++ person

The essentials you'll hit immediately. Deeper primers appear in the
milestones as **JS vs Python** callouts, right where each concept first bites.

**`const` / `let`, never `var`.** `const` = the *binding* can't be reassigned
(the object it points to is still mutable — like a `final` pointer, not
`const` data). `let` is a normal block-scoped variable. `var` is a legacy
function-scoped trap; pretend it doesn't exist.

**`===` always.** `==` does insane type coercion (`"1" == 1` is true).
`===`/`!==` compare like you'd expect. There is no `is`; `===` covers it.

**Arrow functions are lambdas without the limits.**
`(a, b) => a + b` is `lambda a, b: a + b`, but multi-statement bodies are
fine: `(e) => { doThing(); doOther(); }`. You'll pass them around constantly,
especially as event handlers and callbacks.

**Template literals** are f-strings with backticks: `` `${x},${y}` `` ≈
`f"{x},{y}"`.`

**Destructuring** is tuple unpacking: `const { x, y } = point` pulls
properties by name; `const [a, b] = pair` by position.

**ES modules.** `import { thing } from "./file.js"` ≈
`from file import thing` — but the path is a real URL (the `./` and `.js`
are mandatory) and modules only run over HTTP. Each module is a singleton:
every importer shares the same module-level variables, which is why
`tile-manager.js` can keep its cache in a plain top-level `Map`.

**`async`/`await`** look exactly like Python's and mean the same thing,
with one big difference: there's no event loop to start. The browser *is*
the event loop. Any function marked `async` returns a Promise (≈ a Future);
`await` unwraps it. Forgetting `await` doesn't crash — you just get a
Promise object where you expected data, and weird bugs downstream.

**Closures instead of classes.** `createRenderer()` defines a pile of inner
functions and returns an object containing some of them. Every inner function
can see `view`, `ctx`, etc. from the enclosing call — those captured
variables *are* the instance state. It's `self.x` without `self`. (JS has
classes too; closures just fit this codebase better and dodge JS's infamous
`this`-binding rules entirely.)

**`Map` and `Set`** are real hash containers (`dict`/`set`). Caveat: keys
compare by *identity* for objects/arrays — `new Set([[0,0]]).has([0,0])` is
`false`. When you need value-keyed lookups, build a string key like `"0,0"`.

**The event loop & `requestAnimationFrame`.** All your JS runs on one
thread. You never block and wait — you register callbacks and return.
`addEventListener("click", fn)` calls `fn` later; `img.onload = fn` calls
`fn` when the download finishes; `requestAnimationFrame(fn)` calls `fn` right
before the browser's next repaint (~60×/s), which is the correct place to
draw. Nothing runs concurrently with your code; callbacks run one at a time,
whenever you're not running.

## House rules

- No dependencies, no build step, no framework. If you can't explain a line,
  delete it and rewrite it until you can.
- The renderer owns drawing and input. `ui.js` owns the DOM. `main.js` owns
  the boot order. Data modules own their data. When a feature feels awkward,
  you're probably putting it in the wrong module.
- After each milestone, commit. Small, working commits are the cheat code.
