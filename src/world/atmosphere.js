// Per-planet atmosphere shader. A deliberately simple 2D model: for each
// screen pixel we find the planet it falls over (in world space, via the
// camera transform from sketch.js) and shade the slab between baseRadius and
// the outer edge. The glow lives in a Gaussian band floating at altitude
// BAND_CENTER, so it reads as a bright arc — part of the big circle girdling
// the planet — that the ship flies up through and leaves floating in black
// space as it climbs. The lit band reads blue; warm orange appears only at the
// sunset terminator. No raymarching or physical scattering; just a floating
// band shaded by the sun direction.

const ATMO_MAX_PLANETS = 10;

const ATMO_VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  vec4 p = vec4(aPosition, 1.0);
  p.xy = p.xy * 2.0 - 1.0;
  gl_Position = p;
}
`;

const ATMO_FRAG = `
precision highp float;

#define MAX_PLANETS 10

varying vec2 vTexCoord;
uniform vec2 u_resolution;
uniform vec2 u_viewFocus;     // world point pinned to screen center
uniform vec2 u_screenCenter;  // pixel coords of that pin
uniform float u_viewScale;
uniform float u_viewRotation; // radians, matches sketch.js camera roll
uniform int u_planetCount;
uniform vec2 u_planetPos[MAX_PLANETS];
uniform float u_planetRadius[MAX_PLANETS];
uniform float u_atmoRadius[MAX_PLANETS];
uniform vec3 u_atmoColor[MAX_PLANETS];
uniform vec2 u_sunPos;
uniform float u_time;

// Aerial-perspective limb model (the Shuttle-photo look): the atmosphere is
// densest at the surface and fades into black space with altitude, and its
// color is stratified by altitude — warm orange low down, grading to the
// planet's blue higher up. Seen edge-on at the limb this reads as the classic
// dark-orange → blue → black banding.
const float BAND_CENTER = 0.50;  // altitude of the glowing band (0=surface,1=top)
const float BAND_WIDTH  = 0.22;  // band thickness — the arc you fly up through
const vec3  WARM_COLOR  = vec3(1.0, 0.5, 0.22); // sunset-rim orange
const float BRIGHTNESS  = 1.9;
const float SUNSET_K    = 0.8;   // sunset orange strength at the terminator
const float HAZE_K      = 0.18;  // slight paleness of the band
const float NIGHT_FLOOR = 0.12;  // dark side dims to this, never to black

