const BASE_DELIVERY_RANGE = 240;
const DELIVERY_GOAL = 10;

const UPGRADES = [
  {
    id: "cargo",
    label: "Cargo bay +1",
    baseCost: 3,
    costStep: 2,
    apply: (l) => { l.maxCargo += 1; },
    summary: (l) => `now ${l.maxCargo}`
  },
  {
    id: "engine",
    label: "Engine +20%",
    baseCost: 3,
    costStep: 2,
    apply: (l) => { l.thrust *= 1.2; },
    summary: (l) => `${l.thrust.toFixed(3)}`
  },
  {
    id: "fuel",
    label: "Fuel tank +500",
    baseCost: 3,
    costStep: 2,
    apply: (l) => { l.maxFuel += 500; l.fuel = l.maxFuel; },
    summary: (l) => `now ${l.maxFuel}`
  },
  {
    id: "beam",
    label: "Tractor beam +",
    baseCost: 2,
    costStep: 2,
    apply: (l) => { l.beamRange += 60; l.beamWidth += 5; },
    summary: (l) => `r${l.beamRange}/w${l.beamWidth}`
  }
];

let upgradePurchases = {};
let shopButtons = [];

function upgradeCost(upgrade) {
  let bought = upgradePurchases[upgrade.id] || 0;
  return upgrade.baseCost + bought * upgrade.costStep;
}

function resetShop() {
  upgradePurchases = {};
  shopButtons = [];
}

