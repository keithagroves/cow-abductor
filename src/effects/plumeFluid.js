// GPU fluid thruster plume — an experimental Eulerian smoke sim for the engine
// exhaust, following Jos Stam's "Stable Fluids" (semi-Lagrangian advection +
// Jacobi pressure projection). Technique adapted from the Godot walkthrough in
// ../../references.md ("Navier-Stokes fluid simulation explained with Godot"),
// ported from that CPU implementation to the GPU.
//
// The whole sim lives in a fixed GRID×GRID grid in its own local space — it is
// NOT a world-space field. Forces are injected at a fixed inlet (top-center =
// the nozzle) and the smoke flows "down" the grid (-y). At composite time the
// grid is blitted to the screen anchored at the lander's nozzle and rotated so
// the grid's flow axis points along the real exhaust direction, which sidesteps
// the moving/rotating camera problem a world-space grid would have.
//
// Everything is gated behind DEBUG.fluidPlume and degrades to nothing if float
// framebuffers aren't available, so the particle flame in lander.js stays the
// default and this is purely an additive experiment.

const FLUID_GRID = 128;          // sim resolution (cells per side)
const FLUID_PRESSURE_ITERS = 40; // Jacobi relaxation passes per frame (higher =
                                 // pressure propagates further, so the exhaust
                                 // turns and splays harder against the ground)
const FLUID_INLET = [0.5, 0.80]; // nozzle position in grid texcoords
const FLUID_INLET_RADIUS = 0.018; // Gaussian splat radius² scale

// Fullscreen-quad vertex shader — identical idiom to clouds.js/atmosphere.js:
// override gl_Position from the unit quad so the pass is projection-independent,
// and hand vTexCoord (0..1) to the fragment shader as the grid coordinate.
const FLUID_VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vUv;
void main() {
  vUv = aTexCoord;
  vec4 p = vec4(aPosition, 1.0);
  p.xy = p.xy * 2.0 - 1.0;
  gl_Position = p;
}
`;

// Semi-Lagrangian advection: trace the cell's value back along the velocity
// field by one step and resample (bilinear, via LINEAR-filtered FBOs). Used for
// both velocity (self-advection) and the smoke density, with a dissipation
// factor so the field decays instead of accumulating forever.
// Shared GLSL: an analytic "ground" half-plane the exhaust collides with. The
// JS side maps the world surface under the nozzle into this grid's UV space as
// a point + outward normal; cells on the far side of the plane are solid wall.
const FLUID_GROUND_GLSL = `
uniform float u_groundActive;   // 0 = no ground in range, 1 = active
uniform vec2  u_groundPoint;    // a point on the surface, grid UV
uniform vec2  u_groundNormal;   // unit outward normal, grid UV (into the gas)
bool solid(vec2 uv) {
  return u_groundActive > 0.5 && dot(uv - u_groundPoint, u_groundNormal) < 0.0;
}
`;

const FLUID_ADVECT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D u_src;       // quantity to advect
uniform sampler2D u_velocity;  // velocity field (RG = u,v in cells/step)
uniform float u_texel;         // 1.0 / GRID
uniform float u_dt;
uniform float u_dissipation;
uniform float u_edgeFade;      // >0.5: bleed the quantity to 0 near the borders
                               // (an outflow sink so the smoke doesn't fill the
                               // closed box). 0 for velocity self-advection.
${FLUID_GROUND_GLSL}
void main() {
  // Inside the ground the field is nothing — gas can't occupy solid cells.
  if (solid(vUv)) { gl_FragColor = vec4(0.0); return; }
  vec2 vel = texture2D(u_velocity, vUv).xy;
  vec2 back = vUv - u_dt * vel * u_texel;
  float fade = 1.0;
  if (u_edgeFade > 0.5) {
    vec2 e = min(vUv, 1.0 - vUv);
    fade = smoothstep(0.0, 0.16, e.x) * smoothstep(0.0, 0.16, e.y);
  }
  gl_FragColor = u_dissipation * fade * texture2D(u_src, back);
}
`;

