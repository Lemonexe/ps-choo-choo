import { initialState, inspect, validateState } from "./physics/simulation.js";
import type { State } from "./physics/types.js";

export const STORAGE_KEY = "ps-choo-choo.snapshot";
const VERSION = 1;

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

export function encode(state: State): string {
  validateState(state);
  // A held button must not remain pressed after reload or losing focus.
  return JSON.stringify({
    version: VERSION,
    state: { ...state, controls: { ...state.controls, vent: false } },
  });
}
export function decode(raw: string): State {
  const data: unknown = JSON.parse(raw);
  if (
    !data ||
    typeof data !== "object" ||
    !("version" in data) ||
    data.version !== VERSION ||
    !("state" in data)
  )
    throw new Error("Saved state uses an unsupported format.");
  if (!sameShape(data.state, initialState()))
    throw new Error("Saved state has invalid or missing fields.");
  const state = data.state as State;
  validateState(state);
  inspect(state);
  state.controls.vent = false;
  return state;
}
