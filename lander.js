const TRAJECTORY_POINT_COUNT = 120;
const TRAJECTORY_REFRESH_FRAMES = 4;
const TRAJECTORY_MIN_DISTANCE_SQ = 1;
const TRAJECTORY_DRAW_STRIDE = 3;
// Drag is applied multiplicatively as (1 - k·dt). That form is only accurate
// for small k·dt; once k·dt approaches 1 it zeros velocity outright (looks like
// the ship is hovering). We substep update() so each piece sees at most this
// much drag per slice.
const SUBSTEP_MAX_KDT = 0.1;

class Lander {
  constructor() {
    this.pos = createVector();
    this.vel = createVector();
    this.bottomLeft = createVector();
    this.bottomRight = createVector();

    this.rotation = 0;
    this.targetRotation = 0;
    this.scale = 0.8;
    this.active = true;
    this.fuel = 1000;
    this.thrusting = 0;
    this.abducting = false;
    this.altitude = 0;
    this.thrustLevel = 0;
    this.nearestPlanet = null;
    this.radius =20;
    // Physics constants
    this.gravity = 0.0;
    this.thrust = DEBUG.thrust;
    this.drag = 0.999;
    this.topSpeed = 1000;
    // Upgradeable stats (initial values come from the debug panel so live
    // tuning is reflected on the next reset).
    this.maxFuel = DEBUG.maxFuel;
    this.maxCargo = 3;
    this.beamRange = DEBUG.beamRange;
    this.beamWidth = DEBUG.beamWidth;
    this.trajectoryPoints = [];
    this.trajectoryOffsets = [];
    this.trajectoryLastFrame = -Infinity;
    this.trajectoryLastInputKey = "";
    this.beamDust = [];
    this.image = shipImage;
    this.imagethrust = shipFlameImage;
    this.imagethrust2 = shipFlameImage2;

    this.reset();
  }

  reset() {
    this.vel = createVector(0, 0);
    this.pos = createVector(0, 0);

    this.rotation = this.targetRotation = -90;
    this.scale = 0.8;
    this.active = true;
    this.thrusting = 0;
    this.fuel = this.maxFuel;
    this.trajectoryPoints = [];
    this.trajectoryOffsets = [];
    this.trajectoryLastFrame = -Infinity;
    this.trajectoryLastInputKey = "";
    this.beamDust = [];
  }

  
  rotate(direction) {
    this.targetRotation += direction * 15;
    // this.targetRotation = constrain(this.targetRotation, -90, 90);
  }
  crash() {
    this.active = false;
    this.thrusting = 0;
    this.abducting = false;
    
    // Optional: Add explosion particles or other crash effects here
    // You could emit an event or set a flag for the main game to handle visual effects
    
    console.log("Lander crashed!");
  }

  land() {
    this.active = false;
    this.thrusting = 0;
    this.abducting = false;
    this.vel.mult(0); // Stop all movement
    
    console.log("Lander landed safely!");
  }
  setThrust(power) {
    if (this.fuel <= 0) power = 0;
    this.thrusting = power;
  }

  setNearestPlanet(planet){
    if(planet != this.nearestPlanet){
      this.nearestPlanet = planet;
    }
  }

  spawnOnPlanet(planet) {
    // Use the same point as the base so we spawn right next to it.
    let point = (typeof pickBasePoint === "function")
      ? pickBasePoint(planet)
      : planet.landscape[0];
    let r = point.r + this.radius + 4;
    this.pos.set(
      planet.center.x + r * cos(point.angle),
      planet.center.y + r * sin(point.angle)
    );
    // Inherit the planet's orbital velocity so the ship rides along with the
    // planet instead of the planet drifting out from under it.
    let orb = planet.getOrbitalVelocity ? planet.getOrbitalVelocity() : { x: 0, y: 0 };
    this.vel.set(orb.x, orb.y);
    // Thrust direction in world space is (sin(rot), -cos(rot)) — the ship's "top".
    // We want that to point radially outward from the planet, which is
    // (cos(angle), sin(angle)). Solving gives rotation = angle + 90.
    this.rotation = this.targetRotation = point.angle + 90;
    this.nearestPlanet = planet;
    this.active = true;
  }

