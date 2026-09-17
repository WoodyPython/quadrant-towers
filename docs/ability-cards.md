# Ability cards launch content

New matches pin catalog **`launch-2`** and balance **`launch-2`**. Every launch definition has behavior version 1. The immutable `framework-1` catalog and balance remain registered solely for recovery of existing matches. There is one active catalog for new matches.

The launch catalog has 45 normal cards: 10 Common, 10 Uncommon, 10 Rare, 10 Epic, and 5 Legendary. Definitions, rules text, tags, art keys, targets and effect parameters live in `packages/game-engine/src/cards/catalog/v2.ts`. Registration validates numeric rules text against effect parameters to prevent stale descriptions. No custom raster art is required; the existing icon system includes all five rarity markers and visible rarity labels.

## Progression

These are per-slot percentages. Progress is `(round - 1) / (configuredRounds - 1)` for every preset. Each rarity interpolates linearly between anchors in `packages/game-engine/src/cards/balance/v2.ts`.

| Progress | Common | Uncommon | Rare | Epic | Legendary |
| -------- | ------ | -------- | ---- | ---- | --------- |
| 0        | 80     | 20       | 0    | 0    | 0         |
| .20      | 55     | 35       | 10   | 0    | 0         |
| .40      | 35     | 35       | 23   | 7    | 0         |
| .60      | 20     | 30       | 30   | 18   | 2         |
| .80      | 10     | 20       | 30   | 32   | 8         |
| .95      | 5      | 15       | 25   | 40   | 15        |
| 1        | 5      | 15       | 25   | 40   | 15        |

Legendary is exactly zero through progress .40 and rises above zero in the .40–.60 interpolation segment. This follows the specified interpolation rather than adding a separate late-game unlock threshold.

The saved three-card offer is private and immutable across refresh, reconnect, recovery and timeout. If an intervening opponent forfeit removes required targets, that forfeit transaction replaces only invalid choices with distinct neutral fallbacks in stable order, without consuming RNG. Weighted rolls exclude fallback-only definitions and duplicate IDs, filter legality, and fall back through lower tiers. Three internal neutral definitions (`neutral_reserve`, `neutral_patience`, `neutral_readiness`) are excluded from normal rolls and used only if lower tiers cannot complete a distinct legal offer. They do not count toward the 45 launch cards.

## Resolution and targeting

`card:choose` submits all targets atomically. The protocol accepts cells, tower/player IDs, and bounded cell/ID sequences; the engine validates ownership, visibility, count, uniqueness, connectivity and sequential expansion legality before applying effects. Timeout builds a deterministic first-legal target sequence without changing the offer.

Strategic Recon selects one crossing cell, which identifies its enemy quadrant, row and column. This is equivalent to three separate selectors. Expansion cards allow players to finish after at least one legal cell, up to their stated maximum. Reinforcement Protocol requires every eligible damaged tower up to three. Rectangle selection previews the entire footprint. Selection can be canceled or restarted before confirmation, and rejected commands retain the current selection when the match version has not changed.

Card effects reuse normal Build/Expand legality without spending normal actions. Overclock grants three normal actions; Time Warp grants four. Mobilization grants three actions plus one free Build/Expand. Pending free Attacks are spent before paid Attacks, block turn completion, and are resolved first during timeout. Charges cap destruction chains.

Damage has one pipeline: attack replacement modifiers, additive bonuses, invulnerability, legacy prevention and shield pools, health loss, Phoenix interception, destruction, then post-damage/destruction triggers. Area cards snapshot and sort distinct victims and complete the entire blast before evaluating elimination and match completion. Invulnerability does not spend shields. Successful attack bonus charges and Focused Fire tracking qualify when damage is actually dealt; misses and fully prevented damage preserve them. Counterintelligence triggers on an attack against a tower even when all damage is prevented.

`this_turn` effects expire at turn end. `until_owner_next_turn` effects expire after the owner's turn counter increments and before the next offer is generated. Charges are consumed on qualifying events, shield pools consume only prevented damage, and target-bound effects disappear when their tower is destroyed.

## Persistence and privacy

Snapshot schema 1 gains optional fields, preserving recovery of older snapshots: shield pools, Focused Fire tower IDs, pending free Attacks and normal-operation tracking. Normal action counts are bounded at four. State and command receipts persist before broadcast using the existing transaction path; replay cannot reapply card effects or grant actions twice.

Client projections include only authorized cells. Direct tower damage does not reveal hidden footprint cells; area damage reveals only its rectangle. Public card/effect events omit private targets and results. Detailed damage events are visible only to the actor until match end, including their existence, so unrelated observers cannot infer hidden hit results. Opponents never receive effect targets, shield pools or hit-tracking IDs. Gameplay randomness uses the persisted deterministic RNG.

## Validation and playtesting

Tests cover all 45 cards and deterministic timeout resolution, exact rarity anchors/interpolation, offer eligibility/fallbacks, geometry, action accounting, passive interactions, private projections and snapshot recovery. Database/socket tests restart and replay launch cards without duplicate effects. Browser tests exercise connected cells, sequential expansion, Legendary labels, four-action turns and refresh continuity, alongside the existing match, keyboard, mobile and restart suites.

Playtesting should measure the specified first-pass balance, especially Legendary progression, action-economy cards, area damage and Phoenix. No listed launch values have been reduced.

## Implementation files

- Catalog, balance and rules: `packages/game-engine/src/cards/catalog/v2.ts`, `cards/balance/v2.ts`, `cards/registry.ts`, `cards/targets.ts`, `cards/rules-text.ts`.
- Engine and projections: `packages/game-engine/src/engine.ts`, `types.ts`, `projection.ts`, `index.ts`.
- Protocol and recovery: `packages/protocol/src/multiplayer.ts`, `apps/server/src/multiplayer/server.ts`, `snapshot.ts`.
- Web presentation and targeting: `apps/web/src/App.tsx`, `Game.tsx`, `Board.tsx`, `Icon.tsx`, `board-model.ts`.
- Tests: `packages/game-engine/launch-cards.test.ts`, `apps/server/src/multiplayer/ability-recovery.test.ts`, `server.integration.test.ts`, `apps/web/src/card-targeting.test.ts`, and `tests/e2e/ability-cards.spec.ts`, `foundation.spec.ts`, `interactions.spec.ts`, `helpers.ts`, `server-worker.mjs`.
- Documentation: `GAME_PLAN.md` and this document.
