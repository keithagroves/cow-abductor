// Per-planet atmosphere shader. A deliberately simple 2D model: for each
// screen pixel we find the planet it falls over (in world space, via the
// camera transform from sketch.js) and draw a single soft glow band in the
// slab between baseRadius and the outer edge — lit blue on the day side, warm
// at the sunset terminator, faint on the night side. No raymarching or
// physical scattering; just one band shaded by the sun direction.

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

// One soft glow band floating in the atmosphere — that's the whole model.
// BAND_CENTER is its altitude (0 = surface, 1 = outer edge), BAND_WIDTH its
// thickness. A Gaussian fades it smoothly to ~0 at both ends so there are no
// hard layer edges, and because it floats above the surface the ship sweeps
// past it like a halo. The band is lit by the sun with a soft day/night, a
// warm sunset at the terminator, and a faint (never black) night side.
const float BAND_CENTER = 0.40;
const float BAND_WIDTH  = 0.28;
const float BRIGHTNESS  = 1.7;
const float SUNSET_K    = 0.9;   // warm terminator glow strength
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

    // Altitude 0..1, then the smooth Gaussian glow band.
    float h = (dist - r) / max(ra - r, 0.0001);
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
    // Warm glow that peaks right at the terminator, on the lit side only.
    float sunset = exp(-sunDot * sunDot * 8.0) * day;

    // Per-planet blue sky on the lit side fading to a faint same-hue night
    // side, plus the orange sunset added at the terminator.
    vec3 col = mix(u_atmoColor[i] * NIGHT_FLOOR, u_atmoColor[i], day)
             + vec3(1.0, 0.5, 0.25) * (sunset * SUNSET_K);

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
