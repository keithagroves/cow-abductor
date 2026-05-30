// Headless physics harness — overrides p5's setup/draw to run sims instead of
// the game. Reuses the real Lander/Planet code so the numbers it reports are
// the same physics the player experiences.

const SIM_LINES = [];

function simLog(line) {
  SIM_LINES.push(line);
  const el = document.getElementById("sim-results");
  if (el) el.textContent = SIM_LINES.join("\n");
  console.log(line);
}

function simHeader(title) {
  simLog("");
  simLog(`=== ${title} ===`);
}

function getStarterPlanet() {
  return planets.find((p) => !p.isSun && p.landscape && p.landscape.some((pt) => pt.landable));
}

function totalAtmoDensity(pos) {
  let d = 0;
  for (let p of planets) d += p.atmosphericDensity(pos.x, pos.y);
  return d;
}

function freshLanderOn(planet) {
  const l = new Lander();
  l.spawnOnPlanet(planet);
  // Skip rotation easing during sims — snap to target so commanded headings
  // take effect on the next step.
  l.rotation = l.targetRotation;
  // spawnOnPlanet inherits the planet's orbital velocity, but the sim does not
  // advance the planets — so that inherited velocity becomes a real motion
  // relative to a frozen planet. Zero it out to test in the planet's frame.
  l.vel.set(0, 0);
  return l;
}

// Compute the "radial outward" rotation for a ship at pos relative to planet center.
function radialOutRotation(pos, planet) {
  const dx = pos.x - planet.center.x;
  const dy = pos.y - planet.center.y;
  // thrust dir = (sin(rot), -cos(rot)) should equal (dx, dy)/r
  // → rot = atan2(dx, -dy) in degrees (p5 angleMode is DEGREES)
  return atan2(dx, -dy);
}

// Tangential prograde (counter-clockwise) heading.
function tangentialRotation(pos, planet) {
  const dx = pos.x - planet.center.x;
  const dy = pos.y - planet.center.y;
  // tangent prograde unit = (-dy, dx)/r
  // → sin(rot) = -dy/r, -cos(rot) = dx/r
  return atan2(-dy, -dx);
}

/* -----------------------------------------------------------
 * SIM 1 — Time to escape the atmosphere
 * Spawn on the starter planet, full radial thrust, count frames
 * until total atmospheric density at the ship's position is 0.
 * --------------------------------------------------------- */
function simEscapeAtmosphere() {
  const starter = getStarterPlanet();
  lander = freshLanderOn(starter);

  const startAlt = getSurfaceDistance(lander.pos, starter);
  const atmoThickness = starter.baseRadius * DEBUG.atmosphereScale;

  // Sanity check: surface gravity must be less than thrust or the lander can't fly.
  const r0 = Math.sqrt(
    (lander.pos.x - starter.center.x) ** 2 + (lander.pos.y - starter.center.y) ** 2
  );
  const gAtSurface = starter.gravity / (r0 * r0);

  let frames = 0;
  const maxFrames = 20000;
  let escapeFrame = -1;
  let fuelAtEscape = 0;
  let speedAtEscape = 0;
  let sankIntoPlanet = false;

  while (frames < maxFrames) {
    lander.setThrust(1);
    lander.update(1);
    frames++;
    if (getSurfaceDistance(lander.pos, starter) <= 0) { sankIntoPlanet = true; break; }
    if (totalAtmoDensity(lander.pos) <= 0) {
      escapeFrame = frames;
      fuelAtEscape = lander.fuel;
      speedAtEscape = lander.vel.mag();
      break;
    }
    // If we ran out of fuel and we're decelerating back into the planet, give up.
    if (lander.fuel <= 0 && lander.vel.mag() < 0.1) break;
  }

  simHeader("Escape atmosphere (full radial thrust from starter surface)");
  simLog(`  starter planet:     ${starter.name}`);
  simLog(`  surface radius:     ${starter.baseRadius.toFixed(0)}`);
  simLog(`  surface gravity:    ${gAtSurface.toFixed(4)}  vs thrust ${DEBUG.thrust}  → ${gAtSurface < DEBUG.thrust ? "CAN lift off" : "CANNOT lift off"}`);
  simLog(`  atmosphere top:     +${atmoThickness.toFixed(0)} (DEBUG.atmosphereScale=${DEBUG.atmosphereScale})`);
  simLog(`  start altitude:     ${startAlt.toFixed(0)}`);
  if (sankIntoPlanet) {
    simLog(`  SANK INTO SURFACE after ${frames} frames — thrust does not overcome gravity.`);
    simLog(`  (Real game would keep the ship landed via collision detection.)`);
    return;
  }
  if (escapeFrame > 0) {
    simLog(`  ESCAPED in:         ${escapeFrame} frames (${(escapeFrame / 60).toFixed(2)}s @ 60fps)`);
    simLog(`  fuel used:          ${(lander.maxFuel - fuelAtEscape).toFixed(1)} / ${lander.maxFuel}`);
    simLog(`  exit speed:         ${speedAtEscape.toFixed(2)} units/frame`);
    simLog(`  exit altitude:      ${getSurfaceDistance(lander.pos, starter).toFixed(0)}`);
  } else {
    simLog(`  FAILED to escape within ${maxFrames} frames`);
    simLog(`  final altitude:     ${getSurfaceDistance(lander.pos, starter).toFixed(0)}`);
    simLog(`  final fuel:         ${lander.fuel.toFixed(1)}`);
  }
}

