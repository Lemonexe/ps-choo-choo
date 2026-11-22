# Equations, assumptions and parameter provenance

All internal units are SI: Pa absolute, K, kg, J, W, m/s. The interface uses gauge
bar and Celsius. IF97's MPa/kJ conventions are confined to `thermo.ts`.

## Control-volume state

Boiler volume is fixed. Retain `m,U`; derive `v=V/m`, `u=U/m` and equilibrium state.

    dm/dt = Σṁin − Σṁout
    dU/dt = Q̇ + Σṁin hin − Σṁout hout

Two-phase mixture properties are mass-weighted endpoints, e.g.
`v=(1−x)vf+x vg`, `u=(1−x)uf+x ug`. The flash brackets the saturation interval
consistent with density, then solves its energy residual. Single-phase branches
use valid-region isochoric inversion, including Region 3's direct `(ρ,T)` equation.
Liquid volume fraction is `(1−x)vf/v`. The diagram uses volume fraction as its
simplified level indicator, not the exact height of a cylindrical barrel.

The normal outlet takes saturated vapor while liquid remains. Single-phase
outlets take bulk properties. Supercritical water has no liquid level or quality.
The displayed water/steam enthalpy is boiler `U+pV` plus tender enthalpy, with the
IF97 reference datum; it is not an additional conserved energy state.

Solid/refractory nodes use `U=C(T−Tamb)`. Tender water retains mass and atmospheric
enthalpy, so `dH/dt=Σṁh−Q̇loss`. This includes atmospheric displacement work and
allows hot condensate mixing. Cold makeup adds its own enthalpy.

## Fire and heat

    ṁburn = min(mcoal/Δt, ṁmax · bed · ignition · draft)
    bed = smoothstep(mcoal/160 kg)
    ignition = smoothstep((Tfire−620 K)/200 K)
    draft = clamp(0.22 + 0.13 ṁcylinder, 0.22, 1)
    ṁgas = 0.25 kg/s + 17 ṁburn
    Q̇chemical = ṁburn · 25.8 MJ/kg
    Q̇radiation = εσA(Tfire⁴−Tmetal⁴)

With a condenser, omit the exhaust term in draft. These are explicit toy empirical
laws, not first-principles combustion. Gas mass includes prescribed excess air;
air/combustion gas do not accumulate separately. Flue exhaust carries sensible
enthalpy relative to ambient; ambient air has zero sensible enthalpy in this datum.

Gas uses ideal density `p/(287T)`, Sutherland viscosity, `cp=1005+0.15(T−300)`
J/(kg K), and `k=0.0241(T/273.15)^0.85` W/(m K). Convective transport uses:

    Re = ṁ D/(Aflow μ), Pr=cp μ/k, h=Nu k/D
    f=(0.79 ln Re−1.64)⁻²
    Nu=(f/8)(Re−1000)Pr / [1+12.7√(f/8)(Pr^(2/3)−1)]

Laminar fully developed `Nu=3.66` below Re=2300; smooth transition to Gnielinski
by Re=4000. Typical gas conditions fall within its turbulent applicability range;
entrance effects and real combustion-gas composition are omitted. Gas exchanges
with superheater metal, then primary boiler metal, using
`Tout=Tgas−(Tgas−Tmetal)[1−exp(−hA/(ṁcp))]`. Heat is then the exact difference
in the integral of the chosen variable cp, `Q̇=ṁ[hgas(Tgas)−hgas(Tout)]`.
The outlet cannot cross the metal temperature, and chimney enthalpy matches
the energy removed from the fire minus the heat delivered to the exchangers.

Water-side `UA=Aheat[20+4980 wet][1−0.55 exp(−((T−Tc)/35)²)]` W/K, with
`wet=smoothstep(level/0.28)` or 0.55 for no phase interface. This finite effective
conductance explicitly does **not** model boiling crisis or supercritical
deterioration. `Q̇boiler=UA(Tmetal−Twater)`.

Superheater steam is quasi-steady; only metal stores energy. Steam-side exchange
uses the analogous effectiveness expression with UA=15 kW/K and bounded effective
cp; constrain outlet enthalpy to the metal-temperature state and available metal
energy. It may cool/condense steam while its metal is cold. Zero flow transfers
no heat to steam. Ambient losses use separate `K(T−Tamb)` terms.

