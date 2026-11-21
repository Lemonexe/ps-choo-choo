import { solveBracket, clamp, maximize } from "./math.js";
import { ATM, liquidTakeoff, ph, ps, pt, type Water } from "./thermo.js";
import { DESIGN } from "./types.js";

export interface Nozzle {
  flux: (downstream: number) => number;
  throat: number;
  maximum: number;
}

/** Reversible equilibrium acceleration followed by irreversible mixing downstream. */
export function nozzle(upstream: Water, minimum = ATM): Nozzle {
  if (upstream.p <= minimum * (1 + 1e-10)) return { flux: () => 0, throat: minimum, maximum: 0 };
  const flux = (p: number): number => {
    if (p >= upstream.p * (1 - 1e-12)) return 0;
    const a = ps(p, upstream.s);
    return Math.sqrt(Math.max(0, 2 * (upstream.h - a.h))) / a.v;
  };
  // Coarse global scan before local refinement accommodates wet-steam branches.
  const lo = Math.log(minimum),
    hi = Math.log(upstream.p);
  const count = 12;
  let best = 0,
    bestValue = -1;
  for (let i = 0; i <= count; i++) {
    const value = flux(Math.exp(lo + ((hi - lo) * i) / count));
    if (value > bestValue) {
      best = i;
      bestValue = value;
    }
  }
  const a = lo + ((hi - lo) * Math.max(0, best - 1)) / count;
  const b = lo + ((hi - lo) * Math.min(count, best + 1)) / count;
  const maximum = maximize((x) => flux(Math.exp(x)), a, b, 2e-5);
  const edge = flux(minimum);
  const throat = edge > maximum.value ? minimum : Math.exp(maximum.x);
  const cap = Math.max(edge, maximum.value);
  return {
    throat,
    maximum: cap,
    flux: (downstream) => (downstream <= throat ? cap : flux(downstream)),
  };
}

/** Pressure-driven bottom blowdown, with equilibrium flashing in the nozzle.
 * Its discharged stream carries liquid inlet enthalpy, not vapor enthalpy. */
export function liquidBlowdown(bulk: Water, mass: number, dt: number): { rate: number; h: number } {
  const liquid = liquidTakeoff(bulk);
  if (!liquid || bulk.p <= ATM * (1 + 1e-8)) return { rate: 0, h: 0 };
  const available = bulk.x === null ? mass : mass * (1 - bulk.x);
  return {
    rate: Math.min(
      nozzle(liquid).flux(ATM) * DESIGN.blowdownValveArea * DESIGN.discharge,
      available / dt,
    ),
    h: liquid.h,
  };
}

/** Steady enthalpy exchange; metal stores the equal and opposite heat. */
export function superheat(
  input: Water,
  massRate: number,
  metalT: number,
  availableEnergy: number,
  dt: number,
): { outlet: Water; heat: number } {
  if (massRate <= 1e-10 || Math.abs(metalT - input.T) < 0.001) return { outlet: input, heat: 0 };
  const limit = pt(input.p, Math.max(273.16, metalT));
  const cp = clamp(input.cp ?? 10000, 2000, 10000);
  let heat = massRate * cp * (metalT - input.T) * -Math.expm1(-DESIGN.steamUA / (massRate * cp));
  if (heat >= 0)
    heat = Math.min(
      heat,
      massRate * Math.max(0, limit.h - input.h),
      Math.max(0, availableEnergy) / dt,
    );
  else heat = Math.max(heat, massRate * Math.min(0, limit.h - input.h));
  return { outlet: ph(input.p, input.h + heat / massRate), heat };
}

/** Inverse isentrope using specific volume; expansion work uses Δu. */
export function expandToVolume(input: Water, volume: number): Water {
  const end = ps(ATM, input.s);
  if (volume >= end.v) return end; // ideal early release when exhaust pressure is reached
  if (volume <= input.v) return input;
  const p = solveBracket(
    (p) => ps(p, input.s).v - volume,
    ATM,
    input.p,
    Math.max(0.1, input.p * 1e-6),
    1e-9,
  );
  return ps(p, input.s);
}

export function hydraulicPump(
  feed: Water,
  pressure: number,
  rate: number,
): { work: number; outlet: Water } {
  if (rate <= 0) return { work: 0, outlet: feed };
  const work = feed.v * Math.max(0, pressure - ATM);
  return { work: rate * work, outlet: ph(Math.max(ATM, pressure), feed.h + work) };
}
