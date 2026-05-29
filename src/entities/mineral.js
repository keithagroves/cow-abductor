// Surface mineral deposit — a rocky outcrop the player can laser to loosen
// and then beam up. Mirrors Plant's state machine (intact → zapped → carried
// → falling → stowed) so the laser and beam code can treat it uniformly.

class Mineral {
  constructor(planet, surfaceAngle, surfaceRadius) {
    this.planet = planet;
    this.surfaceAngle = surfaceAngle;
    this.surfaceRadius = surfaceRadius;
    this.state = "intact"; // intact -> zapped -> carried -> falling -> stowed
    this.pos = createVector(0, 0);
    this.vel = createVector(0, 0);
    this.origin = createVector(0, 0);
    this.pullStrength = 0.15;
    // Heavier than plants — reel speed is half so the player feels the weight.
    this.liftSpeed = 1.8;
    this.recomputeOrigin();
    this.pos.set(this.origin.x, this.origin.y);

    // Per-mineral PRNG so each rock keeps a stable shape and color.
    let seed = (floor(abs(surfaceAngle) * 7919) ^ floor(surfaceRadius * 197)) | 1;
    let rng = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return ((seed >>> 0) / 0x100000000);
    };
    this.scale = 0.7 + rng() * 0.8;

    // Lumpy boulder silhouette — 7-10 vertices on an irregular circle.
    let verts = 7 + floor(rng() * 4);
    this.shape = [];
    let baseSize = 11 + rng() * 8;
    for (let i = 0; i < verts; i++) {
      let a = (i / verts) * 360;
      let r = baseSize * (0.75 + rng() * 0.5);
      this.shape.push({ x: r * cos(a), y: r * sin(a) });
    }

    // Body tone — warm grey/brown rock with subtle variation per deposit.
    let toneShift = rng();
    this.bodyColor   = color(90 + toneShift * 30, 80 + toneShift * 25, 70 + toneShift * 20);
    this.shadowColor = color(45 + toneShift * 15, 38 + toneShift * 12, 32 + toneShift * 10);
    // Crystal tint — pick one of a few mineral families so deposits read as
    // different ores. Just visual flavor for now.
    let crystalRoll = rng();
    if (crystalRoll < 0.34)      this.crystalColor = color(140, 220, 255); // ice / quartz
    else if (crystalRoll < 0.67) this.crystalColor = color(255, 200, 120); // gold
    else                          this.crystalColor = color(220, 140, 255); // amethyst
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

    if (this.state === "intact") {
      this.pos.set(this.origin.x, this.origin.y);
      this.vel.set(0, 0);
      return;
    }

    if (this.state === "carried") {
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
      if (distance <= surfaceR) {
        this.surfaceAngle = landAngle;
        this.surfaceRadius = surfaceR;
        this.recomputeOrigin();
        this.pos.set(this.origin.x, this.origin.y);
        this.vel.set(0, 0);
        this.state = "zapped";
      }
      return;
    }

    // "zapped" — loose on the ground, gentle pull back to its origin so it
    // sticks where it landed.
    let dx = this.origin.x - this.pos.x;
    let dy = this.origin.y - this.pos.y;
    this.vel.x += dx * this.pullStrength * 2 * timeScale;
    this.vel.y += dy * this.pullStrength * 2 * timeScale;
    this.vel.mult(0.85);
    this.pos.add(this.vel.copy().mult(timeScale));
  }

  render() {
    if (this.state === "stowed") return;

    let dx = this.pos.x - this.planet.center.x;
    let dy = this.pos.y - this.planet.center.y;
    let standAngle = atan2(dy, dx) + 90;

    push();
    translate(this.pos.x, this.pos.y);
    rotate(standAngle);
    scale(this.scale);

    if (this.state === "intact") {
      // Stone body — drop shadow side first, then top body, then a small
      // crystal cluster jutting from the top for visual identification.
      noStroke();
      fill(this.shadowColor);
      beginShape();
      for (let p of this.shape) vertex(p.x, p.y + 2);
      endShape(CLOSE);

      fill(this.bodyColor);
      beginShape();
      for (let p of this.shape) vertex(p.x, p.y);
      endShape(CLOSE);

      // Crystal cluster — two faceted shards.
      push();
      translate(0, -8);
      fill(this.crystalColor);
      beginShape();
      vertex(-3, 0);
      vertex(0, -10);
      vertex(3, 0);
      endShape(CLOSE);
      fill(red(this.crystalColor), green(this.crystalColor), blue(this.crystalColor), 220);
      beginShape();
      vertex(2, 0);
      vertex(6, -6);
      vertex(8, 0);
      endShape(CLOSE);
      // Glint
      noStroke();
      fill(255, 255, 255, 180);
      circle(-1, -7, 2);
      pop();
    } else {
      // Loosened sample — same glow idiom as Plant, tinted to the rock's
      // crystal color so it reads as the same kind of "loose pickup."
      let p = 0.5 + 0.5 * sin(frameCount * 4);
      let cr = red(this.crystalColor);
      let cg = green(this.crystalColor);
      let cb = blue(this.crystalColor);
      push();
      blendMode(ADD);
      noStroke();
      fill(cr, cg, cb, 70);
      circle(0, -8, 28 + p * 10);
      fill(cr, cg, cb, 140);
      circle(0, -8, 16);
      fill(min(255, cr + 60), min(255, cg + 60), min(255, cb + 60), 230);
      circle(0, -8, 7);
      pop();
    }

    pop();
  }

  zap() {
    if (this.state !== "intact") return;
    this.state = "zapped";
    let radial = p5.Vector.sub(this.pos, this.planet.center);
    if (radial.magSq() > 0) {
      radial.normalize().mult(2);
      this.vel.set(radial.x, radial.y);
    }
    score += 8;
    if (typeof showEvent === "function") {
      showEvent("Mineral loosened — tractor beam to collect");
    }
  }

  abduct() {
    if (this.state === "zapped" || this.state === "falling") this.state = "carried";
  }

  drop() {
    if (this.state === "carried") this.state = "falling";
  }

  stow() {
    this.state = "stowed";
    cargo += 1;
    score += 60;
    if (typeof showEvent === "function") {
      showEvent(`Mineral stowed (${cargo} / ${lander.maxCargo})`);
    }
  }
}
