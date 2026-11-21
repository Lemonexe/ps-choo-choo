import test from "node:test";
import assert from "node:assert/strict";
import { cylinder, engine, engineContext, traction } from "../dist/physics/cylinder.js";
import { expandToVolume, hydraulicPump, nozzle, superheat } from "../dist/physics/flow.js";
import { ATM, pt, ph, saturation, flash } from "../dist/physics/thermo.js";
import {
  gasExchanger,
  gasEnthalpy,
  nusselt,
  firebox,
  thermalEnergy,
  waterConductance,
} from "../dist/physics/heat.js";
import { filledBoiler, relief } from "../dist/physics/boiler.js";
import { DESIGN } from "../dist/physics/types.js";
import { initialState } from "../dist/physics/simulation.js";
import { move, resistance } from "../dist/physics/motion.js";

const close = (a, b, tol = 1e-5) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);
test("nozzle chokes, shuts at equal pressure and handles wet equilibrium expansion", () => {
  for (const a of [pt(1.7e6, 650), saturation(480).vapor, pt(25e6, 700)]) {
    const n = nozzle(a);
    assert.ok(n.maximum > 0);
    assert.ok(n.throat >= ATM && n.throat < a.p);
    close(n.flux(ATM), n.maximum);
    assert.equal(n.flux(a.p), 0);
    assert.ok(n.flux((a.p + n.throat) / 2) < n.maximum);
  }
  assert.equal(nozzle(pt(ATM, 400)).maximum, 0);
});
test("isentropic closed expansion uses internal-energy work and conserves entropy", () => {
  const a = pt(1.7e6, 650),
    b = expandToVolume(a, 2 * a.v);
  close(b.v, a.v * 2, 1e-5);
  close(b.s, a.s, 1e-7);
  assert.ok(a.u > b.u);
  assert.ok(a.p > b.p);
  assert.ok(Math.abs(a.h - b.h - (a.u - b.u)) > 10000);
});
test("periodic cylinder accounts complete-cycle energy and detects condensation", () => {
  const dry = pt(1.7e6, 700),
    wet = saturation(480).vapor;
  for (const input of [dry, wet])
    for (const cutoff of [0.05, 0.47, 0.75]) {
      const c = cylinder(input, cutoff);
      assert.ok(c.work > 0);
      assert.ok(c.freshMass > 0);
      close(c.work, c.freshMass * (input.h - c.exhaustH), 1e-10);
      assert.ok(
        ph(ATM, c.exhaustH).s >= input.s - 1e-5,
        "Adiabatic cycle must not reduce stream entropy",
      );
      assert.ok(c.expansion.p <= c.admission.p);
    }
  assert.equal(cylinder(wet, 0.47).wet, true);
  assert.equal(cylinder(dry, 0.75).wet, false);
  assert.ok(cylinder(dry, 0.75).freshMass > cylinder(dry, 0.15).freshMass);
});
test("engine starts at rest without dividing power by speed; slip conserves shaft power", () => {
  const a = pt(1.7e6, 650),
    c = engineContext(a, 700, 5e8, 0.8, 1, 0.02);
  const start = engine(c, 0);
  assert.ok(start.force > 0);
  assert.equal(start.power, 0);
  assert.equal(start.steam, 0);
  const running = engine(c, 10);
  assert.ok(running.power > 0);
  close(running.power, running.force * 10);
  const slipping = traction(c, 0, 80000);
  assert.ok(slipping.slip > 0);
  close(slipping.engine.force, 80000, 1e-4);
  close(slipping.engine.power, slipping.engine.force * slipping.wheelSpeed);
  const gripping = traction(c, 10, 1e7);
  assert.equal(gripping.slip, 0);
  assert.equal(engine(engineContext(a, 700, 5e8, 0, 1, 0.02), 10).steam, 0);
  assert.equal(engine(engineContext(a, 700, 5e8, 1, 0, 0.02), 10).force, 0);
});
test("superheater bounds temperature, exchanges enthalpy and stores no steam", () => {
  const a = saturation(480).vapor;
  const hot = superheat(a, 3, 700, 1e8, 0.02);
  assert.ok(hot.outlet.T > a.T && hot.outlet.T <= 700.001);
  close(hot.heat, 3 * (hot.outlet.h - a.h), 1e-8);
  assert.equal(superheat(a, 0, 700, 1e8, 0.02).heat, 0);
  const cold = superheat(a, 3, 400, 1e8, 0.02);
  assert.ok(cold.heat < 0);
  assert.ok(cold.outlet.T >= 400 - 0.001);
});
test("pump hydraulic energy appears in feedwater enthalpy", () => {
  const a = pt(ATM, 300),
    pump = hydraulicPump(a, 1.7e6, 5);
  close(pump.work, 5 * a.v * (1.7e6 - ATM));
  close(5 * (pump.outlet.h - a.h), pump.work, 1e-7);
});
test("relief uses vapor takeoff in the dome and homogeneous single-phase discharge", () => {
  for (const source of [
    filledBoiler(2e6),
    (() => {
      const a = pt(30e6, 700),
        m = DESIGN.boilerVolume / a.v;
      return { mass: m, energy: m * a.u, metalEnergy: 0 };
    })(),
  ]) {
    const a = flash(source.mass, source.energy, DESIGN.boilerVolume);
    const result = relief(source, a, 1.7e6);
    const b = flash(result.boiler.mass, result.boiler.energy, DESIGN.boilerVolume);
    close(b.p, 1.7e6, 1e-5);
    if (a.x !== null && a.x < 1) {
      close(result.energy, result.mass * saturation(a.T).vapor.h, 1e-10);
      assert.ok(result.mass < source.mass * 0.1, "Relief must not eject the bulk liquid inventory");
    } else close(b.s, a.s, 1e-6);
    close(result.mass + result.boiler.mass, source.mass, 1e-12);
    close(result.energy + result.boiler.energy, source.energy, 1e-12);
    assert.ok(result.mass > 0 && result.energy > 0);
  }
});
test("gas-side correlations, exchanger bounds and dry-tube reduction", () => {
  assert.equal(nusselt(1000, 0.7), 3.66);
  assert.ok(nusselt(10000, 0.7) > 20);
  for (const flow of [0.1, 1, 20]) {
    const result = gasExchanger(1200, 500, flow, 247, 1.1, 0.05);
    assert.ok(result.heat > 0);
    assert.ok(result.outlet >= 500 && result.outlet <= 1200);
    close(result.heat, flow * (gasEnthalpy(1200) - gasEnthalpy(result.outlet)), 1e-10);
  }
  assert.ok(waterConductance(0.65, 480) > waterConductance(0, 480) * 100);
});
test("fire requires ignition and coal; exhaust draft raises burning", () => {
  assert.equal(firebox({ coal: 300, energy: 0 }, 5, false, 0.02).burn, 0);
  const a = { coal: 300, energy: thermalEnergy(1100, DESIGN.fireCapacity) };
  assert.ok(firebox(a, 5, false, 0.02).burn > firebox(a, 5, true, 0.02).burn);
  assert.equal(firebox({ ...a, coal: 0 }, 5, false, 0.02).burn, 0);
});
test("brakes hold at rest, stop without reversal, downhill can roll backward", () => {
  const s = initialState();
  assert.equal(move(s, 0, 0.02).speed, 0);
  s.speed = 0.001;
  assert.equal(move(s, 0, 0.02).speed, 0);
  s.speed = 0;
  s.controls.brake = 0;
  s.specs.slope = 20;
  assert.ok(move(s, 0, 0.02).speed < 0);
  assert.ok(resistance(20, s.specs) > resistance(0, s.specs));
});
