class Cow {
  constructor(planet, surfaceAngle, surfaceRadius, cowImage) {
    this.planet = planet;
    this.surfaceAngle = surfaceAngle;
    this.surfaceRadius = surfaceRadius;
    this.size = 50;
    this.state = "onGround";
    this.image = cowImage;
    this.scale = 0.8;
    this.pullStrength = 0.15;
    // Cows are heavy — the tractor beam lifts them at a slow, capped speed.
    this.liftSpeed = 1.4;
    this.pos = createVector(0, 0);
    this.vel = createVector(0, 0);
    this.recomputeOrigin();
    this.pos.set(this.origin.x, this.origin.y);
  }

  recomputeOrigin() {
    let r = this.surfaceRadius;
    let a = this.surfaceAngle;
    if (!this.origin) this.origin = createVector(0, 0);
    this.origin.set(
      this.planet.center.x + r * cos(a),
      this.planet.center.y + r * sin(a)
    );
  }

  update(timeScale = 1) {
    if (this.state === "stowed") return;

    this.recomputeOrigin();

    if (this.state === "carried") {
      // Kinematic lift: move straight at the ship at a mass-capped speed so
      // heavier samples take longer to reel in and never oscillate past the
      // hatch like the old spring did.
      let dx = lander.pos.x - this.pos.x;
      let dy = lander.pos.y - this.pos.y;
      let d = sqrt(dx * dx + dy * dy);
      let step = this.liftSpeed * timeScale;
      if (d <= step) {
        this.pos.set(lander.pos.x, lander.pos.y);
        this.vel.set(0, 0);
      } else {
        let inv = 1 / d;
        this.pos.x += dx * inv * step;
        this.pos.y += dy * inv * step;
        this.vel.set(dx * inv * this.liftSpeed, dy * inv * this.liftSpeed);
      }
      if (cargo < lander.maxCargo &&
          dist(this.pos.x, this.pos.y, lander.pos.x, lander.pos.y) < 25) {
        this.stow();
      }
      return;
    }

    if (this.state === "falling") {
      // Gravity from the cow's home planet pulls it back down. Velocity
      // carries over from the lift, so a tug-then-release looks like a
      // toss — the cow keeps rising briefly, then falls.
      let planet = this.planet;
      let gx = planet.center.x - this.pos.x;
      let gy = planet.center.y - this.pos.y;
      let distSq = max(1, gx * gx + gy * gy);
      let distance = sqrt(distSq);
      let force = planet.gravity / distSq;
      this.vel.x += (gx / distance) * force * timeScale;
      this.vel.y += (gy / distance) * force * timeScale;
      this.pos.x += this.vel.x * timeScale;
      this.pos.y += this.vel.y * timeScale;

      let landAngle = atan2(this.pos.y - planet.center.y, this.pos.x - planet.center.x);
      let surfaceR = getSurfaceRadius(planet, landAngle);
      let centerDist = sqrt(distSq);
      if (centerDist <= surfaceR) {
        // Touchdown: re-attach the cow at the impact point.
        this.surfaceAngle = landAngle;
        this.surfaceRadius = surfaceR;
        this.recomputeOrigin();
        this.pos.set(this.origin.x, this.origin.y);
        this.vel.set(0, 0);
        this.state = "onGround";
      }
      return;
    }

    let dx = this.origin.x - this.pos.x;
    let dy = this.origin.y - this.pos.y;
    this.vel.x += dx * this.pullStrength * 2 * timeScale;
    this.vel.y += dy * this.pullStrength * 2 * timeScale;
    this.vel.mult(0.85);
    this.pos.add(this.vel.copy().mult(timeScale));
  }

  render() {
    if (this.state === "stowed") return;
    // Stand cow upright relative to its planet so the sprite isn't drawn into the terrain.
    let dx = this.pos.x - this.planet.center.x;
    let dy = this.pos.y - this.planet.center.y;
    let standAngle = atan2(dy, dx) + 90;
    push();
    imageMode(CENTER);
    translate(this.pos.x, this.pos.y);
    rotate(standAngle);
    scale(this.scale);
    image(this.image, 0, 0, this.size, this.size);
    imageMode(CORNER);
    pop();
  }

  abduct() {
    if (this.state === "onGround" || this.state === "falling") {
      this.state = "carried";
    }
  }

  drop() {
    if (this.state === "carried") this.state = "falling";
  }

  stow() {
    this.state = "stowed";
    cargo += 1;
    score += 50;
    if (typeof showEvent === "function") {
      showEvent(`Specimen stowed (${cargo} / ${lander.maxCargo})`);
    }
  }
}
