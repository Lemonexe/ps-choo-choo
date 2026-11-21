import test from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  step,
  inspect,
  manage,
  addCoal,
  storedMass,
  storedEnergy,
} from "../dist/physics/simulation.js";
import { DESIGN } from "../dist/physics/types.js";
import { ATM, pt } from "../dist/physics/thermo.js";
import { filledBoiler } from "../dist/physics/boiler.js";
import { thermalEnergy } from "../dist/physics/heat.js";
import { decode, encode } from "../dist/persistence.js";

function hot() {
  return manage(manage(initialState(), "fire").state, "boiler").state;
}
function balances(r) {
  assert.ok(
    Math.abs(r.diagnostics.massResidual) < 1e-7,
    `mass residual ${r.diagnostics.massResidual}`,
  );
  assert.ok(
    Math.abs(r.diagnostics.energyResidual) < 0.01,
    `energy residual ${r.diagnostics.energyResidual}`,
  );
}
test("initial warm boiler is atmospheric, filled and unlit", () => {
  const s = initialState(),
    d = inspect(s);
  assert.ok(Math.abs(d.boiler.p - ATM) < 2);
  assert.ok(Math.abs(d.level - 0.65) < 1e-6);
  assert.equal(s.fire.coal, 0);
  assert.equal(s.controls.brake, 1);
});
test("ticks are pure and conserve mass and thermal/chemical energy across all stream paths", () => {
  for (const condenser of [false, true])
    for (const vent of [false, true]) {
      let s = hot();
      s.tank.mass -= 1000;
      s.tank.energy = s.tank.mass * pt(ATM, 300).h;
      s.controls = { ...s.controls, throttle: 0.4, brake: 0, pump: 0.2, vent, stoker: 0.6 };
      s.specs = { ...s.specs, condenser, automaticStoker: true };
      for (let i = 0; i < 30; i++) {
        const before = JSON.stringify(s),
          r = step(s);
        assert.equal(JSON.stringify(s), before);
        balances(r);
        s = r.state;
      }
    }
});
test("steam-driven feed pump works while stationary and balances auxiliary exhaust", () => {
  const s = hot();
  s.controls.pump = 0.5;
  const r = step(s);
  balances(r);
  assert.equal(r.state.speed, 0);
  assert.ok(r.diagnostics.feedRate > 0);
  assert.ok(r.diagnostics.pumpPower > 0);
  assert.ok(r.state.tank.mass < s.tank.mass);
});
test("condenser recovers water, rejects heat, and cannot overfill tender", () => {
  let s = hot();
  s.speed = 10;
  s.controls.throttle = 0.6;
  s.controls.brake = 0;
  s.specs.condenser = true;
  s.tank.mass -= 100;
  s.tank.energy = s.tank.mass * pt(ATM, 293.15).h;
  const r = step(s);
  balances(r);
  assert.ok(r.state.tank.mass > s.tank.mass);
  assert.ok(r.diagnostics.condenserHeat > 0);
  const full = hot();
  full.speed = 10;
  full.controls.throttle = 0.6;
  full.specs.condenser = true;
  const f = step(full);
  balances(f);
  assert.ok(f.state.tank.mass <= DESIGN.waterCapacity);
});
test("relief and manual release remove energy and mass without pressure clamping", () => {
  const s = hot();
  s.boiler = filledBoiler(3e6);
  s.specs.reliefPressure = 1.7e6;
  const r = step(s);
  balances(r);
  assert.ok(r.diagnostics.reliefRate > 0);
  assert.ok(Math.abs(r.diagnostics.boiler.p - s.specs.reliefPressure) < 20);
  assert.ok(r.diagnostics.alerts.some((a) => a.id === "relief"));
  const v = hot();
  v.controls.vent = true;
  const released = step(v);
  balances(released);
  assert.ok(released.state.boiler.mass < v.boiler.mass);
});
test("low water, wet superheater, cylinder condensation and slip produce alerts", () => {
  const s = hot();
  s.boiler = filledBoiler(DESIGN.nominalPressure, 0.15);
  s.speed = 10;
  s.controls.throttle = 1;
  s.controls.brake = 0;
  s.superheaterEnergy = thermalEnergy(450, DESIGN.superheaterCapacity);
  const r = step(s);
  balances(r);
  for (const id of ["water", "saturated", "condensation"])
    assert.ok(
      r.diagnostics.alerts.some((a) => a.id === id),
      id,
    );
  const start = hot();
  start.controls.throttle = 1;
  start.controls.reverser = 1;
  assert.ok(step(start).diagnostics.alerts.some((a) => a.id === "slip"));
});
test("supercritical boiler advances, hides liquid level, and observes IF97 limits", () => {
  const s = hot(),
    a = pt(30e6, 700),
    mass = DESIGN.boilerVolume / a.v;
  s.specs.reliefPressure = 50e6;
  s.boiler = {
    mass,
    energy: mass * a.u,
    metalEnergy: thermalEnergy(700, DESIGN.boilerMetalCapacity),
  };
  const r = step(s);
  balances(r);
  assert.equal(r.diagnostics.level, null);
  assert.equal(r.diagnostics.boiler.phase, "supercritical");
  const bad = structuredClone(s);
  bad.boiler.energy = -1e12;
  assert.throws(() => step(bad));
  assert.equal(bad.boiler.energy, -1e12);
});
test("near-supercritical engine runs with real-fluid nozzle, cylinder and slip", () => {
  for (const [p, T] of [
    [25e6, 650],
    [30e6, 700],
    [50e6, 700],
  ]) {
    const s = initialState(),
      a = pt(p, T),
      mass = DESIGN.boilerVolume / a.v;
    s.specs.reliefPressure = 99e6;
    s.boiler = {
      mass,
      energy: mass * a.u,
      metalEnergy: thermalEnergy(T, DESIGN.boilerMetalCapacity),
    };
    s.superheaterEnergy = thermalEnergy(T, DESIGN.superheaterCapacity);
    s.controls.throttle = 0.1;
    s.controls.brake = 0;
    const r = step(s);
    balances(r);
    assert.ok(r.diagnostics.power > 0 && r.diagnostics.steamRate > 0);
    assert.equal(r.diagnostics.level, null);
  }
});
test("management actions expose external balances, preserve hot water, and never cool preheat", () => {
  let s = initialState();
  s.tank.mass = 20000;
  s.tank.energy = s.tank.mass * pt(ATM, 350).h;
  const originalEnergy = s.tank.energy;
  const filled = manage(s, "water");
  assert.ok(filled.state.tank.energy > originalEnergy);
  assert.ok(Math.abs(filled.mass - 14000) < 1e-8);
  for (const action of ["coal", "prime", "fire", "boiler"]) {
    const r = manage(s, action);
    assert.ok(Math.abs(storedMass(r.state) - storedMass(s) - r.mass) < 1e-8);
    assert.ok(Math.abs(storedEnergy(r.state) - storedEnergy(s) - r.energy) < 0.001);
    s = r.state;
  }
  const first = manage(s, "boiler");
  assert.equal(first.energy, 0);
  const b = s.bunker,
    coal = s.fire.coal,
    charged = addCoal(s);
  assert.equal(charged.bunker, b - 20);
  assert.equal(charged.fire.coal, coal + 20);
  assert.equal(storedMass(s), storedMass(charged));
});
test("snapshots are versioned, reject corrupt states, and release held valves on restore", () => {
  const s = hot();
  s.controls.vent = true;
  s.controls.blowdown = true;
  const loaded = decode(encode(s));
  assert.equal(loaded.controls.vent, false);
  assert.equal(loaded.controls.blowdown, false);
  const raw = JSON.parse(encode(s));
  assert.equal(raw.version, 2);
  assert.equal(raw.state.controls.blowdown, false);
  assert.deepEqual(loaded.boiler, s.boiler);
  assert.throws(() => decode("{"));
  assert.throws(() => decode('{"version":99}'));
  const bad = JSON.parse(encode(s));
  bad.state.tank.mass = -10;
  assert.throws(() => decode(JSON.stringify(bad)));
  bad.state.tank.mass = "34000";
  assert.throws(() => decode(JSON.stringify(bad)));
  const missing = JSON.parse(encode(s));
  delete missing.state.controls.brake;
  assert.throws(() => decode(JSON.stringify(missing)));
});
test("invalid controls, timestep and capacities reject a tick", () => {
  const s = hot();
  assert.throws(() => step(s, 0.1));
  assert.throws(() => step(s, 0));
  s.controls.throttle = 2;
  assert.throws(() => step(s));
});
test("cycle efficiency uses a per-kg feedwater reference independent of live feed setting", () => {
  const s = hot();
  s.speed = 10;
  s.controls.throttle = 0.4;
  s.superheaterEnergy = thermalEnergy(650, DESIGN.superheaterCapacity);
  const a = step(s).diagnostics;
  s.controls.pump = 0.7;
  const b = step(s).diagnostics;
  assert.ok(a.efficiency > 0 && a.efficiency < 1);
  assert.ok(Math.abs(a.efficiency - b.efficiency) < 1e-10);
});
test("snapshot validation rejects vapor-filled and impossible empty tender states", () => {
  const s = hot();
  s.tank.energy = s.tank.mass * pt(ATM, 500).h;
  assert.throws(() => decode(JSON.stringify({ version: 2, state: s })));
  s.tank.mass = 0;
  s.tank.energy = 1000;
  assert.throws(() => step(s));
});
test("coasting direction mismatch cannot produce counter-steaming power", () => {
  const s = hot();
  s.speed = -5;
  s.controls.throttle = 0.7;
  const r = step(s);
  assert.equal(r.diagnostics.power, 0);
  balances(r);
});
