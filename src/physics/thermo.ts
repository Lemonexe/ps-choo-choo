/** All public quantities are SI: Pa, K, J/kg, J/(kg K), m³/kg. */
import { solveBasic, type BasicProperties } from "iapws-if97";
import { saturationPressure, saturationTemperature } from "iapws-if97/saturation";
import { region1, region2, region3ByRhoT, region5 } from "iapws-if97/regions";
// Pinned 2.8.0 backward polynomials. Explicit paths also work as native ESM;
// the package exposes these functions in its declaration files, but not exports.
import {
  r1BackwardT as phLiquid,
  r2BackwardT as phVapor,
} from "../../node_modules/iapws-if97/dist/backward/ph.js";
import {
  r1BackwardT as psLiquid,
  r2BackwardT as psVapor,
} from "../../node_modules/iapws-if97/dist/backward/ps.js";
import { bisect, solveBracket, clamp, finite, SimulationError } from "./math.js";

export const ATM = 101325;
export const TC = 647.096;
export const PC = 22.064e6;
export const RHOC = 322;
export const MIN_T = 273.16;
export const MAX_P = 100e6;
export const MIN_P = 611.657;

export interface Water {
  p: number;
  T: number;
  v: number;
  rho: number;
  u: number;
  h: number;
  s: number;
  cp: number | null;
  x: number | null;
  phase: "liquid" | "two-phase" | "vapor" | "supercritical";
}
export interface Saturation {
  liquid: Water;
  vapor: Water;
}

function convert(a: BasicProperties): Water {
  const p = a.pressure * 1e6,
    T = a.temperature;
  let phase: Water["phase"];
  if (a.quality !== null) phase = "two-phase";
  else if (p >= PC && T >= TC) phase = "supercritical";
  else if (T < TC && p > saturationPressure(T) * 1e6) phase = "liquid";
  else phase = "vapor";
  const result: Water = {
    p,
    T,
    v: a.specificVolume,
    rho: 1 / a.specificVolume,
    u: a.internalEnergy * 1000,
    h: a.enthalpy * 1000,
    s: a.entropy * 1000,
    cp: a.cp === null ? null : a.cp * 1000,
    x: a.quality,
    phase,
  };
  for (const [key, value] of Object.entries(result))
    if (typeof value === "number") finite(value, `IF97 ${key}`);
  if (!(result.v > 0 && p >= MIN_P * (1 - 1e-7) && p <= MAX_P * (1 + 1e-9)))
    throw new SimulationError("Water state is outside the supported IF97 pressure/density domain.");
  return result;
}

export function pt(p: number, T: number): Water {
  return convert(solveBasic({ mode: "PT", p: p / 1e6, T }));
}
export function ph(p: number, h: number): Water {
  if (p >= MIN_P && p < 16.529e6) {
    const a = saturationAtPressure(p);
    if (h >= a.liquid.h && h <= a.vapor.h)
      return mixture(a, (h - a.liquid.h) / (a.vapor.h - a.liquid.h));
    const result = fastBackward(p, h, "h", a);
    if (result) return result;
  }
  return convert(solveBasic({ mode: "PH", p: p / 1e6, h: h / 1000 }));
}
export function ps(p: number, s: number): Water {
  if (p >= MIN_P && p < 16.529e6) {
    const a = saturationAtPressure(p);
    if (s >= a.liquid.s && s <= a.vapor.s)
      return mixture(a, (s - a.liquid.s) / (a.vapor.s - a.liquid.s));
    const result = fastBackward(p, s, "s", a);
    if (result) return result;
  }
  return convert(solveBasic({ mode: "PS", p: p / 1e6, s: s / 1000 }));
}
export const boilingPoint = (p: number): number => saturationTemperature(p / 1e6);
export const vaporPressure = (T: number): number => saturationPressure(T) * 1e6;

// Bounded exact-value memoization of EOS endpoints, never simulation snapshots
// and never interpolation. Repeated PS/PH calls share saturation calculations.
const endpoints = new Map<number, Saturation>();
function saturationAtPressure(p: number): Saturation {
  const cached = endpoints.get(p);
  if (cached) return cached;
  const a = saturation(boilingPoint(p));
  if (endpoints.size >= 256) endpoints.delete(endpoints.keys().next().value!);
  endpoints.set(p, a);
  return a;
}

/** Official backward-polynomial estimate, refined against the forward EOS.
 * A temperature bracket safeguards Newton refinement; fallback is bisection.
 * This avoids the general solver's repeated region-envelope construction in
 * deeply nested normal-pressure cylinder solves. No approximated properties. */
