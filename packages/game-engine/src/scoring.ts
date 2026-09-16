import type { MatchResult, MatchState, Score, TieBreaker } from './types.js';

export function towerPoints(size: number): number {
  if (!Number.isInteger(size) || size < 1)
    throw new Error('Tower size must be positive');
  return size <= 2 ? size : size === 3 ? 5 : size * 2;
}
export function scoreMatch(state: MatchState): Score[] {
  return state.players.map((player) => {
    const towers = state.towers.filter((tower) => tower.ownerId === player.id);
    return {
      playerId: player.id,
      points: player.eliminated
        ? 0
        : towers.reduce(
            (sum, tower) => sum + towerPoints(tower.cells.length),
            0,
          ),
      health: towers.reduce((sum, tower) => sum + tower.health, 0),
      townHall: towers.some((tower) => tower.type === 'town_hall'),
      timedOutTurns: player.timedOutTurns,
      turnOrderIndex: state.turnOrder.indexOf(player.id),
      towers: towers.map((tower) => ({
        towerId: tower.id,
        size: tower.cells.length,
        points: towerPoints(tower.cells.length),
      })),
    };
  });
}
export function determineResult(
  state: MatchState,
  reason: MatchResult['reason'],
): MatchResult {
  const scores = scoreMatch(state);
  let contenders = scores.filter(
    (score) => !state.players.find((p) => p.id === score.playerId)!.eliminated,
  );
  if (!contenders.length) throw new Error('Match has no survivor');
  const tieBreakers: MatchResult['tieBreakers'] = [];
  if (reason === 'round_limit') {
    const best = Math.max(...contenders.map((score) => score.points));
    contenders = contenders.filter((score) => score.points === best);
    const criteria: [TieBreaker, (score: Score) => number][] = [
      ['health', (s) => s.health],
      ['town_hall', (s) => Number(s.townHall)],
      ['timeouts', (s) => -s.timedOutTurns],
      ['turn_order', (s) => -s.turnOrderIndex],
    ];
    for (const [criterion, value] of criteria) {
      if (contenders.length === 1) break;
      const maximum = Math.max(...contenders.map(value));
      contenders = contenders.filter((s) => value(s) === maximum);
      tieBreakers.push({
        criterion,
        remainingPlayerIds: contenders.map((s) => s.playerId),
      });
    }
  }
  return { winnerId: contenders[0]!.playerId, reason, scores, tieBreakers };
}
