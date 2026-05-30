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
const FLUID_PRESSURE_ITERS = 24; // Jacobi relaxation passes per frame
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
void main() {
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
void main() {
  float l = texture2D(u_velocity, vUv - vec2(u_texel, 0.0)).x;
  float r = texture2D(u_velocity, vUv + vec2(u_texel, 0.0)).x;
  float b = texture2D(u_velocity, vUv - vec2(0.0, u_texel)).y;
  float t = texture2D(u_velocity, vUv + vec2(0.0, u_texel)).y;
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
void main() {
  float l = texture2D(u_pressure, vUv - vec2(u_texel, 0.0)).x;
  float r = texture2D(u_pressure, vUv + vec2(u_texel, 0.0)).x;
  float b = texture2D(u_pressure, vUv - vec2(0.0, u_texel)).x;
  float t = texture2D(u_pressure, vUv + vec2(0.0, u_texel)).x;
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
void main() {
  float l = texture2D(u_pressure, vUv - vec2(u_texel, 0.0)).x;
  float r = texture2D(u_pressure, vUv + vec2(u_texel, 0.0)).x;
  float b = texture2D(u_pressure, vUv - vec2(0.0, u_texel)).x;
  float t = texture2D(u_pressure, vUv + vec2(0.0, u_texel)).x;
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
  float alpha = clamp(d * 0.85, 0.0, 1.0) * edge;
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

// Advance the simulation one step. `thrust` is 0..1 (lander.thrustLevel); the
// inlet only injects while the engine is firing, but the field keeps evolving
// so the tail dissipates naturally after cutoff.
function updatePlumeFluid(thrust) {
  if (!fluidGfx) return;

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
    u_texel: FLUID_TEXEL, u_dt: 1.0, u_dissipation: 0.97, u_edgeFade: 0.0,
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

    // Density injection is deliberately small: with ~6% per-frame dissipation
    // below, an inject of 0.10 settles to a steady-state core density near
    // 0.10/(1-0.94) ≈ 1.7 instead of saturating the whole grid white.
    fluidPass(fluidShaders.splat, fluidFB.density.b, {
      u_src: fluidFB.density.a,
      u_point: FLUID_INLET,
      u_value: [0.10 * thrust, 0.0, 0.0, 0.0],
      u_radius: FLUID_INLET_RADIUS, u_aspect: 1.0,
    });
    fluidFB.density.swap();
  }

  // 3) Projection: divergence -> Jacobi pressure solve -> subtract gradient.
  fluidPass(fluidShaders.divergence, fluidFB.divergence, {
    u_velocity: fluidFB.velocity.a, u_texel: FLUID_TEXEL,
  });

  // Clear pressure before relaxing (zero initial guess).
  fluidFB.pressure.a.begin(); fluidGfx.clear(); fluidFB.pressure.a.end();
  for (let i = 0; i < FLUID_PRESSURE_ITERS; i++) {
    fluidPass(fluidShaders.jacobi, fluidFB.pressure.b, {
      u_pressure: fluidFB.pressure.a,
      u_divergence: fluidFB.divergence,
      u_texel: FLUID_TEXEL,
    });
    fluidFB.pressure.swap();
  }

  fluidPass(fluidShaders.gradient, fluidFB.velocity.b, {
    u_pressure: fluidFB.pressure.a,
    u_velocity: fluidFB.velocity.a,
    u_texel: FLUID_TEXEL,
  });
  fluidFB.velocity.swap();

  // 4) Advect the smoke density through the (now divergence-free) velocity.
  //    Heavy dissipation (0.94) caps the steady-state density so the corridor
  //    fades to a tail instead of saturating; edge fade is the outflow sink.
  fluidPass(fluidShaders.advect, fluidFB.density.b, {
    u_src: fluidFB.density.a,
    u_velocity: fluidFB.velocity.a,
    u_texel: FLUID_TEXEL, u_dt: 1.0, u_dissipation: 0.925, u_edgeFade: 1.0,
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
