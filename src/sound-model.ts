import { DESIGN, type Diagnostics, type State } from "./physics/types.js";
import { ATM } from "./physics/thermo.js";

export const SOUND_STORAGE_KEY = "ps-choo-choo.sound";
export interface SoundPreferences {
  enabled: boolean;
  volume: number;
}
export const DEFAULT_SOUND: SoundPreferences = { enabled: true, volume: 0.5 };
export function soundPreferences(raw: string | null): SoundPreferences {
  try {
    const value = JSON.parse(raw ?? "null") as Partial<SoundPreferences> | null;
    if (
      value &&
      typeof value.enabled === "boolean" &&
      typeof value.volume === "number" &&
      Number.isFinite(value.volume) &&
      value.volume >= 0 &&
      value.volume <= 1
    )
      return { enabled: value.enabled, volume: value.volume };
  } catch {
    /* Corrupt preferences must not prevent starting the locomotive. */
  }
  return { ...DEFAULT_SOUND };
}
const unit = (n: number): number => Math.max(0, Math.min(1, n));

/** Presentation only: no sound or whistle can withdraw steam or modify state. */
export function soundPlan(
  state: State,
  d: Diagnostics,
  playback: number,
  running: boolean,
  hidden: boolean,
  whistleHeld: boolean,
  preferences: SoundPreferences,
) {
  const active = running && !hidden;
  const speed = Math.abs(state.speed);
  const beats = (d.wheelSpeed * 4) / (Math.PI * DESIGN.wheelDiameter);
  const pressure = unit((d.boiler.p - ATM - 2000) / (DESIGN.nominalPressure - ATM - 2000));
  const voice = Math.sqrt(pressure);
  const steamPerBeat = beats > 0 ? d.steamRate / beats : 0;
  const sounding = active && d.steamRate > 1e-6 && beats > 0;
  return {
    volume: preferences.enabled && !hidden ? preferences.volume : 0,
    active,
    beatHz: sounding ? beats * playback : 0,
    beatGain: sounding ? 0.3 * Math.sqrt(unit(steamPerBeat / 0.5)) * (0.3 + 0.7 * voice) : 0,
    beatDuration: (0.09 + 0.16 * Math.abs(state.controls.reverser)) / playback,
    clackHz: active ? (speed / 12.5) * playback : 0,
    clackGain: active ? 0.24 * Math.sqrt(unit(speed / 25)) : 0,
    // Approximate nearby axles, with a bounded gap to retain a recognizable doublet.
    clackGap: Math.min(0.16, 1.8 / Math.max(speed, 0.1)) / playback,
    rolling: active ? 0.07 * Math.sqrt(unit(speed / 35)) : 0,
    brake: active ? 0.085 * Math.sqrt(state.controls.brake * unit(speed / 3)) : 0,
    brakeHz: 700 + 180 * unit(speed / 30),
    slip: active ? 0.13 * Math.sqrt(unit(d.slipPower / 1e6)) : 0,
    fire: active ? 0.045 * Math.sqrt(unit(d.burnRate / DESIGN.maxBurn)) : 0,
    textureRate: playback,
    hiss: active ? 0.15 * Math.sqrt(unit((d.reliefRate + d.manualVentRate) / 3)) : 0,
    exhaustHiss: active ? 0.025 * Math.sqrt(unit(d.steamRate / 5)) : 0,
    blowdown: active ? 0.1 * Math.sqrt(unit(d.blowdownRate / 10)) : 0,
    whistle: whistleHeld && !hidden ? voice : 0,
    whistleBreath: whistleHeld && !hidden ? voice * (1.2 - voice) : 0,
  };
}
export type SoundPlan = ReturnType<typeof soundPlan>;