void main() {
  // p5 P2D canvas is y-down; vTexCoord.y from the WEBGL buffer is y-up, and
  // image() doesn't flip on blit. Flip Y here so the pixel coords match the
  // world point sketch.js drew the planets at.
  vec2 pixel = vec2(vTexCoord.x * u_resolution.x,
                    (1.0 - vTexCoord.y) * u_resolution.y);
  // Inverse of the sketch.js camera transform: center → unrotate → unscale → +focus.
  vec2 centered = pixel - u_screenCenter;
  float c = cos(-u_viewRotation);
  float s = sin(-u_viewRotation);
  vec2 unrot = vec2(c * centered.x - s * centered.y, s * centered.x + c * centered.y);
  vec2 world = unrot / u_viewScale + u_viewFocus;

  vec3 accum = vec3(0.0);

  for (int i = 0; i < MAX_PLANETS; i++) {
    if (i >= u_planetCount) break;
    vec2 pc = u_planetPos[i];
    vec2 d = world - pc;
    float r  = u_planetRadius[i];
    float ra = u_atmoRadius[i];
    float dist = length(d);
    if (dist >= ra || dist <= r) continue;

    // Altitude 0 (surface) .. 1 (outer edge).
    float h = (dist - r) / max(ra - r, 0.0001);
    // A glowing band floating at altitude BAND_CENTER, fading to ~0 both above
    // and below. It reads as a bright arc — part of the huge circle girdling
    // the planet — that you fly up through; climb past it and the arc floats
    // off into the black space below.
    float band = exp(-pow((h - BAND_CENTER) / BAND_WIDTH, 2.0));

    // Sun direction, slowly rotated so the terminator drifts (cosmetic day
    // cycle; matches the clouds' rotation).
    vec2 outward = d / max(dist, 0.0001);
    vec2 toSunRaw = normalize(u_sunPos - pc);
    float a = u_time * 0.005;
    vec2 toSun = vec2(cos(a) * toSunRaw.x - sin(a) * toSunRaw.y,
                      sin(a) * toSunRaw.x + cos(a) * toSunRaw.y);
    float sunDot = dot(outward, toSun);

    // One smoothstep across the terminator → soft day/night, no abrupt line.
    float day = smoothstep(-0.25, 0.3, sunDot);
    // Warmth that peaks right at the terminator, on the lit side only.
    float sunset = exp(-sunDot * sunDot * 7.0) * day;

    // Blue band (slightly pale); warm orange only at the sunset terminator.
    vec3 skyCol = mix(u_atmoColor[i], vec3(1.0), HAZE_K);
    vec3 litColor = mix(skyCol, WARM_COLOR, clamp(sunset * SUNSET_K, 0.0, 1.0));

    // Day side is the lit band; night side keeps a faint same-hue glow.
    vec3 col = mix(u_atmoColor[i] * NIGHT_FLOOR, litColor, day);

    accum += col * band * BRIGHTNESS;
  }

  // Soft rolloff so nothing hard-clips to flat white.
  accum = vec3(1.0) - exp(-accum);
  gl_FragColor = vec4(accum, 1.0);
}
`;

let atmoBuffer = null;
let atmoShader = null;
let atmoFailed = false;

function initAtmosphere() {
  if (atmoFailed) return;
  try {
    atmoBuffer = createGraphics(width, height, WEBGL);
    atmoBuffer.noStroke();
    atmoShader = atmoBuffer.createShader(ATMO_VERT, ATMO_FRAG);
  } catch (e) {
    console.warn("Atmosphere shader unavailable, falling back to plain draw:", e);
    atmoBuffer = null;
    atmoShader = null;
    atmoFailed = true;
  }
}

function resizeAtmosphere() {
  if (!atmoBuffer) return;
  if (atmoBuffer.width !== width || atmoBuffer.height !== height) {
    atmoBuffer.resizeCanvas(width, height);
  }
}

function planetSkyColor(planet) {
  // Bias the planet's own tint toward a sky color. Each planet gets a slightly
  // different atmosphere hue this way, but they all read as "sky."
  let c = planet.strokeColor;
  let r = constrain((red(c) * 0.35 + 70) / 255, 0, 1);
  let g = constrain((green(c) * 0.4 + 130) / 255, 0, 1);
  let b = constrain((blue(c) * 0.5 + 200) / 255, 0, 1);
  return [r, g, b];
}

function drawAtmosphere() {
  if (!atmoBuffer || !atmoShader) return;
  resizeAtmosphere();

  let positions = [];
  let radii = [];
  let atmoRadii = [];
  let colors = [];
  let count = 0;
  let sunPos = [10000, -100];

  for (let p of planets) {
    if (p.isSun) sunPos = [p.center.x, p.center.y];
  }

  for (let p of planets) {
    if (count >= ATMO_MAX_PLANETS) break;
    if (p.isSun) continue;
    if (!p.hasAtmosphere || !p.hasAtmosphere()) continue;
    positions.push(p.center.x, p.center.y);
    // Inner edge at baseRadius (the planet's baseline before mountains).
    // The planet polygon draws on top of the atmosphere, so peaks naturally
    // mask the band where they rise — but in valleys the sky reaches all
    // the way down to the surface instead of stopping at peak altitude.
    radii.push(p.baseRadius);
    atmoRadii.push(p.atmosphereOuterRadius());
    let sky = planetSkyColor(p);
    colors.push(sky[0], sky[1], sky[2]);
    count++;
  }

  while (positions.length / 2 < ATMO_MAX_PLANETS) {
    positions.push(0, 0);
    radii.push(0);
    atmoRadii.push(0);
    colors.push(0, 0, 0);
  }

  atmoBuffer.clear();
  atmoBuffer.shader(atmoShader);
  atmoShader.setUniform("u_resolution", [width, height]);
  atmoShader.setUniform("u_viewFocus", [view.focusX, view.focusY]);
  atmoShader.setUniform("u_screenCenter", [width / 2, height / 2]);
  atmoShader.setUniform("u_viewScale", view.scale);
  atmoShader.setUniform("u_viewRotation", view.rotation * Math.PI / 180);
  atmoShader.setUniform("u_planetCount", count);
  atmoShader.setUniform("u_planetPos", positions);
  atmoShader.setUniform("u_planetRadius", radii);
  atmoShader.setUniform("u_atmoRadius", atmoRadii);
  atmoShader.setUniform("u_atmoColor", colors);
  atmoShader.setUniform("u_sunPos", sunPos);
  atmoShader.setUniform("u_time", frameCount * 0.05);
  atmoBuffer.rect(0, 0, width, height);

  push();
  blendMode(ADD);
  image(atmoBuffer, 0, 0);
  blendMode(BLEND);
  pop();
}

function sunWorldPos() {
  for (let p of planets) {
    if (p.isSun) return { x: p.center.x, y: p.center.y };
  }
  // No sun body in this system, so use the orbital center the planets were
  // built around — it doubles as the light source the atmosphere/clouds shade
  // from, and the planets orbit it at a large radius so it sits far out in
  // space (well clear of any planet).
  return { x: 10000, y: -100 };
}

// Where the lens flare originates. Not the far-off sun itself, but the
// brightest point of the nearby planet's atmosphere — its sunward limb, at the
// outer edge of the bright band — so the flare reads as glinting off the
// glowing edge rather than from empty space. Returns a world point.
function flareSourceWorld() {
  const FLARE_EDGE = 0.45; // 0 = surface, 1 = atmosphere top

  // Prefer the body the ship is closest to; else the atmosphered planet
  // nearest the current view focus.
  let p = null;
  if (typeof lander !== "undefined" && lander && lander.nearestPlanet &&
      lander.nearestPlanet.hasAtmosphere && lander.nearestPlanet.hasAtmosphere()) {
    p = lander.nearestPlanet;
  } else {
    let bestD = Infinity;
    for (let q of planets) {
      if (q.isSun || !q.hasAtmosphere || !q.hasAtmosphere()) continue;
      let dx = q.center.x - view.focusX, dy = q.center.y - view.focusY;
      let d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; p = q; }
    }
  }
  if (!p) return sunWorldPos();

  // Direction to the sun, rotated by the same cosmetic day-cycle the
  // atmosphere shader applies (a = u_time * 0.005, u_time = frameCount * 0.05),
  // so the flare lands exactly on the bright limb as the terminator drifts.
  let sw = sunWorldPos();
  let dx = sw.x - p.center.x, dy = sw.y - p.center.y;
  let L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;
  let a = (frameCount * 0.05) * 0.005;
  let ca = Math.cos(a), sa = Math.sin(a);
  let rx = ca * dx - sa * dy;
  let ry = sa * dx + ca * dy;

  let inner = p.baseRadius;
  let outer = p.atmosphereOuterRadius();
  let R = inner + FLARE_EDGE * (outer - inner);
  return { x: p.center.x + rx * R, y: p.center.y + ry * R };
}

// Screen-space sun lens flare. Anchored at the bright sunward edge of the
// nearby planet's atmosphere (see flareSourceWorld), with a bright halo ring
// there plus ghost rings marching along the axis through the screen center —
// the classic lens-flare layout. Drawn on top of the world (additive), so it's
// never occluded and slides across the view as the camera follows the ship.
// Tunables live at the top of the function.
function drawSunFlare() {
  const RING_R = 95;       // primary halo ring radius (screen px)
  const CORE_R = 130;      // sun core glow radius
  const FADE_PX = 1400;    // how far off-screen the sun can be before it fades

  // Intensity from the debug "Sun Flare" slider (0 = off). Scales the whole
  // flare, since every element below is multiplied by `vis`.
  let intensity = (typeof DEBUG !== "undefined" && typeof DEBUG.sunFlare === "number")
    ? DEBUG.sunFlare : 1;
  if (intensity <= 0) return;

  let sw = flareSourceWorld();
  let S = worldToScreen(sw.x, sw.y);
  let cx = width / 2, cy = height / 2;

  // Fade out only when the source is far outside the viewport, so the ghost
  // chain still reads while the bright limb itself is just off-frame.
  let offX = Math.max(0, -S.x, S.x - width);
  let offY = Math.max(0, -S.y, S.y - height);
  let vis = (1 - constrain(Math.hypot(offX, offY) / FADE_PX, 0, 1)) * intensity;
  if (vis <= 0) return;

  // Axis from the sun through screen center; ghosts are placed along it.
  let ax = S.x - cx, ay = S.y - cy;

  push();
  blendMode(ADD);

  // Sun core glow — stacked soft discs, bright center to faint halo.
  noStroke();
  for (let i = 0; i < 6; i++) {
    let t = i / 5;
    let rad = lerp(CORE_R, 14, t);
    fill(255, 240, 205, (8 + 52 * t) * vis);
    circle(S.x, S.y, rad * 2);
  }

  // Primary bright halo ring at the sun.
  noFill();
  stroke(255, 220, 155, 110 * vis);
  strokeWeight(5);
  circle(S.x, S.y, RING_R * 2);
  stroke(255, 248, 222, 175 * vis);
  strokeWeight(1.5);
  circle(S.x, S.y, RING_R * 2);

  // Ghost rings/discs along the axis through center (k is the fraction from
  // center toward the sun; negative = the mirrored side).
  let ghosts = [
    { k:  0.62, r: 34, a: 55, c: [170, 215, 255] },
    { k:  0.30, r: 66, a: 42, c: [255, 205, 165] },
    { k:  0.05, r: 24, a: 62, c: [255, 240, 210] },
    { k: -0.30, r: 48, a: 34, c: [200, 255, 220] },
    { k: -0.65, r: 84, a: 26, c: [255, 200, 240] },
  ];
  for (let g of ghosts) {
    let gx = cx + ax * g.k;
    let gy = cy + ay * g.k;
    noFill();
    stroke(g.c[0], g.c[1], g.c[2], g.a * vis);
    strokeWeight(2);
    circle(gx, gy, g.r * 2);
    noStroke();
    fill(g.c[0], g.c[1], g.c[2], g.a * 0.22 * vis);
    circle(gx, gy, g.r * 0.7);
  }

  pop();
}
