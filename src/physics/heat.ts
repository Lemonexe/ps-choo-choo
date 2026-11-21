import { clamp, smoothstep } from "./math.js";
import { DESIGN, type FireState } from "./types.js";

export const temperature = (energy: number, capacity: number): number =>
  DESIGN.ambient + energy / capacity;
export const thermalEnergy = (T: number, capacity: number): number =>
  capacity * (T - DESIGN.ambient);

/** Integral of the chosen temperature-dependent cp, relative to ambient. */
export const gasEnthalpy = (T: number): number =>
  1005 * (T - DESIGN.ambient) + 0.075 * ((T - 300) ** 2 - (DESIGN.ambient - 300) ** 2);

/** Gas approximations: ideal density, Sutherland viscosity, slowly varying cp/k. */
export function gasProperties(T: number): {
  rho: number;
  mu: number;
  cp: number;
  k: number;
  Pr: number;
} {
  const mu = (1.716e-5 * (T / 273.15) ** 1.5 * (273.15 + 111)) / (T + 111);
  const cp = 1005 + 0.15 * (T - 300),
    k = 0.0241 * (T / 273.15) ** 0.85;
  return { rho: 101325 / (287 * T), mu, cp, k, Pr: (cp * mu) / k };
}

export function nusselt(Re: number, Pr: number): number {
  const laminar = 3.66;
  if (Re <= 2300) return laminar;
  const turbulentRe = Math.max(Re, 3000);
  const friction = (0.79 * Math.log(turbulentRe) - 1.64) ** -2;
  const turbulent =
    ((friction / 8) * (turbulentRe - 1000) * Pr) /
    (1 + 12.7 * Math.sqrt(friction / 8) * (Pr ** (2 / 3) - 1));
  return laminar + smoothstep((Re - 2300) / 1700) * (turbulent - laminar);
}

/** Finite-capacity gas stream across an isothermal metal node. */
export function gasExchanger(
  gasT: number,
  metalT: number,
  gasMass: number,
  area: number,
  flowArea: number,
  diameter: number,
): { heat: number; outlet: number; Re: number } {
  if (gasMass <= 0) return { heat: 0, outlet: gasT, Re: 0 };
  const props = gasProperties((gasT + metalT) / 2);
  const Re = (gasMass * diameter) / (flowArea * props.mu);
  const h = (nusselt(Re, props.Pr) * props.k) / diameter;
  const rateCapacity = gasMass * props.cp;
  const outlet = gasT - (gasT - metalT) * -Math.expm1((-h * area) / rateCapacity);
  const heat = gasMass * (gasEnthalpy(gasT) - gasEnthalpy(outlet));
  return { heat, outlet, Re };
}

export function firebox(
  state: FireState,
  exhaustRate: number,
  condenser: boolean,
  dt: number,
): {
  burn: number;
  gasMass: number;
  gasHeat: number;
  radiation: number;
  ambient: number;
  T: number;
} {
  const T = temperature(state.energy, DESIGN.fireCapacity);
  const draft = clamp(0.22 + (condenser ? 0 : 0.13 * exhaustRate), 0.22, 1);
  const bed = smoothstep(state.coal / 160);
  const ignition = smoothstep((T - DESIGN.ignition) / 200);
  const burn = Math.min(state.coal / dt, DESIGN.maxBurn * draft * bed * ignition);
  const gasMass = 0.25 + burn * 17;
  const gasHeat = gasMass * gasEnthalpy(T);
  // Radiation target temperature is applied by the coordinator.
  return {
    burn,
    gasMass,
    gasHeat,
    radiation: DESIGN.emissivity * 5.670374419e-8 * DESIGN.radiationArea,
    ambient: 350 * (T - DESIGN.ambient),
    T,
  };
}

export function waterConductance(level: number | null, T: number): number {
  const wet = level === null ? 0.55 : smoothstep(level / DESIGN.tubeLevel);
  // A toy smooth reduction near the critical region, not a boiling correlation.
  const nearCritical = Math.exp(-(((T - 647.096) / 35) ** 2));
  return DESIGN.heatingArea * (20 + 4980 * wet) * (1 - 0.55 * nearCritical);
}
