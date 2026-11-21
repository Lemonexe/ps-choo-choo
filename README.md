# pS choo choo

A frontend-only steam locomotive simulator inspired by **DRG Class 01 / 01 118**.
Vanilla controls and canvas; pure TypeScript physics; IF97 water properties;
native browser ESM. No UI framework, bundler, application backend, or state history.

## Run

Requires Node.js 24+ and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The development command compiles once, serves the
app, then watches TypeScript. Refresh the browser after editing. Alternatively:

```sh
npm run build
npm start
```

`PORT=8080 npm start` changes the port. The Node server is a development convenience,
not a simulation backend. For another static server, preserve `index.html`,
`styles.css`, `dist/` and `node_modules/iapws-if97/dist/` in their relative locations.
The import map resolves the pinned IF97 dependency locally; no CDN is required.
Opening `index.html` through `file://` does not work reliably with browser ESM.

If your shell uses PMG, check `which npm` before installing/upgrading packages and
review its output. Build and test commands do not require PMG.

## Drive

The first **Getting started** tab contains the introduction. Open **Driving cab**
for the schematic and controls; train statistics appear directly below the circuit,
above the steam, coal and feedwater readouts. Opposite-direction running gear is
silently blocked while moving; neutral remains available.

1. In **Management**, preheat the firebox and boiler while paused.
2. In **Driving cab**, release the brake and open the throttle gradually.
3. Use running gear for direction and admission cutoff. Sand improves adhesion.
4. Add 20 kg coal charges, or enable the stoker in **Specifications**.
5. Feed water before the boiler level reaches the tubes. The ideal steam-driven
   pump works while stationary once sufficient pressure is available.
6. To recover from overfilling, turn the feed pump off and hold **water blowdown**
   to drain liquid until steam admission is restored. Release to close the drain.

Use the play/pause button to resume or pause, and ×2, ×4, or ×8 to select playback
speed and resume. Clicking the selected speed returns to 1× without changing
whether the simulation is paused. Speed selection is retained across pause/resume;
reload and reset return to 1×. The 🕒 clock shows elapsed simulation time in whole
seconds, so it advances faster during acceleration. Acceleration runs more fixed
20 ms steps, without enlarging the physics timestep.

Start/restore is always paused. Hidden tabs pause automatically. The manual steam
release and liquid blowdown operate only while their buttons are held; release,
lost capture, loss of focus, pause, and reload close both. Blowdown discharges to
atmosphere, requires positive gauge pressure and liquid, and does not recover
water through the condenser. State is saved on this device, not uploaded. Existing
version-1 saves migrate automatically, preserving their boiler and supplies.
All specifications require pause; changing carriage counts also requires near
standstill. Reset asks before replacing the saved locomotive.

In **Settings**, **Save snapshot** downloads a JSON file containing the simulation
state. **Load snapshot** restores that file into a paused locomotive at 1× speed,
backfilling omitted state fields from the starting defaults. Present values,
including zero and false, are preserved. Invalid files leave the current state
intact. Held valves always load closed.

The warm starting boiler contains only equilibrium water/steam at atmospheric
pressure, no air. Preheat/replenishment actions explicitly report external mass
and energy changes. They are repeatable sandbox conveniences.

## Verification

```sh
npm test                 # forward IF97 references, components, balances, snapshots
npm run typecheck
npm run test:convergence # 10 s scenarios at 20, 10 and 5 ms
npm run test:browser     # Playwright end-to-end smoke and desktop/mobile screenshots
```

For browser checks, install Playwright Chromium through your normal guarded npm
workflow (`npx playwright install chromium`), or use an existing browser:

```sh
BROWSER_EXECUTABLE=/path/to/chromium npm run test:browser
```

Screenshots are written to `/tmp/ps-choo-choo-desktop.png` and
`/tmp/ps-choo-choo-mobile.png`. `CONVERGENCE_SECONDS=30 npm run test:convergence`
extends the numerical comparison. See [validation](docs/validation.md) for measured
results and numerical tolerances.

## Code map

| File                           | Responsibility                                                       |
| ------------------------------ | -------------------------------------------------------------------- |
| `src/physics/thermo.ts`        | SI adapter, phase states, equilibrium `(mass, energy, volume)` flash |
| `src/physics/boiler.ts`        | fixed-volume initialization and phase-aware relief                   |
| `src/physics/heat.ts`          | fire, gas properties, radiation and heat exchange                    |
| `src/physics/flow.ts`          | equilibrium nozzle, superheater and hydraulic work                   |
| `src/physics/cylinder.ts`      | periodic cylinder, admission matching and algebraic slip             |
| `src/physics/motion.ts`        | train mass, Davis resistance, grade, braking                         |
| `src/physics/simulation.ts`    | pure previous-to-next tick and reconciled transfer ledger            |
| `src/physics/types.ts`         | state contracts and documented parameter estimates                   |
| `src/persistence.ts`           | versioned snapshot encoding and validation, without storage access   |
| `src/main.ts`, `src/canvas.ts` | browser scheduling, storage, controls and drawing                    |

The coordinator uses a shared old state and equal/opposite transfers. Only the
new state is returned. Bounded exact-property memoization stores up to 256
saturation endpoints; it does not retain simulation snapshots or interpolate.
Physics files have no DOM, timer, rendering or storage imports.

## Model and limits

Read the [agreed design](docs/design.md) and [equations and parameters](docs/model.md).
IF97 covers ordinary fluid water, including supercritical states; its loss of
accuracy near the critical point is accepted. Exact critical-point singularities,
unsupported states and failed solves reject the next step and show a paused
error modal, retaining the last valid state. There is no artificial mechanical
pressure ceiling within the supported IF97 domain.

Heat transfer, draft, firing, adhesion and resistance are engineering estimates.
The model omits boiler air, ash, material failure, detailed valve timing, real
condensation kinetics, finite condenser cooling capacity and gas-path pressure
dynamics. It is an educational equilibrium sandbox, not a locomotive design tool.

The About tab links [Wikipedia](https://en.wikipedia.org/wiki/DRG_Class_01),
[01 118 pictures](https://commons.wikimedia.org/wiki/Category:DRG_01_118), and the
[owner’s specifications](https://www.historische-eisenbahn-frankfurt.de/wp-content/uploads/2016/07/01118.pdf).
