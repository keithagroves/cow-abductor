/*********************************************************
 *                   GLOBALS
 *********************************************************/
let gameState = GAME_STATES.WAITING;
let score = 0;
let cargo = 0;
let alienImage;
let lander;
let cows = [];
let flora = [];
let minerals = [];
let lasers = [];
let planets = []; // This is our array of planets
let base;
// Remembered surface angle to drop the ship in above on a fresh run, before
// any launch pad has been built.
let starterSpawnAngle = 0;
let delivered = 0;
let research = 0;
// Flips true the first time the ship reaches the base after the descent. Until
// then the opening objective is to locate the launch pad.
let padFound = false;
let burnParticles = [];
let splashParticles = [];
let crashParticles = [];
let stars = [];
// Static (parallax-0) background stars. They never translate with the
// camera, so the constellations drawn across them stay fixed on the sky.
let bgStars = [];
let cowImage;
let view = { scale: 1, focusX: 0, focusY: 0, rotation: 0, userZoom: 1 };
// Overview/map mode — press M to toggle. Frames the whole solar system
// (every planet's orbital extent) instead of following the ship.
let overviewMode = false;
let startTime;
let lastDiagnosticLog = 0;
let eventMessage = "";
let eventMessageUntil = 0;
let touchable = "ontouchstart" in window;
let backgroundMusic=null;
let alienGroundImage;
let rocketSound;
let thrustPlaying = false;
const KEY_A = 65, KEY_D = 68, KEY_W = 87, KEY_S = 83;
let timeScale = 1;
let timeSlider;

const CAMERA_ZOOM_EASE = 0.08;
const CAMERA_FOLLOW_EASE = 0.18;
// How fast the camera rolls to keep gravity pointing screen-down. Low enough
// that the horizon swings smoothly as you fly around a planet rather than
// snapping, high enough that you're upright again within ~a second.
const CAMERA_ROLL_EASE = 0.08;
// User zoom (scroll wheel / trackpad pinch) is a multiplier layered on top of
// the automatic altitude-based framing. 1 = no change; <1 pulls out, >1 zooms
// in. Clamped so the player can't lose the ship entirely.
const USER_ZOOM_MIN = 0.25;
const USER_ZOOM_MAX = 4.0;
// Per wheel-tick zoom sensitivity. Applied exponentially so each notch is a
// constant ratio regardless of current zoom; the device's delta magnitude
// scales it (trackpad pinch sends small deltas, mouse wheel large ones).
const USER_ZOOM_SENSITIVITY = 0.0015;
const LANDING_MAX_TILT = 45;
const DISCOVERY_DISTANCE = 2500;
const PLANET_NAMES = [
  "Pasture-1",
  "Mooonlet",
  "Greenhorn",
  "Rustbucket",
  "Blue Grazer",
  "Far Meadow"
];
/*********************************************************
 *                   P5 LIFE CYCLE
 *********************************************************/
function preload() {
  cowImage = loadImage("assets/images/darkCow.png");
  alienImage = loadImage("assets/images/alien.png");
  alienGroundImage = loadImage("assets/images/unnamed.png");
  backgroundMusic = loadSound("assets/audio/leaving-for-good.mp3");
}


function playThruster() {
  // if (!boost) return;
  
  if (!thrustPlaying) {
    rocketSound.start();
    //boost.start()
    thrustInterval = setInterval(updateThruster, 10);
    thrustPlaying = true;
  }
  
  thrustTargetVolume = 0.1; // Adjust this value to control max volume
}

function stopThruster() {
  // if (!boost) return;
  thrustPlaying = false
  thrustTargetVolume = 0;
  rocketSound.stop();
  // Don't stop the sound immediately - let it fade out in updateThruster
}
thrustVolume = 0;
thrustTargetVolume = 0;
function updateThruster() {

  if (thrustVolume !== thrustTargetVolume) {
    thrustVolume += (thrustTargetVolume - thrustVolume) * 0.1;
    
    // Snap to target if very close
    if (Math.abs(thrustVolume - thrustTargetVolume) < 0.001) {
      thrustVolume = thrustTargetVolume;
    }
    
    // boost.setVolume(thrustVolume);
  }
  
  // If volume has reached 0, stop the sound and clear interval
  if (thrustPlaying && thrustVolume <= 0.001 && thrustTargetVolume === 0) {
    // boost.stop();
    clearInterval(thrustInterval);
    thrustInterval = null;
    thrustPlaying = false;
  }
}


function setup() {
  createCanvas(windowWidth, windowHeight);
  angleMode(DEGREES);
  rocketSound = new RocketSound();

  // Create time control slider
  timeSlider = createSlider(0.1, 5, 1, 0.1);
  timeSlider.position(width - 220, 30);
  timeSlider.style('width', '200px');

  // Initialize audio context with user interaction
  if (getAudioContext().state !== 'running') {
    getAudioContext().suspend();
  }

  // Initialize starfield. Each star gets a parallax depth (0=far/static,
  // 1=world-locked) so the field reads as having real distance when the
  // camera moves. Closer stars are bigger and brighter; color comes from
  // a coarse blackbody-style palette biased toward white.
  // Tile is larger than the screen so the rotated viewport stays inside.
  let tileW = width * 1.5;
  let tileH = height * 1.5;
  for (let i = 0; i < 300; i++) {
    let depth = pow(random(), 1.8);            // bias toward far/small
    let parallax = lerp(0.04, 0.45, depth);
    let size = lerp(0.4, 2.2, depth);
    let baseBrightness = lerp(0.35, 1.0, depth);
    stars.push({
      x: random(-tileW / 2, tileW / 2),
      y: random(-tileH / 2, tileH / 2),
      parallax,
      size,
      brightness: baseBrightness,
      color: starTemperatureColor(random()),
    });
  }
  // Static background stars (parallax 0). Dimmer and smaller than the
  // parallax field so the foreground dust reads as nearer; these host the
  // constellations.
  for (let i = 0; i < 160; i++) {
    bgStars.push({
      x: random(-tileW / 2, tileW / 2),
      y: random(-tileH / 2, tileH / 2),
      parallax: 0,
      size: random(0.6, 1.8),
      brightness: random(0.4, 0.9),
      color: starTemperatureColor(random()),
    });
  }
  loadDebugFromStorage();
  buildWorld();
  resetGame();
  setupDebugPanel();
  initAtmosphere();
  initClouds();
  initPlumeFluid();
  initBurnFluid();
  initShipShader();
}

function buildWorld() {
  planets.length = 0;
  let scale = DEBUG.planetRadiusScale;
  let density = DEBUG.planetDensity;
  let spacing = DEBUG.planetSpacing;

  let sun = createVector(10000, -100);
  // Starter sits way out from the sun so there's plenty of empty space to fly
  // around the home system before bumping into anything else.
  let starting = spacing * 16;

  // Inner planets (radii scale with the debug multiplier).
  // Building the universe one planet at a time — uncomment the next worlds
  // once the starter feels right.
  // noise 2000 + sea level 800 → ~40% water, ~60% land. Dial seaLevel up to
  // flood the world, down for an arid one.
  planets.push(new Planet(createVector(0, 0),  8000 * scale, 2000, 255, density, starting, sun));
  // Pin the starter while we tune it — orbital motion under the ship causes
  // weird relative-physics artifacts. Drop this once the world has siblings.
  planets[planets.length - 1].orbitSpeed = 0;
  // setSeaLevel — not a plain assignment — so landable arcs get re-placed
  // above the new water line. Otherwise pads end up flattened at baseRadius,
  // far under the sea.
  planets[planets.length - 1].setSeaLevel(800);

  // Moon orbiting the starter planet. Constructor immediately repositions
  // `center` via updateOrbitPosition, so the (0,0) we pass is only used by the
  // isSun-detection check (which compares to the orbit anchor). Anchoring on
  // planets[0].center means useGravityOrbit() can resolve the parent body by
  // reference identity and seed the right circular-orbit velocity.
  let moon = new Planet(
    createVector(0, 0),
    2000 * scale,            // ~quarter the home-world radius
    1800, 330,               // big noise span + dense sampling = jagged surface
    density,                 // same density as the home world — but since
                             // surface gravity scales with size, this quarter-
                             // radius moon pulls ~¼ as hard at its surface
    100000,                  // initial radius — physics takes over from here
    planets[0].center
  );
  // Airless rock — drag/burn/atmosphere shader all skip it via this flag.
  moon.atmosphere = false;
  planets.push(moon);
  // Move the moon under the same gravity integrator the ship uses, with vel
  // seeded for a stable circular orbit. The orbit can be perturbed (e.g. by
  // future planets) and will respond physically instead of snapping back to
  // its kinematic ring.
  moon.useGravityOrbit();
  starting += spacing;
  // planets.push(new Planet(createVector(0, 0), 1000 * scale, 255, 255, density, starting, sun));
  // starting += spacing;
  // planets.push(new Planet(createVector(0, 0), 1200 * scale,  50, 180, density, starting, sun));
  // starting += spacing;
  // planets.push(new Planet(createVector(0, 0),  900 * scale, 255,  30, density, starting, sun));
  // starting += spacing;
  // planets.push(new Planet(createVector(0, 0), 1100 * scale,  50,  50, density, starting, sun));
  // starting += spacing;

  // Sun: bigger and much less dense so it doesn't crush you.
  // planets.push(new Planet(sun.copy(), 4000 * scale, 255, 180, 2000, 0, sun));


  // Outlier rogue planet.
  //planets.push(new Planet(createVector(-5000, 1000), 1000 * scale, 100, 400, density, 500, sun));

  assignPlanetNames();

  // No launch pad yet -- the player picks where to build it after the first
  // landing (see buildLaunchPad). Just remember a nice "top" angle to drop the
  // ship in above so the opening descent starts upright.
  base = null;
  let starter = planets.find((p) => !p.isSun && p.landscape && p.landscape.some((pt) => pt.landable));
  starterSpawnAngle = starter ? pickBaseAngle(starter) : 0;
}
let minimapBuffer = null;

