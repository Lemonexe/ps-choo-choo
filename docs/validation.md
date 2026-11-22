# Validation record

Verified locally with Node.js 24.17.0, TypeScript 7.0.2, iapws-if97 2.8.0 and
Playwright 1.65.1 driving the installed Brave/Chromium browser. Package versions
are pinned in `package-lock.json`.

## Automated checks

- **45 passing tests** through `npm test`, including the DOM-free physics build.
- Published IF97 forward cases for Regions 1, 2, 3 and 5; direct saturation cases
  for Region 4. Forward reference comparisons allow 2×10⁻⁷ relative discrepancy
  against rounded published values.
- Backward property round trips and comparison against the dependency's general
  implementation across normal-pressure liquid, vapor and wet states.
- Isochoric flash round trips for liquid, vapor, wet mixtures, near-critical and
  supercritical water, including 99 MPa compressed/dense states. Energy tolerance
  is about 0.03 J/kg; reference flash pressure acceptance is 10⁻⁵ relative or 20 Pa.
- Component checks for equilibrium choking, isentropic expansion, periodic cylinder
  mass/energy accounting, clearance mixing, cold/hot superheater bounds, pumping,
  phase-aware relief, draft, gas-side enthalpy and heat-exchanger temperature bounds.
- Coupled balances cover condenser on/off, manual vent, firing and stationary
  auxiliary pumping. Every step must leave mass residual below 10⁻⁷ kg and
  thermal/chemical transfer residual below 0.01 J.
- Admission and slip start from standstill without a power/speed singularity.
  Open-throttle supercritical cases at 25 MPa/650 K, 30 MPa/700 K and 50 MPa/700 K
  return valid flow, work and conservation diagnostics.
- Snapshot shape/version/domain validation, empty/vapor-filled tender rejection,
  capacity/control limits, nonfinite and unsupported fluid states.
- JSON file export/import round trip into clean state, and deep backfill of
  missing nested fields while preserving explicit zero/false values.
- Vercel output contains the app's native ESM dependency paths and license notices,
  excludes source/declaration/map files, removes stale output and preserves project
  linkage. Extensionless fallback excludes missing JavaScript assets.

## Fixed-step convergence

`npm run test:convergence` compares identical **10-second** scenarios at 20, 10
and 5 ms. The acceptance threshold is 0.5% difference from 5 ms for pressure,
speed, fire coal, boiler mass and total water/steam enthalpy. The 10 ms result must
also move toward the 5 ms result (with small absolute tolerance for roundoff).

Measured **20 ms versus 5 ms** relative differences, in percent:

| Scenario                               |   Pressure |     Speed |       Coal | Boiler mass |  Enthalpy |
| -------------------------------------- | ---------: | --------: | ---------: | ----------: | --------: |
| Acceleration, sand, stoker and feed    |  0.000131% | 0.007490% |  0.000576% |   0.000077% | 0.000082% |
| Wheel slip and condenser               |  0.000522% | 0.000226% | <0.000001% |   0.000007% | 0.000105% |
| Manual vent and reduced relief setting | <0.000001% |        0% | <0.000001% |   0.000099% | 0.000072% |

The maximum transfer residual observed across those runs was **1.76×10⁻¹¹ kg**
and **0.000143 J per tick**. These are thermal/chemical control-volume balances,
not a claim of exact Euler mechanical-energy conservation. The latter has its
own `mechanicalResidual` diagnostic and decreases with timestep refinement.

The 20 ms scenarios averaged approximately 7.3 ms per tick for acceleration,
10.9 ms for slipping/condenser, and 0.9 ms for venting/relief on this host. These
are scenario averages, not worst-case latency promises. Extreme states and slower
devices can run below wall-clock speed: each timer invocation advances 1, 2, 4,
or 8 fixed 20 ms steps according to playback speed, and never substitutes a large
elapsed-time Euler step. A failure stops an accelerated batch immediately.

**20 ms is retained as the default.** This demonstrates convergence for these
representative scenarios, not universal stability for every possible sandbox
state. Invalid next states fail closed with a paused modal rather than being
clamped to invented pressure/energy values.

An additional 90-second fired run with throttle, stoker and feed crossed from
saturated/wet superheater outlet to superheated outlet, remained valid, and
finished without a solver failure. It took about 25 seconds wall time on this host.

## Browser checks

`BROWSER_EXECUTABLE=/opt/brave.com/brave/brave npm run test:browser` passed:

- All native ESM modules load without a bundler or runtime CDN requests.
- Preheat, supplies, manual/automatic firing selection, throttle and brake.
- Play/pause icons and pressed states; ×2/×4/×8 step counts, mutually exclusive
  speed selection that resumes the simulation, and active-speed toggle back to
  1× that preserves pause/run state. Whole-second elapsed simulation time advances
  8× as fast at 8× playback for the same number of timer callbacks.
- Compact header and unfilled paused button; Getting started is the first tab,
  introductory copy appears only there, and two ordered readout rows sit below
  the schematic. Opposite-direction gear is silently rejected in both directions,
  including after selecting neutral.
- Held manual vent and pointer release.
- Liquid blowdown restores admission from an overfilled version-1 save without
  resetting the boiler. Pointer/keyboard release, cancellation, focus loss, pause,
  hidden-document pause and reload close the valve. Snapshots migrate to version 2.
- Paused-only specification/management controls.
- Saved controls/specifications and paused reload.
- Hidden-document automatic pause.
- About-tab Wikipedia and 01 118-specific Wikimedia links.
- Reset cancel/confirm behavior.
- Settings snapshot download and file-picker load restore the exported state paused.
- Desktop and 390 px mobile layouts with no document horizontal overflow;
  the diagram scrolls within its own viewport to preserve legible labels.
- A supported high-pressure state whose next heat input exceeds IF97 limits
  opens the error modal, stays paused and retains the previous state.
- Corrupt saved JSON opens a recovery modal and provides a fresh paused state.
- No browser runtime errors or failed application-module requests.

Desktop/mobile screenshots were visually inspected. The browser script writes
fresh screenshots under `/tmp`; generated screenshots are not committed.

`npm run test:browser:static` runs that same smoke test against the packaged
`.vercel/output/static` directory. Building and testing the artifact needs no
Vercel credentials. An authenticated GitHub-to-Vercel deployment still requires
the three project secrets described in `deployment.md`.

## Numerical boundaries and remaining approximations

Root solving uses bracket-preserving Illinois interpolation, periodically bisected,
with bounded iterations and explicit failure. Single-phase normal-pressure
backward equations are refined with safeguarded Newton steps against the forward
EOS. Golden-section refinement locates the nozzle maximum after a coarse scan.
No thermodynamic property lookup tables or linear interpolation are used.

The runtime dependency excludes the exact critical point and can reject some very
near-critical saturation states; such failures are surfaced, not extrapolated.
Small regional seams in IF97 remain. Wet nozzle flow assumes instantaneous
equilibrium; water-side and supercritical heat-transfer conductances are empirical.
Relief uses frozen old-state vapor enthalpy in the dome, so large instantaneous
setting changes have projection error even though their mass/energy balance closes.
Cylinder early release, constant effective solid heat capacities and massless
algebraic slipping are documented idealizations. See `model.md` for the equations.
