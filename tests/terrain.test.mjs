import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_ALTITUDE,
  MAX_TRACK_ANGLE,
  createTerrain,
  generateBlock,
  terrainAt,
  terrainWindow,
  validateTerrain,
} from "../dist/physics/terrain.js";
import {
  initialState,
  changeTerrain,
  step,
  inspect,
  validateState,
} from "../dist/physics/simulation.js";
import { trainMass } from "../dist/physics/motion.js";
import { decode, encode, loadSnapshot } from "../dist/persistence.js";

function at(terrain, distance) {
  const window = terrainWindow(terrain, distance);
  return { window, ...terrainAt(window, distance) };
}
function positioned(state, distance) {
  const terrain = terrainWindow(state.terrain, distance);
  return { ...state, terrain, distance, altitude: terrainAt(terrain, distance).altitude };
}

test("layered terrain is deterministic, bounded to 3.5 degrees, and height/gradient agree", () => {
  for (let seed = 0; seed < 16; seed++) {
    const original = createTerrain(true, seed);
    for (let distance = -15001; distance < 15001; distance += 137) {
      const { window, altitude, angle, rise } = at(original, distance);
      assert.ok(Number.isFinite(altitude));
      assert.ok(Math.abs(angle) <= MAX_TRACK_ANGLE + 1e-12);
      const derivative =
        (terrainAt(window, distance + 0.001).altitude -
          terrainAt(window, distance - 0.001).altitude) /
        0.002;
      assert.ok(Math.abs(derivative - rise) < 1e-7);
      assert.deepEqual(at(createTerrain(true, seed), distance).window, window);
    }
  }
  assert.notEqual(
    at(createTerrain(true, 1), 1234).altitude,
    at(createTerrain(true, 2), 1234).altitude,
  );
});

test("rounded corners and 10 km seams join in both altitude and gradient, including negative positions", () => {
  const terrain = createTerrain(true, 12345);
  for (const knot of [-20000, -10000, -5000, -1000, 0, 1000, 5000, 10000, 20000]) {
    for (const offset of [-50, 0, 50]) {
      const left = at(terrain, knot + offset - 1e-4);
      const right = at(terrain, knot + offset + 1e-4);
      assert.ok(Math.abs(left.altitude - right.altitude) < 0.00002);
      assert.ok(Math.abs(left.rise - right.rise) < 1e-6);
    }
  }
});

test("10 km terrain windows load at 1 km, retain until 2 km, and regenerate identical discarded blocks", () => {
  const original = createTerrain(true, 9876, 5000);
  assert.deepEqual(
    original.blocks.map((b) => b.index),
    [0],
  );
  const loaded = terrainWindow(original, 9000);
  assert.deepEqual(
    loaded.blocks.map((b) => b.index),
    [0, 1],
  );
  assert.deepEqual(
    terrainWindow(loaded, 8500).blocks.map((b) => b.index),
    [0, 1],
  );
  const discarded = terrainWindow(loaded, 7999);
  assert.deepEqual(
    discarded.blocks.map((b) => b.index),
    [0],
  );
  assert.deepEqual(terrainWindow(discarded, 9000), loaded);
  const negative = terrainWindow(original, -9000);
  assert.deepEqual(
    negative.blocks.map((b) => b.index),
    [-2, -1],
  );
  assert.deepEqual(
    terrainWindow(negative, -8500).blocks.map((b) => b.index),
    [-2, -1],
  );
  assert.deepEqual(
    terrainWindow(negative, -7999).blocks.map((b) => b.index),
    [-1],
  );
  let current = original;
  for (const distance of [10000, 50000, 110001, -123456, 5000]) {
    current = terrainWindow(current, distance);
    assert.ok(current.blocks.length <= 3);
    validateTerrain(current, distance, terrainAt(current, distance).altitude);
  }
  assert.deepEqual(current, original);
  assert.deepEqual(original.blocks, [generateBlock(9876, 0)]);
});

test("switching terrain resets altitude but preserves position, speed, energy and all other locomotive state", () => {
  const initial = initialState();
  assert.equal(initial.specs.passenger, 4);
  assert.equal(initial.altitude, BASE_ALTITUDE);
  const state = { ...initial, time: 123, distance: 54321, speed: -12 };
  const generated = changeTerrain(state, true, 123);
  const { terrain: _terrain, altitude: _altitude, ...before } = state;
  const { terrain: _otherTerrain, altitude: _otherAltitude, ...after } = generated;
  assert.deepEqual(after, before);
  assert.equal(trainMass(state) * state.speed ** 2, trainMass(generated) * generated.speed ** 2);
  assert.equal(generated.altitude, terrainAt(generated.terrain, state.distance).altitude);
  const flat = changeTerrain(generated, false);
  assert.deepEqual(flat, state);
  assert.notEqual(changeTerrain(flat, true, 456).altitude, generated.altitude);
  assert.equal(state.terrain.generated, false);
});

