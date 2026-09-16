export type PresetId = 'small' | 'medium' | 'large' | 'massive';
export type Quadrant = 'nw' | 'ne' | 'sw' | 'se';
export interface Cell {
  x: number;
  y: number;
}
export interface Player {
  id: string;
  quadrant: Quadrant;
  eliminated: boolean;
  timedOutTurns: number;
  turnsStarted: number;
  revealed: string[];
  cardsSelected: Record<string, number>;
}
export interface Tower {
  id: string;
  ownerId: string;
  type: 'town_hall' | 'normal';
  cells: Cell[];
  health: number;
}
export type Action =
  | { type: 'build'; cell: Cell }
  | { type: 'upgrade'; towerId: string }
  | { type: 'expand'; towerId: string; cell: Cell }
  | { type: 'attack'; cell: Cell };
export type Command =
  | {
      type: 'select_card';
      cardId: string;
      targets: Record<string, TargetValue>;
    }
  | Action
  | { type: 'end_turn' }
  | { type: 'timeout' }
  | { type: 'forfeit'; playerId: string };
export type TargetValue = Cell | string;
export type Trigger =
  | 'on_selected'
  | 'before_attack'
  | 'after_damage'
  | 'on_build'
  | 'on_turn_start';
export type EffectDefinition =
  | { type: 'neutral'; trigger: Trigger }
  | {
      type: 'heal';
      trigger: Trigger;
      amount: number;
      target: string | 'event_tower';
    }
  | { type: 'reveal'; trigger: Trigger; target: string }
  | { type: 'prevent_damage'; trigger: 'before_attack'; amount: number };
export type DurationDefinition =
  | { type: 'this_turn' }
  | { type: 'owner_turns'; count: number }
  | { type: 'rounds'; count: number }
  | { type: 'match' };
export interface TargetDefinition {
  id: string;
  kind: 'own_tower' | 'damaged_own_tower' | 'enemy_cell' | 'hidden_enemy_cell';
  timing: 'on_selected';
  fallback: 'first_legal';
}
export type EligibilityRule =
  | { type: 'minimum_round'; round: number }
  | { type: 'has_own_tower_below_health'; health: number };
export interface AbilityCardDefinition {
  id: string;
  version: number;
  name: string;
  description: string;
  rarityId: string;
  lifecycle: 'consumable' | 'passive';
  tags: string[];
  eligibility: EligibilityRule[];
  targets: TargetDefinition[];
  effects: EffectDefinition[];
  duration?: DurationDefinition;
  charges?: number;
  stacking: 'replace' | 'refresh' | 'stack' | 'unique';
  visibility: 'public' | 'owner_until_triggered';
  offerWeight: number;
  perMatchLimit?: number;
  artKey: string;
}
export interface RarityDefinition {
  id: string;
  rank: number;
  label: string;
  icon: string;
  color: string;
  unlockProgress: number;
  weights: { progress: number; weight: number }[];
}
export interface CardCatalog {
  version: string;
  cards: AbilityCardDefinition[];
  fallbackCardIds: string[];
}
export interface Balance {
  version: string;
  rarities: RarityDefinition[];
}
export interface EngineRegistry {
  catalogs: Record<string, CardCatalog>;
  balances: Record<string, Balance>;
}
export interface ActiveEffect {
  id: string;
  cardId: string;
  cardVersion: number;
  ownerId: string;
  targets: Record<string, TargetValue>;
  revealed: boolean;
  remainingCharges: number | null;
  expiresTurn: number | null;
  expiresOwnerTurn: number | null;
  expiresRound: number | null;
}
export interface Turn {
  playerId: string;
  number: number;
  round: number;
  actionsRemaining: number;
  cardOffer: string[];
  selectedCardId: string | null;
  deadline: number;
}
export interface GameEvent {
  sequence: number;
  playerId: string;
  type:
    | 'setup'
    | 'card_offer'
    | 'card_selected'
    | 'effect_triggered'
    | 'effect_expired'
    | 'turn_started'
    | 'turn_ended'
    | 'timeout'
    | 'eliminated'
    | 'match_ended'
    | Action['type'];
  // Details are server-only until match end. Projection explicitly allowlists fields.
  details: Record<string, unknown>;
}
export interface Score {
  playerId: string;
  points: number;
  health: number;
  townHall: boolean;
  timedOutTurns: number;
  turnOrderIndex: number;
  towers: { towerId: string; size: number; points: number }[];
}
export type TieBreaker = 'health' | 'town_hall' | 'timeouts' | 'turn_order';
export interface MatchResult {
  winnerId: string;
  reason: 'last_survivor' | 'round_limit';
  scores: Score[];
  tieBreakers: { criterion: TieBreaker; remainingPlayerIds: string[] }[];
}
export interface MatchState {
  id: string;
  preset: PresetId;
  cardCatalogVersion: string;
  balanceVersion: string;
  seed: number;
  rngState: number;
  nextId: number;
  version: number;
  lastCommandAt: number;
  players: Player[];
  turnOrder: string[];
  towers: Tower[];
  effects: ActiveEffect[];
  turn: Turn;
  history: GameEvent[];
  result: MatchResult | null;
}
export type Transition =
  | { ok: true; state: MatchState }
  | { ok: false; state: MatchState; error: string };
