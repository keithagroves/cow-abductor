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
let lasers = [];
let planets = []; // This is our array of planets
let base;
let delivered = 0;
let research = 0;
let burnParticles = [];
let stars = [];
let cowImage;
let view = { scale: 1, focusX: 0, focusY: 0, rotation: 0 };
let startTime;
let lastDiagnosticLog = 0;
let eventMessage = "";
let eventMessageUntil = 0;
let touchable = "ontouchstart" in window;
let backgroundMusic=null;
let shipImage;
let shipFlameImage;
let shipFlameImage2;
let alienGroundImage;
let rocketSound;
let thrustPlaying = false;
const KEY_A = 65, KEY_D = 68, KEY_W = 87, KEY_S = 83, KEY_Q = 81, KEY_E = 69;
const CAMERA_ROTATE_SPEED = 1.5; // degrees per frame while Q/E is held
let timeScale = 1;
let timeSlider;

const CAMERA_ZOOM_EASE = 0.08;
const CAMERA_FOLLOW_EASE = 0.18;
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
  cowImage = loadImage("darkCow.png");
  alienImage = loadImage("alien.png");
  alienGroundImage = loadImage("unnamed.png");
  shipImage = loadImage("ship.png");
  shipFlameImage = loadImage("shipflame.png");
  shipFlameImage2 = loadImage("flame2.png");
  backgroundMusic = loadSound("leaving-for-good.mp3");
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

  // Initialize starfield
  for (let i = 0; i < 100; i++) {
    stars.push({
      x: random(width),
      y: random(height),
      brightness: random(100, 500),
    });
  }
  loadDebugFromStorage();
  buildWorld();
  resetGame();
  setupDebugPanel();
  initAtmosphere();
}

