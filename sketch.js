/*********************************************************
 *                   GLOBALS
 *********************************************************/
let gameState = GAME_STATES.WAITING;
let score = 0;
let cargo = 0;
let alienImage;
let lander;
let cows = [];
let planets = []; // This is our array of planets
let base;
let delivered = 0;
let research = 0;
let burnParticles = [];
let stars = [];
let cowImage;
let view = { x: 0, y: 0, scale: 1, focusX: 0, focusY: 0 };
let startTime;
let touchable = "ontouchstart" in window;
let backgroundMusic=null;
let shipImage;
let shipFlameImage;
let shipFlameImage2;
let alienGroundImage;
let rocketSound;
let thrustPlaying = false;
let ROTATE_LEFT = false;
let ROTATE_RIGHT = false;
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
}

function buildWorld() {
  planets.length = 0;
  let scale = DEBUG.planetRadiusScale;
  let density = DEBUG.planetGravity;
  let spacing = DEBUG.planetSpacing;

  let sun = createVector(10000, -100);
  let starting = spacing * 4;

  // Inner planets (radii scale with the debug multiplier).
  planets.push(new Planet(createVector(0, 0),  800 * scale, 255, 255, density, starting, sun));
  starting += spacing;
  planets.push(new Planet(createVector(0, 0), 1000 * scale, 255, 255, density, starting, sun));
  starting += spacing;
  planets.push(new Planet(createVector(0, 0), 1200 * scale,  50, 180, density, starting, sun));
  starting += spacing;
  planets.push(new Planet(createVector(0, 0),  900 * scale, 255,  30, density, starting, sun));
  starting += spacing;
  planets.push(new Planet(createVector(0, 0), 1100 * scale,  50,  50, density, starting, sun));
  starting += spacing;

  // Sun: bigger and much less dense so it doesn't crush you.
  planets.push(new Planet(sun.copy(), 4000 * scale, 255, 180, 2000, 0, sun));

  // Outlier rogue planet.
  planets.push(new Planet(createVector(-5000, 1000), 1000 * scale, 100, 400, density, 500, sun));

  assignPlanetNames();

  // Pick the starter planet (smallest, highest gravity) and put the base on its surface.
  let starter = planets.find((p) => !p.isSun && p.landscape && p.landscape.some((pt) => pt.landable));
  if (starter) {
    base = new Base(starter, pickBaseAngle(starter));
  }
}
const MINIMAP_SIZE = 200;
let minimapBuffer = null;