function drawMinimap() {
  // Both controlled from the debug panel so the player can pull the map out
  // to a planning chart and dial the zoom to see whole orbits.
  const mapSize = DEBUG.minimapSize;
  const padding = 20;
  const mapX = width - mapSize - padding;
  const mapY = padding;
  const mapScale = DEBUG.minimapZoom;

  if (!minimapBuffer) {
    minimapBuffer = createGraphics(mapSize, mapSize);
    // Match the main canvas so view.rotation (degrees) can be passed straight
    // to minimapBuffer.rotate without converting to radians.
    minimapBuffer.angleMode(DEGREES);
  } else if (minimapBuffer.width !== mapSize) {
    minimapBuffer.resizeCanvas(mapSize, mapSize);
  }
  minimapBuffer.clear();
  minimapBuffer.background(0, 0, 0, 200);

  // Calculate center of minimap
  const centerX = mapSize/2;
  const centerY = mapSize/2;

  if (lander && lander.active) {
    // Rotate the minimap contents to match the main camera roll so screen-up
    // and minimap-up always agree. The N/S/E/W labels (drawn inside the same
    // transform) move with the world so "where's north?" stays answerable.
    minimapBuffer.push();
    minimapBuffer.translate(centerX, centerY);
    minimapBuffer.rotate(view.rotation);

    // Draw planets relative to lander position. We keep the disc + orbit pass
    // separate from labels so all labels render on top regardless of overlap.
    for (let planet of planets) {
      let minimapX = (planet.center.x - lander.pos.x) * mapScale;
      let minimapY = (planet.center.y - lander.pos.y) * mapScale;

      minimapBuffer.noStroke();
      minimapBuffer.fill(planet.strokeColor);
      let minimapRadius = max(4, planet.baseRadius * mapScale);
      minimapBuffer.circle(minimapX, minimapY, minimapRadius*2);

      // Draw orbit paths
      minimapBuffer.stroke(planet.strokeColor, 50);
      minimapBuffer.noFill();
      if (!planet.isSun) {
        let orbitRadius = planet.orbitRadius * mapScale;
        minimapBuffer.ellipse(
          (planet.orbitCenter.x - lander.pos.x) * mapScale,
          (planet.orbitCenter.y - lander.pos.y) * mapScale,
          orbitRadius * 2,
          orbitRadius * 2
        );
      }
    }

    // Planet labels — counter-rotate so they read upright even with camera
    // roll, and offset below each disc so the label doesn't sit on the planet.
    minimapBuffer.textSize(11);
    minimapBuffer.textAlign(CENTER, TOP);
    minimapBuffer.noStroke();
    for (let planet of planets) {
      let minimapX = (planet.center.x - lander.pos.x) * mapScale;
      let minimapY = (planet.center.y - lander.pos.y) * mapScale;
      let r = max(4, planet.baseRadius * mapScale);
      let label = planet.discovered ? (planet.name || "?") : "?";
      minimapBuffer.push();
      minimapBuffer.translate(minimapX, minimapY + r + 2);
      minimapBuffer.rotate(-view.rotation);
      minimapBuffer.fill(planet.discovered ? 230 : 140);
      minimapBuffer.text(label, 0, 0);
      minimapBuffer.pop();
    }

    // Draw cows relative to lander position
    for (let cow of cows) {
      let minimapX = (cow.pos.x - lander.pos.x) * mapScale;
      let minimapY = (cow.pos.y - lander.pos.y) * mapScale;
      minimapBuffer.fill(0, 255, 0);
      minimapBuffer.noStroke();
      minimapBuffer.circle(minimapX, minimapY, 3);
    }

    // Predicted trajectory — longer horizon than the main-view line so the
    // minimap can show where you'll end up after several minutes of coasting.
    if (DEBUG.showTrajectory) {
      let pts = lander.predictLongTrajectory(timeScale, DEBUG.minimapTrajectorySteps, 4);
      let projected = [{ x: 0, y: 0 }];
      for (let i = 0; i < pts.length; i++) {
        let mx = (pts[i].x - lander.pos.x) * mapScale;
        let my = (pts[i].y - lander.pos.y) * mapScale;
        if (mx < -mapSize || mx > mapSize || my < -mapSize || my > mapSize) break;
        projected.push({ x: mx, y: my });
      }

      if (projected.length >= 2) {
        minimapBuffer.noFill();
        minimapBuffer.stroke(80, 255, 220, 180);
        minimapBuffer.strokeWeight(1);
        minimapBuffer.beginShape();
        let first = projected[0];
        let last = projected[projected.length - 1];
        minimapBuffer.curveVertex(first.x, first.y);
        for (let p of projected) minimapBuffer.curveVertex(p.x, p.y);
        minimapBuffer.curveVertex(last.x, last.y);
        minimapBuffer.endShape();
      }
    }

    // Draw base relative to lander
    if (base) {
      let bX = (base.pos.x - lander.pos.x) * mapScale;
      let bY = (base.pos.y - lander.pos.y) * mapScale;
      minimapBuffer.fill(120, 220, 255);
      minimapBuffer.noStroke();
      minimapBuffer.circle(bX, bY, 6);
    }

    // Draw lander in center — rotation doesn't move the origin so this stays
    // pinned to the minimap center regardless of camera roll.
    minimapBuffer.fill(255, 0, 0);
    minimapBuffer.noStroke();
    minimapBuffer.circle(0, 0, 4);

    // Draw view rectangle centered on lander. Because the buffer is rotated
    // to match the main camera, this stays axis-aligned with the minimap
    // frame, which is what the player actually sees on screen.
    minimapBuffer.noFill();
    minimapBuffer.stroke(255, 100);
    minimapBuffer.strokeWeight(1);
    let viewWidth = (width / view.scale) * mapScale;
    let viewHeight = (height / view.scale) * mapScale;
    minimapBuffer.rect(-viewWidth/2, -viewHeight/2, viewWidth, viewHeight);

    // Compass labels — positions rotate with the world (so "N" tracks true
    // north), but each label counter-rotates internally so the glyph itself
    // stays screen-upright and legible.
    minimapBuffer.textSize(12);
    minimapBuffer.textAlign(CENTER, CENTER);
    minimapBuffer.fill(255);
    minimapBuffer.noStroke();
    const labelR = centerX - 15;
    let labels = [
      { t: "N", x: 0,        y: -labelR },
      { t: "S", x: 0,        y:  labelR },
      { t: "W", x: -labelR,  y: 0       },
      { t: "E", x:  labelR,  y: 0       }
    ];
    for (let L of labels) {
      minimapBuffer.push();
      minimapBuffer.translate(L.x, L.y);
      minimapBuffer.rotate(-view.rotation);
      minimapBuffer.text(L.t, 0, 0);
      minimapBuffer.pop();
    }

    minimapBuffer.pop();
  }

  // Border drawn last and outside the rotation so the frame stays a clean
  // square no matter how the contents are rolling.
  minimapBuffer.stroke(255);
  minimapBuffer.strokeWeight(2);
  minimapBuffer.noFill();
  minimapBuffer.rect(0, 0, mapSize, mapSize);

  // Draw the buffer to the screen
  image(minimapBuffer, mapX, mapY);
}
function draw() {
  // Update time scale from slider
  timeScale = timeSlider.value();
  
  background(0);
  drawStarField();

  if (gameState === GAME_STATES.PLAYING) {
    updateWorld(timeScale);
    updateView();
  }
  // Crash debris keeps animating after the ship is destroyed, so it runs
  // outside the PLAYING gate.
  updateCrashParticles(timeScale);

  push();
  // Camera transform: rotate + zoom around the focal point (lander). The roll
  // is driven by gravity (see updateView) so "down" stays toward the planet
  // without sliding the ship off-screen.
  translate(width / 2, height / 2);
  rotate(view.rotation);
  scale(view.scale);
  translate(-view.focusX, -view.focusY);

  // Draw every planet in the array
  for (let planet of planets) {
    planet.draw();
  }

  // Foreground vegetation on nearby vegetated worlds (drawn over terrain,
  // under the pad/ship/cows).
  drawSurfaceTrees();

  if (base) base.draw();

  // Soft contact shadow the ship casts onto the ground beneath it.
  drawLanderShadow();

  drawBurnParticles();
  drawSplashParticles();
  // Experimental GPU fluid plume, anchored at the engine nozzle (local ~(0,21),
  // just below the engine bell) and rotated with the ship. Drawn before the
  // hull so the body sits on top of the exhaust.
  if (DEBUG.fluidPlume && lander.active) {
    let nozzle = lander.localToWorld(0, 21);
    drawPlumeFluid(nozzle, lander.rotation, DEBUG.fluidPlumeScale);
  }
  if (DEBUG.fluidBurn && lander.active) {
    drawBurnFluid(getBurnState());
  }
  lander.render(timeScale);
  drawCrashParticles();

  // Render plants under cows so glow blends nicely.
  for (let plant of flora) {
    plant.render();
  }

  for (let mineral of minerals) {
    mineral.render();
  }

  // Render all cows
  for (let cow of cows) {
    cow.render();
  }

  updateAndDrawLasers(timeScale);

  pop();

  // Atmosphere glow — additive overlay on top of the world (matches f797526),
  // so the bright Rayleigh limb brightens the upper atmosphere as you climb
  // rather than being occluded by the planet body and sky-envelope gradient.
  drawAtmosphere();

  // Clouds — BLEND pass on top of the atmosphere glow (same atmosphere→clouds
  // order as 2c48f35, so the additive limb glow doesn't wash out the cloud
  // color) and on top of the planet body + envelope so they're no longer
  // buried by either. The shader's innerR = baseRadius keeps them a limb band.
  drawClouds();

  // Sun lens flare — screen space, on top of the world so it's never occluded
  // and slides across the view as the camera follows the ship.
  drawSunFlare();

  pollInput(timeScale);
  if (gameState !== GAME_STATES.WAITING) {
    drawHUD();
    drawMinimap();
  }
  drawEventMessage();
  drawGameStateMessages();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  timeSlider.position(width - 220, 30);
  resetView();
  resizePlumeFluid();
  resizeBurnFluid();
  // If you want to regenerate or adapt planet data, do it here
}

/*********************************************************
 *                   GAME FLOW
 *********************************************************/
function resetGame() {
  lander = new Lander();
  resetShop();
  resetPlanetDiscoveries();
  initializeCows();
  initializePlants();
  initializeMinerals();
  burnParticles = [];
  splashParticles = [];
  crashParticles = [];
  lasers = [];
  // Begin the run descending toward the starter planet. Offset the spawn a
  // couple thousand px of surface arc from the base so the first objective —
  // finding the launch pad — takes a short hop to reach (the nav arrow points
  // the way), without being a marathon traverse.
  padFound = false;
  // A fresh run has no pad; the player builds one after touching down.
  base = null;
  let starter = planets.find((p) => !p.isSun && p.landscape && p.landscape.some((pt) => pt.landable));
  if (starter) {
    lander.spawnAbovePlanet(starter, starterSpawnAngle);
    starter.discovered = true;
  }
  gameState = GAME_STATES.WAITING;
  score = 0;
  cargo = 0;
  delivered = 0;
  research = 0;
  startTime = millis();
  lastDiagnosticLog = millis();
  eventMessage = "";
  eventMessageUntil = 0;
  resetView();
}

function resetPlanetDiscoveries() {
  for (let planet of planets) {
    planet.discovered = planet.isSun;
  }
}

function assignPlanetNames() {
  let planetIndex = 0;
  for (let planet of planets) {
    if (planet.isSun) {
      planet.name = "Home Star";
      planet.discovered = true;
    } else {
      planet.name = PLANET_NAMES[planetIndex] || `Body ${planetIndex + 1}`;
      planet.discovered = false;
      planetIndex++;
    }
  }
}

function liftOff() {
  // Reactivate the ship; the player has to thrust to actually take off. We
  // only nudge the position a tiny bit "out the top of the ship" so the first
  // collision check after PLAYING doesn't immediately re-land us. Also inherit
  // the planet's orbital velocity so we don't appear to drift backward as the
  // planet orbits on without us.
  lander.active = true;
  let upX = sin(lander.rotation);
  let upY = -cos(lander.rotation);
  lander.pos.x += upX * (lander.radius + 5);
  lander.pos.y += upY * (lander.radius + 5);
  if (lander.nearestPlanet && lander.nearestPlanet.getOrbitalVelocity) {
    let orb = lander.nearestPlanet.getOrbitalVelocity();
    lander.vel.set(orb.x, orb.y);
  }
  // Drop the landing anchor — back to free flight.
  lander.landingPlanet = null;
  lander.landingOffset = null;
  gameState = GAME_STATES.PLAYING;
}

// Build the launch pad wherever the ship is currently sitting. Valid once per
// run, while landed and before a pad exists. The pad becomes home base from
// here on (delivery point + workshop) and doubles as the fuel depot, so it
// tops off the tank on construction.
function buildLaunchPad() {
  if (base || !lander || gameState !== GAME_STATES.LANDED) return;
  let planet = lander.landingPlanet || lander.nearestPlanet;
  if (!planet) return;
  let angle = atan2(lander.pos.y - planet.center.y, lander.pos.x - planet.center.x);
  if (angle < 0) angle += 360;
  base = new Base(planet, angle);
  padFound = true;
  lander.fuel = lander.maxFuel;
  showEvent("Launch pad constructed! This is now home base.");
}

function tryDeliver() {
  if (!base || !lander) return;
  if (gameState !== GAME_STATES.LANDED) return;
  if (!base.inRange(lander.pos)) return;
  // Always refuel on landing at base, even with no cargo.
  lander.fuel = lander.maxFuel;
  if (cargo <= 0) return;
  let payload = cargo;
  delivered += payload;
  score += payload * 100;
  research += payload;
  cargo = 0;
  cows = cows.filter((c) => c.state !== "stowed");
  flora = flora.filter((p) => p.state !== "stowed");
  minerals = minerals.filter((m) => m.state !== "stowed");
  showEvent(`Delivered ${payload} specimen${payload === 1 ? "" : "s"}  +${payload} research`);
  if (delivered >= DELIVERY_GOAL) {
    gameState = GAME_STATES.GAMEOVER;
  }
}

function startGame() {
  // The ship is already poised just outside the atmosphere (see resetGame), so
  // starting simply hands control to physics and lets it descend — no lift-off.
  gameState = GAME_STATES.PLAYING;
  userStartAudio().then(() => {
    if (
      backgroundMusic &&
      typeof backgroundMusic.isLoaded === "function" &&
      backgroundMusic.isLoaded() &&
      !backgroundMusic.isPlaying()
    ) {
      try {
        backgroundMusic.loop();
        backgroundMusic.setVolume(0.1);
      } catch (error) {
        console.error("Error playing background music:", error);
      }
    }
  });
}

function initializeCows() {
  cows = [];
  // Spawn cows on every non-sun planet that has landable terrain.
  for (let planet of planets) {
    if (planet.isSun) continue;
    let landablePoints = planet.landscape.filter((p) => p.landable);
    if (landablePoints.length === 0) continue;

    for (let i = 0; i < 3; i++) {
      let point = random(landablePoints);
      let img = i % 2 === 0 ? alienImage : cowImage;
      // Sit cows slightly above the terrain so they're not buried.
      // The image is now centered on cow.pos and the sprite is ~50*scale tall,
      // so the cow's center needs ~half-image-height of clearance.
      cows.push(new Cow(planet, point.angle, point.r + 25, img));
    }
  }
}

// Pick a random surface angle that's above water on this planet. Returns
// {angle, surfaceR} on success or null after too many failed attempts.
function pickDryAngle(planet, maxAttempts = 20) {
  let seaR = planet.seaLevel > 0 ? planet.baseRadius + planet.seaLevel : 0;
  for (let i = 0; i < maxAttempts; i++) {
    let angle = random(360);
    let surfaceR = getSurfaceRadius(planet, angle);
    if (seaR > 0 && surfaceR < seaR) continue;
    return { angle, surfaceR };
  }
  return null;
}

// Spawn `count` instances clustered around `centerAngle`, each within
// ±halfArc° of the center. ctor takes (planet, angle, radius) and returns
// the instance, which is pushed onto `into`.
function spawnCluster(planet, centerAngle, halfArc, count, radiusOffset, into, ctor) {
  let seaR = planet.seaLevel > 0 ? planet.baseRadius + planet.seaLevel : 0;
  for (let i = 0; i < count; i++) {
    let a = centerAngle + (random() - 0.5) * 2 * halfArc;
    let surfaceR = getSurfaceRadius(planet, a);
    if (seaR > 0 && surfaceR < seaR) continue;
    into.push(ctor(planet, a, surfaceR + radiusOffset));
  }
}

function initializePlants() {
  flora = [];
  for (let planet of planets) {
    if (planet.isSun) continue;
    if (!planet.landscape || planet.landscape.length < 2) continue;

    // 3-5 groves per planet, each a cluster of 4-10 trees within a small
    // arc. Random centers (not pinned to landing pads) so players have to
    // hunt across the surface for them.
    let numGroves = floor(random(3, 6));
    for (let g = 0; g < numGroves; g++) {
      let spot = pickDryAngle(planet);
      if (!spot) continue;
      let count = floor(random(4, 11));
      let halfArc = 2 + random() * 3;
      spawnCluster(planet, spot.angle, halfArc, count, 10, flora, (pl, a, r) => {
        let plant = new Plant(pl, a, r);
        plant.scale = 0.55 + random() * 0.7;
        return plant;
      });
    }
  }
  // Render small/background trees first, big foreground trees last — gives
  // the grove a cheap parallax depth without sorting per frame.
  flora.sort((a, b) => a.scale - b.scale);
}

function initializeMinerals() {
  minerals = [];
  for (let planet of planets) {
    if (planet.isSun) continue;
    if (!planet.landscape || planet.landscape.length < 2) continue;

    // 2-4 deposits per planet, each a cluster of 4-10 rocks.
    let numDeposits = floor(random(2, 5));
    for (let d = 0; d < numDeposits; d++) {
      let spot = pickDryAngle(planet);
      if (!spot) continue;
      // Skip if the cluster center sits on a landing pad arc — keep pads clear.
      let nearPad = planet.landscape.some(
        (lp) => lp.landable && abs(((lp.angle - spot.angle + 540) % 360) - 180) < 4
      );
      if (nearPad) continue;
      let count = floor(random(4, 11));
      let halfArc = 1.5 + random() * 2;
      spawnCluster(planet, spot.angle, halfArc, count, 6, minerals, (pl, a, r) => new Mineral(pl, a, r));
    }
  }
  minerals.sort((a, b) => a.scale - b.scale);
}

/*********************************************************
 *                   VIEW & CAMERA
 *********************************************************/
