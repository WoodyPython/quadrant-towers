# Milestone 2 — Multiplayer server

The Fastify server now hosts Socket.IO and an authoritative PostgreSQL-backed room/match service. The engine remains pure; the browser remains the foundation shell until Milestone 3. Run one application replica.

## Local development and verification

Use the pinned Node version in `.nvmrc`, install with `corepack pnpm install --frozen-lockfile`, start PostgreSQL with `corepack pnpm db:up`, then run `corepack pnpm db:migrate`. Start with `corepack pnpm dev`; Vite proxies Socket.IO polling and WebSocket upgrades as well as the HTTP API. Production serves everything from one origin.

`ALLOWED_ORIGINS` is a comma-separated list of exact HTTP(S) origins, without trailing slashes or paths. Defaults cover localhost and 127.0.0.1 on ports 3000 and 5173. Set the deployed origin explicitly in production. Native clients without an Origin header are permitted and still require seat authentication. Socket payloads are capped at 16 KiB.

Run `corepack pnpm test:integration` for real PostgreSQL tests with four Socket.IO clients. Tests create randomly named disposable databases using a local/CI user with CREATEDB; they never reset the configured application database. An injected clock makes deadlines deterministic without shortening the production 90-second turn. Existing CI runs these tests alongside migration validation, unit tests, build, and browser smoke tests.

## Client contract

`@quadrant/protocol` exports Zod request/view/acknowledgement schemas and `ClientEvents` / `ServerEvents` for a typed Socket.IO client. Every request needs an acknowledgement callback. Acknowledgements are `{ ok: true, ... }` or `{ ok: false, code, message }`. Messages are safe for display; treat codes as the stable interface.

| Client event    | Payload and behavior                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `room:create`   | `{ displayName, preset }`; returns room and `{ playerId, token, code }` identity.                                 |
| `room:join`     | `{ displayName, code }`; joins an available lobby seat and returns identity.                                      |
| `room:rejoin`   | `{ code, token }`; restores the seat and returns the current room, authorized match view, metadata, and identity. |
| `room:leave`    | `{}`; removes a lobby seat or detaches an active/finished match connection.                                       |
| `room:remove`   | `{ playerId }`; host removes a disconnected lobby seat after two minutes.                                         |
| `match:start`   | `{ commandId }`; host starts with two to four connected players.                                                  |
| `card:choose`   | `{ commandId, matchId, expectedVersion, cardId, targets }`; selects and resolves the card atomically.             |
| `action:submit` | `{ commandId, matchId, expectedVersion, action }`; action is build, upgrade, expand, or attack.                   |
| `turn:end`      | `{ commandId, matchId, expectedVersion }`; explicitly ends a turn after both actions.                             |
| `turn:sync`     | `{}`; returns room, current private view, pinned card/rarity presentation metadata, and server time.              |
| `rematch:vote`  | `{ commandId, matchId }`; records one vote per original player for a finished match.                              |

Command IDs and match IDs are UUIDs. Use a fresh command ID for each new mutation; reuse the identical request when retrying an uncertain result. Versions are engine versions, increasing once per accepted engine command. Retry lookup precedes version/turn validation. Changing an accepted command's payload while reusing its ID returns `COMMAND_ID_REUSED`. Invalid requests are not accepted commands and do not reserve their IDs. A duplicate accepted command returns its original receipt, even after a restart or rematch; synchronize separately for the latest view.

Room creation and joining allocate identities and are not command-receipt operations. Save the returned token before proceeding; only token hashes are persisted by the server. The Milestone 3 browser will keep its token in localStorage and call `room:rejoin` whenever it establishes a new socket. A seat has one controlling socket: rejoining replaces the previous connection. The server derives the actor from this binding and rejects supplied actor fields.

Server events are `room:view`, `match:view`, `command:accepted`, `command:rejected`, `turn:timer`, `match:finished`, and `server:error`. Match views use `matchId`, not the engine projection's `id`. They contain only `projectMatch` output, validated against the shared schema. Only the active player receives their offer. Hidden cells have coordinates and visibility only. Ended matches reveal the board and full action history, but never the seed or RNG cursor.