function drawMinimap() {
  // Set up minimap position and size
  const mapSize = MINIMAP_SIZE;
  const padding = 20;
  const mapX = width - mapSize - padding;
  const mapY = padding;
  const mapScale = 0.02; // Adjust this to show more/less of the game world

  if (!minimapBuffer) {
    minimapBuffer = createGraphics(mapSize, mapSize);
  }
  minimapBuffer.clear();
  minimapBuffer.background(0, 0, 0, 200);
  
  // Draw border on buffer
  minimapBuffer.stroke(255);
  minimapBuffer.strokeWeight(2);
  minimapBuffer.noFill();
  minimapBuffer.rect(0, 0, mapSize, mapSize);

  // Calculate center of minimap
  const centerX = mapSize/2;
  const centerY = mapSize/2;

  if (lander && lander.active) {
    // Draw planets relative to lander position
    for (let planet of planets) {
      // Convert world coordinates to minimap coordinates, relative to lander
      let minimapX = centerX + (planet.center.x - lander.pos.x) * mapScale;
      let minimapY = centerY + (planet.center.y - lander.pos.y) * mapScale;
      
      // Draw planet
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
          centerX + (planet.orbitCenter.x - lander.pos.x) * mapScale,
          centerY + (planet.orbitCenter.y - lander.pos.y) * mapScale,
          orbitRadius * 2,
          orbitRadius * 2
        );
      }
    }

    // Draw cows relative to lander position
    for (let cow of cows) {
      let minimapX = centerX + (cow.pos.x - lander.pos.x) * mapScale;
      let minimapY = centerY + (cow.pos.y - lander.pos.y) * mapScale;
      minimapBuffer.fill(0, 255, 0);
      minimapBuffer.noStroke();
      minimapBuffer.circle(minimapX, minimapY, 3);
    }

    // Predicted trajectory — longer horizon than the main-view line so the
    // minimap can show where you'll end up after several minutes of coasting.
    if (DEBUG.showTrajectory) {
      let pts = lander.predictLongTrajectory(timeScale, DEBUG.minimapTrajectorySteps, 4);
      // Pre-project all visible points into minimap space, stopping when we
      // leave a generous clip rectangle so distant slingshots don't streak.
      let projected = [{ x: centerX, y: centerY }];
      for (let i = 0; i < pts.length; i++) {
        let mx = centerX + (pts[i].x - lander.pos.x) * mapScale;
        let my = centerY + (pts[i].y - lander.pos.y) * mapScale;
        if (mx < -mapSize || mx > mapSize * 2 || my < -mapSize || my > mapSize * 2) break;
        projected.push({ x: mx, y: my });
      }

      if (projected.length >= 2) {
        minimapBuffer.noFill();
        minimapBuffer.stroke(80, 255, 220, 180);
        minimapBuffer.strokeWeight(1);
        minimapBuffer.beginShape();
        // curveVertex needs control points at each end; duplicate the first
        // and last so the spline passes through every visible sample.
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
      let bX = centerX + (base.pos.x - lander.pos.x) * mapScale;
      let bY = centerY + (base.pos.y - lander.pos.y) * mapScale;
      minimapBuffer.fill(120, 220, 255);
      minimapBuffer.noStroke();
      minimapBuffer.circle(bX, bY, 6);
    }

    // Draw lander in center
    minimapBuffer.fill(255, 0, 0);
    minimapBuffer.noStroke();
    minimapBuffer.circle(centerX, centerY, 4);

    // Draw view rectangle centered on lander
    minimapBuffer.noFill();
    minimapBuffer.stroke(255, 100);
    minimapBuffer.strokeWeight(1);
    let viewWidth = (width / view.scale) * mapScale;
    let viewHeight = (height / view.scale) * mapScale;
    minimapBuffer.rect(
      centerX - viewWidth/2, 
      centerY - viewHeight/2, 
      viewWidth, 
      viewHeight
    );
  }

  // Draw compass directions
  minimapBuffer.textSize(12);
  minimapBuffer.textAlign(CENTER, CENTER);
  minimapBuffer.fill(255);
  minimapBuffer.noStroke();
  minimapBuffer.text('N', centerX, 15);
  minimapBuffer.text('S', centerX, mapSize - 15);
  minimapBuffer.text('W', 15, centerY);
  minimapBuffer.text('E', mapSize - 15, centerY);

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
  translate(view.x, view.y);
  scale(view.scale);

  // Draw every planet in the array
  for (let planet of planets) {
    planet.draw();
  }

  if (base) base.draw();

  drawBurnParticles();
  lander.render(timeScale);

  // Render all cows
  for (let cow of cows) {
    cow.render();
  }

  pop();
  if(gameState === GAME_STATES.PLAYING && ROTATE_LEFT){
    lander.rotate(-.2 * timeScale);
  }
  else if (gameState === GAME_STATES.PLAYING && ROTATE_RIGHT){
    lander.rotate(.2 * timeScale);
  }
  if (gameState !== GAME_STATES.WAITING) {
    drawHUD();
    drawMinimap();
  }
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
  burnParticles = [];
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
  // Reactivate and nudge upward away from the nearest planet so we don't immediately re-collide.
  // Note: refueling is base-only (handled in tryDeliver). Lift-off here just unlocks the ship.
  lander.active = true;
  if (lander.nearestPlanet) {
    let dx = lander.pos.x - lander.nearestPlanet.center.x;
    let dy = lander.pos.y - lander.nearestPlanet.center.y;
    let d = sqrt(dx * dx + dy * dy);
    if (d > 0) {
      let kick = DEBUG.liftoffKick;
      lander.vel.x = (dx / d) * kick;
      lander.vel.y = (dy / d) * kick;
      lander.pos.x += (dx / d) * (lander.radius + 5);
      lander.pos.y += (dy / d) * (lander.radius + 5);
    }
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

  updateBurnParticles(timeScale);
  updateDiscoveries();
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
    }
  }
}

