import type { AbilityCardDefinition, CardCatalog } from '../../types.js';
import { describeEffects } from '../registry.js';

function define(
  card: Omit<AbilityCardDefinition, 'description'>,
): AbilityCardDefinition {
  return { ...card, description: describeEffects(card) };
}
const base = {
  version: 1,
  tags: ['framework'],
  eligibility: [],
  targets: [],
  stacking: 'stack',
  visibility: 'public',
  offerWeight: 1,
  artKey: 'placeholder',
} as const;
const fallback = (id: string): AbilityCardDefinition =>
  define({
    ...base,
    tags: ['framework', 'fallback'],
    eligibility: [],
    targets: [],
    id,
    name: id,
    rarityId: 'common',
    lifecycle: 'consumable',
    effects: [{ type: 'neutral', trigger: 'on_selected' }],
  });
export const frameworkCatalog: CardCatalog = {
  version: 'framework-1',
  fallbackCardIds: ['neutral-a', 'neutral-b', 'neutral-c'],
  cards: [
    fallback('neutral-a'),
    fallback('neutral-b'),
    fallback('neutral-c'),
    define({
      ...base,
      tags: ['framework'],
      eligibility: [],
      id: 'survey',
      name: 'Survey (prototype)',
      rarityId: 'common',
      lifecycle: 'consumable',
      targets: [
        {
          id: 'cell',
          kind: 'hidden_enemy_cell',
          timing: 'on_selected',
          fallback: 'first_legal',
        },
      ],
      effects: [{ type: 'reveal', trigger: 'on_selected', target: 'cell' }],
    }),
    define({
      ...base,
      tags: ['framework'],
      eligibility: [],
      id: 'repair',
      name: 'Repair (prototype)',
      rarityId: 'uncommon',
      lifecycle: 'consumable',
      targets: [
        {
          id: 'tower',
          kind: 'damaged_own_tower',
          timing: 'on_selected',
          fallback: 'first_legal',
        },
      ],
      effects: [
        { type: 'heal', trigger: 'on_selected', amount: 2, target: 'tower' },
      ],
    }),
    define({
      ...base,
      tags: ['framework'],
      eligibility: [],
      targets: [],
      id: 'guard',
      name: 'Guard (prototype)',
      rarityId: 'rare',
      lifecycle: 'passive',
      visibility: 'owner_until_triggered',
      stacking: 'refresh',
      charges: 1,
      duration: { type: 'owner_turns', count: 1 },
      effects: [
        { type: 'prevent_damage', trigger: 'before_attack', amount: 1 },
      ],
    }),
    define({
      ...base,
      tags: ['framework'],
      eligibility: [],
      targets: [],
      id: 'builders',
      name: 'Builders (prototype)',
      rarityId: 'epic',
      lifecycle: 'passive',
      duration: { type: 'this_turn' },
      effects: [
        { type: 'heal', trigger: 'on_build', amount: 1, target: 'event_tower' },
      ],
    }),
    define({
      ...base,
      tags: ['framework'],
      eligibility: [],
      targets: [],
      id: 'reserve',
      name: 'Reserve (prototype)',
      rarityId: 'legendary',
      lifecycle: 'consumable',
      duration: { type: 'match' },
      effects: [
        {
          type: 'heal',
          trigger: 'after_damage',
          amount: 1,
          target: 'event_tower',
        },
      ],
    }),
  ],
};