// Pick a stable landable point on a planet, preferring one near the "top"
// (screen-up, angle 270°) so the player starts right-side-up.
function pickBasePoint(planet) {
  if (!planet.landscape || planet.landscape.length === 0) return null;
  let landable = planet.landscape.filter((p) => p.landable);
  if (landable.length === 0) return planet.landscape[0];
  const TARGET_ANGLE = 270;
  let best = landable[0];
  let bestDiff = Infinity;
  for (let p of landable) {
    let raw = abs(p.angle - TARGET_ANGLE) % 360;
    let diff = min(raw, 360 - raw);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  return best;
}

function pickBaseAngle(planet) {
  let p = pickBasePoint(planet);
  return p ? p.angle : 0;
}

class Base {
  constructor(planet, surfaceAngle) {
    this.planet = planet;
    this.surfaceAngle = surfaceAngle;
    this.pos = createVector(0, 0);
    this.surfaceRadius = planet.baseRadius;
    this.recomputePosition();
  }

  recomputePosition() {
    // Sample the planet's landscape to get the exact surface radius at this angle.
    let landscape = this.planet.landscape;
    let a = ((this.surfaceAngle % 360) + 360) % 360;
    let r = this.planet.baseRadius;
    if (landscape && landscape.length >= 2) {
      for (let i = 0; i < landscape.length - 1; i++) {
        let cur = landscape[i];
        let next = landscape[i + 1];
        let curA = cur.angle;
        let nextA = next.angle < curA ? next.angle + 360 : next.angle;
        let adjA = a < curA ? a + 360 : a;
        if (adjA >= curA && adjA <= nextA) {
          let f = (adjA - curA) / (nextA - curA);
          r = lerp(cur.r, next.r, f);
          break;
        }
      }
    }
    this.surfaceRadius = r;
    this.pos.set(
      this.planet.center.x + r * cos(this.surfaceAngle),
      this.planet.center.y + r * sin(this.surfaceAngle)
    );
  }

  update() {
    this.recomputePosition();
  }

  draw() {
    push();
    translate(this.pos.x, this.pos.y);
    rotate(this.surfaceAngle + 90); // stand the pad up relative to the planet
    noStroke();

    // Lower, flatter shadow in the same 2D language as the ship shadow.
    fill(0, 0, 0, 72);
    ellipse(0, 22, 178, 18);
    fill(0, 0, 0, 38);
    ellipse(0, 24, 214, 24);

    // Sink the pad into the local ground plane. Local +y points into the planet.
    translate(0, 7);

    // Earthworks/retaining plate partly buried below the deck.
    fill(38, 44, 50);
    ellipse(0, 9, 176, 24);
    fill(55, 63, 72);
    ellipse(0, 0, 190, 24);

    // Main launch deck: a round pad seen in the same flattened side-on
    // projection as the shadows, so it reads as an ellipse.
    fill(34, 38, 43);
    ellipse(0, -2, 176, 26);
    fill(82, 95, 108);
    ellipse(0, -10, 166, 32);
    fill(126, 145, 158);
    ellipse(0, -14, 146, 18);
    fill(70, 82, 94);
    ellipse(0, -10, 96, 14);

    // Hazard striping sits across the oval top, clipped visually by using
    // short center bars and shorter outer bars.
    fill(230, 205, 70);
    for (let i = -4; i <= 4; i++) {
      let len = 14 - abs(i) * 2;
      rect(i * 16 - len / 2, -16, len, 3, 1);
    }

    // Short buried supports. They should feel planted, not tall and spindly.
    fill(48, 55, 64);
    rect(-68, 5, 10, 24);
    rect(58, 5, 10, 24);
    fill(30, 35, 40);
    rect(-72, 27, 18, 5, 2);
    rect(54, 27, 18, 5, 2);

    // Low beacon mast. Keeping this short avoids fighting the foreground trees.
    stroke(165, 205, 220);
    strokeWeight(2);
    line(-52, -16, -52, -36);
    noStroke();
    fill(120, 230, 255, 230);
    circle(-52, -39, 7);
    fill(120, 230, 255, 70 + 35 * sin(frameCount * 3));
    circle(-52, -39, 16);

    // Small pennant gives it "base" identity without becoming a tall flagpole.
    let wave = sin(frameCount * 2) * 2;
    noStroke();
    fill(120, 220, 255, 210);
    triangle(-52, -35, -35 + wave, -32, -52, -25);

    // Label
    fill(185, 235, 245);
    textAlign(CENTER, BOTTOM);
    textSize(10);
    text("BASE", 0, -18);
    pop();

    // Range halo in world space (not rotated) so it always reads as a circle.
    noFill();
    stroke(120, 220, 255, 60);
    strokeWeight(2);
    circle(this.pos.x, this.pos.y, BASE_DELIVERY_RANGE * 2);
  }

  inRange(point) {
    return dist(point.x, point.y, this.pos.x, this.pos.y) < BASE_DELIVERY_RANGE;
  }
}

function drawShop() {
  shopButtons = [];
  // Shop only opens when you've actually landed at the base.
  if (gameState !== GAME_STATES.LANDED) return;
  if (!base || !base.inRange(lander.pos)) return;

  const panelW = 640;
  const panelH = 110;
  const panelX = width / 2 - panelW / 2;
  const panelY = height - panelH - 20;

  push();
  noStroke();
  fill(0, 0, 0, 200);
  rect(panelX, panelY, panelW, panelH, 8);
  stroke(120, 220, 255, 180);
  noFill();
  rect(panelX, panelY, panelW, panelH, 8);

  fill(120, 220, 255);
  noStroke();
  textAlign(CENTER, TOP);
  textSize(13);
  text(`BASE WORKSHOP — Research: ${research}`, width / 2, panelY + 8);

  const btnW = 140;
  const btnH = 70;
  const gap = 12;
  const totalW = UPGRADES.length * btnW + (UPGRADES.length - 1) * gap;
  let x = width / 2 - totalW / 2;
  const y = panelY + 28;

  for (let upgrade of UPGRADES) {
    let cost = upgradeCost(upgrade);
    let canAfford = research >= cost;
    let hovered =
      mouseX >= x && mouseX <= x + btnW &&
      mouseY >= y && mouseY <= y + btnH;

    noStroke();
    if (canAfford) {
      fill(hovered ? color(60, 140, 200) : color(30, 80, 130));
    } else {
      fill(40, 40, 40);
    }
    rect(x, y, btnW, btnH, 6);
    stroke(120, 220, 255, canAfford ? 200 : 80);
    noFill();
    rect(x, y, btnW, btnH, 6);

    noStroke();
    fill(canAfford ? 255 : 140);
    textAlign(CENTER, TOP);
    textSize(13);
    text(upgrade.label, x + btnW / 2, y + 8);
    textSize(11);
    fill(canAfford ? 200 : 110);
    text(upgrade.summary(lander), x + btnW / 2, y + 26);
    textSize(13);
    fill(canAfford ? color(255, 230, 120) : color(120, 100, 60));
    text(`${cost} research`, x + btnW / 2, y + 46);

    shopButtons.push({ x, y, w: btnW, h: btnH, upgrade });
    x += btnW + gap;
  }
  pop();
}

function tryBuyUpgrade(mx, my) {
  for (let btn of shopButtons) {
    if (mx < btn.x || mx > btn.x + btn.w) continue;
    if (my < btn.y || my > btn.y + btn.h) continue;
    let cost = upgradeCost(btn.upgrade);
    if (research < cost) return true;
    research -= cost;
    btn.upgrade.apply(lander);
    upgradePurchases[btn.upgrade.id] = (upgradePurchases[btn.upgrade.id] || 0) + 1;
    if (typeof showEvent === "function") {
      showEvent(`Upgrade installed: ${btn.upgrade.label}`);
    }
    return true;
  }
  return false;
}
