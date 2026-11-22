import assert from "node:assert/strict";
import { encode } from "../dist/persistence.js";
import { initialState } from "../dist/physics/simulation.js";

/** Real Web Audio output and UI lifecycle; no golden-waveform comparisons. */
export async function testAudio(browser, base) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const Native = window.AudioContext;
      window.testAudioContexts = [];
      window.AudioContext = class extends Native {
        constructor(...args) {
          super(...args);
          this.meter = this.createAnalyser();
          this.meter.fftSize = 1024;
          window.testAudioContexts.push(this);
        }
        createDynamicsCompressor() {
          const node = super.createDynamicsCompressor();
          node.connect(this.meter);
          return node;
        }
      };
      window.audioRms = () => {
        const audio = window.testAudioContexts[0];
        if (!audio) return 0;
        const data = new Float32Array(audio.meter.fftSize);
        audio.meter.getFloatTimeDomainData(data);
        return Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length);
      };
    });
    await page.goto(base);
    assert.equal(await page.evaluate(() => window.testAudioContexts.length), 0);
    await page.locator("#tab-settings").click();
    assert.equal(
      await page.locator("#panel-settings > div").first().getAttribute("class"),
      "section-intro sound-settings",
    );
    assert.equal(await page.locator("#sound-enabled").isChecked(), true);
    assert.equal(await page.locator("#sound-volume").inputValue(), "50");
    await page.waitForFunction(() => window.testAudioContexts[0]?.state === "running");
    assert.equal(await page.locator("#sound-status").isVisible(), false);
    await page.locator("#tab-cab").click();
    const whistle = page.locator("#whistle");
    await whistle.hover();
    await page.mouse.down();
    assert.equal(await whistle.getAttribute("aria-pressed"), "true");
    await page.waitForTimeout(120);
    assert.ok(await page.evaluate(() => window.audioRms() < 1e-5), "No whistle pressure, no audio");
    await page.mouse.up();
    await page.locator("#tab-management").click();
    await page.locator('[data-manage="fire"]').click();
    await page.locator('[data-manage="boiler"]').click();
    await page.locator('[data-manage="boiler"]').click();
    await page.locator("#tab-cab").click();
    const before = await page.evaluate(() => localStorage.getItem("ps-choo-choo.snapshot"));
    await whistle.focus();
    await page.keyboard.down("Space");
    await page.waitForFunction(() => window.audioRms() > 0.001);
    assert.equal(await page.locator("#run").getAttribute("aria-pressed"), "false");
    assert.equal(await page.evaluate(() => localStorage.getItem("ps-choo-choo.snapshot")), before);
    await page.keyboard.up("Space");
    await page.waitForFunction(() => window.audioRms() < 1e-5);
    assert.equal(await whistle.getAttribute("aria-pressed"), "false");
    // Pointer cancel and window blur must never leave a whistle latched on.
    await whistle.hover();
    await page.mouse.down();
    await page.waitForFunction(() => window.audioRms() > 0.001);
    await whistle.dispatchEvent("pointercancel");
    await page.mouse.up();
    assert.equal(await whistle.getAttribute("aria-pressed"), "false");
    await whistle.focus();
    await page.keyboard.down("Enter");
    await page.waitForFunction(() => window.audioRms() > 0.001);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.keyboard.up("Enter");
    await page.waitForFunction(() => window.audioRms() < 1e-5);
    assert.equal(await whistle.getAttribute("aria-pressed"), "false");
    // Running fire makes sound, pause/mute/hidden silence the whole mix.
    await page.locator("#run").click();
    await page.waitForFunction(() => window.audioRms() > 0.0001);
    await page.locator("#run").click();
    await page.waitForFunction(() => window.audioRms() < 1e-5);
    await whistle.hover();
    await page.mouse.down();
    await page.waitForFunction(() => window.audioRms() > 0.001);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.mouse.up();
    await page.waitForFunction(() => window.audioRms() < 1e-5);
    assert.equal(await whistle.getAttribute("aria-pressed"), "false");
    await page.evaluate(() => {
      delete document.hidden;
    });
    await page.locator("#tab-settings").click();
    await page.locator("#sound-volume").fill("32");
    await page.locator("#sound-enabled").uncheck();
    await page.locator("#reset").click();
    await page.locator("#reset-confirm").click();
    assert.equal(await page.locator("#sound-volume").inputValue(), "32");
    assert.equal(await page.locator("#sound-enabled").isChecked(), false);
    await page.locator("#snapshot-file").setInputFiles({
      name: "state.json",
      mimeType: "application/json",
      buffer: Buffer.from(encode(initialState())),
    });
    await page.locator("#toast").filter({ hasText: "Snapshot loaded" }).waitFor();
    assert.equal(await page.locator("#sound-volume").inputValue(), "32");
    assert.equal(await page.locator("#sound-enabled").isChecked(), false);
    await page.reload();
    assert.equal(await page.evaluate(() => window.testAudioContexts.length), 0);
    assert.equal(await whistle.isDisabled(), true);
    await page.locator("#tab-settings").click();
    assert.equal(await page.locator("#sound-volume").inputValue(), "32");
    assert.equal(await page.locator("#sound-enabled").isChecked(), false);
    await page.locator("#sound-enabled").check();
    await page.waitForFunction(() => window.testAudioContexts[0]?.state === "running");
    await page.locator("#sound-volume").fill("0");
    assert.equal(await whistle.isDisabled(), true);
    await page.waitForFunction(() => window.audioRms() < 1e-5);
    assert.deepEqual(errors, []);
    // An unavailable browser audio device must not stop the physics/UI.
    const failure = await context.newPage();
    const failureErrors = [];
    failure.on("pageerror", (error) => failureErrors.push(error.message));
    await failure.addInitScript(() => {
      localStorage.removeItem("ps-choo-choo.sound");
      const Native = window.AudioContext;
      window.restoreAudio = () => {
        window.AudioContext = Native;
      };
      window.AudioContext = class {
        constructor() {
          throw new Error("Test audio unavailable");
        }
      };
    });
    await failure.goto(base);
    await failure.locator("#tab-settings").click();
    await failure.locator("#sound-status").filter({ hasText: "could not start" }).waitFor();
    assert.equal(await failure.locator("#error-modal").evaluate((el) => el.open), false);
    await failure.evaluate(() => window.restoreAudio());
    await failure.locator("#sound-retry").click();
    await failure.locator("#sound-status").waitFor({ state: "hidden" });
    assert.equal(await failure.locator("#sound-status").textContent(), "");
    assert.equal(await failure.locator("#sound-retry").isVisible(), false);
    assert.deepEqual(failureErrors, []);
    console.log(
      "Audio smoke passed: lazy initialization, real output, pressure-sensitive held whistle, pause/mute/hidden silence, release safety, preference persistence, snapshot/reset isolation, and failure/retry.",
    );
  } finally {
    await context.close();
  }
}
