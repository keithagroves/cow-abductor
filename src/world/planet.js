// Radius at which a planet's `density` equals its surface gravity directly.
// Surface gravity scales linearly with radius around this point (see
// setDensity), so a planet twice this size pulls twice as hard at its surface,
// and a small moon pulls correspondingly less. This is the inverse of a naive
// fixed-GM model, where shrinking a planet would crank up surface gravity
// because the ground sits closer to the center.
const GRAVITY_REFERENCE_RADIUS = 8000;

class Planet {
  constructor(center, baseRadius, noiseIntensity, numPoints, density, orbitRadius,sun) {
  
    this.orbitCenter = sun;
    this.isSun = false;
    this.center = center;
    this.baseRadius = baseRadius;
    this.noiseIntensity = noiseIntensity;
    this.numPoints = numPoints;
    // Dark rock tone — slightly warm grey so the planet reads as weathered
    // stone. Texture variation comes from generateSurfaceTexture() rather than
    // the base color, so a single tint keeps things consistent.
    this.strokeColor = color(75, 72, 70);
    this.fillColor   = color(110, 105, 100);
    // Derive the GM term from density + size so surface gravity scales with the
    // planet's radius instead of spiking on small bodies.
    this.setDensity(density);
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

    // Water level above the spherical base. Anything where the terrain dips
    // below this radius is flooded; peaks above poke through as land. Default
    // 0 = airless rock / dry world. Set via setSeaLevel() from outside so
    // landable arcs are re-placed above the new water line.
    this.seaLevel = 0;

    this.updateOrbitPosition();
    this.landscape = this.generateLandscape();
    this.placeLandableArcs();
    this.snakeShapes = this.generateSnakeShapes();
    this.alien = new Alien(this.center, baseRadius, this.strokeColor);
    this.surfaceTexture = this.generateSurfaceTexture();
    // Clouds are now drawn by the shader pass in clouds.js (a continuous
    // FBM density field rather than discrete ellipses), so no per-planet
    // cloud state is needed here.
    // Background ridge silhouette — a second landscape with a different noise
    // seed and slightly larger amplitude. Rendered before the main terrain in
    // an atmospheric-haze color so its peaks read as distant mountains behind
    // the foreground silhouette (Hollow-Knight-style depth on the ground).
    this.backgroundRidge = this.hasAtmosphere() ? this.generateBackgroundRidge() : [];
  }

  // Set the planet's density and recompute the GM term (`this.gravity`) used by
  // every gravity consumer. Surface gravity works out to
  //   g_surface = gravity / baseRadius² = density * (baseRadius / REFERENCE)
  // so it grows with the planet's size: doubling the radius doubles the pull a
  // ship feels standing on the surface, rather than the small-planet spike you
  // get when GM is held constant.
  setDensity(density) {
    this.density = density;
    this.gravity = density * (this.baseRadius * this.baseRadius * this.baseRadius) / GRAVITY_REFERENCE_RADIUS;
  }

  generateBackgroundRidge() {
    // 3× the main terrain's resolution — bg ridge ends up with finer detail
    // along the silhouette without affecting collision/landing (which still
    // uses this.landscape).
    let pointCount = this.numPoints * 3;
    let angleStep = 360 / pointCount;
    // Independent seed so this ridge's peaks don't align with main terrain's.
    let noiseOffset = random(1000) + 500;
    let points = [];
    // Amplitude smaller than the main terrain so the ridge mostly sits
    // below the foreground silhouette and only an occasional peak pokes
    // above as a distant "horizon" mountain.
    let amplitude = this.noiseIntensity * 0.9;
    for (let i = 0; i < pointCount; i++) {
      let angle = i * angleStep;
      let r = this.baseRadius + noise(noiseOffset) * amplitude;
      noiseOffset += 0.06; // broader features than main terrain (which steps 0.1)
      points.push({ angle, r, x: 0, y: 0 });
    }
    points.push({ ...points[0] });
    return points;
  }

