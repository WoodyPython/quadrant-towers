import { allCells, cellKey, ownsCell, PRESETS, towerAt } from './board.js';
import type { Cell, MatchState } from './types.js';

export type VisibleCell =
  | { cell: Cell; visibility: 'hidden' }
  | {
      cell: Cell;
      visibility: 'visible';
      tower: {
        id: string;
        ownerId: string;
        type: 'normal' | 'town_hall';
        health: number;
      } | null;
    };
export function projectMatch(state: MatchState, playerId: string) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error('Unknown player');
  const ended = state.result !== null;
  const cells: VisibleCell[] = allCells(state.preset).map((cell) => {
    if (
      !ended &&
      !ownsCell(state, player, cell) &&
      !player.revealed.includes(cellKey(cell))
    )
      return { cell, visibility: 'hidden' };
    const tower = towerAt(state, cell);
    return {
      cell,
      visibility: 'visible',
      tower: tower
        ? {
            id: tower.id,
            ownerId: tower.ownerId,
            type: tower.type,
            health: tower.health,
          }
        : null,
    };
  });
  const view = {
    id: state.id,
    version: state.version,
    preset: state.preset,
    dimensions: PRESETS[state.preset],
    cardCatalogVersion: state.cardCatalogVersion,
    balanceVersion: state.balanceVersion,
    players: state.players.map((p) => ({
      id: p.id,
      quadrant: p.quadrant,
      eliminated: p.eliminated,
    })),
    turnOrder: [...state.turnOrder],
    turn: {
      playerId: state.turn.playerId,
      number: state.turn.number,
      round: state.turn.round,
      deadline: state.turn.deadline,
      actionsRemaining: state.turn.actionsRemaining,
      ...(ended || state.turn.playerId === playerId
        ? {
            cardOffer: [...state.turn.cardOffer],
            selectedCardId: state.turn.selectedCardId,
          }
        : {}),
    },
    cells,
    effects: state.effects
      .filter(
        (effect) => ended || effect.ownerId === playerId || effect.revealed,
      )
      .map((effect) => ({
        id: effect.id,
        cardId: effect.cardId,
        cardVersion: effect.cardVersion,
        ownerId: effect.ownerId,
        ...(ended || effect.ownerId === playerId
          ? {
              targets: effect.targets,
              remainingCharges: effect.remainingCharges,
              expiresTurn: effect.expiresTurn,
              expiresOwnerTurn: effect.expiresOwnerTurn,
              expiresRound: effect.expiresRound,
            }
          : {}),
      })),
    history: state.history
      .filter(
        (entry) =>
          ended || entry.type !== 'card_offer' || entry.playerId === playerId,
      )
      .filter(
        (entry) =>
          ended ||
          !['effect_expired'].includes(entry.type) ||
          entry.playerId === playerId ||
          typeof entry.details.publicCardId === 'string',
      )
      .map((entry) => ({
        sequence: entry.sequence,
        playerId: entry.playerId,
        type: entry.type,
        ...(ended || entry.playerId === playerId
          ? { details: entry.details }
          : typeof entry.details.publicCardId === 'string'
            ? { details: { cardId: entry.details.publicCardId } }
            : {}),
      }))
      .map((entry, index) => ({ ...entry, sequence: index + 1 })),
    result: state.result,
  };
  // Never return references through which a consumer could mutate authoritative state.
  return JSON.parse(JSON.stringify(view)) as typeof view;
}