// Inject a Gaussian "splat" of value into the field (additive). For velocity
// u_value is the (u,v) push; for density it's the smoke amount in .x. Scaled by
// thrust each frame from JS.
const FLUID_SPLAT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D u_src;
uniform vec2 u_point;    // inlet, grid texcoords
uniform vec4 u_value;    // amount to add (RG velocity, or R density)
uniform float u_radius;  // splat radius²
uniform float u_aspect;
void main() {
  vec2 d = vUv - u_point;
  d.x *= u_aspect;
  float g = exp(-dot(d, d) / u_radius);
  gl_FragColor = texture2D(u_src, vUv) + u_value * g;
}
`;

// Divergence of the velocity field — the right-hand side of the pressure
// Poisson equation. Central differences; CLAMP_TO_EDGE sampling gives a
// Neumann-ish wall at the borders.
const FLUID_DIVERGENCE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D u_velocity;
uniform float u_texel;
${FLUID_GROUND_GLSL}
void main() {
  vec2 cl = vUv - vec2(u_texel, 0.0);
  vec2 cr = vUv + vec2(u_texel, 0.0);
  vec2 cb = vUv - vec2(0.0, u_texel);
  vec2 ct = vUv + vec2(0.0, u_texel);
  // No-slip wall: a solid neighbour contributes zero velocity, so the divergence
  // spikes where flow is blocked and the pressure solve pushes it sideways.
  float l = solid(cl) ? 0.0 : texture2D(u_velocity, cl).x;
  float r = solid(cr) ? 0.0 : texture2D(u_velocity, cr).x;
  float b = solid(cb) ? 0.0 : texture2D(u_velocity, cb).y;
  float t = solid(ct) ? 0.0 : texture2D(u_velocity, ct).y;
  float div = 0.5 * ((r - l) + (t - b));
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

// One Jacobi iteration of the pressure solve: p = (pL+pR+pB+pT - divergence)/4.
// Run FLUID_PRESSURE_ITERS times, ping-ponging the pressure field.
const FLUID_JACOBI_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D u_pressure;
uniform sampler2D u_divergence;
uniform float u_texel;
${FLUID_GROUND_GLSL}
void main() {
  vec2 cl = vUv - vec2(u_texel, 0.0);
  vec2 cr = vUv + vec2(u_texel, 0.0);
  vec2 cb = vUv - vec2(0.0, u_texel);
  vec2 ct = vUv + vec2(0.0, u_texel);
  float c = texture2D(u_pressure, vUv).x;
  // Neumann at the wall: a solid neighbour mirrors the centre pressure (zero
  // gradient across the wall).
  float l = solid(cl) ? c : texture2D(u_pressure, cl).x;
  float r = solid(cr) ? c : texture2D(u_pressure, cr).x;
  float b = solid(cb) ? c : texture2D(u_pressure, cb).x;
  float t = solid(ct) ? c : texture2D(u_pressure, ct).x;
  float div = texture2D(u_divergence, vUv).x;
  float p = (l + r + b + t - div) * 0.25;
  gl_FragColor = vec4(p, 0.0, 0.0, 1.0);
}
`;

// Make the velocity field divergence-free by subtracting the pressure gradient.
const FLUID_GRADIENT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D u_pressure;
uniform sampler2D u_velocity;
uniform float u_texel;
${FLUID_GROUND_GLSL}
void main() {
  // Inside the wall there is no flow.
  if (solid(vUv)) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 cl = vUv - vec2(u_texel, 0.0);
  vec2 cr = vUv + vec2(u_texel, 0.0);
  vec2 cb = vUv - vec2(0.0, u_texel);
  vec2 ct = vUv + vec2(0.0, u_texel);
  float c = texture2D(u_pressure, vUv).x;
  float l = solid(cl) ? c : texture2D(u_pressure, cl).x;
  float r = solid(cr) ? c : texture2D(u_pressure, cr).x;
  float b = solid(cb) ? c : texture2D(u_pressure, cb).x;
  float t = solid(ct) ? c : texture2D(u_pressure, ct).x;
  vec2 vel = texture2D(u_velocity, vUv).xy;
  vel -= 0.5 * vec2(r - l, t - b);
  gl_FragColor = vec4(vel, 0.0, 1.0);
}
`;

// Colorize the smoke density into an RGBA (premultiplied) buffer for blitting.
// Hot core near the inlet reads yellow-white, cooling to orange/red, then a
// thin grey smoke tail. Alpha tracks density so the plume is translucent.
const FLUID_COLOR_FRAG = `
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