function updateWorld(timeScale = 1) {
  for (let planet of planets) {
    planet.update(timeScale);
  }

  if (base) base.update(timeScale);

  // If we're parked on a body that just moved (e.g. the moon's physics orbit),
  // snap the ship to its landing offset so it rides the surface instead of
  // staying behind in world coords. lander.update is a no-op in LANDED state,
  // so the position has to be enforced here.
  if (gameState === GAME_STATES.LANDED && lander.landingPlanet && lander.landingOffset) {
    lander.pos.x = lander.landingPlanet.center.x + lander.landingOffset.x;
    lander.pos.y = lander.landingPlanet.center.y + lander.landingOffset.y;
  }

  lander.update(timeScale);
  // If thrust got cut (e.g. out of fuel mid-burn), make sure the rocket noise stops.
  if (lander.thrusting <= 0 && thrustPlaying) {
    stopThruster();
  }
  checkCollisions(lander, planets);

  // First arrival at the base completes the opening "find the launch pad"
  // objective and switches the HUD over to the abduct/deliver loop.
  if (!padFound && base && base.inRange(lander.pos)) {
    padFound = true;
    showEvent("Launch pad located!");
  }

  for (let cow of cows) {
    cow.update(timeScale);
  }

  for (let plant of flora) {
    plant.update(timeScale);
  }

  for (let mineral of minerals) {
    mineral.update(timeScale);
  }

  updateBurnParticles(timeScale);
  // Experimental GPU fluid plume — keep stepping after cutoff so the tail
  // dissipates; inject only while the engine is firing and there's fuel.
  if (DEBUG.fluidPlume) {
    let firing = lander.active && lander.thrusting > 0 && lander.fuel > 0;
    updatePlumeFluid(firing ? lander.thrusting : 0, getPlumeGround());
  }
  if (DEBUG.fluidBurn) {
    updateBurnFluid(getBurnState());
  }
  updateThrusterWaterSpray(timeScale);
  updateWaterInteraction(timeScale);
  updateSplashParticles(timeScale);
  updateDiscoveries();
  logDiagnostics();
}

function logDiagnostics() {
  if (millis() - lastDiagnosticLog < 10000) return;
  lastDiagnosticLog = millis();
  if (!lander) return;

  let elapsed = ((millis() - startTime) / 1000).toFixed(1);
  let speed = lander.vel.mag().toFixed(3);
  let pos = `(${lander.pos.x.toFixed(0)}, ${lander.pos.y.toFixed(0)})`;
  let vel = `(${lander.vel.x.toFixed(3)}, ${lander.vel.y.toFixed(3)})  |v|=${speed}`;

  // Net gravity at the ship right now (sum of all planets).
  let gx = 0, gy = 0;
  let perPlanet = [];
  for (let p of planets) {
    let dx = p.center.x - lander.pos.x;
    let dy = p.center.y - lander.pos.y;
    let d = sqrt(dx * dx + dy * dy);
    let force = p.gravity / max(1, d * d);
    let ax = (dx / max(1, d)) * force;
    let ay = (dy / max(1, d)) * force;
    gx += ax;
    gy += ay;
    perPlanet.push({
      name: p.name || (p.isSun ? "Sun" : "Planet"),
      pos: `(${p.center.x.toFixed(0)}, ${p.center.y.toFixed(0)})`,
      dist: d.toFixed(0),
      pull: sqrt(ax * ax + ay * ay).toFixed(5),
    });
  }
  let gMag = sqrt(gx * gx + gy * gy).toFixed(5);
  // Sort planets by their current pull on the ship — dominant ones at the top.
  perPlanet.sort((a, b) => parseFloat(b.pull) - parseFloat(a.pull));

  // Atmospheric density summed across all planets at the ship's position.
  let density = 0;
  let perAtmo = [];
  for (let p of planets) {
    let d = p.atmosphericDensity(lander.pos.x, lander.pos.y);
    density += d;
    if (d > 0) {
      perAtmo.push({ name: p.name || (p.isSun ? "Sun" : "Planet"), density: d.toFixed(4) });
    }
  }
  let densityClamped = min(1, density);
  let dragFactor = 1 - DEBUG.atmosphereDrag * densityClamped * timeScale;

  console.log(`--- t=${elapsed}s ---`);
  console.log(`ship pos: ${pos}`);
  console.log(`ship vel: ${vel}`);
  console.log(`net gravity: (${gx.toFixed(5)}, ${gy.toFixed(5)})  |g|=${gMag}`);
  console.log(`atmosphere density: ${densityClamped.toFixed(4)}  drag factor/frame: ${dragFactor.toFixed(4)}`);
  let leftKey  = keyIsDown(LEFT_ARROW)  || keyIsDown(KEY_A);
  let rightKey = keyIsDown(RIGHT_ARROW) || keyIsDown(KEY_D);
  let upKey    = keyIsDown(UP_ARROW)    || keyIsDown(KEY_W);
  let spaceKey = keyIsDown(32);
  console.log(`thrust: ${lander.thrusting} fuel: ${lander.fuel.toFixed(1)} rotation: ${lander.rotation.toFixed(1)}°  targetRot: ${lander.targetRotation.toFixed(1)}°`);
  console.log(`keys held — left:${leftKey} right:${rightKey} up:${upKey} space:${spaceKey} mouse:${mouseIsPressed}`);
  console.log(`DEBUG: atmoScale=${DEBUG.atmosphereScale} atmoDrag=${DEBUG.atmosphereDrag} planetScale=${DEBUG.planetRadiusScale} planetDensity=${DEBUG.planetDensity} planetSpacing=${DEBUG.planetSpacing}`);
  console.log("gravity contributions (sorted by strength):");
  console.table(perPlanet);
  if (perAtmo.length > 0) {
    console.log("atmospheres touching ship:");
    console.table(perAtmo);
  }
}

function updateBurnParticles(timeScale = 1) {
  // Re-entry burn: emit particles when the ship moves fast *relative to the
  // atmosphere it's in*. Sitting on a moving moon's surface should not glow
  // red, even though the ship's world-frame velocity is high.
  let intensity = 0;
  if (lander && lander.active) {
    let sample = lander.sampleAtmosphereAt(lander.pos);
    if (sample.density > 0) {
      let pvx = 0, pvy = 0;
      if (sample.planet && sample.planet.getOrbitalVelocity) {
        let pv = sample.planet.getOrbitalVelocity();
        pvx = pv.x;
        pvy = pv.y;
      }
      let relVx = lander.vel.x - pvx;
      let relVy = lander.vel.y - pvy;
      let relSpeed = sqrt(relVx * relVx + relVy * relVy);
      let excess = max(0, relSpeed - DEBUG.burnSpeedThreshold);
      intensity = sample.density * excess;
      // When the GPU fluid burn is on it replaces the particle flame, so skip
      // emission (heat accumulation below still runs either way).
      if (intensity > 0 && !DEBUG.fluidBurn) {
        let count = floor(intensity * DEBUG.burnIntensity * timeScale);
        for (let i = 0; i < count; i++) emitBurnParticle(intensity, relVx, relVy);
      }
    }
  }

  // Hull heating — runs regardless of active state so a landed ship cools off
  // instead of staying red-hot, but the burn-through crash only triggers
  // while the ship is alive and the game is in PLAYING.
  if (lander) {
    if (intensity > 0) {
      lander.heat += intensity * DEBUG.heatGain * timeScale;
    } else {
      lander.heat -= DEBUG.heatCool * timeScale;
    }
    lander.heat = constrain(lander.heat, 0, DEBUG.heatMax);

    if (lander.active && lander.heat >= DEBUG.heatMax && gameState === GAME_STATES.PLAYING) {
      spawnCrashEffect(lander.pos.x, lander.pos.y, lander.vel.x, lander.vel.y, lander.rotation, lander.scale);
      lander.crash();
      gameState = GAME_STATES.CRASHED;
      if (typeof showEvent === "function") showEvent("Hull burned through!");
    }
  }

  for (let i = burnParticles.length - 1; i >= 0; i--) {
    let p = burnParticles[i];
    p.x += p.vx * timeScale;
    p.y += p.vy * timeScale;
    p.vx *= 0.94;
    p.vy *= 0.94;
    p.life -= 0.025 * timeScale;
    if (p.life <= 0) burnParticles.splice(i, 1);
  }
}

// Water contact: emit a splash burst the first frame the ship crosses sea
// level, drag heavily while submerged, and crash once fully underwater. The
// "fully submerged" rule (dCenter < rSea - radius) means the player gets one
// brief moment to see the splash before drowning.
function updateWaterInteraction(timeScale = 1) {
  if (!lander || !lander.active) return;
  if (gameState !== GAME_STATES.PLAYING) return;
  let planet = lander.nearestPlanet;
  if (!planet || !planet.seaLevel || planet.seaLevel <= 0) return;

  let dx = lander.pos.x - planet.center.x;
  let dy = lander.pos.y - planet.center.y;
  let dCenter = sqrt(dx * dx + dy * dy);
  let rSea = planet.baseRadius + planet.seaLevel;

  let touchingWater = dCenter < rSea + lander.radius;
  if (!touchingWater) {
    lander.inWater = false;
    return;
  }

  if (!lander.inWater) {
    emitWaterSplashBurst(planet, lander.pos, lander.vel);
    lander.inWater = true;
  }

  // Heavy drag, time-scale invariant. Gravity keeps pulling toward the
  // planet center each frame so the ship still settles downward.
  let dragPerFrame = pow(0.92, timeScale);
  lander.vel.x *= dragPerFrame;
  lander.vel.y *= dragPerFrame;

  // Trickle of bubbles while sinking so the ship isn't a silent rock.
  if (frameCount % 4 === 0) emitWaterBubble(planet, lander.pos);

  if (dCenter < rSea - lander.radius) {
    spawnCrashEffect(lander.pos.x, lander.pos.y, lander.vel.x, lander.vel.y, lander.rotation, lander.scale);
    lander.crash();
    gameState = GAME_STATES.CRASHED;
  }
}

// Engine exhaust hitting the sea: while the ship thrusts low over water, fan a
// continuous sheet of spray up off the surface foot under the nozzle. Reuses the
// splash particle system so the droplets arc back down under the planet's
// gravity. Independent of the GPU plume so it works with the particle flame too.
function updateThrusterWaterSpray(timeScale = 1) {
  if (!lander || !lander.active) return;
  if (gameState !== GAME_STATES.PLAYING) return;
  if (lander.thrusting <= 0 || lander.fuel <= 0) return;
  let ground = getPlumeGround();
  if (!ground || !ground.onWater) return;
  // Only once the blast is close enough to disturb the surface.
  let reach = 140;
  if (ground.dist > reach) return;
  let planet = lander.nearestPlanet;
  if (!planet) return;

  // Stronger, denser spray the closer and harder the engine pushes.
  let prox = constrain(1 - ground.dist / reach, 0, 1);
  let intensity = lander.thrusting * prox;
  let count = floor(intensity * 6 * timeScale);
  let nx = ground.nx, ny = ground.ny;   // radial (outward) over the flat sea
  let tx = -ny, ty = nx;                 // tangent along the surface
  for (let i = 0; i < count; i++) {
    let nFactor = random(0.6, 1.3);
    let tFactor = random(-1.2, 1.2);     // wide fan as the exhaust splays sideways
    let spd = random(2, 6) * (0.6 + intensity);
    splashParticles.push({
      x: ground.px + tx * random(-12, 12),
      y: ground.py + ty * random(-12, 12),
      vx: (nx * nFactor + tx * tFactor) * spd,
      vy: (ny * nFactor + ty * tFactor) * spd,
      planet: planet,
      life: random(0.5, 1.0),
      size: random(2, 5),
      bubble: false
    });
  }
}

function emitWaterSplashBurst(planet, pos, vel) {
  let speed = vel.mag();
  let count = floor(constrain(speed * 1.5, 12, 60));
  // Outward normal from planet center to splash origin.
  let dx = pos.x - planet.center.x;
  let dy = pos.y - planet.center.y;
  let d = max(1, sqrt(dx * dx + dy * dy));
  let nx = dx / d;
  let ny = dy / d;
  let tx = -ny;
  let ty = nx;
  let baseSpeed = constrain(speed * 0.4, 2, 8);
  for (let i = 0; i < count; i++) {
    // Mostly upward (outward) with a tangential spread to fan the spray out.
    let nFactor = random(0.4, 1.1);
    let tFactor = random(-0.8, 0.8);
    let spd = baseSpeed * random(0.6, 1.4);
    splashParticles.push({
      x: pos.x,
      y: pos.y,
      vx: (nx * nFactor + tx * tFactor) * spd,
      vy: (ny * nFactor + ty * tFactor) * spd,
      planet: planet,
      life: random(0.7, 1.3),
      size: random(2.5, 6),
      bubble: false
    });
  }
}

function emitWaterBubble(planet, pos) {
  let dx = pos.x - planet.center.x;
  let dy = pos.y - planet.center.y;
  let d = max(1, sqrt(dx * dx + dy * dy));
  let nx = dx / d;
  let ny = dy / d;
  let tx = -ny;
  let ty = nx;
  let jitter = random(-lander.radius * 0.6, lander.radius * 0.6);
  splashParticles.push({
    x: pos.x + tx * jitter,
    y: pos.y + ty * jitter,
    // Bubbles drift outward (toward the surface) slowly. Gravity will fight
    // them but they're short-lived so they read as upward motion.
    vx: nx * random(0.4, 1.2),
    vy: ny * random(0.4, 1.2),
    planet: planet,
    life: random(0.4, 0.9),
    size: random(1.5, 3.5),
    bubble: true
  });
}

function updateSplashParticles(timeScale = 1) {
  for (let i = splashParticles.length - 1; i >= 0; i--) {
    let p = splashParticles[i];
    if (p.planet) {
      let dx = p.planet.center.x - p.x;
      let dy = p.planet.center.y - p.y;
      let dSq = max(1, dx * dx + dy * dy);
      let d = sqrt(dSq);
      // Bubbles get a fraction of gravity so they appear to rise; splash
      // droplets feel full gravity and arc back down.
      let g = p.bubble ? p.planet.gravity * 0.15 : p.planet.gravity;
      let force = g / dSq;
      p.vx += (dx / d) * force * timeScale;
      p.vy += (dy / d) * force * timeScale;
    }
    p.x += p.vx * timeScale;
    p.y += p.vy * timeScale;
    p.life -= 0.025 * timeScale;
    if (p.life <= 0) splashParticles.splice(i, 1);
  }
}

