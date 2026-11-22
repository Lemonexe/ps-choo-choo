import {
  BASE_ALTITUDE,
  createTerrain,
  terrainAt,
  terrainWindow,
  validateTerrain,
} from "./terrain.js";
import { filledBoiler, atPressureVolume, relief } from "./boiler.js";
import { engineContext, traction } from "./cylinder.js";
import { hydraulicPump, liquidBlowdown, nozzle } from "./flow.js";
import { firebox, gasExchanger, temperature, thermalEnergy, waterConductance } from "./heat.js";
import { finite, SimulationError } from "./math.js";
import { move, trainMass } from "./motion.js";
import {
  ATM,
  MAX_P,
  boilingPoint,
  flash,
  ph,
  ps,
  pt,
  saturation,
  vaporTakeoff,
  waterLevel,
  type Water,
} from "./thermo.js";
import { DESIGN, DT, type Alert, type Diagnostics, type State, type Step } from "./types.js";

export function initialState(): State {
  const feed = pt(ATM, DESIGN.ambient);
  return {
    time: 0,
    distance: 0,
    altitude: BASE_ALTITUDE,
    terrain: createTerrain(),
    boiler: filledBoiler(),
    fire: { coal: 0, energy: 0 },
    tank: { mass: DESIGN.waterCapacity, energy: DESIGN.waterCapacity * feed.h },
    bunker: DESIGN.coalCapacity,
    superheaterEnergy: thermalEnergy(boilingPoint(ATM), DESIGN.superheaterCapacity),
    speed: 0,
    controls: {
      throttle: 0,
      reverser: 0.6,
      stoker: 0,
      pump: 0,
      brake: 1,
      sand: false,
      vent: false,
      blowdown: false,
    },
    specs: {
      condenser: false,
      automaticStoker: false,
      passenger: 4,
      freight: 0,
      reliefPressure: DESIGN.nominalPressure,
    },
  };
}

export function storedMass(s: State): number {
  return s.boiler.mass + s.tank.mass + s.bunker + s.fire.coal;
}
export function storedEnergy(s: State): number {
  // Tank uses enthalpy at fixed atmospheric pressure (includes displacement work).
  return (
    s.boiler.energy +
    s.boiler.metalEnergy +
    s.superheaterEnergy +
    s.fire.energy +
    (s.fire.coal + s.bunker) * DESIGN.lhv +
    s.tank.energy
  );
}
export function boilerWater(s: State): Water {
  return flash(s.boiler.mass, s.boiler.energy, DESIGN.boilerVolume);
}

export function validateState(s: State): void {
  const values = [
    s.time,
    s.distance,
    s.altitude,
    s.speed,
    s.boiler.mass,
    s.boiler.energy,
    s.boiler.metalEnergy,
    s.fire.coal,
    s.fire.energy,
    s.tank.mass,
    s.tank.energy,
    s.bunker,
    s.superheaterEnergy,
    ...Object.values(s.controls).filter((x): x is number => typeof x === "number"),
    ...Object.values(s.specs).filter((x): x is number => typeof x === "number"),
  ];
  values.forEach((x) => finite(x, "State value"));
  validateTerrain(s.terrain, s.distance, s.altitude);
  if (
    s.time < 0 ||
    s.boiler.mass <= 0 ||
    s.tank.mass < 0 ||
    s.bunker < 0 ||
    s.fire.coal < 0 ||
    s.tank.mass > DESIGN.waterCapacity + 0.001 ||
    s.bunker > DESIGN.coalCapacity + 0.001 ||
    s.fire.coal > DESIGN.maxFireCoal + 0.001 ||
    s.tank.energy < 0 ||
    s.boiler.metalEnergy < -1 ||
    s.superheaterEnergy < -1 ||
    s.fire.energy < -1
  )
    throw new SimulationError("Mass, capacity, or thermal state is invalid.");
  for (const key of ["throttle", "stoker", "pump", "brake"] as const)
    if (s.controls[key] < 0 || s.controls[key] > 1)
      throw new SimulationError(`Invalid ${key} control.`);
  if (
    Math.abs(s.controls.reverser) > 1 ||
    !Number.isInteger(s.specs.passenger) ||
    !Number.isInteger(s.specs.freight) ||
    s.specs.passenger < 0 ||
    s.specs.freight < 0 ||
    s.specs.passenger > 100 ||
    s.specs.freight > 100 ||
    s.specs.reliefPressure <= ATM ||
    s.specs.reliefPressure > 100e6
  )
    throw new SimulationError("Locomotive specifications are outside the supported range.");
  if (s.tank.mass === 0) {
    if (Math.abs(s.tank.energy) > 0.001)
      throw new SimulationError("An empty tender cannot retain water enthalpy.");
  } else {
    const tank = ph(ATM, s.tank.energy / s.tank.mass);
    if (tank.phase !== "liquid" && !(tank.x !== null && tank.x <= 1e-8))
      throw new SimulationError("Tender water must remain liquid at atmospheric pressure.");
  }
}

