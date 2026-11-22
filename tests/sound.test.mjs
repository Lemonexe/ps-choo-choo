import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SOUND, soundPreferences, soundPlan } from "../dist/sound-model.js";
import { initialState, inspect, manage, step } from "../dist/physics/simulation.js";
import { ATM } from "../dist/physics/thermo.js";
import { DESIGN } from "../dist/physics/types.js";

function scene() {
  const state = manage(manage(initialState(), "fire").state, "boiler").state;
  state.speed = 12;
  state.controls.brake = 0.3;
  const d = {
    ...inspect(state),
    wheelSpeed: 15,
    steamRate: 2,
    burnRate: 0.3,
    slipPower: 3e5,
    reliefRate: 1,
    manualVentRate: 0.2,
    blowdownRate: 3,
  };
  return { state, d };
}
const plan = (
  state,
  d,
  speed = 1,
  running = true,
  hidden = false,
  whistle = false,
  prefs = DEFAULT_SOUND,
) => soundPlan(state, d, speed, running, hidden, whistle, prefs);

test("audio acceleration changes event cadence and envelopes without altering whistle or brake pitch", () => {
  const { state, d } = scene();
  const slow = plan(state, d, 1, true, false, true);
  const fast = plan(state, d, 8, true, false, true);
  assert.equal(fast.beatHz, slow.beatHz * 8);
  assert.equal(fast.clackHz, slow.clackHz * 8);
  assert.equal(fast.clackGap, slow.clackGap / 8);
  assert.equal(fast.beatDuration, slow.beatDuration / 8);
  assert.equal(fast.brakeHz, slow.brakeHz);
  assert.equal(fast.whistle, slow.whistle);
  assert.equal(fast.beatGain, slow.beatGain);
  assert.equal(slow.beatHz, (15 * 4) / (Math.PI * DESIGN.wheelDiameter));
});

test("coasting and slip distinguish train movement, exhaust, brake and wheel sounds", () => {
  const { state, d } = scene();
  const powered = plan(state, d);
  const coasting = plan(state, { ...d, steamRate: 0, slipPower: 0 });
  assert.equal(coasting.beatGain, 0);
  assert.equal(coasting.beatHz, 0);
  assert.equal(coasting.slip, 0);
  assert.ok(powered.slip > 0);
  assert.equal(powered.rolling, coasting.rolling);
  assert.equal(powered.clackHz, coasting.clackHz);
  const slipping = plan(state, { ...d, wheelSpeed: 30 });
  assert.equal(slipping.beatHz, powered.beatHz * 2);
  assert.equal(slipping.clackHz, powered.clackHz);
  assert.equal(slipping.rolling, powered.rolling);
  assert.ok(slipping.beatGain < powered.beatGain);
  state.speed = 0;
  const stopped = plan(state, d);
  assert.equal(stopped.brake, 0);
  assert.equal(stopped.rolling, 0);
  assert.equal(stopped.clackHz, 0);
});

test("audio is presentation-only, paused except for pressure-dependent whistle, and hidden/muted globally", () => {
  const { state, d } = scene();
  const original = structuredClone(state);
  const paused = plan(state, d, 1, false, false, true);
  assert.ok(paused.whistle > 0);
  for (const name of [
    "beatHz",
    "clackHz",
    "rolling",
    "brake",
    "fire",
    "hiss",
    "slip",
    "blowdown",
    "exhaustHiss",
  ])
    assert.equal(paused[name], 0, name);
  const atmospheric = { ...d, boiler: { ...d.boiler, p: ATM } };
  assert.equal(plan(state, atmospheric, 1, false, false, true).whistle, 0);
  const nominal = { ...d, boiler: { ...d.boiler, p: DESIGN.nominalPressure } };
  assert.ok(plan(state, nominal, 1, false, false, true).whistle > paused.whistle);
  const extreme = { ...d, boiler: { ...d.boiler, p: 1e8 } };
  assert.equal(plan(state, extreme, 1, false, false, true).whistle, 1);
  const hidden = plan(state, d, 1, true, true, true);
  assert.equal(hidden.whistle, 0);
  assert.equal(hidden.volume, 0);
  assert.equal(hidden.active, false);
  assert.equal(plan(state, d, 1, true, false, true, { enabled: false, volume: 1 }).volume, 0);
  assert.equal(plan(state, d, 1, true, false, true, { enabled: true, volume: 0 }).volume, 0);
  assert.deepEqual(state, original);
  const off = plan(state, d);
  state.specs.condenser = !state.specs.condenser;
  assert.deepEqual(plan(state, d), off);
});

test("steam release uses combined flow, while blowdown and fire stay distinct", () => {
  const { state, d } = scene();
  const a = plan(state, d);
  assert.equal(plan(state, { ...d, reliefRate: 0, manualVentRate: 1.2 }).hiss, a.hiss);
  assert.equal(plan(state, { ...d, reliefRate: 0, manualVentRate: 0 }).hiss, 0);
  assert.equal(plan(state, { ...d, blowdownRate: 0 }).blowdown, 0);
  assert.equal(plan(state, { ...d, burnRate: 0 }).fire, 0);
  assert.ok(a.fire > 0 && a.blowdown > 0);
});

test("new audio telemetry exposes calculated slip and actual manual discharge without changing saved state", () => {
  let state = manage(manage(initialState(), "fire").state, "boiler").state;
  state.controls.vent = true;
  const result = step(state);
  assert.ok(result.diagnostics.manualVentRate > 0);
  assert.equal(result.diagnostics.wheelSpeed, 0);
  state.controls.vent = false;
  assert.equal(step(state).diagnostics.manualVentRate, 0);
  assert.equal("manualVentRate" in result.state, false);
  assert.equal("wheelSpeed" in result.state, false);
});

test("sound preference restore validates independent settings and tolerates unavailable/corrupt data", () => {
  assert.deepEqual(soundPreferences(null), { enabled: true, volume: 0.5 });
  assert.deepEqual(soundPreferences('{"enabled":false,"volume":0}'), { enabled: false, volume: 0 });
  assert.deepEqual(soundPreferences('{"enabled":true,"volume":0.8}'), {
    enabled: true,
    volume: 0.8,
  });
  for (const bad of [
    "{",
    "null",
    '"x"',
    '{"enabled":"yes","volume":1}',
    '{"enabled":true,"volume":2}',
    '{"enabled":true,"volume":-1}',
  ])
    assert.deepEqual(soundPreferences(bad), DEFAULT_SOUND);
});

test("resonant rail-joint doublets depend only on train speed, with a quicker pair at higher speed", () => {
  const { state, d } = scene();
  const powered = plan(state, d);
  const coast = plan(
    { ...state, controls: { ...state.controls, throttle: 0, brake: 0 } },
    {
      ...d,
      wheelSpeed: 100,
      steamRate: 0,
      slipPower: 1e6,
      boiler: { ...d.boiler, p: ATM },
    },
  );
  for (const name of ["clackHz", "clackGain", "clackGap"]) assert.equal(coast[name], powered[name]);
  const faster = plan({ ...state, speed: 30 }, d);
  assert.ok(faster.clackHz > powered.clackHz);
  assert.ok(faster.clackGap < powered.clackGap);
  assert.ok(powered.clackGap < 1 / powered.clackHz / 2);
  const reverse = plan({ ...state, speed: -state.speed }, d);
  assert.equal(reverse.clackHz, powered.clackHz);
  assert.equal(reverse.clackGain, powered.clackGain);
  assert.equal(plan({ ...state, speed: 0 }, d).clackGain, 0);
});