function resetView() {
  view.scale = 1;
  view.focusX = lander ? lander.pos.x : 0;
  view.focusY = lander ? lander.pos.y : 0;
  view.x = width / 2 - view.focusX * view.scale;
  view.y = height / 2 - view.focusY * view.scale;
}

function updateView() {
  let surfaceDistance = getClosestSurfaceDistance();
  let clampedDistance = constrain(surfaceDistance, 0, DEBUG.cameraZoomDistance);
  let targetScale = map(
    clampedDistance,
    0,
    DEBUG.cameraZoomDistance,
    DEBUG.cameraMaxZoom,
    DEBUG.cameraMinZoom
  );

  view.scale += (targetScale - view.scale) * CAMERA_ZOOM_EASE;
  view.focusX += (lander.pos.x - view.focusX) * CAMERA_FOLLOW_EASE;
  view.focusY += (lander.pos.y - view.focusY) * CAMERA_FOLLOW_EASE;

  // Keep translation derived from the same focal point as zoom so scale changes
  // do not make the ship slide around the screen.
  view.x = width / 2 - view.focusX * view.scale;
  view.y = height / 2 - view.focusY * view.scale;
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
  text(`Velocity: ${lander.vel.mag().toFixed(2)}`, 20, 70);
  text(`Cargo: ${cargo} / ${lander.maxCargo}`, 20, 90);
  text(`Delivered: ${delivered}`, 20, 110);
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

function drawMissionReadout() {
  let nearest = getNearestPlanetInfo();
  let specimensRemaining = cows.filter((cow) => cow.state !== "stowed").length;
  let objective = cargo > 0
    ? "Land at base to deliver cargo"
    : "Find specimens. Hold A to abduct.";

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
  text("Controls: arrows rotate  |  up thrust  |  A abduct", 20, 240);
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

  let screenX = target.pos.x * view.scale + view.x;
  let screenY = target.pos.y * view.scale + view.y;
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
        text("AT BASE — CARGO DELIVERED, FULL TANK\nCLICK UPGRADES OR PRESS ANY KEY TO LIFT OFF", width / 2, height / 2 - 30);
      } else {
        text("LANDED — PRESS ANY KEY TO LIFT OFF", width / 2, height / 2);
      }
      break;
    case GAME_STATES.CRASHED:
      text("CRASHED! PRESS ANY KEY TO RESTART", width / 2, height / 2);
      break;
    case GAME_STATES.GAMEOVER:
      text(`MISSION COMPLETE — ${delivered} cows delivered\nScore: ${score}\nPRESS ANY KEY TO RESTART`, width / 2, height / 2);
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
  if (keyCode === LEFT_ARROW) ROTATE_LEFT = true;
  if (keyCode === RIGHT_ARROW) ROTATE_RIGHT = true;
  if (keyCode === UP_ARROW) {
    // Only fire the engines if there's actually fuel in the tank.
    if (lander.fuel > 0) {
      playThruster();
      lander.setThrust(1);
    }
  }
  if (key === "a" || key === "A") {
    lander.abducting = true;
  }
  if (key === "t" || key === "T") {
    setDebugValue("showTrajectory", !DEBUG.showTrajectory);
  }
}

function keyReleased() {
  if (keyCode === UP_ARROW) {
    lander.setThrust(0);
     stopThruster();
  }
  if (key === "a" || key === "A") {
    lander.abducting = false;
  }
  if (keyCode === LEFT_ARROW) ROTATE_LEFT = false;
  if (keyCode === RIGHT_ARROW) ROTATE_RIGHT = false;
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
  } else if (gameState === GAME_STATES.CRASHED || gameState === GAME_STATES.GAMEOVER) {
    resetGame();
    startGame();
  } else if (gameState === GAME_STATES.LANDED) {
    liftOff();
  }
}
