import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cylinder, engine, engineContext } from "../dist/physics/cylinder.js";
import { superheat } from "../dist/physics/flow.js";
import { filledBoiler } from "../dist/physics/boiler.js";
import { thermalEnergy } from "../dist/physics/heat.js";
import { initialState, inspect, step } from "../dist/physics/simulation.js";
import { ATM, ph, vaporTakeoff } from "../dist/physics/thermo.js";
import { DESIGN } from "../dist/physics/types.js";

const { cases } = JSON.parse(
  readFileSync(new URL("./fixtures/steam-starvation.json", import.meta.url), "utf8"),
);
function fixture(parameters) {
  const state = initialState();
  state.boiler = filledBoiler(parameters.boilerPressure, parameters.waterLevel);
  state.superheaterEnergy = thermalEnergy(
    parameters.superheaterTemperature,
    DESIGN.superheaterCapacity,
  );
  state.speed = parameters.speed;
  state.controls = {
    ...state.controls,
    throttle: parameters.throttle,
    reverser: parameters.reverser,
    brake: 0,
  };
  return state;
}
function context(state) {
  const d = inspect(state);
  return engineContext(
    vaporTakeoff(d.boiler),
    d.superheaterT,
    state.superheaterEnergy,
    state.controls.throttle,
    state.controls.reverser,
    0.02,
  );
}
function atmosphericDemand(c, speed) {
  const supply = c.nozzle.flux(ATM) * DESIGN.valveArea * c.throttle * DESIGN.discharge;
  const heated = superheat(ph(ATM, c.source.h), supply, c.metalT, c.metalEnergy, c.dt);
  const cycle = cylinder(heated.outlet, 0.05 + 0.7 * Math.abs(c.reverser));
  return {
    supply,
    heat: heated.heat,
    demand: (cycle.freshMass * speed * 4) / (Math.PI * DESIGN.wheelDiameter),
  };
}
function balances(result) {
  assert.ok(Math.abs(result.diagnostics.massResidual) < 1e-7);
  assert.ok(Math.abs(result.diagnostics.energyResidual) < 0.01);
}

test("representative starved fixtures have no atmospheric-to-boiler pressure root, but conserve actual steam and heat", () => {
  for (const parameters of cases) {
    const state = fixture(parameters),
      c = context(state);
    const boundary = atmosphericDemand(c, state.speed);
    assert.ok(boundary.supply > 0 && boundary.supply < boundary.demand, parameters.name);
    const result = engine(c, state.speed);
    assert.equal(result.force, 0);
    assert.equal(result.power, 0);
    assert.ok(Math.abs(result.steam - boundary.supply) < 1e-12);
    assert.ok(Math.abs(result.heat - boundary.heat) < 1e-7);
    assert.ok(Math.abs(result.exhaustH - result.inlet.h) < 1e-7);
    assert.ok(Math.abs(result.steam * (result.exhaustH - c.source.h) - result.heat) < 1e-6);
    assert.ok(
      result.steam < boundary.demand,
      "Do not invent the steam needed for full cylinder filling",
    );
    const next = step(state);
    balances(next);
    assert.equal(next.diagnostics.force, 0);
    assert.ok(next.state.boiler.mass < state.boiler.mass);
    assert.ok(next.state.superheaterEnergy < state.superheaterEnergy);
    assert.ok(next.state.speed < state.speed && next.state.speed > 0);
  }
});

test("throttle/cutoff sweeps cross between coasting and powered admission without losing the pressure bracket", () => {
  for (const parameters of cases) {
    const state = fixture(parameters);
    for (const speed of [0, 0.1, parameters.speed]) {
      for (const reverser of [0, 0.05, 0.6, 1]) {
        for (const throttle of [0, 0.01, 0.05, 0.2, 0.3, 0.5, 1]) {
          state.controls = { ...state.controls, throttle, reverser };
          const c = context(state),
            result = engine(c, speed);
          assert.ok(Number.isFinite(result.power) && result.power >= 0);
          assert.ok(Number.isFinite(result.steam) && result.steam >= 0);
          assert.ok(Math.abs(result.power - result.force * speed) < 1e-6);
          if (throttle === 0 || reverser === 0) assert.equal(result.steam, 0);
        }
      }
    }
  }
});

test("near the starvation boundary force remains small and regulator-flow matching is recovered above it", () => {
  const state = fixture(cases[0]);
  const residual = (throttle) => {
    state.controls.throttle = throttle;
    const b = atmosphericDemand(context(state), state.speed);
    return b.supply - b.demand;
  };
  // Locate the transition only in the test, independently of engine's pressure solve.
  let lo = 0.01,
    hi = 1;
  assert.ok(residual(lo) < 0 && residual(hi) > 0);
  for (let i = 0; i < 35; i++) {
    const mid = (lo + hi) / 2;
    if (residual(mid) > 0) hi = mid;
    else lo = mid;
  }
  const transition = (lo + hi) / 2;
  for (const throttle of [transition - 1e-5, transition + 1e-5]) {
    state.controls.throttle = throttle;
    const c = context(state),
      result = engine(c, state.speed);
    assert.ok(result.force < 10, "No artificial tractive-force jump at the boundary");
    assert.ok(
      Math.abs(
        result.steam -
          c.nozzle.flux(result.inlet.p) * DESIGN.valveArea * throttle * DESIGN.discharge,
      ) < 1e-5,
    );
  }
  state.controls.throttle = 1;
  assert.ok(engine(context(state), state.speed).power > 0);
});

test("repeated throttle changes and either gear/throttle ordering remain stable in complete ticks", () => {
  for (const parameters of cases) {
    for (const condenser of [false, true]) {
      let state = fixture(parameters);
      state.specs.condenser = condenser;
      // Give recovered condensate somewhere to go without overflowing a full tank.
      state.tank.energy *= (state.tank.mass - 100) / state.tank.mass;
      state.tank.mass -= 100;
      for (const [reverser, throttle] of [
        [1, 0],
        [1, 0.01],
        [1, 0.2],
        [1, 1],
        [1, 0.05],
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0.01],
      ]) {
        state.controls = { ...state.controls, reverser, throttle };
        for (let i = 0; i < 10; i++) {
          const result = step(state);
          balances(result);
          assert.ok(Number.isFinite(result.diagnostics.power));
          state = result.state;
        }
      }
    }
  }
});
