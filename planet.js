class Planet {
  constructor(center, baseRadius, noiseIntensity, numPoints, density, orbitRadius,sun) {
  
    this.orbitCenter = sun;
    this.isSun = false;
    this.center = center;
    this.baseRadius = baseRadius;
    this.noiseIntensity = noiseIntensity;
    this.numPoints = numPoints;
    this.strokeColor =color(numPoints, noiseIntensity, baseRadius/density , density/ 10 );
    this.fillColor = color(numPoints, noiseIntensity, baseRadius/density , density/10 );;
    this.gravity = density;
   // Add orbital parameters
    if(this.center.x !== sun.x || this.center.y !== sun.y){
    this.orbitRadius = orbitRadius  // Distance from orbit center
    this.orbitSpeed = random(0.001, 0.002);   // Angular velocity
    this.orbitAngle = random(360)    // Starting angle
    this.orbitEccentricity =0 // 0 = circle, higher = more elliptical
    } else {
      this.isSun = true;
      this.orbitRadius = 0;
      this.orbitSpeed = 0;
      this.orbitAngle = 0;
      this.orbitEccentricity = 0;
    }

    this.updateOrbitPosition();
    this.landscape = this.generateLandscape();
    this.snakeShapes = this.generateSnakeShapes();
    this.alien = new Alien(this.center, baseRadius, this.strokeColor);
    

  }

  updateOrbitPosition() {
    if (this.isSun) {
      return;
    }

    let r = this.orbitRadius * (1 - this.orbitEccentricity * cos(this.orbitAngle));
    this.center.x = this.orbitCenter.x + r * cos(this.orbitAngle);
    this.center.y = this.orbitCenter.y + r * sin(this.orbitAngle);
  }

  update(timeScale = 1) {
    if (this.isSun) {
      this.alien.update(timeScale);
      this.updateLandscapePoints();
      return;
    }

    // Update orbit angle
    this.orbitAngle += this.orbitSpeed * timeScale;
    this.alien.update(timeScale);
    
    this.updateOrbitPosition();
    // Update landscape points relative to new center
    this.updateLandscapePoints();
  }
  updateLandscapePoints() {
    for (let point of this.landscape) {
      let angle = point.angle;
      let r = point.r;
      point.x = this.center.x + r * cos(angle);
      point.y = this.center.y + r * sin(angle);
    }
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

  generateSnakeShapes() {
    let shapes = [];
    let numShapes = floor(random(2, 5));
    
    for (let i = 0; i < numShapes; i++) {
      let points = [];
      let numPoints = floor(random(3, 6));
      let startAngle = random(360);
      let radius = this.baseRadius * random(0.4, 0.8);
      
      // Generate control points for the Bézier curve
      for (let j = 0; j < numPoints; j++) {
        let angle = startAngle + (360 / numPoints) * j;
        let r = radius + random(-20, 20);
        let x = r * cos(angle);
        let y = r * sin(angle);
        points.push({x, y});
      }
      
      shapes.push({
        points: points,
        color: color(
          random(100, 255),
          random(100, 255),
          random(100, 255),
          150
        )
      });
    }
    return shapes;
  }

  draw() {
    // Draw orbit path
    // push();
    // stroke(this.strokeColor, 50); // Semi-transparent orbit line
    // noFill();
    // beginShape();
    // for (let a = 0; a < 360; a += 5) {
    //   let r = this.orbitRadius * (1 - this.orbitEccentricity * cos(a));
    //   let x = this.orbitCenter.x + r * cos(a);
    //   let y = this.orbitCenter.y + r * sin(a);
    //   vertex(x, y);
    // }
    // endShape(CLOSE);

    // pop();

    // Atmosphere is drawn BEFORE the planet body so the innermost (opaque)
    // sky-blue disk gets covered by the terrain on the planet's interior,
    // leaving only the sky annulus visible around the surface.
    if (this.hasAtmosphere()) {
      noStroke();
      let outer = this.atmosphereOuterRadius();
      let inner = this.baseRadius;
      let layers = max(1, floor(DEBUG.atmosphereLayers));
      let curve = DEBUG.atmosphereCurve;
      for (let i = 0; i < layers; i++) {
        let linear = layers === 1 ? 1 : i / (layers - 1);
        let t = pow(linear, curve);
        let r = outer - (outer - inner) * t;
        if (i === layers - 1) {
          // Innermost band: fully opaque sky blue — reads as normal sky next to terrain.
          fill(120, 180, 230);
        } else {
          fill(140, 200, 255, 14);
        }
        circle(this.center.x, this.center.y, r * 2);
      }
    }

    // Draw planet
    stroke(this.strokeColor);
    fill(this.fillColor);
    beginShape();
    for (let p of this.landscape) {
      vertex(p.x, p.y);
    }
    endShape();

    // Draw snake shapes
    push();
    translate(this.center.x, this.center.y);
    for (let shape of this.snakeShapes) {
      beginShape();
      noStroke();
      fill(shape.color);
      
      // Draw closed Bézier curve
      let points = shape.points;
      vertex(points[0].x, points[0].y);
      
      for (let i = 0; i < points.length; i++) {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.length];
        let p3 = points[(i + 2) % points.length];
        
        let cp1x = p1.x + (p2.x - p1.x) * 0.5;
        let cp1y = p1.y + (p2.y - p1.y) * 0.5;
        let cp2x = p2.x + (p3.x - p2.x) * 0.5;
        let cp2y = p2.y + (p3.y - p2.y) * 0.5;
        
        bezierVertex(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
      
      endShape(CLOSE);
    }
    pop();

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

  hasAtmosphere() {
    return !this.isSun;
  }

  atmosphereOuterRadius() {
    return this.baseRadius * (1 + DEBUG.atmosphereScale);
  }

  // Returns 0..1 density at the given world point. 1 at the surface, 0 at the top.
  atmosphericDensity(x, y) {
    if (!this.hasAtmosphere()) return 0;
    let dx = x - this.center.x;
    let dy = y - this.center.y;
    let dist = sqrt(dx * dx + dy * dy);
    let altitude = dist - this.baseRadius;
    let thickness = this.baseRadius * DEBUG.atmosphereScale;
    if (altitude >= thickness) return 0;
    if (altitude <= 0) return 1;
    return 1 - altitude / thickness;
  }
}
