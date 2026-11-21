import test from "node:test";
import assert from "node:assert/strict";
import { initialState, step } from "../dist/physics/simulation.js";
import { filledBoiler } from "../dist/physics/boiler.js";
import { liquidBlowdown } from "../dist/physics/flow.js";
import { ATM, flash, liquidTakeoff, mixture, pt, saturation } from "../dist/physics/thermo.js";
import { DESIGN } from "../dist/physics/types.js";
import { decode, encode } from "../dist/persistence.js";

function overfilled() {
  const s = initialState(),
    water = pt(2e6, 470),
    mass = DESIGN.boilerVolume / water.v;
  s.boiler = {
    mass,
    energy: mass * water.u,
    metalEnergy: (water.T - DESIGN.ambient) * DESIGN.boilerMetalCapacity,
  };
  s.specs.reliefPressure = 3e6;
  return s;
}
function balanced(result) {
  assert.ok(Math.abs(result.diagnostics.massResidual) < 1e-7);
  assert.ok(Math.abs(result.diagnostics.energyResidual) < 0.01);
}

test("bottom blowdown selects liquid and never substitutes vapor or supercritical fluid", () => {
  const sat = saturation(470),
    bulk = mixture(sat, 0.3);
  assert.equal(liquidTakeoff(bulk).h, sat.liquid.h);
  const compressed = pt(2e6, 470);
  assert.deepEqual(liquidTakeoff(compressed), compressed);
  for (const water of [sat.vapor, pt(2e6, 700), pt(30e6, 700)]) {
    assert.equal(liquidTakeoff(water), null);
    assert.equal(liquidBlowdown(water, 100, 0.02).rate, 0);
  }
});
test("blowdown requires positive gauge pressure and is capped by available liquid", () => {
  assert.equal(liquidBlowdown(pt(ATM, 300), 100, 0.02).rate, 0);
  assert.equal(liquidBlowdown(pt(ATM / 2, 300), 100, 0.02).rate, 0);
  const bulk = mixture(saturation(470), 0.9);
  const drain = liquidBlowdown(bulk, 0.1, 0.02);
  assert.ok(drain.rate > 0 && drain.rate <= (0.1 * (1 - bulk.x)) / 0.02);
});
test("blowdown removes liquid enthalpy and conserves both stream balances", () => {
  for (const s of [
    overfilled(),
    { ...initialState(), boiler: filledBoiler(DESIGN.nominalPressure) },
  ]) {
    const closed = step(s);
    const liquid = liquidTakeoff(flash(s.boiler.mass, s.boiler.energy, DESIGN.boilerVolume));
    s.controls.blowdown = true;
    const result = step(s),
      removed = s.boiler.mass - result.state.boiler.mass;
    assert.ok(result.diagnostics.blowdownRate > 0);
    assert.ok(Math.abs(removed - result.diagnostics.blowdownRate * 0.02) < 1e-8);
    assert.ok(
      Math.abs(closed.state.boiler.energy - result.state.boiler.energy - removed * liquid.h) < 0.01,
    );
    balanced(result);
  }
});
test("holding blowdown recovers an overfilled boiler and restores cylinder admission", () => {
  let s = overfilled();
  s.speed = 5;
  s.controls.throttle = 0.2;
  s.controls.brake = 0;
  assert.ok(step(s).diagnostics.alerts.some((a) => a.id === "liquid"));
  s.controls.blowdown = true;
  const mass = s.boiler.mass;
  let recovered = false;
  for (let i = 0; i < 100; i++) {
    const result = step(s);
    balanced(result);
    s = result.state;
    if (result.diagnostics.boiler.phase === "two-phase") {
      recovered = true;
      break;
    }
  }
  assert.ok(recovered, "A few seconds of liquid blowdown should restore a vapor space");
  assert.ok(s.boiler.mass < mass);
  s.controls.blowdown = false;
  const result = step(s);
  balanced(result);
  assert.equal(result.diagnostics.blowdownRate, 0);
  assert.equal(
    result.diagnostics.alerts.some((a) => a.id === "liquid"),
    false,
  );
  assert.ok(result.diagnostics.steamRate > 0);
});
test("blowdown is an external drain even with condenser recovery enabled", () => {
  const s = overfilled();
  s.controls.blowdown = true;
  s.specs.condenser = true;
  const result = step(s);
  balanced(result);
  assert.equal(result.state.tank.mass, s.tank.mass);
  assert.ok(result.state.boiler.mass < s.boiler.mass);
});
test("simultaneous steam vent, feed pump, and liquid drain balance their different enthalpies", () => {
  const s = initialState();
  s.boiler = filledBoiler(DESIGN.nominalPressure);
  s.speed = 5;
  s.controls = { ...s.controls, vent: true, blowdown: true, pump: 0.2, throttle: 0.3, brake: 0 };
  const result = step(s);
  balanced(result);
  assert.ok(
    result.diagnostics.blowdownRate > 0 &&
      result.diagnostics.feedRate > 0 &&
      result.diagnostics.steamRate > 0,
  );
});
test("version-1 saves migrate without resetting an overfilled boiler or other controls", () => {
  const s = overfilled();
  s.controls.pump = 0.3;
  s.controls.vent = true;
  const old = JSON.parse(JSON.stringify(s));
  delete old.controls.blowdown;
  const loaded = decode(JSON.stringify({ version: 1, state: old }));
  assert.deepEqual(loaded.boiler, s.boiler);
  assert.deepEqual(loaded.tank, s.tank);
  assert.equal(loaded.controls.pump, 0.3);
  assert.equal(loaded.controls.vent, false);
  assert.equal(loaded.controls.blowdown, false);
  assert.equal(JSON.parse(encode(loaded)).version, 2);
  delete old.controls.brake;
  assert.throws(() => decode(JSON.stringify({ version: 1, state: old })));
});
test("new snapshots require the new control and cannot restore an open blowdown valve", () => {
  const s = overfilled();
  s.controls.blowdown = true;
  const saved = JSON.parse(encode(s));
  assert.equal(saved.state.controls.blowdown, false);
  saved.state.controls.blowdown = true;
  assert.equal(decode(JSON.stringify(saved)).controls.blowdown, false);
  delete saved.state.controls.blowdown;
  assert.throws(() => decode(JSON.stringify(saved)));
});