function drawSplashParticles() {
  noStroke();
  for (let p of splashParticles) {
    let alpha = 230 * p.life;
    if (p.bubble) {
      fill(200, 230, 255, alpha * 0.7);
      circle(p.x, p.y, p.size * (0.5 + p.life * 0.5));
    } else {
      // Bright white core with a blue halo so droplets pop against the dark water.
      fill(150, 200, 240, alpha * 0.5);
      circle(p.x, p.y, p.size * 1.4);
      fill(230, 245, 255, alpha);
      circle(p.x, p.y, p.size * (0.5 + p.life * 0.6));
    }
  }
}

function emitBurnParticle(intensity, relVx, relVy) {
  // Direction is the ship's motion *through the atmosphere*, not its world-
  // frame velocity. On a moving moon those differ by ~35 px/frame.
  let speed = sqrt(relVx * relVx + relVy * relVy);
  if (speed === 0) return;
  let dirX = relVx / speed;
  let dirY = relVy / speed;
  // Leading edge of the ship, with a bit of jitter so it's not a single point.
  let lateralX = -dirY;
  let lateralY = dirX;
  let jitter = random(-lander.radius * 0.6, lander.radius * 0.6);
  let emitX = lander.pos.x + dirX * lander.radius + lateralX * jitter;
  let emitY = lander.pos.y + dirY * lander.radius + lateralY * jitter;

  // Trail drifts with the actual ship velocity (world frame) so particles
  // appear left behind as the ship sweeps along its real path.
  let trailAngle = atan2(-dirY, -dirX) + random(-22, 22);
  let trailSpeed = random(0.8, 2.2);
  let pvx = cos(trailAngle) * trailSpeed + lander.vel.x * 0.35;
  let pvy = sin(trailAngle) * trailSpeed + lander.vel.y * 0.35;

  burnParticles.push({
    x: emitX,
    y: emitY,
    vx: pvx,
    vy: pvy,
    life: random(0.55, 1.0),
    size: random(3, 7) * (1 + min(intensity, 30) * 0.04),
    hot: random(0.4, 1.0)
  });
}

const LASER_MAX_RANGE = 1800;
const LASER_HIT_RADIUS = 36;

function fireLaser(screenX, screenY) {
  if (!lander || !lander.active) return;
  if (gameState !== GAME_STATES.PLAYING) return;

  let target = screenToWorld(screenX, screenY);
  let dx = target.x - lander.pos.x;
  let dy = target.y - lander.pos.y;
  let d = sqrt(dx * dx + dy * dy);
  if (d < 1) return;
  let nx = dx / d;
  let ny = dy / d;

  let hitDist = LASER_MAX_RANGE;
  let hitTarget = null;

  // Closest plant whose center lies within LASER_HIT_RADIUS of the ray.
  for (let plant of flora) {
    if (plant.state !== "growing") continue;
    let pdx = plant.pos.x - lander.pos.x;
    let pdy = plant.pos.y - lander.pos.y;
    let along = pdx * nx + pdy * ny;
    if (along < 0 || along > hitDist) continue;
    let perpX = pdx - nx * along;
    let perpY = pdy - ny * along;
    let perpD = sqrt(perpX * perpX + perpY * perpY);
    if (perpD < LASER_HIT_RADIUS) {
      hitDist = along;
      hitTarget = plant;
    }
  }

  // Minerals share the same ray-hit test as plants.
  for (let mineral of minerals) {
    if (mineral.state !== "intact") continue;
    let mdx = mineral.pos.x - lander.pos.x;
    let mdy = mineral.pos.y - lander.pos.y;
    let along = mdx * nx + mdy * ny;
    if (along < 0 || along > hitDist) continue;
    let perpX = mdx - nx * along;
    let perpY = mdy - ny * along;
    let perpD = sqrt(perpX * perpX + perpY * perpY);
    if (perpD < LASER_HIT_RADIUS) {
      hitDist = along;
      hitTarget = mineral;
    }
  }

  // Terrain blocks the laser. Check the nearest planet, which is usually the one
  // the player is hovering over and the only one within range anyway.
  if (lander.nearestPlanet) {
    let terrainHit = rayHitsTerrain(lander.pos, nx, ny, LASER_MAX_RANGE, lander.nearestPlanet);
    if (terrainHit < hitDist) {
      hitDist = terrainHit;
      hitTarget = null;
    }
  }

  let endX = lander.pos.x + nx * hitDist;
  let endY = lander.pos.y + ny * hitDist;

  lasers.push({ endX, endY, life: 1 });

  if (hitTarget) hitTarget.zap();
}

function updateAndDrawLasers(timeScaleLocal = 1) {
  if (lasers.length === 0) return;
  push();
  blendMode(ADD);
  for (let i = lasers.length - 1; i >= 0; i--) {
    let L = lasers[i];
    L.life -= 0.12 * timeScaleLocal;
    if (L.life <= 0) { lasers.splice(i, 1); continue; }

    let sx = lander.pos.x;
    let sy = lander.pos.y;
    let ex = L.endX;
    let ey = L.endY;
    let life = L.life;

    strokeWeight(10);
    stroke(255, 60, 180, 60 * life);
    line(sx, sy, ex, ey);
    strokeWeight(5);
    stroke(255, 120, 220, 160 * life);
    line(sx, sy, ex, ey);
    strokeWeight(1.5);
    stroke(255, 230, 250, 255 * life);
    line(sx, sy, ex, ey);

    noStroke();
    fill(255, 120, 220, 200 * life);
    circle(ex, ey, 9 * life);
    fill(255, 230, 250, 230 * life);
    circle(ex, ey, 4 * life);
  }
  pop();
}

function drawBurnParticles() {
  noStroke();
  for (let p of burnParticles) {
    let alpha = 220 * p.life;
    // Hotter particles start yellow-white, cool toward red as they age.
    let r = 255;
    let g = floor(60 + 180 * p.life * p.hot);
    let b = floor(20 * p.life * p.hot);
    fill(r, g, b, alpha);
    circle(p.x, p.y, p.size * (0.4 + p.life * 0.6));
  }
}

// Each ship part has a draw function (centered on its own origin) and the
// local-frame offset where it lived on the hull. On crash we copy these into
// "part" particles that fly outward from where they were attached.
const SHIP_PARTS = [
  { lx: 0,   ly: -22, draw: drawCrashConeChunk },
  { lx: 0,   ly: -6,  draw: drawCrashHullTopChunk },
  { lx: 0,   ly: 8,   draw: drawCrashHullBottomChunk },
  { lx: 0,   ly: -13, draw: drawCrashCockpitChunk },
  { lx: -23, ly: 10,  draw: drawCrashLeftFinChunk },
  { lx: 23,  ly: 10,  draw: drawCrashRightFinChunk },
  { lx: 0,   ly: 18,  draw: drawCrashEngineBellChunk },
  { lx: 0,   ly: -32, draw: drawCrashAntennaChunk },
];

// One-shot pyrotechnics for a fatal crash: a flash, an expanding shockwave
// ring, the ship's own components flying apart Lunar-Lander style, plus
// embers, smaller debris, and lingering smoke.
function spawnCrashEffect(x, y, vx = 0, vy = 0, shipRot = 0, shipScale = 0.8) {
  crashParticles.push({ kind: "flash", x, y, life: 1 });
  crashParticles.push({ kind: "shockwave", x, y, radius: 6, maxRadius: 110, life: 1 });

  let inheritVx = vx * 0.3;
  let inheritVy = vy * 0.3;

  // Ship components — each piece spawns at the world-space location it was
  // attached, then accelerates outward from the ship center so it visibly
  // separates from its neighbors.
  for (let part of SHIP_PARTS) {
    let lxS = part.lx * shipScale;
    let lyS = part.ly * shipScale;
    let cr = cos(shipRot);
    let sr = sin(shipRot);
    let dx = lxS * cr - lyS * sr;
    let dy = lxS * sr + lyS * cr;
    let wx = x + dx;
    let wy = y + dy;

    // Outward direction = from ship center toward this part. Add a small
    // angular perturbation so the spray doesn't look like a wheel.
    let mag = sqrt(dx * dx + dy * dy);
    let nx, ny;
    if (mag > 0.01) {
      nx = dx / mag;
      ny = dy / mag;
    } else {
      let a = random(360);
      nx = cos(a); ny = sin(a);
    }
    let perturb = random(-30, 30);
    let pnx = nx * cos(perturb) - ny * sin(perturb);
    let pny = nx * sin(perturb) + ny * cos(perturb);
    let outSpeed = random(2.5, 5.5);

    crashParticles.push({
      kind: "part",
      x: wx, y: wy,
      vx: pnx * outSpeed + inheritVx,
      vy: pny * outSpeed + inheritVy - random(0.4, 1.4),
      rot: shipRot,
      rotSpeed: random(-22, 22),
      scale: shipScale,
      draw: part.draw,
      life: 1,
      decay: random(0.003, 0.006),  // parts linger long enough to read
    });
  }

  // A handful of small generic chunks for visual confetti around the parts.
  for (let i = 0; i < 10; i++) {
    let a = random(360);
    let s = random(2, 7);
    crashParticles.push({
      kind: "debris", x, y,
      vx: cos(a) * s + inheritVx,
      vy: sin(a) * s + inheritVy - 1,
      rot: random(360),
      rotSpeed: random(-25, 25),
      size: random(1.5, 3.5),
      life: 1,
      decay: random(0.006, 0.014),
      hull: random() < 0.55,
    });
  }

  for (let i = 0; i < 22; i++) {
    let a = random(360);
    let s = random(3, 10);
    crashParticles.push({
      kind: "spark", x, y,
      vx: cos(a) * s + inheritVx,
      vy: sin(a) * s + inheritVy - 1.5,
      life: 1,
      decay: random(0.025, 0.05),
      size: random(1, 2.6),
    });
  }

  for (let i = 0; i < 14; i++) {
    let a = random(360);
    let s = random(0.5, 2);
    crashParticles.push({
      kind: "smoke",
      x: x + random(-4, 4),
      y: y + random(-4, 4),
      vx: cos(a) * s,
      vy: sin(a) * s - 0.4,
      life: 1,
      decay: random(0.004, 0.01),
      size: random(8, 16),
    });
  }
}

// Ship-part draw helpers — each renders one chunk of the rocket centered on
// (0,0) so it can tumble around its own pivot. Colors mirror drawShipBody().
function drawCrashConeChunk() {
  noStroke();
  fill(70, 80, 95);
  // Cone tip + a slice of the upper hull around it.
  beginShape();
  vertex(0, -8);
  vertex(-7, 4);
  vertex(7, 4);
  endShape(CLOSE);
}

function drawCrashHullTopChunk() {
  noStroke();
  fill(70, 80, 95);
  beginShape();
  vertex(-14, -6);
  vertex(-18, 6);
  vertex(18, 6);
  vertex(14, -6);
  endShape(CLOSE);
  fill(120, 200, 220);
  rect(-6, -4, 12, 10);
}

function drawCrashHullBottomChunk() {
  noStroke();
  fill(70, 80, 95);
  rect(-18, -6, 36, 12);
  stroke(60, 200, 200);
  strokeWeight(1.4);
  line(-17, -2, 17, -2);
}

function drawCrashCockpitChunk() {
  noStroke();
  fill(80, 220, 160);
  ellipse(0, 0, 14, 10);
  fill(220, 255, 230, 200);
  ellipse(-2, -2, 5, 3);
}

function drawCrashLeftFinChunk() {
  noStroke();
  fill(50, 60, 75);
  triangle(2, -9, -8, 9, 2, 5);
  stroke(70, 220, 200);
  strokeWeight(1.4);
  line(2, -9, -8, 9);
}

function drawCrashRightFinChunk() {
  noStroke();
  fill(50, 60, 75);
  triangle(-2, -9, 8, 9, -2, 5);
  stroke(70, 220, 200);
  strokeWeight(1.4);
  line(-2, -9, 8, 9);
}

function drawCrashEngineBellChunk() {
  noStroke();
  fill(40, 45, 55);
  rect(-6, -3, 12, 4);
  fill(20, 25, 30);
  rect(-4, 1, 8, 3);
}

function drawCrashAntennaChunk() {
  stroke(150, 170, 185);
  strokeWeight(1);
  line(0, -5, 0, 3);
  noStroke();
  fill(255, 90, 90);
  circle(0, -6, 3);
}

function updateCrashParticles(timeScale = 1) {
  for (let i = crashParticles.length - 1; i >= 0; i--) {
    let p = crashParticles[i];
    switch (p.kind) {
      case "flash":
        p.life -= 0.09 * timeScale;
        break;
      case "shockwave":
        p.radius += (p.maxRadius - p.radius) * 0.14 * timeScale;
        p.life -= 0.035 * timeScale;
        break;
      case "debris":
      case "part":
        p.x += p.vx * timeScale;
        p.y += p.vy * timeScale;
        p.vy += 0.14 * timeScale;        // gravity
        p.vx *= 0.99;
        p.vy *= 0.99;
        p.rot += p.rotSpeed * timeScale;
        p.life -= p.decay * timeScale;
        break;
      case "spark":
        p.x += p.vx * timeScale;
        p.y += p.vy * timeScale;
        p.vy += 0.1 * timeScale;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.life -= p.decay * timeScale;
        break;
      case "smoke":
        p.x += p.vx * timeScale;
        p.y += p.vy * timeScale;
        p.vx *= 0.96;
        p.vy *= 0.97;
        p.size += 0.4 * timeScale;       // smoke billows outward
        p.life -= p.decay * timeScale;
        break;
    }
    if (p.life <= 0) crashParticles.splice(i, 1);
  }
}

