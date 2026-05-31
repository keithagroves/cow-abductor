// Reusable GPU "Stable Fluids" solver (Jos Stam: semi-Lagrangian advection +
// Jacobi pressure projection on float framebuffers). Technique adapted from the
// Godot walkthrough in ../../references.md, ported to the GPU.
//
// A FluidSim owns its own WEBGL graphics, a set of ping-pong float framebuffers,
// and a copy of the physics shaders. Several independent effects (the thruster
// plume, the re-entry burn) each instantiate one. The shaders below are shared
// source — they're compiled per-instance because shaders are bound to a GL
// context. Only the *color* pass differs per effect, so it's passed in.
//
// Each sim runs in its own fixed GRID×GRID local space (NOT world space): forces
// are injected in grid UV coords and the result is blitted to the screen rotated
// to match the real-world flow direction, which sidesteps the moving/rotating
// camera problem a world-space grid would have.

// Fullscreen-quad vertex shader — same idiom as clouds.js/atmosphere.js: override
// gl_Position from the unit quad so the pass is projection-independent, and hand
// the 0..1 texcoord to the fragment shader as the grid coordinate.
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

// Shared obstacle test. The gas collides with the union of an optional
// half-plane (the planet surface, for the plume) and an optional ellipse (the
// hull, for the burn). The JS side maps each shape into the sim's UV space and
// flips the inactive ones off. Cells inside the union are solid wall.
const FLUID_OBSTACLE_GLSL = `
uniform float u_planeActive;     // half-plane (ground) on/off
uniform vec2  u_planePoint;      // a point on the surface, grid UV
uniform vec2  u_planeNormal;     // unit outward normal, grid UV (into the gas)
uniform float u_ellipseActive;   // ellipse (hull) on/off
uniform vec2  u_ellipseCenter;   // ellipse centre, grid UV
uniform vec2  u_ellipseAxis;     // unit local x-axis of the ellipse, grid UV
uniform vec2  u_ellipseRadii;    // (along axis, across axis) radii, grid UV
bool solid(vec2 uv) {
  if (u_planeActive > 0.5 && dot(uv - u_planePoint, u_planeNormal) < 0.0) return true;
  if (u_ellipseActive > 0.5) {
    vec2 d = uv - u_ellipseCenter;
    float x = dot(d, u_ellipseAxis);
    float y = dot(d, vec2(-u_ellipseAxis.y, u_ellipseAxis.x));
    if (x * x / (u_ellipseRadii.x * u_ellipseRadii.x) +
        y * y / (u_ellipseRadii.y * u_ellipseRadii.y) < 1.0) return true;
  }
  return false;
}
`;

// Default "no obstacle" uniform set — spread into a pass's uniforms and then
// override the shape(s) an effect actually uses.
const FLUID_NO_OBSTACLE = {
  u_planeActive: 0.0, u_planePoint: [0.0, 0.0], u_planeNormal: [0.0, 1.0],
  u_ellipseActive: 0.0, u_ellipseCenter: [0.5, 0.5], u_ellipseAxis: [1.0, 0.0],
  u_ellipseRadii: [1.0, 1.0],
};

// Semi-Lagrangian advection: trace the cell back along the velocity field one
// step and resample (bilinear via LINEAR-filtered FBOs). Used for both velocity
// (self-advection) and smoke density, with a dissipation factor so the field
// decays instead of accumulating forever, an optional edge-fade outflow sink,
// and the obstacle (gas cannot occupy solid cells).
const FLUID_ADVECT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D u_src;       // quantity to advect
uniform sampler2D u_velocity;  // velocity field (RG = u,v in cells/step)
uniform float u_texel;         // 1.0 / GRID
uniform float u_dt;
uniform float u_dissipation;
uniform float u_edgeFade;      // >0.5: bleed the quantity to 0 near the borders
                               // (outflow sink). 0 for velocity self-advection.