function alerts(
  s: State,
  d: Omit<Diagnostics, "alerts">,
  engineWet = false,
  liquid = false,
  saturated = false,
): Alert[] {
  const a: Alert[] = [];
  const add = (id: string, text: string, severity: Alert["severity"] = "warning"): void => {
    a.push({ id, text, severity });
  };
  if (d.level !== null && d.level <= DESIGN.tubeLevel)
    add("water", "Boiler water at or below tube crown — reduced tube cooling.");
  if (liquid) add("liquid", "Liquid entering steam circuit — cylinder admission inhibited.");
  if (d.steamRate > 1e-5 && saturated)
    add("saturated", "Superheater outlet is still saturated or wet.");
  if (engineWet) add("condensation", "Equilibrium condensation occurs in the cylinder.");
  if (d.boiler.p < ATM + 2e5)
    add("pressure", "Low boiler pressure — little starting force available.");
  if (d.reliefRate > 0) add("relief", "Relief valve open — mass and energy vented.");
  if (d.blowdownRate > 0)
    add("blowdown", "Blowdown open — liquid water draining from the boiler.", "info");
  else if (s.controls.blowdown)
    add(
      "blowdown-unavailable",
      "Blowdown requires liquid water and pressure above atmosphere.",
      "info",
    );
  if (d.slipPower > 100) add("slip", "Driving wheels slipping — power dissipated at the rail.");
  if (d.boiler.p > DESIGN.nominalPressure * 1.001)
    add("rating", "Pressure exceeds the reference locomotive’s 16 bar gauge rating.", "info");
  if (s.controls.pump > 0 && d.feedRate < 0.001)
    add("pump", "Feed pump unavailable — check pressure and tender water.");
  if (d.boiler.phase === "supercritical")
    add(
      "critical",
      "Supercritical sandbox: no liquid level; heat transfer is approximate.",
      "info",
    );
  return a;
}

export function inspect(s: State): Diagnostics {
  validateState(s);
  const water = boilerWater(s);
  const d: Omit<Diagnostics, "alerts"> = {
    trackAngle: terrainAt(s.terrain, s.distance).angle,
    boiler: water,
    level: waterLevel(water),
    fireT: temperature(s.fire.energy, DESIGN.fireCapacity),
    metalT: temperature(s.boiler.metalEnergy, DESIGN.boilerMetalCapacity),
    superheaterT: temperature(s.superheaterEnergy, DESIGN.superheaterCapacity),
    chimneyT: DESIGN.ambient,
    fireDuty: 0,
    flueGasRate: 0,
    steamT: vaporTakeoff(water).T,
    power: 0,
    tractionPower: 0,
    slipPower: 0,
    force: 0,
    wheelSpeed: Math.abs(s.speed),
    manualVentRate: 0,
    steamRate: 0,
    burnRate: 0,
    feedRate: 0,
    reliefRate: 0,
    blowdownRate: 0,
    condenserHeat: 0,
    pumpPower: 0,
    efficiency: null,
    enthalpy: s.boiler.energy + water.p * DESIGN.boilerVolume + s.tank.energy,
    trainMass: trainMass(s),
    massResidual: 0,
    energyResidual: 0,
    mechanicalResidual: 0,
  };
  return { ...d, alerts: alerts(s, d) };
}

