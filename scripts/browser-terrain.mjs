import assert from "node:assert/strict";
import { initialState } from "../dist/physics/simulation.js";
import { terrainAt } from "../dist/physics/terrain.js";
import { encode } from "../dist/persistence.js";

export async function testTerrain(browser, base) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const start = initialState();
    start.distance = 8999.9;
    start.speed = 20;
    start.controls.brake = 0;
    await page.addInitScript((raw) => {
      if (!localStorage.getItem("ps-choo-choo.snapshot"))
        localStorage.setItem("ps-choo-choo.snapshot", raw);
      localStorage.setItem("ps-choo-choo.sound", JSON.stringify({ enabled: false, volume: 0.5 }));
      let seed = 0;
      crypto.getRandomValues = (array) => {
        array[0] = ++seed;
        return array;
      };
      const interval = window.setInterval.bind(window);
      window.setInterval = (callback, delay, ...args) => {
        if (delay === 20) {
          window.terrainTick = () => callback(...args);
          return 0;
        }
        return interval(callback, delay, ...args);
      };
      const text = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (label, ...args) {
        if (this.canvas.id === "schematic" && label === "FIREBOX")
          window.terrainLabelTransform = this.getTransform().toJSON();
        return text.call(this, label, ...args);
      };
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (this.canvas.id === "schematic") window.treePositions = [];
        return clear.apply(this, args);
      };
      const line = CanvasRenderingContext2D.prototype.moveTo;
      CanvasRenderingContext2D.prototype.moveTo = function (x, y) {
        if (
          this.canvas.id === "schematic" &&
          y === 493 &&
          ["#dbe2d6", "#cbd6c6"].includes(this.strokeStyle)
        )
          window.treePositions.push(x);
        if (this.canvas.id === "schematic" && x === -1100 && y === 493)
          window.terrainRailRendered = true;
        return line.call(this, x, y);
      };
    }, encode(start));
    const saved = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("ps-choo-choo.snapshot")).state);
    await page.goto(base);
    assert.equal(await page.locator("#track-distance").textContent(), "9.00 km");
    assert.equal(await page.locator("#track-altitude").textContent(), "250 m");
    assert.equal(await page.locator("#track-slope").textContent(), "0.0°");
    assert.equal(await page.locator("#slope").count(), 0);
    await page.waitForFunction(() => window.terrainRailRendered);
    const stationaryTrees = await page.evaluate(() => window.treePositions);
    assert.ok(stationaryTrees.length > 0);
    await page.waitForTimeout(75);
    assert.deepEqual(await page.evaluate(() => window.treePositions), stationaryTrees);
    await page.locator("#tab-specs").click();
    const mode = page.locator("#terrain-mode");
    assert.equal(await page.locator("#panel-specs #terrain-mode").count(), 1);
    assert.equal(await page.locator("#panel-management #terrain-mode").count(), 0);
    assert.match(await mode.getAttribute("title"), /Flat clears.*Generated.*distance and speed/);
    await mode.selectOption("generated");
    const generated = await saved();
    assert.equal(generated.terrain.generated, true);
    assert.equal(generated.terrain.seed, 1);
    assert.equal(generated.speed, start.speed);
    assert.equal(generated.distance, start.distance);
    assert.deepEqual(generated.boiler, start.boiler);
    assert.deepEqual(
      generated.terrain.blocks.map((b) => b.index),
      [0],
    );
    const point = terrainAt(generated.terrain, generated.distance);
    assert.equal(
      await page.locator("#track-altitude").textContent(),
      `${point.altitude.toFixed(0)} m`,
    );
    assert.equal(
      await page.locator("#track-slope").textContent(),
      `${((point.angle * 180) / Math.PI).toFixed(1)}°`,
    );
    await page.locator("#tab-cab").click();
    await page.waitForFunction(() => Math.abs(window.terrainLabelTransform?.b ?? 0) > 1e-5);
    const transform = await page.evaluate(() => window.terrainLabelTransform);
    const scale = await page
      .locator("#schematic")
      .evaluate((canvas) => ({ x: canvas.width / 1100, y: canvas.height / 570 }));
    assert.ok(
      Math.abs(Math.atan2(transform.b / scale.y, transform.a / scale.x) + point.angle) < 1e-9,
    );
    assert.equal(
      await page.locator(".track-readout").evaluate((el) => getComputedStyle(el).transform),
      "none",
    );
    await page.screenshot({ path: "/tmp/ps-choo-choo-terrain-desktop.png", fullPage: true });
    await page.locator("#run").click();
    assert.equal(await mode.isDisabled(), true);
    await mode.evaluate((el) => {
      el.value = "flat";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(await mode.inputValue(), "generated");
    await page.evaluate(() => {
      for (let i = 0; i < 20; i++) window.terrainTick();
    });
    await page.locator("#run").click();
    const moved = await saved();
    assert.ok(moved.distance > 9000);
    await page.waitForFunction(
      (previous) => JSON.stringify(window.treePositions) !== previous,
      JSON.stringify(stationaryTrees),
    );
    assert.deepEqual(
      moved.terrain.blocks.map((b) => b.index),
      [0, 1],
    );
    await page.locator("#tab-specs").click();
    await mode.selectOption("flat");
    const flat = await saved();
    assert.equal(flat.altitude, 250);
    assert.deepEqual(flat.terrain, { generated: false, seed: 0, blocks: [] });
    const { altitude: _altitude, terrain: _terrain, ...before } = moved;
    const { altitude: _newAltitude, terrain: _newTerrain, ...after } = flat;
    assert.deepEqual(after, before);
    await mode.selectOption("generated");
    const regenerated = await saved();
    assert.equal(regenerated.terrain.seed, 2);
    assert.equal(regenerated.distance, moved.distance);
    assert.equal(regenerated.speed, moved.speed);
    await page.reload();
    assert.equal(await page.locator("#panel-cab").isVisible(), true);
    assert.deepEqual(await saved(), regenerated);
    assert.equal(
      await page.locator("#track-altitude").textContent(),
      `${regenerated.altitude.toFixed(0)} m`,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const overlay = await page.locator(".track-readout").boundingBox();
    await page.locator(".schematic-viewport").evaluate((el) => {
      el.scrollLeft = 200;
    });
    assert.equal((await page.locator(".track-readout").boundingBox()).x, overlay.x);
    assert.ok((await page.locator("#schematic").boundingBox()).width >= 760);
    await page.screenshot({ path: "/tmp/ps-choo-choo-terrain-mobile.png", fullPage: true });
    assert.deepEqual(errors, []);
    console.log(
      "Terrain smoke passed: paused-only generation, seeded persistence, moving mode changes, block loading, tilted labels/rail, upright overlay and mobile scrolling.",
    );
  } finally {
    await context.close();
  }
}