function fastBackward(
  p: number,
  target: number,
  property: "h" | "s",
  sat: Saturation,
): Water | null {
  const liquid = target < sat.liquid[property];
  const equation = liquid ? region1 : region2;
  const estimate = property === "h" ? (liquid ? phLiquid : phVapor) : liquid ? psLiquid : psVapor;
  let lo = liquid ? 273.15 : sat.vapor.T,
    hi = liquid ? sat.liquid.T : 1073.15;
  const upper = equation(p / 1e6, hi),
    lower = equation(p / 1e6, lo);
  const key = property === "h" ? "enthalpy" : "entropy";
  if (target < lower[key] * 1000 || target > upper[key] * 1000) return null;
  let T = clamp(estimate(p / 1e6, target / 1000), lo, hi);
  for (let i = 0; i < 20; i++) {
    const a = equation(p / 1e6, T),
      f = a[key] * 1000 - target;
    if (Math.abs(f) < (property === "h" ? 0.001 : 0.00001)) return convert(a);
    if (f > 0) hi = T;
    else lo = T;
    const derivative = ((a.cp ?? 0) * 1000) / (property === "s" ? T : 1);
    const next = T - f / derivative;
    T = next > lo && next < hi ? next : (lo + hi) / 2;
  }
  throw new SimulationError("Backward IF97 refinement did not converge.");
}

export function saturation(T: number): Saturation {
  if (T < MIN_T || T >= TC)
    throw new SimulationError("Saturation is undefined outside the liquid/vapor curve.");
  const p = saturationPressure(T);
  if (T <= 623.15) {
    return {
      liquid: { ...convert(region1(p, T)), x: 0, phase: "two-phase" },
      vapor: { ...convert(region2(p, T)), x: 1, phase: "two-phase" },
    };
  }
  const a = solveBasic({ mode: "Tx", T, x: 0 });
  if (!a.saturation) throw new SimulationError("Missing saturation endpoints.");
  return {
    liquid: { ...convert(a.saturation.liquid), x: 0, phase: "two-phase" },
    vapor: { ...convert(a.saturation.vapor), x: 1, phase: "two-phase" },
  };
}
export function mixture(sat: Saturation, x: number): Water {
  const a = sat.liquid,
    b = sat.vapor;
  const mix = (l: number, r: number): number => l + x * (r - l);
  const v = mix(a.v, b.v);
  return {
    p: a.p,
    T: a.T,
    v,
    rho: 1 / v,
    u: mix(a.u, b.u),
    h: mix(a.h, b.h),
    s: mix(a.s, b.s),
    cp: null,
    x,
    phase: "two-phase",
  };
}

/** Equilibrium at prescribed T and density, with explicit valid-region selection. */
function atTV(T: number, v: number): Water | null {
  const rho = 1 / v;
  let sat: Saturation | null = null;
  if (T < TC) {
    sat = saturation(T);
    if (v >= sat.liquid.v && v <= sat.vapor.v)
      return mixture(sat, (v - sat.liquid.v) / (sat.vapor.v - sat.liquid.v));
  }
  if (T > 623.15 && T <= 863.15) {
    const a = region3ByRhoT(rho, T);
    const boundary =
      T <= 623.15
        ? 16.5291642526
        : 348.05185628969 - 1.1671859879975 * T + 0.0010192970039326 * T * T;
    if (
      a.pressure >= boundary &&
      a.pressure <= 100 &&
      (a.cv ?? 0) > 0 &&
      (a.isothermalCompressibility ?? 0) > 0
    )
      return convert(a);
  }
  let lo = MIN_P / 1e6,
    hi = T > 1073.15 ? 50 : 100;
  let equation = T > 1073.15 ? region5 : region2;
  if (sat && v < sat.liquid.v && T <= 623.15) {
    lo = sat.liquid.p / 1e6;
    equation = region1;
  } else if (sat && v > sat.vapor.v) hi = sat.vapor.p / 1e6;
  else if (T > 623.15 && T < 863.15)
    hi = 348.05185628969 - 1.1671859879975 * T + 0.0010192970039326 * T * T;
  else if (sat && v < sat.liquid.v) return null;
  const f = (p: number): number => 1 / equation(p, T).specificVolume - rho;
  if (Math.abs(f(lo)) < rho * 1e-9) return convert(equation(lo, T));
  if (Math.abs(f(hi)) < rho * 1e-9) return convert(equation(hi, T));
  if (f(lo) > 0 || f(hi) < 0) return null;
  return convert(equation(bisect(f, lo, hi, 1e-10, Math.max(1e-8, rho * 1e-10)), T));
}

