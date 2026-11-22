import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));

async function copyModules(source, destination) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name),
      to = join(destination, entry.name);
    if (entry.isDirectory()) await copyModules(from, to);
    else if (entry.isFile() && entry.name.endsWith(".js")) {
      await mkdir(dirname(to), { recursive: true });
      const code = (await readFile(from, "utf8")).replace(/^\/\/# sourceMappingURL=.*$/gm, "");
      await writeFile(to, code);
    }
  }
}

/** Package native browser ESM without a bundler or any server runtime. */
export async function buildVercel(output = join(projectRoot, ".vercel/output")) {
  const destination = resolve(output),
    site = join(destination, "static");
  await rm(destination, { recursive: true, force: true });
  await mkdir(site, { recursive: true });
  const html = await readFile(join(projectRoot, "index.html"), "utf8");
  // SPA fallback URLs must still resolve the import map and styles at the root.
  await writeFile(
    join(site, "index.html"),
    html.replace("<head>", '<head>\n    <base href="/" />'),
  );
  for (const file of ["styles.css", "LICENSE", "THIRD_PARTY_NOTICES.md"])
    await copyFile(join(projectRoot, file), join(site, file));
  await copyModules(join(projectRoot, "dist"), join(site, "dist"));
  const dependency = "node_modules/iapws-if97";
  await copyModules(join(projectRoot, dependency, "dist"), join(site, dependency, "dist"));
  await copyFile(join(projectRoot, dependency, "LICENSE"), join(site, dependency, "LICENSE"));
  await writeFile(
    join(destination, "config.json"),
    JSON.stringify(
      {
        version: 3,
        routes: [
          {
            src: "/(.*)",
            headers: {
              "Cache-Control": "public, max-age=0, must-revalidate",
              "X-Content-Type-Options": "nosniff",
            },
            continue: true,
          },
          { handle: "filesystem" },
          { src: "^/[^.]*$", dest: "/index.html" },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  return destination;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`Vercel static build → ${await buildVercel()}`);
}
