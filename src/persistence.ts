import { initialState, inspect, validateState } from "./physics/simulation.js";
import type { State } from "./physics/types.js";

export const STORAGE_KEY = "ps-choo-choo.snapshot";
const VERSION = 2;

/** Strict shape validation prevents missing fields, strings, NaN and prototype surprises. */
function sameShape(value: unknown, example: unknown): boolean {
  if (typeof example === "number") return typeof value === "number" && Number.isFinite(value);
  if (typeof example === "boolean") return typeof value === "boolean";
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
function parseSnapshot(raw: string): { version: 1 | 2; state: unknown } {
  const data: unknown = JSON.parse(raw);
  if (
    !data ||
    typeof data !== "object" ||
    !("version" in data) ||
    (data.version !== 1 && data.version !== VERSION) ||
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

export function decode(raw: string): State {
  const data = parseSnapshot(raw);
  let candidate = data.state;
  if (data.version === 1) {
    // Preserve existing boilers (including overfilled ones); only add the new
    // momentary control after validating the complete original snapshot shape.
    const example = initialState();
    const controls: Partial<State["controls"]> = { ...example.controls };
    delete controls.blowdown;
    if (!sameShape(candidate, { ...example, controls }))
      throw new Error("Saved state has invalid or missing fields.");
    const old = candidate as State;
    candidate = { ...old, controls: { ...old.controls, blowdown: false } };
  }
  return restore(candidate);
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
  return restore(backfill(initialState(), data.state));
}
