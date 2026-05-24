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

    let target = this.state === "carried" ? lander.pos : this.origin;
    let pull = this.state === "carried" ? this.pullStrength : this.pullStrength * 2;

    let dx = target.x - this.pos.x;
    let dy = target.y - this.pos.y;
    this.vel.x += dx * pull * timeScale;
    this.vel.y += dy * pull * timeScale;
    this.vel.mult(0.85);

    this.pos.add(this.vel.copy().mult(timeScale));

    // Stow once the cow reaches the lander, if there's room in the hold.
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
    if (this.state === "onGround") {
      this.state = "carried";
    }
  }

  drop() {
    if (this.state === "carried") this.state = "onGround";
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