  generateSurfaceTexture() {
    const SIZE = 256;
    let gfx = createGraphics(SIZE, SIZE);
    // Force 1:1 so our pixel-write loop indexing matches the buffer layout
    // even on retina displays (where the default density is 2 and would make
    // the pixels array 4× larger than the loop covers).
    gfx.pixelDensity(1);

    // Sample a unique region of the noise field per planet so no two planets
    // share the same surface pattern.
    let seedOffset =
      (red(this.fillColor) + green(this.fillColor) * 3.7 + blue(this.fillColor) * 11.3) *
      0.097;

    let baseR = red(this.fillColor);
    let baseG = green(this.fillColor);
    let baseB = blue(this.fillColor);

    // The texture is drawn square over the disk [-texR, +texR] (see draw()), so
    // a pixel's distance from the buffer center maps linearly to world radius.
    // texR is the top of the noise band, so altitudeFrac runs 0 at the base
    // surface to 1 at the rim. Because draw() clips the texture to the terrain
    // polygon, only peaks keep their high-radius pixels — valleys clip away
    // first — so tinting by altitude paints snow on peaks and darkens basins
    // without needing to know the silhouette per angle.
    const texR = this.baseRadius + this.noiseIntensity;
    const halfSize = SIZE / 2;
    // Snow band and lowland-darkening thresholds (fractions of the noise band).
    const SNOW_START = 0.6, SNOW_FULL = 0.92;
    const LOW_DARK_TOP = 0.35, LOW_DARK_FACTOR = 0.55;

    gfx.loadPixels();
    for (let py = 0; py < SIZE; py++) {
      for (let px = 0; px < SIZE; px++) {
        let x = px * 0.012 + seedOffset;
        let y = py * 0.012 + seedOffset * 2.3;

        // 4-octave FBM so the surface has both broad regions and fine detail.
        let n = 0, amp = 0.5, freq = 1;
        for (let o = 0; o < 4; o++) {
          n += amp * noise(x * freq, y * freq);
          freq *= 2.1;
          amp *= 0.5;
        }

        // Stretch the typical noise range so we get more contrast than the
        // default 0.3..0.7 band noise() tends to produce.
        let t = constrain((n - 0.3) / 0.5, 0, 1);

        let r, g, b;
        // On worlds with water, paint the low-noise band as vegetation
        // (mossy lowlands fading from deep grass to lighter scrub near the
        // rock line). Above the grass band, fall through to the rock tint
        // driven by the base color so peaks read as exposed stone.
        const GRASS_LEVEL = 0.45;
        if (this.seaLevel > 0 && t < GRASS_LEVEL) {
          let depth = t / GRASS_LEVEL; // 0 deep moss → 1 scrub-near-rock
          r = lerp(45, 120, depth);
          g = lerp(85, 150, depth);
          b = lerp(40, 80, depth);
        } else {
          let factor = 0.5 + t * 1.1;
          r = constrain(baseR * factor, 0, 255);
          g = constrain(baseG * factor, 0, 255);
          b = constrain(baseB * factor, 0, 255);
        }

        // Altitude relative to the planet radius. The FBM value jitters the
        // boundary so the snow line and the dark lowland edge stay ragged
        // rather than reading as clean concentric rings.
        let dxc = px - halfSize, dyc = py - halfSize;
        let worldR = (Math.hypot(dxc, dyc) / halfSize) * texR;
        let altitude = constrain((worldR - this.baseRadius) / this.noiseIntensity, 0, 1);
        let ragged = altitude + (n - 0.5) * 0.25;

        // Darken the lowlands so basins read heavier than the mid slopes.
        let lowDark = constrain(ragged / LOW_DARK_TOP, 0, 1);
        let darkF = lerp(LOW_DARK_FACTOR, 1.0, lowDark);
        r *= darkF; g *= darkF; b *= darkF;

        // Snow cap: blend toward a cool white as we approach the rim/peaks.
        let snow = constrain((ragged - SNOW_START) / (SNOW_FULL - SNOW_START), 0, 1);
        r = lerp(r, 238, snow);
        g = lerp(g, 243, snow);
        b = lerp(b, 250, snow);

        let idx = (py * SIZE + px) * 4;
        gfx.pixels[idx]     = r;
        gfx.pixels[idx + 1] = g;
        gfx.pixels[idx + 2] = b;
        gfx.pixels[idx + 3] = 255;
      }
    }
    gfx.updatePixels();
    return gfx;
  }

