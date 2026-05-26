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

    // Deterministic per-plant PRNG so the fractal stays stable across frames
    // and each plant grows into a distinct shape.
    let seed = (floor(abs(surfaceAngle) * 9173) ^ floor(surfaceRadius * 131)) | 1;
    let rng = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return ((seed >>> 0) / 0x100000000);
    };
    this.swaySeed = rng() * 1000;
    this.tree = this.buildTree(rng);
    this.leafColor = color(60 + rng() * 90, 170 + rng() * 70, 70 + rng() * 60);
    this.flowerColor = color(230 + rng() * 25, 90 + rng() * 140, 150 + rng() * 105);
    // Visual scale — overwritten by the field-spawn loop to vary tree heights.
    this.scale = 1;
  }

  buildTree(rng) {
    const MAX_DEPTH = 4;
    const ROOT_LEN = 16 + rng() * 10;
    let build = (depth) => {
      if (depth === 0) return [];
      let count = rng() < 0.55 ? 2 : 3;
      let spread = 24 + rng() * 22;
      let children = [];
      for (let i = 0; i < count; i++) {
        let t = count === 1 ? 0 : (i / (count - 1)) - 0.5;
        let angle = t * spread + (rng() - 0.5) * 10;
        let scale = 0.6 + rng() * 0.18;
        children.push({ angle, scale, children: build(depth - 1) });
      }
      return children;
    };
    return { length: ROOT_LEN, children: build(MAX_DEPTH), maxDepth: MAX_DEPTH };
  }

  drawTreeNode(node, length, depth, maxDepth, swayPhase) {
    // depth: maxDepth at root → 0 at tip. t blends styling from trunk to tips.
    let t = depth / maxDepth;
    let sw = lerp(0.9, 3.4, t);
    let r = lerp(150, 70, t);
    let g = lerp(190, 55, t);
    let b = lerp(90, 40, t);
    stroke(r, g, b, 240);
    strokeWeight(sw);

    // Tips sway more than the trunk — bendAmt scales with (1-t).
    let bend = (1 - t) * 3.5 * sin(swayPhase + depth * 37);
    line(0, 0, bend, -length);

    let tipX = bend;
    let tipY = -length;

    if (!node.children || node.children.length === 0) {
      push();
      translate(tipX, tipY);
      noStroke();
      fill(this.leafColor);
      circle(0, 0, 7);
      fill(this.flowerColor);
      circle(0, 0, 2.8);
      pop();
      return;
    }

    push();
    translate(tipX, tipY);
    for (let child of node.children) {
      push();
      rotate(child.angle + bend * 0.4);
      this.drawTreeNode(child, length * child.scale, depth - 1, maxDepth, swayPhase);
      pop();
    }
    pop();
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
    scale(this.scale);

    if (this.state === "growing") {
      // Fractal shrub — recursive branches with per-plant seeded structure.
      // Sway driven by a slow time-based phase plus per-plant offset.
      let swayPhase = frameCount * 1.6 + this.swaySeed;
      this.drawTreeNode(this.tree, this.tree.length, this.tree.maxDepth, this.tree.maxDepth, swayPhase);
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