/* -----------------------------------------------------------
 * SIM 2 — Coast after a full radial burn
 * What happens if you hold thrust until the tank empties, pointing
 * straight up? Do you crash back, orbit, or escape into deep space?
 * --------------------------------------------------------- */
function simBurnUntilEmpty() {
  const starter = getStarterPlanet();
  lander = freshLanderOn(starter);

  let frames = 0;
  while (lander.fuel > 0 && frames < 20000) {
    lander.setThrust(1);
    lander.update(1);
    frames++;
  }
  const burnFrames = frames;
  const burnoutSpeed = lander.vel.mag();
  const burnoutAlt = getSurfaceDistance(lander.pos, starter);

  // Coast and watch what happens.
  let minAlt = burnoutAlt, maxAlt = burnoutAlt;
  let crashed = false, escaped = false;
  let coastFrames = 0;
  const maxCoast = 30000;
  while (coastFrames < maxCoast) {
    lander.setThrust(0);
    lander.update(1);
    coastFrames++;
    const alt = getSurfaceDistance(lander.pos, starter);
    if (alt < minAlt) minAlt = alt;
    if (alt > maxAlt) maxAlt = alt;
    if (alt <= 0) { crashed = true; break; }
    const dCenter = dist(lander.pos.x, lander.pos.y, starter.center.x, starter.center.y);
    if (dCenter > 200000) { escaped = true; break; }
  }

  simHeader("Burn until fuel empty (radial thrust), then coast");
  simLog(`  burn duration:      ${burnFrames} frames (${(burnFrames / 60).toFixed(2)}s)`);
  simLog(`  burnout speed:      ${burnoutSpeed.toFixed(2)}`);
  simLog(`  burnout altitude:   ${burnoutAlt.toFixed(0)}`);
  simLog(`  apoapsis (max alt): ${maxAlt.toFixed(0)}`);
  simLog(`  periapsis (min):    ${minAlt.toFixed(0)}`);
  let outcome;
  if (crashed) outcome = `CRASHED after ${coastFrames} coast frames (${(coastFrames / 60).toFixed(1)}s)`;
  else if (escaped) outcome = `ESCAPED starter SOI after ${coastFrames} coast frames`;
  else outcome = `still flying after ${maxCoast} coast frames (bounded trajectory)`;
  simLog(`  outcome:            ${outcome}`);
}

/* -----------------------------------------------------------
 * SIM 3 — Closed-loop orbit insertion (skilled pilot)
 * Strategy: radial burn until above atmosphere, then tangential burn,
 * cutting thrust as soon as we hit circular-orbit speed at the current
 * altitude. Coasts a full simulated orbit and checks for stability.
 * Reports fuel cost. Sweeps "altitude margin above atmo" to find the
 * cheapest stable insertion.
 * --------------------------------------------------------- */