  updateOrbitPosition() {
    if (this.isSun) {
      return;
    }

    let r = this.orbitRadius * (1 - this.orbitEccentricity * cos(this.orbitAngle));
    this.center.x = this.orbitCenter.x + r * cos(this.orbitAngle);
    this.center.y = this.orbitCenter.y + r * sin(this.orbitAngle);
  }

  // Switch this planet off the kinematic "go in a circle" path and onto the
  // same gravity-driven integration the ship uses. Seeds vel with the speed
  // needed for a circular orbit at the current radius around the parent body
  // referenced by orbitCenter.
  useGravityOrbit() {
    if (!this.orbitCenter) return;
    let dx = this.center.x - this.orbitCenter.x;
    let dy = this.center.y - this.orbitCenter.y;
    let r = sqrt(dx * dx + dy * dy);
    if (r < 1) return;
    // Find the parent body by reference identity on its center vector — that's
    // how callers wire moon → planet without us inventing a new field.
    let parent = planets.find(p => p.center === this.orbitCenter);
    let parentGravity = parent ? parent.gravity : this.gravity;
    // v² = g_parent / r for a circular orbit in our 1/r² gravity model.
    let speed = sqrt(parentGravity / r);
    // Tangent perpendicular to the radial vector (one of the two CCW/CW
    // directions — either gives a stable orbit).
    this.vel = createVector(-dy / r * speed, dx / r * speed);
    this.physicsOrbit = true;
  }

  // Per-frame velocity at timeScale=1 (i.e. how far the planet moves in one
  // simulation step). Use this to inherit orbital motion when landing/spawning
  // so the ship rides with the planet instead of getting swept past it.
  getOrbitalVelocity() {
    if (this.isSun) return createVector(0, 0);
    if (this.physicsOrbit) return createVector(this.vel.x, this.vel.y);
    let scale = (typeof DEBUG !== "undefined" && DEBUG.orbitSpeedScale !== undefined) ? DEBUG.orbitSpeedScale : 1;
    let effectiveSpeed = this.orbitSpeed * scale;
    let nextAngle = this.orbitAngle + effectiveSpeed;
    let rNext = this.orbitRadius * (1 - this.orbitEccentricity * cos(nextAngle));
    let nextX = this.orbitCenter.x + rNext * cos(nextAngle);
    let nextY = this.orbitCenter.y + rNext * sin(nextAngle);
    return createVector(nextX - this.center.x, nextY - this.center.y);
  }

