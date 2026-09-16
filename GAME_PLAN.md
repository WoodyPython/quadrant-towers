# Quadrant Towers — Finalized Game and Delivery Plan

**Status:** Approved implementation baseline for MVP  
**Last updated:** September 15, 2026  
**Target:** Desktop and tablet web browsers, with a usable mobile layout  
**Match:** Exactly 4 human players, with duration determined by the selected board size

This document is the source of truth for the first playable release. Rules in this document take precedence over earlier notes. Any later rule change should update this file and add an entry to the decision log.

## 1. Product Summary

Quadrant Towers is a four-player, turn-based strategy game played on a shared board split into four equal quadrants. The room host chooses one of four board-size presets. Each player secretly develops towers inside one quadrant while probing and attacking the other three through fog of war. Large towers score more, but their larger footprint makes them easier to discover and hit.

The MVP succeeds when four players can create or join a private room, complete a reliable match, reconnect after a refresh or brief disconnect, and receive an unambiguous final result.

## 2. Final MVP Rules

### 2.1 Board, size presets, and coordinates

- When creating a room, the host must select exactly one board-size preset. The selection is stored on the room and cannot be changed after creation.
- Each board is divided into four equal quadrants: northwest, northeast, southwest, and southeast.

| Preset | Each quadrant | Full board | Total cells | Match rounds | Expected duration |
|---|---:|---:|---:|---:|---:|
| **Small** | 6×6 | 12×12 | 144 | 10 | 20–30 min |
| **Medium** | 8×8 | 16×16 | 256 | 12 | 25–40 min |
| **Large** | 10×10 | 20×20 | 400 | 16 | 35–55 min |
| **Massive** | 14×14 | 28×28 | 784 | 22 | 50–75 min |

- Medium is the default selection in the create-room form.
- Each quadrant is assigned to exactly one player using a server-generated random shuffle when the match starts.
- Coordinates are zero-based in code: `x = 0..(boardWidth - 1)`, `y = 0..(boardHeight - 1)`. The UI displays letters for columns and one-based numbers for rows.
- Orthogonal adjacency means north, south, east, or west. Diagonal cells are never adjacent.
- A player may own structures only inside their assigned quadrant.

### 2.2 Match setup

1. A host chooses Small, Medium, Large, or Massive, creates a room, and receives a six-character room code.
2. The match starts when exactly four connected players are present and the host selects **Start game**.
3. The server randomly assigns quadrants and independently shuffles permanent turn order.
4. Each player receives one Town Hall on a uniformly random cell in their quadrant.
5. A Town Hall is a one-cell tower with 3 current health and otherwise follows normal tower rules.
6. Players begin with no other towers, upgrades, resources, cards, or active card effects.
7. The server records the random seed for replay/debugging, but never sends it to clients during an active match.

### 2.3 Match length and turns

- A match lasts the number of rounds assigned to its immutable board-size preset. A round ends after every non-eliminated player has taken one turn.
- The randomized turn order never changes. Eliminated players are skipped.
- On a turn, the player must:
  1. choose exactly one of the three privately offered Ability Cards and resolve any required selection;
  2. resolve exactly two actions, one at a time; and
  3. end the turn after the second valid action resolves.
- Action types may repeat. For example, Attack + Attack and Upgrade + Upgrade are legal.
- There is no resource currency and no passing.
- A player has 90 seconds for the whole turn. The timer continues through card selection and both actions.
- Invalid commands do not consume an action, but the timer continues.
- On timeout, the server chooses a random card from the player's saved offer if no card was selected, resolves any required targets using that card's deterministic legal-target fallback, then uses each remaining action to attack a random enemy cell. Offer generation must guarantee three currently selectable cards so a turn can always finish.
- A match also ends immediately when only one non-eliminated player remains.

### 2.4 Towers and health