let fluidGfx = null;     // host WEBGL graphics that owns every framebuffer.
                         // Its own (8-bit) canvas holds the final colorized
                         // plume, which is what gets image()'d to the P2D main
                         // canvas — a p5.Framebuffer can't be blitted to P2D.
let fluidFailed = false;
let fluidShaders = {};
let fluidFB = {};        // framebuffers / ping-pong pairs

function makePingPong(opts) {
  return {
    a: fluidGfx.createFramebuffer(opts),
    b: fluidGfx.createFramebuffer(opts),
    swap() { let t = this.a; this.a = this.b; this.b = t; },
  };
}

function initPlumeFluid() {
  if (fluidFailed || fluidGfx) return;
  try {
    fluidGfx = createGraphics(FLUID_GRID, FLUID_GRID, WEBGL);
    fluidGfx.noStroke();

    const floatOpts = {
      width: FLUID_GRID, height: FLUID_GRID,
      format: FLOAT, channels: RGBA,
      textureFiltering: LINEAR, depth: false, antialias: false,
    };
    fluidFB.velocity = makePingPong(floatOpts);
    fluidFB.density = makePingPong(floatOpts);
    fluidFB.pressure = makePingPong(floatOpts);
    fluidFB.divergence = fluidGfx.createFramebuffer(floatOpts);

    fluidShaders.advect = fluidGfx.createShader(FLUID_VERT, FLUID_ADVECT_FRAG);
    fluidShaders.splat = fluidGfx.createShader(FLUID_VERT, FLUID_SPLAT_FRAG);
    fluidShaders.divergence = fluidGfx.createShader(FLUID_VERT, FLUID_DIVERGENCE_FRAG);
    fluidShaders.jacobi = fluidGfx.createShader(FLUID_VERT, FLUID_JACOBI_FRAG);
    fluidShaders.gradient = fluidGfx.createShader(FLUID_VERT, FLUID_GRADIENT_FRAG);
    fluidShaders.color = fluidGfx.createShader(FLUID_VERT, FLUID_COLOR_FRAG);

    // Start from a clean (zero) field.
    clearFluidField();
  } catch (e) {
    console.warn("Fluid plume unavailable (no float framebuffers?), disabling:", e);
    fluidFailed = true;
    fluidGfx = null;
  }
}

function clearFluidField() {
  for (let fb of [fluidFB.velocity.a, fluidFB.velocity.b,
                  fluidFB.density.a, fluidFB.density.b,
                  fluidFB.pressure.a, fluidFB.pressure.b,
                  fluidFB.divergence]) {
    fb.begin();
    fluidGfx.clear();
    fb.end();
  }
}

// Run one shader pass into `target`, sampling whatever uniforms were set. The
// fullscreen quad + projection-independent vert matches clouds.js exactly.
function fluidPass(shader, target, uniforms) {
  fluidGfx.shader(shader);
  for (let k in uniforms) shader.setUniform(k, uniforms[k]);
  target.begin();
  fluidGfx.rect(0, 0, FLUID_GRID, FLUID_GRID);
  target.end();
}

const FLUID_TEXEL = 1.0 / FLUID_GRID;