uniform float u_fadeBand;      // width of the downstream/lateral outflow fade
${FLUID_OBSTACLE_GLSL}
void main() {
  if (solid(vUv)) { gl_FragColor = vec4(0.0); return; }
  vec2 vel = texture2D(u_velocity, vUv).xy;
  vec2 back = vUv - u_dt * vel * u_texel;
  float fade = 1.0;
  if (u_edgeFade > 0.5) {
    // Asymmetric outflow: fade the downstream edge (v=0) and both sides over the
    // wide u_fadeBand so the plume dissolves gradually well inside the grid, but
    // leave the upstream/inlet edge (v=1) essentially untouched so the hot core
    // isn't dimmed — only a hair of fade there to clip stray density at the rim.
    float lat  = smoothstep(0.0, u_fadeBand, min(vUv.x, 1.0 - vUv.x));
    float down = smoothstep(0.0, u_fadeBand, vUv.y);
    float up   = smoothstep(0.0, 0.04, 1.0 - vUv.y);
    fade = lat * down * up;
  }
  gl_FragColor = u_dissipation * fade * texture2D(u_src, back);
}
`;

// Inject a Gaussian splat of value into the field (additive). For velocity
// u_value is the (u,v) push; for density it's the smoke amount in .x.
const FLUID_SPLAT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D u_src;
uniform vec2 u_point;    // splat centre, grid UV
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

// Divergence of the velocity field — RHS of the pressure Poisson equation. A
// solid neighbour contributes zero velocity (no-slip wall), so divergence spikes
// where flow is blocked and the pressure solve pushes it sideways.
const FLUID_DIVERGENCE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D u_velocity;
uniform float u_texel;
${FLUID_OBSTACLE_GLSL}
void main() {
  vec2 cl = vUv - vec2(u_texel, 0.0);
  vec2 cr = vUv + vec2(u_texel, 0.0);
  vec2 cb = vUv - vec2(0.0, u_texel);
  vec2 ct = vUv + vec2(0.0, u_texel);
  float l = solid(cl) ? 0.0 : texture2D(u_velocity, cl).x;
  float r = solid(cr) ? 0.0 : texture2D(u_velocity, cr).x;
  float b = solid(cb) ? 0.0 : texture2D(u_velocity, cb).y;
  float t = solid(ct) ? 0.0 : texture2D(u_velocity, ct).y;
  float div = 0.5 * ((r - l) + (t - b));
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

// One Jacobi iteration of the pressure solve: p = (pL+pR+pB+pT - div)/4. A solid
// neighbour mirrors the centre pressure (Neumann / zero gradient across wall).
const FLUID_JACOBI_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D u_pressure;
uniform sampler2D u_divergence;
uniform float u_texel;
${FLUID_OBSTACLE_GLSL}
void main() {
  vec2 cl = vUv - vec2(u_texel, 0.0);
  vec2 cr = vUv + vec2(u_texel, 0.0);
  vec2 cb = vUv - vec2(0.0, u_texel);
  vec2 ct = vUv + vec2(0.0, u_texel);
  float c = texture2D(u_pressure, vUv).x;
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
// Inside the wall there is no flow.
const FLUID_GRADIENT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D u_pressure;
uniform sampler2D u_velocity;
uniform float u_texel;
${FLUID_OBSTACLE_GLSL}
void main() {
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

// One Eulerian fluid field on the GPU. Construct with a grid size, pressure
// iteration count, and the effect's color fragment shader (which reads
// `u_density` and writes a premultiplied RGBA plume color).
class FluidSim {
  constructor({ grid = 128, pressureIters = 40, colorFrag }) {
    this.grid = grid;
    this.pressureIters = pressureIters;
    this.colorFrag = colorFrag;
    this.texel = 1.0 / grid;
    this.gfx = null;          // host WEBGL graphics; its 8-bit canvas holds the
                              // final colorized field for blitting (a float
                              // p5.Framebuffer can't be image()'d onto P2D).
    this.failed = false;
    this.shaders = {};
    this.fb = {};
  }

  _makePingPong(opts) {
    return {
      a: this.gfx.createFramebuffer(opts),
      b: this.gfx.createFramebuffer(opts),
      swap() { let t = this.a; this.a = this.b; this.b = t; },
    };
  }

  // Create the graphics, framebuffers and shaders. Returns false (and disables
  // the sim) if float framebuffers aren't available.
  init() {
    if (this.failed || this.gfx) return !this.failed;
    try {
      this.gfx = createGraphics(this.grid, this.grid, WEBGL);
      this.gfx.noStroke();
      const opts = {
        width: this.grid, height: this.grid,
        format: FLOAT, channels: RGBA,
        textureFiltering: LINEAR, depth: false, antialias: false,
      };
      this.fb.velocity = this._makePingPong(opts);
      this.fb.density = this._makePingPong(opts);
      this.fb.pressure = this._makePingPong(opts);
      this.fb.divergence = this.gfx.createFramebuffer(opts);

      this.shaders.advect = this.gfx.createShader(FLUID_VERT, FLUID_ADVECT_FRAG);
      this.shaders.splat = this.gfx.createShader(FLUID_VERT, FLUID_SPLAT_FRAG);
      this.shaders.divergence = this.gfx.createShader(FLUID_VERT, FLUID_DIVERGENCE_FRAG);
      this.shaders.jacobi = this.gfx.createShader(FLUID_VERT, FLUID_JACOBI_FRAG);
      this.shaders.gradient = this.gfx.createShader(FLUID_VERT, FLUID_GRADIENT_FRAG);
      this.shaders.color = this.gfx.createShader(FLUID_VERT, this.colorFrag);

      this.clearField();
      return true;
    } catch (e) {
      console.warn("FluidSim unavailable (no float framebuffers?), disabling:", e);
      this.failed = true;
      this.gfx = null;
      return false;
    }
  }

  get ready() { return !!this.gfx; }

  clearField() {
    for (let fb of [this.fb.velocity.a, this.fb.velocity.b,
                    this.fb.density.a, this.fb.density.b,
                    this.fb.pressure.a, this.fb.pressure.b,
                    this.fb.divergence]) {
      fb.begin();
      this.gfx.clear();
      fb.end();
    }
  }

  // Run one shader pass into `target`. Every sim pass must OVERWRITE its target,
  // not blend over it — p5's default WEBGL blend is source-over, and the fields
  // carry alpha 0, so blending would preserve old pixels and freeze the sim.
  pass(shader, target, uniforms) {
    this.gfx.blendMode(REPLACE);
    this.gfx.shader(shader);
    for (let k in uniforms) shader.setUniform(k, uniforms[k]);
    target.begin();
    this.gfx.rect(0, 0, this.grid, this.grid);
    target.end();
  }

  advectVelocity(dissipation, obs) {
    this.pass(this.shaders.advect, this.fb.velocity.b, {
      u_src: this.fb.velocity.a, u_velocity: this.fb.velocity.a,
      u_texel: this.texel, u_dt: 1.0, u_dissipation: dissipation, u_edgeFade: 0.0,
      u_fadeBand: 0.16,
      ...obs,
    });
    this.fb.velocity.swap();
  }

  splatVelocity(point, value, radius, aspect = 1.0) {
    this.pass(this.shaders.splat, this.fb.velocity.b, {
      u_src: this.fb.velocity.a, u_point: point, u_value: value,
      u_radius: radius, u_aspect: aspect,
    });
    this.fb.velocity.swap();
  }

  splatDensity(point, value, radius, aspect = 1.0) {
    this.pass(this.shaders.splat, this.fb.density.b, {
      u_src: this.fb.density.a, u_point: point, u_value: value,
      u_radius: radius, u_aspect: aspect,
    });
    this.fb.density.swap();
  }

  // Projection: divergence -> Jacobi pressure solve (zero initial guess) ->
  // subtract gradient, leaving the velocity field divergence-free.
  project(obs) {
    this.pass(this.shaders.divergence, this.fb.divergence, {
      u_velocity: this.fb.velocity.a, u_texel: this.texel, ...obs,
    });
    this.fb.pressure.a.begin(); this.gfx.clear(); this.fb.pressure.a.end();
    for (let i = 0; i < this.pressureIters; i++) {
      this.pass(this.shaders.jacobi, this.fb.pressure.b, {
        u_pressure: this.fb.pressure.a, u_divergence: this.fb.divergence,
        u_texel: this.texel, ...obs,
      });
      this.fb.pressure.swap();
    }
    this.pass(this.shaders.gradient, this.fb.velocity.b, {
      u_pressure: this.fb.pressure.a, u_velocity: this.fb.velocity.a,
      u_texel: this.texel, ...obs,
    });
    this.fb.velocity.swap();
  }

  advectDensity(dissipation, edgeFade, obs, fadeBand = 0.16) {
    this.pass(this.shaders.advect, this.fb.density.b, {
      u_src: this.fb.density.a, u_velocity: this.fb.velocity.a,
      u_texel: this.texel, u_dt: 1.0, u_dissipation: dissipation, u_edgeFade: edgeFade,
      u_fadeBand: fadeBand,
      ...obs,
    });
    this.fb.density.swap();
  }

  // Colorize the density onto the host canvas (NOT a framebuffer) so it can be
  // image()'d onto the P2D main canvas.
  colorize(extraUniforms = {}) {
    this.gfx.blendMode(REPLACE);
    this.gfx.clear();
    this.gfx.shader(this.shaders.color);
    this.shaders.color.setUniform("u_density", this.fb.density.a);
    for (let k in extraUniforms) this.shaders.color.setUniform(k, extraUniforms[k]);
    this.gfx.rect(0, 0, this.grid, this.grid);
  }
}
