import { terrainWindow, terrainAt } from "./physics/terrain.js";
import { initialState, inspect, validateState } from "./physics/simulation.js";
import type { State } from "./physics/types.js";

export const STORAGE_KEY = "ps-choo-choo.snapshot";
const VERSION = 3;

/** Strict shape validation prevents missing fields, strings, NaN and prototype surprises. */
function sameShape(value: unknown, example: unknown): boolean {
  if (typeof example === "number") return typeof value === "number" && Number.isFinite(value);
  if (typeof example === "boolean") return typeof value === "boolean";
  if (Array.isArray(example)) return Array.isArray(value); // Terrain arrays are bounded/validated by validateState.
  if (example === null || typeof example !== "object") return value === example;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const a = value as Record<string, unknown>,
    b = example as Record<string, unknown>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(b).every((key) => Object.hasOwn(a, key) && sameShape(a[key], b[key]))
  );
}

export function encode(state: State, pretty = false): string {
  validateState(state);
  // A held button must not remain pressed after reload or losing focus.
  return JSON.stringify(
    {
      version: VERSION,
      state: { ...state, controls: { ...state.controls, vent: false, blowdown: false } },
    },
    null,
    pretty ? 2 : undefined,
  );
}
function parseSnapshot(raw: string): { version: 1 | 2 | 3; state: unknown } {
  const data: unknown = JSON.parse(raw);
  if (
    !data ||
    typeof data !== "object" ||
    !("version" in data) ||
    (data.version !== 1 && data.version !== 2 && data.version !== VERSION) ||
    !("state" in data)
  )
    throw new Error("Saved state uses an unsupported format.");
  return { version: data.version, state: data.state };
}

function restore(candidate: unknown): State {
  if (!sameShape(candidate, initialState()))
    throw new Error("Saved state has invalid or missing fields.");
  const state = candidate as State;
  validateState(state);
  inspect(state);
  state.controls.vent = false;
  state.controls.blowdown = false;
  return state;
}

/** Strict legacy shapes are checked before dropping the obsolete slope field. */
function migrate(data: ReturnType<typeof parseSnapshot>, partial = false): unknown {
  if (data.version === VERSION) return data.state;
  const initial = initialState();
  const { distance: _distance, altitude: _altitude, terrain: _terrain, ...old } = initial;
  const controls: Partial<State["controls"]> = { ...old.controls };
  if (data.version === 1) delete controls.blowdown;
  const example = { ...old, controls, specs: { ...old.specs, slope: 0 } };
  const candidate = partial ? backfill(example, data.state) : data.state;
  if (!sameShape(candidate, example)) throw new Error("Saved state has invalid or missing fields.");
  const legacy = candidate as typeof example;
  if (!Number.isFinite(legacy.specs.slope) || Math.abs(legacy.specs.slope) > 100)
    throw new Error("Saved track gradient is invalid.");
  const { slope: _slope, ...specs } = legacy.specs;
  return {
    ...legacy,
    distance: initial.distance,
    altitude: initial.altitude,
    terrain: initial.terrain,
    specs,
    controls: { ...initial.controls, ...legacy.controls, vent: false, blowdown: false },
  };
}

export function decode(raw: string): State {
  return restore(migrate(parseSnapshot(raw)));
}

/** Backfill only absent fields. Present false/zero values survive; invalid
 * values remain invalid. Traverse default keys, never assigning foreign keys
 * (including prototype keys) from an imported file to application objects. */
function backfill(defaults: unknown, saved: unknown): unknown {
  if (
    !defaults ||
    typeof defaults !== "object" ||
    !saved ||
    typeof saved !== "object" ||
    Array.isArray(saved)
  )
    return saved;
  const base = defaults as Record<string, unknown>,
    values = saved as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => [
      key,
      Object.hasOwn(values, key) ? backfill(value, values[key]) : value,
    ]),
  );
}

/** File imports may omit state fields; automatic local restore remains strict. */
export function loadSnapshot(raw: string): State {
  const data = parseSnapshot(raw);
  const merged = backfill(initialState(), migrate(data, true)) as State;
  // A file may specify just a seed/mode; regenerate omitted disposable blocks
  // and derived altitude. Strict automatic restore still checks the full state.
  if (data.version === VERSION && data.state && typeof data.state === "object") {
    const supplied = data.state as Partial<State>;
    if (supplied.terrain && !Object.hasOwn(supplied.terrain, "blocks"))
      merged.terrain = terrainWindow({ ...merged.terrain, blocks: [] }, merged.distance);
    if (!Object.hasOwn(supplied, "altitude"))
      merged.altitude = terrainAt(merged.terrain, merged.distance).altitude;
  }
  return restore(merged);
}
