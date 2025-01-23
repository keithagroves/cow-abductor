class Alien {
    
    constructor(planetCenter, planetRadius, planetColor) {
        this.planetCenter = planetCenter;
        this.center = planetCenter
        this.orbitRadius = planetRadius + 50; // Account for alien height
        this.angle = 0;
        this.planetColor = planetColor;
        this.speed = 0.02;
        let x = this.center.x + cos(this.angle) * this.orbitRadius;
        let y = this.center.y + sin(this.angle) * this.orbitRadius;
        this.pos = createVector(x, y);
        this.image = loadImage('unnamed.png');
        this.image = loadImage('unnamed.png');
    }

    update(timeScale = 1) {
        // Update position around the orbit
        this.angle += this.speed * timeScale;
        let x = this.center.x + cos(this.angle) * this.orbitRadius;
        let y = this.center.y + sin(this.angle) * this.orbitRadius;
        this.pos = createVector(x, y);

        // if(dist(this.pos.x, this.pos.y, this.center.x, this.center.y) <= this.orbitRadius+50){
        // }
    }

    draw() {
        this.update();
        // Calculate arm and leg angles using sine wave
        let armAngle = sin(frameCount) * 45;
        let legAngle = cos(frameCount) * 20; // Offset by PI to alternate with arms
        
        push();
        // Move to orbital position and rotate to face movement direction
        translate(this.pos.x, this.pos.y);
        rotate(this.angle+degrees(PI/2));
        scale(0.3);
        stroke(this.planetColor);
        
        // // Head
        // circle(0, 0, 24);
        // line(-20,-20, -10,-10);
        // circle(-20, -20, 4);
        // circle(-10, -20, 4);
        // line(-10,-10, -10,-20);
        // circle(10, -20, 4);
        // line(20,-20, 10,-10);
        // circle(20, -20, 4);
        // line(10, -10, 10,-20);
        
        // // Body
        // line(0, 10, 0, 40);

        // // Arms with rotation
        // push();
        // translate(0, 25);
        
        // // Right arm
        // push();
        // rotate(armAngle);
        // line(0, 0, 20, 0);
        // circle(20, 0, 4);
        // pop();
        
        // // Left arm
        // push();
        // rotate(-armAngle);
        // line(0, 0, -20, 0);
        // circle(-20, 0, 4);
        // pop();
        
        // pop();
        
        // // Legs with rotation
        // push();
        // translate(0, 40); // Move to hip pivot point
        
        // // Right leg
        // push();
        // rotate(legAngle);
        // line(0, 0, 15, 20);
        // line(15, 20, 20, 20);
        // pop();
        
        // // Left leg
        // push();
        // rotate(-legAngle);
        // line(0, 0, -15, 20);
        // line(-15, 20, -20, 20);
        // pop();
        image(this.image, 0, 0, 100, 100);

        // pop();
        
        pop();
    }
}