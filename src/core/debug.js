const DEBUG = {
  thrust: 0.15,
  maxFuel: 250,
  beamRange: 300,
  beamWidth: 20,
  planetRadiusScale: 4.0,
  planetDensity: 0.03,
  planetSpacing: 14000,
  orbitSpeedScale: 0, // 0 freezes orbits, 1 = baseline random speeds
  pullStrength: 0.15,
  cameraGroundZoom: 2.0,   // zoom scale at the surface (tight, inside the atmosphere)
  cameraFraming: 0.4,      // planet-framing factor outside the atmosphere — surface
                           // distance maps to this fraction of screen height
  zoomOverride: 0, // 0 = use dynamic distance-based zoom; >0 forces this scale
  showTrajectory: true,
  minimapSize: 280,
  minimapZoom: 0.001,
  minimapTrajectorySteps: 320,
  atmosphereScale: 0.6,   // atmosphere top = baseRadius * (1 + atmosphereScale)
  atmosphereDrag: 0.015,  // drag coefficient at full density (0..1 per frame at scale=1)
  atmosphereInnerBand: 1.0, // multiplier on the opaque inner band thickness
  sunFlare: 1.0,          // sun lens-flare intensity (0 = off)
  burnSpeedThreshold: 5,  // speed/frame below this, no burn
  burnIntensity: 0.6,     // particle emission scale
  heatGain: 0.02,         // hull heat gained per (density * excess speed) per frame
  heatCool: 0.4,          // hull heat dissipated per frame when not burning
  heatMax: 100,           // hull explodes when heat reaches this value
  fluidPlume: true,       // experimental GPU stable-fluids exhaust plume (off = particle flame)
  fluidPlumeScale: 220,   // world-space size of the fluid plume quad
  shown: false
};

const DEBUG_DEFAULTS = Object.freeze({ ...DEBUG });
const DEBUG_STORAGE_KEY = "cow-abductor:debug";
// Bump when default values shift in a way that should reset old saves.
const DEBUG_VERSION = 17;

function loadDebugFromStorage() {
  try {
    let raw = localStorage.getItem(DEBUG_STORAGE_KEY);
    if (!raw) return;
    let saved = JSON.parse(raw);
    if (saved.__version !== DEBUG_VERSION) return; // ignore stale schema
    for (let key of Object.keys(DEBUG)) {
      if (typeof saved[key] === typeof DEBUG[key]) {
        DEBUG[key] = saved[key];
      }
    }
  } catch (err) {
    console.warn("Failed to load debug settings:", err);
  }
}

function saveDebugToStorage() {
  try {
    localStorage.setItem(
      DEBUG_STORAGE_KEY,
      JSON.stringify({ __version: DEBUG_VERSION, ...DEBUG })
    );
  } catch (err) {
    console.warn("Failed to save debug settings:", err);
  }
}

const DEBUG_PARAMS = [
  { key: "thrust",            label: "Thrust",            min: 0.01, max: 0.5,  step: 0.005, live: true,  apply: (v) => { lander.thrust = v; } },
  { key: "maxFuel",           label: "Max Fuel",          min: 200,  max: 5000, step: 50,    live: true,  apply: (v) => { lander.maxFuel = v; if (lander.fuel > v) lander.fuel = v; } },
  { key: "beamRange",         label: "Beam Range",        min: 50,   max: 800,  step: 10,    live: true,  apply: (v) => { lander.beamRange = v; } },
  { key: "beamWidth",         label: "Beam Width",        min: 5,    max: 200,  step: 1,     live: true,  apply: (v) => { lander.beamWidth = v; } },
  { key: "pullStrength",      label: "Cow Pull",          min: 0.02, max: 0.5,  step: 0.01,  live: true,  apply: (v) => { for (let c of cows) c.pullStrength = v; } },
  { key: "planetDensity",     label: "Planet Density",    min: 0.005, max: 0.2, step: 0.005, live: true, apply: (v) => { for (let p of planets) if (!p.isSun) p.setDensity(v); } },
  { key: "planetRadiusScale", label: "Planet Size ×",     min: 0.5,  max: 10.0, step: 0.1,   live: false },
  { key: "planetSpacing",     label: "Planet Spacing",    min: 1500, max: 40000, step: 200,  live: false },
  { key: "orbitSpeedScale",   label: "Orbit Speed ×",     min: 0,    max: 2,    step: 0.05,  live: true },
  { key: "cameraGroundZoom",  label: "Cam Ground Zoom",   min: 0.2,  max: 4.0,  step: 0.05,  live: true },
  { key: "cameraFraming",     label: "Cam Framing",       min: 0.05, max: 1.5,  step: 0.05,  live: true },
  { key: "zoomOverride",      label: "Zoom Out (0 = off)", min: 0,   max: 1,    step: 0.002, live: true },
  { key: "minimapSize",       label: "Map Size",          min: 150,  max: 800,  step: 10,    live: true },
  { key: "minimapZoom",       label: "Map Zoom",          min: 0.001, max: 0.08, step: 0.001, live: true },
  { key: "minimapTrajectorySteps", label: "Map Traj Steps", min: 40, max: 1200, step: 20,    live: true },
  { key: "atmosphereScale",   label: "Atmo Thickness",    min: 0.1,  max: 3.0,  step: 0.05,  live: true },
  { key: "atmosphereDrag",    label: "Atmo Drag",         min: 0,    max: 0.2,  step: 0.005, live: true },
  { key: "atmosphereInnerBand", label: "Atmo Inner Band", min: 0.1,  max: 8,    step: 0.1,   live: true },
  { key: "sunFlare",          label: "Sun Flare",         min: 0,    max: 3,    step: 0.05,  live: true },
  { key: "burnSpeedThreshold",label: "Burn Speed Min",    min: 0,    max: 30,   step: 0.5,   live: true },
  { key: "burnIntensity",     label: "Burn Intensity",    min: 0,    max: 3.0,  step: 0.05,  live: true },
  { key: "heatGain",          label: "Heat Gain",         min: 0,    max: 0.2,  step: 0.005, live: true },
  { key: "heatCool",          label: "Heat Cool",         min: 0,    max: 3.0,  step: 0.05,  live: true },
  { key: "heatMax",           label: "Heat Limit",        min: 20,   max: 400,  step: 5,     live: true },
  { key: "showTrajectory",    label: "Show Trajectory (T)", type: "toggle",                   live: true },
  { key: "fluidPlume",        label: "GPU Fluid Plume",   type: "toggle",                       live: true },
  { key: "fluidPlumeScale",   label: "Fluid Plume Size",  min: 60,   max: 600,  step: 10,    live: true }
];