- Every tower has a stable ID, an owner, a connected set of one or more cells, and one shared current-health value.
- All cells in one tower must remain orthogonally connected.
- Normal towers begin with 1 health. Town Halls begin with 3 health.
- Health can never exceed 10.
- Health is shared by the entire tower, not tracked per cell.
- Tower size does not increase health.
- Adjacent friendly towers remain separate. They never merge, even if their cells touch.
- A tower at 0 health is immediately destroyed. Every cell it occupied becomes empty.
- Destroyed cells remain revealed to players who had revealed them.
- A destroyed Town Hall receives no special exception and causes no immediate penalty beyond losing that tower.

### 2.5 The four actions

#### Build

- Select one empty cell inside your own quadrant.
- Create a new one-cell normal tower with 1 health.
- The new tower remains separate from all adjacent towers.
- Build is illegal on an occupied cell or outside the player's quadrant.

#### Upgrade

- Select one of your existing towers with fewer than 10 health.
- Add 1 current health, to a maximum of 10.
- Upgrade may restore health lost to attacks; there is no separate maximum-health stat.
- Stars are the UI representation of current health and do not affect score.

#### Expand

- Select one existing tower and one empty target cell.
- The target must be inside the player's quadrant and orthogonally adjacent to any cell already in that tower.
- Add the target cell to the selected tower. Health does not change.
- If the target also touches another friendly tower, the towers still remain separate.

#### Attack

- Select any cell in another player's quadrant. Attacking your own quadrant is illegal.
- The selected cell becomes permanently revealed to the attacker.
- If the cell is occupied at resolution time, its tower loses 1 health. Otherwise, the attack is a miss.
- A player may attack hidden cells, revealed cells, or the same cell repeatedly without penalty.
- If damage reduces the tower to 0 health, the entire tower is destroyed, including its unrevealed cells.
- Destruction reveals no additional cells. The attacker sees the destruction result, while other hidden parts of the former tower remain hidden.

### 2.6 Fog of war and information

The server produces a different view of the match for each player. A client is never sent hidden board contents.

- A player always sees the current contents of every cell in their own quadrant.
- All cells in enemy quadrants begin hidden.
- Attacking or resolving a card with a reveal effect reveals cells permanently to that player only.
- A revealed cell is **live visibility**, not a one-time snapshot. If an opponent later builds or expands onto it, the observing player sees the change.
- Revealing one cell of a multi-cell tower does not reveal its other cells.
- On a revealed occupied cell, the observer sees owner color, tower type (Town Hall or normal), and current shared health. Hidden footprint cells remain hidden.
- Every player sees whose turn it is, round number, turn timer, eliminations, and public action messages.
- Public action messages identify the acting player and action type, but do not expose hidden coordinates, hit/miss results, health, or tower identity to players who lack visibility.
- At match end, the entire board and final action history are revealed to all players.

### 2.7 Ability Card system

Ability Cards replace the fixed Tactic choices. The card framework is part of the MVP architecture, while the full card catalog and final balance values are a separate pre-release content task.

#### Offer and selection rules

- At the start of each player's turn, the server generates a private offer of exactly three distinct cards from the active, versioned card catalog.
- Because every active player has one scheduled turn in each round, this produces one card choice per active player per round.
- The player must choose exactly one offered card before taking either action. The other two are discarded.
- There are no rerolls in the MVP, and refreshing or reconnecting never changes an offer.
- Offers are generated with the match's deterministic server seed, persisted before being sent, and visible only to the offered player until match end.
- A player may receive the same card on later turns unless that card's definition has an explicit per-match limit.
- Offer generation filters out cards whose requirements cannot be satisfied in the current state. It must always retain configured neutral fallback cards so three legal choices are available.
- Choosing and resolving a card costs no action.

#### Rarity and progression

The initial rarity order is **Common → Uncommon → Rare → Epic → Legendary**. The registry may add new rarities later without changing match-state or network schemas.

