import { rulesTextMatches } from './rules-text.js';
import {
  fallbackTargets,
  targetCandidates,
  validateTargets,
} from './targets.js';
import { PRESETS } from '../board.js';
import { weighted } from '../random.js';
import type {
  AbilityCardDefinition,
  Balance,
  CardCatalog,
  EngineRegistry,
  MatchState,
  RarityDefinition,
  TargetDefinition,
  TargetValue,
} from '../types.js';

export function describeEffects(
  card: Pick<AbilityCardDefinition, 'effects'>,
): string {
  return card.effects
    .map((effect) => {
      const text =
        effect.type === 'neutral'
          ? 'No board change.'
          : effect.type === 'heal'
            ? `Restore ${effect.amount} health (up to 10).`
            : effect.type === 'reveal'
              ? 'Permanently reveal the selected cell.'
              : effect.type === 'prevent_damage'
                ? `Prevent ${effect.amount} incoming damage.`
                : 'amount' in effect
                  ? `Apply ${effect.amount} ${effect.type}.`
                  : `Apply ${effect.type}.`;
      return `${effect.trigger}: ${text}`;
    })
    .join(' ');
}
export function createRegistry(
  catalogs: CardCatalog[],
  balances: Balance[],
): EngineRegistry {
  const registry: EngineRegistry = { catalogs: {}, balances: {} };
  for (const balance of balances) {
    if (!balance.version || registry.balances[balance.version])
      throw new Error('Duplicate/empty balance version');
    const ids = new Set<string>();
    const ranks = new Set<number>();
    for (const rarity of balance.rarities) {
      if (
        !rarity.id ||
        ids.has(rarity.id) ||
        !Number.isInteger(rarity.rank) ||
        ranks.has(rarity.rank) ||
        !rarity.label ||
        !rarity.icon ||
        !rarity.color ||
        rarity.unlockProgress < 0 ||
        rarity.unlockProgress > 1 ||
        !Number.isFinite(rarity.unlockProgress)
      )
        throw new Error('Invalid rarity');
      ids.add(rarity.id);
      ranks.add(rarity.rank);
      if (
        rarity.weights.length < 2 ||
        rarity.weights[0]!.progress !== 0 ||
        rarity.weights.at(-1)!.progress !== 1
      )
        throw new Error('Weight curve must span [0, 1]');
      rarity.weights.forEach((point, index) => {
        if (
          !Number.isFinite(point.weight) ||
          point.weight < 0 ||
          !Number.isFinite(point.progress) ||
          point.progress < 0 ||
          point.progress > 1 ||
          (index > 0 && point.progress <= rarity.weights[index - 1]!.progress)
        )
          throw new Error('Invalid rarity curve');
      });
    }
    if (!ids.size) throw new Error('Empty rarity registry');
    registry.balances[balance.version] = JSON.parse(
      JSON.stringify(balance),
    ) as Balance;
  }
  for (const catalog of catalogs) {
    if (!catalog.version || registry.catalogs[catalog.version])
      throw new Error('Duplicate/empty catalog version');
    const ids = new Set<string>();
    for (const card of catalog.cards) {
      if (
        !card.id ||
        ids.has(card.id) ||
        !Number.isInteger(card.version) ||
        card.version < 1 ||
        !Number.isFinite(card.offerWeight) ||
        card.offerWeight <= 0 ||
        !card.effects.length
      )
        throw new Error('Invalid card');
      ids.add(card.id);
      if (
        !card.description ||
        (card.description !== describeEffects(card) && !rulesTextMatches(card))
      )
        throw new Error('Card description does not match effects');
      if (
        card.charges !== undefined &&
        (!Number.isInteger(card.charges) || card.charges < 1)
      )
        throw new Error('Invalid charges');
      if (
        card.perMatchLimit !== undefined &&
        (!Number.isInteger(card.perMatchLimit) || card.perMatchLimit < 1)
      )
        throw new Error('Invalid card limit');
      if (
        (card.lifecycle === 'passive' ||
          card.effects.some((e) => e.trigger !== 'on_selected')) &&
        !card.duration
      )
        throw new Error('Persistent effects require expiry');
      if (
        card.duration &&
        'count' in card.duration &&
        (!Number.isInteger(card.duration.count) || card.duration.count < 1)
      )
        throw new Error('Invalid duration');
      const targets = new Set(card.targets.map((t) => t.id));
      if (
        targets.size !== card.targets.length ||
        targets.has('event_tower') ||
        targets.has('')
      )
        throw new Error('Invalid target IDs');
      for (const target of card.targets) {
        if (
          target.timing !== 'on_selected' ||
          target.fallback !== 'first_legal'
        )
          throw new Error('Invalid target timing/fallback');
        if (
          target.kind === 'enemy_rectangle' &&
          (!Number.isInteger(target.size) ||
            target.size! < 2 ||
            target.size! > 5)
        )
          throw new Error('Invalid rectangle size');
        if (
          [
            'own_towers',
            'empty_own_cells',
            'expansion_cells',
            'connected_enemy_cells',
          ].includes(target.kind) &&
          (!Number.isInteger(target.count) ||
            target.count! < 1 ||
            target.count! > 3)
        )
          throw new Error('Invalid target count');
        if (
          target.kind === 'expansion_cells' &&
          !card.targets.some(
            (t) => t.id === target.towerTarget && t.kind === 'expandable_tower',
          )
        )
          throw new Error('Invalid expansion target');
      }
      for (const rule of card.eligibility) {
        const value = rule.type === 'minimum_round' ? rule.round : rule.health;
        if (
          !Number.isInteger(value) ||
          value < 1 ||
          (rule.type === 'has_own_tower_below_health' && value > 10)
        )
          throw new Error('Invalid eligibility');
      }
      for (const effect of card.effects) {
        if (
          'amount' in effect &&
          (!Number.isInteger(effect.amount) || effect.amount < 1)
        )
          throw new Error('Invalid effect amount');
        if (
          effect.type === 'build_free' &&
          (!Number.isInteger(effect.health) ||
            effect.health < 1 ||
            effect.health > 10)
        )
          throw new Error('Invalid build health');
        if (
          effect.type === 'expand_free' &&
          !card.targets.some(
            (t) => t.id === effect.cellsTarget && t.kind === 'expansion_cells',
          )
        )
          throw new Error('Invalid expansion cells');
        if (
          (effect.type === 'area_damage' ||
            (effect.type === 'reveal' && effect.mode === 'rectangle')) &&
          (!Number.isInteger(effect.size) ||
            effect.size! < 2 ||
            effect.size! > 5 ||
            !card.targets.some(
              (t) =>
                t.id === effect.target &&
                t.kind === 'enemy_rectangle' &&
                t.size === effect.size,
            ))
        )
          throw new Error('Invalid rectangle effect');
        if (
          effect.type === 'modifier' &&
          ['shield', 'invulnerable', 'free_expand', 'target_bonus'].includes(
            effect.kind,
          ) &&
          !effect.target
        )
          throw new Error('Modifier requires target');
        if ('target' in effect) {
          if (effect.target === 'event_tower') {
            if (
              effect.type !== 'heal' ||
              !['on_build', 'after_damage', 'before_attack'].includes(
                effect.trigger,
              )
            )
              throw new Error('Trigger has no event tower');
          } else {
            const target = card.targets.find((t) => t.id === effect.target);
            if (
              !target ||
              (effect.type === 'damage' &&
                target.kind !== 'revealed_enemy_tower') ||
              (effect.type === 'build_free' &&
                target.kind !== 'empty_own_cells') ||
              (effect.type === 'expand_free' &&
                target.kind !== 'expandable_tower') ||
              (effect.type === 'area_damage' &&
                target.kind !== 'enemy_rectangle') ||
              (effect.type === 'modifier' &&
                effect.kind === 'target_bonus' &&
                target.kind !== 'revealed_enemy_tower') ||
              (effect.type === 'modifier' &&
                ['shield', 'invulnerable'].includes(effect.kind) &&
                target.kind !== 'own_tower') ||
              (effect.type === 'modifier' &&
                effect.kind === 'free_expand' &&
                target.kind !== 'expandable_tower') ||
              (effect.type === 'heal' &&
                ![
                  'own_tower',
                  'damaged_own_tower',
                  'one_health_tower',
                  'expandable_tower',
                  'own_towers',
                ].includes(target.kind)) ||
              (effect.type === 'reveal' &&
                !target.kind.startsWith('enemy_') &&
                !['hidden_enemy_cell', 'connected_enemy_cells'].includes(
                  target.kind,
                ))
            )
              throw new Error('Effect target type mismatch');
          }
        }
      }
    }
    if (new Set(catalog.fallbackCardIds).size < 3)
      throw new Error('Three distinct neutral fallbacks required');
    for (const id of catalog.fallbackCardIds) {
      const card = catalog.cards.find((c) => c.id === id);
      if (
        !card ||
        card.lifecycle !== 'consumable' ||
        card.targets.length ||
        card.eligibility.length ||
        card.perMatchLimit !== undefined ||
        card.effects.some(
          (e) => e.type !== 'neutral' || e.trigger !== 'on_selected',
        )
      )
        throw new Error('Fallback must always be selectable and neutral');
    }
    registry.catalogs[catalog.version] = JSON.parse(
      JSON.stringify(catalog),
    ) as CardCatalog;
  }
  // Versioned definitions cannot change under an active match in this process.
  function freeze(value: object) {
    for (const child of Object.values(value))
      if (child && typeof child === 'object') freeze(child as object);
    Object.freeze(value);
  }
  freeze(registry);
  return registry;
}
export function pinnedContent(
  state: Pick<MatchState, 'cardCatalogVersion' | 'balanceVersion'>,
  registry: EngineRegistry,
) {
  const catalog = registry.catalogs[state.cardCatalogVersion];
  const balance = registry.balances[state.balanceVersion];
  if (!catalog || !balance)
    throw new Error('Pinned content version unavailable');
  if (
    catalog.cards.some(
      (c) => !balance.rarities.some((r) => r.id === c.rarityId),
    )
  )
    throw new Error('Unknown card rarity');
  return { catalog, balance };
}
export function legalTargets(
  state: MatchState,
  playerId: string,
  target: TargetDefinition,
  selected: Record<string, TargetValue> = {},
): TargetValue[] {
  return targetCandidates(state, playerId, target, selected);
}
export function selectable(
  state: MatchState,
  playerId: string,
  card: AbilityCardDefinition,
): boolean {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return false;
  const selectedCount = Object.hasOwn(player.cardsSelected, card.id)
    ? player.cardsSelected[card.id]!
    : 0;
  if (card.perMatchLimit !== undefined && selectedCount >= card.perMatchLimit)
    return false;
  if (
    card.stacking === 'unique' &&
    state.effects.some((e) => e.ownerId === playerId && e.cardId === card.id)
  )
    return false;
  return (
    card.eligibility.every((rule) =>
      rule.type === 'minimum_round'
        ? state.turn.round >= rule.round
        : state.towers.some(
            (t) => t.ownerId === playerId && t.health < rule.health,
          ),
    ) &&
    validateTargets(
      state,
      playerId,
      card,
      fallbackTargets(state, playerId, card),
    )
  );
}
export const normalizedProgress = (
  state: Pick<MatchState, 'preset' | 'turn'>,
): number => (state.turn.round - 1) / (PRESETS[state.preset].rounds - 1);
export function rarityWeight(
  rarity: RarityDefinition,
  progress: number,
): number {
  if (progress < rarity.unlockProgress) return 0;
  for (let i = 1; i < rarity.weights.length; i++) {
    const end = rarity.weights[i]!;
    const start = rarity.weights[i - 1]!;
    if (progress <= end.progress)
      return (
        start.weight +
        ((end.weight - start.weight) * (progress - start.progress)) /
          (end.progress - start.progress)
      );
  }
  return rarity.weights.at(-1)!.weight;
}
// Returns the advanced RNG explicitly; callers persist this and the saved offer together.
export function generateOffer(
  state: MatchState,
  registry: EngineRegistry,
): { cardIds: string[]; rngState: number } {
  const { catalog, balance } = pinnedContent(state, registry);
  const cursor = { rngState: state.rngState };
  const eligible = catalog.cards.filter((card) =>
    selectable(state, state.turn.playerId, card),
  );
  const cardIds: string[] = [];
  const progress = normalizedProgress(state);
  for (let slot = 0; slot < 3; slot++) {
    const rolled = weighted(
      cursor,
      balance.rarities.map((rarity) => ({
        value: rarity,
        weight: rarityWeight(rarity, progress),
      })),
    );
    let chosen: AbilityCardDefinition | undefined;
    if (rolled) {
      const tiers = balance.rarities
        .filter((r) => r.rank <= rolled.rank && progress >= r.unlockProgress)
        .sort((a, b) => b.rank - a.rank);
      for (const tier of tiers) {
        chosen = weighted(
          cursor,
          eligible
            .filter(
              (c) =>
                !c.fallbackOnly &&
                c.rarityId === tier.id &&
                !cardIds.includes(c.id),
            )
            .map((c) => ({ value: c, weight: c.offerWeight })),
        );
        if (chosen) break;
      }
    }
    chosen ??= weighted(
      cursor,
      eligible
        .filter(
          (c) =>
            catalog.fallbackCardIds.includes(c.id) && !cardIds.includes(c.id),
        )
        .map((c) => ({ value: c, weight: c.offerWeight })),
    );
    if (!chosen) throw new Error('Catalog cannot provide three legal cards');
    cardIds.push(chosen.id);
  }
  return { cardIds, rngState: cursor.rngState };
}