let debugPanel;
let debugSliderEls = {};
let debugValueLabels = {};

function setupDebugPanel() {
  debugPanel = createDiv("");
  debugPanel.id("debug-panel");
  debugPanel.class(DEBUG.shown ? "open" : "");

  let header = createDiv("Debug Sliders");
  header.parent(debugPanel);
  header.class("debug-header");

  for (let param of DEBUG_PARAMS) {
    let row = createDiv("");
    row.parent(debugPanel);
    row.class("debug-row");

    if (param.type === "toggle") {
      let cb = createCheckbox(param.label, !!DEBUG[param.key]);
      cb.parent(row);
      cb.class("debug-toggle");
      cb.changed(() => {
        DEBUG[param.key] = cb.checked();
        if (param.live && param.apply) param.apply(DEBUG[param.key]);
        saveDebugToStorage();
      });
      debugSliderEls[param.key] = cb;
      continue;
    }

    let label = createDiv(`${param.label}`);
    label.parent(row);
    label.class("debug-label");

    let valueLabel = createSpan(`${DEBUG[param.key]}`);
    valueLabel.parent(label);
    valueLabel.class("debug-value");
    debugValueLabels[param.key] = valueLabel;

    let slider = createSlider(param.min, param.max, DEBUG[param.key], param.step);
    slider.parent(row);
    slider.class("debug-slider");
    slider.input(() => {
      let v = slider.value();
      DEBUG[param.key] = v;
      valueLabel.html(formatDebugValue(v));
      if (param.live && param.apply) param.apply(v);
      saveDebugToStorage();
    });
    debugSliderEls[param.key] = slider;
  }

  let regenBtn = createButton("Regenerate world");
  regenBtn.parent(debugPanel);
  regenBtn.class("debug-regen");
  regenBtn.mousePressed(() => {
    buildWorld();
    resetGame();
  });

  let resetBtn = createButton("Reset to defaults");
  resetBtn.parent(debugPanel);
  resetBtn.class("debug-regen");
  resetBtn.mousePressed(() => {
    for (let key of Object.keys(DEBUG_DEFAULTS)) {
      DEBUG[key] = DEBUG_DEFAULTS[key];
      if (debugSliderEls[key]) {
        let el = debugSliderEls[key];
        if (typeof el.checked === "function") {
          el.checked(!!DEBUG[key]);
        } else {
          el.value(DEBUG[key]);
          if (debugValueLabels[key]) {
            debugValueLabels[key].html(formatDebugValue(DEBUG[key]));
          }
        }
      }
    }
    // Re-apply live params so the world reflects the restored defaults.
    for (let param of DEBUG_PARAMS) {
      if (param.live && param.apply) param.apply(DEBUG[param.key]);
    }
    saveDebugToStorage();
  });

  let toggle = createButton("≡ Debug");
  toggle.id("debug-toggle");
  toggle.mousePressed(toggleDebugPanel);
}

function toggleDebugPanel() {
  DEBUG.shown = !DEBUG.shown;
  debugPanel.class(DEBUG.shown ? "open" : "");
}

function setDebugValue(key, value) {
  DEBUG[key] = value;
  let el = debugSliderEls[key];
  if (el) {
    if (typeof el.checked === "function") {
      el.checked(!!value);
    } else if (typeof el.value === "function") {
      el.value(value);
      if (debugValueLabels[key]) {
        debugValueLabels[key].html(formatDebugValue(value));
      }
    }
  }
  saveDebugToStorage();
}

function formatDebugValue(v) {
  if (typeof v !== "number") return `${v}`;
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 1)   return v.toFixed(2);
  return v.toFixed(3);
}