  applyGravityToVelocity(velocity, position, timeScale = 1) {
    let gravityX = 0;
    let gravityY = 0;

    for (let planet of planets) {
      let dx = planet.center.x - position.x;
      let dy = planet.center.y - position.y;
      let distSq = max(TRAJECTORY_MIN_DISTANCE_SQ, dx * dx + dy * dy);
      let distance = sqrt(distSq);
      let force = planet.gravity / distSq;

      gravityX += (dx / distance) * force * timeScale;
      gravityY += (dy / distance) * force * timeScale;
    }

    velocity.x += gravityX;
    velocity.y += gravityY;
  }

  applyThrustToVelocity(velocity, timeScale = 1) {
    if (this.thrusting <= 0 || this.fuel <= 0) {
      return;
    }

    let thrustForce = this.thrust * this.thrusting * timeScale;
    velocity.x += sin(this.rotation) * thrustForce;
    velocity.y -= cos(this.rotation) * thrustForce;
  }

  applyAtmosphericDrag(velocity, position, timeScale = 1) {
    if (DEBUG.atmosphereDrag <= 0 || DEBUG.atmosphereScale <= 0) return;
    let totalDensity = 0;
    for (let planet of planets) {
      totalDensity += planet.atmosphericDensity(position.x, position.y);
    }
    if (totalDensity <= 0) return;
    if (totalDensity > 1) totalDensity = 1;
    let factor = 1 - DEBUG.atmosphereDrag * totalDensity * timeScale;
    if (factor < 0) factor = 0;
    velocity.x *= factor;
    velocity.y *= factor;
  }

  // Continuous-time drag multiplier for the trajectory predictors. The real
  // simulation substeps applyAtmosphericDrag so its effective factor converges
  // to exp(-k·dt); we use that closed form directly here so predictions match
  // reality at any step size without needing the predictor to substep too.
  predictDragFactor(simPosition, dt) {
    if (DEBUG.atmosphereDrag <= 0 || DEBUG.atmosphereScale <= 0) return 1;
    let totalDensity = 0;
    for (let planet of planets) {
      totalDensity += planet.atmosphericDensity(simPosition.x, simPosition.y);
    }
    if (totalDensity <= 0) return 1;
    if (totalDensity > 1) totalDensity = 1;
    return exp(-DEBUG.atmosphereDrag * totalDensity * dt);
  }

  limitVelocity(velocity) {
    let speedSq = velocity.x * velocity.x + velocity.y * velocity.y;
    let topSpeedSq = this.topSpeed * this.topSpeed;

    if (speedSq > topSpeedSq) {
      let speed = sqrt(speedSq);
      velocity.x *= this.topSpeed / speed;
      velocity.y *= this.topSpeed / speed;
    }
  }

  predictTrajectory(timeScale = 1) {
    let inputKey = [
      round(this.vel.x),
      round(this.vel.y),
      round(timeScale * 10)
    ].join(":");

    let cacheIsFresh =
      this.trajectoryPoints.length === TRAJECTORY_POINT_COUNT &&
      frameCount - this.trajectoryLastFrame < TRAJECTORY_REFRESH_FRAMES &&
      inputKey === this.trajectoryLastInputKey;

    if (!cacheIsFresh) {
      let startX = this.pos.x;
      let startY = this.pos.y;
      let simPosition = { x: startX, y: startY };
      let simVelocity = { x: this.vel.x, y: this.vel.y };

      for (let i = 0; i < TRAJECTORY_POINT_COUNT; i++) {
        this.applyGravityToVelocity(simVelocity, simPosition, timeScale);
        let dragFactor = this.predictDragFactor(simPosition, timeScale);
        if (dragFactor < 1) {
          simVelocity.x *= dragFactor;
          simVelocity.y *= dragFactor;
        }
        this.limitVelocity(simVelocity);

        simPosition.x += simVelocity.x * timeScale;
        simPosition.y += simVelocity.y * timeScale;

        if (!this.trajectoryOffsets[i]) {
          this.trajectoryOffsets[i] = {
            x: simPosition.x - startX,
            y: simPosition.y - startY
          };
        } else {
          this.trajectoryOffsets[i].x = simPosition.x - startX;
          this.trajectoryOffsets[i].y = simPosition.y - startY;
        }
      }

      this.trajectoryLastFrame = frameCount;
      this.trajectoryLastInputKey = inputKey;
    }

    for (let i = 0; i < this.trajectoryOffsets.length; i++) {
      if (!this.trajectoryPoints[i]) {
        this.trajectoryPoints[i] = {
          x: this.pos.x + this.trajectoryOffsets[i].x,
          y: this.pos.y + this.trajectoryOffsets[i].y
        };
      } else {
        this.trajectoryPoints[i].x = this.pos.x + this.trajectoryOffsets[i].x;
        this.trajectoryPoints[i].y = this.pos.y + this.trajectoryOffsets[i].y;
      }
    }

    return this.trajectoryPoints;
  }

