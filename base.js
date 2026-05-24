const BASE_DELIVERY_RANGE = 240;

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

// Pick a stable landable angle on a planet (used by both Base placement and
// the lander's initial spawn so they end up at the same spot).
function pickBaseAngle(planet) {
  let landable = planet.landscape.filter((p) => p.landable);
  let point = landable.length > 0
    ? landable[floor(landable.length / 2)]
    : planet.landscape[0];
  return point.angle;
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
    // Pad slab
    fill(80, 90, 110);
    rect(-70, -6, 140, 12, 3);
    // Pad striping
    fill(255, 220, 60);
    for (let i = -3; i <= 3; i++) {
      rect(i * 18 - 7, -4, 14, 3);
    }
    // Pad legs into the surface
    fill(70, 80, 95);
    rect(-66, 6, 8, 16);
    rect(58, 6, 8, 16);
    // Flagpole
    stroke(200, 220, 240);
    strokeWeight(2);
    line(-40, -6, -40, -42);
    // Flag (waves a little)
    let wave = sin(frameCount * 2) * 3;
    noStroke();
    fill(120, 220, 255);
    triangle(-40, -42, -22 + wave, -38, -40, -28);
    // Label
    fill(180, 235, 255);
    textAlign(CENTER, BOTTOM);
    textSize(11);
    text("BASE", 0, -10);
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
    return true;
  }
  return false;
}