- Every rarity has an integer `rank`, presentation metadata, and a configurable weight curve based on normalized match progress.
- Normalized progress is `(currentRound - 1) / (configuredRounds - 1)`, so progression behaves consistently across all four board sizes.
- For each offer slot, the server first rolls an eligible rarity from that progress curve, then selects an eligible card within that rarity using the card's offer weight and excluding cards already in the offer. If a tier has no eligible card, selection falls back through configured lower tiers and finally the neutral fallback pool.
- Early offers are weighted strongly toward lower ranks. Higher ranks unlock and gain weight as progress increases; Legendary cards appear only in the late game.
- Rarity changes the expected strength or flexibility of a card, not whether its rules may bypass server validation.
- Exact unlock thresholds and weights live in versioned balance configuration, not application code. They must be fixed before the balance-playtest milestone.
- Rarity is shown with a text label and icon as well as color.

#### Card lifecycles

- **Consumable:** resolves a one-time effect when selected or at its declared trigger, then is consumed. If it waits for a trigger, its definition specifies when it expires unused.
- **Passive:** registers one or more server-owned effects that react to game events. A passive declares its duration (`this_turn`, a number of owner turns or rounds, or `match`), charges if any, and stacking policy.
- A card may require targets. Its target schema, legal-target query, selection timing, and deterministic timeout fallback are part of its definition.
- Persistent effects are attached to stable player, tower, cell, or match IDs and are removed automatically on their declared expiry or when their target no longer exists.
- The UI derives card text and active-effect indicators from registry metadata, but only the game engine executes effects.

#### Extensibility contract

Each card definition includes at least:

```ts
interface AbilityCardDefinition {
  id: string;                    // stable machine ID
  version: number;               // immutable behavior version
  name: string;
  description: string;
  rarityId: string;              // references the rarity registry
  lifecycle: "consumable" | "passive";
  tags: string[];
  eligibility: EligibilityRule[];
  targets: TargetDefinition[];
  effects: EffectDefinition[];
  duration?: DurationDefinition;
  charges?: number;
  stacking: "replace" | "refresh" | "stack" | "unique";
  visibility: "public" | "owner_until_triggered";
  offerWeight: number;
  perMatchLimit?: number;
  artKey: string;
}
```

- Card data is registered in `packages/game-engine/src/cards/catalog`; rarity and progression data is registered beside it in versioned balance files.
- Effects use a typed effect/trigger registry such as `on_selected`, `before_attack`, `after_damage`, `on_build`, and `on_turn_start`. Adding a card composed of existing effects requires only a definition and tests. A genuinely new mechanic adds one engine effect handler, schemas, UI presentation support, and tests without changing the offer system.
- Match creation pins `cardCatalogVersion` and `balanceVersion`. Active matches therefore keep their original behavior across deployments.
- Card descriptions are generated from or validated against effect parameters to reduce UI/rules drift.
- Selected cards are public by default. A definition may mark a passive as hidden from opponents until it triggers; the server projection must omit the hidden effect entirely until then. All cards and effects are revealed when the match ends.
- The initial catalog must include enough legal fallback and varied cards to prevent duplicate offers, but its names and balance are intentionally not finalized in this plan.

### 2.8 Elimination

- A player is eliminated immediately when they own no towers after an action resolves.
- Losing the Town Hall alone does not eliminate a player.
- An eliminated player takes no more turns, cannot build back into the match, and may remain connected to observe only information they had already revealed.
- An eliminated player's final score is 0 and they cannot win when the configured final round is reached.
- If only one player remains, that player wins immediately even if another player would have had a higher provisional score.

### 2.9 Scoring and winner

Only towers that exist when the match ends score. Health and tower type do not add points.

| Tower size | Points |
|---:|---:|
| 1 cell | 1 |
| 2 cells | 2 |
| 3 cells | 5 |
| 4 cells | 8 |
| 5 cells | 10 |
| 6 cells | 12 |
| 7 cells | 14 |
| 8+ cells | `2 × size` |

At the end of the board preset's configured final round, the non-eliminated player with the highest sum of surviving-tower points wins. Ties are broken, in order, by:

1. most total current health across surviving towers;
2. surviving Town Hall;
3. fewest timed-out turns; and
4. earlier position in the original randomized turn order.

The result screen must show tower-by-tower scoring and each applied tie-breaker.

