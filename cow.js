
class Cow {
  constructor(x, y, cowImage) {
    this.pos = createVector(x, y);
    this.vel = createVector(0, 0); // <-- Add this
    this.size = 50;
    this.state = "onGround";
    this.image = cowImage;
    this.offset = createVector();
    this.scale = 0.8;
    this.pull = 0;
    this.maxSpeed = 3; // Maximum speed
    this.pullStrength = 0.05; // How strongly it's pulled toward the lander
    this.origin = createVector(x, y);
  }

  update() {
    if (this.state === "carried") {
      // Accelerate toward the Lander’s position rather than snapping to it

      let dx = lander.pos.x - this.pos.x;
      let dy = lander.pos.y - this.pos.y;

      // "Pull" the cow toward the Lander
      this.vel.x += dx * this.pullStrength;
      this.vel.y += dy * this.pullStrength;

      // Limit maximum speed
      let speed = this.vel.mag();
      if (speed > this.maxSpeed) {
        // Scale down velocity so it doesn't exceed maxSpeed
        this.vel.mult(this.maxSpeed / speed);
      }

      // Move the cow by its velocity
        this.pos.add(this.vel);
  
        
      
    } else if (this.state === "onGround") {
       // Accelerate toward the Lander’s position rather than snapping to it

      let dx = this.origin.x - this.pos.x;
      let dy = this.origin.y - this.pos.y;

      // "Pull" the cow toward the Lander
      this.vel.x += dx * this.pullStrength*2;
      this.vel.y += dy * this.pullStrength*2;
      

      // Limit maximum speed
      let speed = this.vel.mag();
      if (speed > this.maxSpeed) {
        // Scale down velocity so it doesn't exceed maxSpeed
        this.vel.mult(this.maxSpeed / speed);
      }

      // Move the cow by its velocity
        this.pos.add(this.vel);

    }
  }

  render() {
    push();
    translate(this.pos.x, this.pos.y);
    scale(this.scale);
    image(this.image, 0, 0, this.size, this.size);
    pop();
  }

  abduct() {
    if (this.state === "onGround") {
      this.state = "carried";
    }
  }

  drop() {
    this.state = "onGround";
  }
}
