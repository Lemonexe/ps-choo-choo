import { draw } from "./canvas.js";
import { decode, encode, loadSnapshot, STORAGE_KEY } from "./persistence.js";
import { cutoffPercent } from "./physics/cylinder.js";
import {
  addCoal,
  initialState,
  inspect,
  manage,
  step,
  validateState,
  type Management,
} from "./physics/simulation.js";
import { ATM } from "./physics/thermo.js";
import { DT, type Controls, type Specs } from "./physics/types.js";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing interface element: ${id}`);
  return found as T;
}
let state = initialState(),
  diagnostics = inspect(state),
  running = false,
  dirty = true;
let playbackSpeed = 1;
let lastSave = 0,
  toastTimer = 0;
const canvas = element<HTMLCanvasElement>("schematic");
const setText = (id: string, text: string): void => {
  const e = element(id);
  if (e.textContent !== text) e.textContent = text;
};
function toast(message: string): void {
  const e = element("toast");
  e.textContent = message;
  e.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    e.hidden = true;
  }, 4500);
}
function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, encode(state));
    setText("save-status", "Your data: Saved on this device");
  } catch {
    setText("save-status", "Your data: Storage unavailable · session only");
  }
  lastSave = performance.now();
}
function setRunning(value: boolean): void {
  running = value;
  if (!running) state = { ...state, controls: { ...state.controls, vent: false, blowdown: false } };
  const button = element<HTMLButtonElement>("run");
  const label = running ? "Pause simulation" : "Resume simulation";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.setAttribute("aria-pressed", String(running));
  button.innerHTML = `<span aria-hidden="true">${running ? "Ⅱ" : "▶"}</span>`;
  sync();
  dirty = true;
  if (!running) save();
}
function report(error: unknown): void {
  setRunning(false);
  setText("error-message", error instanceof Error ? error.message : String(error));
  const modal = element<HTMLDialogElement>("error-modal");
  if (!modal.open) modal.showModal();
}
function advance(): void {
  try {
    const next = step(state); // Assignment only after every next-state check succeeds.
    state = next.state;
    diagnostics = next.diagnostics;
    dirty = true;
  } catch (error) {
    report(error);
  }
}

function sync(): void {
  for (const id of ["throttle", "reverser", "stoker", "pump", "brake"] as const)
    element<HTMLInputElement>(id).value = String(Math.round(state.controls[id] * 100));
  for (const id of ["throttle", "stoker", "pump", "brake"] as const)
    setText(`${id}-value`, `${Math.round(state.controls[id] * 100)}%`);
  const reverse = state.controls.reverser;
  setText(
    "reverser-value",
    reverse === 0
      ? "Neutral"
      : `${reverse > 0 ? "Fwd" : "Rev"} ${Math.round(Math.abs(reverse) * 100)}%`,
  );
  setText(
    "cutoff-label",
    `Admission cutoff ${(cutoffPercent(reverse) * 100).toFixed(0)}% of stroke`,
  );
  element<HTMLInputElement>("sand").checked = state.controls.sand;
  for (const id of ["vent", "blowdown"] as const) {
    element(id).classList.toggle("held", state.controls[id]);
    element(id).setAttribute("aria-pressed", String(state.controls[id]));
  }
  element("automatic-firing").hidden = !state.specs.automaticStoker;
  element("manual-firing").hidden = state.specs.automaticStoker;
  for (const id of ["condenser", "automaticStoker"] as const) {
    const input = element<HTMLInputElement>(id);
    input.checked = state.specs[id];
    input.disabled = running;
  }
  for (const id of ["passenger", "freight", "slope", "reliefPressure"] as const) {
    const input = element<HTMLInputElement>(id);
    input.value = String(
      id === "reliefPressure" ? Math.round((state.specs[id] - ATM) / 1e4) / 10 : state.specs[id],
    );
    input.disabled =
      running || ((id === "passenger" || id === "freight") && Math.abs(state.speed) > 0.05);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-manage]"))
    button.disabled = running;
  element("management-lock").hidden = !running;
  element("specs-lock").hidden = !running;
  element<HTMLButtonElement>("coal-charge").disabled = state.bunker <= 0 || state.fire.coal >= 600;
}

function render(): void {
  if (!dirty) return;
  dirty = false;
  const seconds = Math.floor(state.time + 1e-9);
  setText(
    "clock",
    `🕒 ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`,
  );
  element("stat-speed").innerHTML =
    `${(Math.abs(state.speed) * 3.6).toFixed(1)} <small>km/h</small>`;
  setText(
    "stat-direction",
    Math.abs(state.speed) < 0.01
      ? "At standstill"
      : state.speed > 0
        ? "Travelling forward"
        : "Travelling backward",
  );
  element("stat-power").innerHTML = `${(diagnostics.power / 1000).toFixed(0)} <small>kW</small>`;
  setText("stat-traction", `${(diagnostics.tractionPower / 1000).toFixed(0)} kW at the rail`);
  element("stat-efficiency").innerHTML =
    diagnostics.efficiency === null
      ? "—"
      : `${(diagnostics.efficiency * 100).toFixed(1)} <small>%</small>`;
  element("stat-enthalpy").innerHTML =
    `${(diagnostics.enthalpy / 1e9).toFixed(2)} <small>GJ</small>`;
  setText("flow-steam", `${diagnostics.steamRate.toFixed(2)} kg/s`);
  setText("flow-coal", `${diagnostics.burnRate.toFixed(2)} kg/s`);
  setText("flow-feed", `${diagnostics.feedRate.toFixed(2)} kg/s`);
  setText("flow-mass", `${(diagnostics.trainMass / 1000).toFixed(1)} t`);
  setText(
    "phase-label",
    diagnostics.boiler.phase === "two-phase"
      ? "Equilibrium water + steam"
      : diagnostics.boiler.phase === "supercritical"
        ? "Supercritical fluid · no water level"
        : diagnostics.boiler.phase === "liquid"
          ? "Liquid-filled boiler"
          : "Vapor-only boiler",
  );
  const alertKey = diagnostics.alerts.map((a) => a.id).join(",");
  const alerts = element("alerts");
  if (alerts.dataset.key !== alertKey) {
    alerts.dataset.key = alertKey;
    alerts.replaceChildren();
    for (const a of diagnostics.alerts.length
      ? diagnostics.alerts
      : [{ id: "clear", text: "No operating alerts.", severity: "info" }]) {
      const item = document.createElement("div");
      item.className = `alert ${a.severity}`;
      item.textContent = a.text;
      item.dataset.alert = a.id;
      alerts.append(item);
    }
  }
  setText(
    "alert-count",
    diagnostics.alerts.length ? `${diagnostics.alerts.length} ACTIVE` : "ALL CLEAR",
  );
  if (!element("panel-cab").hidden) draw(canvas, state, diagnostics);
}

const tabs = [...document.querySelectorAll<HTMLButtonElement>("[role=tab]")];
function tab(button: HTMLButtonElement): void {
  for (const current of tabs) {
    const selected = current === button;
    current.setAttribute("aria-selected", String(selected));
    current.tabIndex = selected ? 0 : -1;
    element(current.getAttribute("aria-controls")!).hidden = !selected;
  }
  dirty = true;
  render();
}
tabs.forEach((button, i) => {
  button.tabIndex = i === 0 ? 0 : -1;
  button.addEventListener("click", () => tab(button));
  button.addEventListener("keydown", (e) => {
    let next: number;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i + tabs.length - 1) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    const target = tabs[next]!;
    tab(target);
    target.focus();
  });
});

for (const id of ["throttle", "reverser", "stoker", "pump", "brake"] as const) {
  element<HTMLInputElement>(id).addEventListener("input", () => {
    const value = Number(element<HTMLInputElement>(id).value) / 100;
    if (
      id === "reverser" &&
      value !== 0 &&
      Math.abs(state.speed) > 0.05 &&
      Math.sign(value) !== Math.sign(state.speed)
    ) {
      sync();
      return;
    }
    const controls: Controls = { ...state.controls, [id]: value };
    state = { ...state, controls };
    sync();
    dirty = true;
    save();
  });
}
element<HTMLInputElement>("sand").addEventListener("change", () => {
  state = {
    ...state,
    controls: { ...state.controls, sand: element<HTMLInputElement>("sand").checked },
  };
  dirty = true;
  save();
});
element("coal-charge").addEventListener("click", () => {
  state = addCoal(state);
  sync();
  dirty = true;
  save();
});

function holdValve(id: "vent" | "blowdown", value: boolean): void {
  state = { ...state, controls: { ...state.controls, [id]: value } };
  element(id).classList.toggle("held", value);
  element(id).setAttribute("aria-pressed", String(value));
  dirty = true;
}
for (const id of ["vent", "blowdown"] as const) {
  const button = element<HTMLButtonElement>(id);
  button.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    button.setPointerCapture(e.pointerId);
    holdValve(id, true);
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"] as const)
    button.addEventListener(event, () => holdValve(id, false));
  button.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      holdValve(id, true);
    }
  });
  button.addEventListener("keyup", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      holdValve(id, false);
    }
  });
  button.addEventListener("blur", () => holdValve(id, false));
}
function releaseValves(): void {
  holdValve("vent", false);
  holdValve("blowdown", false);
}
window.addEventListener("blur", () => {
  releaseValves();
  save();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) setRunning(false);
});
window.addEventListener("pagehide", () => {
  releaseValves();
  save();
});

for (const id of [
  "condenser",
  "automaticStoker",
  "passenger",
  "freight",
  "slope",
  "reliefPressure",
] as const) {
  element<HTMLInputElement>(id).addEventListener("change", () => {
    if (running || ((id === "passenger" || id === "freight") && Math.abs(state.speed) > 0.05)) {
      sync();
      return;
    }
    const input = element<HTMLInputElement>(id);
    if (!input.checkValidity() || input.value.trim() === "") {
      toast("Enter a value within the displayed range.");
      sync();
      return;
    }
    const value =
      id === "condenser" || id === "automaticStoker"
        ? input.checked
        : id === "reliefPressure"
          ? Number(input.value) * 1e5 + ATM
          : Number(input.value);
    const specs: Specs = { ...state.specs, [id]: value };
    const next = { ...state, specs };
    try {
      validateState(next);
      state = next;
      diagnostics = inspect(state);
      sync();
      dirty = true;
      save();
    } catch (error) {
      sync();
      toast(error instanceof Error ? error.message : String(error));
    }
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-manage]")) {
  button.addEventListener("click", () => {
    if (running) return;
    try {
      const next = manage(state, button.dataset.manage as Management);
      state = next.state;
      diagnostics = inspect(state);
      setText(
        "management-result",
        `External change: ${next.mass >= 0 ? "+" : ""}${next.mass.toFixed(1)} kg; ${next.energy >= 0 ? "+" : ""}${(next.energy / 1e6).toFixed(1)} MJ. Ready when you are.`,
      );
      sync();
      dirty = true;
      save();
    } catch (error) {
      report(error);
    }
  });
}
element("run").addEventListener("click", () => {
  if (!element<HTMLDialogElement>("error-modal").open) setRunning(!running);
});
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-speed]")];
function setPlaybackSpeed(speed: number): void {
  playbackSpeed = speed;
  for (const button of speedButtons)
    button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === playbackSpeed));
}
for (const button of speedButtons) {
  button.addEventListener("click", () => {
    if (element<HTMLDialogElement>("error-modal").open) return;
    const speed = Number(button.dataset.speed);
    const enabling = playbackSpeed !== speed;
    setPlaybackSpeed(enabling ? speed : 1);
    if (enabling) setRunning(true);
  });
}
element("error-close").addEventListener("click", () =>
  element<HTMLDialogElement>("error-modal").close(),
);
element("save-snapshot").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([encode(state, true)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "ps-choo-choo-snapshot.json";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});
const snapshotFile = element<HTMLInputElement>("snapshot-file");
const loadButton = element<HTMLButtonElement>("load-snapshot");
loadButton.addEventListener("click", () => {
  setRunning(false);
  snapshotFile.value = "";
  snapshotFile.click();
});
snapshotFile.addEventListener("change", async () => {
  const file = snapshotFile.files?.[0];
  if (!file) return;
  setRunning(false);
  loadButton.disabled = true;
  snapshotFile.disabled = true;
  try {
    const loaded = loadSnapshot(await file.text());
    const loadedDiagnostics = inspect(loaded);
    state = loaded;
    diagnostics = loadedDiagnostics;
    setPlaybackSpeed(1);
    setRunning(false);
    render();
    toast("Snapshot loaded. The simulation is paused.");
  } catch (error) {
    report(
      new Error(
        `Could not load snapshot: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  } finally {
    snapshotFile.value = "";
    snapshotFile.disabled = false;
    loadButton.disabled = false;
  }
});
element("reset").addEventListener("click", () => {
  setRunning(false);
  element<HTMLDialogElement>("reset-modal").showModal();
});
element("reset-cancel").addEventListener("click", () =>
  element<HTMLDialogElement>("reset-modal").close(),
);
element("reset-confirm").addEventListener("click", () => {
  setPlaybackSpeed(1);
  state = initialState();
  diagnostics = inspect(state);
  setRunning(false);
  element<HTMLDialogElement>("reset-modal").close();
  dirty = true;
  sync();
  save();
  render();
  toast("A fresh locomotive is ready.");
});

try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    state = decode(raw);
    diagnostics = inspect(state);
    setText("save-status", "Your data: Restored from saved · paused");
  }
} catch (error) {
  setText("save-status", "Your data: Saved snapshot unavailable");
  setText(
    "error-message",
    `Could not restore the saved snapshot. A fresh paused locomotive is available. ${error instanceof Error ? error.message : ""}`,
  );
  element<HTMLDialogElement>("error-modal").showModal();
}
sync();
setInterval(() => {
  if (!running || document.hidden) return;
  // Always integrate at DT; stop the batch immediately on a failed step/pause.
  for (let i = 0; i < playbackSpeed && running; i++) advance();
  if (performance.now() - lastSave > 1000) save();
}, DT * 1000);
function frame(): void {
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
new ResizeObserver(() => {
  dirty = true;
}).observe(canvas);
