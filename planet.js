class Planet {
  constructor(center, baseRadius, noiseIntensity, numPoints, strokeColor, gravity) {
    this.center = center;
    this.baseRadius = baseRadius;
    this.noiseIntensity = noiseIntensity;
    this.numPoints = numPoints;
    this.strokeColor = strokeColor;
    this.landscape = this.generateLandscape();
    this.gravity = gravity;

    this.alien = new Alien(center, baseRadius, strokeColor);

  }

  generateLandscape() {
    let angleStep = 360 / this.numPoints;
    let noiseOffset = random(1000);
    let points = [];

    for (let i = 0; i < this.numPoints; i++) {
      let angle = i * angleStep;
      let r = this.baseRadius + noise(noiseOffset) * this.noiseIntensity;
      noiseOffset += 0.1;

      let x = this.center.x + r * cos(angle);
      let y = this.center.y + r * sin(angle);

      points.push({
        angle: angle,
        r: r,
        x: x,
        y: y,
        landable: false
      });
    }

    // close the loop
    points.push({ ...points[0] });

    // flatten arcs
    for (let i = 0; i < 3; i++) {
      let idx = floor(random(this.numPoints));
      for (let j = 0; j < 5; j++) {
        let k = (idx + j) % this.numPoints;
        points[k].r = this.baseRadius;
        points[k].landable = true;
        let a = points[k].angle;
        points[k].x = this.center.x + points[k].r * cos(a);
        points[k].y = this.center.y + points[k].r * sin(a);
      }
    }

    return points;
  }

  draw() {
    stroke(this.strokeColor);
    fill(this.strokeColor);
    beginShape();
    for (let p of this.landscape) {
      vertex(p.x, p.y);
    }
    endShape();
    
    // Draw landing pad indicators
    stroke(255, 255, 0);
    strokeWeight(4);
    for (let p of this.landscape) {
      if (p.landable) {
        point(p.x, p.y);
      }
    }
    strokeWeight(1);
    this.alien.draw();
  }
}

