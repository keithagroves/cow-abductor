class Planet {
  constructor(center, baseRadius, noiseIntensity, numPoints, density, orbitRadius,sun) {
  
    this.orbitCenter = sun;
    console.log(this.orbitCenter);
    this.isSun = false;
    this.center = center;
    this.baseRadius = baseRadius;
    this.noiseIntensity = noiseIntensity;
    this.numPoints = numPoints;
    this.strokeColor =color(numPoints, noiseIntensity, baseRadius/density , density/ 10 );
    this.fillColor = color(numPoints, noiseIntensity, baseRadius/density , density/10 );;
    this.gravity = density;
   // Add orbital parameters
    if(this.center.x != sun.x && this.center.y != sun.y){
    this.orbitRadius = orbitRadius  // Distance from orbit center
    this.orbitSpeed = random(0.001, 0.002);   // Angular velocity
    this.orbitAngle = random(360)    // Starting angle
    this.orbitEccentricity =0 // 0 = circle, higher = more elliptical
    } else {
      this.isSun = true;
    }

    this.landscape = this.generateLandscape();

    this.alien = new Alien(this.center, baseRadius, this.strokeColor);
    

  }
  update() {
    // Update orbit angle
    this.orbitAngle += this.orbitSpeed;
    this.alien.update();
    
    // Calculate new position using elliptical orbit
    let r = this.orbitRadius * (1 - this.orbitEccentricity * cos(this.orbitAngle));
    if(!this.isSun){ 
    this.center.x = this.orbitCenter.x + r * cos(this.orbitAngle);
    this.center.y = this.orbitCenter.y + r * sin(this.orbitAngle);
    }
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

    // Draw planet
    stroke(this.strokeColor);
    fill(this.fillColor);
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
    // fill sky blue
    noStroke();
    fill(0, 150, 255, 50); 
    let largeEnoughToHaveAnAtmosphere = this.baseRadius > 1000;
    if(largeEnoughToHaveAnAtmosphere)
    circle(this.center.x, this.center.y, this.baseRadius * 2.2);
  }
}

