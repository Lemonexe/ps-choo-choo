import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { serve } from "./serve.mjs";
import { initialState } from "../dist/physics/simulation.js";
import { pt } from "../dist/physics/thermo.js";
import { DESIGN } from "../dist/physics/types.js";
import { encode } from "../dist/persistence.js";
import { fileURLToPath } from "node:url";

const server = serve(
  0,
  process.argv.includes("--static")
    ? fileURLToPath(new URL("../.vercel/output/static", import.meta.url))
    : undefined,
);
if (!server.listening) await once(server, "listening");
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  await page.addInitScript(() => {
    const pending = sessionStorage.getItem("test-pending-snapshot");
    if (pending) {
      localStorage.setItem("ps-choo-choo.snapshot", pending);
      sessionStorage.removeItem("test-pending-snapshot");
    }
  });
  const errors = [],
    missing = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("favicon.ico"))
      missing.push(response.url());
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  assert.equal(
    await page
      .getByRole("tab")
      .first()
      .textContent()
      .then((text) => text.trim()),
    "🏠 Intro",
  );
  assert.equal(await page.locator("#panel-start").isVisible(), true);
  assert.equal(await page.locator("#panel-cab").isVisible(), false);
  assert.match(await page.locator("#panel-start h1").textContent(), /A little coal/);
  assert.equal(
    await page.locator("#run").evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  assert.ok((await page.locator(".masthead").boundingBox()).height <= 72);
  await page.getByRole("tab", { name: "🏠 Intro", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.locator("#phase-label").waitFor();
  assert.equal(await page.locator("#panel-start").isVisible(), false);
  assert.equal(await page.locator("main > .stats").count(), 0);
  assert.equal(await page.locator("#stat-mass").count(), 0);
  assert.equal(await page.locator(".train-stats .stat").count(), 4);
  assert.equal(await page.locator(".train-stats #stat-speed").count(), 1);
  const primary = await page.locator(".train-stats").boundingBox();
  const diagram = await page.locator("#schematic").boundingBox();
  assert.ok(primary.y >= diagram.y + diagram.height);
  assert.equal(await page.locator(".flow-stats:not(.train-stats)").count(), 0);
  assert.equal(await page.locator("#flow-steam, #flow-coal, #flow-feed, #flow-mass").count(), 0);
  assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#clock").textContent(), "🕒 00:00");
  assert.equal(await page.locator("#run").getAttribute("aria-label"), "Resume simulation");
  assert.equal(await page.locator("#run span").textContent(), "▶");
  assert.equal(await page.locator("#run-state").count(), 0);
  await page.getByRole("tab", { name: "📈 Management", exact: true }).click();
  await page.locator("[data-manage=fire]").click();
  await page.locator("[data-manage=boiler]").click();
  assert.match(await page.locator("#management-result").textContent(), /External change/);
  await page.getByRole("tab", { name: "📝 Specifications", exact: true }).click();
  await page.locator("#condenser").check();
  await page.locator("#automaticStoker").check();
  await page.locator("#freight").fill("4");
  await page.locator("#freight").dispatchEvent("change");
  await page.getByRole("tab", { name: "🚂 DRIVING CAB", exact: true }).click();
  assert.equal(await page.locator("#automatic-firing").isVisible(), true);
  const slider = async (id, value) =>
    page.locator(`#${id}`).evaluate((el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  await slider("throttle", 25);
  await slider("brake", 0);
  await slider("stoker", 40);
  await page.locator("#run").click();
  await page.waitForFunction(() => document.getElementById("clock").textContent !== "🕒 00:00");
  assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#run").getAttribute("aria-label"), "Pause simulation");
  assert.equal(await page.locator("#run span").textContent(), "Ⅱ");
  await page.locator("#vent").hover();
  await page.mouse.down();
  assert.equal(await page.locator("#vent").evaluate((el) => el.classList.contains("held")), true);
  await page.mouse.up();
  assert.equal(await page.locator("#vent").evaluate((el) => el.classList.contains("held")), false);
  await page.getByRole("tab", { name: "📝 Specifications", exact: true }).click();
  assert.equal(await page.locator("#condenser").isDisabled(), true);
  await page.getByRole("tab", { name: "📈 Management", exact: true }).click();
  assert.equal(await page.locator("[data-manage=fire]").isDisabled(), true);
  await page.getByRole("tab", { name: "🚂 DRIVING CAB", exact: true }).click();
  await page.locator("#run").click();
  assert.equal(
    await page.locator("#run").evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ps-choo-choo.snapshot")),
  );
  assert.ok(saved.state.time > 0);
  assert.equal(saved.state.specs.condenser, true);
  await page.screenshot({ path: "/tmp/ps-choo-choo-desktop.png", fullPage: true });
  await page.reload();
  assert.equal(await page.locator("#panel-cab").isVisible(), true);
  assert.equal(await page.locator("#panel-start").isVisible(), false);
  assert.equal(await page.locator("#tab-cab").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#throttle").inputValue(), "25");
  assert.equal(await page.locator("#automatic-firing").isVisible(), true);
  await page.locator("#run").click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "false");
  await page.evaluate(() => {
    delete document.hidden;
  });
  await page.getByRole("tab", { name: "🎓 About DRG Class 01", exact: true }).click();
  assert.match(
    await page.locator('a[href*="commons.wikimedia.org"]').getAttribute("href"),
    /DRG_01_118/,
  );
  assert.match(
    await page.locator('a[href*="en.wikipedia.org"]').getAttribute("href"),
    /DRG_Class_01/,
  );
  await page.getByRole("tab", { name: "🔧 Settings", exact: true }).click();
  await page.screenshot({ path: "/tmp/ps-choo-choo-settings.png", fullPage: true });
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save snapshot", exact: true }).click();
  const download = await downloading;
  assert.equal(download.suggestedFilename(), "ps-choo-choo-snapshot.json");
  const snapshotPath = await download.path();
  const exported = JSON.parse(await readFile(snapshotPath, "utf8"));
  await page.locator('[data-speed="4"]').click();
  await page.locator("#reset").click();
  await page.locator("#reset-cancel").click();
  assert.equal(await page.locator("#throttle").inputValue(), "25");
  assert.equal(await page.locator('[data-speed="4"]').getAttribute("aria-pressed"), "true");
  await page.locator("#reset").click();
  await page.locator("#reset-confirm").click();
  assert.equal(await page.locator("#clock").textContent(), "🕒 00:00");
  assert.equal(await page.locator("#throttle").inputValue(), "0");
  assert.equal(await page.locator('[data-speed][aria-pressed="true"]').count(), 0);
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Load snapshot", exact: true }).click();
  await (await choosing).setFiles(snapshotPath);
  await page.locator("#toast").filter({ hasText: "Snapshot loaded" }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => JSON.parse(localStorage.getItem("ps-choo-choo.snapshot")).state),
    exported.state,
  );
  assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator('[data-speed][aria-pressed="true"]').count(), 0);
  await page.locator("#reset").click();
  await page.locator("#reset-confirm").click();
  await page.getByRole("tab", { name: "🚂 DRIVING CAB", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#toast").evaluate((el) => {
    el.hidden = true;
  });
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: "/tmp/ps-choo-choo-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  // A supported last state whose next heat input leaves the IF97 pressure domain.
  const retainedEnergy = await page.evaluate(async () => {
    const { initialState } = await import("/dist/physics/simulation.js");
    const { pt } = await import("/dist/physics/thermo.js");
    const { encode } = await import("/dist/persistence.js");
    const s = initialState(),
      a = pt(99.999e6, 650);
    const mass = 16 / a.v;
    s.boiler = { mass, energy: mass * a.u, metalEnergy: (2000 - 293.15) * 15e6 };
    s.specs.reliefPressure = 100e6;
    sessionStorage.setItem("test-pending-snapshot", encode(s));
    return s.boiler.energy;
  });
  await page.reload();
  await page.locator('[data-speed="8"]').click();
  await page.locator("#error-modal").waitFor();
  assert.equal(await page.locator("#error-modal").evaluate((el) => el.open), true);
  assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#clock").textContent(), "🕒 00:00");
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("ps-choo-choo.snapshot")).state.boiler.energy,
    ),
    retainedEnergy,
  );
  await page.locator("#error-close").click();
  await page.evaluate(() => sessionStorage.setItem("test-pending-snapshot", "{broken"));
  await page.reload();
  assert.equal(await page.locator("#error-modal").evaluate((el) => el.open), true);
  assert.match(await page.locator("#error-message").textContent(), /Could not restore/);
  assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "false");
  // Drive individual scheduling callbacks deterministically, avoiding wall-clock
  // timing assumptions while verifying real fixed-step physics at each speed.
  const playback = await browser.newPage();
  playback.on("pageerror", (error) => errors.push(error.message));
  await playback.addInitScript(() => {
    const interval = window.setInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => {
      if (delay === 20 && typeof callback === "function") {
        window.testSimulationTick = () => callback(...args);
        return 0;
      }
      return interval(callback, delay, ...args);
    };
  });
  await playback.goto(base);
  await playback.waitForFunction(() => typeof window.testSimulationTick === "function");
  const tick = async (count, expected) => {
    await playback.evaluate((count) => {
      for (let i = 0; i < count; i++) window.testSimulationTick();
    }, count);
    await playback.waitForFunction(
      (text) => document.getElementById("clock").textContent === text,
      expected,
    );
  };
  assert.equal(await playback.locator("#single-step").count(), 0);
  await playback.locator("#run").click();
  await tick(50, "🕒 00:01"); // 50 scheduling callbacks at 1× = one simulated second.
  await playback.locator("#run").click();
  await tick(50, "🕒 00:01");
  await playback.locator('[data-speed="2"]').click();
  assert.equal(await playback.locator('[data-speed="2"]').getAttribute("aria-pressed"), "true");
  assert.equal(await playback.locator("#run").getAttribute("aria-pressed"), "true");
  await tick(25, "🕒 00:02"); // Turning on speed-up resumes a paused locomotive.
  await playback.locator('[data-speed="4"]').click();
  assert.equal(await playback.locator('[data-speed][aria-pressed="true"]').count(), 1);
  assert.equal(await playback.locator('[data-speed="2"]').getAttribute("aria-pressed"), "false");
  await tick(25, "🕒 00:04");
  await playback.locator('[data-speed="8"]').click();
  await tick(50, "🕒 00:12"); // The same 50 callbacks advance eight simulated seconds at 8×.
  await playback.locator('[data-speed="8"]').click();
  assert.equal(await playback.locator('[data-speed][aria-pressed="true"]').count(), 0);
  assert.equal(await playback.locator("#run").getAttribute("aria-pressed"), "true");
  await tick(50, "🕒 00:13"); // Disabling speed-up keeps a running simulation running.
  await playback.locator('[data-speed="4"]').click();
  await playback.locator("#run").click();
  await tick(50, "🕒 00:13");
  await playback.locator('[data-speed="4"]').click();
  assert.equal(await playback.locator('[data-speed][aria-pressed="true"]').count(), 0);
  assert.equal(await playback.locator("#run").getAttribute("aria-pressed"), "false");
  await tick(50, "🕒 00:13"); // Disabling speed-up does not unpause.
  await playback.locator('[data-speed="8"]').click();
  await tick(25, "🕒 00:17");
  await playback.locator("#run").click();
  await tick(50, "🕒 00:17");
  await playback.locator("#run").click();
  await tick(25, "🕒 00:21"); // Pause/resume preserves the selected speed.
  await playback.locator("#run").click();
  await playback.reload();
  assert.equal(await playback.locator("#run").getAttribute("aria-pressed"), "false");
  assert.equal(await playback.locator('[data-speed][aria-pressed="true"]').count(), 0);
  await playback.close();
  // Opposite-direction inputs remain blocked in both directions, without toast
  // or modal. Neutral is still available while moving.
  for (const direction of [1, -1]) {
    const moving = initialState();
    moving.speed = direction * 5;
    moving.controls.reverser = direction * 0.6;
    const reverserPage = await browser.newPage();
    reverserPage.on("pageerror", (error) => errors.push(error.message));
    await reverserPage.addInitScript(
      (raw) => localStorage.setItem("ps-choo-choo.snapshot", raw),
      encode(moving),
    );
    await reverserPage.goto(base);
    await reverserPage.getByRole("tab", { name: "🚂 DRIVING CAB", exact: true }).click();
    const changeGear = (value) =>
      reverserPage.locator("#reverser").evaluate((input, value) => {
        input.value = String(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    await changeGear(-direction * 80);
    assert.equal(await reverserPage.locator("#reverser").inputValue(), String(direction * 60));
    assert.equal(await reverserPage.locator("#toast").isVisible(), false);
    assert.equal(await reverserPage.locator("#error-modal").evaluate((el) => el.open), false);
    await changeGear(0);
    assert.equal(await reverserPage.locator("#reverser").inputValue(), "0");
    await changeGear(-direction * 80);
    assert.equal(await reverserPage.locator("#reverser").inputValue(), "0");
    assert.equal(await reverserPage.locator("#toast").isVisible(), false);
    await reverserPage.close();
  }
  // Load the original schema to reproduce an existing overfilled save, without
  // resetting its boiler. Recover through the real held liquid-drain control.
  const overfilled = initialState(),
    water = pt(2e6, 470),
    mass = DESIGN.boilerVolume / water.v;
  overfilled.boiler = {
    mass,
    energy: mass * water.u,
    metalEnergy: (water.T - DESIGN.ambient) * DESIGN.boilerMetalCapacity,
  };
  overfilled.specs.reliefPressure = 3e6;
  overfilled.speed = 5;
  overfilled.controls.throttle = 0.2;
  overfilled.controls.brake = 0;
  const legacy = JSON.parse(JSON.stringify(overfilled));
  delete legacy.controls.blowdown;
  const recovery = await browser.newPage();
  recovery.on("pageerror", (error) => errors.push(error.message));
  await recovery.addInitScript(
    (raw) => {
      if (!sessionStorage.getItem("blowdown-fixture-loaded")) {
        localStorage.setItem("ps-choo-choo.snapshot", raw);
        sessionStorage.setItem("blowdown-fixture-loaded", "true");
      }
    },
    JSON.stringify({ version: 1, state: legacy }),
  );
  await recovery.goto(base);
  await recovery.getByRole("tab", { name: "🚂 DRIVING CAB", exact: true }).click();
  assert.equal(await recovery.locator("#error-modal").evaluate((el) => el.open), false);
  assert.equal(await recovery.locator("#phase-label").textContent(), "Liquid-filled boiler!");
  await recovery.locator("#run").click();
  await recovery.locator('[data-alert="liquid"]').waitFor();
  const drain = recovery.locator("#blowdown");
  await drain.hover();
  await recovery.mouse.down();
  assert.equal(await drain.getAttribute("aria-pressed"), "true");
  await recovery.locator('[data-alert="blowdown"]').waitFor();
  await recovery.locator('[data-alert="liquid"]').waitFor({ state: "detached" });
  await recovery.waitForFunction(
    () => parseFloat(document.getElementById("stat-power").textContent) > 0,
  );
  await recovery.mouse.up();
  assert.equal(await drain.getAttribute("aria-pressed"), "false");
  await recovery.locator("#run").click();
  const recovered = await recovery.evaluate(() =>
    JSON.parse(localStorage.getItem("ps-choo-choo.snapshot")),
  );
  assert.equal(recovered.version, 2);
  assert.ok(recovered.state.boiler.mass < overfilled.boiler.mass);
  assert.equal(recovered.state.controls.blowdown, false);
  await drain.focus();
  await recovery.keyboard.down("Space");
  assert.equal(await drain.getAttribute("aria-pressed"), "true");
  await recovery.keyboard.up("Space");
  assert.equal(await drain.getAttribute("aria-pressed"), "false");
  await recovery.keyboard.down("Enter");
  assert.equal(await drain.getAttribute("aria-pressed"), "true");
  await recovery.keyboard.up("Enter");
  assert.equal(await drain.getAttribute("aria-pressed"), "false");
  await drain.hover();
  await recovery.mouse.down();
  await drain.dispatchEvent("pointercancel");
  assert.equal(await drain.getAttribute("aria-pressed"), "false");
  await recovery.mouse.up();
  await drain.focus();
  await recovery.keyboard.down("Space");
  await recovery.locator("#tab-cab").focus();
  assert.equal(await drain.getAttribute("aria-pressed"), "false");
  await recovery.keyboard.up("Space");
  await drain.focus();
  await recovery.keyboard.down("Space");
  await recovery.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.equal(await drain.getAttribute("aria-pressed"), "false");
  await recovery.keyboard.up("Space");
  await recovery.locator("#run").click();
  await drain.focus();
  await recovery.keyboard.down("Space");
  await recovery.evaluate(() => document.getElementById("run").click());
  assert.equal(await recovery.locator("#run").getAttribute("aria-pressed"), "false");
  assert.equal(await drain.getAttribute("aria-pressed"), "false");
  await recovery.keyboard.up("Space");
  await recovery.locator("#run").click();
  await drain.focus();
  await recovery.keyboard.down("Enter");
  await recovery.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.hidden;
  });
  assert.equal(await recovery.locator("#run").getAttribute("aria-pressed"), "false");
  assert.equal(await drain.getAttribute("aria-pressed"), "false");
  await recovery.keyboard.up("Enter");
  await drain.focus();
  await recovery.keyboard.down("Space");
  await recovery.reload();
  await recovery.keyboard.up("Space");
  assert.equal(await recovery.locator("#blowdown").getAttribute("aria-pressed"), "false");
  assert.equal(await recovery.locator("#run").getAttribute("aria-pressed"), "false");
  await recovery.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  console.log(
    "Browser smoke passed: native ESM, playback speeds and toggle states, management, controls, hold-to-vent, liquid blowdown and overfill recovery, held-valve release, legacy-save migration, configuration locks, persistence, hidden pause, reset, mobile layout, accelerated critical-error rollback, corrupt storage.",
  );
  console.log("Screenshots: /tmp/ps-choo-choo-desktop.png and /tmp/ps-choo-choo-mobile.png");
} finally {
  await browser?.close();
  server.close();
}
