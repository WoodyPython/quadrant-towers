# Milestone 0 implementation plan

Implement the foundation specified by `GAME_PLAN.md` with no gameplay or deployment.

1. Scaffold pnpm workspaces for React/Vite, Fastify, pure game engine, protocol, and shared configuration. Pin Node 24.21.0 and pnpm; commit the lockfile.
2. Add strict TypeScript, ESM, ESLint, Prettier, Vitest, Playwright, and GitHub Actions.
3. Add an accessible app shell and service connection feedback, development proxies, and production same-origin static serving with JSON API errors.
4. Add Compose PostgreSQL, Drizzle migrations, and only an application metadata table with a foundation-version record. Defer gameplay schema.
5. Validate environment variables, implement liveness/readiness/version endpoints, structured logging, safe errors, and graceful shutdown.
6. Provide a repeatable clean-checkout command that checks prerequisites, installs, configures, migrates, tests, builds, and boots. Preserve existing configuration and data.
7. Verify unit contracts, database migration repeatability and drift detection, production browser behavior, Windows startup, and Linux CI configuration.

Acceptance: `node scripts/local.mjs` installs, passes checks, builds, and boots with database readiness. Equivalent CI gates must pass. Docker/runtime limitations and checks not executed must be reported. No Railway deployment or four-player tests are claimed in this milestone.

## Verification — September 15, 2026

- Windows: the full bootstrap completed with Node 24.21.0, including frozen installation, static checks, migrations, production build, browser tests, and a healthy running application.
- Tests: 17 unit/API cases, one real PostgreSQL migration scenario, and three Chromium browser scenarios pass. Migration tests use an isolated disposable database and verify repeat application and drift detection.
- Linux: the CI command sequence passed in a fresh Node 24.21.0 Debian container, including dependency installation, browser installation, and production browser tests. The GitHub-hosted workflow itself has not run from this workspace.
- The machine's system Node remains 24.14.1. Verification used a checksum-verified Node 24.21.0 distribution under ignored `.cache/`; future bootstrap runs require the pinned runtime on PATH.
- Docker Desktop was started for verification. Windows browser downloads timed out through Playwright; the same official archives were fetched with PowerShell and installed in Playwright's cache. Linux's normal browser download succeeded.