/** One tick. No mutation of previous state, no retained trajectory or module cache. */
export function step(previous: State, dt = DT): Step {
  validateState(previous);
  if (!(dt > 0 && dt <= 0.02))
    throw new SimulationError("Euler step must be in (0, 0.02] seconds.");
  const s = previous,
    water = boilerWater(s),
    takeoff = vaporTakeoff(water),
    level = waterLevel(water);
  const metalT = temperature(s.boiler.metalEnergy, DESIGN.boilerMetalCapacity);
  const shT = temperature(s.superheaterEnergy, DESIGN.superheaterCapacity);
  const directionAllowed =
    Math.abs(s.speed) < 0.05 || Math.sign(s.controls.reverser) === Math.sign(s.speed);
  const context = engineContext(
    takeoff,
    shT,
    s.superheaterEnergy,
    s.controls.throttle,
    directionAllowed ? s.controls.reverser : 0,
    dt,
  );
  const adhesion = (s.controls.sand ? 0.3 : 0.19) * DESIGN.adhesiveMass * 9.80665;
  const wheels = traction(context, Math.abs(s.speed), adhesion);
  let e = wheels.engine;
  const tankWater =
    s.tank.mass > 0.001 ? ph(ATM, s.tank.energy / s.tank.mass) : pt(ATM, DESIGN.ambient);
  let feed = Math.min(s.controls.pump * DESIGN.maxFeed, s.tank.mass / dt);
  if (water.p <= ATM * 1.02 || takeoff.phase === "liquid") feed = 0;
  let pump = hydraulicPump(tankWater, water.p, feed);
  const pumpExhaust = water.p > ATM ? ps(ATM, takeoff.s) : takeoff;
  const auxiliaryWork = Math.max(0, takeoff.h - pumpExhaust.h);
  let bleed = auxiliaryWork > 1 ? pump.work / auxiliaryWork : 0;
  if (auxiliaryWork <= 1) {
    feed = 0;
    pump = hydraulicPump(tankWater, water.p, 0);
  }
  let vent =
    s.controls.vent && water.p > ATM
      ? nozzle(takeoff).flux(ATM) * DESIGN.manualValveArea * DESIGN.discharge
      : 0;
  const drain = s.controls.blowdown ? liquidBlowdown(water, s.boiler.mass, dt) : { rate: 0, h: 0 };
  let blowdown = drain.rate;
  const outgoing = e.steam + bleed + vent + blowdown;
  const outgoingEnergy = (e.steam + bleed + vent) * takeoff.h + blowdown * drain.h;
  const scale = Math.min(
    1,
    outgoing > 0 ? (s.boiler.mass * 0.9) / (outgoing * dt) : 1,
    outgoingEnergy > 0 ? (Math.max(0, s.boiler.energy) * 0.9) / (outgoingEnergy * dt) : 1,
  );
  if (scale < 1) {
    e = {
      ...e,
      steam: e.steam * scale,
      power: e.power * scale,
      force: e.force * scale,
      heat: e.heat * scale,
    };
    feed *= scale;
    bleed *= scale;
    vent *= scale;
    blowdown *= scale;
    pump = hydraulicPump(tankWater, water.p, feed);
  }
  const fire = firebox(s.fire, e.steam, s.specs.condenser, dt);
  const stoked = s.specs.automaticStoker
    ? Math.min(
        s.controls.stoker * DESIGN.maxStoker,
        s.bunker / dt,
        Math.max(0, DESIGN.maxFireCoal - s.fire.coal) / dt,
      )
    : 0;
  const radiation = fire.radiation * (fire.T ** 4 - metalT ** 4);
  // Gas passes superheater flues and primary heating surfaces before chimney.
  const shGas = gasExchanger(fire.T, shT, fire.gasMass, DESIGN.superheaterArea, 0.55, 0.08);
  const primary = gasExchanger(shGas.outlet, metalT, fire.gasMass, DESIGN.heatingArea, 1.1, 0.05);
  const boilHeat = waterConductance(level, water.T) * (metalT - water.T);
  const boilerLoss = 160 * (metalT - DESIGN.ambient);
  const shLoss = 35 * (shT - DESIGN.ambient);
  const tankLoss = Math.min(
    Math.max(0, s.tank.energy - s.tank.mass * pt(ATM, DESIGN.ambient).h) / dt,
    90 * Math.max(0, tankWater.T - DESIGN.ambient),
  );
  const exhaustMass = e.steam + bleed;
  const exhaustEnergy = e.steam * e.exhaustH + bleed * pumpExhaust.h;
  const condensate = saturation(boilingPoint(ATM)).liquid;
  // Do not recover more water than fits; overflow is an external exhaust stream.
  const recovered = s.specs.condenser
    ? Math.min(exhaustMass, Math.max(0, DESIGN.waterCapacity - s.tank.mass) / dt + feed)
    : 0;
  const condenserHeat = s.specs.condenser
    ? Math.max(0, exhaustEnergy - exhaustMass * condensate.h)
    : 0;
  const externalExhaust = s.specs.condenser
    ? (exhaustMass - recovered) * condensate.h
    : exhaustEnergy;
  const next: State = {
    ...s,
    time: s.time + dt,
    controls: { ...s.controls },
    specs: { ...s.specs },
    bunker: s.bunker - stoked * dt,
    fire: {
      coal: s.fire.coal + (stoked - fire.burn) * dt,
      energy:
        s.fire.energy + (fire.burn * DESIGN.lhv - radiation - fire.gasHeat - fire.ambient) * dt,
    },
    boiler: {
      mass: s.boiler.mass + (feed - e.steam - bleed - vent - blowdown) * dt,
      energy:
        s.boiler.energy +
        (boilHeat +
          feed * pump.outlet.h -
          (e.steam + bleed + vent) * takeoff.h -
          blowdown * drain.h) *
          dt,
      metalEnergy: s.boiler.metalEnergy + (radiation + primary.heat - boilHeat - boilerLoss) * dt,
    },
    superheaterEnergy: s.superheaterEnergy + (shGas.heat - e.heat - shLoss) * dt,
    tank: {
      mass: s.tank.mass + (recovered - feed) * dt,
      energy: s.tank.energy + (recovered * condensate.h - feed * tankWater.h - tankLoss) * dt,
    },
  };
  const interim = boilerWater(next);
  const released = relief(next.boiler, interim, s.specs.reliefPressure);
  next.boiler = released.boiler;
  const motion = move(s, e.force, dt);
  next.speed = motion.speed;
  next.distance = s.distance + s.speed * dt;
  next.terrain = terrainWindow(s.terrain, next.distance);
  const track = terrainAt(next.terrain, next.distance);
  next.altitude = track.altitude;
  validateState(next);
  const finalWater = released.mass > 0 ? boilerWater(next) : interim;
  const massOut = (fire.burn + vent + blowdown + exhaustMass - recovered) * dt + released.mass;
  const gasExhaustHeat = fire.gasHeat - shGas.heat - primary.heat;
  const energyOut =
    (fire.ambient +
      boilerLoss +
      shLoss +
      tankLoss +
      gasExhaustHeat +
      e.power +
      vent * takeoff.h +
      blowdown * drain.h +
      condenserHeat +
      externalExhaust) *
      dt +
    released.energy;
  const massResidual = storedMass(next) - storedMass(s) + massOut;
  const energyResidual = storedEnergy(next) - storedEnergy(s) + energyOut;
  // Main-cycle reference per kg of fresh cylinder steam. It always includes
  // ideal feed-pump work, even when today's feed control is temporarily closed.
  // Actual auxiliary steam remains in the physical stream/energy balances.
  const referencePumpWork = tankWater.v * Math.max(0, water.p - ATM);
  const heating = e.steam * (e.inlet.h - tankWater.h - referencePumpWork);
  const netWork = e.power - e.steam * referencePumpWork;
  const efficiency = e.steam > 1e-6 && heating > 1 && netWork > 0 ? netWork / heating : null;
  const d: Omit<Diagnostics, "alerts"> = {
    trackAngle: track.angle,
    boiler: finalWater,
    level: waterLevel(finalWater),
    fireT: temperature(next.fire.energy, DESIGN.fireCapacity),
    metalT: temperature(next.boiler.metalEnergy, DESIGN.boilerMetalCapacity),
    superheaterT: temperature(next.superheaterEnergy, DESIGN.superheaterCapacity),
    chimneyT: primary.outlet,
    fireDuty: fire.burn * DESIGN.lhv,
    flueGasRate: fire.gasMass,
    steamT: e.inlet.T,
    power: e.power,
    tractionPower: e.force * Math.abs(s.speed),
    slipPower: e.force * wheels.slip,
    force: e.force,
    wheelSpeed: wheels.wheelSpeed,
    manualVentRate: vent,
    steamRate: e.steam,
    burnRate: fire.burn,
    feedRate: feed,
    reliefRate: released.mass / dt,
    blowdownRate: blowdown,
    condenserHeat,
    pumpPower: pump.work,
    efficiency,
    enthalpy: next.boiler.energy + finalWater.p * DESIGN.boilerVolume + next.tank.energy,
    trainMass: trainMass(next),
    massResidual,
    energyResidual,
    mechanicalResidual:
      motion.kineticError +
      trainMass(s) * 9.80665 * (next.altitude - s.altitude) +
      motion.gradeWork,
  };
  return {
    state: next,
    diagnostics: { ...d, alerts: alerts(next, d, e.wet, e.liquid, e.inlet.x !== null) },
  };
}

