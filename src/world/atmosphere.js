// Per-planet atmosphere shader. Inspired by Maxime Heckel's sky/sunset/planet
// rendering post, adapted from 3D volumetric raymarching down to a 2D ring
// model: each planet's atmosphere is a slab between baseRadius and the outer
// edge, and we sample Rayleigh + Mie contributions per screen pixel in world
// space using the camera transform from sketch.js.

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

#define PI 3.141592653589793
#define SUN_STEPS 10

// Wavelength-dependent Rayleigh scattering. Blue (b) scatters ~5.7x more than
// red (r) — these are Heckel's coefficients. This single spectrum drives BOTH
// the blue of the lit sky (in-scattering, below) AND the orange/red of sunset
// (extinction of the long tangential sunlight path), which is the whole trick.
const vec3 BETA_R = vec3(0.0058, 0.0135, 0.0331);
const float BETA_M = 0.021;   // Mie — wavelength independent, hazy white glow
const float MIE_G  = 0.76;    // forward-scattering anisotropy (sun-side glare)

// Beer's-law density falloff exponents. Mie hugs the surface more tightly than
// Rayleigh, so haze and the warm sunset band concentrate right at the limb.
const float FALLOFF_R = 3.5;
const float FALLOFF_M = 7.0;

// Tunables for the faked (non-physical-units) 2D model.
const float EXTINCT = 6.0;    // how strongly the sun path reddens the light
const float SUN_I   = 18.0;   // sun intensity / overall brightness
const float RAY_K   = 1.4;    // Rayleigh in-scatter strength
const float MIE_K   = 0.06;   // Mie in-scatter strength

float rayleighPhase(float mu) {
  return 3.0 / (16.0 * PI) * (1.0 + mu * mu);
}

float miePhase(float mu) {
  float gg = MIE_G * MIE_G;
  float num = 3.0 * (1.0 - gg) * (1.0 + mu * mu);
  float den = 8.0 * PI * (2.0 + gg) * pow(max(1.0 + gg - 2.0 * MIE_G * mu, 1e-4), 1.5);
  return num / den;
}

void main() {
  // p5 P2D canvas is y-down; vTexCoord.y from the WEBGL buffer is y-up, and
  // image() doesn't flip on blit. Flip Y here so the pixel coords match the
  // world point sketch.js drew the planets at — otherwise the atmosphere
  // ring renders mirrored above/below the planet.
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
    float r = u_planetRadius[i];
    float ra = u_atmoRadius[i];
    float dist = length(d);
    if (dist >= ra) continue;
    if (dist <= r) continue;

    float thickness = max(ra - r, 0.0001);
    // Altitude through the atmosphere: 0 at surface, 1 at outer edge.
    float h = (dist - r) / thickness;
    // Beer's-law profile, but faded to exactly zero at the outer edge so the
    // sky melts into space instead of stopping at a hard ring. Without the
    // smoothstep the density is still ~0.03 at h=1 and that step shows up as a
    // visible circle floating above the horizon.
    float edgeFade = 1.0 - smoothstep(0.65, 1.0, h);
    float densityR = exp(-h * FALLOFF_R) * edgeFade;
    float densityM = exp(-h * FALLOFF_M) * edgeFade;

    vec2 outward = d / max(dist, 0.0001);
    // Rotate the apparent sun direction around the planet over time so the
    // day/night terminator sweeps slowly across the sky. The world-space
    // sun position is unchanged — this is just a cosmetic day-cycle.
    vec2 toSunRaw = normalize(u_sunPos - pc);
    float dayAngle = u_time * 0.005;
    float dc = cos(dayAngle);
    float ds = sin(dayAngle);
    vec2 toSun = vec2(dc * toSunRaw.x - ds * toSunRaw.y,
                      ds * toSunRaw.x + dc * toSunRaw.y);

    // March toward the sun, accumulating the optical depth of the path the
    // sunlight travels to reach this point. A long path (grazing the limb near
    // the terminator) scatters the blue out and leaves warm light → sunset. If
    // the ray runs into the planet first, this point is in shadow → night side.
    float segLen = (2.0 * ra) / float(SUN_STEPS);
    float odR = 0.0;
    float odM = 0.0;
    bool lit = true;
    vec2 sp = world;
    for (int j = 0; j < SUN_STEPS; j++) {
      sp += toSun * segLen;
      float sd = length(sp - pc);
      if (sd <= r) { lit = false; break; }   // sun occluded by the planet
      if (sd >= ra) break;                    // left the atmosphere — done
      float sh = (sd - r) / thickness;
      odR += exp(-sh * FALLOFF_R);
      odM += exp(-sh * FALLOFF_M);
    }
    if (!lit) continue;  // planet shadow — leave the night limb dark

    float odNorm = segLen / thickness;
    odR *= odNorm;
    odM *= odNorm;

    // Wavelength-dependent transmittance of the sunlight reaching this point.
    // Because BETA_R.b >> BETA_R.r, a long path kills blue first → it warms
    // through yellow and orange to deep red exactly as the path lengthens.
    vec3 Tsun = exp(-(BETA_R * EXTINCT) * odR - vec3(BETA_M * EXTINCT) * odM);

    // Scattering angle proxy: outward radial vs. sun direction. mu→1 on the
    // sub-solar limb (bright forward Mie glare), mu→0 at the terminator.
    float mu = dot(outward, toSun);
    float phaseR = rayleighPhase(mu);
    float phaseM = miePhase(mu);

    // Rayleigh in-scatter keeps the blue-dominant spectrum but is nudged toward
    // each planet's own sky hue so worlds stay visually distinct.
    vec3 rayColor = mix(BETA_R / BETA_R.b, u_atmoColor[i], 0.45);

    vec3 scatter = SUN_I * Tsun * (
        rayColor          * phaseR * densityR * RAY_K +
        vec3(1.0, 0.9, 0.8) * phaseM * densityM * MIE_K
    );

    accum += scatter;
  }

  // Filmic-ish rolloff so saturated sunsets and the sub-solar glare don't
  // hard-clip to flat white.
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