// Map the world-space ground under the nozzle into the sim's local UV space as a
// half-plane (a point + outward normal). `ground` is built by the game loop:
//   { nozzle:{x,y}, angleDeg, px,py (surface point), nx,ny (outward normal),
//     dist (surface distance from nozzle) }
// The plume quad is drawn with the same translate(nozzle)+rotate(angle) frame
// and spans `worldSize` per UV unit, with the inlet at FLUID_INLET and the flow
// running toward smaller v — so world->UV is: rotate into ship-local, then
// u = 0.5 + localX/worldSize, v = FLUID_INLET.y - localY/worldSize.
function plumeGroundUniforms(ground) {
  const off = { u_groundActive: 0.0, u_groundPoint: [0.0, 0.0], u_groundNormal: [0.0, 1.0] };
  if (!ground) return off;
  let worldSize = DEBUG.fluidPlumeScale;
  // Only engage once the ground is within the plume's reach, else it never
  // touches and we save the branch.
  if (ground.dist > worldSize) return off;

  let c = cos(ground.angleDeg);   // p5 angleMode(DEGREES) — matches localToWorld
  let s = sin(ground.angleDeg);
  // world delta -> ship-local (inverse rotation): Lx = vx*c + vy*s, Ly = -vx*s + vy*c
  let vx = ground.px - ground.nozzle.x;
  let vy = ground.py - ground.nozzle.y;
  let lx = vx * c + vy * s;
  let ly = -vx * s + vy * c;
  let point = [0.5 + lx / worldSize, FLUID_INLET[1] - ly / worldSize];

  // Normal is rotation-only; the UV v-axis is flipped vs local y, so v-component
  // negates. Normalize for the dot-product half-plane test.
  let lnx = ground.nx * c + ground.ny * s;
  let lny = -ground.nx * s + ground.ny * c;
  let ux = lnx, uy = -lny;
  let m = Math.hypot(ux, uy) || 1.0;
  return { u_groundActive: 1.0, u_groundPoint: point, u_groundNormal: [ux / m, uy / m] };
}