function drawCrashParticles() {
  push();
  noStroke();

  // Smoke first so debris and sparks sit on top of it.
  for (let p of crashParticles) {
    if (p.kind !== "smoke") continue;
    fill(60, 60, 65, 160 * p.life);
    circle(p.x, p.y, p.size);
  }

  // Tumbling ship components — uses canvas globalAlpha so each chunk's draw
  // routine can stay simple (no need to thread alpha through every fill/stroke).
  for (let p of crashParticles) {
    if (p.kind !== "part") continue;
    drawingContext.globalAlpha = constrain(p.life, 0, 1);
    push();
    translate(p.x, p.y);
    scale(p.scale);
    rotate(p.rot);
    p.draw();
    pop();
  }
  drawingContext.globalAlpha = 1;

  // Small generic chunks of confetti around the parts.
  for (let p of crashParticles) {
    if (p.kind !== "debris") continue;
    let a = 230 * p.life;
    if (p.hull) fill(85, 95, 110, a);
    else        fill(120, 200, 220, a);
    push();
    translate(p.x, p.y);
    rotate(p.rot);
    rect(-p.size / 2, -p.size / 2, p.size, p.size);
    pop();
  }

  // Shockwave ring + flash + embers all add together for a hot pop.
  push();
  blendMode(ADD);

  for (let p of crashParticles) {
    if (p.kind !== "shockwave") continue;
    noFill();
    stroke(255, 200, 80, 220 * p.life);
    strokeWeight(3 * p.life);
    circle(p.x, p.y, p.radius * 2);
  }
  noStroke();

  for (let p of crashParticles) {
    if (p.kind !== "spark") continue;
    fill(255, floor(180 * p.life), 60, 255 * p.life);
    circle(p.x, p.y, p.size);
  }

  for (let p of crashParticles) {
    if (p.kind !== "flash") continue;
    fill(255, 250, 220, 240 * p.life);
    circle(p.x, p.y, 90 * (1.3 - p.life));
  }

  pop();
  pop();
}

function updateDiscoveries() {
  for (let planet of planets) {
    if (planet.discovered || planet.isSun) continue;
    if (getSurfaceDistance(lander.pos, planet) < DISCOVERY_DISTANCE) {
      planet.discovered = true;
      score += 25;
      showEvent(`Discovered ${planet.name}  +25 score`);
    }
  }
}

function showEvent(message, duration = 2800) {
  eventMessage = message;
  eventMessageUntil = millis() + duration;
}

function resetView() {
  view.scale = 1;
  view.focusX = lander ? lander.pos.x : 0;
  view.focusY = lander ? lander.pos.y : 0;
  // Align the camera so gravity from the ship's nearest planet points
  // screen-down on the very first frame. updateView() keeps it aligned from
  // there; this just avoids a visible roll-into-place right after a reset.
  if (lander && lander.nearestPlanet) {
    let ax = lander.pos.x - lander.nearestPlanet.center.x;
    let ay = lander.pos.y - lander.nearestPlanet.center.y;
    view.rotation = -90 - atan2(ay, ax);
  } else {
    view.rotation = 0;
  }
}

function computeOverviewBox() {
  // Bounding box covering every planet's full orbital extent (orbitCenter ±
  // orbitRadius) plus its atmosphere radius. Using orbital extent instead of
  // current position keeps the framing stable as planets move.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let p of planets) {
    let r = (p.atmosphereOuterRadius ? p.atmosphereOuterRadius() : p.baseRadius) || 0;
    let cx, cy, reach;
    if (p.orbitCenter && p.orbitRadius > 0) {
      cx = p.orbitCenter.x;
      cy = p.orbitCenter.y;
      reach = p.orbitRadius + r;
    } else {
      cx = p.center.x;
      cy = p.center.y;
      reach = r;
    }
    minX = Math.min(minX, cx - reach);
    minY = Math.min(minY, cy - reach);
    maxX = Math.max(maxX, cx + reach);
    maxY = Math.max(maxY, cy + reach);
  }
  return { minX, minY, maxX, maxY };
}

function updateView() {
  let targetScale;
  let targetFocusX, targetFocusY;
  let trackShip = true;

  if (overviewMode) {
    let box = computeOverviewBox();
    let boxW = max(1, box.maxX - box.minX);
    let boxH = max(1, box.maxY - box.minY);
    // 0.85 leaves some padding around the bounding box.
    targetScale = Math.min(width / boxW, height / boxH) * 0.85;
    targetFocusX = (box.minX + box.maxX) / 2;
    targetFocusY = (box.minY + box.maxY) / 2;
    trackShip = false;
  } else if (DEBUG.zoomOverride > 0) {
    // Manual zoom — debug flag forces a specific scale regardless of altitude.
    targetScale = DEBUG.zoomOverride;
  } else {
    // Altitude-based framing split at the atmosphere boundary. The atmosphere is
    // thick relative to any sane fixed zoom range, so a single curve either keeps
    // you zoomed out through the whole descent (can't see the surface) or zoomed
    // in from space (planet off-screen). Instead:
    //   - Outside the atmosphere: frame the planet — surface distance maps to
    //     cameraFraming of screen height, so the body stays a sensible size on
    //     approach and the camera eases out as you climb.
    //   - Inside the atmosphere: ramp from that same boundary framing up to
    //     cameraGroundZoom at the surface, so terrain/cows get readable as you
    //     descend. The two regimes share the boundary value, so there's no jump.
    // atmosphereOuterRadius() returns baseRadius * (1 + atmosphereScale) for every
    // body, so airless planets (the moon) get a hypothetical boundary too.
    let { planet, surfaceDistance } = getClosestPlanetInfo();
    let atmoThickness = max(1, planet.atmosphereOuterRadius() - planet.baseRadius);
    // Zoom that frames the planet at the atmosphere top — the shared knot point.
    let boundaryScale = (height * DEBUG.cameraFraming) / atmoThickness;

    if (surfaceDistance <= atmoThickness) {
      // 1 at the atmosphere top, 0 at the surface.
      let f = surfaceDistance / atmoThickness;
      targetScale = lerp(DEBUG.cameraGroundZoom, boundaryScale, f);
    } else {
      // Outside: keep the surface framed at cameraFraming of screen height. At the
      // boundary this equals boundaryScale, so it joins the inside ramp smoothly.
      targetScale = (height * DEBUG.cameraFraming) / surfaceDistance;
    }
    targetScale = max(0.02, targetScale);
  }

  // Layer the player's manual zoom on top of the automatic framing so it
  // tracks altitude/overview changes relative to where they dialed it.
  targetScale *= view.userZoom;

  view.scale += (targetScale - view.scale) * CAMERA_ZOOM_EASE;

  if (trackShip) {
    // Add the ship's world-frame velocity each step so easing only has to
    // correct displacement, not chase a constantly-moving target. Without this
    // the focus lags by vel/ease pixels at steady state (~190 px when riding
    // the moon at 35 px/frame).
    let worldVx = lander.vel.x;
    let worldVy = lander.vel.y;
    if (gameState === GAME_STATES.LANDED && lander.landingPlanet && lander.landingPlanet.getOrbitalVelocity) {
      let pv = lander.landingPlanet.getOrbitalVelocity();
      worldVx = pv.x;
      worldVy = pv.y;
    }
    view.focusX += worldVx * timeScale + (lander.pos.x - view.focusX) * CAMERA_FOLLOW_EASE;
    view.focusY += worldVy * timeScale + (lander.pos.y - view.focusY) * CAMERA_FOLLOW_EASE;

    // Roll the camera so gravity always points screen-down — keeps you upright
    // on a planet's surface no matter which side you landed on, and smoothly
    // swings the horizon as you fly around the body. Uses net gravity (summed
    // over all planets) so the camera follows whichever world dominates instead
    // of snapping between them. Skipped in deep space where pull is negligible
    // and "down" is meaningless, leaving the current roll untouched.
    let gx = 0, gy = 0;
    for (let p of planets) {
      let dx = p.center.x - lander.pos.x;
      let dy = p.center.y - lander.pos.y;
      let dSq = max(1, dx * dx + dy * dy);
      let d = sqrt(dSq);
      let force = p.gravity / dSq;
      gx += (dx / d) * force;
      gy += (dy / d) * force;
    }
    if (gx * gx + gy * gy > 1e-12) {
      // Target roll that puts the gravity vector at screen-down (90°). Matches
      // the formula resetView() uses for the spawn alignment.
      let targetRotation = 90 - atan2(gy, gx);
      // Shortest angular path so a 359°→1° wrap doesn't spin the long way.
      let delta = ((targetRotation - view.rotation + 540) % 360) - 180;
      view.rotation += delta * CAMERA_ROLL_EASE;
    }
  } else {
    view.focusX += (targetFocusX - view.focusX) * CAMERA_FOLLOW_EASE;
    view.focusY += (targetFocusY - view.focusY) * CAMERA_FOLLOW_EASE;
  }
}

// Nearest body (by distance to its terrain) and that distance. The camera frames
// whichever world dominates, so it needs the planet itself, not just the gap.
function getClosestPlanetInfo() {
  let closest = planets[0];
  let closestDistance = Infinity;

  for (let planet of planets) {
    let surfaceDistance = getSurfaceDistance(lander.pos, planet);
    if (surfaceDistance < closestDistance) {
      closestDistance = surfaceDistance;
      closest = planet;
    }
  }

  return { planet: closest, surfaceDistance: closestDistance };
}

// Build the ground half-plane the experimental GPU fluid plume collides
// against: the planet surface directly under the engine nozzle, expressed as a
// world point + outward normal (plus the nozzle's altitude). The plume sim maps
// this into its local grid. Returns null when there's nothing solid below.
function getPlumeGround() {
  if (!lander || !lander.active) return null;
  let { planet } = getClosestPlanetInfo();
  if (!planet || planet.isSun) return null;
  let nozzle = lander.localToWorld(0, 21);
  let dx = nozzle.x - planet.center.x;
  let dy = nozzle.y - planet.center.y;
  let dist = sqrt(dx * dx + dy * dy);
  if (dist === 0) return null;
  let angle = atan2(dy, dx);            // degrees (angleMode DEGREES)
  if (angle < 0) angle += 360;
  let surfR = getSurfaceRadius(planet, angle);

  // Local terrain normal from the actual landscape slope (not the radial
  // sphere normal) so the wall tilts with hills. Sample the surface a couple
  // degrees either side and take the perpendicular of that tangent.
  let dA = 2;
  let a0 = angle - dA; if (a0 < 0) a0 += 360;
  let a1 = angle + dA; if (a1 >= 360) a1 -= 360;
  let r0 = getSurfaceRadius(planet, a0);
  let r1 = getSurfaceRadius(planet, a1);
  let p0x = planet.center.x + r0 * cos(a0), p0y = planet.center.y + r0 * sin(a0);
  let p1x = planet.center.x + r1 * cos(a1), p1y = planet.center.y + r1 * sin(a1);
  let nx = p1y - p0y, ny = -(p1x - p0x);  // perpendicular to the tangent
  if (nx * dx + ny * dy < 0) { nx = -nx; ny = -ny; }  // point outward (away from core)
  let nm = sqrt(nx * nx + ny * ny) || 1;
  nx /= nm; ny /= nm;

  // If the spot under the nozzle is flooded, the exhaust hits the water surface
  // rather than the seabed: raise the collision foot to sea level and flatten
  // the normal to radial (a calm sea has no slope). `onWater` lets the caller
  // kick up spray instead of dust.
  let onWater = false;
  let seaR = planet.seaLevel > 0 ? planet.baseRadius + planet.seaLevel : 0;
  if (seaR > surfR && dist > seaR) {
    surfR = seaR;
    onWater = true;
    nx = dx / dist;
    ny = dy / dist;
  }

  return {
    nozzle,
    angleDeg: lander.rotation,
    px: planet.center.x + (dx / dist) * surfR,  // surface foot under the nozzle
    py: planet.center.y + (dy / dist) * surfR,
    nx, ny,                                      // local terrain normal
    dist: dist - surfR,                          // nozzle altitude above surface
    onWater,
  };
}

// Build the state the experimental GPU fluid re-entry burn needs: the ship's
// velocity relative to the air it's in, the burn intensity (atmospheric density
// × speed over the burn threshold — the same signal the particle burn uses), and
// the ship pose. Returns null when there's no ship. Intensity may be 0 (no
// atmosphere / too slow), in which case the wake just dissipates.
function getBurnState() {
  if (!lander || !lander.active) return null;
  let sample = lander.sampleAtmosphereAt(lander.pos);
  let pvx = 0, pvy = 0;
  if (sample && sample.planet && sample.planet.getOrbitalVelocity) {
    let pv = sample.planet.getOrbitalVelocity();
    pvx = pv.x; pvy = pv.y;
  }
  let relVx = lander.vel.x - pvx;
  let relVy = lander.vel.y - pvy;
  let relSpeed = sqrt(relVx * relVx + relVy * relVy);
  let density = sample ? sample.density : 0;
  let excess = max(0, relSpeed - DEBUG.burnSpeedThreshold);
  return {
    intensity: density * excess,
    relVx, relVy, relSpeed,
    rotationDeg: lander.rotation,
    scale: lander.scale,
    center: lander.pos,
  };
}

function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

function angleDelta(a, b) {
  return ((a - b + 540) % 360) - 180;
}

// Continuous view angle around a planet. Parallax layers use this instead of
// the wrapped 0..360 angle so they drift smoothly across the seam.
function getPlanetViewAngle(planet) {
  if (!planet || !lander) return 0;
  let dx = lander.pos.x - planet.center.x;
  let dy = lander.pos.y - planet.center.y;
  if (dx === 0 && dy === 0) return planet._parallaxViewAngle || 0;
  let angle = normalizeAngle(atan2(dy, dx));
  if (planet._parallaxViewAngle === undefined) {
    planet._parallaxViewAngle = angle;
  } else {
    planet._parallaxViewAngle += angleDelta(angle, planet._parallaxViewAngle);
  }
  return planet._parallaxViewAngle;
}

// Soft elliptical contact shadow on the surface directly under the ship. It
// sits slightly "below" the terrain contact in local screen-down space so the
// ship reads more like a 2D sprite hovering over a flat layer.
function drawLanderShadow() {
  if (!lander || lander.crashed) return;
  let { planet } = getClosestPlanetInfo();
  if (!planet || planet.isSun) return;
  let dx = lander.pos.x - planet.center.x;
  let dy = lander.pos.y - planet.center.y;
  let dist = sqrt(dx * dx + dy * dy);
  if (dist < 1) return;
  let angle = atan2(dy, dx);
  if (angle < 0) angle += 360;
  let surfR = getSurfaceRadius(planet, angle);
  let altitude = dist - surfR;
  const MAX_ALT = 520;
  if (altitude < -30 || altitude > MAX_ALT) return;
  let nx = dx / dist, ny = dy / dist;
  let fx = planet.center.x + nx * surfR;
  let fy = planet.center.y + ny * surfR;
  // f: 1 on the deck -> 0 at MAX_ALT. Low = darker + tighter.
  let f = constrain(1 - altitude / MAX_ALT, 0, 1);
  f = pow(f, 0.75);
  let w = lander.radius * 2.8 * (1.05 + (1 - f) * 1.9);
  let h = w * 0.16;
  let drop = 10 + (1 - f) * 22;
  push();
  translate(fx, fy);
  rotate(angle + 90);   // flatten the ellipse onto the surface tangent
  noStroke();
  fill(0, 0, 0, 55 * f);
  ellipse(0, drop + 2, w * 1.2, h * 1.25);
  fill(0, 0, 0, 95 * f);
  ellipse(0, drop, w, h);
  pop();
}

