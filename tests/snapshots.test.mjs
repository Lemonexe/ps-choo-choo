import test from "node:test";
import assert from "node:assert/strict";
import { encode, loadSnapshot } from "../dist/persistence.js";
import { initialState, manage, step } from "../dist/physics/simulation.js";

test("exported JSON loads into a clean simulation with the complete original state", () => {
  let original = manage(manage(initialState(), "fire").state, "boiler").state;
  original.controls.throttle = 0.4;
  original.controls.brake = 0;
  original.controls.pump = 0.2;
  original.controls.sand = true;
  original.specs.condenser = true;
  original.specs.passenger = 3;
  original.specs.freight = 2;
  for (let i = 0; i < 10; i++) original = step(original).state;
  const file = encode(original, true);
  let clean = initialState();
  assert.notDeepEqual(clean, original);
  clean = loadSnapshot(file);
  assert.deepEqual(clean, original);
});

test("loading deep-merges missing data with initial state, preserving nested zero and false", () => {
  const initial = initialState();
  const partial = {
    time: 12,
    controls: { reverser: 0, brake: 0, sand: false },
    specs: { passenger: 0, freight: 4, condenser: true },
    boiler: { mass: initial.boiler.mass },
  };
  const loaded = loadSnapshot(JSON.stringify({ version: 2, state: partial }));
  assert.deepEqual(loaded, {
    ...initial,
    time: 12,
    controls: { ...initial.controls, ...partial.controls },
    specs: { ...initial.specs, ...partial.specs },
    boiler: { ...initial.boiler, ...partial.boiler },
  });
  assert.deepEqual(initialState(), initial);
  assert.deepEqual(partial.controls, { reverser: 0, brake: 0, sand: false });
});