  // Coarser, longer-horizon trajectory for the minimap. No cache because the
  // minimap is forgiving of small per-frame jitter, and a bigger step (sub-stride)
  // keeps cost down.
  predictLongTrajectory(timeScale = 1, steps = 240, subStride = 4) {
    let pts = [];
    let simX = this.pos.x;
    let simY = this.pos.y;
    let simVX = this.vel.x;
    let simVY = this.vel.y;

    // Trajectory is "coast path" — assumes no thrust, but does include gravity
    // and atmospheric drag so the line accurately curves down toward a planet
    // once you punch into its atmosphere instead of pretending you'll skip
    // off and continue coasting.

    // Don't bail out on the planet we're currently inside the bounding radius of
    // (e.g. when sitting on a surface) — only bail after we've left it.
    let outsideAll = true;
    for (let p of planets) {
      let ddx = simX - p.center.x;
      let ddy = simY - p.center.y;
      let rSq = p.baseRadius * p.baseRadius;
      if (ddx * ddx + ddy * ddy < rSq) { outsideAll = false; break; }
    }

    outer: for (let i = 0; i < steps; i++) {
      for (let s = 0; s < subStride; s++) {
        let velTmp = { x: simVX, y: simVY };
        let posTmp = { x: simX, y: simY };
        this.applyGravityToVelocity(velTmp, posTmp, timeScale);
        let dragFactor = this.predictDragFactor(posTmp, timeScale);
        if (dragFactor < 1) {
          velTmp.x *= dragFactor;
          velTmp.y *= dragFactor;
        }
        simVX = velTmp.x;
        simVY = velTmp.y;
        let speedSq = simVX * simVX + simVY * simVY;
        let topSq = this.topSpeed * this.topSpeed;
        if (speedSq > topSq) {
          let speed = sqrt(speedSq);
          simVX *= this.topSpeed / speed;
          simVY *= this.topSpeed / speed;
        }
        simX += simVX * timeScale;
        simY += simVY * timeScale;

        // Stop the prediction when we hit any planet. We keep simulating
        // while we're still leaving the planet we spawned inside.
        let insideAny = false;
        for (let p of planets) {
          let ddx = simX - p.center.x;
          let ddy = simY - p.center.y;
          let rSq = p.baseRadius * p.baseRadius;
          if (ddx * ddx + ddy * ddy < rSq) { insideAny = true; break; }
        }
        if (outsideAll && insideAny) {
          // Record the impact point so the line terminates at the planet edge.
          pts.push({ x: simX, y: simY });
          break outer;
        }
        if (!insideAny) outsideAll = true;
      }
      pts.push({ x: simX, y: simY });
    }
    return pts;
  }

  calculateGravityVector(position, timeScale = 1) {
    let gravityVector = createVector(0, 0);

    for (let planet of planets) {
      let dx = planet.center.x - position.x;
      let dy = planet.center.y - position.y;
      let distSq = max(TRAJECTORY_MIN_DISTANCE_SQ, dx * dx + dy * dy);
      let distance = sqrt(distSq);
      let force = planet.gravity / distSq;

      gravityVector.x += (dx / distance) * force * timeScale;
      gravityVector.y += (dy / distance) * force * timeScale;
    }

    return gravityVector;
  }

