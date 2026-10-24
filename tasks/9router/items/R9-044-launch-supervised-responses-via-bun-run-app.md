# R9-044 — Launch supervised Responses and 9Router endpoint via `bun run app` from source

- **Epic:** [R9-E08 — Offline verification, documentation and release readiness](../epics/R9-E08-verification-release.md)
- **Milestone:** Local Windows integration testing
- **Status and evidence:** See [manifest.json](../manifest.json)
- **Dependencies:** R9-005 (optional integration route), R9-006 (dedicated key), R9-042 (Windows guide)

## Detailed description

The upstream `bun run app` script starts Electron with `--dev-profile`. That intentionally
supervises only the isolated OpenAI MCP tunnel and never starts the Responses listener.
Consequently the new 9Router provider cannot be reached at port 17841, and attempts to use
the UI's Vite port 4178 return HTML instead of the `/models` API.

Make the regular source application command start the normal production-profile launcher,
using the already-implemented runtime supervisor to own the full Responses daemon and tunnel
without packaging an `.exe`. Keep the isolated development workflow available explicitly
and avoid adding a second 9Router server or modifying any existing native Responses routes.

## Implementation steps

1. Add an explicit profile choice to the existing source Electron/Vite launcher runner;
   production does not pass `--dev-profile`, whereas plain launcher development still does.
2. Make `scripts/start-launcher.ts`, used by `bun run app`, select the production choice.
3. Confirm production settings, connector and key are read from the normal profile, so a
   previously created `9router-key` works after the source launcher starts.
4. Test launcher argument selection, and the unchanged existing profile and runtime host.
5. Explain the Vite/UI versus Responses/API port distinction, the launcher ownership
   requirement and the isolated DEV alternative in the README and Windows guide.

## Acceptance criteria

- `bun run app` selects production-profile Electron from source, retaining Vite for its UI.
- The normal launcher still owns its Responses daemon at the configured port after Full
  harness setup; no separate terminal-managed daemon or packaged executable is required.
- `bun run launcher:dev` continues using a separate DEV profile and starts no Responses daemon.
- Original native Codex/ChatGPT Web code paths and tunnel supervision remain unchanged.
- Documentation warns not to run a packaged launcher against the same production home
  concurrently, and does not imply a successful live ChatGPT/MCP end-to-end test.

## Evidence and boundaries

Targeted Node regression: `launcher/tests/source-launch-profile.test.cjs`, plus
`profile.test.cjs`, `runtime-host.test.cjs`, `renderer-wiring.test.cjs`, and
`runtime-install.test.cjs`. The repository-side tests validate source/profile selection,
not an authenticated Windows tunnel session. That live test remains R9-043.

## Reference-first constraint

Inspect upstream source script, launcher DEV profile resolver and runtime supervisor first.
Reuse normal production supervision, minimizing merge conflict with upstream. Do not edit
upstream `miuuyy/codex-chatgpt-web` or unmodified `decolua/9router`.
