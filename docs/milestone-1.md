# Milestone 1 — Deterministic game engine

Implemented in `packages/game-engine`, with no runtime dependencies. The engine imports no browser, socket, database, clock, or operating-system services. Existing ESLint restrictions enforce those boundaries. The server and browser remain the Milestone 0 shell.

## API and integration contract

```ts
import {
  applyCommand,
  createMatch,
  defaultRegistry,
  legalTargets,
  projectMatch,
} from '@quadrant/game-engine';

const state = createMatch(
  {
    id: 'match-1',
    playerIds: ['alice', 'bob', 'charlie', 'dana'],
    preset: 'medium',
    seed: 12345,
    now: 0,
    cardCatalogVersion: 'framework-1',
    balanceVersion: 'framework-1',
  },
  defaultRegistry,
);
const actorId = state.turn.playerId;
const offeredCard = defaultRegistry.catalogs[
  state.cardCatalogVersion
]!.cards.find((card) => card.id === state.turn.cardOffer[0])!;
const result = applyCommand(
  state,
  actorId,
  {
    type: 'select_card',
    cardId: offeredCard.id,
    targets: Object.fromEntries(
      offeredCard.targets.map((target) => [
        target.id,
        legalTargets(state, actorId, target)[0]!,
      ]),
    ),
  },
  1,
  defaultRegistry,
);
// This example chooses the first legal target; the future UI asks the player.
if (result.ok) {
  const privateView = projectMatch(result.state, actorId);
  // Persist result.state before sending privateView in the multiplayer milestone.
}
```

- `createMatch` requires four distinct player IDs, an explicit preset, a uint32 seed, an injected integer timestamp in milliseconds, and registered content versions. It independently shuffles quadrants and turn order, places one 3-health Town Hall per player, and saves the first offer.
- `applyCommand` returns a new serializable state on success. Failure returns the original state, with no changes to history, randomness, action count, or timer. Times must be nondecreasing. Ordinary commands are accepted strictly before the deadline.
- Actions require card selection first. Two valid actions are followed by explicit `end_turn`. Types may repeat. Last-survivor victory interrupts the turn immediately.
- Only the server calls `applyCommand(state, null, { type: 'timeout' }, now, registry)`, at or after the saved deadline. It resolves one saved offer using the seeded generator and deterministic legal targets, performs remaining random enemy-cell attacks, and advances the turn. A late timeout starts the next 90-second turn at the supplied timestamp.
- `projectMatch` is the only client-safe representation. It omits the seed, RNG cursor, hidden cells, hidden footprints, other players' offers and unrevealed effects. Public history contains actor/action and public card metadata; detailed action results are private to the actor until match end. Event sequence numbers are local to the projected history to avoid exposing hidden-event gaps. The current board supplies live visible information.
- The full state, including saved offers, history, effects, RNG cursor, and pinned versions, survives JSON serialization. Keep it private. Network schemas, seat authentication, duplicate/stale command handling, persistence, timer scheduling, and command queues belong to Milestone 2. The engine's `version` increments on every accepted command to support that work.
- `scoreMatch` provides tower breakdowns. Final results include the ending reason, winner, scores, and every applied tie-break criterion with its remaining contenders.

## Cards and balance

Definitions live in `src/cards/catalog/v1.ts`; rarity curves live in `src/cards/balance/v1.ts`. The `framework-1` catalog is a provisional fixture catalog: three distinct neutral choices plus examples of reveal, heal, damage prevention, build, and delayed damage triggers. These are not the final release cards or balance.

`createRegistry` copies, validates and recursively freezes supplied definitions. Catalog versions and balance versions are pinned in match state; preserve old registry entries for active matches after deployment. Behavior changes require a new catalog version and card behavior version. Rarity IDs are arbitrary strings with unique integer ranks and label/icon/color metadata.

`generateOffer` is pure and returns both three distinct card IDs and the advanced RNG cursor. It filters eligibility, target availability, per-match limits, and unique effects; rolls a rarity from its normalized progress curve; then rolls a card by weight. Empty tiers fall through lower unlocked ranks and then an unconditional neutral pool. Registry validation requires at least three always-selectable neutral fallbacks. Reconnecting must load the stored offer rather than regenerate it.

Targets are explicit named tower IDs or cells, selected when choosing the card. `legalTargets` returns deterministic legal options; timeout takes the first in that order (tower IDs sorted lexically, cells in row order). Effects attach to their owner and optional stable tower/cell targets. Definitions composed of existing handlers need only registration and tests. A new mechanic extends the discriminated effect schema and exhaustive handler table; it does not change offer generation.

Lifecycle conventions:

- Handlers execute in effect activation order, then definition order. A matching trigger spends one charge regardless of the number of handlers in the definition.
- Immediate consumables resolve on selection. Delayed consumables resolve once at their first matching trigger, or expire unused. Lethal damage destroys the tower before `after_damage`; healing cannot resurrect it.
- A `this_turn` effect expires when that turn ends. `owner_turns: N` expires before the owner's Nth subsequent turn starts. `rounds: N` expires at the start of global round `selectedRound + N`. A `match` effect lasts through the match. Target destruction or owner elimination removes attached effects.
- `stack` creates independent instances; `replace` replaces prior instances; `refresh` retains its stable instance ID and revealed status while resetting targets, duration and charges; `unique` prevents selection while active.
- Hidden passives are omitted from opponent projections until they trigger. Public card metadata never includes private target coordinates. Match-end projection reveals all cells and the complete event history, including former offers, selections and expired effects.
- Descriptions are generated from effect parameters and checked on registration. Duration, charges, rarity and stacking remain typed metadata for future UI presentation.

## Verification

Run `corepack pnpm exec vitest run packages/game-engine` for the engine suite. Root `test`, `typecheck`, `lint`, and `build` include this package; root typechecking also checks the test source.

The rule suite covers all four presets, setup uniqueness, action boundaries, shared health, non-merging expansion, destruction, Town Hall behavior, turn skipping, elimination, every scoring threshold and tie-break, configured-round endings, last-survivor endings, private/live fog, immutable input handling, offer legality and determinism, rarity unlocks and fallback, version pinning, target selection, all implemented triggers, consumable/passive durations and stacking, hidden effects, and serialization/replay. Full matches run on all four presets both through ordinary turns and deterministic timeout automation.

Room codes, connected-player readiness, transport identity, UI rendering, and reconnect persistence are deliberately not claimed here; their engine-facing rules are available for Milestones 2 and 3.