// Lazily scatter trees across a vegetated world's land vertices. Cached on
// the planet so the layout is stable between frames. Deterministic per vertex
// index (no global random state touched) and skips anything below the
// waterline so trees never grow out of the sea.
function ensureTrees(planet) {
  if (planet._trees) return planet._trees;
  let trees = [];
  if (planet.seaLevel > 0 && planet.landscape) {
    let seaR = planet.baseRadius + planet.seaLevel;
    for (let i = 0; i < planet.landscape.length - 1; i++) {
      let p = planet.landscape[i];
      if (p.r <= seaR + 30) continue;                  // land only
      let hsh = Math.sin(i * 12.9898) * 43758.5453;
      hsh = hsh - Math.floor(hsh);                     // 0..1 hash
      if (hsh > 0.35) continue;                        // ~1/3 of land gets a tree
      let layer = hsh / 0.35;
      let seed = Math.sin(i * 78.233) * 43758.5453;
      seed = seed - Math.floor(seed);
      trees.push({
        angle: p.angle,
        r: p.r,
        size: 12 + layer * 30,
        kind: floor(seed * 3),
        depth: 0.07 + layer * 0.26,
        seed,
        phase: seed * 360,
        lean: seed * 2 - 1,
      });
    }
  }
  planet._trees = trees;
  return trees;
}

function drawSwayingTreeSprite(t, drawAngle, alpha) {
  let size = t.size;
  let wind = sin(frameCount * (1.15 + t.depth * 1.4) + t.phase) * (2.0 + t.depth * 7.0);
  let lean = t.lean * size * 0.09;
  let topX = lean + wind * 0.38;
  let trunkTop = -size * 0.78;

  // Tapered trunk. The base stays planted while the crown bends with wind.
  noStroke();
  fill(62, 45, 32, alpha);
  beginShape();
  vertex(-size * 0.12, 4);
  bezierVertex(-size * 0.08, -size * 0.25, topX - size * 0.07, trunkTop * 0.75, topX - size * 0.05, trunkTop);
  vertex(topX + size * 0.06, trunkTop);
  bezierVertex(topX + size * 0.02, trunkTop * 0.7, size * 0.11, -size * 0.2, size * 0.13, 4);
  endShape(CLOSE);

  fill(95, 68, 42, alpha * 0.55);
  beginShape();
  vertex(-size * 0.03, 2);
  bezierVertex(size * 0.01, -size * 0.22, topX + size * 0.015, trunkTop * 0.7, topX + size * 0.025, trunkTop);
  vertex(topX + size * 0.055, trunkTop);
  bezierVertex(topX + size * 0.02, trunkTop * 0.65, size * 0.09, -size * 0.18, size * 0.09, 2);
  endShape(CLOSE);

  stroke(48, 36, 27, alpha * 0.65);
  strokeWeight(max(1, size * 0.025));
  line(topX - size * 0.01, -size * 0.45, topX - size * (0.22 + t.seed * 0.08) + wind * 0.18, -size * 0.66);
  line(topX + size * 0.015, -size * 0.53, topX + size * (0.2 + t.seed * 0.1) + wind * 0.24, -size * 0.76);
  noStroke();

  if (t.kind === 0) {
    // Conifer: stacked boughs, wider and darker near the bottom.
    for (let i = 0; i < 4; i++) {
      let f = i / 3;
      let cy = -size * (0.58 + f * 0.24);
      let w = size * (0.85 - f * 0.18);
      let h = size * (0.34 - f * 0.04);
      let sx = topX + wind * (0.2 + f * 0.18);
      fill(28 + f * 16, 92 + f * 22, 50 + f * 8, alpha);
      triangle(sx - w * 0.5, cy + h * 0.28, sx + w * 0.5, cy + h * 0.28, sx + wind * 0.18, cy - h * 0.72);
    }
    fill(85, 150, 74, alpha * 0.55);
    triangle(topX - size * 0.28, -size * 0.82, topX + size * 0.18, -size * 0.84, topX + wind * 0.2, -size * 1.14);
    return;
  }

  if (t.kind === 1) {
    // Broadleaf: overlapping blobs make a single swaying crown.
    let crownY = -size * 0.88;
    let crownX = topX + wind * 0.42;
    fill(31, 99, 50, alpha);
    ellipse(crownX - size * 0.23, crownY + size * 0.03, size * 0.58, size * 0.48);
    ellipse(crownX + size * 0.22, crownY + size * 0.02, size * 0.56, size * 0.46);
    fill(44, 126, 61, alpha);
    ellipse(crownX, crownY - size * 0.12, size * 0.72, size * 0.58);
    fill(72, 148, 72, alpha * 0.65);
    ellipse(crownX - size * 0.12, crownY - size * 0.22, size * 0.34, size * 0.24);
    return;
  }

  // Wind-bent tuft tree: taller silhouette with a comma-shaped canopy.
  let crownX = topX + wind * 0.55;
  let crownY = -size * 0.95;
  fill(35, 106, 55, alpha);
  ellipse(crownX, crownY, size * 0.52, size * 0.82);
  ellipse(crownX + size * 0.22 + wind * 0.08, crownY + size * 0.04, size * 0.42, size * 0.62);
  fill(61, 138, 70, alpha * 0.72);
  ellipse(crownX + size * 0.05, crownY - size * 0.2, size * 0.34, size * 0.42);
}

// Foreground trees on the nearest vegetated world. Only renders when the ship
// is near the surface, and only the arc around the ship, so it stays cheap.
function drawSurfaceTrees() {
  if (!lander) return;
  let { planet, surfaceDistance } = getClosestPlanetInfo();
  if (!planet || planet.isSun || planet.seaLevel <= 0) return;
  if (surfaceDistance > 2000) return;
  let trees = ensureTrees(planet);
  if (!trees.length) return;
  let shipAngle = getPlanetViewAngle(planet);
  let visible = [];
  for (let t of trees) {
    // Foreground layers lead the camera slightly, so nearby trunks slide over
    // the surface faster than the terrain beneath them.
    let drawAngle = t.angle - shipAngle * t.depth;
    let da = abs(angleDelta(drawAngle, shipAngle));
    if (da > 46) continue;                             // local arc around the ship
    visible.push({ tree: t, drawAngle });
  }
  visible.sort((a, b) => a.tree.depth - b.tree.depth);

  for (let item of visible) {
    let t = item.tree;
    let drawAngle = normalizeAngle(item.drawAngle);
    let surfaceR = getSurfaceRadius(planet, drawAngle);
    let r = surfaceR - 46 + t.depth * 8;
    let x = planet.center.x + r * cos(drawAngle);
    let y = planet.center.y + r * sin(drawAngle);
    let s = 1.05 + t.depth * 2.7;
    let alpha = constrain(155 + t.depth * 360, 0, 255);
    push();
    translate(x, y);
    rotate(drawAngle + 90);                            // local -y points skyward
    scale(s);
    drawSwayingTreeSprite(t, drawAngle, alpha);
    pop();
  }
}

function getSurfaceDistance(position, planet) {
  let dx = position.x - planet.center.x;
  let dy = position.y - planet.center.y;
  let centerDistance = sqrt(dx * dx + dy * dy);

  if (!planet.landscape || planet.landscape.length < 2 || centerDistance === 0) {
    return max(0, centerDistance - planet.baseRadius);
  }

  let angle = atan2(dy, dx);
  if (angle < 0) angle += 360;

  for (let i = 0; i < planet.landscape.length - 1; i++) {
    let current = planet.landscape[i];
    let next = planet.landscape[i + 1];
    let currentAngle = current.angle;
    let nextAngle = next.angle < currentAngle ? next.angle + 360 : next.angle;
    let adjustedAngle = angle < currentAngle ? angle + 360 : angle;

    if (adjustedAngle >= currentAngle && adjustedAngle <= nextAngle) {
      let fraction = (adjustedAngle - currentAngle) / (nextAngle - currentAngle);
      let surfaceRadius = lerp(current.r, next.r, fraction);
      return max(0, centerDistance - surfaceRadius);
    }
  }

  return max(0, centerDistance - planet.baseRadius);
}

// Terrain height (radius from planet center) at a given angle. Used by
// falling samples to know when they've touched the ground.
function getSurfaceRadius(planet, angle) {
  let landscape = planet.landscape;
  if (!landscape || landscape.length < 2) return planet.baseRadius;
  if (angle < 0) angle += 360;
  for (let i = 0; i < landscape.length - 1; i++) {
    let cur = landscape[i];
    let next = landscape[i + 1];
    let curA = cur.angle;
    let nextA = next.angle < curA ? next.angle + 360 : next.angle;
    let adjA = angle < curA ? angle + 360 : angle;
    if (adjA >= curA && adjA <= nextA) {
      let f = (adjA - curA) / (nextA - curA);
      return lerp(cur.r, next.r, f);
    }
  }
  return planet.baseRadius;
}

/*********************************************************
 *                   DRAW HELPERS
 *********************************************************/
// Active constellation has a sine-shaped life envelope (fade in, hold, fade out),
// then we pick a new one. Anchors are restricted to far/low-parallax stars so the
// group drifts together (no tile-wrap tearing mid-shine). Edges are an Euclidean
// MST over the chosen stars plus a couple of short non-crossing extras to give
// the figure some triangles instead of a single zigzag polyline.
let constellation = { nodes: [], edges: [], age: 0, lifespan: 240 };

function constellationCcw(p, q, r) {
  return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
}

// Proper segment intersection — returns true only when AB and CD cross
// strictly in their interiors (shared endpoints don't count as a crossing).
function constellationSegmentsCross(ai, bi, ci, di, positions) {
  if (ai === ci || ai === di || bi === ci || bi === di) return false;
  let a = positions[ai], b = positions[bi], c = positions[ci], d = positions[di];
  let d1 = constellationCcw(a, b, c);
  let d2 = constellationCcw(a, b, d);
  let d3 = constellationCcw(c, d, a);
  let d4 = constellationCcw(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// Try to build a small, tight constellation rooted at a far-star anchor.
// Returns { nodes, edges } or null if no good cluster was found.
function pickConstellation(positions) {
  const MAX_PARALLAX = 0.12;
  const CLUSTER_RADIUS = 70;   // tighter than before so groups feel local
  const MAX_NODES = 6;         // small enough to read as a figure
  const MIN_NODES = 4;
  const EXTRA_EDGES = 2;       // triangle-forming edges added after MST

  let candidates = [];
  for (let i = 0; i < bgStars.length; i++) {
    if (bgStars[i].parallax <= MAX_PARALLAX) candidates.push(i);
  }
  if (candidates.length < MIN_NODES) return null;

  for (let attempt = 0; attempt < 10; attempt++) {
    let anchor = candidates[floor(random(candidates.length))];
    let ap = positions[anchor];
    let near = [];
    for (let i of candidates) {
      if (i === anchor) continue;
      let d = dist(positions[i].x, positions[i].y, ap.x, ap.y);
      if (d < CLUSTER_RADIUS) near.push({ i, d });
    }
    if (near.length < MIN_NODES - 1) continue;
    near.sort((a, b) => a.d - b.d);
    let nodes = [anchor, ...near.slice(0, MAX_NODES - 1).map((n) => n.i)];

    // Prim's MST. Always planar in 2D for Euclidean weights, so no crossings.
    let inTree = new Set([nodes[0]]);
    let edges = [];
    while (inTree.size < nodes.length) {
      let best = null;
      for (let a of inTree) {
        let ap2 = positions[a];
        for (let b of nodes) {
          if (inTree.has(b)) continue;
          let d = dist(ap2.x, ap2.y, positions[b].x, positions[b].y);
          if (!best || d < best.d) best = { a, b, d };
        }
      }
      if (!best) break;
      edges.push([best.a, best.b]);
      inTree.add(best.b);
    }

    // Try to add a few short non-MST edges that don't cross existing edges.
    // This is what turns the tree into a recognizable figure with triangles.
    let extras = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let a = nodes[i], b = nodes[j];
        let exists = edges.some(
          ([x, y]) => (x === a && y === b) || (x === b && y === a)
        );
        if (exists) continue;
        extras.push({
          a, b,
          d: dist(positions[a].x, positions[a].y, positions[b].x, positions[b].y),
        });
      }
    }
    extras.sort((x, y) => x.d - y.d);

    let added = 0;
    for (let e of extras) {
      if (added >= EXTRA_EDGES) break;
      let crosses = edges.some(([x, y]) =>
        constellationSegmentsCross(e.a, e.b, x, y, positions)
      );
      if (!crosses) {
        edges.push([e.a, e.b]);
        added++;
      }
    }

    return { nodes, edges };
  }
  return null;
}

// Coarse blackbody-style gradient. t in [0,1]: cool red → yellow → white → blue.
// Bias squishes most stars toward white with tinted accents at the extremes.
function starTemperatureColor(t) {
  let stops = [
    [255, 170, 120], // ~3000K
    [255, 215, 170], // ~4500K
    [255, 240, 220], // ~6000K
    [240, 245, 255], // ~7500K
    [200, 220, 255], // ~10000K
  ];
  let bias = constrain(0.5 + (t - 0.5) * 0.6, 0, 1);
  let f = bias * (stops.length - 1);
  let i = floor(f);
  let frac = f - i;
  let a = stops[i];
  let b = stops[min(i + 1, stops.length - 1)];
  return [
    lerp(a[0], b[0], frac),
    lerp(a[1], b[1], frac),
    lerp(a[2], b[2], frac),
  ];
}