function simAttemptOrbit() {
  const starter = getStarterPlanet();
  const atmoTop = starter.baseRadius * DEBUG.atmosphereScale;

  const distFromCenter = (pos) => dist(pos.x, pos.y, starter.center.x, starter.center.y);
  const vCircularAt = (r) => Math.sqrt(starter.gravity / r);

  simHeader("Attempt orbit (smart pilot: radial → tangential until v_circ)");
  simLog(`  starter planet:     ${starter.name}`);
  simLog(`  surface radius:     ${starter.baseRadius.toFixed(0)}`);
  simLog(`  atmosphere top:     +${atmoTop.toFixed(0)} (above surface)`);
  simLog(`  v_circular@surface: ~${vCircularAt(starter.baseRadius).toFixed(2)}`);
  simLog(`  v_escape@surface:   ~${Math.sqrt(2 * starter.gravity / starter.baseRadius).toFixed(2)}`);
  simLog(`  Δv budget (full):   ~${(DEBUG.thrust * DEBUG.maxFuel / 0.2).toFixed(1)} (thrust × frames-of-fuel)`);
  simLog("");

  // Radial component of velocity (positive = moving away from planet).
  const radialVelocity = (vel, pos) => {
    const dx = pos.x - starter.center.x;
    const dy = pos.y - starter.center.y;
    const r = Math.sqrt(dx * dx + dy * dy);
    return (vel.x * dx + vel.y * dy) / r;
  };
  // Tangential (prograde) component of velocity.
  const tangentialVelocity = (vel, pos) => {
    const dx = pos.x - starter.center.x;
    const dy = pos.y - starter.center.y;
    const r = Math.sqrt(dx * dx + dy * dy);
    return (vel.x * -dy + vel.y * dx) / r;
  };

  // Sweep radial-burn duration. Each value gives a different ballistic apoapsis.
  const burnDurations = [60, 100, 150, 200, 300, 500, 800, 1200];
  let firstStable = null;

  for (const Tburn of burnDurations) {
    lander = freshLanderOn(starter);

    let frames = 0;
    let phase1Fuel = 0, phase2Frames = 0, phase3Fuel = 0;
    let escaped = false, crashed = false, circAchieved = false;

    // Phase 1: radial burn for Tburn frames (or until fuel runs out).
    while (frames < Tburn && lander.fuel > 0) {
      lander.rotation = lander.targetRotation = radialOutRotation(lander.pos, starter);
      lander.setThrust(1);
      lander.update(1);
      frames++;
    }
    phase1Fuel = lander.maxFuel - lander.fuel;

    // Phase 2: COAST (no thrust) until radial velocity reaches zero (= apoapsis).
    // Bail if we escape the SOI or run too long without apoapsis.
    while (phase2Frames < 8000) {
      if (radialVelocity(lander.vel, lander.pos) <= 0) break;
      lander.setThrust(0);
      lander.update(1);
      phase2Frames++;
      if (distFromCenter(lander.pos) > 200000) { escaped = true; break; }
    }

    if (!escaped) {
      // Phase 3: tangential burn until v_TANGENTIAL ≥ v_circ at current radius.
      // We measure only the tangential component because gravity adds radial-
      // inward velocity during the burn; cutting on |v| would leave us with
      // not enough horizontal speed to stay in orbit.
      const fuelBeforeP3 = lander.fuel;
      while (lander.fuel > 0 && frames + phase2Frames < 20000) {
        const r = distFromCenter(lander.pos);
        const vCirc = vCircularAt(r);
        if (tangentialVelocity(lander.vel, lander.pos) >= vCirc) {
          circAchieved = true; break;
        }
        lander.rotation = lander.targetRotation = tangentialRotation(lander.pos, starter);
        lander.setThrust(1);
        lander.update(1);
        frames++;
      }
      phase3Fuel = fuelBeforeP3 - lander.fuel;
    }

    const burnoutAlt = getSurfaceDistance(lander.pos, starter);
    const burnoutSpeed = lander.vel.mag();
    const totalFuel = lander.maxFuel - lander.fuel;

    // Phase 4: coast and check stability over many orbital periods.
    let minAlt = burnoutAlt, maxAlt = burnoutAlt;
    let coastFrames = 0;
    const maxCoast = 30000;
    if (!escaped) {
      while (coastFrames < maxCoast) {
        lander.setThrust(0);
        lander.update(1);
        coastFrames++;
        const alt = getSurfaceDistance(lander.pos, starter);
        if (alt < minAlt) minAlt = alt;
        if (alt > maxAlt) maxAlt = alt;
        if (alt <= 0) { crashed = true; break; }
        if (distFromCenter(lander.pos) > 200000) { escaped = true; break; }
      }
    }

    const stable = !crashed && !escaped && circAchieved;
    let tag;
    if (!circAchieved && escaped) tag = "escaped during climb";
    else if (!circAchieved) tag = "out of fuel before circular";
    else if (stable) tag = "ORBIT";
    else if (crashed) tag = "crash";
    else tag = "escape";

    simLog(
      `  Tburn=${String(Tburn).padStart(4)}f  fuel: P1=${phase1Fuel.toFixed(0).padStart(3)} coast=${String(phase2Frames).padStart(4)}f P3=${phase3Fuel.toFixed(0).padStart(3)} total=${totalFuel.toFixed(0).padStart(3)}  apo=${maxAlt.toFixed(0).padStart(5)} peri=${minAlt.toFixed(0).padStart(5)}  → ${tag}`
    );
    if (stable && !firstStable) {
      firstStable = { Tburn, totalFuel, burnoutAlt, minAlt, maxAlt, phase1Fuel, phase2Frames, phase3Fuel };
    }
  }

  simLog("");
  if (firstStable) {
    simLog(`  RESULT: orbit achievable via Hohmann-style insertion.`);
    simLog(`    cheapest profile: radial burn for ${firstStable.Tburn} frames (${(firstStable.Tburn/60).toFixed(2)}s)`);
    simLog(`      P1 (radial burn):   ${firstStable.phase1Fuel.toFixed(0)} fuel`);
    simLog(`      P2 (coast to apo):  ${firstStable.phase2Frames} frames`);
    simLog(`      P3 (tangential):    ${firstStable.phase3Fuel.toFixed(0)} fuel`);
    simLog(`    total fuel cost: ${firstStable.totalFuel.toFixed(0)} / ${DEBUG.maxFuel} (${(100*firstStable.totalFuel/DEBUG.maxFuel).toFixed(0)}%)`);
    simLog(`    perigee ${firstStable.minAlt.toFixed(0)}, apogee ${firstStable.maxAlt.toFixed(0)}`);
  } else {
    simLog(`  RESULT: no stable orbit found even with closed-loop control.`);
  }
}

