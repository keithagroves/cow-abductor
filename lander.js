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
    this.thrust = 0.01;
    this.drag = 0.999;
    this.topSpeed = 1000;
    this.image = loadImage("./ship.png");
    this.imagethrust = loadImage("./shipflame.png");
    this.imagethrust2 = loadImage("./flame2.png");
    
    this.reset();
  }

  reset() {
    this.vel = createVector(0, 0);
    this.pos = createVector(0, 0);
    
    this.rotation = this.targetRotation = -90;
    this.scale = 0.8;
    this.active = true;
    this.thrusting = 0;
    this.fuel = 1000;
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
    
    print("setting nearest planet")
    }
  }

  predictTrajectory() {
    let points = [];
    let simPos = this.pos.copy();
    let simVel = this.vel.copy();
    
    // Simulate next 100 steps
    for(let i = 0; i < 100; i++) {
      // Calculate gravity at this point
      let gravityVector = createVector(0, 0);
      
      for (let planet of planets) {
        let dx = planet.center.x - simPos.x;
        let dy = planet.center.y - simPos.y;
        let distSq = dx * dx + dy * dy;
        let smoothing = 1000;
        let adjustedDist = Math.pow(distSq, 0.85) + smoothing;
        let force = planet.gravity / adjustedDist;
        
        gravityVector.add(createVector(dx, dy).normalize().mult(force));
      }
      
      // Update simulated velocity and position
      simVel.add(gravityVector);
      simPos.add(simVel);
      
      // Store point
      points.push(simPos.copy());
      

    }
    
    return points;
  }
  update(timeScale = 1) {
    if (!this.active) return;

    // Smooth rotation
    this.rotation += (this.targetRotation - this.rotation) * 0.3 * timeScale;

    // Calculate gravitational forces from all planets
    let gravityVector = createVector(0, 0);
    for (let planet of planets) {
      let dx = planet.center.x - this.pos.x;
      let dy = planet.center.y - this.pos.y;
      let distSq = dx * dx + dy * dy;
      let smoothing = 0;
      let adjustedDist = distSq + smoothing;
      let gravitationalStrength = planet.gravity;
      let force = gravitationalStrength / adjustedDist;
      
      gravityVector.add(createVector(dx, dy).normalize().mult(force * timeScale));
    }
    
    // Apply gravitational forces
    this.vel.add(gravityVector);

    // Apply thrust
    if (this.thrusting > 0 && this.fuel > 0) {
      let thrustVector = createVector(0, -this.thrust * this.thrusting);
      let angle = this.rotation;
      let rotatedThrust = createVector(
        thrustVector.x * cos(angle) - thrustVector.y * sin(angle),
        thrustVector.x * sin(angle) + thrustVector.y * cos(angle)
      );
      this.vel.add(rotatedThrust.mult(timeScale));
      this.fuel -= 0.2 * this.thrusting * timeScale;
    }

    // Limit speed
    let speed = this.vel.mag();
    if (speed > this.topSpeed) {
      this.vel.mult(this.topSpeed / speed);
    }

    // Update position
    this.pos.add(this.vel.copy().mult(timeScale));

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
  render() {
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


    // Tractor beam
    if (this.abducting) {
      this.abduct();
    }
    noStroke();
    fill(255, 255, 0, 50);
   // ellipse(0, 5, 100, 100);

    pop();
    if(this.active) {
      let trajectoryPoints = this.predictTrajectory();
      push();
      stroke(255, 100); // Semi-transparent white
      strokeWeight(1);
      noFill();
      beginShape();
      for(let point of trajectoryPoints) {
        vertex(point.x, point.y);
      }
      endShape();
      pop();
    }
  }

  abduct() {
    let baseSize = 200; // Maximum tractor beam length
    let range = 20; // Beam width

    // Get where the beam should stop based on terrain
    let beamStopY = getBeamStopPositionRadial(this.nearestPlanet, baseSize);
    print("beam stop!!!", beamStopY)
    // Draw the triangle tractor beam
    noStroke();
    fill(255, 255, 255, 100);
    triangle(
      0,
      0,
      range,
      beamStopY, // Left corner at ground
      -range,
      beamStopY // Right corner at ground
    );

    fill(255, 255, 255, 150);
    ellipse(0, beamStopY, range * 2, 10); // Highlight beam base
    let triangleA = createVector(this.pos.x, this.pos.y + 11 * this.scale); // Top point
    let triangleB = createVector(
      this.pos.x - range,
      this.pos.y + beamStopY * this.scale
    ); // Bottom left
    let triangleC = createVector(
      this.pos.x + range,
      this.pos.y + beamStopY * this.scale
    ); // Bottom right
    // Check each cow
    for (let i = 0; i < cows.length; i++) {
      let cow = cows[i];

      let cowPos = createVector(cow.pos.x, cow.pos.y);

      // Check if the cow is within the triangle
      if (
        pointInTriangle(cowPos, triangleA, triangleB, triangleC) ||
        dist(this.pos.x, this.pos.y, cow.pos.x, cow.pos.y) < 50
      ) {
        cow.abduct();
      } else {
        cow.drop();
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