/** Isochoric equilibrium flash. Fast saturation branch; general single-phase fallback. */
export function flash(mass: number, energy: number, volume: number): Water {
  if (!(mass > 0 && volume > 0))
    throw new SimulationError("Boiler mass and volume must be positive.");
  const v = volume / mass,
    u = finite(energy / mass, "Specific internal energy"),
    rho = 1 / v;
  const low = saturation(MIN_T);
  // A near-critical *average density* does not imply a near-critical state.
  // First use the Region 1/2 temperature interval when it contains this
  // isochore and the requested energy. Finding its remote dome exit first can
  // force indistinguishable Region 3 saturation endpoints unnecessarily.
  const ordinaryTop = saturation(623.15);
  if (rho >= ordinaryTop.vapor.rho && rho <= ordinaryTop.liquid.rho) {
    const ordinaryMixture = (sat: Saturation): Water =>
      mixture(sat, (v - sat.liquid.v) / (sat.vapor.v - sat.liquid.v));
    const bottom = ordinaryMixture(low),
      top = ordinaryMixture(ordinaryTop);
    if (u >= bottom.u && u <= top.u) {
      const T = solveBracket(
        (t) => ordinaryMixture(saturation(t)).u - u,
        MIN_T,
        623.15,
        2e-7,
        0.03,
      );
      return ordinaryMixture(saturation(T));
    }
  }
  let domeEnd: number | null = null;
  if (rho >= low.vapor.rho && rho <= low.liquid.rho) {
    const endpoint = (T: number): number => {
      if (T >= TC - 1e-6) return RHOC;
      const sat = saturation(T);
      return rho >= RHOC ? sat.liquid.rho : sat.vapor.rho;
    };
    domeEnd = solveBracket((T) => endpoint(T) - rho, MIN_T, TC - 1e-7, 2e-7, 1e-6);
    const inDome = (T: number): Water => {
      const s = saturation(T);
      return mixture(s, clamp((v - s.liquid.v) / (s.vapor.v - s.liquid.v)));
    };
    const bottom = inDome(MIN_T),
      top = inDome(domeEnd);
    if (u >= bottom.u - 0.1 && u <= top.u + 0.1) {
      const T = solveBracket((t) => inDome(t).u - u, MIN_T, domeEnd, 2e-7, 0.03);
      return inDome(T);
    }
  }
  // Scan temperature intervals to locate a physical isochoric root. Invalid
  // densities at an interval endpoint are boundaries, never silently clamped.
  const temperatures = [
    MIN_T,
    300,
    373.15,
    473.15,
    573.15,
    623.15,
    TC - 0.001,
    TC + 0.001,
    673.15,
    773.15,
    863.15,
    1073.15,
    1273.15,
    1773.15,
    2273.15,
  ];
  if (domeEnd !== null) temperatures.push(domeEnd);
  // Include validity-envelope intersections: a compressed-liquid root can
  // occupy a very narrow temperature interval between saturation and 100 MPa.
  for (const [p, a, b] of [
    [MAX_P, MIN_T, 1073.15],
    [50e6, 1073.1501, 2273.15],
  ] as const) {
    const f = (T: number): number => pt(p, T).rho - rho;
    if (f(a) * f(b) < 0) {
      const boundary = bisect(f, a, b, 1e-7, rho * 1e-10);
      temperatures.push(boundary, Math.max(a, boundary - 0.0001));
    }
  }
  temperatures.sort((a, b) => a - b);
  let previous: { T: number; state: Water } | null = null;
  for (const T of temperatures) {
    const state = atTV(T, v);
    if (!state) continue;
    if (Math.abs(state.u - u) < 0.05) return state;
    if (previous && previous.state.u <= u && state.u >= u) {
      const lower = previous.T;
      const temp = bisect(
        (t) => {
          const a = atTV(t, v);
          if (!a) throw new SimulationError("Equilibrium inversion crossed an unsupported region.");
          return a.u - u;
        },
        lower,
        T,
        2e-7,
        0.03,
      );
      const result = atTV(temp, v);
      if (!result) throw new SimulationError("Equilibrium inversion failed validation.");
      return result;
    }
    previous = { T, state };
  }
  throw new SimulationError(
    "No stable water state inside IF97 limits matches boiler mass and energy.",
  );
}

export function vaporTakeoff(state: Water): Water {
  return state.phase === "two-phase" && state.x !== null && state.x < 1
    ? saturation(state.T).vapor
    : state;
}

/** Bottom takeoff selects liquid, never the vapor or an undefined critical phase. */
export function liquidTakeoff(state: Water): Water | null {
  if (state.phase === "liquid") return state;
  if (state.x !== null && state.x < 1) return saturation(state.T).liquid;
  return null;
}

export function waterLevel(state: Water): number | null {
  if (state.phase === "supercritical" || (state.T >= TC && state.p < PC)) return null;
  if (state.x === null) return state.phase === "liquid" ? 1 : 0;
  const s = saturation(state.T);
  return clamp(((1 - state.x) * s.liquid.v) / state.v);
}
