# References

Links gathered while building the generative effects work in this session.

## Atmospheric rendering (used by `atmosphere.js`)

- [On rendering the sky, sunsets, and planets — Maxime Heckel](https://blog.maximeheckel.com/posts/on-rendering-the-sky-sunsets-and-planets/) — Source of the Rayleigh / Mie / day-night / sunset math, adapted from 3D volumetric raymarching to a 2D atmosphere ring.

## p5.js shader patterns

- [aferriss/p5jsShaderExamples](https://github.com/aferriss/p5jsShaderExamples/) — Reference for `createShader`, fullscreen-quad vertex shader pattern, and uniform plumbing in p5.

## Particle systems (used by the tractor beam in `lander.js`)

- [Creating Stunning Particle Systems in p5.js — Eftee Codes](https://efteecodes.medium.com/creating-stunning-particle-systems-in-p5-js-acd30adb4426)
- [p5.js particle systems example](https://p5js.org/examples/simulate-particles.html)

## Fluid simulation (candidate for thruster exhaust / smoke — not yet implemented)

- [Navier-Stokes fluid simulation explained with Godot — myzopotamia.dev](https://myzopotamia.dev/navier-stokes-fluid-simulation-explained-with-godot) — A walkthrough of Jos Stam's *Stable Fluids* algorithm: a grid-based (Eulerian) Navier-Stokes solver with diffuse → advect → project (Gauss-Seidel pressure solve) steps. The author's demo is a CPU/GDScript implementation at low resolution (16×16 inner grid, 20 relaxation iterations) used for rocket-engine smoke/flame. Candidate technique for a volumetric thruster plume / landing-dust effect in `lander.js`/`sketch.js`; would want a GPU (shader ping-pong) port given our existing shader infra, not the CPU version.

## Discussed but not yet implemented

Procedural starfield / nebula backdrop was on the shortlist; these are the references for it when we come back to it.

- [Procedural 2D space scenes — wwwtyro](https://wwwtyro.net/2016/10/22/2D-space-scene-procgen.html)
- [wwwtyro/space-scene-2d](https://github.com/wwwtyro/space-scene-2d)
- [My-own-nebula — generative art in p5.js](https://jelena-ristic.medium.com/my-own-nebula-project-generative-art-with-processing-py-and-p5-js-fa3033971bf2)
- [Nebular generator gist (Volkan Ongun)](https://gist.github.com/volkanongun/4160312)
