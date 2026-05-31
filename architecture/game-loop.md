---
name: game-loop
description: The sketch.js orchestration core — p5 setup/draw, procedural world generation, camera/view, minimap & HUD, laser/particle effects, collisions, and game-state transitions for Cow Abductor.
tags: [architecture, game-loop, p5js, sketch]
---

# Game loop & orchestration

[../src/sketch.js](../src/sketch.js) is the conductor. It holds the global game
state, builds the world, runs the per-frame `draw` loop, and owns every visual
system that isn't an entity or a planet. At ~2500 lines it's the largest file in
the project; the diagram below groups its functions by responsibility.

```mermaid
flowchart TD
    preload["preload()"] --> setup["setup()"]
    setup --> buildWorld["buildWorld()"]
    buildWorld --> initEnt["initializeCows / Plants / Minerals"]

    draw["draw() — per frame"]
    draw --> updateView["updateView() — camera follow & zoom"]
    draw --> physics["lander.update + checkCollisions()"]
    draw --> render["draw planets, entities, atmosphere, clouds"]
    draw --> effects["lasers, particles, splashes, burn"]
    effects --> plume["GPU fluid plume (experimental)"]
    effects --> burn["GPU fluid burn (experimental)"]
    draw --> hud["drawHUD / drawMinimap / drawMissionReadout"]
    draw --> state["game-state messages & transitions"]

    physics --> checkCollisions["checkCollisions()"]
    checkCollisions --> checkSafeLanding["checkSafeLanding()"]
    state --> startGame["startGame / resetGame / liftOff / tryDeliver"]

    click preload call navigate("../src/sketch.js")
    click setup call navigate("../src/sketch.js")
    click buildWorld call navigate("../src/sketch.js")
    click initEnt call navigate("../src/sketch.js")
    click draw call navigate("../src/sketch.js")
    click updateView call navigate("../src/sketch.js")
    click physics call navigate("../src/sketch.js")
    click render call navigate("../src/sketch.js")
    click effects call navigate("../src/sketch.js")
    click hud call navigate("../src/sketch.js")
    click state call navigate("../src/sketch.js")
    click checkCollisions call navigate("../src/sketch.js")
    click checkSafeLanding call navigate("../src/sketch.js")
    click startGame call navigate("../src/sketch.js")
    click plume call navigate("../src/effects/plumeFluid.js")
    click burn call navigate("../src/effects/burnFluid.js")
```

## Responsibilities

- **Lifecycle** — `preload` (assets), `setup`, `buildWorld`, `windowResized`,
  and the `draw` loop tick.
- **World seeding** — `buildWorld`, `assignPlanetNames`, `initializeCows`,
  `initializePlants`, `initializeMinerals`, `spawnCluster`, `pickDryAngle`.
- **Camera** — `view` state, `updateView`, `resetView`, `computeOverviewBox`.
- **Collision & landing** — `checkCollisions`, `checkSafeLanding`,
  `isLanderUprightForPlanet`, `getSurfaceDistance`, `getSurfaceRadius`,
  `getClosestPlanetInfo`, `distanceToLineSegment`.
- **Effects** — `fireLaser`, burn/splash/crash particle systems, and the
  `getBeamStopPositionRadial` beam geometry. The loop also drives the
  experimental GPU fluid plume (`updatePlumeFluid`/`drawPlumeFluid`) anchored at
  the lander's nozzle, with `getPlumeGround` feeding the planet surface in as a
  collision wall so the exhaust splays along the ground, plus the experimental
  GPU re-entry burn (`updateBurnFluid`/`drawBurnFluid`, `getBurnState`) — a
  velocity-aligned plasma wake with the hull as an obstacle.
- **UI** — `drawHUD`, `drawMinimap`, `drawMissionReadout`, `drawStarField`,
  `pickConstellation`, `drawNavTargetIndicator`, `drawGameStateMessages`.
- **State machine** — `startGame`, `resetGame`, `liftOff`, `tryDeliver`,
  `updateDiscoveries`, driven by the `GAME_STATES` enum.

## Source

- [../src/sketch.js](../src/sketch.js) — the entire orchestration core: globals,
  game loop, world generation, camera, collisions, effects, HUD, and state.
- [../src/effects/fluidSim.js](../src/effects/fluidSim.js) — reusable GPU
  "Stable Fluids" solver (`FluidSim` class + shared advect/splat/projection
  shaders and a half-plane+ellipse obstacle test). Backs every fluid effect.
  Technique adapted from the Navier-Stokes reference in
  [../references.md](../references.md).
- [../src/effects/plumeFluid.js](../src/effects/plumeFluid.js) — experimental GPU
  exhaust plume built on `FluidSim`. Stepped by `updateWorld` and composited at
  the nozzle in `draw`, behind the `DEBUG.fluidPlume` toggle, with the planet
  surface (`getPlumeGround`) fed in as a collision plane.
- [../src/effects/burnFluid.js](../src/effects/burnFluid.js) — experimental GPU
  re-entry burn wake built on `FluidSim`, aligned to the ship's velocity
  relative to the air (`getBurnState`) with the hull fed in as an ellipse
  obstacle. Behind the `DEBUG.fluidBurn` toggle.

It wires together the [entities](entities.md) and the [world](world.md), and
drives the thruster synth in [../src/core/sound.js](../src/core/sound.js).
