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

void main() {
  // vTexCoord maps 1:1 with P2D pixel coords once the WEBGL buffer is blitted
  // by image(), so no Y flip is needed here.
  vec2 pixel = vTexCoord * u_resolution;
  // Inverse of the sketch.js camera transform: center → unrotate → unscale → +focus.
  vec2 centered = pixel - u_screenCenter;
  float c = cos(-u_viewRotation);
  float s = sin(-u_viewRotation);
  vec2 unrot = vec2(c * centered.x - s * centered.y, s * centered.x + c * centered.y);
  vec2 world = unrot / u_viewScale + u_viewFocus;

  vec3 accum = vec3(0.0);

  for (int i = 0; i < MAX_PLANETS; i++) {
    if (i >= u_planetCount) break;
    vec2 d = world - u_planetPos[i];
    float r = u_planetRadius[i];
    float ra = u_atmoRadius[i];
    float dist = length(d);
    if (dist >= ra) continue;
    if (dist <= r) continue;

    // Altitude through the atmosphere: 0 at surface, 1 at outer edge.
    float h = (dist - r) / (ra - r);
    // Tight Gaussian band so the glow only appears as a thin limb ring near
    // the outer edge, fading off both inward (toward the planet) and outward
    // (into space).
    float density = exp(-pow((h - 0.55) / 0.18, 2.0));

    vec2 outward = d / max(dist, 0.0001);
    vec2 toSun = normalize(u_sunPos - u_planetPos[i]);
    float sunDot = dot(outward, toSun);

    // Day/night with a soft terminator a few degrees wide.
    float dayNight = smoothstep(-0.15, 0.25, sunDot);

    // Rayleigh — the planet's sky color, brightest on the lit side.
    vec3 rayleigh = u_atmoColor[i] * dayNight * density * 0.6;

    // Mie / sunset — peaks at the terminator, day side only.
    float terminator = exp(-pow(sunDot * 1.6, 2.0) * 6.0);
    vec3 mieColor = vec3(1.5, 0.55, 0.2) * terminator * density * dayNight * 0.5;

    accum += rayleigh + mieColor;
  }

  accum = min(accum, vec3(1.2));
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
    // Use the terrain's outer envelope (baseRadius + noiseIntensity) so the
    // shader's glow ring starts above the highest peaks and doesn't bleed
    // into pixels already covered by the noise-textured planet body.
    let effectiveR = Math.min(
      p.baseRadius + p.noiseIntensity,
      p.atmosphereOuterRadius() * 0.95
    );
    radii.push(effectiveR);
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
  atmoBuffer.rect(0, 0, width, height);

  push();
  blendMode(ADD);
  image(atmoBuffer, 0, 0);
  blendMode(BLEND);
  pop();
}
