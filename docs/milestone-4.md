# Milestone 4 — Production readiness

The repository contains production hardening, retention, Docker/Railway configuration, a serialized release workflow, backup tooling, and expanded browser checks. Railway deployment and invited-player acceptance remain separate operational gates; passing local tests does not complete them.

## Railway setup

Create project `quadrant-towers` in US West, with one app service and PostgreSQL in the same region. Railway's current template uses PostgreSQL 18; local development and CI use PostgreSQL 17. Use matching PostgreSQL client tools for backups. Use a generated HTTPS domain. Keep PostgreSQL private; enable its public TCP proxy only temporarily when needed for a local backup, then disable it. Do not add an app TCP proxy. Disable app sleeping and keep exactly one replica.

Current budget constraint: remain on the free trial/free plan, with no paid upgrade or paid usage subscription. The account initially reported 30 trial days and $5 credits with no payment method. Do not enable paid billing when credits expire; availability is limited by the free allowance. Automatic deployment is enabled and gated on successful checks; its Railway-issued project token must be valid.

Set application variables:

| Variable              | Value                                              |
| --------------------- | -------------------------------------------------- |
| `DATABASE_URL`        | Reference PostgreSQL's private connection URL      |
| `NODE_ENV`            | `production`                                       |
| `HOST`                | `0.0.0.0`                                          |
| `PORT`                | Railway-assigned port                              |
| `ALLOWED_ORIGINS`     | Exact generated HTTPS origin, no trailing slash    |
| `TRUST_RAILWAY_PROXY` | `true` when exclusively behind Railway's HTTP edge |
| `RATE_LIMITS`         | `true`                                             |
| `LOG_LEVEL`           | `info`                                             |

Railway's HTTP edge supplies `X-Real-IP`; the app ignores `X-Forwarded-For`. Direct/local deployments ignore forwarded IPs unless explicitly configured. Verify the edge replaces a forged `X-Real-IP` before external testing. An arbitrary direct caller must never be able to reach a server trusting that header. See [Railway networking specifications](https://docs.railway.com/networking/public-networking/specs-and-limits).

The Dockerfile pins the repository's Node version, builds all packages, and runs as a non-root user. `railway.json` runs compiled migrations before deployment, probes `/health/ready`, and allows 15 seconds for shutdown. The application caps graceful draining at 10 seconds. Production requires explicit HTTPS origins and enabled rate limits. Local `pnpm local` serves built assets using `SERVE_STATIC=true` without enabling production HTTPS requirements.

Verify these settings on the Railway service itself. During initial provisioning, Railway detected the Dockerfile but did not apply the file's deploy settings. The pre-deploy migration, start command, readiness probe (120-second timeout), zero overlap, 15-second drain, five restart retries, and disabled sleeping were therefore also configured directly through the service API. Keep exactly one `sfo` region entry; adding an alias alongside it can request multiple regions and exceed the free plan's capabilities.

## GitHub releases

Repository: `WoodyPython/quadrant-towers`. Branch protection requires the `check` job on `main` and blocks force pushes and branch deletion; administrators retain bypass access. Add required review as the team grows. **Disable Railway GitHub autodeploy**: even a single-replica service normally overlaps old and new processes during replacement. Zero overlap seconds does not by itself prevent startup overlap.

Create a GitHub `production` environment. Add its secret `RAILWAY_TOKEN` using a Railway project/environment token, and variables `RAILWAY_SERVICE_ID`, `RAILWAY_ENVIRONMENT_ID`, and `PRODUCTION_ORIGIN`. Set repository variable `RAILWAY_DEPLOY_ENABLED=true` only after configuring them. Credentials never belong in the repo.

On pushes to `main`, CI completes all checks before running the serialized `deploy` job. It refuses pending/concurrent deployments, removes the old app deployment, waits for `REMOVED`, uploads the tested checkout, then verifies `/health/ready` and `/api/version` against the commit SHA. PostgreSQL stays running. The release writes `build-id.txt` into the upload so CLI releases preserve their commit identity. Do not set a stale `BUILD_ID` override on Railway.