## 3. Player Experience

### 3.1 Required screens

1. **Home:** Create room with a required size selector, join by code, display-name entry, and rules link. Each size option shows quadrant dimensions, full-board dimensions, rounds, and expected duration.
2. **Lobby:** Four player slots, locked board-size summary, room code/copy button, host controls, connection state, and leave button.
3. **Game:** Responsive board, current player/round/timer, two-action tracker, three-card offer/selection panel, active passive-effects panel, selected-tower panel, event feed, and reconnect indicator.
4. **Results:** Winner, reason the game ended, full revealed board, score breakdown, tie-break details, and rematch/home buttons.
5. **Rules/help:** Concise rules matching this document and contextual action hints.

### 3.2 Board interaction

- Render the board with semantic HTML buttons and CSS Grid; use CSS/SVG for simple tower shapes, stars, passive-effect indicators, fog, and targeting states.
- Do not add a canvas/game engine for the MVP. Even the 784-cell Massive board is within practical DOM limits when cell components are memoized and updates are scoped, while DOM controls provide easier accessibility and testing.
- Small and Medium boards fit the primary play area. Large and Massive boards use a zoomable, pannable viewport with **Fit board**, **My quadrant**, keyboard pan, and reset controls; browser zoom is not the sole navigation mechanism.
- Selecting an action highlights only legal targets. The server still revalidates every choice.
- Distinguish quadrants with thick borders and player colors plus patterns/icons so color is never the only signal.
- Support mouse, touch, and keyboard operation. Every cell has an accessible label containing coordinate and visible state.
- Require confirmation for Attack only when a player clicks a target; do not add an extra modal that slows every action.
- Show responsive feedback for hit, miss, damage prevented, destruction, build, expand, upgrade, reveal, card selection, card resolution, and passive expiry.

### 3.3 Reconnection and absence

- Creating or joining a room gives the browser an opaque rejoin token stored in `localStorage`.
- Refreshing or reconnecting with that token restores the same player seat and filtered view.
- A disconnected player's turn timer continues. Timeout automation prevents a stalled match.
- A seat is not replaced mid-match in the MVP.
- Lobby seats are held for 2 minutes after disconnect, then may be removed by the host.

## 4. Technical Architecture

### 4.1 Final stack

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript with strict mode | One language and shared types across UI, protocol, and rules |
| Monorepo | pnpm workspaces | Lightweight workspace management and deterministic installs |
| Web UI | React + Vite | Fast iteration for a stateful single-page interface |
| Styling/graphics | CSS Modules, CSS Grid, inline SVG icons | Sufficient for simple graphics without a rendering engine |
| Client state | Zustand | Small store suited to socket-driven state and UI selections |
| HTTP server | Node.js LTS + Fastify | Typed, low-overhead endpoints and static asset serving |
| Realtime | Socket.IO | Rooms, acknowledgements, reconnection, WebSocket with polling fallback |
| Validation | Zod | Shared runtime validation at every network boundary |
| Database | PostgreSQL | Durable rooms, matches, snapshots, commands, and reconnect identities |
| Data access | Drizzle ORM + migrations | Typed SQL with explicit, reviewable migrations |
| Unit/integration tests | Vitest | Fast TypeScript tests for pure rules and server behavior |
| Browser tests | Playwright | Four-context multiplayer flows and accessibility checks |
| Logging | Pino structured JSON | Request, match, command, and error correlation |
| CI/CD | GitHub Actions + Railway GitHub deployment | Automated quality gates and deploys from `main` |

Pin exact dependency versions in `pnpm-lock.yaml`. Use the current supported Node.js LTS at project scaffolding time and pin it in `.nvmrc`, `package.json#engines`, CI, and Railway.

### 4.2 Repository layout

