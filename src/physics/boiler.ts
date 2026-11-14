import { solveBracket, SimulationError } from './math.js';
import { ATM, MAX_P, MIN_T, PC, boilingPoint, mixture, ps, pt, saturation, vaporTakeoff, type Water } from './thermo.js';
import { DESIGN, type BoilerState } from './types.js';

export function atPressureVolume(p: number, v: number): Water {
  if (p < PC) {
    const s = saturation(boilingPoint(p));
    if (v >= s.liquid.v && v <= s.vapor.v) return mixture(s, (v - s.liquid.v) / (s.vapor.v - s.liquid.v));
    const lo = v < s.liquid.v ? MIN_T : s.vapor.T;
    const hi = v < s.liquid.v ? s.liquid.T : (p > 50e6 ? 1073.15 : 2273.15);
    const T = solveBracket(T => pt(p, T).v - v, lo, hi, 1e-6, v * 1e-9);
    return pt(p, T);
  }
  const T = solveBracket(T => pt(p, T).v - v, MIN_T, p > 50e6 ? 1073.15 : 2273.15, 1e-6, v * 1e-9);
  return pt(p, T);
}

export function filledBoiler(p = ATM, level = DESIGN.normalLevel): BoilerState {
  const a = saturation(boilingPoint(p));
  const liquid = DESIGN.boilerVolume * level / a.liquid.v;
  const vapor = DESIGN.boilerVolume * (1 - level) / a.vapor.v;
  return { mass: liquid + vapor, energy: liquid * a.liquid.u + vapor * a.vapor.u,
    metalEnergy: DESIGN.boilerMetalCapacity * (a.liquid.T - DESIGN.ambient) };
}

/** Phase-aware pressure constraint. In the dome, frozen old-state vapor enthalpy
 * follows the explicit Euler stream convention. At target pressure U=A*m+B,
 * so conservation determines discharge algebraically. Initially single-phase
 * fluid uses homogeneous adiabatic blowdown. Large pressure jumps are approximate. */
export function relief(boiler: BoilerState, bulk: Water, setPressure: number): {
  boiler: BoilerState; mass: number; energy: number;
} {
  if (bulk.p <= setPressure * (1 + 1e-6)) return { boiler, mass: 0, energy: 0 };
  if (setPressure <= ATM || setPressure > MAX_P) throw new SimulationError('Relief setting is outside the supported pressure range.');
  if (bulk.x !== null && bulk.x < 1 && setPressure < PC) {
    const sat = saturation(boilingPoint(setPressure));
    const coefficient = (sat.vapor.u - sat.liquid.u) / (sat.vapor.v - sat.liquid.v);
    const A = sat.liquid.u - sat.liquid.v * coefficient, B = DESIGN.boilerVolume * coefficient;
    const dischargeH = vaporTakeoff(bulk).h;
    let mass = (boiler.energy - boiler.mass * dischargeH - B) / (A - dischargeH);
    const inside = mass > 0 && DESIGN.boilerVolume / mass >= sat.liquid.v && DESIGN.boilerVolume / mass <= sat.vapor.v;
    if (!inside) {
      const minimum = DESIGN.boilerVolume / pt(setPressure, setPressure > 50e6 ? 1073.15 : 2273.15).v * (1 + 1e-8);
      const maximum = Math.min(boiler.mass, DESIGN.boilerVolume / pt(setPressure, MIN_T).v * (1 - 1e-8));
      mass = solveBracket(m => m * atPressureVolume(setPressure, DESIGN.boilerVolume / m).u -
        boiler.energy + (boiler.mass - m) * dischargeH, minimum, maximum, 1e-7, .01);
    }
    if (!(mass > 0 && mass < boiler.mass)) throw new SimulationError('Vapor relief did not reduce boiler mass.');
    const removed = boiler.mass - mass, energy = removed * dischargeH;
    return { boiler: { ...boiler, mass, energy: boiler.energy - energy }, mass: removed, energy };
  }
  const final = ps(setPressure, bulk.s), mass = DESIGN.boilerVolume / final.v;
  if (!(mass > 0 && mass < boiler.mass)) throw new SimulationError('Relief blowdown did not reduce boiler mass.');
  const energy = mass * final.u;
  return { boiler: { ...boiler, mass, energy }, mass: boiler.mass - mass, energy: boiler.energy - energy };
}
