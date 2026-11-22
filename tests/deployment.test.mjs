import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildVercel } from "../scripts/build-vercel.mjs";

test("Vercel output contains the self-contained SPA and runtime modules, with asset-safe fallback", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "ps-choo-choo-deployment-"));
  try {
    const output = join(temporary, "output");
    await buildVercel(output);
    const site = join(output, "static");
    assert.match(await readFile(join(site, "index.html"), "utf8"), /<base href="\/"/);
    assert.doesNotMatch(await readFile(join(site, "dist/main.js"), "utf8"), /sourceMappingURL/);
    for (const file of [
      "styles.css",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "dist/physics/thermo.js",
      "node_modules/iapws-if97/dist/index.js",
      "node_modules/iapws-if97/dist/backward/ph.js",
      "node_modules/iapws-if97/LICENSE",
    ])
      await access(join(site, file));
    const files = await readdir(site, { recursive: true });
    assert.equal(
      files.some((file) => /(?:^|\/)(?:src|tests|\.git|\.env)(?:\/|$)|\.(?:map|ts)$/.test(file)),
      false,
    );
    const config = JSON.parse(await readFile(join(output, "config.json"), "utf8"));
    assert.equal(config.version, 3);
    const fallback = config.routes.find((route) => route.dest === "/index.html");
    assert.ok(new RegExp(fallback.src).test("/getting-started/guide"));
    assert.equal(new RegExp(fallback.src).test("/dist/missing.js"), false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("rebuilding deployment output removes stale files but preserves Vercel project linkage", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "ps-choo-choo-deployment-"));
  try {
    const output = join(temporary, "output");
    await mkdir(join(output, "static"), { recursive: true });
    await writeFile(join(output, "static/stale.env"), "not-a-secret");
    await writeFile(join(temporary, "project.json"), '{"projectId":"example"}');
    await buildVercel(output);
    await assert.rejects(access(join(output, "static/stale.env")));
    assert.equal(
      await readFile(join(temporary, "project.json"), "utf8"),
      '{"projectId":"example"}',
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