test("Euler position uses previous speed, terrain drives gravity, and reverse travel revisits the same landscape", () => {
  let state = changeTerrain(initialState(), true, 1);
  state.controls.brake = 0;
  assert.ok(inspect(state).trackAngle > 0);
  const rolled = step(state, 0.02);
  assert.ok(rolled.state.speed < 0);
  assert.equal(rolled.state.distance, 0); // Previous speed was zero.
  const second = step(rolled.state, 0.02);
  assert.ok(second.state.distance < 0);
  assert.ok(second.state.altitude < rolled.state.altitude);
  state = positioned({ ...state, speed: 20 }, 9999.9);
  const forward = step(state, 0.02);
  assert.equal(forward.state.distance, state.distance + 20 * 0.02);
  assert.equal(
    forward.state.altitude,
    terrainAt(forward.state.terrain, forward.state.distance).altitude,
  );
  const back = step({ ...forward.state, speed: -20 }, 0.02);
  assert.ok(Math.abs(back.state.distance - state.distance) < 1e-9);
  assert.ok(Math.abs(back.state.altitude - state.altitude) < 1e-9);
  assert.ok(Math.abs(forward.diagnostics.energyResidual) < 0.01);
  assert.ok(Math.abs(forward.diagnostics.massResidual) < 1e-7);
});

test("generated terrain motion and mechanical energy error converge under timestep refinement", () => {
  const start = positioned({ ...changeTerrain(initialState(), true, 1), speed: 20 }, 9990);
  start.controls.brake = 0;
  const runs = [0.02, 0.01, 0.005].map((dt) => {
    let state = start,
      error = 0;
    for (let i = 0; i < Math.round(2 / dt); i++) {
      const next = step(state, dt);
      state = next.state;
      error += Math.abs(next.diagnostics.mechanicalResidual);
    }
    return { state, error };
  });
  for (const key of ["speed", "distance", "altitude"]) {
    const coarse = Math.abs(runs[0].state[key] - runs[2].state[key]);
    const medium = Math.abs(runs[1].state[key] - runs[2].state[key]);
    assert.ok(medium < coarse, key);
  }
  assert.ok(runs[1].error < runs[0].error);
  assert.ok(runs[2].error < runs[1].error);
});

test("version-3 snapshots round trip seeded terrain and sticky caches; partial files can supply a seed", () => {
  let state = changeTerrain(initialState(), true, 77123);
  state = positioned(state, 9000);
  state = positioned(state, 8500);
  assert.equal(state.terrain.blocks.length, 2);
  assert.deepEqual(decode(encode(state)), state);
  assert.deepEqual(loadSnapshot(encode(state)), state);
  assert.equal(JSON.parse(encode(state)).version, 3);
  const partial = loadSnapshot(
    JSON.stringify({
      version: 3,
      state: { distance: -12345, terrain: { generated: true, seed: 42 } },
    }),
  );
  assert.equal(partial.terrain.seed, 42);
  validateState(partial);
  assert.equal(partial.altitude, terrainAt(partial.terrain, partial.distance).altitude);
});

test("old snapshots migrate to Flat without changing the locomotive or saved consist", () => {
  for (const version of [1, 2]) {
    const current = initialState();
    const { distance: _distance, altitude: _altitude, terrain: _terrain, ...legacy } = current;
    legacy.specs = { ...legacy.specs, passenger: 6, slope: 20 };
    legacy.speed = 12;
    if (version === 1) {
      legacy.controls = { ...legacy.controls };
      delete legacy.controls.blowdown;
    }
    const restored = decode(JSON.stringify({ version, state: legacy }));
    assert.equal(restored.specs.passenger, 6);
    assert.equal(restored.speed, 12);
    assert.equal(restored.distance, 0);
    assert.equal(restored.altitude, BASE_ALTITUDE);
    assert.equal(restored.terrain.generated, false);
    assert.equal("slope" in restored.specs, false);
    assert.deepEqual(restored.boiler, current.boiler);
  }
});

test("invalid seeds, heights, missing blocks and tampered cached terrain reject safely", () => {
  const original = changeTerrain(initialState(), true, 1);
  for (const modify of [
    (s) => {
      s.terrain.seed = -1;
    },
    (s) => {
      s.terrain.seed = 1.5;
    },
    (s) => {
      s.altitude += 1;
    },
    (s) => {
      s.terrain.blocks = [];
    },
    (s) => {
      s.terrain.blocks[0].knots[0][0] += 1;
    },
    (s) => {
      s.terrain.blocks.push(s.terrain.blocks[0]);
    },
    (s) => {
      s.terrain.blocks[0].knots = [[1]];
    },
    (s) => {
      s.distance = 1e30;
    },
  ]) {
    const bad = structuredClone(original);
    modify(bad);
    assert.throws(() => decode(JSON.stringify({ version: 3, state: bad })));
  }
  assert.throws(() =>
    loadSnapshot(
      JSON.stringify({ version: 3, state: { terrain: { generated: false, seed: 12 } } }),
    ),
  );
});
