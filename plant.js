class Plant {
  constructor(planet, surfaceAngle, surfaceRadius) {
    this.planet = planet;
    this.surfaceAngle = surfaceAngle;
    this.surfaceRadius = surfaceRadius;
    this.size = 28;
    this.state = "growing"; // growing -> zapped -> carried -> stowed
    this.pos = createVector(0, 0);
    this.vel = createVector(0, 0);
    this.origin = createVector(0, 0);
    this.pullStrength = 0.15;
    this.recomputeOrigin();
    this.pos.set(this.origin.x, this.origin.y);
  }

  recomputeOrigin() {
    let r = this.surfaceRadius;
    let a = this.surfaceAngle;
    this.origin.set(
      this.planet.center.x + r * cos(a),
      this.planet.center.y + r * sin(a)
    );
  }

  update(timeScale = 1) {
    if (this.state === "stowed") return;
    this.recomputeOrigin();

    if (this.state === "growing") {
      // Rooted — track the planet as it orbits.
      this.pos.set(this.origin.x, this.origin.y);
      this.vel.set(0, 0);
      return;
    }

    let target = this.state === "carried" ? lander.pos : this.origin;
    let pull = this.state === "carried" ? this.pullStrength : this.pullStrength * 2;
    let dx = target.x - this.pos.x;
    let dy = target.y - this.pos.y;
    this.vel.x += dx * pull * timeScale;
    this.vel.y += dy * pull * timeScale;
    this.vel.mult(0.85);
    this.pos.add(this.vel.copy().mult(timeScale));

    if (
      this.state === "carried" &&
      cargo < lander.maxCargo &&
      dist(this.pos.x, this.pos.y, lander.pos.x, lander.pos.y) < 25
    ) {
      this.stow();
    }
  }

  render() {
    if (this.state === "stowed") return;

    let dx = this.pos.x - this.planet.center.x;
    let dy = this.pos.y - this.planet.center.y;
    let standAngle = atan2(dy, dx) + 90;

    push();
    translate(this.pos.x, this.pos.y);
    rotate(standAngle);

    if (this.state === "growing") {
      // Little shrub growing away from planet center.
      stroke(70, 130, 55);
      strokeWeight(3);
      line(0, 4, 0, -8);
      noStroke();
      fill(60, 180, 80);
      ellipse(-7, -10, 13, 15);
      ellipse(7, -10, 13, 15);
      fill(90, 220, 110);
      ellipse(0, -18, 16, 18);
    } else {
      // Loosened sample — glowing pod.
      let p = 0.5 + 0.5 * sin(frameCount * 4);
      push();
      blendMode(ADD);
      noStroke();
      fill(160, 255, 120, 70);
      circle(0, -8, 28 + p * 10);
      fill(200, 255, 150, 140);
      circle(0, -8, 16);
      fill(240, 255, 210, 230);
      circle(0, -8, 7);
      pop();
    }

    pop();
  }

  zap() {
    if (this.state !== "growing") return;
    this.state = "zapped";
    // Give it a small upward kick so it visibly pops off the surface.
    let radial = p5.Vector.sub(this.pos, this.planet.center);
    if (radial.magSq() > 0) {
      radial.normalize().mult(2);
      this.vel.set(radial.x, radial.y);
    }
    score += 5;
    if (typeof showEvent === "function") {
      showEvent("Sample loosened — tractor beam to collect");
    }
  }

  abduct() {
    if (this.state === "zapped") this.state = "carried";
  }

  drop() {
    if (this.state === "carried") this.state = "zapped";
  }

  stow() {
    this.state = "stowed";
    cargo += 1;
    score += 40;
    if (typeof showEvent === "function") {
      showEvent(`Plant sample stowed (${cargo} / ${lander.maxCargo})`);
    }
  }
}
