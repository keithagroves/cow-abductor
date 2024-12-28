/*********************************************************
 *                   GAME CONSTANTS
 *********************************************************/
const WAITING = 0;
const PLAYING = 1;
const LANDED = 2;
const CRASHED = 3;
const GAMEOVER = 4;

/*********************************************************
 *                   GLOBALS
 *********************************************************/
let gameState = WAITING;
let score = 0;
let lander;
let cows = [];
let planets = []; // This is our array of planets
let stars = [];
let cowImage;
let view = { x: 0, y: 0, scale: 1 };
let zoomedIn = false;
let startTime;
let touchable = "ontouchstart" in window;
let research = 0;
let backgroundMusic=null;
let rocketSound;
let thrustPlaying = false;
let ROTATE_LEFT = false;
let ROTATE_RIGHT = false;
/*********************************************************
 *                   P5 LIFE CYCLE
 *********************************************************/
function preload() {
  cowImage = loadImage("darkCow.png", 
    // Success callback
    () => {
      console.log("Cow image loaded successfully");
    },
    // Error callback
    (error) => {
      console.error("Failed to load cow image:", error);
    }
  );
  // alien image
  alienImage = loadImage("alien.png",
    () => {
      console.log("Alien image loaded successfully");
    })
    // Success callback
  backgroundMusic = loadSound("leaving-for-good.mp3", 
    // Success callback
    () => {
      console.log("Background music loaded successfully");
    },
    // Error callback
    (error) => {
      console.error("Failed to load background music:", error);
    }
  );

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

  // Initialize audio context with user interaction
  if (getAudioContext().state !== 'running') {
    getAudioContext().suspend();
  }

  // Initialize starfield
  for (let i = 0; i < 100; i++) {
    stars.push({
      x: random(width),
      y: random(height),
      brightness: random(100, 255),
    });
  }

  // Create some planets (pushing them into the planets array)
  let planetCenter1 = createVector(width / 2, height / 2);
  let planetCenter2 = createVector(width, -200);

  planets.push(new Planet(planetCenter1, 250, 50, 180, color(100, 255, 100)));
  planets.push(new Planet(planetCenter2, 250, 50, 180, color(255, 0, 200)));

  // center, baseRadius, noiseIntensity, numPoints, strokeColor
  planets.push(
    new Planet(createVector(-1000, 300), 500, 100, 400, color(0, 255, 255))
  );

  resetGame();
}

function draw() {
  background(0);
  drawStarField();

  push();
  if (gameState === PLAYING) {
    updateView();
    translate(view.x, view.y);
    scale(view.scale);
  }

  // Draw every planet in the array
  for (let planet of planets) {
    planet.draw();
  }

  // Update and draw lander if we're not waiting
  if (gameState !== WAITING) {
    lander.update();
    checkCollisions(lander, planets); // Check collisions against *all* planets
    lander.render();
  }

  // Update and render all cows
  for (let cow of cows) {
    cow.update();
    cow.render();
  }

  pop();
  if(ROTATE_LEFT){
    lander.rotate(-.2);
  }
  else if (ROTATE_RIGHT){
    lander.rotate(.2);
    
  }
  drawHUD();
  drawGameStateMessages();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  // If you want to regenerate or adapt planet data, do it here
}

/*********************************************************
 *                   GAME FLOW
 *********************************************************/
function resetGame() {
  initializeCows();
  lander = new Lander();
  gameState = WAITING;
  score = 0;
  startTime = millis();
  view.scale = 1;
  zoomedIn = false;
}

function initializeCows() {
  // Example: pick a random landable planet to place cows on
  let randomPlanet = random(planets);
  let landablePoints = randomPlanet.landscape.filter((p) => p.landable);

  cows = [];
  for (let i = 0; i < 3; i++) {
    if (landablePoints.length > 0) {
      let point = random(landablePoints);
      // Place a cow slightly above the terrain
      dy = point.y - randomPlanet.center.y;
      dx = point.x - randomPlanet.center.x;
      angle = atan2(dy, dx);
      // move the cow distance from the radius of the planet
      cowY = point.y + 10 * sin(angle);
      cowX = point.x + 10 * cos(angle);

      if(i % 2 == 0){
        cows.push(new Cow(cowX, cowY, alienImage));
      } else {
      cows.push(new Cow(cowX, cowY, cowImage));
      }
    }
  }
}

/*********************************************************
 *                   VIEW & CAMERA
 *********************************************************/
function updateView() {
  let minDistance = Infinity;
  for (let planet of planets) {
    let distToCenter = dist(lander.pos.x, lander.pos.y, planet.center.x, planet.center.y);
    let approximateSurfaceDistance = max(0, distToCenter - (planet.baseRadius+100))
    minDistance = min(minDistance, approximateSurfaceDistance);
  }

  const ZOOM_THRESHOLD = 400; 
  const MAX_ZOOM = 3;        
  const MIN_ZOOM = 1;        

  if (minDistance < ZOOM_THRESHOLD) {
    // Smoothly interpolate zddoom based on distance
    let zoomFactor = map(minDistance, 0, ZOOM_THRESHOLD, MAX_ZOOM, MIN_ZOOM);
    view.scale += (zoomFactor - view.scale) * 0.1; // Smooth transition
  } else if (view.scale > MIN_ZOOM) {
    view.scale += (MIN_ZOOM - view.scale) * 0.1;
  }

  // Camera movement
  let targetX = -lander.pos.x * view.scale + width / 2;
  let targetY = -lander.pos.y * view.scale + height * 0.4;
  view.x += (targetX - view.x) * 0.1;
  view.y += (targetY - view.y) * 0.1;
}

