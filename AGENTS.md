# Formatting and verification

From the repository root, always run the formatter and all verification commands before completing a change. Run them in this order:

```sh
npm run format
npm run format:check
npm run lint -- --deny-warnings
npm run typecheck
npm test
npm run test:convergence
npm run test:browser
```

Oxfmt applies and checks formatting, Oxlint checks for lint issues, and TypeScript checks both the application and the physics-only configuration. The test commands run the Node test suite, the numerical convergence checks, and the Playwright browser smoke test.

Before running any Node.js or npm command, run `nvm use` without a version argument from the repository root. This selects the version in `.nvmrc`. Run subsequent `node` and `npm` commands in the same shell so they use the selected version. If `nvm` is unavailable or `nvm use` fails, read `.nvmrc` manually and use the matching Node.js installation.

For the browser test, install Playwright Chromium with `npx playwright install chromium` or use an existing Chromium-based browser with `BROWSER_EXECUTABLE=/path/to/chromium npm run test:browser`.