// Advance the simulation one step. `thrust` is 0..1 (lander.thrustLevel); the
// inlet only injects while the engine is firing, but the field keeps evolving
// so the tail dissipates naturally after cutoff. `ground` (optional) collides
// the exhaust with the planet surface.
function updatePlumeFluid(thrust, ground) {
  if (!fluidGfx) return;
  let g = plumeGroundUniforms(ground);

  // Every sim pass writes a full-screen quad that must OVERWRITE the target
  // framebuffer, not blend over it. p5's default WEBGL blend is BLEND
  // (source-over); since the density buffer carries alpha 0 (we only use .x),
  // source-over would preserve the old pixels and the field could never decay —
  // it'd fill once and freeze. REPLACE disables blending so each pass replaces.
  fluidGfx.blendMode(REPLACE);

  // 1) Advect velocity through itself. Notable drag (0.97) keeps the
  //    incompressible return flow from building a box-filling recirculation —
  //    only the continuously-injected jet near the inlet stays strong.
  fluidPass(fluidShaders.advect, fluidFB.velocity.b, {
    u_src: fluidFB.velocity.a,
    u_velocity: fluidFB.velocity.a,
    u_texel: FLUID_TEXEL, u_dt: 1.0, u_dissipation: 0.97, u_edgeFade: 0.0, ...g,
  });
  fluidFB.velocity.swap();

  // 2) Inject exhaust momentum + smoke at the inlet while thrusting. Flow runs
  //    "down" the grid (-y); a little lateral jitter keeps it from being a
  //    perfectly straight column.
  if (thrust > 0) {
    let jitter = (Math.random() - 0.5) * 0.5 * thrust;
    fluidPass(fluidShaders.splat, fluidFB.velocity.b, {
      u_src: fluidFB.velocity.a,
      u_point: FLUID_INLET,
      u_value: [jitter, -12.0 * thrust, 0.0, 0.0],
      u_radius: FLUID_INLET_RADIUS, u_aspect: 1.0,
    });
    fluidFB.velocity.swap();

    // Density injection is kept modest so the field doesn't saturate the whole
    // grid white; with ~7.5% per-frame dissipation below, 0.16 settles to a
    // steady-state core near 0.16/(1-0.925) ≈ 2.1 — bright but not a solid box.
    fluidPass(fluidShaders.splat, fluidFB.density.b, {
      u_src: fluidFB.density.a,
      u_point: FLUID_INLET,
      u_value: [0.16 * thrust, 0.0, 0.0, 0.0],
      u_radius: FLUID_INLET_RADIUS, u_aspect: 1.0,
    });
    fluidFB.density.swap();
  }

  // 3) Projection: divergence -> Jacobi pressure solve -> subtract gradient.
  fluidPass(fluidShaders.divergence, fluidFB.divergence, {
    u_velocity: fluidFB.velocity.a, u_texel: FLUID_TEXEL, ...g,
  });

  // Clear pressure before relaxing (zero initial guess).
  fluidFB.pressure.a.begin(); fluidGfx.clear(); fluidFB.pressure.a.end();
  for (let i = 0; i < FLUID_PRESSURE_ITERS; i++) {
    fluidPass(fluidShaders.jacobi, fluidFB.pressure.b, {
      u_pressure: fluidFB.pressure.a,
      u_divergence: fluidFB.divergence,
      u_texel: FLUID_TEXEL, ...g,
    });
    fluidFB.pressure.swap();
  }

  fluidPass(fluidShaders.gradient, fluidFB.velocity.b, {
    u_pressure: fluidFB.pressure.a,
    u_velocity: fluidFB.velocity.a,
    u_texel: FLUID_TEXEL, ...g,
  });
  fluidFB.velocity.swap();

  // 4) Advect the smoke density through the (now divergence-free) velocity.
  //    Heavy dissipation (0.94) caps the steady-state density so the corridor
  //    fades to a tail instead of saturating; edge fade is the outflow sink.
  fluidPass(fluidShaders.advect, fluidFB.density.b, {
    u_src: fluidFB.density.a,
    u_velocity: fluidFB.velocity.a,
    u_texel: FLUID_TEXEL, u_dt: 1.0, u_dissipation: 0.925, u_edgeFade: 1.0, ...g,
  });
  fluidFB.density.swap();

  // 5) Colorize onto fluidGfx's own canvas (NOT a framebuffer) so it can be
  //    image()'d to the P2D main canvas. Same fullscreen idiom as clouds.js.
  fluidGfx.clear();
  fluidGfx.shader(fluidShaders.color);
  fluidShaders.color.setUniform("u_density", fluidFB.density.a);
  fluidGfx.rect(0, 0, FLUID_GRID, FLUID_GRID);
}

// Blit the colorized plume into the (already camera-transformed) world. The
// caller is inside the camera push/translate/rotate/scale, so we work in world
// units: anchor at the nozzle, rotate so the grid's flow axis (down the grid)
// points along the exhaust, and size the quad in world units.
//
// `nozzle` is a world point, `angleDeg` the lander rotation (degrees, p5
// angleMode(DEGREES)), `worldSize` the world-space length of the plume quad.
function drawPlumeFluid(nozzle, angleDeg, worldSize) {
  if (!fluidGfx) return;
  push();
  blendMode(ADD);
  imageMode(CENTER);
  translate(nozzle.x, nozzle.y);
  rotate(angleDeg);
  // The grid's inlet sits near the top (vUv.y≈0.84) and smoke flows toward the
  // bottom. Ship local +y is the exhaust direction, so place the quad below the
  // nozzle by half its size and let the inlet line up with the nozzle.
  image(fluidGfx, 0, worldSize * 0.5, worldSize, worldSize);
  imageMode(CORNER);
  blendMode(BLEND);
  pop();
}

function resizePlumeFluid() {
  // Fixed-resolution sim — nothing to do on window resize. (The composite quad
  // is sized in world units, so it scales with the camera automatically.)
}