/*********************************************************
 *                   COLLISION
 *********************************************************/
function checkCollisions(lander, planets) {
  if (!lander.active) return;
  lander.altitude = height; // Or Infinity, as a big default

  // Check collisions with each planet in the planets array
  let startdist = 100000;
  let closestPlanet = planets[0];
  for (let planet of planets) {
    let planDist = dist(
      planet.center.x,
      planet.center.y,
      lander.pos.x,
      lander.pos.y
    );
    if (planDist < startdist) {
      closestPlanet = planet;
      startdist = planDist;
    }
    let points = planet.landscape;
    for (let i = 0; i < points.length - 1; i++) {
      let p1 = points[i];
      let p2 = points[i + 1];

      // Check if horizontally above segment ...
      // Interpolate terrain, check if lander hits ground, etc.
      // Decide safe landing vs crash...
    }
  }
  lander.setNearestPlanet(closestPlanet);
}

/*********************************************************
 *                   DRAW HELPERS
 *********************************************************/
function drawStarField() {
  strokeWeight(1);
  for (let star of stars) {
    stroke(star.brightness);
    point(star.x, star.y);
  }
}
function getBeamStopPositionRadial( planet, maxBeamLength) {
  // 1) Compute angle from planet center to lander (in radians).
  let dx = lander.pos.x - planet.center.x;
  let dy = lander.pos.y - planet.center.y;
  let angleRad = atan2(dy, dx); // returns range -PI..PI
  let angleDeg = degrees(angleRad); // convert to degrees 0..360

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
  let terrainX = planet.center.x + interpolatedRadius * cos(radians(angleDeg));
  let terrainY = planet.center.y + interpolatedRadius * sin(radians(angleDeg));

  // 5) Radial distance from lander to terrain
  let radialDistance = dist(lander.pos.x, lander.pos.y, terrainX, terrainY);



  // 6) Compare with maxBeamLength
  if (radialDistance > maxBeamLength) {
    radialDistance = maxBeamLength;
  }

  return radialDistance;
}


function drawHUD() {
  fill(255);
  noStroke();
  textAlign(LEFT);
  textSize(16);
  text(`Score: ${score}`, 20, 30);
  text(`Fuel: ${floor(lander.fuel)}`, 20, 50);
  text(`Altitude: ${floor(lander.altitude)}`, 20, 70);
  text(`Velocity: ${lander.vel.mag().toFixed(2)}`, 20, 90);
  text(`Research: ${research}`, 20, 110);
}

function drawGameStateMessages() {
  textAlign(CENTER);
  textSize(24);
  switch (gameState) {
    case WAITING:
      text("CLICK OR PRESS ANY KEY TO START", width / 2, height / 2);
      break;
    case LANDED:
      text("LANDED SAFELY!", width / 2, height / 2);
      break;
    case CRASHED:
      text("CRASHED!", width / 2, height / 2);
      break;
    case GAMEOVER:
      text(`GAME OVER\nFinal Score: ${score}`, width / 2, height / 2);
      break;
  }
}

/*********************************************************
 *                   INPUT
 *********************************************************/
function keyPressed() {
  if (gameState === WAITING) {
    gameState = PLAYING;
    // Resume audio context and start background music
    userStartAudio().then(() => {
      if (backgroundMusic && !backgroundMusic.isPlaying()) {
        try {
          backgroundMusic.loop();
          backgroundMusic.setVolume(0.1);
        } catch (error) {
          console.error("Error playing background music:", error);
        }
      }
    });
    return;
  }
  if (keyCode === LEFT_ARROW) ROTATE_LEFT = true;
  if (keyCode === RIGHT_ARROW) ROTATE_RIGHT = true;
  if (keyCode === UP_ARROW) {
    // if (boost) {
    //   try {
    //     // boost.play();
    //     // boost.setVolume(0.1);
        
    //   } catch (error) {
    //     console.error("Error playing background music:", error);
    //   }
    // }
    playThruster()
    lander.setThrust(1);
  }
  if (key === "a" || key === "A") {
    lander.abducting = true;
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

function mousePressed() {
  if (gameState === WAITING) {
    gameState = PLAYING;
    // Resume audio context and start background music
    userStartAudio().then(() => {
      if (backgroundMusic && !backgroundMusic.isPlaying()) {
        try {
          backgroundMusic.loop();
          backgroundMusic.setVolume(0.1);
        } catch (error) {
          console.error("Error playing background music:", error);
        }
      }
    });
  }
}
