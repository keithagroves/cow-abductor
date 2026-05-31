// Procedural "alien tech" ship — an experimental shader-rendered hull that
// replaces the vector drawShipBody when DEBUG.shaderShip is on. Like the other
// shader effects (atmosphere, clouds, fluids) it renders to its own WEBGL
// graphics buffer and is blitted onto the P2D main canvas; the lander composites
// it inside its own translate/scale/rotate frame so it tracks the ship.
//
// The hull is a 2D signed-distance field; faux-3D normals are recovered from the
// SDF gradient + a beveled edge so flat vector space reads as a lit metallic
// volume. On top: sun-direction lighting, a fresnel rim, pulsing energy core and
// veins, a glowing cockpit, heat-reactive emissive (shared with the re-entry
// burn via lander.heat), and engine glow that tracks thrust.

const SHIP_DRAW_SIZE = 122;  // local-space size of the blit quad (pre-scale).
                             // Larger than the hull itself — the shader fills
                             // only the central ~70%, the rest is margin/halo.
const SHIP_DRAW_CY = -6;     // local-y centre offset so the hull sits on origin
const SHIP_BUFFER_RES = 256; // shader buffer resolution

const SHIP_VERT = `
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

const SHIP_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float u_time;
uniform float u_heat;    // 0..1 hull heat (re-entry)
uniform float u_thrust;  // 0..1 engine throttle
uniform vec2  u_sunDir;  // unit sun direction in ship space (p.y up = nose)
uniform float u_beam;    // 0..1 tractor-beam activity (drives the energy pulse)
uniform float u_power;   // 0..1 reactor power (fuel) — 0 darkens all the glow

float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdSeg(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Signed distance to the hull (negative inside). p in [-1,1], p.y up = nose.
float shipSDF(vec2 p) {
  vec2 q = vec2(abs(p.x), p.y);                  // mirror across the spine
  // Fuselage: a vertical lens, narrow in x.
  float fus = sdCircle(vec2(p.x * 2.0, (p.y - 0.02) * 0.92), 0.5);
  // Nose spike.
  fus = smin(fus, sdSeg(p, vec2(0.0, 0.2), vec2(0.0, 0.86), 0.05), 0.18);
  // Wider engine block at the tail.
  fus = smin(fus, sdCircle(vec2(p.x * 1.5, p.y + 0.52), 0.17), 0.15);
  // Swept-back wings.
  float wing = sdSeg(q, vec2(0.05, 0.08), vec2(0.82, -0.52), 0.055);
  wing = smin(wing, sdSeg(q, vec2(0.45, -0.16), vec2(0.86, -0.54), 0.035), 0.1);
  return smin(fus, wing, 0.11);
}

void main() {
  // Divide by the fill factor so the hull only occupies the central ~70% of the
  // buffer, leaving a transparent margin for the rim/halo so nothing clips on
  // the quad edge.
  vec2 p = (vUv - 0.5) * 2.0 / 0.7;
  float d = shipSDF(p);

  // SDF gradient -> in-plane normal direction.
  float e = 0.004;
  float dx = shipSDF(p + vec2(e, 0.0)) - shipSDF(p - vec2(e, 0.0));
  float dy = shipSDF(p + vec2(0.0, e)) - shipSDF(p - vec2(0.0, e));
  vec2 g = vec2(dx, dy) / (2.0 * e);

  float aa = 2.5 / float(${SHIP_BUFFER_RES});
  float mask = smoothstep(aa, -aa, d);          // 1 inside the hull

  // Beveled normal: tilt outward near the edge, flat (up) in the interior.
  float bevel = smoothstep(0.0, 0.17, -d);
  vec2 nxy = -normalize(g + 1e-5) * (1.0 - bevel);
  float nz = sqrt(clamp(1.0 - dot(nxy, nxy), 0.0, 1.0));
  vec3 N = vec3(nxy, nz);

  vec3 L = normalize(vec3(u_sunDir, 0.55));
  float diff = clamp(dot(N, L), 0.0, 1.0);
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 42.0);
  float fres = pow(1.0 - nz, 3.0);

  // Dark alien metal, lighter on the beveled crown.
  vec3 albedo = mix(vec3(0.04, 0.08, 0.11), vec3(0.10, 0.17, 0.21), bevel);
  vec3 col = albedo * (0.22 + 0.95 * diff) + spec * vec3(0.85, 0.97, 1.0);

  // Cyan fresnel rim — the glow outlining the hull. Dies with reactor power.
  vec3 rimCol = vec3(0.2, 0.9, 1.0);
  col += fres * rimCol * 1.15 * u_power;

  // Energy core: a calm steady glow at rest, a strong pulse only while beaming.
  float corePulse = mix(0.55, 0.6 + 0.4 * sin(u_time * 5.0), u_beam);
  float core = smoothstep(0.14, 0.0, sdCircle(p - vec2(0.0, -0.02), 0.13)) * corePulse;
  // Energy veins to the wingtips: dim and steady at rest, a travelling pulse
  // that races outward while the tractor beam is active.
  vec2 q = vec2(abs(p.x), p.y);
  float vein = smoothstep(0.02, 0.0, sdSeg(q, vec2(0.0, -0.02), vec2(0.72, -0.46), 0.014));
  float travel = 0.5 + 0.5 * sin(u_time * 7.0 - q.x * 9.0);
  vein *= mix(0.35, travel, u_beam);
  vec3 energy = vec3(0.3, 1.0, 0.9);
  col += (core * 1.5 + vein * 0.8) * energy * u_power;

  // Glowing cockpit near the nose.
  float cock = smoothstep(0.09, 0.0, sdCircle(p - vec2(0.0, 0.36), 0.085));
  col += cock * vec3(0.55, 1.0, 0.85) * 1.3 * u_power;

  // Re-entry heat: push the hull toward molten orange and fire the rim.
  vec3 hot = vec3(1.0, 0.35, 0.1);
  col = mix(col, col * 0.4 + hot * (0.8 + 0.5 * diff), u_heat * 0.85);
  col += u_heat * fres * hot * 1.6;

  // Engine glow at the tail, tracking thrust.
  float eng = smoothstep(0.32, 0.0, length(p - vec2(0.0, -0.56)));
  col += eng * u_thrust * vec3(0.5, 0.8, 1.0) * 1.5;

  // Soft outer glow just beyond the hull (rim/heat bleed) for a halo. The cyan
  // rim bleed dies with power; the heat bleed stays (friction, not the reactor).
  float outGlow = smoothstep(0.32, 0.0, d) * (1.0 - mask);
  vec3 haloCol = mix(rimCol * u_power, hot, u_heat);
  col += outGlow * haloCol * 0.3;

  // Halo only contributes alpha when there's glow to show (power or heat), so a
  // powered-down, cool ship has no dark halo ring around it.
  float haloA = outGlow * 0.45 * max(u_power, u_heat);
  float alpha = max(mask, haloA);
  // Premultiplied: p5's WEBGL canvas uses premultiplied alpha, so empty pixels
  // must be truly black (col*0) or the rim/fresnel color bleeds across the whole
  // quad as a solid box.
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

let shipGfx = null;
let shipShader = null;
let shipShaderFailed = false;
let shipBeamGlow = 0;  // eased 0..1 beam-active value so the pulse ramps smoothly
let shipPowerGlow = 1; // eased 0..1 reactor power so the glow fades out on empty

function initShipShader() {
  if (shipShaderFailed || shipGfx) return;
  try {
    shipGfx = createGraphics(SHIP_BUFFER_RES, SHIP_BUFFER_RES, WEBGL);
    shipGfx.noStroke();
    shipShader = shipGfx.createShader(SHIP_VERT, SHIP_FRAG);
  } catch (err) {
    console.warn("Ship shader unavailable, falling back to vector hull:", err);
    shipShaderFailed = true;
    shipGfx = null;
  }
}

// Direction to the sun in the ship's local frame, mapped into shader p-space
// (p.y up = nose). Falls back to an over-the-shoulder key light if no sun.
function shipSunDirLocal(lander) {
  let wx = 0.4, wy = -0.7; // default: light from upper area in world space
  if (typeof planets !== "undefined") {
    let sun = planets.find((p) => p.isSun);
    if (sun) {
      wx = sun.center.x - lander.pos.x;
      wy = sun.center.y - lander.pos.y;
    }
  }
  let m = Math.hypot(wx, wy) || 1;
  wx /= m; wy /= m;
  let c = cos(lander.rotation), s = sin(lander.rotation); // p5 DEGREES
  let lx = wx * c + wy * s;       // world -> ship-local (inverse rotation)
  let ly = -wx * s + wy * c;
  return [lx, -ly];               // ship-local -> shader p-space (p.y up = -local y)
}

// Render the hull into shipGfx for the given heat (0..1) and thrust (0..1). The
// caller blits shipGfx; nothing here touches the main canvas.
function renderShipShader(heatRatio, thrust, sunDir, beam, power) {
  if (!shipGfx) return;
  // Ease toward the beam/power targets so the pulse and the power-down glow fade.
  shipBeamGlow += ((beam ? 1 : 0) - shipBeamGlow) * 0.15;
  shipPowerGlow += ((power ? 1 : 0) - shipPowerGlow) * 0.08;
  shipGfx.clear();
  shipGfx.shader(shipShader);
  shipShader.setUniform("u_time", frameCount * 0.05);
  shipShader.setUniform("u_heat", constrain(heatRatio, 0, 1));
  shipShader.setUniform("u_thrust", constrain(thrust || 0, 0, 1));
  shipShader.setUniform("u_sunDir", sunDir);
  shipShader.setUniform("u_beam", shipBeamGlow);
  shipShader.setUniform("u_power", shipPowerGlow);
  shipGfx.rect(0, 0, SHIP_BUFFER_RES, SHIP_BUFFER_RES);
}
