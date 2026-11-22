import type { Water } from "./thermo.js";

export interface BoilerState {
  mass: number;
  energy: number;
  metalEnergy: number;
}
export interface FireState {
  coal: number;
  energy: number;
}
export interface TankState {
  mass: number;
  energy: number;
}
export interface Controls {
  throttle: number;
  reverser: number;
  stoker: number;
  pump: number;
  brake: number;
  sand: boolean;
  vent: boolean;
  blowdown: boolean;
}
export interface Specs {
  condenser: boolean;
  automaticStoker: boolean;
  passenger: number;
  freight: number;
  slope: number;
  reliefPressure: number;
}
export interface State {
  time: number;
  boiler: BoilerState;
  fire: FireState;
  tank: TankState;
  bunker: number;
  superheaterEnergy: number;
  speed: number;
  controls: Controls;
  specs: Specs;
}
export interface Alert {
  id: string;
  text: string;
  severity: "warning" | "info";
}
export interface Cycle {
  work: number;
  freshMass: number;
  exhaustH: number;
  wet: boolean;
  admission: Water;
  expansion: Water;
}
export interface Engine {
  force: number;
  steam: number;
  power: number;
  heat: number;
  exhaustH: number;
  wet: boolean;
  liquid: boolean;
  inlet: Water;
  admission: Water;
  cutoff: number;
}
export interface Diagnostics {
  boiler: Water;
  level: number | null;
  fireT: number;
  metalT: number;
  superheaterT: number;
  chimneyT: number;
  /** Coal combustion heat input (W), before heat-transfer and exhaust losses. */
  fireDuty: number;
  /** Flue-gas mass flow through the chimney (kg/s), excluding engine exhaust. */
  flueGasRate: number;
  steamT: number;
  power: number;
  tractionPower: number;
  slipPower: number;
  force: number;
  steamRate: number;
  burnRate: number;
  feedRate: number;
  reliefRate: number;
  blowdownRate: number;
  condenserHeat: number;
  pumpPower: number;
  efficiency: number | null;
  enthalpy: number;
  trainMass: number;
  alerts: Alert[];
  massResidual: number;
  energyResidual: number;
  mechanicalResidual: number;
}
export interface Step {
  state: State;
  diagnostics: Diagnostics;
}

export const DESIGN = Object.freeze({
  ambient: 293.15,
  nominalPressure: 16e5 + 101325,
  boilerVolume: 16,
  normalLevel: 0.65,
  tubeLevel: 0.28,
  grateArea: 4.32,
  heatingArea: 247.15,
  superheaterArea: 86.5,
  cylinders: 2,
  bore: 0.6,
  stroke: 0.66,
  wheelDiameter: 2,
  clearance: 0.06,
  waterCapacity: 34000,
  coalCapacity: 10000,
  dryMass: 116600,
  adhesiveMass: 60000,
  passengerMass: 45000,
  freightMass: 80000,
  fireCapacity: 3e6,
  boilerMetalCapacity: 15e6,
  superheaterCapacity: 1.2e6,
  lhv: 25.8e6,
  maxBurn: 1.2,
  maxFeed: 12,
  maxStoker: 2,
  coalChunk: 20,
  maxFireCoal: 600,
  ignition: 620,
  radiationArea: 20,
  emissivity: 0.75,
  steamUA: 15000,
  valveArea: 0.003,
  manualValveArea: 0.0003,
  blowdownValveArea: 0.001,
  discharge: 0.78,
});
export const DT = 0.02;