  update(timeScale = 1) {
    if (this.isSun) {
      this.alien.update(timeScale);
      this.updateLandscapePoints();
      return;
    }

    if (this.physicsOrbit) {
      // Symplectic Euler: gravity first (from every other body), then move
      // with the updated velocity. Stable for orbital motion across long
      // horizons, unlike forward Euler which spirals outward.
      let gx = 0, gy = 0;
      for (let p of planets) {
        if (p === this) continue;
        let dx = p.center.x - this.center.x;
        let dy = p.center.y - this.center.y;
        let distSq = max(1, dx * dx + dy * dy);
        let dist = sqrt(distSq);
        let force = p.gravity / distSq;
        gx += (dx / dist) * force;
        gy += (dy / dist) * force;
      }
      this.vel.x += gx * timeScale;
      this.vel.y += gy * timeScale;
      this.center.x += this.vel.x * timeScale;
      this.center.y += this.vel.y * timeScale;
      this.alien.update(timeScale);
      this.updateLandscapePoints();
      return;
    }

    // Update orbit angle (scaled live by the debug slider).
    let scale = (typeof DEBUG !== "undefined" && DEBUG.orbitSpeedScale !== undefined) ? DEBUG.orbitSpeedScale : 1;
    this.orbitAngle += this.orbitSpeed * scale * timeScale;
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
    if (this.backgroundRidge) {
      for (let point of this.backgroundRidge) {
        point.x = this.center.x + point.r * cos(point.angle);
        point.y = this.center.y + point.r * sin(point.angle);
      }
    }
  }
  generateLandscape() {
    let noiseOffset = random(1000);
    let points = [];

    // 1-2 mountain "range" centers per planet. Angles near these get more
    // points (clustering) and higher noise amplitude (taller spikes), so the
    // silhouette gets dramatic jagged regions while the rest stays smooth.
    let numRanges = floor(random(1, 3));
    let ranges = [];
    for (let i = 0; i < numRanges; i++) {
      ranges.push({
        center: random(360),
        width: random(14, 22),     // gaussian sigma in degrees
        intensity: random(2.5, 4)  // density multiplier at the center
      });
    }
    // Cache range membership at any angle so we don't recompute the gaussian
    // sum five times per point.
    let rangeWeight = (theta) => {
      let w = 0;
      for (let r of ranges) {
        let delta = ((theta - r.center + 540) % 360) - 180;
        w += r.intensity * exp(-(delta * delta) / (2 * r.width * r.width));
      }
      return w;
    };

    // Inverse-CDF sample: bucket the density (1 + range weight) across the
    // circle, then map uniform i/numPoints to angle via the cumulative sum.
    // Monotonic by construction, so the polygon can't self-intersect no
    // matter how strong the clustering gets.
    const BUCKETS = 720;
    let cumulative = new Float32Array(BUCKETS + 1);
    for (let i = 0; i < BUCKETS; i++) {
      let theta = (i + 0.5) * (360 / BUCKETS);
      cumulative[i + 1] = cumulative[i] + 1 + rangeWeight(theta);
    }
    let totalMass = cumulative[BUCKETS];
    let angleAt = (t) => {
      let target = t * totalMass;
      let lo = 0, hi = BUCKETS;
      while (lo < hi) {
        let mid = (lo + hi) >> 1;
        if (cumulative[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      let idx = max(0, lo - 1);
      let frac = (target - cumulative[idx]) / (cumulative[idx + 1] - cumulative[idx]);
      return (idx + frac) * (360 / BUCKETS);
    };

    for (let i = 0; i < this.numPoints; i++) {
      let angle = angleAt(i / this.numPoints);
      // Bump amplitude inside ranges so clustered points get taller peaks on
      // top of their already-higher visual frequency (more samples per degree
      // through the same noise field).
      let w = rangeWeight(angle);
      let amp = this.noiseIntensity * (1 + w * 0.6);
      let r = this.baseRadius + noise(noiseOffset) * amp;
      noiseOffset += 0.1;

      let x = this.center.x + r * cos(angle);
      let y = this.center.y + r * sin(angle);

      points.push({
        angle: angle,
        r: r,
        // Remember the noise-driven radius so placeLandableArcs can reset
        // before re-flattening when sea level changes. Without this we'd
        // permanently lose the noise terrain after the first flatten pass.
        noiseR: r,
        x: x,
        y: y,
        landable: false
      });
    }

    // close the loop
    points.push({ ...points[0] });

    return points;
  }

  // Picks 3 random arcs along the terrain and flattens them into landing pads.
  // Re-runs from the stored noise r so calling this after setSeaLevel() resets
  // any prior flattening cleanly. Behavior splits on whether the planet has
  // water:
  //   - Dry world: flatten to baseRadius (the old valley-floor behavior, so
  //     the moon's pads keep working).
  //   - Water world: only seed arcs at noise indices already above sea level,
  //     and flatten to that index's own r so the pad is a plateau on a
  //     continent rather than a submerged valley.
  placeLandableArcs() {
    if (!this.landscape) return;
    // Reset every point to its stored noise r so we don't double-flatten.
    for (let p of this.landscape) {
      p.r = p.noiseR;
      p.landable = false;
      p.x = this.center.x + p.r * cos(p.angle);
      p.y = this.center.y + p.r * sin(p.angle);
    }

    let hasWater = this.seaLevel > 0;
    // 50 px of clearance above the water surface so pads aren't lapping.
    let minR = this.baseRadius + this.seaLevel + 50;
    // Flatten by angular width so pads stay consistent across clustered and
    // sparse regions of the new mountain-range terrain. ±4° ≈ 8° total arc.
    let halfWidth = 4;
    // Reject pad candidates whose neighbors just outside the pad arc rise
    // steeply above the pad floor — otherwise pads placed on the shoulder of
    // a mountain cluster spawn the lander next to an instant cliff. Buffer
    // checks the same arc width on each side, and the cliff tolerance scales
    // with noiseIntensity so the gate is consistent across planet sizes.
    let bufferOuter = halfWidth * 2;
    let cliffTolerance = this.noiseIntensity * 0.15;
    let placed = 0;
    let attempts = 0;
    while (placed < 3 && attempts < 300) {
      attempts++;
      let centerAngle = random(360);

      let nearest = -1;
      let bestDelta = 360;
      for (let i = 0; i < this.numPoints; i++) {
        let d = abs(((this.landscape[i].angle - centerAngle + 540) % 360) - 180);
        if (d < bestDelta) { bestDelta = d; nearest = i; }
      }
      if (hasWater && this.landscape[nearest].noiseR < minR) continue;
      let flatR = hasWater ? this.landscape[nearest].noiseR : this.baseRadius;

      let safe = true;
      for (let i = 0; i < this.numPoints; i++) {
        let d = abs(((this.landscape[i].angle - centerAngle + 540) % 360) - 180);
        if (d > halfWidth && d <= bufferOuter) {
          if (this.landscape[i].noiseR > flatR + cliffTolerance) {
            safe = false;
            break;
          }
        }
      }
      if (!safe) continue;

      for (let i = 0; i < this.numPoints; i++) {
        let d = abs(((this.landscape[i].angle - centerAngle + 540) % 360) - 180);
        if (d > halfWidth) continue;
        this.landscape[i].r = flatR;
        this.landscape[i].landable = true;
        let a = this.landscape[i].angle;
        this.landscape[i].x = this.center.x + flatR * cos(a);
        this.landscape[i].y = this.center.y + flatR * sin(a);
      }
      placed++;
    }
    // Mirror the close-of-loop helper point so the final segment still draws.
    if (this.landscape.length > this.numPoints) {
      let first = this.landscape[0];
      let last = this.landscape[this.landscape.length - 1];
      last.r = first.r;
      last.landable = first.landable;
      last.x = first.x;
      last.y = first.y;
    }
  }

  setSeaLevel(level) {
    this.seaLevel = level;
    this.placeLandableArcs();
    // Regenerate the surface texture so its low-noise basins repaint as
    // water. Without this the initial dry-world texture (generated when
    // seaLevel was still 0 in the constructor) stays in place even after
    // the sea floods in.
    this.surfaceTexture = this.generateSurfaceTexture();
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

    // Sun corona — soft warm halo around the star.
    if (this.isSun) {
      noStroke();
      let coronaLayers = 10;
      let coronaOuter = this.baseRadius * 2.0;
      let coronaInner = this.baseRadius * 0.95;
      for (let i = 0; i < coronaLayers; i++) {
        let linear = i / (coronaLayers - 1);
        let t = pow(linear, 2.5);
        let r = coronaOuter - (coronaOuter - coronaInner) * t;
        fill(255, 220, 100, 14);
        circle(this.center.x, this.center.y, r * 2);
      }
    }

    // Soft sky envelope: a radial blue gradient, opaque sky-blue just above the
    // terrain (covered by the planet body on the inside) and fading to fully
    // transparent at the outer edge. Drawn before the planet body so the opaque
    // inner disk only shows as a ring around the surface. This fills the slab
    // beneath the shader's bright arc/ring (atmosphere.js) so the planet reads
    // as having a full atmosphere instead of a thin band floating in space.
    // Note: it's rotationally symmetric, so it tints the night side blue too;
    // the shader still supplies the lit arc and sunset terminator on top.
    if (this.hasAtmosphere()) {
      let outer = this.atmosphereOuterRadius();
      let bandThickness = max(80, this.baseRadius * 0.05) * DEBUG.atmosphereInnerBand;
      let opaqueInner = this.baseRadius + this.noiseIntensity + bandThickness;
      let cx = this.center.x;
      let cy = this.center.y;

      let ctx = drawingContext;
      let grad = ctx.createRadialGradient(cx, cy, opaqueInner, cx, cy, outer);
      grad.addColorStop(0, "rgba(120, 180, 230, 1)");
      grad.addColorStop(1, "rgba(140, 200, 255, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, outer, 0, Math.PI * 2);
      ctx.fill();
    }

// Background ridge — distant-mountain silhouette painted in atmospheric
    // haze, drawn before the main terrain so its peaks read as horizon hills
    // behind the foreground. Only the parts that stick above the foreground
    // outline are visible; the rest gets covered when we draw the main body.
    // Gated by hasAtmosphere() at render time so airless bodies (moon) don't
    // pick up the haze even though the ridge was generated in the constructor.
    if (this.hasAtmosphere() && this.backgroundRidge && this.backgroundRidge.length > 0) {
      push();
      noStroke();
      // Blend the planet's own fill with the atmosphere's sky color and
      // darken slightly so distance reads.
      let baseR = red(this.fillColor);
      let baseG = green(this.fillColor);
      let baseB = blue(this.fillColor);
      let bgR = baseR * 0.45 + 90 * 0.55;
      let bgG = baseG * 0.45 + 130 * 0.55;
      let bgB = baseB * 0.45 + 180 * 0.55;
      fill(bgR, bgG, bgB, 220);
      beginShape();
      for (let p of this.backgroundRidge) {
        vertex(p.x, p.y);
      }
      endShape(CLOSE);
      pop();
    }

    // Water disk — drawn *behind* the planet body so the terrain texture on
    // top stays fully visible. The disk only ends up visible in the annular
    // slice between the polygon edge and rSea at valley angles (where the
    // polygon dips below sea level). Mountains whose r exceeds rSea cover
    // the disk completely at their angle, so they read as continuous land.
    let rSea = this.seaLevel > 0 ? this.baseRadius + this.seaLevel : 0;
    if (rSea > 0) {
      noStroke();
      fill(30, 90, 160);
      circle(this.center.x, this.center.y, rSea * 2);
    }

    // Draw planet body — noise-textured fill clipped to the terrain polygon,
    // then stroke the silhouette separately so the planet still has its
    // colored outline.
    let ctx = drawingContext;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.landscape[0].x, this.landscape[0].y);
    for (let i = 1; i < this.landscape.length; i++) {
      ctx.lineTo(this.landscape[i].x, this.landscape[i].y);
    }
    ctx.closePath();
    ctx.clip();

    let texR = this.baseRadius + this.noiseIntensity;
    image(
      this.surfaceTexture,
      this.center.x - texR,
      this.center.y - texR,
      texR * 2,
      texR * 2
    );

    ctx.restore();

    // Day/night terminator on the surface: darken the hemisphere facing away
    // from the sun, with a soft terminator that drifts using the same day-cycle
    // the atmosphere and cloud shaders use (a = frameCount * 0.05 * 0.005), so
    // the planet's lit side stays in step with the glowing limb. Clipped to the
    // terrain polygon so only the planet darkens, never the space around it.
    if (!this.isSun) {
      let sw = (typeof sunWorldPos === "function")
        ? sunWorldPos() : { x: this.center.x + 1, y: this.center.y };
      let sdx = sw.x - this.center.x, sdy = sw.y - this.center.y;
      let sl = Math.hypot(sdx, sdy) || 1;
      sdx /= sl; sdy /= sl;
      let a = (frameCount * 0.05) * 0.005;
      let ca = Math.cos(a), sa = Math.sin(a);
      let tx = ca * sdx - sa * sdy; // sun direction, day-cycle rotated
      let ty = sa * sdx + ca * sdy;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(this.landscape[0].x, this.landscape[0].y);
      for (let i = 1; i < this.landscape.length; i++) {
        ctx.lineTo(this.landscape[i].x, this.landscape[i].y);
      }
      ctx.closePath();
      ctx.clip();

      // Linear gradient from the sunlit limb (transparent) across to the night
      // limb (dark navy). The terminator sits just past center so the day side
      // stays generous and the transition is soft rather than a hard line.
      let sunX = this.center.x + tx * texR, sunY = this.center.y + ty * texR;
      let nightX = this.center.x - tx * texR, nightY = this.center.y - ty * texR;
      let grad = ctx.createLinearGradient(sunX, sunY, nightX, nightY);
      grad.addColorStop(0.0, "rgba(6, 10, 30, 0)");
      grad.addColorStop(0.5, "rgba(6, 10, 30, 0)");
      grad.addColorStop(0.64, "rgba(6, 10, 30, 0.4)");
      grad.addColorStop(1.0, "rgba(4, 7, 22, 0.8)");
      ctx.fillStyle = grad;
      ctx.fillRect(this.center.x - texR, this.center.y - texR, texR * 2, texR * 2);
      ctx.restore();
    }

    // Shoreline rim — bright line at rSea, only along landscape segments
    // whose terrain dips below sea level (the visible water-meets-sky arcs).
    // Anywhere terrain rises above rSea the rim is hidden behind the texture
    // we just drew, which is exactly what we want.
    if (rSea > 0) {
      stroke(180, 230, 255, 200);
      strokeWeight(2);
      noFill();
      for (let i = 0; i < this.landscape.length - 1; i++) {
        let p1 = this.landscape[i];
        let p2 = this.landscape[i + 1];
        if (p1.r < rSea && p2.r < rSea) {
          let x1 = this.center.x + rSea * cos(p1.angle);
          let y1 = this.center.y + rSea * sin(p1.angle);
          let x2 = this.center.x + rSea * cos(p2.angle);
          let y2 = this.center.y + rSea * sin(p2.angle);
          line(x1, y1, x2, y2);
        }
      }
    }

    // Cloud layer is rendered by the shader pass in clouds.js (drawn in
    // screen space after the camera pop so the FBM density samples line up
    // with the rest of the scene via the same camera-inverse transform).

    // Draw snake shapes
    // push();
    // translate(this.center.x, this.center.y);
    // for (let shape of this.snakeShapes) {
    //   beginShape();
    //   noStroke();
    //   fill(shape.color);
      
    //   // Draw closed Bézier curve
    //   let points = shape.points;
    //   vertex(points[0].x, points[0].y);
      
    //   for (let i = 0; i < points.length; i++) {
    //     let p1 = points[i];
    //     let p2 = points[(i + 1) % points.length];
    //     let p3 = points[(i + 2) % points.length];
        
    //     let cp1x = p1.x + (p2.x - p1.x) * 0.5;
    //     let cp1y = p1.y + (p2.y - p1.y) * 0.5;
    //     let cp2x = p2.x + (p3.x - p2.x) * 0.5;
    //     let cp2y = p2.y + (p3.y - p2.y) * 0.5;
        
    //     bezierVertex(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    //   }
      
    //   endShape(CLOSE);
    // }
    // pop();

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
    // Day/night shading deferred until we have proper shader-based lighting.
  }

  hasAtmosphere() {
    if (this.isSun) return false;
    // Per-planet override — set `planet.atmosphere = false` on airless bodies
    // like moons. Default true keeps every other planet behaving as before.
    if (this.atmosphere === false) return false;
    return true;
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