Clients replace their state from complete views, discard older versions for the same match, and call `turn:sync` on reconnect, version gaps, stale-version errors, or a new match/catalog version. Content metadata is returned by sync/rejoin and contains presentation fields and target kinds, not executable effect handlers. Match IDs distinguish version zero of a rematch from earlier matches. Timer events carry an absolute deadline plus server time; clients render their own countdown. Sync and duplicate requests may re-emit the same version and finished view, so rendering should be idempotent.

## Room and rematch behavior

Display names use NFKC normalization and trimming and contain 1–24 Unicode code points; control/format characters are rejected. Room codes contain six uppercase letters, and join/rejoin accepts lowercase input. A room's preset never changes.

Disconnected lobby seats are reserved until the host explicitly removes them after the two-minute grace period. An explicitly departing host transfers ownership immediately to the earliest-joined connected player. A disconnected host transfers after the grace period. If nobody is connected, the next eligible reconnect takes ownership. Removing a seat invalidates its token. The last explicit lobby departure closes the room.

Active-match seats cannot be replaced. A disconnected player has one minute to rejoin before a durable server-side forfeit eliminates them; if that leaves one connected survivor, the match ends normally. Eliminated players can rejoin their original seat and see their authorized projection. If every active player remains away through the grace period, the room and all associated match data are deleted.

Votes survive restart. When all four original players have voted and are connected, the final vote or final reconnect creates exactly one fresh match. Seats and preset remain, votes reset, new cryptographic randomness determines setup, and currently configured catalog/balance versions are pinned. Previous match snapshots and command histories remain stored.

## Persistence and recovery

The additive migration introduces `rooms`, `players`, `matches`, `match_snapshots`, `match_commands`, and `command_receipts`. Room/seat data and rematch votes are separate from private engine snapshots. Each match retains one latest snapshot (snapshot schema version 1). The command log includes the initial `create_match` input at version zero, then every accepted engine command with its actor and injected timestamp, sufficient for deterministic replay. Tokens and snapshots are never logged.

Room queues serialize membership, start, presence, and rematch operations. Match commands also enter a per-match queue; timers use the encompassing room queue, so they cannot race gameplay or rematch creation. A PostgreSQL transaction locks the room, reloads authoritative data, checks the command receipt, applies the engine transition, and writes the command, snapshot, metadata, and receipt atomically. Uniqueness constraints protect seat allocation, command IDs, receipts, and match versions. In-memory copies are published only after commit; subsequent commands always reload durable state, including after an ambiguous commit response.

Startup checks migrations and validates every current snapshot, its metadata, and pinned content before becoming ready. All sockets start disconnected and every seat receives a fresh one-minute reconnect grace period when service returns, so deployment downtime cannot eliminate a player. Offers, RNG state, effects, and deadlines are restored, not regenerated. Unknown snapshot/content versions or invalid state keep readiness at 503 while liveness remains available; repair the data/deployment and restart. Preserve historical catalog and balance definitions across deployments.

An overdue turn is resolved once at recovery time. The next player receives a fresh 90 seconds, rather than losing multiple turns to downtime. Disconnected matches continue progressing. Timer callbacks reload current state, so stale callbacks cannot replay an old timeout. Failed timeout commits retry after one second and never publish speculative state. At the deadline, an incoming command first observes the committed timeout and normally receives `STALE_VERSION`.

Graceful shutdown rejects new work, cancels timers, drains queues, records disconnects where possible, then closes Socket.IO and the database. A crash needs no graceful hook for state recovery: accepted transitions were already persisted.

## Coverage and remaining milestones

Integration coverage includes full matches on every preset with restart and deterministic replay, explicit actions/end-turn, last-survivor results, eliminated-player rejoin, hidden passives across restart and trigger, command retries and lost commit/acknowledgement responses, concurrent joins/starts/actions, failed transactions, overdue recovery, obsolete timers, host transfer/removal, token replacement, durable rematches, malformed payloads, origin rejection, and invalid recovery data. Shared schema tests cover malformed and forged commands.

Playable UI and browser token storage remain Milestone 3. Rate limiting, secure headers, deployment/backup procedures, retention cleanup, and broader operational monitoring remain Milestone 4.