function drawStarField() {
  // Tile size must match init so wrap is seamless.
  let tileW = width * 1.5;
  let tileH = height * 1.5;
  let cx = view.focusX;
  let cy = view.focusY;

  push();
  // Stars rotate with the world view so the gravity-driven camera roll feels
  // consistent.
  translate(width / 2, height / 2);
  rotate(view.rotation);

  // --- Background layer: static (parallax-0) stars that host the constellations.
  // They don't translate with the camera, so the figures stay fixed on the
  // celestial sphere and only swing with the camera roll. ---
  let bgPos = new Array(bgStars.length);
  for (let i = 0; i < bgStars.length; i++) {
    let s = bgStars[i];
    let sx = ((s.x + tileW / 2) % tileW + tileW) % tileW - tileW / 2;
    let sy = ((s.y + tileH / 2) % tileH + tileH) % tileH - tileH / 2;
    bgPos[i] = { x: sx, y: sy };
  }

  // Advance the active constellation and pick a fresh one (from bgStars) when it
  // expires.
  constellation.age++;
  if (constellation.age >= constellation.lifespan) {
    let picked = pickConstellation(bgPos);
    constellation = {
      nodes: picked ? picked.nodes : [],
      edges: picked ? picked.edges : [],
      age: 0,
      lifespan: floor(random(220, 380)),
    };
  }

  // Sine envelope: 0 -> 1 (mid-life) -> 0. Drives line alpha + per-star shine so
  // the figure pulses as a unit.
  let envelope = max(0, sin((constellation.age / constellation.lifespan) * 180));
  let highlighted = new Set(constellation.nodes);

  // Render every background star; brighten + enlarge the highlighted ones.
  for (let i = 0; i < bgStars.length; i++) {
    let s = bgStars[i];
    let p = bgPos[i];
    let isHi = highlighted.has(i);
    let mult = isHi ? 1 + envelope * 2.0 : 1;
    stroke(min(255, s.color[0] * s.brightness * mult),
           min(255, s.color[1] * s.brightness * mult),
           min(255, s.color[2] * s.brightness * mult));
    strokeWeight(s.size * (isHi ? 1 + envelope * 1.2 : 1));
    point(p.x, p.y);
  }

  // Per-edge lines (not a polyline) so MST + triangle edges all render. Soft wide
  // glow underneath, crisp core on top — both modulated by the envelope.
  if (constellation.edges.length > 0 && envelope > 0.02) {
    stroke(180, 210, 255, envelope * 50);
    strokeWeight(4);
    for (let [a, b] of constellation.edges) {
      let pa = bgPos[a], pb = bgPos[b];
      line(pa.x, pa.y, pb.x, pb.y);
    }
    stroke(255, 255, 255, envelope * 170);
    strokeWeight(1.2);
    for (let [a, b] of constellation.edges) {
      let pa = bgPos[a], pb = bgPos[b];
      line(pa.x, pa.y, pb.x, pb.y);
    }
  }

  // --- Foreground layer: the parallax twinkle field, drawn on top so it reads as
  // nearer dust drifting in front of the fixed constellations. ---
  for (let i = 0; i < stars.length; i++) {
    let s = stars[i];
    let px = s.x - cx * s.parallax;
    let py = s.y - cy * s.parallax;
    let sx = ((px + tileW / 2) % tileW + tileW) % tileW - tileW / 2;
    let sy = ((py + tileH / 2) % tileH + tileH) % tileH - tileH / 2;
    stroke(min(255, s.color[0] * s.brightness),
           min(255, s.color[1] * s.brightness),
           min(255, s.color[2] * s.brightness));
    strokeWeight(s.size);
    point(sx, sy);
  }

  pop();
}