function buildWorld() {
  planets.length = 0;
  let scale = DEBUG.planetRadiusScale;
  let density = DEBUG.planetGravity;
  let spacing = DEBUG.planetSpacing;

  let sun = createVector(10000, -100);
  // Starter sits way out from the sun so there's plenty of empty space to fly
  // around the home system before bumping into anything else.
  let starting = spacing * 16;

  // Inner planets (radii scale with the debug multiplier).
  // Building the universe one planet at a time — uncomment the next worlds
  // once the starter feels right.
  planets.push(new Planet(createVector(0, 0),  8000 * scale, 255, 255, density, starting, sun));
  // Pin the starter while we tune it — orbital motion under the ship causes
  // weird relative-physics artifacts. Drop this once the world has siblings.
  planets[planets.length - 1].orbitSpeed = 0;

  // Moon orbiting the starter planet. Constructor immediately repositions
  // `center` via updateOrbitPosition, so the (0,0) we pass is only used by the
  // isSun-detection check (which compares to the orbit anchor). Anchoring on
  // planets[0].center means the moon will track the home world if we ever
  // unpin the planet's orbit.
  planets.push(new Planet(
    createVector(0, 0),
    2000 * scale,            // ~quarter the home-world radius
    120, 90,                 // distinct color/feel from Pasture-1
    3000000,                 // gentle gravity (~0.047 px/frame² at surface)
    100000,                  // orbit radius, clear of the home atmosphere
    planets[0].center
  ));
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

  // Pick the starter planet (smallest, highest gravity) and put the base on its surface.
  let starter = planets.find((p) => !p.isSun && p.landscape && p.landscape.some((pt) => pt.landable));
  if (starter) {
    base = new Base(starter, pickBaseAngle(starter));
  }
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

  push();
  // Camera transform: rotate + zoom around the focal point (lander), so
  // pressing Q/E rolls the world view without sliding the ship off-screen.
  translate(width / 2, height / 2);
  rotate(view.rotation);
  scale(view.scale);
  translate(-view.focusX, -view.focusY);

  // Draw every planet in the array
  for (let planet of planets) {
    planet.draw();
  }

  if (base) base.draw();

  drawBurnParticles();
  lander.render(timeScale);

  // Render plants under cows so glow blends nicely.
  for (let plant of flora) {
    plant.render();
  }

  // Render all cows
  for (let cow of cows) {
    cow.render();
  }

  updateAndDrawLasers(timeScale);

  pop();

  drawAtmosphere();

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
  burnParticles = [];
  lasers = [];
  // Spawn the player on the first non-sun planet so they start grounded near specimens.
  let starter = planets.find((p) => !p.isSun && p.landscape && p.landscape.some((pt) => pt.landable));
  if (starter) {
    lander.spawnOnPlanet(starter);
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
  gameState = GAME_STATES.PLAYING;
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
  showEvent(`Delivered ${payload} specimen${payload === 1 ? "" : "s"}  +${payload} research`);
  if (delivered >= DELIVERY_GOAL) {
    gameState = GAME_STATES.GAMEOVER;
  }
}

function startGame() {
  // Lift off from the starter planet (gives the gentle radial kick + refuel).
  liftOff();
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

function initializePlants() {
  flora = [];
  for (let planet of planets) {
    if (planet.isSun) continue;
    let landablePoints = planet.landscape.filter((p) => p.landable);
    if (landablePoints.length === 0) continue;
    for (let i = 0; i < 5; i++) {
      let point = random(landablePoints);
      flora.push(new Plant(planet, point.angle, point.r + 12));
    }
  }
}

/*********************************************************
 *                   VIEW & CAMERA
 *********************************************************/
function updateWorld(timeScale = 1) {
  for (let planet of planets) {
    planet.update(timeScale);
  }

  if (base) base.update(timeScale);
  lander.update(timeScale);
  // If thrust got cut (e.g. out of fuel mid-burn), make sure the rocket noise stops.
  if (lander.thrusting <= 0 && thrustPlaying) {
    stopThruster();
  }
  checkCollisions(lander, planets);

  for (let cow of cows) {
    cow.update(timeScale);
  }

  for (let plant of flora) {
    plant.update(timeScale);
  }

  updateBurnParticles(timeScale);
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
  console.log(`DEBUG: atmoScale=${DEBUG.atmosphereScale} atmoDrag=${DEBUG.atmosphereDrag} planetScale=${DEBUG.planetRadiusScale} planetGravity=${DEBUG.planetGravity} planetSpacing=${DEBUG.planetSpacing}`);
  console.log("gravity contributions (sorted by strength):");
  console.table(perPlanet);
  if (perAtmo.length > 0) {
    console.log("atmospheres touching ship:");
    console.table(perAtmo);
  }
}

function updateBurnParticles(timeScale = 1) {
  // Re-entry burn: emit particles when the ship moves fast through dense atmosphere.
  if (lander && lander.active) {
    let density = 0;
    for (let p of planets) {
      density += p.atmosphericDensity(lander.pos.x, lander.pos.y);
    }
    density = constrain(density, 0, 1);
    let speed = lander.vel.mag();
    let excess = max(0, speed - DEBUG.burnSpeedThreshold);
    let intensity = density * excess;
    if (intensity > 0) {
      let count = floor(intensity * DEBUG.burnIntensity * timeScale);
      for (let i = 0; i < count; i++) emitBurnParticle(intensity);
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

function emitBurnParticle(intensity) {
  let speed = lander.vel.mag();
  if (speed === 0) return;
  let dirX = lander.vel.x / speed;
  let dirY = lander.vel.y / speed;
  // Leading edge of the ship, with a bit of jitter so it's not a single point.
  let lateralX = -dirY;
  let lateralY = dirX;
  let jitter = random(-lander.radius * 0.6, lander.radius * 0.6);
  let emitX = lander.pos.x + dirX * lander.radius + lateralX * jitter;
  let emitY = lander.pos.y + dirY * lander.radius + lateralY * jitter;

  // Trail behind the ship with some angular spread.
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
  let hitPlant = null;

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
      hitPlant = plant;
    }
  }

  // Terrain blocks the laser. Check the nearest planet, which is usually the one
  // the player is hovering over and the only one within range anyway.
  if (lander.nearestPlanet) {
    let terrainHit = rayHitsTerrain(lander.pos, nx, ny, LASER_MAX_RANGE, lander.nearestPlanet);
    if (terrainHit < hitDist) {
      hitDist = terrainHit;
      hitPlant = null;
    }
  }

  let endX = lander.pos.x + nx * hitDist;
  let endY = lander.pos.y + ny * hitDist;

  lasers.push({ endX, endY, life: 1 });

  if (hitPlant) hitPlant.zap();
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
    circle(ex, ey, 22 * life);
    fill(255, 230, 250, 230 * life);
    circle(ex, ey, 9 * life);
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
  view.rotation = 0;
  view.focusX = lander ? lander.pos.x : 0;
  view.focusY = lander ? lander.pos.y : 0;
}

function updateView() {
  let targetScale;
  if (DEBUG.zoomOverride > 0) {
    // Manual zoom — debug flag forces a specific scale regardless of altitude.
    targetScale = DEBUG.zoomOverride;
  } else {
    let surfaceDistance = getClosestSurfaceDistance();
    let clampedDistance = constrain(surfaceDistance, 0, DEBUG.cameraZoomDistance);
    targetScale = map(
      clampedDistance,
      0,
      DEBUG.cameraZoomDistance,
      DEBUG.cameraMaxZoom,
      DEBUG.cameraMinZoom
    );
  }

  view.scale += (targetScale - view.scale) * CAMERA_ZOOM_EASE;
  view.focusX += (lander.pos.x - view.focusX) * CAMERA_FOLLOW_EASE;
  view.focusY += (lander.pos.y - view.focusY) * CAMERA_FOLLOW_EASE;
}

function getClosestSurfaceDistance() {
  let closestDistance = Infinity;

  for (let planet of planets) {
    let surfaceDistance = getSurfaceDistance(lander.pos, planet);
    if (surfaceDistance < closestDistance) {
      closestDistance = surfaceDistance;
    }
  }

  return closestDistance;
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

/*********************************************************
 *                   DRAW HELPERS
 *********************************************************/
let constellations = [];

function drawStarField() {
  // Just a guard in case constellations gets huge


  // Every 10 frames, pick a random star from stars[]
  if (frameCount % 100 === 0) {
    // use floor() or int() to be safe if random() is fractional
    let r = floor(random(stars.length));
    constellations = [stars[r]];
    for(let star of stars){
      if(star != stars[r]){
        let distToStar = dist(star.x, star.y, stars[r].x, stars[r].y);
        if(distToStar < 100){
          constellations.push(star);
        }
      }
    }
  }

  // Draw all stars as points
  strokeWeight(1);
  for (let star of stars) {
    stroke(star.brightness);
    point(star.x, star.y);
  }

  // Now draw a "constellation line" connecting the stars in constellations[]
  stroke(255, 255,255, 100 - frameCount/10 % 255);
  noFill();
  strokeWeight(2);
  if(frameCount/10 % 255 > 250){
    if (constellations.length >= 3) {
      constellations = [];
    }
  }
  beginShape();
  for (let cstar of constellations) {
    if (cstar) {
      vertex(cstar.x, cstar.y);
    }
  }
  endShape();
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


function drawHUD() {
  push();
  noStroke();
  fill(0, 0, 0, 145);
  rect(12, 12, 390, 238);
  pop();

  fill(255);
  noStroke();
  textAlign(LEFT);
  textSize(16);

  text(`Fuel: ${floor(lander.fuel)} / ${lander.maxFuel}`, 20, 30);
  text(`Altitude: ${floor(lander.altitude)}`, 20, 50);

  // Atmospheric drag readout: density and the resulting per-frame velocity
  // bleed. The displayed number accounts for substepping (lander.update), so
  // it never exceeds 100% even when k·ts is large.
  let atmoDensity = 0;
  for (let p of planets) atmoDensity += p.atmosphericDensity(lander.pos.x, lander.pos.y);
  if (atmoDensity > 1) atmoDensity = 1;
  let kts = DEBUG.atmosphereDrag * atmoDensity * timeScale;
  let dragSubsteps = max(1, ceil(kts / SUBSTEP_MAX_KDT));
  let dragPerFrame = 1 - pow(max(0, 1 - kts / dragSubsteps), dragSubsteps);
  text(
    `Velocity: ${lander.vel.mag().toFixed(2)}  Atmo: ${(atmoDensity * 100).toFixed(0)}%  Drag: ${(dragPerFrame * 100).toFixed(1)}%/f`,
    20,
    70
  );

  text(`Cargo: ${cargo} / ${lander.maxCargo}`, 20, 90);
  text(`Delivered: ${delivered} / ${DELIVERY_GOAL}`, 20, 110);
  text(`Research: ${research}`, 20, 130);
  text(`Score: ${score}`, 20, 150);
  drawMissionReadout();

  // Add time scale display
  textAlign(RIGHT);
  text(`Time Scale: ${timeScale.toFixed(1)}x`, width - 230, 45);

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
  let objective = cargo > 0
    ? "Land at base to deliver cargo"
    : "Click to zap plants. Hover above samples and hold SPACE to beam them up.";

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
  text("Controls: A/D rotate  |  W thrust  |  Q/E roll camera  |  Click zap  |  Space beam", 20, 240);
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
      if (base && base.inRange(lander.pos)) {
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
  // Movement / beam are polled via keyIsDown in pollInput().
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

  // Camera roll — handy when the ship starts on the side of a planet and
  // "down" lands diagonally on screen. Independent of time scale so the camera
  // stays responsive during slow-mo or fast-forward.
  if (keyIsDown(KEY_Q)) view.rotation -= CAMERA_ROTATE_SPEED;
  if (keyIsDown(KEY_E)) view.rotation += CAMERA_ROTATE_SPEED;

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
