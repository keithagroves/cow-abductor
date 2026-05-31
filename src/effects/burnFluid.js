// GPU fluid re-entry burn — the shock/wake of plasma that forms when the lander
// tears through atmosphere at speed. Built on the reusable FluidSim solver in
// fluidSim.js, the sibling of the thruster plume in plumeFluid.js.
//
// Unlike the plume (which emits from a fixed nozzle along the ship's axis), the
// burn is a WAKE aligned with the ship's velocity relative to the air: the heat
// forms on the windward/leading side and trails downwind regardless of which way
// the ship points. So the grid is centred on the ship and rotated to the
// relative-velocity vector, the hull is fed in as an ellipse obstacle so the
// flow wraps around it, and a broad hot front is injected on the leading side
// with strength = atmosphericDensity × excessSpeed (the same signal that drives
// hull heating in updateBurnParticles).
//
// Gated behind DEBUG.fluidBurn; degrades to nothing without float framebuffers.

const BURN_INLET = [0.5, 0.72];     // broad hot front, just ahead of the hull
const BURN_INLET_RADIUS = 0.012;    // Gaussian splat radius² scale
const BURN_INTENSITY_SCALE = 0.5;   // maps raw (density×speed) intensity -> 0..1
                                    // (a typical dive intensity ~3 saturates it)

// Plasma color ramp: cool smoky wake -> orange -> white-hot leading edge. Heat
// rises toward the front (high v) and with density.
const BURN_COLOR_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D u_density;
void main() {
  float d = clamp(texture2D(u_density, vUv).x, 0.0, 2.0);
  float heat = clamp(d * 1.4, 0.0, 1.0) * smoothstep(0.08, 0.7, vUv.y);
  vec3 smoke = vec3(0.5, 0.28, 0.22);
  vec3 ember = vec3(1.0, 0.42, 0.12);
  vec3 hot   = vec3(1.0, 0.96, 0.88);
  vec3 col = mix(smoke, ember, smoothstep(0.0, 0.5, heat));
  col = mix(col, hot, smoothstep(0.6, 1.0, heat));
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.0, 0.22, e.x) * smoothstep(0.0, 0.22, e.y);
  float alpha = clamp(d * 1.6, 0.0, 1.0) * edge;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

let burnSim = null;

function initBurnFluid() {
  if (burnSim) return;
  burnSim = new FluidSim({ grid: 128, pressureIters: 40, colorFrag: BURN_COLOR_FRAG });
  burnSim.init();
}

// Blit angle (degrees) so the grid's downstream axis (local +y) points along the
// wake, i.e. opposite the relative-velocity direction. With local +y mapping to
// world R(θ)(0,1) = (-sinθ, cosθ), we need that to equal -vHat, so sinθ = vHat.x
// and cosθ = -vHat.y → θ = atan2(vHat.x, -vHat.y).
function burnBlitAngle(state) {
  if (!state || state.relSpeed < 1e-4) return 0;
  let vhx = state.relVx / state.relSpeed;
  let vhy = state.relVy / state.relSpeed;
  return atan2(vhx, -vhy); // p5 angleMode(DEGREES)
}

// Hull ellipse obstacle in grid UV: centred on the ship, its long axis along the
// ship's body, sized from the hull silhouette (~22×17 half-extents × scale).
function burnObstacle(state, worldSize, blitAngleDeg) {
  let obs = { ...FLUID_NO_OBSTACLE };
  if (!state) return obs;
  let halfLen = 22 * state.scale;
  let halfWid = 17 * state.scale;
  // Ship long axis (local +y, nose->tail) in world, then rotated into the grid
  // frame (inverse blit) and flipped onto the UV v-axis.
  let ax = -sin(state.rotationDeg), ay = cos(state.rotationDeg);
  let c = cos(blitAngleDeg), s = sin(blitAngleDeg);
  let lx = ax * c + ay * s;
  let ly = -ax * s + ay * c;
  let ux = lx, uy = -ly;
  let m = Math.hypot(ux, uy) || 1.0;
  obs.u_ellipseActive = 1.0;
  obs.u_ellipseCenter = [0.5, 0.5];
  obs.u_ellipseAxis = [ux / m, uy / m];
  obs.u_ellipseRadii = [halfLen / worldSize, halfWid / worldSize];
  return obs;
}

// Step the sim one frame. `state` (from getBurnState in sketch.js) is null when
// the ship is gone; otherwise it carries the relative velocity, burn intensity,
// and ship pose. The field keeps evolving with no injection so the wake fades.
function updateBurnFluid(state) {
  if (!burnSim || !burnSim.ready) return;
  let worldSize = DEBUG.fluidBurnScale;
  let blit = burnBlitAngle(state);
  let obs = burnObstacle(state, worldSize, blit);

  burnSim.advectVelocity(0.95, obs);

  if (state && state.intensity > 0 && state.relSpeed > 1e-3) {
    let strength = Math.min(state.intensity * BURN_INTENSITY_SCALE, 1.0);
    let jitter = (Math.random() - 0.5) * 0.6 * strength;
    // Gentle wind + strong decay below: the gas forms a bright shock and then
    // dissolves on its own well before it reaches the grid edge, so there's no
    // density left to draw a rectangle border.
    let windV = 6.0 + 4.0 * strength;
    burnSim.splatVelocity(BURN_INLET, [jitter, -windV, 0.0, 0.0], BURN_INLET_RADIUS, 0.6);
    burnSim.splatDensity(BURN_INLET, [0.4 * strength, 0.0, 0.0, 0.0], BURN_INLET_RADIUS, 0.6);
  }

  burnSim.project(obs);
  // Strong decay (10%/frame) so the wake dissolves mid-grid, not at the border;
  // wide (0.22) asymmetric outflow fade keeps the downstream edge invisible.
  burnSim.advectDensity(0.90, 1.0, obs, 0.22);
  burnSim.colorize();
}

// Composite the wake into the world: centred on the ship, rotated so the grid
// downstream axis points along the wake, sized in world units.
function drawBurnFluid(state) {
  if (!burnSim || !burnSim.ready || !state) return;
  let worldSize = DEBUG.fluidBurnScale;
  let blit = burnBlitAngle(state);
  push();
  blendMode(ADD);
  imageMode(CENTER);
  translate(state.center.x, state.center.y);
  rotate(blit);
  image(burnSim.gfx, 0, 0, worldSize, worldSize);
  imageMode(CORNER);
  blendMode(BLEND);
  pop();
}

function resizeBurnFluid() {
  // Fixed-resolution sim — nothing to do; the composite quad is world-sized.
}
