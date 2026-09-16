# Quadrant Towers

Four-player strategy game. [GAME_PLAN.md](GAME_PLAN.md) defines the game. The deterministic engine, multiplayer server, and playable browser UI are implemented. See [Milestone 3](docs/milestone-3.md) for gameplay, reconnect behavior, and mobile installation. See [Milestone 1](docs/milestone-1.md) for the engine and [Milestone 2](docs/milestone-2.md) for the Socket.IO contract, authentication, persistence, and recovery behavior.

## Start from a clean checkout

Install **Node 24.21.0**, Corepack (included with the pinned official Node distribution), and Docker with Compose. Start Docker Desktop on Windows/macOS. Ports 3000, 3100, and 5432 must be free. The first run needs network access for packages, PostgreSQL, and Chromium.

```sh
node scripts/local.mjs
```

This installs locked dependencies, creates `.env` only if absent, starts PostgreSQL, migrates, installs Chromium, runs all checks, builds, and starts the production app at **http://127.0.0.1:3000**. It never overwrites existing configuration or deletes database volumes. Use Ctrl+C to stop the app, then `corepack pnpm db:down` to stop PostgreSQL while preserving data.

Linux browser dependencies may require a one-time `corepack pnpm exec playwright install --with-deps chromium`; the local script does not install operating-system packages.

## Development and checks

After setup, run `corepack pnpm dev`: Vite serves http://127.0.0.1:5173 and proxies `/api`, `/health`, and `/socket.io` (including WebSocket upgrades) to Fastify (default port 3000). Production serves the compiled SPA and API from one origin. Run `corepack pnpm db:migrate` after updating to apply the multiplayer tables.

| Command (prefix with `corepack pnpm`) | Purpose                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `format` / `format:check`             | Write/check formatting                                                                   |
| `lint` / `typecheck`                  | Static checks                                                                            |
| `test`                                | Unit and HTTP contract tests                                                             |
| `test:integration`                    | PostgreSQL migrations and four-client multiplayer/recovery tests in disposable databases |
| `build`                               | Compile shared packages, server, and web                                                 |
| `test:e2e`                            | Chromium against an isolated production server on port 3100                              |
| `db:up` / `db:down`                   | Start/stop local PostgreSQL                                                              |
| `db:generate` / `db:check`            | Generate/review migration history                                                        |
| `db:migrate`                          | Apply committed migrations explicitly                                                    |
| `start`                               | Start the compiled server using `.env`                                                   |

For standalone production startup, set `NODE_ENV=production` in the environment or `.env`, then run `corepack pnpm start`. The bootstrap sets this automatically. Rebuild shared packages after editing them during development.

## Configuration and operations

Copy `.env.example` to `.env` for manual setup. Server startup validates `DATABASE_URL`, `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`, `BUILD_ID`, and `ALLOWED_ORIGINS`. The latter is a comma-separated list of exact HTTP(S) origins; defaults cover local ports 3000 and 5173. Set the production origin explicitly. Existing process variables override `.env`. Never prefix secrets with `VITE_` or commit `.env`. Compose credentials are for local development only; its port binds to loopback.

- `/health/live` checks process liveness.
- `/health/ready` checks database access, committed migration hashes, the foundation metadata record, and completed multiplayer recovery. Failure returns 503 without database details.
- `/api/version` exposes the build identifier and protocol version.

Migrations are explicit and must run before readiness succeeds. Drizzle tracks applied SQL in its migration table; edit the TypeScript schema, generate a new migration, review and commit SQL plus metadata. Never edit already deployed migrations. The second migration adds rooms, identities, matches, latest snapshots, command history, and durable receipts.

Four-client integration tests complete matches on every preset and restart the server mid-match. Accepted commands commit before broadcast; saved offers, effects, and deadlines survive restart. One overdue turn is resolved at recovery time and the next receives 90 seconds. Unknown snapshot/content versions keep readiness unavailable until repaired and the process restarted. See [Milestone 2](docs/milestone-2.md) for client requests and recovery details. Open four separate browser profiles or devices to play; ordinary tabs share a player seat.

Integration and browser tests require a development/CI database user with `CREATEDB`; they create and drop only a randomly named test database. Use local or ephemeral CI PostgreSQL, never production credentials for tests. JSON logs carry generated request IDs, strip query strings, redact authentication headers, and omit private error details. SIGINT/SIGTERM closes Fastify and the connection pool.

If setup fails, check the reported command: start Docker Desktop for daemon errors, free occupied ports, install the pinned Node for version errors, and verify package/browser download access. A 503 readiness response usually means PostgreSQL is stopped or `db:migrate` has not run. Docker permission errors require access to the local Docker engine. Retry the bootstrap after correcting the cause.

## Delivery

GitHub Actions runs formatting, lint, types, tests, multiplayer integration/recovery tests, builds, migration validation, and browser checks on Linux. It uses an ephemeral PostgreSQL service and uploads browser failure artifacts. Milestone 4 adds Docker/Railway deployment, rate limiting, secure headers, retention, backup tooling, full matches on every preset, accessibility checks, and process-restart browser tests. Configure the serialized production deployment job using the [Milestone 4 runbook](docs/milestone-4.md). Railway deployment and external-player acceptance remain operational gates.