export type Management = "water" | "coal" | "prime" | "fire" | "boiler";
export function manage(
  s: State,
  action: Management,
): { state: State; mass: number; energy: number } {
  const next: State = {
    ...s,
    boiler: { ...s.boiler },
    fire: { ...s.fire },
    tank: { ...s.tank },
    controls: { ...s.controls },
    specs: { ...s.specs },
  };
  switch (action) {
    case "water":
      next.tank = {
        mass: DESIGN.waterCapacity,
        energy: s.tank.energy + (DESIGN.waterCapacity - s.tank.mass) * pt(ATM, DESIGN.ambient).h,
      };
      break;
    case "coal":
      next.bunker = DESIGN.coalCapacity;
      break;
    case "prime": {
      const water = boilerWater(s),
        level = waterLevel(water);
      if (level !== null && level < DESIGN.normalLevel && water.T < 647.096) {
        const b = filledBoiler(water.p);
        next.boiler = { ...b, metalEnergy: s.boiler.metalEnergy };
      }
      break;
    }
    case "fire": {
      const coal = Math.min(Math.max(0, 200 - s.fire.coal), s.bunker);
      next.bunker -= coal;
      next.fire.coal += coal;
      next.fire.energy = Math.max(s.fire.energy, thermalEnergy(1100, DESIGN.fireCapacity));
      break;
    }
    case "boiler": {
      const water = boilerWater(s);
      const targetPressure = water.p + 5e5;
      if (targetPressure > MAX_P)
        throw new SimulationError("Adding 5 bar would exceed the IF97 limit of 100 MPa.");
      const a = atPressureVolume(targetPressure, DESIGN.boilerVolume / s.boiler.mass);
      next.boiler.energy = s.boiler.mass * a.u;
      next.boiler.metalEnergy = Math.max(
        s.boiler.metalEnergy,
        thermalEnergy(a.T, DESIGN.boilerMetalCapacity),
      );
      break;
    }
  }
  validateState(next);
  boilerWater(next);
  return {
    state: next,
    mass: storedMass(next) - storedMass(s),
    energy: storedEnergy(next) - storedEnergy(s),
  };
}

export function addCoal(s: State): State {
  const amount = Math.min(DESIGN.coalChunk, s.bunker, DESIGN.maxFireCoal - s.fire.coal);
  return { ...s, bunker: s.bunker - amount, fire: { ...s.fire, coal: s.fire.coal + amount } };
}

/** UI enforces paused changes. All physics inventory and momentum are preserved. */
export function changeTerrain(s: State, generated: boolean, seed = 0): State {
  const terrain = createTerrain(generated, seed, s.distance);
  const next = { ...s, terrain, altitude: terrainAt(terrain, s.distance).altitude };
  validateState(next);
  return next;
}
