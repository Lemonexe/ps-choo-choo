export class SimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationError";
  }
}

export const clamp = (x: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, x));
export function finite(x: number, label: string): number {
  if (!Number.isFinite(x)) throw new SimulationError(`${label} is not finite.`);
  return x;
}

/** Bracketed bisection. Never returns an unconverged last iterate. */
export function bisect(
  fn: (x: number) => number,
  lo: number,
  hi: number,
  xtol = 1e-7,
  ftol = 1e-7,
  iterations = 80,
): number {
  let a = finite(fn(lo), "Lower residual");
  const b = finite(fn(hi), "Upper residual");
  if (Math.abs(a) <= ftol) return lo;
  if (Math.abs(b) <= ftol) return hi;
  if (Math.sign(a) === Math.sign(b)) throw new SimulationError("Root is not bracketed.");
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const f = finite(fn(mid), "Root residual");
    if (Math.abs(f) <= ftol || hi - lo <= xtol) return mid;
    if (Math.sign(f) === Math.sign(a)) {
      lo = mid;
      a = f;
    } else hi = mid;
  }
  throw new SimulationError("Bisection did not converge.");
}

/** Golden-section refinement of a bounded maximum. */
export function maximize(
  fn: (x: number) => number,
  lo: number,
  hi: number,
  tolerance = 1e-5,
): { x: number; value: number } {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = hi - ratio * (hi - lo),
    b = lo + ratio * (hi - lo);
  let fa = finite(fn(a), "Maximum objective"),
    fb = finite(fn(b), "Maximum objective");
  for (let i = 0; hi - lo > tolerance; i++) {
    if (i >= 80) throw new SimulationError("Maximum search did not converge.");
    if (fa > fb) {
      hi = b;
      b = a;
      fb = fa;
      a = hi - ratio * (hi - lo);
      fa = finite(fn(a), "Maximum objective");
    } else {
      lo = a;
      a = b;
      fa = fb;
      b = lo + ratio * (hi - lo);
      fb = finite(fn(b), "Maximum objective");
    }
  }
  const x = (lo + hi) / 2;
  return { x, value: finite(fn(x), "Maximum objective") };
}

export const smoothstep = (x: number): number => {
  const a = clamp(x);
  return a * a * (3 - 2 * a);
};

/** Illinois false position, periodically bisected to guarantee bracket progress. */
export function solveBracket(
  fn: (x: number) => number,
  lo: number,
  hi: number,
  xtol = 1e-7,
  ftol = 1e-7,
): number {
  let fa = finite(fn(lo), "Lower residual"),
    fb = finite(fn(hi), "Upper residual");
  if (Math.abs(fa) <= ftol) return lo;
  if (Math.abs(fb) <= ftol) return hi;
  if (Math.sign(fa) === Math.sign(fb)) throw new SimulationError("Root is not bracketed.");
  let wa = fa,
    wb = fb,
    side = 0;
  for (let i = 0; i < 100; i++) {
    const candidate = (lo * wb - hi * wa) / (wb - wa);
    const x = i % 8 === 7 || !(candidate > lo && candidate < hi) ? (lo + hi) / 2 : candidate;
    const f = finite(fn(x), "Root residual");
    if (Math.abs(f) <= ftol || hi - lo <= xtol) return x;
    if (Math.sign(f) === Math.sign(fa)) {
      lo = x;
      fa = f;
      wa = f;
      wb = side === 1 ? wb / 2 : fb;
      side = 1;
    } else {
      hi = x;
      fb = f;
      wb = f;
      wa = side === -1 ? wa / 2 : fa;
      side = -1;
    }
  }
  throw new SimulationError("Safeguarded interpolation did not converge.");
}