## Valves and cylinders

An equilibrium isentropic nozzle evaluates `G(p)=sqrt[2(h0−h(p,s0))]/v(p,s0)`.
Scan pressure logarithmically, then refine the peak by bounded golden-section
search. The flux chokes below peak pressure. `ṁ=Cd A G`; throttle scales area.
The downstream mixed stream retains upstream stagnation enthalpy. This ideal
model omits geometry details and nonequilibrium flashing/condensation.

The regulator is upstream of the superheater. Match its flow to cylinder demand
by a bracketed admission-pressure solve, including superheater heat at that flow.
No pipe/chest steam inventory is retained.

Each representative double-acting cylinder cycle has clearance `Vc`, cutoff
volume `Va=Vc+cutoff Vs`, and maximum volume `Vb=Vc+Vs`. At periodic operation:

    ma(ha−hin) = mr(ur−hin) + pa Vc
    ma = Va/va, mr=Vc/vr

The exhaust residual has atmospheric pressure and the admission state's entropy,
because expansion and homogeneous adiabatic blowdown preserve specific entropy.
Solve admission enthalpy to satisfy this mixing-energy equation. Filling can make
the trapped charge hotter than the supply: flow work pressurizes the clearance.

    Wcycle = pa(Va−Vc) + ma(ua−ub) − pexhaust(Vrelease−Vc)
    mfresh = ma−mr
    hexhaust,mean = hin−Wcycle/mfresh

Closed expansion work is the internal-energy decrease, equivalent to ∫p dV.
If atmospheric pressure is reached before full stroke, use ideal early release;
the remaining connected-exhaust displacement has zero net gauge work. This
avoids an unmodelled vacuum/backfill cycle and is an idealization of valve timing.
Wet expansion is flagged; predominantly liquid supply inhibits cylinder admission.
Mechanical friction and wall condensation beyond equilibrium are omitted.

Cutoff is `0.05+0.70|reverser|`, with exact zero as neutral. Four working cycles
per revolution for two double-acting cylinders. `F=Wcycle·4/(πDwheel)` gives a
finite mean starting force. `ṁ=mfresh·4|vwheel|/(πDwheel)`; no steam is consumed
at exactly stationary, non-slipping quasi-static admission. This omits the brief
one-time filling of real stationary cylinders.

Adhesion is `μ mdrivers g`, μ=0.19 dry or 0.30 sanded. When rolling force exceeds
adhesion, solve the force equation for admission pressure, then derive slip speed
from supply/mass per cycle. This is algebraically equivalent to matching engine
force at an unknown wheel speed, without a nested speed solve. Lost power is
`F(vwheel−|vtrain|)`. No wheel inertia or wheel-speed history is retained.

## Feed pump, condenser and relief

Ideal hydraulic work per kg is `vfeed max(0,pboiler−patm)`. Add it to feedwater
enthalpy. A boiler bleed supplies this through ideal isentropic expansion to
atmosphere: `ṁaux=Ppump/(hbleed−hexhaust,s)`. Low pressure/water availability limit
feeding. The auxiliary does not require train motion. No stoker work is modelled.

The optional condenser rejects `Σṁhexhaust−Σṁ hf,atm`, returning saturated liquid
to the tender. Cooling capacity is unlimited; no vacuum or subcooling. At a full
tender the excess condensate leaves the system, with its mass and energy tracked.

Relief is an ideal pressure constraint, not a finite valve-capacity model. For
two-phase fluid it removes vapor carrying frozen old-state `hg`, consistent with
Euler stream evaluation. At the target pressure, fixed-volume equilibrium has
`U=A m+B`, where `A=uf−vf(ug−uf)/(vg−vf)` and `B=V(ug−uf)/(vg−vf)`.
Solve `Ufinal=Uinitial−(minitial−mfinal)hg` algebraically (or with a bracketed
single-phase fallback). Initially single-phase fluid uses homogeneous adiabatic
blowdown. Large instantaneous pressure-setting changes are approximate; ordinary
small per-tick relief corrections are the intended use. Manual release uses a
finite nozzle area and phase-aware outlet enthalpy.

