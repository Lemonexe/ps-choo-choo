# Vercel deployment from GitHub Actions

The workflow in `.github/workflows/deploy-vercel.yml` deploys the SPA to the
Vercel project's **production URL on every push to `master`**. It does not push
Git changes. No deployment happens until you configure the project and secrets
and push the workflow to that branch.

## One-time setup

1. Create or select a Vercel project under your account/team. Use the **Other**
   framework preset. The GitHub workflow builds the app; no Vercel server runtime
   or app environment variables are needed.
2. Create a [Vercel access token](https://vercel.com/account/tokens) with access
   to that project's account/team.
3. Link the local checkout using the Vercel CLI (`vercel login`, then
   `vercel link`). This links or creates a project without deploying the app.
   The resulting `.vercel/project.json` contains `orgId` and `projectId`.
   If you install the CLI locally, use your normal PMG-guarded npm workflow and
   check `which npm`/`which npx` first.
4. In GitHub repository **Settings → Secrets and variables → Actions**, add:

   | Secret              | Value                                   |
   | ------------------- | --------------------------------------- |
   | `VERCEL_TOKEN`      | Vercel access token                     |
   | `VERCEL_ORG_ID`     | `orgId` from `.vercel/project.json`     |
   | `VERCEL_PROJECT_ID` | `projectId` from `.vercel/project.json` |

   Repository secrets work directly. Alternatively, use secrets on a GitHub
   environment named `production`; allow deployments from `master` if you
   configure environment branch restrictions. No separate GitHub PAT is required.
   Put credentials in GitHub Secrets, not in source files or chat.

5. Push the workflow and app changes to `master`. The Actions run reports the
   deployment URL in its summary and deployment environment.

`vercel.json` disables Vercel's automatic Git deployments to avoid duplicate
deployments alongside GitHub Actions. CLI deployments remain enabled. Configure
custom domains separately in Vercel if desired; a custom domain is not required.

## What the workflow does

- Uses Node from `.nvmrc` and installs the locked npm dependencies.
- Checks formatting, lint, TypeScript, unit tests and timestep convergence.
- Pulls Vercel project settings, packages the SPA, and browser-tests that exact
  static output using Playwright.
- Uploads `.vercel/output` with `vercel deploy --prebuilt --prod`.

The CLI is installed only in CI; it is not an application runtime dependency.
The build runs on GitHub's Node version, and Vercel serves static files only.
Credentials are used by the CLI and are not included in the app output.

## Build locally without credentials

```sh
npm ci
npm run build:vercel
```

The standalone browser app is in `.vercel/output/static/`, with Build Output API
v3 routing in `.vercel/output/config.json`. This folder contains HTML, CSS, compiled
ESM JavaScript, the IF97 runtime modules and license notices. It excludes source
maps, declarations, tests, repository metadata and environment files. No bundler
or UI framework is introduced. Native ESM paths remain intact, including the
dependency's backward-equation imports.

Extensionless SPA URLs fall back to `index.html`; missing `.js` and other asset
URLs remain 404s. The packaged HTML uses a root base URL so its styles and import
map also work through the SPA fallback. Assets revalidate because filenames are
not content-hashed.

To smoke-test the packaged app locally:

```sh
npm run test:browser:static
# Or use an existing Chromium installation:
BROWSER_EXECUTABLE=/path/to/chromium npm run test:browser:static
```

Generated `.vercel/` files, including downloaded settings, remain Git-ignored.
Rebuilding replaces only `.vercel/output`, preserving project linkage.

To switch the workflow to **preview** deployment, change the GitHub environment
name to `preview`, change `vercel pull` to `--environment=preview`, and remove
`--prod` from the deploy command. The push trigger stays on `master`.

References: [Vercel CLI CI/CD](https://vercel.com/docs/cli/deploying-from-cli),
[Build Output API](https://vercel.com/docs/build-output-api),
[Git deployment configuration](https://vercel.com/docs/project-configuration/git-configuration).
