import { solveBracket, clamp } from "./math.js";
import { expandToVolume, nozzle, superheat, type Nozzle } from "./flow.js";
import { ATM, ph, ps, pt, type Water } from "./thermo.js";
import { DESIGN, type Cycle, type Engine } from "./types.js";

const swept = ((Math.PI * DESIGN.bore ** 2) / 4) * DESIGN.stroke;
const clearanceVolume = swept * DESIGN.clearance;
const maximumVolume = swept + clearanceVolume;
const cyclesPerMetre = (2 * DESIGN.cylinders) / (Math.PI * DESIGN.wheelDiameter);

/** Periodic ideal cylinder: residual entropy is unchanged by expansion/blowdown.
 * Solve admission mixing energy so residual inventory repeats each cycle. */
export function cylinder(inlet: Water, cutoff: number): Cycle {
  const admissionVolume = clearanceVolume + swept * cutoff;
  const residual = (
    h: number,
  ): { value: number; admission: Water; exhaust: Water; mass: number; retained: number } => {
    const admission = ph(inlet.p, h),
      exhaust = ps(ATM, admission.s);
    const mass = admissionVolume / admission.v,
      retained = clearanceVolume / exhaust.v;
    return {
      value: mass * (h - inlet.h) - retained * (exhaust.u - inlet.h) - inlet.p * clearanceVolume,
      admission,
      exhaust,
      mass,
      retained,
    };
  };
  const lower = Math.max(pt(inlet.p, 273.16).h, inlet.h - 8e5);
  // Adiabatic filling can make the cylinder hotter than the supply (flow work
  // pressurizes the clearance). Do not incorrectly require h_admission ≤ h_in.
  const upper = Math.min(inlet.h + 1e6, pt(inlet.p, inlet.p > 50e6 ? 1073.15 : 2273.15).h);
  const a = residual(lower),
    b = residual(upper);
  const h =
    Math.abs(b.value) < 0.1
      ? upper
      : solveBracket((x) => residual(x).value, lower, upper, 0.2, 0.1);
  const start = h === lower ? a : residual(h);
  const end = expandToVolume(start.admission, maximumVolume / start.mass);
  const releaseVolume = Math.min(maximumVolume, start.mass * end.v);
  const work = Math.max(
    0,
    inlet.p * (admissionVolume - clearanceVolume) +
      start.mass * (start.admission.u - end.u) -
      ATM * (releaseVolume - clearanceVolume),
  );
  const freshMass = Math.max(1e-12, start.mass - start.retained);
  return {
    work,
    freshMass,
    exhaustH: inlet.h - work / freshMass,
    wet:
      (end.x !== null && end.x < 0.9999) ||
      (start.admission.x !== null && start.admission.x < 0.9999),
    admission: start.admission,
    expansion: end,
  };
}

export interface EngineContext {
  source: Water;
  metalT: number;
  metalEnergy: number;
  throttle: number;
  reverser: number;
  dt: number;
  nozzle: Nozzle;
}

export function engineContext(
  source: Water,
  metalT: number,
  metalEnergy: number,
  throttle: number,
  reverser: number,
  dt: number,
): EngineContext {
  return {
    source,
    metalT,
    metalEnergy,
    throttle,
    reverser,
    dt,
    nozzle:
      throttle > 0 && reverser !== 0 && source.p > ATM
        ? nozzle(source)
        : { flux: () => 0, throat: ATM, maximum: 0 },
  };
}

function operatingPoint(
  context: EngineContext,
  p: number,
): { cycle: Cycle; supply: number; heat: number; inlet: Water; force: number } {
  const { source, metalT, metalEnergy, throttle, dt } = context;
  const supply = context.nozzle.flux(p) * DESIGN.valveArea * throttle * DESIGN.discharge;
  const input = ph(p, source.h);
  const heated = superheat(input, supply, metalT, metalEnergy, dt);
  const cycle = cylinder(heated.outlet, 0.05 + 0.7 * Math.abs(context.reverser));
  return {
    cycle,
    supply,
    heat: heated.heat,
    inlet: heated.outlet,
    force: cycle.work * cyclesPerMetre,
  };
}

export function engine(context: EngineContext, wheelSpeed: number): Engine {
  const { source, metalT, metalEnergy, throttle, reverser, dt } = context;
  const cutoff = 0.05 + 0.7 * Math.abs(reverser);
  const off: Engine = {
    force: 0,
    steam: 0,
    power: 0,
    heat: 0,
    exhaustH: source.h,
    wet: false,
    liquid: source.phase === "liquid" || (source.x !== null && source.x < 0.8),
    inlet: source,
    admission: source,
    cutoff,
  };
  if (throttle <= 0 || reverser === 0 || source.p <= ATM * 1.001 || off.liquid) return off;
  const frequency = Math.abs(wheelSpeed) * cyclesPerMetre;
  if (frequency < 1e-9) {
    const c = cylinder(source, cutoff);
    return { ...off, force: c.work * cyclesPerMetre, wet: c.wet, admission: c.admission };
  }
  // At zero pressure difference supply is zero; at atmospheric admission the
  // downstream cylinder is a steam-consuming zero-work displacement volume.
  const p = solveBracket(
    (p) => {
      const e = operatingPoint(context, p);
      return e.supply - e.cycle.freshMass * frequency;
    },
    ATM,
    source.p,
    Math.max(1, source.p * 2e-5),
    1e-6,
  );
  const e = operatingPoint(context, p);
  const steam = e.cycle.freshMass * frequency;
  // Match stream energy exactly even with finite pressure-root tolerance.
  const heated = superheat(ph(p, source.h), steam, metalT, metalEnergy, dt);
  return {
    force: e.cycle.work * cyclesPerMetre,
    steam,
    power: e.cycle.work * frequency,
    heat: heated.heat,
    exhaustH: heated.outlet.h - e.cycle.work / e.cycle.freshMass,
    wet: e.cycle.wet,
    liquid: false,
    inlet: heated.outlet,
    admission: e.cycle.admission,
    cutoff,
  };
}

/** Massless driving wheels: a static branch, then a bounded slip-speed solve. */
export function traction(
  context: EngineContext,
  speed: number,
  adhesion: number,
): { engine: Engine; slip: number; wheelSpeed: number } {
  const rolling = engine(context, speed);
  if (rolling.force <= adhesion) return { engine: rolling, slip: 0, wheelSpeed: speed };
  // Eliminate the nested speed/admission solve algebraically: force fixes the
  // admission pressure, then supply / mass-per-cycle fixes wheel speed.
  const p = solveBracket(
    (p) => operatingPoint(context, p).force - adhesion,
    ATM,
    context.source.p,
    Math.max(1, context.source.p * 1e-6),
    0.5,
  );
  const e = operatingPoint(context, p);
  const wheelSpeed = e.supply / (e.cycle.freshMass * cyclesPerMetre);
  const result: Engine = {
    ...rolling,
    force: e.force,
    steam: e.supply,
    power: e.force * wheelSpeed,
    heat: e.heat,
    exhaustH: e.cycle.exhaustH,
    wet: e.cycle.wet,
    inlet: e.inlet,
    admission: e.cycle.admission,
  };
  return { engine: result, slip: Math.max(0, wheelSpeed - speed), wheelSpeed };
}

export const cutoffPercent = (reverser: number): number =>
  reverser === 0 ? 0 : clamp(0.05 + 0.7 * Math.abs(reverser));