  update(timeScale = 1) {
    if (!this.active) return;

    // If the tank ran dry mid-burn, kill thrust so the flame/sound also stop.
    if (this.thrusting > 0 && this.fuel <= 0) {
      this.thrusting = 0;
    }

    // Smooth rotation
    this.rotation += (this.targetRotation - this.rotation) * 0.3 * timeScale;

    // Pick substep count from current atmospheric density. When k·dt approaches
    // 1, the multiplicative drag formula collapses velocity to zero and the
    // ship visibly hovers; splitting the step keeps each slice in the stable
    // regime regardless of timeScale or atmosphereDrag.
    let densityNow = 0;
    for (let planet of planets) {
      densityNow += planet.atmosphericDensity(this.pos.x, this.pos.y);
    }
    if (densityNow > 1) densityNow = 1;
    let kdt = DEBUG.atmosphereDrag * densityNow * timeScale;
    let substeps = max(1, ceil(kdt / SUBSTEP_MAX_KDT));
    let dt = timeScale / substeps;

    // Fuel burn is per-frame, independent of substep slicing.
    if (this.thrusting > 0 && this.fuel > 0) {
      this.fuel -= 0.2 * this.thrusting * timeScale;
    }

    for (let i = 0; i < substeps; i++) {
      this.vel.add(this.calculateGravityVector(this.pos, dt));

      // Thrust is folded into each substep so a single-frame burn at high
      // timeScale doesn't overshoot the drag it should have fought through.
      if (this.thrusting > 0 && this.fuel > 0) {
        this.applyThrustToVelocity(this.vel, dt);
      }

      this.applyAtmosphericDrag(this.vel, this.pos, dt);
      this.limitVelocity(this.vel);
      this.pos.add(this.vel.copy().mult(dt));
    }

    // Update collision points
    this.bottomLeft = createVector(
      this.pos.x - 10 * this.scale,
      this.pos.y + 14 * this.scale
    );
    this.bottomRight = createVector(
      this.pos.x + 10 * this.scale,
      this.pos.y + 14 * this.scale
    );

    // Fuel clamp
    if (this.fuel < 0) this.fuel = 0;
    this.thrustLevel = this.thrusting;
  }
   flip = false;
  render(timeScale = 1) {
    push();
    translate(this.pos.x, this.pos.y);
    scale(this.scale);
    rotate(this.rotation);
    let sizeDiv = 5;
    // Body
    stroke(255);
    noFill();
    if (this.thrusting > 0 && this.active && this.fuel > 0) {

      if(frameCount % 3 == 0){
        this.flip = !this.flip;
      }
      if(this.flip){
        image(this.imagethrust,  -350/sizeDiv, -700/sizeDiv, 740.963397/sizeDiv, 1000/sizeDiv);
      }
      else{
        image(this.imagethrust2,  -350/sizeDiv, -700/sizeDiv, 740.963397/sizeDiv, 1000/sizeDiv);
      }

      
    } else{
    // beginShape();
    // vertex(-10, -5);
    // vertex(10, -5);
    // vertex(10, 10);
    // vertex(-10, 10);
    // endShape(CLOSE);
    
    image(this.image, -350/sizeDiv, -700/sizeDiv, 740.963397/sizeDiv, 1000/sizeDiv);
    }
    // Landing legs
    // line(-10, 10, -15, 15);
    // line(10, 10, 15, 15);

    // Thrust animation


    noStroke();
    fill(255, 255, 0, 50);
   // ellipse(0, 5, 100, 100);

    pop();
    // Tractor beam runs in world space (not the ship's local frame),
    // so call after the local push/pop. Otherwise scale + rotation distort it.
    if (this.abducting) {
      this.abduct();
    }
    // Trajectory is drawn on the minimap only (see drawMinimap).
  }

  localToWorld(localX, localY) {
    let scaledX = localX * this.scale;
    let scaledY = localY * this.scale;
    return createVector(
      this.pos.x + scaledX * cos(this.rotation) - scaledY * sin(this.rotation),
      this.pos.y + scaledX * sin(this.rotation) + scaledY * cos(this.rotation)
    );
  }

