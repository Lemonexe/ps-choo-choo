# pS choo choo — agreed design

An educational steam-locomotive sandbox, inspired by DRG Class 01 locomotive
01 118. It is an equilibrium engineering approximation, not a safety or design tool.

## Architecture

TypeScript compiled only by tsc; native browser ESM; npm; vanilla DOM and canvas.
Physics/math are pure TypeScript with no DOM, storage, timers, or rendering imports.
Each module exposes state and pure calculations. A coordinator evaluates proposals
from the same previous state, reconciles shared withdrawals, and commits transfers
simultaneously. No overall state history. Fixed-step explicit Euler, initially 20 ms;
reference, conservation and 20/10/5 ms convergence tests determine acceptance.
Pause while hidden. Save versioned localStorage snapshots; restore paused.

## Thermodynamics

IF97 Regions 1–5, including supercritical operation. Its accuracy loss near the
critical point is accepted. No artificial mechanical design-pressure limit, but
the IF97 validity domain is enforced. State is conserved mass/internal energy in
fixed boiler volume, with equilibrium pressure/temperature/quality derived.
Two-phase vapor takeoff; homogeneous takeoff in single phase. No boiler air or ice.
Water level is undefined in supercritical fluid. Saturation ends at 22.064 MPa.

Direct IF97 saturation/backward equations wherever possible; bracketed scalar
inversions elsewhere. Approved Illinois interpolation with bisection fallback
accelerates nested solves; backward properties use safeguarded Newton refinement.
Tables/interpolation only after profiling and error checks.
Failed solves, unsupported states and nonfinite results reject the step, retain the
last valid state, pause, and display a modal. Ordinary alerts do not stop the model.
Absolute SI internally; gauge bar in controls/displays, kelvin internally, Celsius
in displays. Every mass stream carries enthalpy; heat/work are separate transfers.

## Components

- Firebox: coal mass and lumped hot-bed/refractory/gas thermal energy. Bituminous
  coal LHV 25.8 MJ/kg. Burn limited by coal availability, ignition temperature and
  draft. Smooth empirical saturation factors. Natural draft plus cylinder exhaust;
  condenser removes exhaust draft. No ash, blower, or combustion chemistry.
- Boiler: single shared equilibrium water/steam inventory. Primary tubes are a
  gas-side exchanger, not a separate water circuit. Retain metal thermal storage.
- Gas convection: laminar internal-flow correlation, Gnielinski turbulent flow,
  smooth transition; separate fourth-power firebox radiation. Fixed atmospheric
  gas pressure, simple temperature-dependent gas properties.
- Water-side conductance: finite wet/dry effective coefficients, reduced cooling
  on tube exposure, continuous near-critical simplification. No boiling crisis,
  tube failure, or reliable supercritical heat-transfer deterioration prediction.
- Solids: constant effective heat capacity; ambient losses K(T-Tambient).
- Superheater: retained metal thermal energy, quasi-steady steam flow, negligible
  steam inventory and pressure drop. Bound heat by source temperatures/energy.
- Throttle/manual vent: ideal equilibrium IF97 nozzle, discharge coefficient,
  choked maximum mass flux from bounded 1-D search. Solve valve supply/cylinder
  demand for admission pressure. Real valve and delayed-condensation effects omitted.
- Cylinder: cycle averaged, double acting; admission, closed isentropic expansion,
  blowdown, atmospheric exhaust and small clearance/residual treatment. Calculate
  p dV work (closed expansion also equals internal-energy decrease), not turbine
  enthalpy-drop work. Equilibrium wet expansion triggers condensation alert.
- Pump: ideal steam-driven auxiliary pump, with hydraulic work supplied by a
  boiler bleed; atmospheric exhaust goes to condenser or outside. Feed control
  requests flow; available pressure/steam/tender water bound it. No wheel drive.
- Condenser: optional ideal unlimited atmospheric cooling to saturated liquid,
  no subcooling. Account rejected heat and return hot water to thermal tender tank.
- Relief: phase-aware adiabatic blowdown to set pressure, accounting mass and
  discharge enthalpy; vapor takeoff when liquid remains, homogeneous discharge
  in single-phase states; no valve capacity dynamics. Manual vent has finite flow.
- Motion: Davis A+B|v|+Cv², grade gravity, adhesion-limited train brakes. No wheel
  rotation state. Solve slip wheel-equivalent speed where engine force meets
  adhesion; loss is adhesion force times slip speed. Sand raises adhesion.
  Mean starting force at rest; no power/speed singularity. Reversing direction
  interlocked near standstill; neutral coasts.

## Reference and operation

01 118: 16 bar gauge, two 600×660 mm cylinders, 2 m drivers, 4.32 m² grate,
247.15 m² evaporative surface, 86.5 m² superheater, 111.3 t locomotive working
mass, 170.6 t locomotive+tender, 34 m³ tender water and 10 t coal. Boiler volume,
metal mass and empirical parameters are estimates, clearly identified in docs.

Start paused, boiler partly filled at atmospheric saturation (~100 °C), unlit
firebox, full supplies, ambient tender water. No noncondensable gases. Sealed
boiler may subsequently develop subatmospheric pressure. Steam discharge never
implicitly admits outside air.

Management (paused, repeatable external additions): fill tender, fill bunker,
prime boiler, preheat firebox/establish coal bed, preheat boiler to nominal pressure.
Never cool components through preheat. Account externally added mass/energy.
Specs editable only paused; carriage count additionally requires standstill.
Live controls: throttle, signed cutoff/direction, stoker/manual coal, water pump,
hold-to-vent, brakes, sand. Specs: condenser off by default, manual firing default,
passenger/freight count, slope, relief setting. Relief changes apply on next step.

Canvas schematic annotates components. Stats: speed, total water/steam enthalpy,
net estimated cycle thermal efficiency (pump work included; slip/drag excluded;
undefined at idle). Alerts: low/exposed tubes, saturated superheater outlet,
cylinder condensation/liquid admission, low pressure, relief, wheel slip, and
pressure exceeding nominal rating (not arbitrary 15 bar). Settings: reset.
About tab: short 01 118 paragraph, Wikipedia and Wikimedia Commons picture links.

## Sources

- https://iapws.org/technical-guidance/release/IF97-Rev
- https://mail.iapws.org/relguide/IF97-Rev.pdf
- https://iapws.org/faqs/faq2
- https://www.historische-eisenbahn-frankfurt.de/wp-content/uploads/2016/07/01118.pdf
- https://doc.comsol.com/5.3/doc/com.comsol.help.pipe/PipeFlowModuleUsersGuide.pdf
- https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/2_Volume2/V2_1_Ch1_Introduction.pdf
- https://www.aar.org/wp-content/uploads/2025/02/Final-Electrification-Report-02252025.pdf
- https://en.wikipedia.org/wiki/DRG_Class_01
- https://commons.wikimedia.org/wiki/Category:DRG_01_118

## Implementation and verification

1. Establish tsc/native-ESM tooling and an audited SI property adapter.
2. Build numerical utilities and independently testable component equations.
3. Compose conservative transfers, ideal blowdown and mechanical dynamics.
4. Add canvas, tabs, controls, validated persistence and critical-error recovery.
5. Verify IF97 references, mass/energy balances, wet/dry/supercritical cases,
   starting/slipping, condenser, relief, and long-running/timestep convergence.
6. Browser smoke test; document approximations and measured tolerances; commit locally.
