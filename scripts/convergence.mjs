import assert from "node:assert/strict";
import { initialState, manage, step, inspect } from "../dist/physics/simulation.js";
import { thermalEnergy } from "../dist/physics/heat.js";
import { DESIGN } from "../dist/physics/types.js";

const seconds = Number(process.env.CONVERGENCE_SECONDS || 10);
const scenarios = {
  acceleration(s) {
    s.controls = { ...s.controls, throttle: 0.4, brake: 0, sand: true, pump: 0.1, stoker: 0.5 };
    s.specs.automaticStoker = true;
  },
  "slip + condenser"(s) {
    s.controls = { ...s.controls, throttle: 0.6, brake: 0, sand: false, reverser: 1, pump: 0.1 };
    s.specs.condenser = true;
    s.tank.energy *= (s.tank.mass - 1000) / s.tank.mass;
    s.tank.mass -= 1000;
  },
  "vent + relief"(s) {
    s.controls.vent = true;
    s.specs.reliefPressure *= 0.95;
  },
};
const records = [];
for (const [name, configure] of Object.entries(scenarios)) {
  const runs = [];
  for (const dt of [0.02, 0.01, 0.005]) {
    let s = manage(manage(initialState(), "fire").state, "boiler").state;
    s.superheaterEnergy = thermalEnergy(650, DESIGN.superheaterCapacity);
    configure(s);
    let maxMass = 0,
      maxEnergy = 0,
      d = inspect(s);
    const started = performance.now();
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      const r = step(s, dt);
      s = r.state;
      d = r.diagnostics;
      maxMass = Math.max(maxMass, Math.abs(d.massResidual));
      maxEnergy = Math.max(maxEnergy, Math.abs(d.energyResidual));
    }
    const result = {
      dt,
      pressure: d.boiler.p,
      speed: s.speed,
      coal: s.fire.coal,
      steamMass: s.boiler.mass,
      enthalpy: d.enthalpy,
      maxMass,
      maxEnergy,
      wallMs: performance.now() - started,
    };
    runs.push(result);
    console.log(
      `${name}: ${dt * 1000} ms, ${(result.wallMs / 1000).toFixed(2)} s wall, ${(s.speed * 3.6).toFixed(3)} km/h, ${(d.boiler.p / 1e5).toFixed(5)} bar abs`,
    );
    assert.ok(maxMass < 1e-7 && maxEnergy < 0.01, "Transfer ledger conservation");
  }
  const [coarse, medium, fine] = runs;
  const errors = {};
  for (const key of ["pressure", "speed", "coal", "steamMass", "enthalpy"]) {
    const scale = Math.max(key === "speed" ? 1 : 1e-6, Math.abs(fine[key]));
    const error = Math.abs(coarse[key] - fine[key]) / scale;
    const halfError = Math.abs(medium[key] - fine[key]) / scale;
    errors[key] = { relative20to5: error, relative10to5: halfError };
    assert.ok(
      error < 0.005,
      `${name} ${key}: 20/5 ms error ${(error * 100).toFixed(3)}% exceeds 0.5%`,
    );
    assert.ok(
      halfError <= error * 1.2 + 1e-5,
      `${name} ${key}: timestep refinement did not converge`,
    );
  }
  records.push({ name, seconds, runs, errors });
}
console.log(JSON.stringify(records, null, 2));
