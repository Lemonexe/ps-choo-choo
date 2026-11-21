import test from "node:test";
import assert from "node:assert/strict";
import { solveBasic } from "iapws-if97";
import {
  ATM,
  PC,
  boilingPoint,
  flash,
  mixture,
  ph,
  ps,
  pt,
  saturation,
  vaporPressure,
  vaporTakeoff,
  waterLevel,
} from "../dist/physics/thermo.js";
import { bisect, solveBracket, maximize } from "../dist/physics/math.js";

function close(a, b, relative = 1e-7, absolute = 1e-6) {
  assert.ok(
    Math.abs(a - b) <= Math.max(absolute, relative * Math.abs(b)),
    `${a} differs from ${b}`,
  );
}
test("IF97 published forward verification cases: Regions 1, 2, 3 and 5", () => {
  // IAPWS R7-97 Tables 5, 15, 33, 42. SI adapter verified independently.
  const cases = [
    [3e6, 300, 0.00100215168, 115331.273, 392.294792],
    [80e6, 300, 0.000971180894, 184142.828, 368.563852],
    [3e6, 500, 0.001202418, 975542.239, 2580.41912],
    [3500, 300, 39.4913866, 2549911.45, 8522.38967],
    [3500, 700, 92.3015898, 3335683.75, 10174.9996],
    [30e6, 700, 0.00542946619, 2631494.74, 5175.40298],
    [25.5837018e6, 650, 0.002, 1863430.19, 4054.27273],
    [0.5e6, 1500, 1.3845509, 5219768.55, 9654.08875],
    [30e6, 1500, 0.0230761299, 5167235.14, 7729.70133],
  ];
  for (const [p, T, v, h, s] of cases) {
    const a = pt(p, T);
    close(a.v, v, 2e-7);
    close(a.h, h, 2e-7);
    close(a.s, s, 2e-7);
    close(a.h, a.u + p * a.v, 2e-9, 0.02);
  }
});
test("direct saturation equations match published reference values", () => {
  close(vaporPressure(300), 3536.58941, 2e-8);
  close(vaporPressure(500), 2638897.76, 2e-8);
  close(boilingPoint(1e6), 453.035632, 2e-8);
  close(boilingPoint(10e6), 584.149488, 2e-8);
  close(boilingPoint(ATM), 373.1243, 1e-6);
});
test("normal-pressure backward fast path agrees with full reference implementation", () => {
  for (const p of [ATM, 0.5e6, 1.7e6, 5e6, 15e6])
    for (const T of [290, 450, 600, 850, 1050]) {
      const a = pt(p, T);
      const b = ph(p, a.h),
        c = ps(p, a.s);
      close(b.T, T, 1e-7);
      close(c.T, T, 1e-7);
      close(b.v, a.v, 1e-6);
      close(c.v, a.v, 1e-6);
      const full = solveBasic({ mode: "PH", p: p / 1e6, h: a.h / 1000 });
      close(b.h, full.enthalpy * 1000, 1e-8);
    }
});
test("isochoric flash round trips liquid, vapor, near-critical and supercritical states", () => {
  for (const [p, T] of [
    [3e6, 300],
    [3e6, 500],
    [3e6, 700],
    [25e6, 623.15],
    [22e6, 647.09],
    [25e6, 650],
    [30e6, 700],
    [99e6, 640],
    [99e6, 650],
    [99e6, 700],
    [1e6, 1500],
  ]) {
    const a = pt(p, T),
      mass = 16 / a.v,
      b = flash(mass, mass * a.u, 16);
    close(b.T, T, 2e-7, 0.001);
    close(b.p, p, 1e-5, 20);
    close(b.u, a.u, 1e-7, 0.1);
  }
});
test("two-phase flash conserves quality, specific volume, internal energy and level", () => {
  for (const T of [300, 450, 600, 640])
    for (const x of [0.001, 0.2, 0.8, 0.999]) {
      const sat = saturation(T),
        a = mixture(sat, x),
        m = 16 / a.v,
        b = flash(m, m * a.u, 16);
      close(b.T, T, 1e-7);
      close(b.x, x, 1e-5, 1e-7);
      close(b.v, a.v);
      close(waterLevel(b), ((1 - x) * sat.liquid.v) / a.v, 1e-5, 1e-8);
      close(vaporTakeoff(b).h, sat.vapor.h, 1e-6);
    }
  assert.equal(waterLevel(pt(30e6, 700)), null);
  assert.equal(waterLevel(pt(ATM, 500)), 0);
  assert.equal(waterLevel(pt(3e6, 300)), 1);
});
test("unsupported/nonfinite states fail explicitly", () => {
  assert.throws(() => pt(101e6, 500));
  assert.throws(() => pt(ATM, 260));
  assert.throws(() => pt(PC, 647.096));
  assert.throws(() => flash(0, 1, 16));
  assert.throws(() => flash(10000, NaN, 16));
  assert.throws(() => flash(10000, -1e12, 16));
});
test("bracketed numerical methods solve and reject invalid brackets", () => {
  for (const solver of [bisect, solveBracket]) {
    close(
      solver((x) => x * x - 2, 0, 2),
      Math.sqrt(2),
      1e-6,
    );
    close(
      solver((x) => Math.exp(x) - 100, 0, 10),
      Math.log(100),
      1e-6,
    );
    assert.throws(() => solver((x) => x * x + 1, 0, 2));
    assert.throws(() => solver(() => NaN, 0, 2));
  }
  close(maximize((x) => -((x - 3) ** 2), 0, 10).x, 3, 1e-5);
});
