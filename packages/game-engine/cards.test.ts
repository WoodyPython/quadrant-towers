import { describe, expect, it } from 'vitest';
import {
  allCells,
  applyCommand,
  cellKey,
  createMatch,
  createRegistry,
  defaultRegistry,
  describeEffects,
  frameworkBalance,
  frameworkCatalog,
  generateOffer,
  legalTargets,
  ownsCell,
  PRESETS,
  projectMatch,
  quadrantCells,
  rarityWeight,
  selectable,
  towerAt,
} from './src/index.js';
import type {
  AbilityCardDefinition,
  CardCatalog,
  Command,
  DurationDefinition,
  EngineRegistry,
  MatchState,
} from './src/index.js';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function fixture(
  patch: Partial<AbilityCardDefinition> = {},
): AbilityCardDefinition {
  const card: AbilityCardDefinition = {
    id: 'test-card',
    version: 1,
    name: 'Test card',
    description: '',
    rarityId: 'common',
    lifecycle: 'passive',
    tags: [],
    eligibility: [],
    targets: [],
    effects: [{ type: 'prevent_damage', trigger: 'before_attack', amount: 1 }],
    duration: { type: 'match' },
    stacking: 'stack',
    visibility: 'public',
    offerWeight: 1,
    artKey: 'test',
    ...patch,
  };
  card.description = describeEffects(card);
  return card;
}
function registryFor(...cards: AbilityCardDefinition[]): EngineRegistry {
  const catalog = copy(frameworkCatalog);
  catalog.cards.push(...cards);
  return createRegistry([catalog], [frameworkBalance]);
}
function setup(registry = defaultRegistry): MatchState {
  return createMatch(
    {
      id: 'test',
      playerIds: ['a', 'b', 'c', 'd'],
      preset: 'small',
      seed: 42,
      now: 0,
      cardCatalogVersion: 'framework-1',
      balanceVersion: 'framework-1',
    },
    registry,
  );
}
function run(
  state: MatchState,
  command: Command,
  registry: EngineRegistry,
): MatchState {
  const result = applyCommand(
    state,
    command.type === 'timeout' ? null : state.turn.playerId,
    command,
    command.type === 'timeout' ? state.turn.deadline : state.lastCommandAt,
    registry,
  );
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function select(
  state: MatchState,
  card: AbilityCardDefinition,
  registry: EngineRegistry,
) {
  state = copy(state);
  state.turn.cardOffer = [card.id, 'neutral-a', 'neutral-b'];
  return run(
    state,
    {
      type: 'select_card',
      cardId: card.id,
      targets: Object.fromEntries(
        card.targets.map((t) => [
          t.id,
          legalTargets(state, state.turn.playerId, t)[0]!,
        ]),
      ),
    },
    registry,
  );
}
function completeTurn(state: MatchState, registry: EngineRegistry) {
  if (state.turn.selectedCardId === null)
    state = select(state, frameworkCatalog.cards[0]!, registry);
  while (state.turn.actionsRemaining) {
    const player = state.players.find((p) => p.id === state.turn.playerId)!;
    const cell = quadrantCells(state.preset, player.quadrant).find(
      (c) => !towerAt(state, c),
    )!;
    state = run(state, { type: 'build', cell }, registry);
  }
  return run(state, { type: 'end_turn' }, registry);
}

describe('card definitions, offers and pinned versions', () => {
  it('copies and freezes registered definitions against in-place balance changes', () => {
    const catalog = copy(frameworkCatalog);
    const balance = copy(frameworkBalance);
    const registry = createRegistry([catalog], [balance]);
    catalog.cards[0]!.offerWeight = 999;
    balance.rarities[0]!.weights[0]!.weight = 999;
    expect(registry.catalogs['framework-1']!.cards[0]!.offerWeight).toBe(1);
    expect(
      registry.balances['framework-1']!.rarities[0]!.weights[0]!.weight,
    ).toBe(100);
    expect(() => {
      registry.catalogs['framework-1']!.cards[0]!.offerWeight = 2;
    }).toThrow();
  });
  it('requires three unconditional neutral fallbacks and checks descriptions', () => {
    const catalog = copy(frameworkCatalog);
    catalog.fallbackCardIds = ['neutral-a', 'neutral-b'];
    expect(() => createRegistry([catalog], [frameworkBalance])).toThrow(
      'Three distinct',
    );
    catalog.fallbackCardIds.push('repair');
    expect(() => createRegistry([catalog], [frameworkBalance])).toThrow(
      'Fallback',
    );
    const bad = copy(frameworkCatalog);
    bad.cards[0]!.description = 'Incorrect rules';
    expect(() => createRegistry([bad], [frameworkBalance])).toThrow(
      'description',
    );
  });
  it('validates definition versions, weights, charges, durations, references and eligibility', () => {
    const patches: Partial<AbilityCardDefinition>[] = [
      { version: 0 },
      { offerWeight: 0 },
      { charges: 0 },
      { perMatchLimit: -1 },
      { duration: { type: 'rounds', count: 0 } },
      {
        effects: [
          {
            type: 'heal',
            trigger: 'on_selected',
            target: 'missing',
            amount: 1,
          },
        ],
      },
      {
        effects: [
          {
            type: 'heal',
            trigger: 'on_turn_start',
            target: 'event_tower',
            amount: 1,
          },
        ],
      },
      {
        effects: [
          { type: 'prevent_damage', trigger: 'before_attack', amount: -1 },
        ],
      },
      { eligibility: [{ type: 'minimum_round', round: 0 }] },
    ];
    for (const patch of patches)
      expect(() => registryFor(fixture(patch))).toThrow();
    const noExpiry = fixture();
    delete noExpiry.duration;
    expect(() => registryFor(noExpiry)).toThrow('expiry');
    expect(() => registryFor(fixture(), fixture())).toThrow('Invalid card');
    const wrongTarget = fixture({
      targets: [
        {
          id: 'cell',
          kind: 'enemy_cell',
          timing: 'on_selected',
          fallback: 'first_legal',
        },
      ],
      effects: [
        { type: 'heal', trigger: 'on_selected', target: 'cell', amount: 1 },
      ],
    });
    expect(() => registryFor(wrongTarget)).toThrow('mismatch');
  });
  it('validates rarity curves and catalog/balance combinations', () => {
    for (const patch of [
      { weights: [{ progress: 0, weight: 1 }] },
      { unlockProgress: 2 },
      { rank: 1 },
      {
        weights: [
          { progress: 0, weight: -1 },
          { progress: 1, weight: 0 },
        ],
      },
    ]) {
      const balance = copy(frameworkBalance);
      Object.assign(balance.rarities[0]!, patch);
      expect(() => createRegistry([frameworkCatalog], [balance])).toThrow();
    }
    const catalog = copy(frameworkCatalog);
    catalog.cards[0]!.rarityId = 'missing';
    expect(() => setup(createRegistry([catalog], [frameworkBalance]))).toThrow(
      'Unknown card rarity',
    );
  });
  it('supports new rarity IDs without changing state schemas', () => {
    const balance = copy(frameworkBalance);
    balance.rarities.push({
      id: 'mythic',
      rank: 9,
      label: 'Mythic',
      icon: 'moon',
      color: '#fff',
      unlockProgress: 0,
      weights: [
        { progress: 0, weight: 100 },
        { progress: 1, weight: 100 },
      ],
    });
    const catalog = copy(frameworkCatalog);
    catalog.cards.push(fixture({ rarityId: 'mythic' }));
    const registry = createRegistry([catalog], [balance]);
    const state = setup(registry);
    expect(generateOffer(state, registry).cardIds).toContain('test-card');
  });
  it('falls through lower tiers and finally neutral pool when rarities have no candidates', () => {
    const balance = copy(frameworkBalance);
    balance.rarities.forEach((r) => {
      r.weights = [
        { progress: 0, weight: r.id === 'legendary' ? 1 : 0 },
        { progress: 1, weight: r.id === 'legendary' ? 1 : 0 },
      ];
      r.unlockProgress = 0;
    });
    const catalog: CardCatalog = {
      version: 'framework-1',
      cards: frameworkCatalog.cards.slice(0, 3),
      fallbackCardIds: [...frameworkCatalog.fallbackCardIds],
    };
    let registry = createRegistry([catalog], [balance]);
    let state = setup(registry);
    expect(new Set(state.turn.cardOffer)).toEqual(
      new Set(catalog.fallbackCardIds),
    );
    balance.rarities.forEach((r) => {
      r.weights.forEach((p) => {
        p.weight = 0;
      });
    });
    registry = createRegistry([catalog], [balance]);
    state = setup(registry);
    expect(new Set(state.turn.cardOffer)).toEqual(
      new Set(catalog.fallbackCardIds),
    );
  });
  it('filters unsatisfiable targets, limits, minimum rounds and unique passives', () => {
    const card = fixture({
      perMatchLimit: 1,
      eligibility: [{ type: 'minimum_round', round: 3 }],
    });
    const registry = registryFor(card);
    let state = setup(registry);
    expect(selectable(state, state.turn.playerId, card)).toBe(false);
    state.turn.round = 3;
    expect(selectable(state, state.turn.playerId, card)).toBe(true);
    state = select(state, card, registry);
    expect(selectable(state, state.turn.playerId, card)).toBe(false);
    expect(generateOffer(state, registry).cardIds).not.toContain(card.id);
    const player = state.players.find((p) => p.id === state.turn.playerId)!;
    player.revealed = allCells(state.preset)
      .filter((c) => !ownsCell(state, player, c))
      .map(cellKey);
    expect(
      selectable(
        state,
        player.id,
        frameworkCatalog.cards.find((c) => c.id === 'survey')!,
      ),
    ).toBe(false);
    state.towers
      .filter((t) => t.ownerId === player.id)
      .forEach((t) => {
        t.health = 10;
      });
    expect(
      selectable(
        state,
        player.id,
        frameworkCatalog.cards.find((c) => c.id === 'repair')!,
      ),
    ).toBe(false);
    expect(
      selectable(
        state,
        player.id,
        fixture({
          eligibility: [{ type: 'has_own_tower_below_health', health: 10 }],
        }),
      ),
    ).toBe(false);
  });
  it('pins behavior across deployments and rejects unavailable versions', () => {
    const card = fixture({
      effects: [
        { type: 'heal', trigger: 'on_build', amount: 1, target: 'event_tower' },
      ],
    });
    const original = registryFor(card);
    let state = select(setup(original), card, original);
    const newCatalog = copy(original.catalogs['framework-1']!);
    newCatalog.version = 'framework-2';
    const modified = newCatalog.cards.find((c) => c.id === card.id)!;
    modified.version = 2;
    modified.effects = [
      { type: 'heal', trigger: 'on_build', amount: 8, target: 'event_tower' },
    ];
    modified.description = describeEffects(modified);
    const registry = createRegistry(
      [original.catalogs['framework-1']!, newCatalog],
      [frameworkBalance],
    );
    const cell = quadrantCells(
      state.preset,
      state.players.find((p) => p.id === state.turn.playerId)!.quadrant,
    ).find((c) => !towerAt(state, c))!;
    state = run(state, { type: 'build', cell }, registry);
    expect(towerAt(state, cell)!.health).toBe(2);
    const missing = createRegistry([newCatalog], [frameworkBalance]);
    expect(
      applyCommand(
        state,
        state.turn.playerId,
        { type: 'build', cell },
        0,
        missing,
      ),
    ).toMatchObject({ ok: false, error: 'Pinned content version unavailable' });
  });
  it('interpolates configured weights and locks Legendary until late progress', () => {
    const legendary = frameworkBalance.rarities.find(
      (r) => r.id === 'legendary',
    )!;
    expect(rarityWeight(legendary, 0.79)).toBe(0);
    expect(rarityWeight(legendary, 0.8)).toBe(8);
    expect(rarityWeight(legendary, 1)).toBe(10);
    expect(rarityWeight(frameworkBalance.rarities[0]!, 0.5)).toBe(60);
    for (const preset of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      const state = setup();
      state.preset = preset;
      for (let round = 1; round <= PRESETS[preset].rounds; round++) {
        state.turn.round = round;
        for (let seed = 0; seed < 20; seed++) {
          state.rngState = seed;
          const offer = generateOffer(state, defaultRegistry);
          if ((round - 1) / (PRESETS[preset].rounds - 1) < 0.8)
            expect(offer.cardIds).not.toContain('reserve');
        }
      }
    }
  });
});

describe('selection and effect handlers', () => {
  it('validates target keys, type, ownership, bounds and eligibility before consuming a card', () => {
    const state = setup();
    state.turn.cardOffer = ['repair', 'survey', 'neutral-a'];
    const enemyTower = state.towers.find(
      (t) => t.ownerId !== state.turn.playerId,
    )!;
    for (const targets of [
      {},
      { tower: enemyTower.id },
      {
        tower: state.towers.find((t) => t.ownerId === state.turn.playerId)!.id,
        extra: 'x',
      },
      { tower: { x: 0, y: 0 } },
    ]) {
      const result = applyCommand(
        state,
        state.turn.playerId,
        { type: 'select_card', cardId: 'repair', targets },
        0,
        defaultRegistry,
      );
      expect(result.ok).toBe(false);
      expect(result.state).toBe(state);
    }
    expect(
      applyCommand(
        state,
        state.turn.playerId,
        {
          type: 'select_card',
          cardId: 'survey',
          targets: { cell: { x: -1, y: 0 } },
        },
        0,
        defaultRegistry,
      ).ok,
    ).toBe(false);
  });
  it('consumes immediate effects once without spending an action and caps healing', () => {
    let state = setup();
    const tower = state.towers.find((t) => t.ownerId === state.turn.playerId)!;
    tower.health = 9;
    const card = frameworkCatalog.cards.find((c) => c.id === 'repair')!;
    state = select(state, card, defaultRegistry);
    expect(state.towers.find((t) => t.id === tower.id)!.health).toBe(10);
    expect(state.turn.actionsRemaining).toBe(2);
    expect(state.effects).toEqual([]);
    expect(
      state.players.find((p) => p.id === state.turn.playerId)!.cardsSelected
        .repair,
    ).toBe(1);
  });
  it('reveal is private, permanent and does not reveal adjacent footprint cells', () => {
    const card = frameworkCatalog.cards.find((c) => c.id === 'survey')!;
    let state = setup();
    state = select(state, card, defaultRegistry);
    const player = state.players.find((p) => p.id === state.turn.playerId)!;
    expect(player.revealed).toHaveLength(1);
    expect(
      state.players
        .filter((p) => p.id !== player.id)
        .every((p) => !p.revealed.length),
    ).toBe(true);
    expect(
      projectMatch(state, player.id).cells.filter(
        (c) => c.visibility === 'visible',
      ),
    ).toHaveLength(37);
  });
  it('uses first legal target deterministically on timeout', () => {
    const cards = [0, 1, 2].map((i) =>
      fixture({
        id: `target-${i}`,
        lifecycle: 'consumable',
        targets: [
          {
            id: 'cell',
            kind: 'enemy_cell',
            timing: 'on_selected',
            fallback: 'first_legal',
          },
        ],
        effects: [{ type: 'reveal', trigger: 'on_selected', target: 'cell' }],
      }),
    );
    const registry = registryFor(...cards);
    const state = setup(registry);
    state.turn.cardOffer = cards.map((c) => c.id);
    const expected = legalTargets(
      state,
      state.turn.playerId,
      cards[0]!.targets[0]!,
    )[0]!;
    const next = run(state, { type: 'timeout' }, registry);
    expect(
      next.history.find((e) => e.type === 'card_selected')!.details.targets,
    ).toEqual({ cell: expected });
    expect(next.history.filter((e) => e.type === 'attack')).toHaveLength(2);
  });
  it('triggers on_build and after_damage in order and consumes delayed consumables once', () => {
    const builder = fixture({
      id: 'builder',
      effects: [
        { type: 'heal', trigger: 'on_build', amount: 2, target: 'event_tower' },
      ],
    });
    const reserve = fixture({
      id: 'reserve-test',
      lifecycle: 'consumable',
      effects: [
        {
          type: 'heal',
          trigger: 'after_damage',
          amount: 1,
          target: 'event_tower',
        },
      ],
    });
    const registry = registryFor(builder, reserve);
    let state = select(setup(registry), builder, registry);
    state = completeTurn(state, registry);
    const builds = state.towers.filter((t) => t.type === 'normal');
    expect(builds.map((t) => t.health)).toEqual([3, 3]);
    const defender = state.turn.playerId;
    state = select(state, reserve, registry);
    state = completeTurn(state, registry);
    state = select(state, frameworkCatalog.cards[0]!, registry);
    const target = state.towers.find(
      (t) => t.ownerId === defender && t.type === 'town_hall',
    )!;
    state = run(state, { type: 'attack', cell: target.cells[0]! }, registry);
    expect(state.towers.find((t) => t.id === target.id)!.health).toBe(3);
    expect(state.effects.some((e) => e.cardId === reserve.id)).toBe(false);
    state = run(state, { type: 'attack', cell: target.cells[0]! }, registry);
    expect(state.towers.find((t) => t.id === target.id)!.health).toBe(2);
  });
  it('does not resurrect destroyed towers through after_damage', () => {
    const card = fixture({
      effects: [
        {
          type: 'heal',
          trigger: 'after_damage',
          target: 'event_tower',
          amount: 10,
        },
      ],
    });
    const registry = registryFor(card);
    let state = select(setup(registry), card, registry);
    const target = state.towers.find((t) => t.ownerId === state.turn.playerId)!;
    target.health = 1;
    state = completeTurn(state, registry);
    state = select(state, frameworkCatalog.cards[0]!, registry);
    state = run(state, { type: 'attack', cell: target.cells[0]! }, registry);
    expect(state.towers.some((t) => t.id === target.id)).toBe(false);
  });
  it('protects only the owner, spends charges, reveals hidden passives on trigger and reports prevention', () => {
    const card = fixture({ visibility: 'owner_until_triggered', charges: 1 });
    const registry = registryFor(card);
    let state = select(setup(registry), card, registry);
    const defender = state.turn.playerId;
    const other = state.turnOrder[1]!;
    expect(projectMatch(state, defender).effects).toHaveLength(1);
    expect(projectMatch(state, other).effects).toHaveLength(0);
    expect(
      projectMatch(state, other).history.find(
        (e) => e.type === 'card_selected',
      ),
    ).not.toHaveProperty('details');
    state = completeTurn(state, registry);
    state = select(state, frameworkCatalog.cards[0]!, registry);
    const target = state.towers.find((t) => t.ownerId === defender)!;
    state = run(state, { type: 'attack', cell: target.cells[0]! }, registry);
    expect(state.towers.find((t) => t.id === target.id)!.health).toBe(3);
    expect(
      state.history.filter((e) => e.type === 'attack').at(-1)!.details.outcome,
    ).toBe('prevented');
    expect(
      projectMatch(state, other).history.find(
        (e) => e.type === 'effect_triggered',
      )!.details,
    ).toEqual({ cardId: card.id });
    expect(state.effects).toHaveLength(0);
    state = run(state, { type: 'attack', cell: target.cells[0]! }, registry);
    expect(state.towers.find((t) => t.id === target.id)!.health).toBe(2);
  });
  it('uses stable activation/definition order and one charge per event, not per handler', () => {
    const card = fixture({
      charges: 2,
      effects: [
        {
          type: 'heal',
          trigger: 'before_attack',
          target: 'event_tower',
          amount: 1,
        },
        { type: 'prevent_damage', trigger: 'before_attack', amount: 1 },
      ],
    });
    const registry = registryFor(card);
    let state = select(setup(registry), card, registry);
    const target = state.towers.find((t) => t.ownerId === state.turn.playerId)!;
    state = completeTurn(state, registry);
    state = select(state, frameworkCatalog.cards[0]!, registry);
    state = run(state, { type: 'attack', cell: target.cells[0]! }, registry);
    expect(state.towers.find((t) => t.id === target.id)!.health).toBe(4);
    expect(state.effects[0]!.remainingCharges).toBe(1);
    const triggers = state.history.filter((e) => e.type === 'effect_triggered');
    expect(triggers).toHaveLength(1);
  });
});

describe('passive lifetime and stacking', () => {
  it('expires turn effects even on the final turn of the match', () => {
    const card = fixture({ duration: { type: 'this_turn' } });
    const registry = registryFor(card);
    let state = setup(registry);
    state.turn.round = PRESETS[state.preset].rounds;
    state.turn.playerId = state.turnOrder[3]!;
    state = select(state, card, registry);
    state = completeTurn(state, registry);
    expect(state.result?.reason).toBe('round_limit');
    expect(state.effects).toHaveLength(0);
  });
  it('reveals an owner-until-triggered card that triggers immediately on selection', () => {
    const card = fixture({
      visibility: 'owner_until_triggered',
      effects: [
        { type: 'neutral', trigger: 'on_selected' },
        { type: 'prevent_damage', trigger: 'before_attack', amount: 1 },
      ],
    });
    const registry = registryFor(card);
    const state = select(setup(registry), card, registry);
    const view = projectMatch(state, state.turnOrder[1]!);
    expect(view.effects).toHaveLength(1);
    expect(
      view.history.find((e) => e.type === 'card_selected')!.details,
    ).toEqual({ cardId: card.id });
  });
  it.each([
    [{ type: 'this_turn' }, 1],
    [{ type: 'owner_turns', count: 1 }, 4],
    [{ type: 'owner_turns', count: 2 }, 8],
    [{ type: 'rounds', count: 1 }, 4],
    [{ type: 'rounds', count: 2 }, 8],
  ] as [DurationDefinition, number][])(
    'expires %j at the documented boundary',
    (duration, turns) => {
      const card = fixture({ duration });
      const registry = registryFor(card);
      let state = select(setup(registry), card, registry);
      for (let i = 0; i < turns; i++) {
        expect(state.effects).toHaveLength(1);
        state = completeTurn(state, registry);
      }
      expect(state.effects).toHaveLength(0);
      expect(state.history.some((e) => e.type === 'effect_expired')).toBe(true);
    },
  );
  it('round duration uses global boundaries even when selected by a later seat', () => {
    const card = fixture({ duration: { type: 'rounds', count: 1 } });
    const registry = registryFor(card);
    let state = setup(registry);
    for (let i = 0; i < 3; i++) state = completeTurn(state, registry);
    state = select(state, card, registry);
    state = completeTurn(state, registry);
    expect(state.turn.round).toBe(2);
    expect(state.effects).toHaveLength(0);
  });
  it('match effects persist, on_turn_start triggers after expiry and before offer generation', () => {
    const card = fixture({
      effects: [{ type: 'neutral', trigger: 'on_turn_start' }],
    });
    const registry = registryFor(card);
    let state = select(setup(registry), card, registry);
    for (let i = 0; i < 4; i++) state = completeTurn(state, registry);
    expect(state.effects).toHaveLength(1);
    const triggered = state.history.findIndex(
      (e) => e.type === 'effect_triggered',
    );
    expect(triggered).toBeGreaterThan(0);
    expect(state.history.slice(triggered).map((e) => e.type)).toEqual([
      'effect_triggered',
      'turn_started',
      'card_offer',
    ]);
  });
  it.each(['replace', 'refresh', 'stack', 'unique'] as const)(
    'implements %s stacking',
    (stacking) => {
      const card = fixture({ stacking, charges: 2 });
      const registry = registryFor(card);
      let state = select(setup(registry), card, registry);
      const oldId = state.effects[0]!.id;
      state.effects[0]!.remainingCharges = 1;
      for (let i = 0; i < 4; i++) state = completeTurn(state, registry);
      if (stacking === 'unique') {
        expect(selectable(state, state.turn.playerId, card)).toBe(false);
        state.turn.cardOffer = [card.id, 'neutral-a', 'neutral-b'];
        expect(
          applyCommand(
            state,
            state.turn.playerId,
            { type: 'select_card', cardId: card.id, targets: {} },
            0,
            registry,
          ).ok,
        ).toBe(false);
      } else {
        state = select(state, card, registry);
        expect(state.effects).toHaveLength(stacking === 'stack' ? 2 : 1);
        expect(state.effects.at(-1)!.remainingCharges).toBe(2);
        if (stacking === 'refresh') expect(state.effects[0]!.id).toBe(oldId);
        if (stacking === 'replace')
          expect(state.effects[0]!.id).not.toBe(oldId);
      }
    },
  );
  it('removes effects when their stable tower target is destroyed', () => {
    const card = fixture({
      targets: [
        {
          id: 'tower',
          kind: 'own_tower',
          timing: 'on_selected',
          fallback: 'first_legal',
        },
      ],
      effects: [
        { type: 'heal', trigger: 'on_turn_start', target: 'tower', amount: 1 },
      ],
    });
    const registry = registryFor(card);
    let state = select(setup(registry), card, registry);
    const target = state.towers.find(
      (t) => t.id === state.effects[0]!.targets.tower,
    )!;
    target.health = 1;
    state = completeTurn(state, registry);
    state = select(state, frameworkCatalog.cards[0]!, registry);
    state = run(state, { type: 'attack', cell: target.cells[0]! }, registry);
    expect(state.effects).toHaveLength(0);
  });
  it('reveals hidden effects and selected cards in final projection', () => {
    const card = fixture({ visibility: 'owner_until_triggered' });
    const registry = registryFor(card);
    const state = select(setup(registry), card, registry);
    const observer = state.turnOrder[1]!;
    state.result = {
      winnerId: state.turn.playerId,
      reason: 'round_limit',
      scores: [],
      tieBreakers: [],
    };
    const view = projectMatch(state, observer);
    expect(view.effects).toHaveLength(1);
    expect(
      view.history.find((e) => e.type === 'card_selected')!.details!.cardId,
    ).toBe(card.id);
  });
  it('does not leak hidden effects when they expire unused', () => {
    const card = fixture({
      visibility: 'owner_until_triggered',
      duration: { type: 'this_turn' },
    });
    const registry = registryFor(card);
    let state = select(setup(registry), card, registry);
    const owner = state.turn.playerId;
    state = completeTurn(state, registry);
    expect(
      projectMatch(state, state.turn.playerId).history.some(
        (e) => e.type === 'effect_expired',
      ),
    ).toBe(false);
    expect(
      projectMatch(state, owner).history.some(
        (e) => e.type === 'effect_expired',
      ),
    ).toBe(true);
  });
});