```text
/
├─ apps/
│  ├─ web/                 # React SPA
│  └─ server/              # Fastify, Socket.IO, persistence
├─ packages/
│  ├─ game-engine/         # Pure deterministic rules/state transitions
│  ├─ protocol/            # Zod schemas and shared event types
│  └─ config/              # Shared TypeScript/ESLint configuration
├─ tests/
│  └─ e2e/                 # Playwright multiplayer scenarios
├─ docs/                   # ADRs, diagrams, operations notes
├─ drizzle/                # Versioned database migrations
├─ GAME_PLAN.md
├─ package.json
└─ pnpm-workspace.yaml
```

### 4.3 Authority and state flow

The server is authoritative. The browser sends intent, never a mutated game state.

```text
Player input
  → Zod protocol validation
  → authentication and turn check
  → pure game-engine command validation
  → deterministic state transition
  → database transaction (command + new snapshot)
  → per-player fog-of-war projections
  → Socket.IO room broadcasts
```

- Serialize commands per match to prevent double-click and race-condition exploits.
- Give every command a client-generated idempotency key. Retried commands return the original result.
- Persist the accepted command and resulting snapshot in one database transaction before broadcasting.
- Keep hot matches in memory for speed, but restore them from the latest database snapshot after a restart.
- Store an append-only command log for debugging and deterministic replay.
- Run one application replica for the MVP. Horizontal scaling requires a shared Socket.IO adapter and distributed per-match locking and is intentionally deferred.

### 4.4 Core domain model

```ts
type MatchStatus = "lobby" | "active" | "finished" | "abandoned";
type ActionType = "build" | "upgrade" | "expand" | "attack";
type BoardPresetId = "small" | "medium" | "large" | "massive";

interface Cell { x: number; y: number }

interface BoardPreset {
  id: BoardPresetId;
  quadrantSize: 6 | 8 | 10 | 14;
  rounds: 10 | 12 | 16 | 22;
}

interface Tower {
  id: string;
  ownerId: string;
  kind: "town_hall" | "normal";
  cells: Cell[];
  health: number;
}

interface ActiveCardEffect {
  id: string;
  sourceCardId: string;
  sourceCardVersion: number;
  ownerId: string;
  targetRefs: string[];
  remainingDuration?: number;
  remainingCharges?: number;
  state: Record<string, unknown>;
}

interface PlayerState {
  id: string;
  quadrant: "nw" | "ne" | "sw" | "se";
  revealedCellKeys: string[];
  eliminated: boolean;
  timedOutTurns: number;
}

interface TurnState {
  round: number;
  activePlayerId: string;
  actionsRemaining: 0 | 1 | 2;
  offeredCardIds: [string, string, string];
  selectedCardId: string | null;
  deadlineAt: string;
}
```

The production model also stores board preset, board dimensions, configured final round, match version, original turn order, active card effects, pinned catalog/balance versions, winning result, random seed, and timestamps. Use branded IDs and canonical cell keys (`"x:y"`) in shared code.

### 4.5 Network contract

Use HTTP only for service/bootstrap operations:

- `GET /health/live` — process is running.
- `GET /health/ready` — database connectivity and migrations are ready.
- `GET /api/version` — deployed build identifier and protocol version.

Use acknowledged Socket.IO events for gameplay:

- Client → server: `room:create`, `room:join`, `room:leave`, `match:start`, `card:choose`, `card:target`, `action:submit`, `turn:sync`, `rematch:vote`.
- Server → client: `room:view`, `match:view`, `command:accepted`, `command:rejected`, `turn:timer`, `match:finished`, `server:error`.
- Every emitted match view contains `matchId`, monotonically increasing `version`, and only that recipient's authorized information.
- A player's three-card offer and any owner-only passive are included only in that player's projection; chosen public cards and triggered public effects are broadcast normally.
- A client discards older versions and requests `turn:sync` after reconnect or detecting a gap.
- Protocol errors return stable codes plus a safe player-facing message; never send stack traces.

### 4.6 Database tables

- `rooms`: code, status, host player, immutable board preset, created/expiry timestamps.
- `players`: room/match membership, display name, seat, hashed rejoin token, connection metadata.
- `matches`: status, seed, board preset/config, pinned card catalog and balance versions, turn order, round/turn state, version, result, timestamps.
- `match_snapshots`: match ID, version, complete private server state as JSONB, created timestamp.
- `match_commands`: match ID, version, actor, type, validated payload JSONB, idempotency key, created timestamp.

