import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { serve } from "./serve.mjs";

const server = serve(0);
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
  await page.locator("#phase-label").waitFor();
  assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#clock").textContent(), "🕒 00:00");
  assert.equal(await page.locator("#run").getAttribute("aria-label"), "Resume simulation");
  assert.equal(await page.locator("#run span").textContent(), "▶");
  assert.equal(await page.locator("#run-state").count(), 0);
  await page.getByRole("tab", { name: "Management", exact: true }).click();
  await page.locator("[data-manage=fire]").click();
  await page.locator("[data-manage=boiler]").click();
  assert.match(await page.locator("#management-result").textContent(), /External change/);
  await page.getByRole("tab", { name: "Specifications", exact: true }).click();
  await page.locator("#condenser").check();
  await page.locator("#automaticStoker").check();
  await page.locator("#freight").fill("4");
  await page.locator("#freight").dispatchEvent("change");
  await page.getByRole("tab", { name: "Driving cab", exact: true }).click();
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
  assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#run").getAttribute("aria-label"), "Pause simulation");
  assert.equal(await page.locator("#run span").textContent(), "Ⅱ");
  await page.locator("#vent").hover();
  await page.mouse.down();
  assert.equal(await page.locator("#vent").evaluate((el) => el.classList.contains("held")), true);
  await page.mouse.up();
  assert.equal(await page.locator("#vent").evaluate((el) => el.classList.contains("held")), false);
  await page.getByRole("tab", { name: "Specifications", exact: true }).click();
  assert.equal(await page.locator("#condenser").isDisabled(), true);
  await page.getByRole("tab", { name: "Management", exact: true }).click();
  assert.equal(await page.locator("[data-manage=fire]").isDisabled(), true);
  await page.getByRole("tab", { name: "Driving cab", exact: true }).click();
  await page.locator("#run").click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ps-choo-choo.snapshot")),
  );
  assert.ok(saved.state.time > 0);
  assert.equal(saved.state.specs.condenser, true);
  await page.screenshot({ path: "/tmp/ps-choo-choo-desktop.png", fullPage: true });
  await page.reload();
  assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#throttle").inputValue(), "25");
  assert.equal(await page.locator("#automatic-firing").isVisible(), true);
  await page.locator("#run").click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "true");
  await page.evaluate(() => {
    delete document.hidden;
  });
  await page.getByRole("tab", { name: "About 01 118", exact: true }).click();
  assert.match(
    await page.locator('a[href*="commons.wikimedia.org"]').getAttribute("href"),
    /DRG_01_118/,
  );
  assert.match(
    await page.locator('a[href*="en.wikipedia.org"]').getAttribute("href"),
    /DRG_Class_01/,
  );
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
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
  await page.getByRole("tab", { name: "Driving cab", exact: true }).click();
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
  assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "true");
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
  assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "true");
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
  assert.equal(await playback.locator("#run").getAttribute("aria-pressed"), "false");
  await tick(25, "🕒 00:02"); // Turning on speed-up resumes a paused locomotive.
  await playback.locator('[data-speed="4"]').click();
  assert.equal(await playback.locator('[data-speed][aria-pressed="true"]').count(), 1);
  assert.equal(await playback.locator('[data-speed="2"]').getAttribute("aria-pressed"), "false");
  await tick(25, "🕒 00:04");
  await playback.locator('[data-speed="8"]').click();
  await tick(50, "🕒 00:12"); // The same 50 callbacks advance eight simulated seconds at 8×.
  await playback.locator('[data-speed="8"]').click();
  assert.equal(await playback.locator('[data-speed][aria-pressed="true"]').count(), 0);
  assert.equal(await playback.locator("#run").getAttribute("aria-pressed"), "false");
  await tick(50, "🕒 00:13"); // Disabling speed-up keeps a running simulation running.
  await playback.locator('[data-speed="4"]').click();
  await playback.locator("#run").click();
  await tick(50, "🕒 00:13");
  await playback.locator('[data-speed="4"]').click();
  assert.equal(await playback.locator('[data-speed][aria-pressed="true"]').count(), 0);
  assert.equal(await playback.locator("#run").getAttribute("aria-pressed"), "true");
  await tick(50, "🕒 00:13"); // Disabling speed-up does not unpause.
  await playback.locator('[data-speed="8"]').click();
  await tick(25, "🕒 00:17");
  await playback.locator("#run").click();
  await tick(50, "🕒 00:17");
  await playback.locator("#run").click();
  await tick(25, "🕒 00:21"); // Pause/resume preserves the selected speed.
  await playback.locator("#run").click();
  await playback.reload();
  assert.equal(await playback.locator("#run").getAttribute("aria-pressed"), "true");
  assert.equal(await playback.locator('[data-speed][aria-pressed="true"]').count(), 0);
  await playback.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  console.log(
    "Browser smoke passed: native ESM, playback speeds and toggle states, management, controls, hold-to-vent, configuration locks, persistence, hidden pause, reset, mobile layout, accelerated critical-error rollback, corrupt storage.",
  );
  console.log("Screenshots: /tmp/ps-choo-choo-desktop.png and /tmp/ps-choo-choo-mobile.png");
} finally {
  await browser?.close();
  server.close();
}