Players see a temporary interruption covering build/startup time. Their transport reconnects automatically, reclaims the same seat, and synchronizes persisted state. A second tab taking control remains a distinct server disconnect. Uncertain commands retain their original UUID for safe retry. Offline time does not reset an accepted card offer; recovery resolves one overdue turn and gives the next player a fresh deadline.

If deployment fails after stopping the old app, inspect safe startup/recovery logs. Stop any partially running replacement before starting another image. Restore the previous tested source/image only when it supports the current migration history. Readiness intentionally rejects unknown migrations: a rollback across schema versions requires a compatible rollback build or isolated database recovery, not an unreviewed down migration. Never run two app versions simultaneously.

## Security and retention

HTTP and Socket.IO enforce bounded in-memory token buckets. Defaults per minute/burst: HTTP 600/120 per IP; handshakes and socket connections 60/20 per IP; commands 600/120 per IP and 120/30 per socket/player; room creation 10/5 per IP; join/rejoin 60/20 per IP. Each socket admits at most eight pending commands. Excess commands return `RATE_LIMITED` before persistence. Malformed/no-ack requests consume limits. Health probes remain available. Automated high-speed game fixtures explicitly disable rate limits only in test/development; production rejects that setting.

Secure headers cover HTTP and Socket.IO. CSP permits same-origin scripts/connections/workers, local images, and existing inline style values; framing, plugins, and foreign scripts are blocked. Production adds HSTS. HTML, API, health, and service-worker responses are not cached. The offline worker continues caching only its static fallback page.

An additive migration adds `rooms.inactive_since`, `matches.finished_at`, and `command_receipts.match_id`, backfilling durable timestamps and receipt associations. Cleanup runs after recovery and hourly, in batches of 100 rooms. It shares room queues and database row locks with gameplay.

- Lobbies expire after 24 hours with no connected players. Rejoining clears inactivity; active matches never expire as abandoned lobbies.
- Completed matches, their private snapshots, commands, and associated receipts expire after 30 days. Expiring historical matches preserves newer rematches and their seats.
- A room whose latest completed match expires is removed with its player identities. Connected clients receive `ROOM_NOT_FOUND` and clear their saved seat. Timers and in-memory room references are evicted.
- Backups have independent retention: deleting live records does not rewrite older backup archives.

## Monitoring and backups

Use Railway logs and CPU/memory/network metrics. Enable deployment/crash notifications and a usage/spending alert in the account. `/health/live` checks the process; `/health/ready` includes migrations and multiplayer recovery. Railway deployment health checks are not continuous uptime monitoring.

Logs include safe command identifiers, outcomes/durations, recovery failures, cleanup results, and hourly room/connection/timer counts. They exclude raw identities/tokens, snapshots, seeds, coordinates, and card offers. Investigate repeated recovery/cleanup failures, growing memory, unavailable readiness, and unexpected command rejection spikes. Do not export raw game payloads to analytics.

Before external testing, enable daily scheduled PostgreSQL volume backups. Before public launch, keep an encrypted logical dump off-platform. Use client tools matching the server's major version (PostgreSQL 18 for the current Railway template); build the repository first. Set `DATABASE_URL` privately in the shell, and choose an output location outside this OneDrive workspace:

```sh
node scripts/backup.mjs export /private/location/quadrant.dump
node scripts/backup.mjs restore-drill /private/location/quadrant.dump
```

Export refuses to overwrite a file and keeps credentials out of command arguments. Restore creates a uniquely named `quadrant_restore_*` database on the configured server, restores into it, validates migration history and every recoverable snapshot, and prints elapsed time. It never overwrites the source database. The database user needs CREATEDB for this drill. If restore fails, inspect and remove the disposable database before retrying.

