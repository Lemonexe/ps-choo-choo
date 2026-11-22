import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSnapshot } from "../dist/persistence.js";
import { inspect, step } from "../dist/physics/simulation.js";
import { flash, saturation, mixture, RHOC } from "../dist/physics/thermo.js";

const snapshot = readFileSync(
  new URL("./fixtures/critical-density-snapshot.json", import.meta.url),
  "utf8",
);

test("ordinary-temperature equilibrium at critical-like bulk density does not require critical endpoints", () => {
  for (const T of [373.15, 481.07, 600]) {
    const sat = saturation(T);
    for (const rho of [RHOC - 0.65, RHOC - 0.001, RHOC, RHOC + 0.001, RHOC + 0.65, RHOC + 1]) {
      const v = 1 / rho;
      const original = mixture(sat, (v - sat.liquid.v) / (sat.vapor.v - sat.liquid.v));
      const mass = rho * 16;
      const found = flash(mass, mass * original.u, 16);
      assert.ok(Math.abs(found.T - T) < 1e-4);
      assert.ok(Math.abs(found.u - original.u) < 0.05);
      assert.ok(Math.abs(found.v - v) < 1e-12);
      assert.ok(Math.abs(found.x - original.x) < 1e-7);
      assert.equal(found.phase, "two-phase");
    }
  }
});

test("reported snapshot remains stable under throttle/gear, manual vent, blowdown, and natural relief opening", () => {
  const original = loadSnapshot(snapshot);
  const before = inspect(original).boiler;
  assert.ok(before.T < 500 && before.p < 2e6);
  assert.ok(Math.abs(before.rho - RHOC) < 1);
  for (const scenario of [
    "idle",
    "throttle and gear",
    "high throttle and gear",
    "manual vent",
    "blowdown",
    "pump",
    "relief",
  ]) {
    let state = structuredClone(original),
      reliefOpened = false,
      movedMass = 0;
    if (scenario === "throttle and gear") {
      state.controls.throttle = 0.5;
      state.controls.reverser = 0.6;
    }
    if (scenario === "high throttle and gear") {
      state.controls.throttle = 1;
      state.controls.reverser = 1;
    }
    if (scenario === "manual vent") state.controls.vent = true;
    if (scenario === "blowdown") state.controls.blowdown = true;
    if (scenario === "pump") state.controls.pump = 0.1;
    for (let i = 0; i < (scenario === "relief" ? 600 : 100); i++) {
      const result = step(state);
      assert.ok(Math.abs(result.diagnostics.massResidual) < 1e-7, `${scenario}: mass balance`);
      assert.ok(Math.abs(result.diagnostics.energyResidual) < 0.01, `${scenario}: energy balance`);
      assert.ok(Number.isFinite(result.diagnostics.boiler.p));
      assert.ok(result.diagnostics.boiler.T < 500);
      reliefOpened ||= result.diagnostics.reliefRate > 0;
      movedMass += state.boiler.mass - result.state.boiler.mass;
      state = result.state;
    }
    if (scenario === "relief") assert.ok(reliefOpened, "Heating must actually open relief");
    if (scenario === "pump") assert.ok(movedMass < 0, "Actual feedwater inflow exercised");
    else if (scenario !== "idle") assert.ok(movedMass > 0, `${scenario}: actual outflow exercised`);
  }
});
