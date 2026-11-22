import { terrainAt } from "./terrain.js";
import { DESIGN, type Specs, type State } from "./types.js";

export function trainMass(state: State): number {
  return (
    DESIGN.dryMass +
    state.boiler.mass +
    state.tank.mass +
    state.bunker +
    state.fire.coal +
    state.specs.passenger * DESIGN.passengerMass +
    state.specs.freight * DESIGN.freightMass
  );
}

/** Estimated Davis coefficients, explicitly not measured Class 01 coefficients. */
export function resistance(speed: number, specs: Specs): number {
  const v = Math.abs(speed);
  return (
    1600 +
    65 * v +
    5 * v * v +
    specs.passenger * (140 + 8 * v + 0.5 * v * v) +
    specs.freight * (240 + 12 * v + 0.7 * v * v)
  );
}

export function move(
  state: State,
  force: number,
  dt: number,
): { speed: number; dissipated: number; gradeWork: number; kineticError: number } {
  const mass = trainMass(state),
    v = state.speed;
  const grade = -mass * 9.80665 * terrainAt(state.terrain, state.distance).rise;
  const drive = Math.sign(state.controls.reverser) * force;
  const drag = resistance(v, state.specs);
  const brake = state.controls.brake * 0.14 * mass * 9.80665;
  const direction = Math.sign(v) || Math.sign(drive + grade);
  const applied = drive + grade;
  let net: number;
  if (v === 0 && Math.abs(applied) <= drag + brake) net = 0;
  else net = applied - direction * (drag + brake);
  let next = v + (net / mass) * dt;
  // Static friction holds at rest; braking/drag must never propel the train.
  if (v !== 0 && Math.sign(next) !== Math.sign(v) && direction * applied <= drag + brake) next = 0;
  const dissipated = Math.max(0, (drag + brake) * Math.abs(v) * dt);
  const gradeWork = grade * v * dt;
  const kineticError =
    0.5 * mass * (next * next - v * v) - (drive * v * dt + gradeWork - dissipated);
  return { speed: next, dissipated, gradeWork, kineticError };
}