Keep only the latest snapshot plus command history during development. Before public launch, add a retention job: delete abandoned lobbies after 24 hours and completed match data after 30 days unless product requirements change.

## 5. Security, Fairness, and Reliability

- Generate room codes, seeds, IDs, and rejoin tokens with cryptographically secure server randomness.
- Store only a hash of each rejoin token. Treat possession of the raw token as seat authentication.
- Validate display names, room codes, event payloads, coordinates, ownership, turn identity, target legality, remaining actions, and match version on the server.
- Rate-limit room creation/join attempts and socket commands by IP, connection, and player.
- Cap display names at 24 normalized characters and escape all rendered text.
- Configure explicit allowed origins, secure headers, TLS-only production traffic, and secret environment variables.
- Never log raw rejoin tokens or complete private match snapshots.
- Include match ID, player ID, version, and command ID in structured logs.
- Expose no hidden cells in browser state, developer tools payloads, error messages, or public logs.
- Expose no private card offers or untriggered hidden passives to opponents, spectators, analytics payloads, or public logs.
- Use UTC timestamps on the server. The server deadline is authoritative; the client timer is visual only.
- Take scheduled database backups before public release and test restoration quarterly.

## 6. Hosting and Delivery

### 6.1 Final MVP hosting choice

Use **Railway** for one production project:

- **Application service:** one Node.js process runs Fastify and Socket.IO and serves the built React assets from the same origin.
- **Database service:** Railway PostgreSQL on the private project network.
- **Domain:** attach the production custom domain to the application service; Railway terminates TLS.
- **Region:** choose the Railway region closest to the initial player community and place application and database together.
- **Deploy:** connect the GitHub repository. Deploy `main` only after CI succeeds; use Railway's generated domain for staging until a separate staging environment is justified.
- **Health check:** `/health/ready`.
- **Start command:** run migrations as a release/deploy step, then start the compiled server bound to `0.0.0.0` and Railway's `PORT`.
- **Backups:** enable scheduled Postgres volume backups before inviting external testers; add an off-platform logical dump before public launch.
- **Scaling:** keep exactly one app replica for MVP because match command serialization is process-local. Add Redis-compatible pub/sub and distributed locks before multiple replicas.