function checkCollisions(lander, planets) {
  if (!lander.active) {
    return false;
  }
  
  lander.altitude = Infinity;
  let closestSurfaceDistance = Infinity;
  let closestPlanet = planets[0];
  
  // First find the closest terrain surface and calculate altitude
  for (let planet of planets) {
    let altitudeFromPlanet = getSurfaceDistance(lander.pos, planet);
    lander.altitude = min(lander.altitude, altitudeFromPlanet);
    
    if (altitudeFromPlanet < closestSurfaceDistance) {
      closestPlanet = planet;
      closestSurfaceDistance = altitudeFromPlanet;
    }
  }
  
  lander.setNearestPlanet(closestPlanet);
  
  // Now check for collisions with the closest planet's terrain
  let points = closestPlanet.landscape;
  let collisionDetected = false;
  
  for (let i = 0; i < points.length - 1; i++) {
    let p1 = points[i];
    let p2 = points[i + 1];
    
    // Check if lander is horizontally between these points
    let isInSegment = isPointInLineSegment(
      lander.pos.x,
      lander.pos.y,
      p1.x, p1.y,
      p2.x, p2.y
    );
    
    if (isInSegment) {
      // Calculate distance from lander to terrain segment
      let distance = distanceToLineSegment(
        lander.pos.x,
        lander.pos.y,
        p1.x, p1.y,
        p2.x, p2.y
      );
      
      // Update altitude if this is the closest point to terrain
      lander.altitude = min(lander.altitude, distance);
      
      // Check for collision (using lander radius as threshold)
      if (distance < lander.radius && gameState !== GAME_STATES.LANDED) {
        collisionDetected = true;
        // Check if this is a safe landing
        let isSafeLanding = checkSafeLanding(lander, p1, p2, closestPlanet);
        
        if (isSafeLanding) {
          lander.land();
          gameState = GAME_STATES.LANDED;
          score += 100;
          tryDeliver();
          return false
        } else {
          spawnCrashEffect(lander.pos.x, lander.pos.y, lander.vel.x, lander.vel.y, lander.rotation, lander.scale);
          lander.crash();
          gameState = GAME_STATES.CRASHED;
        }
        break;
      }
    }
  }

  // Also check for collision with planet's basic radius
  let distToCenter = dist(
    lander.pos.x,
    lander.pos.y,
    closestPlanet.center.x,
    closestPlanet.center.y
  );

  if (distToCenter <= closestPlanet.baseRadius*.9 + lander.radius) {
    spawnCrashEffect(lander.pos.x, lander.pos.y, lander.vel.x, lander.vel.y, lander.rotation, lander.scale);
    lander.crash();
    gameState = GAME_STATES.CRASHED;
    return true;
  }
  
  return collisionDetected;
}
// Helper function to check if a point is near a line segment
function isPointInLineSegment(px, py, x1, y1, x2, y2) {
  // Calculate the bounding box of the line segment
  let minX = min(x1, x2) - 10; // Add some margin
  let maxX = max(x1, x2) + 10;
  let minY = min(y1, y2) - 10;
  let maxY = max(y1, y2) + 10;
  
  // Check if point is within the bounding box
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

// Helper function to calculate distance from point to line segment
function distanceToLineSegment(px, py, x1, y1, x2, y2) {
  let A = px - x1;
  let B = py - y1;
  let C = x2 - x1;
  let D = y2 - y1;
  
  let dot = A * C + B * D;
  let len_sq = C * C + D * D;
  let param = -1;
  
  if (len_sq != 0) {
    param = dot / len_sq;
  }
  
  let xx, yy;
  
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  
  return dist(px, py, xx, yy);
}

// Helper function to check if landing is safe
const LANDING_MAX_SLOPE = 40; // degrees off the planet's tangent
const LANDING_MAX_SPEED = 100;

function checkSafeLanding(lander, p1, p2, planet) {
  // Flatness is measured relative to the planet's local tangent at the segment
  // midpoint, not world-space horizontal. World-horizontal only equals "flat"
  // on the south side of a planet — on the east/west sides flat terrain is
  // nearly vertical in world space.
  let mx = (p1.x + p2.x) * 0.5;
  let my = (p1.y + p2.y) * 0.5;
  let rx = mx - planet.center.x;
  let ry = my - planet.center.y;
  let rmag = sqrt(rx * rx + ry * ry);
  if (rmag === 0) return false;
  rx /= rmag;
  ry /= rmag;
  // Tangent is perpendicular to the radial direction.
  let tx = -ry;
  let ty = rx;
  let sx = p2.x - p1.x;
  let sy = p2.y - p1.y;
  let smag = sqrt(sx * sx + sy * sy);
  if (smag === 0) return false;
  sx /= smag;
  sy /= smag;
  // |dot| because the segment can run either way around the planet.
  let alignment = abs(sx * tx + sy * ty);
  // angleMode(DEGREES) is set in setup(), so acos returns degrees directly.
  let tiltDegrees = acos(constrain(alignment, -1, 1));
  let isTerrainFlat = tiltDegrees < LANDING_MAX_SLOPE;

  let isVelocitySafe = lander.vel.mag() < LANDING_MAX_SPEED;
  let isOrientationSafe = isLanderUprightForPlanet(lander, planet);

  return isTerrainFlat && isVelocitySafe && isOrientationSafe;
}

function isLanderUprightForPlanet(lander, planet) {
  if (!planet) return false;

  let toPlanetX = planet.center.x - lander.pos.x;
  let toPlanetY = planet.center.y - lander.pos.y;
  let distance = sqrt(toPlanetX * toPlanetX + toPlanetY * toPlanetY);
  if (distance === 0) return false;

  toPlanetX /= distance;
  toPlanetY /= distance;

  // Local +Y is the lander's bottom/legs direction after rotation.
  let bottomX = -sin(lander.rotation);
  let bottomY = cos(lander.rotation);
  let alignment = bottomX * toPlanetX + bottomY * toPlanetY;
  return alignment >= cos(LANDING_MAX_TILT);
}
function getBeamStopPositionRadial( planet, maxBeamLength) {
  // 1) Compute angle from planet center to lander (in radians).
  let dx = lander.pos.x - planet.center.x;
  let dy = lander.pos.y - planet.center.y;
  let angleDeg = atan2(dy, dx);

  // Make sure angleDeg is in [0..360).
  if (angleDeg < 0) {
    angleDeg += 360;
  }

  // 2) Find p1, p2 in planet.landscape that bracket this angleDeg.
  //    We assume p1.angle <= angleDeg <= p2.angle.
  let p1, p2;
  for (let i = 0; i < planet.landscape.length - 1; i++) {
    let curr = planet.landscape[i];
    let next = planet.landscape[i + 1];

    // Handle potential wrap-around if next.angle < curr.angle
    let currAngle = curr.angle;
    let nextAngle = next.angle < currAngle ? next.angle + 360 : next.angle;

    // Check if angleDeg is between currAngle and nextAngle
    if (angleDeg >= currAngle && angleDeg <= nextAngle) {
      p1 = curr;
      p2 = next;
      break;
    }
  }

  // If we didn't find a segment (edge case near wrap-around),
  // you can handle differently; for now, return maxBeamLength.
  if (!p1 || !p2) {
    return maxBeamLength;
  }

  // 3) Interpolate radius at angleDeg
  let angleSpan = p2.angle - p1.angle;
  // Adjust if negative (wrap-around case, e.g. 359 -> 0)
  if (angleSpan < 0) {
    angleSpan += 360;
  }
  let fraction = (angleDeg - p1.angle) / angleSpan;
  fraction = constrain(fraction, 0, 1);

  let interpolatedRadius = lerp(p1.r, p2.r, fraction);

  // 4) Compute the actual terrain (x, y) at that angle
  let terrainX = planet.center.x + interpolatedRadius * cos(angleDeg);
  let terrainY = planet.center.y + interpolatedRadius * sin(angleDeg);

  // 5) Radial distance from lander to terrain
  let radialDistance = dist(lander.pos.x, lander.pos.y, terrainX, terrainY);



  // 6) Compare with maxBeamLength
  if (radialDistance > maxBeamLength) {
    radialDistance = maxBeamLength;
  }

  return radialDistance;
}


// Horizontal HUD gauge: a track with a colored fill that ramps colA->colB as
// the reading approaches danger, a centered label, and a tick marking the
// danger threshold. `lowIsGood` flips the ramp so an emptying fuel bar reddens
// as it drains, while a rising heat bar reddens as it climbs toward the limit.
function drawHudGauge(x, y, w, h, frac, label, colA, colB, dangerFrac, lowIsGood) {
  frac = constrain(frac, 0, 1);
  let t = lowIsGood ? 1 - frac : frac;            // 0 = safe, 1 = danger
  let critical = t >= dangerFrac;
  let pulse = critical ? 0.6 + 0.4 * sin(frameCount * 12) : 1;
  let r = lerp(colA[0], colB[0], t) * pulse;
  let g = lerp(colA[1], colB[1], t) * pulse;
  let b = lerp(colA[2], colB[2], t) * pulse;

  push();
  noStroke();
  // Track.
  fill(255, 255, 255, 28);
  rect(x, y, w, h, 3);
  // Fill.
  fill(r, g, b);
  rect(x, y, w * frac, h, 3);
  // Danger tick (the explosion / empty limit for this gauge).
  let tickX = x + w * (lowIsGood ? 1 - dangerFrac : dangerFrac);
  stroke(255, 80, 60, 210);
  strokeWeight(2);
  line(tickX, y - 2, tickX, y + h + 2);
  noStroke();
  // Label.
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(11);
  text(label, x + w / 2, y + h / 2 + 0.5);
  pop();
}

function drawHUD() {
  push();
  noStroke();
  fill(0, 0, 0, 160);
  rect(12, 12, 404, 252, 8);
  pop();

  push();
  textAlign(LEFT, TOP);
  noStroke();

  // --- Gauges: fuel and hull heat, side by side ---
  let gaugeW = 184, gaugeH = 12;
  let fx = 22, hx = 22 + gaugeW + 14, gy = 24;

  // Fuel gauge: green when full, ambers as it drains, tick near empty.
  let fuelFrac = lander.maxFuel > 0 ? lander.fuel / lander.maxFuel : 0;
  drawHudGauge(fx, gy, gaugeW, gaugeH, fuelFrac,
    `FUEL  ${floor(lander.fuel)}/${lander.maxFuel}`,
    [80, 200, 120], [230, 150, 50], 0.25, true);

  // Heat gauge: blue when cool, reddens toward the explosion limit (full bar).
  // The danger tick sits at 70% -- past it the hull glows and the bar pulses.
  let heatFrac = (lander.heat || 0) / (DEBUG.heatMax || 100);
  drawHudGauge(hx, gy, gaugeW, gaugeH, heatFrac,
    `HULL HEAT  ${floor(lander.heat || 0)}/${DEBUG.heatMax}`,
    [90, 160, 230], [255, 60, 40], 0.7, false);

  // --- Text readouts (two columns) ---
  fill(235);
  textSize(14);
  let lx = 22, rx = 22 + gaugeW + 14, ty = gy + gaugeH + 16, lh = 19;

  // Atmospheric drag readout: density and the resulting per-frame velocity
  // bleed. The displayed number accounts for substepping (lander.update), so
  // it never exceeds 100% even when the drag coefficient is large.
  let atmoDensity = 0;
  for (let p of planets) atmoDensity += p.atmosphericDensity(lander.pos.x, lander.pos.y);
  if (atmoDensity > 1) atmoDensity = 1;
  let kts = DEBUG.atmosphereDrag * atmoDensity * timeScale;
  let dragSubsteps = max(1, ceil(kts / SUBSTEP_MAX_KDT));
  let dragPerFrame = 1 - pow(max(0, 1 - kts / dragSubsteps), dragSubsteps);

  text(`Altitude  ${floor(lander.altitude)}`, lx, ty);
  text(`Velocity  ${lander.vel.mag().toFixed(2)}`, rx, ty);
  text(`Atmosphere  ${(atmoDensity * 100).toFixed(0)}%`, lx, ty + lh);
  text(`Drag  ${(dragPerFrame * 100).toFixed(1)}%/f`, rx, ty + lh);
  text(`Cargo  ${cargo}/${lander.maxCargo}`, lx, ty + lh * 2);
  text(`Delivered  ${delivered}/${DELIVERY_GOAL}`, rx, ty + lh * 2);
  text(`Research  ${research}`, lx, ty + lh * 3);
  text(`Score  ${score}`, rx, ty + lh * 3);
  pop();

  drawMissionReadout();

  // Time scale (top-right corner).
  push();
  fill(235);
  textAlign(RIGHT, TOP);
  textSize(14);
  text(`Time ${timeScale.toFixed(1)}x`, width - 230, 36);
  pop();

  if (lander && lander.active) {
    drawNavTargetIndicator(getNavTarget());
  }

  // drawShop() decides for itself when to render (LANDED + in range of base).
  drawShop();
}

function drawEventMessage() {
  if (!eventMessage || millis() > eventMessageUntil) return;

  let remaining = constrain((eventMessageUntil - millis()) / 500, 0, 1);
  push();
  textAlign(CENTER, CENTER);
  textSize(18);
  let boxW = min(width - 40, max(320, textWidth(eventMessage) + 48));
  let boxH = 44;
  let x = width / 2 - boxW / 2;
  let y = 74;
  noStroke();
  fill(0, 20, 34, 190 * remaining);
  rect(x, y, boxW, boxH, 6);
  stroke(80, 255, 220, 180 * remaining);
  noFill();
  rect(x, y, boxW, boxH, 6);
  noStroke();
  fill(210, 255, 240, 255 * remaining);
  text(eventMessage, width / 2, y + boxH / 2);
  pop();
}

function drawMissionReadout() {
  let nearest = getNearestPlanetInfo();
  let specimensRemaining = cows.filter((cow) => cow.state !== "stowed").length;
  let objective;
  if (!padFound) {
    objective = "Descend, land anywhere safe, then press B to build your launch pad";
  } else if (cargo > 0) {
    objective = "Land at base to deliver cargo";
  } else {
    objective = "Click to zap plants. Hover above samples and hold SPACE to beam them up.";
  }

  textAlign(LEFT);
  textSize(14);
  fill(180, 235, 255);
  text(`Objective: ${objective}`, 20, 180);
  fill(255);
  if (nearest) {
    let bodyName = nearest.planet.discovered ? nearest.planet.name : "Unknown body";
    text(`Nearest: ${bodyName} (${floor(nearest.distance)}m)`, 20, 200);
  }
  text(`Specimens remaining: ${specimensRemaining}`, 20, 220);
  text("Controls: A/D rotate  |  W thrust  |  C chute  |  Click zap  |  Space beam", 20, 240);
}

function getNearestPlanetInfo() {
  if (!lander) return null;

  let nearest = null;
  for (let planet of planets) {
    let distance = getSurfaceDistance(lander.pos, planet);
    if (!nearest || distance < nearest.distance) {
      nearest = { planet, distance };
    }
  }
  return nearest;
}

function getNavTarget() {
  if (!lander || !base) return null;

  // Opening objective: steer the player to the launch pad before anything else.
  if (!padFound) {
    return {
      pos: base.pos,
      label: "LAUNCH PAD",
      color: { r: 120, g: 220, b: 255 }
    };
  }

  if (cargo > 0) {
    return {
      pos: base.pos,
      label: "BASE",
      color: { r: 120, g: 220, b: 255 }
    };
  }

  let nearestCow = null;
  let nearestDistance = Infinity;
  for (let cow of cows) {
    if (cow.state === "stowed") continue;
    let cowDistance = dist(lander.pos.x, lander.pos.y, cow.pos.x, cow.pos.y);
    if (cowDistance < nearestDistance) {
      nearestCow = cow;
      nearestDistance = cowDistance;
    }
  }

  if (!nearestCow) {
    return {
      pos: base.pos,
      label: "BASE",
      color: { r: 120, g: 220, b: 255 }
    };
  }

  return {
    pos: nearestCow.pos,
    label: "SPECIMEN",
    color: { r: 80, g: 255, b: 140 }
  };
}

function drawNavTargetIndicator(target) {
  if (!target) return;

  let screenPt = worldToScreen(target.pos.x, target.pos.y);
  let screenX = screenPt.x;
  let screenY = screenPt.y;
  let margin = 60;
  let onScreen =
    screenX > margin && screenX < width - margin &&
    screenY > margin && screenY < height - margin;

  if (onScreen) {
    push();
    noFill();
    stroke(target.color.r, target.color.g, target.color.b, 220);
    strokeWeight(2);
    circle(screenX, screenY, 28);
    line(screenX - 18, screenY, screenX - 8, screenY);
    line(screenX + 8, screenY, screenX + 18, screenY);
    line(screenX, screenY - 18, screenX, screenY - 8);
    line(screenX, screenY + 8, screenX, screenY + 18);
    noStroke();
    fill(target.color.r, target.color.g, target.color.b);
    textAlign(CENTER);
    textSize(12);
    stroke(0, 180);
    strokeWeight(3);
    text(target.label, screenX, screenY + 30);
    noStroke();
    pop();
    return;
  }

  let cx = width / 2;
  let cy = height / 2;
  let dx = screenX - cx;
  let dy = screenY - cy;
  let angle = atan2(dy, dx);
  let radius = min(width, height) / 2 - margin;
  let arrowX = cx + radius * cos(angle);
  let arrowY = cy + radius * sin(angle);

  push();
  translate(arrowX, arrowY);
  rotate(angle);
  // Chevron arrow: sharp tip forward, notched tail so the pointing direction is unambiguous.
  stroke(0, 200);
  strokeWeight(2);
  fill(target.color.r, target.color.g, target.color.b, 240);
  beginShape();
  vertex(0, 0);       // tip (forward, at anchor point)
  vertex(-26, -14);   // back-left wing
  vertex(-18, 0);     // notch
  vertex(-26, 14);    // back-right wing
  endShape(CLOSE);
  pop();

  textAlign(CENTER);
  textSize(12);
  stroke(0, 180);
  strokeWeight(3);
  fill(target.color.r, target.color.g, target.color.b);
  text(target.label, arrowX, arrowY + 28);
  noStroke();
}

function drawGameStateMessages() {
  push();
  textAlign(CENTER);
  textSize(24);
  fill(220, 255, 245);
  stroke(0, 180);
  strokeWeight(4);
  switch (gameState) {
    case GAME_STATES.WAITING:
      text("CLICK OR PRESS ANY KEY TO START", width / 2, height / 2);
      break;
    case GAME_STATES.LANDED:
      if (!base) {
        text("LANDED\nPRESS B TO BUILD YOUR LAUNCH PAD HERE\nOR ANY OTHER KEY TO LIFT OFF", width / 2, height / 2 - 30);
      } else if (base.inRange(lander.pos)) {
        text("AT BASE - FULL TANK\nCLICK UPGRADES OR PRESS ANY KEY TO LIFT OFF", width / 2, height / 2 - 30);
      } else {
        text("LANDED - PRESS ANY KEY TO LIFT OFF", width / 2, height / 2);
      }
      break;
    case GAME_STATES.CRASHED:
      text("CRASHED! PRESS ANY KEY TO RESTART", width / 2, height / 2);
      break;
    case GAME_STATES.GAMEOVER:
      text(`MISSION COMPLETE - ${delivered} specimens delivered\nScore: ${score}\nPRESS ANY KEY TO RESTART`, width / 2, height / 2);
      break;
  }
  pop();
}

/*********************************************************
 *                   INPUT
 *********************************************************/
function keyPressed() {
  // Overview toggle works from any state — held above the gameState gates
  // so the player can pull up the system map from the title/landed screens
  // without dismissing them.
  if (key === "m" || key === "M") {
    overviewMode = !overviewMode;
    return;
  }
  if (gameState === GAME_STATES.WAITING) {
    startGame();
    return;
  }
  if (gameState === GAME_STATES.CRASHED || gameState === GAME_STATES.GAMEOVER) {
    resetGame();
    startGame();
    return;
  }
  if (gameState === GAME_STATES.LANDED) {
    // No pad yet -> B builds one here; any other key lifts off without building.
    if (!base && (key === "b" || key === "B")) {
      buildLaunchPad();
      return;
    }
    liftOff();
    return;
  }
  // Movement / beam are polled via keyIsDown in pollInput().
  if (key === "c" || key === "C") {
    if (lander && lander.active) {
      if (!lander.parachute && lander.sampleAtmosphereAt(lander.pos).density > 0.02) {
        lander.parachute = true;
        showEvent("Parachute deployed");
      } else if (lander.parachute) {
        lander.parachute = false;
        showEvent("Parachute cut");
      }
    }
  }
  if (key === "t" || key === "T") {
    setDebugValue("showTrajectory", !DEBUG.showTrajectory);
  }
}

// Continuous input polling for the PLAYING state. Lets WASD and arrows be
// pressed simultaneously without one overriding the other on key release.
function pollInput(timeScale = 1) {
  if (!lander || gameState !== GAME_STATES.PLAYING) return;

  let leftHeld  = keyIsDown(LEFT_ARROW)  || keyIsDown(KEY_A);
  let rightHeld = keyIsDown(RIGHT_ARROW) || keyIsDown(KEY_D);
  if (leftHeld)  lander.rotate(-0.2 * timeScale);
  if (rightHeld) lander.rotate( 0.2 * timeScale);

  let thrustHeld = keyIsDown(UP_ARROW) || keyIsDown(KEY_W);
  let wantThrust = thrustHeld && lander.fuel > 0;
  if (wantThrust && !thrustPlaying) playThruster();
  else if (!wantThrust && thrustPlaying) stopThruster();
  lander.setThrust(wantThrust ? 1 : 0);

  // Camera roll is now automatic — updateView() continuously rolls the view so
  // gravity points screen-down, so there's no manual Q/E roll to handle here.

  // Tractor beam fires straight down from the ship's local frame while space is held.
  lander.abducting = keyIsDown(32);
}

function screenToWorld(sx, sy) {
  // Inverse of the draw() camera transform: subtract screen center, rotate
  // back, unscale, then translate by focus. Matches worldToScreen exactly.
  let dx = sx - width / 2;
  let dy = sy - height / 2;
  let c = cos(-view.rotation);
  let s = sin(-view.rotation);
  return {
    x: (c * dx - s * dy) / view.scale + view.focusX,
    y: (s * dx + c * dy) / view.scale + view.focusY
  };
}

function worldToScreen(wx, wy) {
  let dx = (wx - view.focusX) * view.scale;
  let dy = (wy - view.focusY) * view.scale;
  let c = cos(view.rotation);
  let s = sin(view.rotation);
  return {
    x: width / 2 + c * dx - s * dy,
    y: height / 2 + s * dx + c * dy
  };
}

// Cast a ray from origin in unit direction (dirX, dirY) and return the distance
// to the first terrain segment hit on the given planet, capped at maxRange.
function rayHitsTerrain(origin, dirX, dirY, maxRange, planet) {
  if (!planet || !planet.landscape) return maxRange;
  let segs = planet.landscape;
  let closest = maxRange;
  for (let i = 0; i < segs.length - 1; i++) {
    let p1 = segs[i];
    let p2 = segs[i + 1];
    let vx = p2.x - p1.x;
    let vy = p2.y - p1.y;
    let wx = origin.x - p1.x;
    let wy = origin.y - p1.y;
    let denom = vx * dirY - vy * dirX;
    if (Math.abs(denom) < 1e-9) continue; // parallel
    let t = (wx * vy - vx * wy) / denom;
    if (t < 0 || t >= closest) continue;
    let s = (wx * dirY - dirX * wy) / denom;
    if (s < 0 || s > 1) continue;
    closest = t;
  }
  return closest;
}

function mousePressed(event) {
  // Ignore clicks that landed on the debug panel / its toggle button.
  if (event && event.target && (
    event.target.closest("#debug-panel") ||
    event.target.id === "debug-toggle"
  )) return;

  // Shop click takes priority in any state where the shop might be open.
  // tryBuyUpgrade is a no-op when shopButtons is empty (shop not visible).
  if (tryBuyUpgrade(mouseX, mouseY)) return;

  if (gameState === GAME_STATES.WAITING) {
    startGame();
    return;
  }
  if (gameState === GAME_STATES.CRASHED || gameState === GAME_STATES.GAMEOVER) {
    resetGame();
    startGame();
    return;
  }
  if (gameState === GAME_STATES.LANDED) {
    liftOff();
    return;
  }
  // PLAYING — click fires the laser at the cursor target.
  fireLaser(mouseX, mouseY);
}

// Scroll wheel / trackpad pinch adjusts the manual zoom. Browsers translate a
// trackpad pinch into a wheel event (with ctrlKey set), so the same handler
// covers both the pinch gesture and a real mouse wheel. Exponential so each
// step is a constant ratio; clamped to keep the ship on screen. Returning false
// stops the gesture from also scrolling the page.
function mouseWheel(event) {
  // Let the wheel scroll the debug panel instead of zooming when it's hovered.
  if (event && event.target && (
    event.target.closest && event.target.closest("#debug-panel")
  )) return;

  view.userZoom = constrain(
    view.userZoom * Math.exp(-event.delta * USER_ZOOM_SENSITIVITY),
    USER_ZOOM_MIN,
    USER_ZOOM_MAX
  );
  return false;
}
