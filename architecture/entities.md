---
name: entities
description: Game entities for Cow Abductor — the player-controlled Lander and the abductable Cow / Plant / Mineral (sharing a state machine), plus the decorative orbiting Alien.
tags: [architecture, entities, lander, cargo]
---

# Entities

Two kinds of objects live on top of the [world](world.md): the player's
`Lander`, and the things it harvests. The cargo entities (`Cow`, `Plant`,
`Mineral`) all share the same lifecycle so the laser and tractor beam can treat
them uniformly.

```mermaid
flowchart TD
    Lander["Lander — player ship<br/>thrust, drag, fuel, heat, beam"]
    Cow["Cow"]
    Plant["Plant"]
    Mineral["Mineral"]
    Alien["Alien — decorative orbiter"]

    Lander -->|tractor beam reels in| Cow
    Lander -->|laser zaps, then beams| Plant
    Lander -->|laser zaps, then beams| Mineral

    subgraph cargo["Cargo state machine"]
      direction LR
      intact["intact / growing / onGround"] --> zapped --> carried --> stowed
    end
    Cow -.-> cargo
    Plant -.-> cargo
    Mineral -.-> cargo

    click Lander call navigate("../src/entities/lander.js")
    click Cow call navigate("../src/entities/cow.js")
    click Plant call navigate("../src/entities/plant.js")
    click Mineral call navigate("../src/entities/mineral.js")
    click Alien call navigate("../src/entities/alien.js")
    click cargo call navigate("../src/entities/plant.js")
    click intact call navigate("../src/entities/plant.js")
    click zapped call navigate("../src/entities/plant.js")
    click carried call navigate("../src/entities/cow.js")
    click stowed call navigate("../src/entities/mineral.js")
```

Each cargo entity exposes a `liftSpeed` tuned to its mass — plants reel in fast
(3.2), cows slowly (1.4), minerals slowest (1.8) — so heavier samples feel
heavier on the beam.

## Source

- [../src/entities/lander.js](../src/entities/lander.js) — the player ship:
  substepped physics integration, drag, fuel/cargo, hull heat, trajectory
  prediction, and the tractor beam.
- [../src/entities/cow.js](../src/entities/cow.js) — `Cow`, the headline cargo;
  kinematic capped lift toward the ship's hatch.
- [../src/entities/plant.js](../src/entities/plant.js) — `Plant`, a fractal tree
  grown from a per-plant PRNG; light and quick to reel in.
- [../src/entities/mineral.js](../src/entities/mineral.js) — `Mineral`, a lumpy
  procedural boulder mirroring the plant/cargo state machine.
- [../src/entities/alien.js](../src/entities/alien.js) — `Alien`, a cosmetic
  figure that orbits a planet's surface.

Entities are created and updated by the [game loop](game-loop.md) and positioned
relative to [Planet](world.md) surfaces.
