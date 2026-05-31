// GPU fluid thruster plume — the engine exhaust, built on the reusable FluidSim
// solver in fluidSim.js (Jos Stam "Stable Fluids", adapted from the Godot
// walkthrough in ../../references.md). Forces are injected at a fixed inlet (the
// nozzle) and the smoke flows "down" the grid (-y); at composite time the grid
// is blitted anchored at the lander's nozzle and rotated to the exhaust
// direction. The planet surface under the nozzle is fed in as a collision plane
// so the exhaust splays along the ground instead of passing through it.
//
// Gated behind DEBUG.fluidPlume; degrades to nothing if float framebuffers
// aren't available, so the particle flame in lander.js stays the fallback.

const FLUID_INLET = [0.5, 0.80];   // nozzle position in grid texcoords
const FLUID_INLET_RADIUS = 0.018;  // Gaussian splat radius² scale

// Colorize the smoke density into a premultiplied RGBA buffer. Hot core near
// the inlet reads yellow-white, cooling to orange/red, then a thin grey tail.
const PLUME_COLOR_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D u_density;
void main() {
  float d = clamp(texture2D(u_density, vUv).x, 0.0, 2.0);
  // Heat falls off along the flow (vUv.y goes 1=inlet -> 0=tail) and with
  // density, so the base of the plume is hottest.
  float heat = clamp(d * 1.3, 0.0, 1.0) * smoothstep(0.15, 0.9, vUv.y);
  vec3 smoke = vec3(0.55, 0.55, 0.6);
  vec3 ember = vec3(1.0, 0.35, 0.08);
  vec3 core  = vec3(1.0, 0.92, 0.6);
  vec3 col = mix(smoke, ember, smoothstep(0.0, 0.5, heat));
  col = mix(col, core, smoothstep(0.55, 1.0, heat));
  // Soft vignette so the quad has no hard square edge even if a little density
  // reaches the borders.
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.0, 0.16, e.x) * smoothstep(0.0, 0.16, e.y);
  float alpha = clamp(d * 1.25, 0.0, 1.0) * edge;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

let plumeSim = null;

function initPlumeFluid() {
  if (plumeSim) return;
  plumeSim = new FluidSim({ grid: 128, pressureIters: 40, colorFrag: PLUME_COLOR_FRAG });
  plumeSim.init();
}

// Map the world-space ground under the nozzle into the sim's local UV space as a
// half-plane obstacle (point + outward normal). `ground` is built by the game
// loop: { nozzle:{x,y}, angleDeg, px,py (surface point), nx,ny (terrain normal),
// dist (surface distance from nozzle) }. The plume quad is drawn with the same
// translate(nozzle)+rotate(angle) frame and spans worldSize per UV unit, with
// the inlet at FLUID_INLET and the flow running toward smaller v — so world->UV
// is: rotate into ship-local, then u = 0.5 + localX/worldSize,
// v = FLUID_INLET.y - localY/worldSize.
function plumeGroundUniforms(ground) {
  const obs = { ...FLUID_NO_OBSTACLE };
  if (!ground) return obs;
  let worldSize = DEBUG.fluidPlumeScale;
  // Only engage once the ground is within the plume's reach.
  if (ground.dist > worldSize) return obs;

  let c = cos(ground.angleDeg);   // p5 angleMode(DEGREES) — matches localToWorld
  let s = sin(ground.angleDeg);
  // world delta -> ship-local (inverse rotation): Lx = vx*c + vy*s, Ly = -vx*s + vy*c
  let vx = ground.px - ground.nozzle.x;
  let vy = ground.py - ground.nozzle.y;
  let lx = vx * c + vy * s;
  let ly = -vx * s + vy * c;
  obs.u_planePoint = [0.5 + lx / worldSize, FLUID_INLET[1] - ly / worldSize];

  // Normal is rotation-only; the UV v-axis is flipped vs local y, so v negates.
  let lnx = ground.nx * c + ground.ny * s;
  let lny = -ground.nx * s + ground.ny * c;
  let ux = lnx, uy = -lny;
  let m = Math.hypot(ux, uy) || 1.0;
  obs.u_planeActive = 1.0;
  obs.u_planeNormal = [ux / m, uy / m];
  return obs;
}

// Advance the simulation one step. `thrust` is 0..1 (lander.thrusting); the inlet
// only injects while the engine is firing, but the field keeps evolving so the
// tail dissipates after cutoff. `ground` (optional) collides the exhaust with
// the planet surface.
function updatePlumeFluid(thrust, ground) {
  if (!plumeSim || !plumeSim.ready) return;
  let obs = plumeGroundUniforms(ground);

  // 1) Advect velocity through itself. Notable drag (0.97) keeps the
  //    incompressible return flow from building a box-filling recirculation.
  plumeSim.advectVelocity(0.97, obs);

  // 2) Inject exhaust momentum + smoke at the inlet while thrusting. Flow runs
  //    "down" the grid (-y); a little lateral jitter avoids a perfect column.
  if (thrust > 0) {
    let jitter = (Math.random() - 0.5) * 0.5 * thrust;
    plumeSim.splatVelocity(FLUID_INLET, [jitter, -12.0 * thrust, 0.0, 0.0], FLUID_INLET_RADIUS);
    // Modest density inject; with ~7.5% per-frame dissipation below the
    // steady-state core lands near 0.16/(1-0.925) ≈ 2.1 — bright, not a box.
    plumeSim.splatDensity(FLUID_INLET, [0.16 * thrust, 0.0, 0.0, 0.0], FLUID_INLET_RADIUS);
  }

  // 3) Projection makes the velocity divergence-free (and splays it off the
  //    ground plane).
  plumeSim.project(obs);

  // 4) Advect the smoke density through the divergence-free velocity. Heavy
  //    dissipation caps the steady-state density; the wide (0.25) asymmetric edge
  //    fade lets the tail dissolve gradually well before the downstream edge.
  plumeSim.advectDensity(0.925, 1.0, obs, 0.25);

  // 5) Colorize onto the sim's own canvas for blitting.
  plumeSim.colorize();
}

// Blit the colorized plume into the (already camera-transformed) world: anchor
// at the nozzle, rotate so the grid's flow axis points along the exhaust, and
// size the quad in world units. `nozzle` is a world point, `angleDeg` the lander
// rotation (p5 angleMode DEGREES), `worldSize` the world-space quad size.
function drawPlumeFluid(nozzle, angleDeg, worldSize) {
  if (!plumeSim || !plumeSim.ready) return;
  push();
  blendMode(ADD);
  imageMode(CENTER);
  translate(nozzle.x, nozzle.y);
  rotate(angleDeg);
  // Inlet sits near the top of the grid and smoke flows toward the bottom; ship
  // local +y is the exhaust direction, so place the quad below the nozzle.
  image(plumeSim.gfx, 0, worldSize * 0.5, worldSize, worldSize);
  imageMode(CORNER);
  blendMode(BLEND);
  pop();
}

function resizePlumeFluid() {
  // Fixed-resolution sim — nothing to do on window resize. (The composite quad
  // is sized in world units, so it scales with the camera automatically.)
}
