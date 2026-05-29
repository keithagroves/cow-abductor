// Per-planet cloud shader. Mirrors atmosphere.js: a WEBGL graphics buffer
// rendered with a fragment shader that reconstructs world position from
// screen pixels via the same camera-inverse, then samples FBM noise per
// pixel for a continuous cloud layer.
//
// Inspired by Maxime Heckel's volumetric raymarching post — adapted to a
// 2D top-down view, the "raymarch" collapses into a single density sample
// per pixel inside a per-planet cloud altitude band. Beer's-law opacity and
// sun-direction shading come straight from the article; the noise lookup
// uses a hash-based value noise so we don't need a sampler texture.

const CLOUD_MAX_PLANETS = 10;

const CLOUD_VERT = `
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

const CLOUD_FRAG = `
precision highp float;

#define MAX_PLANETS 10

varying vec2 vTexCoord;
uniform vec2 u_resolution;
uniform vec2 u_viewFocus;
uniform vec2 u_screenCenter;
uniform float u_viewScale;
uniform float u_viewRotation;
uniform float u_time;
uniform int u_planetCount;
uniform vec2 u_planetPos[MAX_PLANETS];
uniform float u_planetInnerR[MAX_PLANETS];   // floor of cloud band (near surface)
uniform float u_planetOuterR[MAX_PLANETS];   // ceiling of cloud band
uniform vec2 u_sunPos;

// Slow uniform cloud drift (noise units per time unit). Tuned low so clouds
// morph gently in place instead of racing — bump it up for windier skies.
const float CLOUD_DRIFT = 0.004;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i),                  hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.1;
    a *= 0.5;
  }
  return v;
}

