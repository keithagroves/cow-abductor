# Cow Abductor

A 2D p5.js game: pilot a lander through a solar system, descend through
planetary atmospheres, and tractor-beam cows, plants, and minerals back to base.
Physics (gravity, drag, hull heat) and rendering (shader atmospheres, clouds,
day/night terminator) are all hand-rolled.

## Running

There is **no build step and no package.json** — it's plain static files plus a
CDN copy of p5.js.

- Serve the directory over HTTP and open `index.html`. A static server is
  required (not `file://`) because the shaders and `p5.sound` won't load from the
  filesystem — e.g. `python3 -m http.server` then open the printed URL.
- `sim.html` runs `src/core/simulate.js`, a headless physics harness that
  overrides p5's `setup`/`draw` to run repeatable simulations against the real
  `Lander`/`Planet` code. Use it to validate physics changes without the UI.

`index.html` lists the source `<script>` tags in dependency order; add new
source files there.

## Architecture

This repo follows **Mermaid Driven Development** — the diagrams in
[overview.md](overview.md) and [architecture/](architecture/) are the index to
the code, and must stay in sync with it.

- [overview.md](overview.md) is the entry diagram. Start here.
- [architecture/game-loop.md](architecture/game-loop.md) — `src/sketch.js`, the
  ~2500-line orchestration core (loop, world gen, camera, collisions, effects,
  HUD, state machine).
- [architecture/entities.md](architecture/entities.md) — the `Lander` and the
  abductable `Cow`/`Plant`/`Mineral` (shared cargo state machine), plus the
  decorative `Alien`.
- [architecture/world.md](architecture/world.md) — procedural `Planet` bodies and
  the shader-based `atmosphere`/`clouds` layers and home `base`.

**When you add, move, or delete a source file, update the owning diagram in the
same change** — add it to that doc's "Source" list and to the mermaid `click ...
call navigate(...)` nodes. See the `mermaid-driven-development` skill for the
rules; coverage can be re-checked with codeswim.

## Conventions

- **Vectors**: use p5's `createVector()` / `p5.Vector` everywhere. There is no
  custom vector class (the `Vector2.js` line in `index.html` is commented out).
- **Game state**: the `GAME_STATES` enum (`WAITING`, `PLAYING`, `LANDED`,
  `CRASHED`, `GAMEOVER`) in [src/constants.js](src/constants.js) drives the loop's
  state machine.
- **Tunables**: gameplay/physics knobs live in the `DEBUG` object in
  [src/core/debug.js](src/core/debug.js), persisted to localStorage and editable
  from the in-game debug panel. Reach for these before hardcoding constants.
- **Style**: vanilla JS using p5 globals (no modules, no TypeScript). Entities are
  ES classes; the loop is plain top-level functions. Match the surrounding file.

## Background notes

- [doc.md](doc.md) — how the atmosphere arc/ring shader effect works.
- [references.md](references.md) — external articles the generative effects were
  adapted from.
- [TODO.md](TODO.md) — current gameplay wishlist.