Bottom **liquid blowdown** uses the same equilibrium nozzle with an estimated
0.001 m² area and Cd=0.78. Select saturated liquid in a two-phase boiler or bulk
compressed liquid in a liquid-full boiler. It cannot withdraw vapor or an undefined
supercritical liquid phase. Positive gauge pressure drives flow; gravity drainage
and reverse atmospheric inflow are omitted. Cap withdrawal by the available liquid
mass and reconcile its mass and energy with all other old-state withdrawals.
Subtract `ṁblowdown hliquid` from boiler energy and include it in external exports.
The water may flash downstream; discharged stagnation enthalpy remains the liquid
inlet enthalpy. Nothing returns to the tender, even with the condenser enabled.

## Motion, efficiency and energy diagnostics

    R = 1600+65|v|+5v²
        + Npassenger(140+8|v|+0.5v²)
        + Nfreight(240+12|v|+0.7v²)   [N, v in m/s]
    Fgrade = −M g dh/ds = −M g sin(trackAngle)
    Fbrake,max = 0.14 M g
    vnext = v + Δt(Fdrive+Fgrade−Fdrag−Fbrake)/M
    snext = s + v Δt; hnext = terrain(snext)

Static resistance/brakes hold at rest; stopping does not numerically reverse the
train. Reversal is interlocked at 0.05 m/s. Counter-steaming is not modelled;
admission is inhibited when moving against the selected direction. Reaction
thrust and translational kinetic energy carried by lost mass are neglected.

Estimated main-cycle efficiency is `(Wcylinder/mfresh−wpump)/(hin−hfeed−wpump)`,
where `wpump=vfeed max(0,pboiler−patm)`. The feedwater reference is the current
tender state. It includes ideal hydraulic work per kg of fresh main-cylinder
steam even when the live pump control is closed. Actual auxiliary bleed remains
in physical mass/energy accounting but is outside this ideal main-cycle reference.
It is not a ratio of transient boiler heat input and output; undefined/idle
conditions show no value. Slip, train resistance and auxiliary-drive efficiency
are excluded, so the statistic is not a complete plant efficiency.

Thermal/chemical transfer diagnostics include coal chemical energy, vessel/internal
energy, metal storage, atmospheric tender enthalpy, exhaust, condenser rejection,
ambient loss and indicated shaft work. Transfer residuals should be floating-point
roundoff. Mechanical kinetic/potential-energy error from explicit Euler is reported
separately rather than hidden by a correction. Timestep convergence bounds this.

## Parameter provenance

Management **Raise steam** adds 5 bar (500 kPa) to the current equilibrium
pressure per click, holding boiler mass and volume fixed. Recompute water energy
as `m u(p+500 kPa,V/m)` and preheat metal to at least the new water temperature.
This is an external heat addition; it does not change the relief setting, which
still applies on resuming. An increment outside the IF97 domain is rejected.