void main() {
  // Reconstruct the world point under this pixel. Same inverse-camera math
  // (and same WEBGL→P2D Y flip) as atmosphere.js so the cloud field aligns
  // with the rest of the scene.
  vec2 pixel = vec2(vTexCoord.x * u_resolution.x,
                    (1.0 - vTexCoord.y) * u_resolution.y);
  vec2 centered = pixel - u_screenCenter;
  float c = cos(-u_viewRotation);
  float s = sin(-u_viewRotation);
  vec2 unrot = vec2(c * centered.x - s * centered.y, s * centered.x + c * centered.y);
  vec2 world = unrot / u_viewScale + u_viewFocus;

  vec4 accum = vec4(0.0);

  for (int i = 0; i < MAX_PLANETS; i++) {
    if (i >= u_planetCount) break;
    vec2 d = world - u_planetPos[i];
    float dist = length(d);
    float innerR = u_planetInnerR[i];
    float outerR = u_planetOuterR[i];
    if (dist <= innerR) continue;
    if (dist >= outerR) continue;

    // Altitude profile across the cloud band — fades at the floor and
    // ceiling so clouds don't have horizontal hard edges, densest in the
    // middle of the band.
    float h = (dist - innerR) / (outerR - innerR);
    float altDensity = smoothstep(0.0, 0.25, h) * (1.0 - smoothstep(0.7, 1.0, h));

    // Clouds are pinned to the planet's local frame. The old version rotated
    // the whole field around the planet center, which gave clouds near the
    // limb a huge linear speed — they raced around and read as disorienting
    // parallax. Instead we sample in the fixed local frame and let the field
    // drift very gently (like a light wind) and morph in place, so motion is
    // calm and roughly uniform across the whole disc.
    // 0.0008 tunes feature size — lower = bigger puffs. CLOUD_DRIFT is in
    // noise units per time unit; small = slow.
    vec2 local = d;
    float density = fbm(local * 0.0008 + vec2(u_time * CLOUD_DRIFT, u_time * CLOUD_DRIFT * 0.4));
    // Threshold so most of the sky is clear and only the upper noise band
    // forms cloud. Multiply by altDensity to apply the vertical profile.
    density = smoothstep(0.46, 0.72, density) * altDensity;
    if (density <= 0.0) continue;

    // Beer's law: opacity grows non-linearly with density. Saturate so the
    // densest cores read as nearly opaque but normal patches stay soft.
    float alpha = 1.0 - exp(-density * 3.5);

    // Sun-direction shading. Same idiom as atmosphere.js: dot the outward
    // direction with the sun direction, smoothstep across the terminator.
    // The cloud color lerps from a cool grey-blue (night/shadow side) to
    // warm white (lit side).
    vec2 outward = d / max(dist, 0.0001);
    // Match the day-cycle rotation from atmosphere.js so cloud shading
    // tracks the same moving terminator.
    vec2 toSunRaw = normalize(u_sunPos - u_planetPos[i]);
    float dayAngle = u_time * 0.005;
    float dc = cos(dayAngle);
    float ds = sin(dayAngle);
    vec2 toSun = vec2(dc * toSunRaw.x - ds * toSunRaw.y,
                      ds * toSunRaw.x + dc * toSunRaw.y);
    float sunDot = dot(outward, toSun);
    float lit = smoothstep(-0.25, 0.45, sunDot);
    vec3 sunlit = vec3(1.0, 0.98, 0.94);
    vec3 shadow = vec3(0.45, 0.5, 0.6);
    vec3 cloudColor = mix(shadow, sunlit, lit);

    // Painter's "over" composite so multiple planets' contributions layer
    // cleanly when their cloud bands overlap.
    accum.rgb = accum.rgb + cloudColor * alpha * (1.0 - accum.a);
    accum.a   = accum.a   + alpha               * (1.0 - accum.a);
  }

  gl_FragColor = accum;
}
`;

let cloudBuffer = null;
let cloudShader = null;
let cloudFailed = false;

function initClouds() {
  if (cloudFailed) return;
  try {
    cloudBuffer = createGraphics(width, height, WEBGL);
    cloudBuffer.noStroke();
    cloudShader = cloudBuffer.createShader(CLOUD_VERT, CLOUD_FRAG);
  } catch (e) {
    console.warn("Cloud shader unavailable, falling back to none:", e);
    cloudBuffer = null;
    cloudShader = null;
    cloudFailed = true;
  }
}

function resizeClouds() {
  if (!cloudBuffer) return;
  if (cloudBuffer.width !== width || cloudBuffer.height !== height) {
    cloudBuffer.resizeCanvas(width, height);
  }
}

function drawClouds() {
  if (!cloudBuffer || !cloudShader) return;
  resizeClouds();

  let positions = [];
  let innerR = [];
  let outerR = [];
  let count = 0;
  let sunPos = [10000, -100];

  for (let p of planets) {
    if (p.isSun) sunPos = [p.center.x, p.center.y];
  }

  for (let p of planets) {
    if (count >= CLOUD_MAX_PLANETS) break;
    if (p.isSun) continue;
    if (!p.hasAtmosphere || !p.hasAtmosphere()) continue;
    positions.push(p.center.x, p.center.y);
    // Low clouds: drop the floor to the planet's baseline radius (so the
    // layer starts close to the surface), but keep the ceiling up in the
    // lower atmosphere so a meaningful chunk of the band extends past
    // the mountain peaks — otherwise the planet silhouette occludes the
    // whole thing when clouds render behind it. The altitude profile in
    // the shader (smoothstep 0..0.25) fades the bottom of the band so
    // the surface contact reads as soft fog, not a hard horizon line.
    let mountainTop = p.baseRadius + p.noiseIntensity * 1.05;
    let inner = p.baseRadius;
    let outer = mountainTop + (p.atmosphereOuterRadius() - mountainTop) * 0.55;
    innerR.push(inner);
    outerR.push(outer);
    count++;
  }

  while (positions.length / 2 < CLOUD_MAX_PLANETS) {
    positions.push(0, 0);
    innerR.push(0);
    outerR.push(0);
  }

  cloudBuffer.clear();
  cloudBuffer.shader(cloudShader);
  cloudShader.setUniform("u_resolution", [width, height]);
  cloudShader.setUniform("u_viewFocus", [view.focusX, view.focusY]);
  cloudShader.setUniform("u_screenCenter", [width / 2, height / 2]);
  cloudShader.setUniform("u_viewScale", view.scale);
  cloudShader.setUniform("u_viewRotation", view.rotation * Math.PI / 180);
  cloudShader.setUniform("u_time", frameCount * 0.05);
  cloudShader.setUniform("u_planetCount", count);
  cloudShader.setUniform("u_planetPos", positions);
  cloudShader.setUniform("u_planetInnerR", innerR);
  cloudShader.setUniform("u_planetOuterR", outerR);
  cloudShader.setUniform("u_sunPos", sunPos);
  cloudBuffer.rect(0, 0, width, height);

  // Standard alpha blend — clouds occlude what's behind them based on
  // their per-pixel alpha. (Atmosphere uses ADD because it's emissive
  // limb glow; clouds are not emissive, so BLEND is right here.)
  image(cloudBuffer, 0, 0);
}