/* -----------------------------------------------------------
 * Setup override — build the world, run sims, stop p5.
 * --------------------------------------------------------- */
function runAllSimulations() {
  SIM_LINES.length = 0;
  simLog(`debug snapshot:`);
  simLog(`  thrust=${DEBUG.thrust}  maxFuel=${DEBUG.maxFuel}`);
  simLog(`  planetRadiusScale=${DEBUG.planetRadiusScale}  planetDensity=${DEBUG.planetDensity}  planetSpacing=${DEBUG.planetSpacing}`);
  simLog(`  atmosphereScale=${DEBUG.atmosphereScale}  atmosphereDrag=${DEBUG.atmosphereDrag}`);
  simLog(`  orbitSpeedScale=${DEBUG.orbitSpeedScale}`);

  simEscapeAtmosphere();
  simBurnUntilEmpty();
  simAttemptOrbit();
}

window.setup = function simSetup() {
  // Tiny offscreen canvas — p5 needs one but the sim doesn't render.
  createCanvas(2, 2);
  angleMode(DEGREES);

  // Use defaults, not whatever the player saved in localStorage — sims should
  // be reproducible across machines.
  loadDebugFromStorage();

  buildWorld();
  try {
    runAllSimulations();
  } catch (err) {
    simLog(`\nERROR: ${err.message}`);
    console.error(err);
  }
  noLoop();
};

window.draw = function simDraw() {};
