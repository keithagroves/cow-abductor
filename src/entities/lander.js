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
    // Captured at touchdown so the ship rides a moving body (e.g. the moon)
    // instead of staying frozen in world coords while the planet orbits out.
    this.landingPlanet = null;
    this.landingOffset = null;
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

    this.reset();
  }

  reset() {
    this.vel = createVector(0, 0);
    this.pos = createVector(0, 0);

    this.rotation = this.targetRotation = -90;
    this.scale = 0.8;
    this.active = true;
    this.crashed = false;
    this.thrusting = 0;
    this.fuel = this.maxFuel;
    this.heat = 0;
    this.landingPlanet = null;
    this.landingOffset = null;
    this.inWater = false;
    this.parachute = false;   // descent brake; deploy/cut with C
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
    this.crashed = true;
    this.thrusting = 0;
    this.abducting = false;
    this.parachute = false;

    console.log("Lander crashed!");
  }

  land() {
    this.active = false;
    this.thrusting = 0;
    this.abducting = false;
    this.parachute = false;
    this.vel.mult(0); // Stop all movement (relative to the landing body)

    // Stick the ship to whatever we touched down on. The world-frame snap
    // happens in updateWorld each frame so the ship rides along if the body
    // is on a physics orbit.
    if (this.nearestPlanet) {
      this.landingPlanet = this.nearestPlanet;
      this.landingOffset = createVector(
        this.pos.x - this.nearestPlanet.center.x,
        this.pos.y - this.nearestPlanet.center.y
      );
    }

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

  // Drop the ship in from space: position it just outside the planet's
  // atmosphere at `angle`, oriented for a retro-burn descent (ship "top" points
  // away from the planet so W thrusts against the fall), with a gentle inward
  // velocity so it reads as already descending when play begins.
  spawnAbovePlanet(planet, angle) {
    // Spawn just outside the atmosphere shell for a dramatic high descent. The
    // camera pulls back at altitude (see updateView) so the planet stays framed
    // the whole way down instead of the ship falling through empty black space.
    let surfaceR = (typeof getSurfaceRadius === "function")
      ? getSurfaceRadius(planet, angle)
      : planet.baseRadius;
    let outer = planet.atmosphereOuterRadius
      ? planet.atmosphereOuterRadius()
      : surfaceR * 1.6;
    let r = max(outer * 1.08, surfaceR + 1000);
    this.pos.set(
      planet.center.x + r * cos(angle),
      planet.center.y + r * sin(angle)
    );
    // Inward unit vector (toward the planet) plus the planet's orbital motion so
    // the ship falls with the world instead of being swept off it.
    let inwardX = -cos(angle);
    let inwardY = -sin(angle);
    let orb = planet.getOrbitalVelocity ? planet.getOrbitalVelocity() : { x: 0, y: 0 };
    let descendSpeed = 3;
    this.vel.set(orb.x + inwardX * descendSpeed, orb.y + inwardY * descendSpeed);
    // Same orientation rule as spawnOnPlanet: ship top points radially outward.
    this.rotation = this.targetRotation = angle + 90;
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

  // Sums atmospheric density at `position` and identifies the planet
  // contributing most of it. Drag and re-entry burn use this so they operate
  // in the *atmosphere's* frame (which moves with its planet) — co-moving
  // with the moon then feels like sitting still, not flying through a wind
  // tunnel at orbital speed.
  sampleAtmosphereAt(position) {
    if (DEBUG.atmosphereDrag <= 0 || DEBUG.atmosphereScale <= 0) {
      return { density: 0, planet: null };
    }
    let totalDensity = 0;
    let dominantPlanet = null;
    let dominantDensity = 0;
    for (let planet of planets) {
      let d = planet.atmosphericDensity(position.x, position.y);
      totalDensity += d;
      if (d > dominantDensity) {
        dominantDensity = d;
        dominantPlanet = planet;
      }
    }
    if (totalDensity > 1) totalDensity = 1;
    return { density: totalDensity, planet: dominantPlanet };
  }

  applyAtmosphericDrag(velocity, position, timeScale = 1) {
    let sample = this.sampleAtmosphereAt(position);
    if (sample.density <= 0) return;
    let factor = 1 - DEBUG.atmosphereDrag * sample.density * timeScale;
    if (factor < 0) factor = 0;
    let pvx = 0, pvy = 0;
    if (sample.planet && sample.planet.getOrbitalVelocity) {
      let pv = sample.planet.getOrbitalVelocity();
      pvx = pv.x;
      pvy = pv.y;
    }
    velocity.x = pvx + (velocity.x - pvx) * factor;
    velocity.y = pvy + (velocity.y - pvy) * factor;
  }

  // Continuous-time drag for the trajectory predictors. Returns the factor
  // and the atmosphere's frame velocity so the caller can apply drag toward
  // that frame instead of toward world-frame zero.
  predictAtmosphereDrag(simPosition, dt) {
    let sample = this.sampleAtmosphereAt(simPosition);
    if (sample.density <= 0) return null;
    let factor = exp(-DEBUG.atmosphereDrag * sample.density * dt);
    let pvx = 0, pvy = 0;
    if (sample.planet && sample.planet.getOrbitalVelocity) {
      let pv = sample.planet.getOrbitalVelocity();
      pvx = pv.x;
      pvy = pv.y;
    }
    return { factor, pvx, pvy };
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
        let drag = this.predictAtmosphereDrag(simPosition, timeScale);
        if (drag && drag.factor < 1) {
          simVelocity.x = drag.pvx + (simVelocity.x - drag.pvx) * drag.factor;
          simVelocity.y = drag.pvy + (simVelocity.y - drag.pvy) * drag.factor;
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
        let drag = this.predictAtmosphereDrag(posTmp, timeScale);
        if (drag && drag.factor < 1) {
          velTmp.x = drag.pvx + (velTmp.x - drag.pvx) * drag.factor;
          velTmp.y = drag.pvy + (velTmp.y - drag.pvy) * drag.factor;
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

    // Parachute: while deployed in atmosphere, bleed speed hard toward the
    // local air frame so it works as a descent brake. Stows itself in vacuum
    // (nothing to catch) so it can't be used as a space anchor.
    if (this.parachute) {
      let sample = this.sampleAtmosphereAt(this.pos);
      if (sample.density > 0.02) {
        let pvx = 0, pvy = 0;
        if (sample.planet && sample.planet.getOrbitalVelocity) {
          let pv = sample.planet.getOrbitalVelocity();
          pvx = pv.x; pvy = pv.y;
        }
        let f = pow(0.90, timeScale);
        this.vel.x = pvx + (this.vel.x - pvx) * f;
        this.vel.y = pvy + (this.vel.y - pvy) * f;
      } else {
        this.parachute = false;
      }
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
  render(timeScale = 1) {
    // Hide the hull once the ship is destroyed — the crash particle system in
    // sketch.js draws debris/smoke at the impact point instead.
    if (!this.crashed) {
      push();
      translate(this.pos.x, this.pos.y);
      scale(this.scale);
      rotate(this.rotation);

      // Thrust flame is drawn first so the hull sits on top of it.
      if (this.thrusting > 0 && this.active && this.fuel > 0) {
        this.drawThrustFlame();
      }
      // Parachute canopy billows above the nose while deployed.
      if (this.parachute && this.active) {
        this.drawParachute();
      }
      // Experimental shader-rendered alien hull (DEBUG.shaderShip); falls back to
      // the hand-drawn vector hull. Blitted in the ship's local frame.
      if (typeof DEBUG !== "undefined" && DEBUG.shaderShip &&
          typeof shipGfx !== "undefined" && shipGfx) {
        let h = constrain((this.heat || 0) / (DEBUG.heatMax || 100), 0, 1);
        renderShipShader(h, this.thrustLevel, shipSunDirLocal(this), this.abducting, this.fuel > 0);
        imageMode(CENTER);
        image(shipGfx, 0, SHIP_DRAW_CY, SHIP_DRAW_SIZE, SHIP_DRAW_SIZE);
        imageMode(CORNER);
      } else {
        this.drawShipBody();
      }

      pop();
    }
    // Tractor beam runs in world space (not the ship's local frame), so call
    // after the local push/pop. Runs every frame — even when the beam is off —
    // so released samples can fall instead of staying stuck in "carried".
    this.abduct();
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

  // Alien-rocket hull, drawn in local space (nose at -y, exhaust at +y).
  drawShipBody() {
    // Heat ratio 0..1 — lerps every painted color toward red-hot, and adds a
    // pulsing aura behind the hull once the metal starts to glow.
    let h = constrain((this.heat || 0) / (DEBUG.heatMax || 100), 0, 1);
    // Use a steeper curve so the tint is subtle until the player is in
    // genuine danger, then ramps fast as the hull approaches failure.
    let hVisible = pow(h, 1.4);
    let critical = h > 0.7;
    let pulse = critical ? 0.6 + 0.4 * sin(frameCount * 18) : 1;

    noStroke();

    // Outer hull silhouette — tapered nose to a wide engine block.
    fill(lerp(70, 255 * pulse, hVisible),
         lerp(80, 50, hVisible),
         lerp(95, 30, hVisible));
    beginShape();
    vertex(0, -30);
    vertex(-8, -23);
    vertex(-14, -12);
    vertex(-18, 0);
    vertex(-18, 14);
    vertex(18, 14);
    vertex(18, 0);
    vertex(14, -12);
    vertex(8, -23);
    endShape(CLOSE);

    // Inner highlight panel — gives the hull some depth without a gradient.
    fill(lerp(120, 255 * pulse, hVisible),
         lerp(200, 100, hVisible),
         lerp(220, 30, hVisible));
    beginShape();
    vertex(0, -25);
    vertex(-5, -15);
    vertex(-6, 0);
    vertex(-6, 10);
    vertex(6, 10);
    vertex(6, 0);
    vertex(5, -15);
    endShape(CLOSE);

    // Cockpit dome — glowing alien green, shifts orange as it heats.
    fill(lerp(80, 255 * pulse, hVisible),
         lerp(220, 80, hVisible),
         lerp(160, 30, hVisible),
         230);
    ellipse(0, -13, 14, 10);
    fill(220, 255 - 100 * hVisible, 230 - 150 * hVisible, 200);
    ellipse(-2, -15, 5, 3); // shine

    // Trim band across the belly.
    stroke(lerp(60, 255 * pulse, hVisible),
           lerp(200, 80, hVisible),
           lerp(200, 30, hVisible));
    strokeWeight(1.4);
    line(-17, 6, 17, 6);
    noStroke();

    // Swept side fins.
    fill(lerp(50, 255 * pulse, hVisible),
         lerp(60, 60, hVisible),
         lerp(75, 30, hVisible));
    triangle(-18, 0, -28, 18, -18, 14);
    triangle(18, 0, 28, 18, 18, 14);
    stroke(lerp(70, 255 * pulse, hVisible),
           lerp(220, 100, hVisible),
           lerp(200, 30, hVisible),
           220);
    strokeWeight(1.4);
    line(-18, 0, -28, 18);
    line(18, 0, 28, 18);
    noStroke();

    // Engine bell.
    fill(lerp(40, 200 * pulse, hVisible),
         lerp(45, 50, hVisible),
         lerp(55, 30, hVisible));
    rect(-6, 14, 12, 4);
    fill(lerp(20, 150 * pulse, hVisible),
         lerp(25, 40, hVisible),
         lerp(30, 20, hVisible));
    rect(-4, 18, 8, 3);

    // Top antenna with a blinking running light.
    stroke(150, 170, 185);
    strokeWeight(1);
    line(0, -30, 0, -36);
    noStroke();
    let blink = 0.5 + 0.5 * sin(frameCount * 6);
    fill(255, 70 + 80 * blink, 70 + 80 * blink);
    circle(0, -37, 3);
  }

  // Canopy + risers above the nose (ship local -y). Sways gently so the
  // descent reads as a real chute catching air.
  drawParachute() {
    let sway = sin(frameCount * 4) * 3;
    push();
    // Risers from the shoulders up to the canopy.
    stroke(225, 230, 240, 210);
    strokeWeight(1.2);
    line(-10, -20, -26 + sway, -52);
    line(10, -20, 26 + sway, -52);
    line(0, -22, sway, -56);
    // Canopy dome.
    noStroke();
    fill(230, 95, 95, 235);
    arc(sway, -54, 64, 42, 180, 360, CHORD);
    fill(255, 255, 255, 70);
    arc(sway, -54, 64, 42, 200, 255, CHORD);
    pop();
  }

  // Pulsing plasma exhaust — drawn in local space below the engine bell.
  drawThrustFlame() {
    let flicker = 0.75 + 0.25 * sin(frameCount * 3);
    let chaos = (noise(frameCount * 0.2) - 0.5) * 4;
    let len = 26 * flicker;

    push();
    blendMode(ADD);
    noStroke();

    fill(255, 120, 30, 100);
    triangle(-9, 18, chaos, 18 + len, 9, 18);

    fill(255, 210, 80, 180);
    triangle(-5, 18, chaos * 0.7, 18 + len * 0.85, 5, 18);

    fill(180, 250, 240, 230);
    triangle(-2.5, 18, chaos * 0.4, 18 + len * 0.55, 2.5, 18);

    pop();
  }

  abduct() {
    // The beam only grabs samples while the player actively holds space and
    // the ship is alive/near a planet. When inactive, the loop below still
    // runs to call drop() on anything currently being carried so it falls
    // instead of locking to the ship.
    let beamActive = this.abducting && this.active && !!this.nearestPlanet;
    let hasRoom = cargo < this.maxCargo;
    let A, B, C;

    if (beamActive) {
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

      A = createVector(this.pos.x, this.pos.y);
      B = createVector(leftX, leftY);
      C = createVector(rightX, rightY);
    }

    // Decide each frame whether each loose sample is still in the active beam.
    // If the beam is off, A/B/C are undefined and every carried item gets a
    // drop() (which transitions it to "falling" so it actually falls).
    let canGrab = beamActive && hasRoom;
    for (let cow of cows) {
      if (cow.state === "stowed") continue;
      let inBeam = false;
      if (canGrab) {
        let cowPos = createVector(cow.pos.x, cow.pos.y);
        let close = dist(this.pos.x, this.pos.y, cow.pos.x, cow.pos.y) < 50;
        inBeam = pointInTriangle(cowPos, A, B, C) || close;
      }
      if (inBeam) cow.abduct();
      else cow.drop();
    }

    for (let plant of flora) {
      if (plant.state === "growing" || plant.state === "stowed") continue;
      let inBeam = false;
      if (canGrab) {
        let plantPos = createVector(plant.pos.x, plant.pos.y);
        let close = dist(this.pos.x, this.pos.y, plant.pos.x, plant.pos.y) < 50;
        inBeam = pointInTriangle(plantPos, A, B, C) || close;
      }
      if (inBeam) plant.abduct();
      else plant.drop();
    }

    for (let mineral of minerals) {
      if (mineral.state === "intact" || mineral.state === "stowed") continue;
      let inBeam = false;
      if (canGrab) {
        let mPos = createVector(mineral.pos.x, mineral.pos.y);
        let close = dist(this.pos.x, this.pos.y, mineral.pos.x, mineral.pos.y) < 50;
        inBeam = pointInTriangle(mPos, A, B, C) || close;
      }
      if (inBeam) mineral.abduct();
      else mineral.drop();
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