This same-origin deployment avoids production CORS complexity and keeps initial operations small. Railway documents Socket.IO deployment, reconnection behavior, health checks, and long-lived WebSocket support; it also documents scheduled PostgreSQL volume backups and restore limitations. See [Railway's Socket.IO guide](https://docs.railway.com/guides/socketio) and [Postgres backup/restore guide](https://docs.railway.com/guides/postgres-backups-restores) (verified September 15, 2026).

Do not promise a fixed monthly cost in project documentation. Hosting prices and usage change; check Railway's current calculator immediately before launch and configure a spending alert/budget.

### 6.2 Environments

| Environment | Purpose | Data |
|---|---|---|
| Local | Feature development | Local PostgreSQL via Docker; seeded fixtures |
| CI | Unit, integration, and browser tests | Ephemeral PostgreSQL service |
| Production | Playable release | Railway app + Railway PostgreSQL |

Add staging when external playtests need a stable build separate from production. Until then, preview locally and keep the deployment surface minimal.

### 6.3 CI gates

Every pull request must pass:

1. frozen dependency install;
2. formatting check;
3. ESLint;
4. TypeScript typecheck;
5. unit and integration tests;
6. production build;
7. database migration validation; and
8. Playwright smoke test for a four-player match.

Production deploys run only from protected `main`. Migrations must be backward compatible with the currently running application whenever possible.

## 7. Testing Strategy

### 7.1 Game-engine unit tests

Use table-driven tests for every rule boundary:

- quadrant bounds and random assignment uniqueness;
- turn order and eliminated-player skipping;
- exactly two actions, including repeated types;
- build separation beside existing towers;
- expand adjacency, connectivity, collision, and boundary checks;
- upgrade health caps and card effects that modify health;
- shared tower damage from any occupied cell;
- card trigger order, duration, charges, stacking, target removal, and expiry;
- public versus owner-until-triggered card visibility and end-of-match reveal;
- all four preset dimensions, quadrant boundaries, and configured round limits;
- three-card offers are distinct, legal, persisted, private, and reproducible from a known seed;
- rarity unlock/weight curves use normalized progress correctly for every preset;
- consumable and passive card lifecycles, catalog version pinning, and neutral fallbacks;
- destruction and Town Hall behavior;
- per-player reveal state and live updates on revealed cells;
- no accidental footprint reveal on destruction;
- every scoring threshold and all tie-breakers;
- configured final-round and last-survivor endings;
- deterministic transitions from a known seed; and
- timeout automation always producing a legal completed turn.

### 7.2 Server integration tests

- Four players create/join, see the locked room size, start, receive unique quadrants, and get different filtered views.
- Room creation accepts only a known preset and every preset produces the documented dimensions and round count.
- Card offers and passive state survive refresh and simulated server restart without being redrawn or duplicated.
- Out-of-turn, stale-version, malformed, unauthorized, and duplicate commands are rejected safely.
- An accepted command and snapshot survive a simulated server restart.
- Refresh/reconnect restores the seat without revealing private state.
- Concurrent submissions for one action result in exactly one accepted command.
- Public event messages do not leak coordinates or outcomes.

### 7.3 Browser tests

Use four isolated Playwright browser contexts to cover:

- complete lobby-to-results happy path;
- keyboard-only build, upgrade, expand, attack, card selection, card targeting, and board navigation;
- create and finish at least one match on every board preset;
- card rarity labels, three-choice offers, active passives, and expiry feedback;
- fog-of-war differences between players;
- turn timeout and disconnect/reconnect;
- elimination without Town Hall special-casing;
- mobile viewport board navigation; and
- automated accessibility checks on all five screens.

## 8. Implementation Milestones

### Milestone 0 — Foundation

- Scaffold the pnpm monorepo, strict TypeScript, linting, formatting, Vitest, Playwright, and CI.
- Add local PostgreSQL, Drizzle migrations, environment validation, health endpoints, and structured logging.
- Exit criterion: clean checkout installs, tests, builds, and boots locally with one command.

### Milestone 1 — Deterministic game engine

- Implement preset-driven coordinates, quadrants, towers, actions, turns, elimination, scoring, and view projection as pure functions.
- Implement the versioned card/rarity registries, deterministic offer generator, typed effect/trigger system, consumable/passive lifecycle, and neutral fallback mechanism without coupling them to particular release-card content.
- Add exhaustive rule tests before networking or UI behavior depends on them.
- Exit criterion: all rules in section 2 have passing tests and no engine function depends on browser, sockets, database, or wall-clock globals.

### Milestone 2 — Multiplayer server

- Implement room lifecycle, rejoin identities, authoritative command handling, per-match queues, persistence, recovery, timers, and filtered Socket.IO broadcasts.
- Exit criterion: integration tests can run an entire four-player match, restart the server mid-match, and finish correctly.

### Milestone 3 — Playable UI

- Build home, size-aware lobby, scalable board viewport, action/card controls, card targeting, active-effect display, event feed, help, reconnect state, and results.
- Use simple CSS/SVG visuals with responsive and accessible interactions.
- Exit criterion: a four-person local playtest completes without database or developer-tool intervention.

### Milestone 4 — Production readiness

- Add rate limiting, secure headers, retention cleanup, backup procedure, observability, deployment configuration, and full Playwright flows.
- Deploy to Railway, test reconnect during a deploy, and perform a backup restoration rehearsal.
- Exit criterion: invited external players can finish three consecutive matches without a severity-1 defect or hidden-information leak.

### Milestone 5 — Balance playtest and release

- Define and version the initial release card catalog and rarity curves using the completed framework. Card-by-card design belongs to this content phase, not this architecture plan.
- Run at least 40 complete matches, including at least 10 on each preset, and record duration, timeout rate, action/card pick rates, rarity offer/selection rates, first-player win rate, Town Hall survival, eliminations, and final score spread.
- Tune only configuration values where possible. Record any rule change in this document and tests.
- Exit criterion: median duration for each preset stays near its documented range, every turn can produce three legal choices, no card or rarity is unintentionally dominant, and no turn-order position shows a persistent material advantage.

## 9. MVP Acceptance Criteria

The MVP is complete only when:

- Exactly four people can join a private room and start a match.
- The host can create a room with any of the four presets; its dimensions and round count remain correct and immutable through results/rematch.
- Every rule in section 2 is enforced by the server and represented accurately in the UI.
- Every turn presents three distinct legal cards, preserves the offer through reconnects, and correctly resolves consumable and passive effects.
- New cards composed from existing registered effects and new rarity configurations can be added without database or network-schema changes.
- Players never receive hidden board data they are not entitled to see.
- A refresh or temporary disconnect does not lose a player's seat or corrupt the match.
- A server restart can recover an active match from persisted state.
- A timed-out or disconnected player cannot stall the game indefinitely.
- Final scores, eliminations, and tie-breaks are correct and explained.
- The game works with mouse, touch, and keyboard at supported viewport sizes.
- CI is green, production health checks pass, backups are enabled, and the restore procedure has been tested.

## 10. Explicitly Out of Scope for MVP

- Public matchmaking, accounts, rankings, leaderboards, chat, friends, or moderation tools.
- Bots, fewer/more than four players, spectators with full-board vision, or seat replacement mid-match.
- Teams, asynchronous games, saved user progression, cosmetics, sound packs, or monetization.
- Native mobile apps, 3D graphics, WebGL/canvas engines, animations that affect rules timing, or procedural maps.
- Multiple application replicas, cross-region failover, Redis, or large-scale tournament support.
- Player-built decks, card collection/trading, saved card inventories, rerolls, resources, build costs, tower merging, territory capture, or diagonal expansion.

These may be considered only after the MVP metrics and player feedback justify them.

## 11. Product Metrics

Collect aggregate, non-sensitive events for:

- room creation-to-start conversion;
- match completion and abandonment rate;
- match and turn duration;
- timeouts and reconnects;
- board-preset selection, completion rate, and duration by preset;
- action and card selection rates, offer rates by card/rarity, and passive-effect usage;
- hit rate for hidden versus revealed cells;
- tower-size distribution, Town Hall survival, eliminations, score spread, and winner turn-order position; and
- client/server errors by build version.

Do not collect raw rejoin tokens, hidden board snapshots, or unnecessary personal information. Provide a short privacy notice before public release.

## 12. Decision Log

| Date | Decision |
|---|---|
| 2026-09-15 | MVP is exactly four human players; the host chooses Small (6×6 quadrants), Medium (8×8), Large (10×10), or Massive (14×14) when creating the room. |
| 2026-09-15 | Size presets use 10, 12, 16, and 22 rounds respectively; a match still ends early when only one player remains. |
| 2026-09-15 | Each turn privately offers three distinct randomized Ability Cards; the player must choose one before taking exactly two actions, and action types may repeat. |
| 2026-09-15 | Cards use extensible versioned rarity, definition, effect/trigger, consumable, and passive registries; release-card content is finalized during balance work. |
| 2026-09-15 | Enemy cells, once revealed, provide permanent live visibility to that observer. |
| 2026-09-15 | Losing all towers eliminates a player; losing only the Town Hall does not. |
| 2026-09-15 | The server is authoritative and persists every accepted command and resulting snapshot. |
| 2026-09-15 | Use React/Vite, a pure TypeScript engine, Fastify/Socket.IO, PostgreSQL/Drizzle, and same-origin Railway hosting. |
| 2026-09-15 | Use DOM/CSS/SVG graphics for MVP; do not introduce a canvas game engine. |