  abduct() {
    if (!this.nearestPlanet) return;
    let planet = this.nearestPlanet;

    // Beam fires straight down the ship's local axis (opposite of thrust),
    // so the player must orient the ship above whatever they want to collect.
    let nx = -sin(this.rotation);
    let ny = cos(this.rotation);

    let beamLen = rayHitsTerrain(this.pos, nx, ny, this.beamRange, planet);
    let endX = this.pos.x + nx * beamLen;
    let endY = this.pos.y + ny * beamLen;

    // Perpendicular axis for the beam's wide end.
    let px = -ny;
    let py = nx;
    let halfWidth = this.beamWidth;
    let leftX = endX + px * halfWidth;
    let leftY = endY + py * halfWidth;
    let rightX = endX - px * halfWidth;
    let rightY = endY - py * halfWidth;

    let t = frameCount * 0.08;

    push();
    blendMode(ADD);
    noStroke();

    // Outer halo cones — stacked, soft, wider than the beam.
    for (let i = 3; i >= 1; i--) {
      let widen = 1 + i * 0.35;
      fill(110, 230, 200, 22);
      let lwX = endX + px * halfWidth * widen;
      let lwY = endY + py * halfWidth * widen;
      let rwX = endX - px * halfWidth * widen;
      let rwY = endY - py * halfWidth * widen;
      triangle(this.pos.x, this.pos.y, lwX, lwY, rwX, rwY);
    }

    // Core cone.
    fill(180, 255, 220, 90);
    triangle(this.pos.x, this.pos.y, leftX, leftY, rightX, rightY);

    // Pulsing inner core.
    let corePulse = 0.6 + 0.4 * sin(t * 60);
    fill(230, 255, 245, 140 * corePulse);
    let innerHalf = halfWidth * 0.35;
    triangle(
      this.pos.x,
      this.pos.y,
      endX + px * innerHalf,
      endY + py * innerHalf,
      endX - px * innerHalf,
      endY - py * innerHalf
    );

    // Scrolling suction stripes — travel from terrain end toward the ship.
    let stripeCount = 8;
    let scroll = (t * 0.25) % 1;
    strokeWeight(2);
    for (let i = 0; i < stripeCount; i++) {
      let phase = (i / stripeCount + scroll) % 1; // 0 at ship, 1 at end
      let cx = lerp(this.pos.x, endX, phase);
      let cy = lerp(this.pos.y, endY, phase);
      let w = halfWidth * phase;
      let a = 200 * sin(phase * 180);
      stroke(150, 255, 220, a);
      line(cx + px * w, cy + py * w, cx - px * w, cy - py * w);
    }
    noStroke();

    // Terrain-end splat — stacked oblong glows.
    push();
    translate(endX, endY);
    rotate(atan2(py, px));
    let splatBreath = 0.9 + 0.1 * sin(t * 40);
    for (let i = 4; i >= 1; i--) {
      fill(180, 255, 220, 50);
      let rx = halfWidth * (0.6 + i * 0.4) * splatBreath;
      ellipse(0, 0, rx * 2, rx * 0.4);
    }
    pop();

    // Dust particles getting funneled up the beam.
    for (let i = 0; i < 3; i++) {
      let s = random(-halfWidth * 0.9, halfWidth * 0.9);
      this.beamDust.push({
        x: endX + px * s,
        y: endY + py * s,
        t: 0,
        speed: random(0.02, 0.045),
        off: random(-halfWidth * 0.3, halfWidth * 0.3)
      });
    }
    for (let i = this.beamDust.length - 1; i >= 0; i--) {
      let d = this.beamDust[i];
      d.t += d.speed;
      if (d.t >= 1) { this.beamDust.splice(i, 1); continue; }
      let remaining = 1 - d.t;
      let cx = lerp(endX, this.pos.x, d.t);
      let cy = lerp(endY, this.pos.y, d.t);
      let lateral = d.off * remaining;
      let dx2 = cx + px * lateral;
      let dy2 = cy + py * lateral;
      fill(220, 255, 235, 220 * remaining);
      circle(dx2, dy2, 2 + 3 * remaining);
    }

    pop();

    let A = createVector(this.pos.x, this.pos.y);
    let B = createVector(leftX, leftY);
    let C = createVector(rightX, rightY);

    for (let cow of cows) {
      if (cow.state === "stowed") continue;
      let cowPos = createVector(cow.pos.x, cow.pos.y);
      let close = dist(this.pos.x, this.pos.y, cow.pos.x, cow.pos.y) < 50;
      if (pointInTriangle(cowPos, A, B, C) || close) {
        cow.abduct();
      } else {
        cow.drop();
      }
    }

    for (let plant of flora) {
      if (plant.state === "growing" || plant.state === "stowed") continue;
      let plantPos = createVector(plant.pos.x, plant.pos.y);
      let close = dist(this.pos.x, this.pos.y, plant.pos.x, plant.pos.y) < 50;
      if (pointInTriangle(plantPos, A, B, C) || close) {
        plant.abduct();
      } else {
        plant.drop();
      }
    }
  }
}

function pointInTriangle(pt, v1, v2, v3) {
  // Calculate area of the full triangle
  let area =
    0.5 *
    (-v2.y * v3.x + v1.y * (-v2.x + v3.x) + v1.x * (v2.y - v3.y) + v2.x * v3.y);
  let s =
    (1 / (2 * area)) *
    (v1.y * v3.x - v1.x * v3.y + (v3.y - v1.y) * pt.x + (v1.x - v3.x) * pt.y);
  let t =
    (1 / (2 * area)) *
    (v1.x * v2.y - v1.y * v2.x + (v1.y - v2.y) * pt.x + (v2.x - v1.x) * pt.y);

  return s > 0 && t > 0 && s + t < 1;
}