Documented 01 118 dimensions: 16 bar gauge, two 600×660 mm cylinders, 2 m drivers,
4.32 m² grate, 247.15 m² evaporative surface, 86.5 m² superheater, 111.3 t working
locomotive, 170.6 t full locomotive+tender, 34 m³ tender water, 10 t coal.
Source: [owner's specification](https://www.historische-eisenbahn-frankfurt.de/wp-content/uploads/2016/07/01118.pdf).
The tender water mass is rounded to 34,000 kg. LHV 25.8 MJ/kg is the IPCC default
for other bituminous coal; see the sources in `design.md`.

Explicit estimates, **not measured historical specifications**:

| Parameter                                                      | Value                     |
| -------------------------------------------------------------- | ------------------------- |
| Boiler volume / normal liquid volume fraction / tube threshold | 16 m³ / 65% / 28%         |
| Fire / boiler metal / superheater effective heat capacities    | 3 / 15 / 1.2 MJ/K         |
| Radiation area / effective emissivity                          | 20 m² / 0.75              |
| Adhesive mass / clearance fraction                             | 60 t / 6% of swept volume |
| Dry base mass, excluding retained water and coal               | 116.6 t                   |
| Passenger / loaded freight carriage masses                     | 45 / 80 t                 |
| Maximum burn / feed / stoker                                   | 1.2 / (250/60) / 2 kg/s   |
| Main / manual vent effective areas; discharge coefficient      | 0.003 / 0.0015 m²; 0.78   |
| Primary gas flow area / hydraulic diameter                     | 1.1 m² / 0.05 m           |
| Superheater gas flow area / hydraulic diameter                 | 0.55 m² / 0.08 m          |
| Ambient temperature                                            | 293.15 K                  |

Equations, source references and empirical coefficients are exposed in small pure
modules so alternatives can be tested without replacing the GUI.

The hold-to-release steam valve is a sandbox fitting, not a documented Class 01
valve. Its flow area is 0.0015 m² (five times the original estimate), equivalent
to a circular opening about 44 mm in diameter before the 0.78 discharge factor.
It uses the existing equilibrium nozzle model, so at a fixed inlet state its
mass flow is five times the old value. It does not change automatic relief,
liquid blowdown, or combustion draft. It is not a model of the locomotive's
auxiliary blower. Opening a finite vent need not reduce pressure immediately:
boiler heat input, feedwater and other steam withdrawals also affect pressure.

The pump is rated at approximately 250 L/min of cold water, represented as
250/60 kg/s at full control (1 kg/L density approximation). This replaces the
original unsupported 12 kg/s estimate (about 720 L/min). Historical Reichsbahn
maintenance instructions list a Knorr 250 L/min pump, including type code 33,
and a Knorr–Tolkien 250 L/min pump under code 38:
[DV 947/300, Appendix 17](https://printviewen.lokschuppen-wittenberge.de/content_leseecke_dv_fuer_unterhaltung_der_tfz_054).
A contemporary account also describes a Knorr main-line locomotive feed pump
at 250 L/min:
[Polytechnisches Journal, 1915](https://dingler.bbaw.de/articles/ar330048.html).
This is a period-equipment reference, **not verification of the exact pump fitted
to 01 118**. The ideal auxiliary drive and linear control law remain simplified.
At 1–2% control the old pump delivered 0.12–0.24 kg/s; such settings alone do not
prove incorrect sizing because required feed depends on load, steam withdrawal,
and changing equilibrium density/quality, rather than water level alone.

## Procedural locomotive audio

Sound is presentation only (`sound-model.ts` / `audio.ts`); it changes no physics,
steam inventory, or snapshot. The default is enabled at 50% volume. Independent
localStorage preferences survive reset and snapshot import. Browsers require a
user gesture to start Web Audio; device/autoplay failures show a retry option
in Settings without interrupting the simulation.

Four exhaust beats per driver revolution follow calculated rim speed, including
slip. Strength follows steam mass per beat and boiler pressure, not power alone;
cutoff broadens each beat. Unequal accents and filtered generated noise avoid
identical chuffs. Rolling rumble and rail-joint doublets depend only on train
speed. The rail-joint doublet uses a prominent synthesized resonant knock with
a brief bass impact, inharmonic steel-like ringing, and tight stereo reflections,
rather than a sustained drum-like bass tone or sharp noise click.
Its pair spacing narrows with speed (capped at 160 ms for a close doublet), while
repetition represents 12.5 m rail lengths. Speedup shortens envelopes and pair
timing without resampling the sound or raising its resonances. Brake screech requires movement and brake application; wheel-slip screech follows
lost slip power. Both drive the same distorted friction voice: inharmonic sawtooth
partials, narrow-band grit, irregular pitch jitter, slow wobble and fast amplitude
flutter. Their gains combine without switching to a whistle-like pure tone or a
smooth broadband hiss. Tonal frequencies do not scale with simulation playback. Firebox rumble/crackle, combined actual manual/automatic release
flow, and rougher liquid blowdown add distinct background layers. Condenser
configuration never selects a different sound profile (actual simulation flow
and load can still change when equipment configuration changes).

At 2/4/8×, event cadence increases and envelopes shorten; noise playback rates,
whistle harmonics, and filter pitch do not shift. Dense beats naturally overlap
into a roar. No media time-stretch library, sampled recordings, external assets,
or dependencies are used. The fixed nearby perspective has subtle stereo width,
short gain fades, and a master compressor to contain overlap. UI audio scheduling
uses browser audio time, independently of the fixed physics timestep.

The held steam whistle works even while paused: pressure controls loudness and
breathiness, capped at nominal boiler pressure, with fixed 440 Hz fundamental
and quiet harmonics. It consumes no steam and ignores simulation playback speed.
Pointer/key release, cancellation, lost focus, muting, and hiding release it.
Pausing silences simulation layers; hiding silences everything. This is a
stylized sound design, not an acoustic reconstruction of 01 118.

## Seeded railway terrain

Distance is signed track chainage in metres from zero, including negative positions;
it is not an odometer or a horizontal map coordinate. New/reset locomotives have
four 45 t passenger carriages and start on Flat at distance zero, altitude 250 m.
Old version-1/2 snapshots retain their inventories, velocity and consists, discard
the manual gradient, and migrate to this flat origin in version 3.

Inspired by [https://github.com/Lemonexe/Felda/blob/c6ce7797fa6a1bc127804415e4c97c58c20a82cb/app/leveldata.js#L51](Felda Simulátor),
the landscape sums independent random
zig-zag layers with globally indexed knots. Keep only 5000, 2000 and 1000 m
knot spacing, with derivative-bound shares 0.45, 0.35 and 0.20. For spacing L and
share w, the centered uniform knot-height range is L w sin(3.5°). Each layer's
linear derivative is bounded by w sin(3.5°), so their sum is bounded by sin(3.5°).
A 100 m box average rounds the zig-zag corners into quadratic vertical curves;
its derivative is `(hraw(s+50)−hraw(s−50))/100`. Integrate the raw linear segments
analytically to obtain height. This preserves a continuous height and gradient
without increasing the bound. Angle is `asin(dh/ds)` because s is along-track
length. No root solver, numerical quadrature, or interpolation table is needed.
Ordinary gradients are smaller; a near-extreme requires rare alignment of layers.

The rounded 3.5° ceiling follows the agreed 20% margin above the sanded reference
train's approximate holding limit. Full initial stores plus four passenger cars
weigh about 350.6 t. Sand adhesion is 176.5 kN; subtract 2.16 kN starting resistance
for a holding limit around 50.8‰, whose 1.2× margin is about 3.49°. It is a fixed
terrain-generation bound, not recalculated with the current load or steam state.
It is not a claim that 3.5° is a typical Class 01 main-line gradient, nor a promise
that the train can crest every long steep section at speed.

Pure `terrain.ts` holds bounded module state: 10 km blocks with seeded layer
knots and padding for the rounded ends. The current block is always present;
load neighbors within 1 km, retain them until more than 2 km away. At most three
blocks are retained. The seed hashes signed global knot indices, so seams match
in both height and gradient, visiting order is irrelevant, and revisiting a
forgotten block reproduces its exact terrain. Cache blocks and seed are included
in snapshots and validated against canonical seeded knots on restore. Supported
chainage is ±10¹² m, keeping the generator's coordinate arithmetic well defined.

Only paused terrain changes are permitted, including when velocity is nonzero.
Flat clears the seed/cache and sets altitude to 250 m. Generated draws a new seed
and recomputes height at the existing chainage. Both retain all other locomotive
state, including velocity/kinetic energy. Potential-energy jumps during these
terrain changes are deliberately ignored. In normal motion, gravity uses the
previous-position derivative, position advances by explicit Euler, and altitude
is sampled from the same height function at the new position. Treat the train as
one body at the locomotive's position; no separate carriage gradients are used.
Mechanical residual includes the previous-mass change in gravitational potential
energy as well as Euler kinetic error; variable-mass transport remains neglected.
Thermal/mass ledgers and the displayed water/steam enthalpy remain unchanged.

The full canvas, labels and rail rotate by the true track angle about wheel/rail
height. The horizontal rail before transformation spans beyond both canvas edges.
The HTML slope (degrees), distance (km), and altitude (m) readout remains upright
at the viewport's bottom left, even when the mobile schematic scrolls.