Run an isolated app against the restored database with the same build/catalog. Rejoin all four saved test identities, confirm private views and offers, and complete the match. Record backup timestamp, restore duration, build SHA, match ID, and outcome without recording tokens. Drop the disposable database afterward. Rehearse quarterly and before launch. Volume restoration affects its original service; use an isolated rehearsal environment for a volume-level drill. See [Railway backup and restore procedures](https://docs.railway.com/guides/postgres-backups-restores).

## MCP connection and acceptance

Railway's official MCP can connect through `railway mcp` using `railway login` credentials. The CLI bridge is the fallback when direct OAuth metadata discovery at `https://mcp.railway.com` fails. Configure with `codex mcp add railway -- railway mcp`, then reload Codex. A cached CLI installation requires its absolute executable path. No credentials should be placed in Codex command arguments or committed configuration.

Local verification covers unit/integration checks, schema validation, production build/container smoke, full browser matches on every preset, accessibility checks, and browser process recovery. Production acceptance still requires:

1. Healthy Railway deployment of the exact checked commit, HTTPS, WebSocket play, and forged-header validation.
2. Four browsers retaining seats and private state through a controlled Railway release.
3. Scheduled backup enabled and a recorded restoration/rejoin/completion rehearsal.
4. Three consecutive matches completed by invited external players without a severity-1 defect or hidden-information leak.

Severity 1 means lost/corrupted accepted game state, an unavailable or unfinishable match, unauthorized seat control, or private-information exposure. Record dates, commit SHA, preset, match IDs, outcomes, and defects. Do not mark the milestone accepted until these external gates have evidence.

Local rehearsal evidence: a production Docker container booted without `.env`; readiness, build identity, secure headers, static assets, and WebSocket room creation passed. A PostgreSQL custom-format dump was restored into a separate local database, all four saved seats recovered identical private match views in 2.8 seconds, and the restored match completed at version 160 by the round limit. This verifies the local procedure, not Railway volume restoration or external-player acceptance.

Railway currently warns that `railway.json` remains supported until December 1, 2026; migrate it to Railway Infrastructure as Code before that date. Do not run configuration migration during an active match: preserve the stop-before-start release policy.

## Current provisioning record

- Railway project: `61833875-69f0-4b10-b481-8567e1168c3c` (`quadrant-towers`).
- Production environment: `dd8641fd-7696-4ad7-a474-f5641e0ba303`.
- App: `be1c7f35-36c6-41c1-a427-d8cae922a5ac`; PostgreSQL: `0e8b8b3a-c162-492d-8b56-2737c5bac149`.
- Live origin: `https://app-production-b10b2.up.railway.app`.
- GitHub production environment, variables, and `RAILWAY_TOKEN` secret are configured; `RAILWAY_DEPLOY_ENABLED=true`.
- Railway API returned `Not Authorized` for scoped project-token creation and daily backup scheduling. The owner supplied the CI token through GitHub and confirmed that scheduled backups require a paid upgrade. Scheduled backups remain disabled to respect the free-only budget; this acceptance gate is unmet. No paid upgrade was enabled.
- PostgreSQL has no public TCP proxy. The app uses its private database reference.

## Deployment evidence — September 15, 2026 (Pacific)

- Commit `0cc79c0ebf0373621d2b02774d5e08b52989c88f`: 119 unit tests, 22 integration tests, and 13 browser tests passed on GitHub's Linux runner. Formatting, lint, types, build, and schema checks passed. [GitHub workflow](https://github.com/WoodyPython/quadrant-towers/actions/runs/35053124660) completed both check and deployment jobs successfully after the owner supplied a Railway-issued project token.
- Live HTTPS readiness returned 200, `/api/version` reported the checked SHA, and secure headers and static assets were present. Four independent browser contexts created and joined a real WebSocket match.
- Controlled replacement: deployment `546f98c1-b32d-4498-8ebf-7dd065b3e8cd` reached `REMOVED` before replacement `975c70a0-778d-4b6b-a598-51e27451c47c` started. All four browsers automatically recovered unchanged seat identities, nondecreasing match versions, and schema-valid private projections without a page reload. Inactive players received no active player's card offer.
- A burst of 150 requests with distinct forged `X-Real-IP` and `X-Forwarded-For` values produced 122 successful responses and 28 rate-limit responses; varying those headers did not bypass the shared client limit. Readiness remained 200.
- The committed logical backup script exported and restored two local rooms into a disposable database and verified migration/snapshot integrity in 475 ms. The separate four-seat restoration/completion rehearsal is recorded above. Disposable local containers and databases were removed afterward.
- Remaining acceptance gates: automated Railway backups (owner confirmed a paid upgrade is required), Railway volume restoration rehearsal, and three consecutive invited-player matches. No paid upgrade was made, and the milestone is not yet accepted.
