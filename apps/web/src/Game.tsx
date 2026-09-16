import { useCallback, useEffect, useMemo, useState } from 'react';
import { leave, mutation, send, useGame } from './client';
import {
  coordinate,
  cardTitle,
  cardDescription,
  eventText,
  key,
  marks,
  secondsLeft,
  targetsFor,
  type Action,
  type Point,
} from './board-model';
import { Board } from './Board';
import { Icon } from './Icon';
import { Dialog } from './App';
import styles from './App.module.css';

function Timer() {
  const deadline = useGame((s) => s.match?.turn.deadline ?? 0);
  const offset = useGame((s) => s.offset);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const id = setInterval(update, 250);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const seconds = secondsLeft(deadline, offset, now);
  return (
    <span
      className={styles.timer}
      data-urgent={seconds <= 15}
      aria-label={`${seconds} seconds remaining`}
    >
      <Icon name="clock" size={18} />
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}
type Selection = {
  version: number;
  action: Action | null;
  towerId: string | null;
  cell: Point | null;
  cardId: string | null;
  targets: Record<string, Point | string>;
};
export function Game() {
  const {
    match: view,
    room,
    identity,
    content,
    connection,
    pending,
  } = useGame();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [leaving, setLeaving] = useState(false);
  const clear = useCallback(() => setSelection(null), []);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [clear]);
  const s = selection?.version === view?.version ? selection : null;
  const playerId = identity?.playerId ?? '';
  const myTurn = view?.turn.playerId === playerId && !view?.result;
  const eliminated = view?.players.find((p) => p.id === playerId)?.eliminated;
  const enabled =
    connection === 'online' && !pending && !!content && myTurn && !eliminated;
  const card = content?.cards.find((c) => c.id === s?.cardId);
  const target = card?.targets.find((t) => s?.targets[t.id] === undefined);
  const mode =
    target?.kind ??
    (s?.action === 'expand' && !s.towerId ? 'own_tower' : (s?.action ?? ''));
  const legal = useMemo(
    () =>
      view && enabled
        ? targetsFor(view, playerId, mode, s?.towerId ?? undefined)
        : new Set<string>(),
    [view, enabled, playerId, mode, s?.towerId],
  );
  const base = useCallback(
    (): Selection => ({
      version: view!.version,
      action: null,
      towerId: null,
      cell: null,
      cardId: null,
      targets: {},
    }),
    [view],
  );
  const select = useCallback(
    (p: Point) => {
      if (!view) return;
      const c = view.cells.find((c) => key(c.cell) === key(p));
      const tower = c?.visibility === 'visible' ? c.tower : null;
      if (!enabled || !mode) {
        setSelection({ ...base(), cell: p, towerId: tower?.id ?? null });
        return;
      }
      if (!legal.has(key(p))) return;
      if (target) {
        setSelection({
          ...s!,
          cell: p,
          targets: {
            ...s!.targets,
            [target.id]: target.kind.includes('tower') ? tower!.id : p,
          },
        });
        return;
      }
      if (s?.action === 'attack') {
        setSelection({ ...s, cell: p });
        return;
      }
      if (s?.action === 'expand' && !s.towerId) {
        setSelection({ ...s, towerId: tower!.id, cell: p });
        return;
      }
      if (s?.action) {
        const action =
          s.action === 'upgrade'
            ? { type: s.action, towerId: tower!.id }
            : s.action === 'expand'
              ? { type: s.action, towerId: s.towerId!, cell: p }
              : { type: s.action, cell: p };
        void send('action:submit', { ...mutation(), action }).then((ok) => {
          if (ok) clear();
        });
      }
    },
    [view, enabled, mode, base, legal, target, s, clear],
  );
  const cardNames = useMemo(
    () => new Map(content?.cards.map((c) => [c.id, cardTitle(c.name)]) ?? []),
    [content],
  );
  if (!view || !room || !identity) return null;
  const selectedCell = s?.cell
    ? view.cells.find((c) => key(c.cell) === key(s.cell!))
    : null;
  const tower =
    selectedCell?.visibility === 'visible' ? selectedCell.tower : null;
  const actor = room.players.find((p) => p.id === view.turn.playerId);
  const winner = room.players.find((p) => p.id === view.result?.winnerId);
  const chooseCard = myTurn && view.turn.selectedCardId === null;
  const actionsAvailable =
    enabled && !chooseCard && view.turn.actionsRemaining > 0;
  const history = view.result
    ? view.history
    : view.history.filter(
        (e) =>
          !['card_offer', 'setup', 'turn_started', 'turn_ended'].includes(
            e.type,
          ),
      );
  const instruction = target
    ? {
        own_tower: 'Choose one of your towers',
        damaged_own_tower: 'Choose a tower below 10 health',
        enemy_cell: 'Choose an enemy cell',
        hidden_enemy_cell: 'Choose a hidden enemy cell',
      }[target.kind]
    : s?.action === 'expand'
      ? s.towerId
        ? 'Choose an adjacent empty cell'
        : 'Choose a tower to expand'
      : s?.action === 'build'
        ? 'Choose an empty cell'
        : s?.action === 'upgrade'
          ? 'Choose a tower to upgrade'
          : s?.action === 'attack'
            ? 'Choose an enemy cell'
            : null;
  const cardPicker = chooseCard && !s?.cardId && (
    <div
      className={styles.cardOverlay}
      role="region"
      aria-labelledby="card-prompt"
    >
      <section className={styles.cardPicker}>
        <span className={styles.cardPromptLabel}>Your turn</span>
        <h1 id="card-prompt">Choose a card</h1>
        <p>Pick one card before taking your two actions.</p>
        <div className={styles.cards}>
          {view.turn.cardOffer?.map((id) => {
            const offeredCard = content?.cards.find((entry) => entry.id === id);
            const rarity = content?.rarities.find(
              (entry) => entry.id === offeredCard?.rarityId,
            );
            return (
              <button
                key={id}
                className={styles.card}
                disabled={!enabled || !offeredCard}
                onClick={() => setSelection({ ...base(), cardId: id })}
              >
                <span className={styles.cardIcon}>
                  <Icon
                    name={
                      offeredCard?.targets.some((entry) =>
                        entry.kind.includes('cell'),
                      )
                        ? 'eye'
                        : offeredCard?.lifecycle === 'passive'
                          ? 'shield'
                          : 'star'
                    }
                    size={30}
                  />
                </span>
                <span>
                  <strong>
                    {offeredCard
                      ? cardTitle(offeredCard.name)
                      : 'Loading card…'}
                  </strong>
                  <small className={styles.rarity}>
                    <Icon name={rarity?.icon ?? 'circle'} size={13} />
                    {rarity?.label ?? ''} ·{' '}
                    {offeredCard?.lifecycle === 'passive'
                      ? 'Passive'
                      : 'Consumable'}
                  </small>
                  <span className={styles.cardDescription}>
                    {offeredCard
                      ? cardDescription(offeredCard.description)
                      : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
  return (
    <main id="main" className={styles.game}>
      <div className={styles.players} aria-label="Players in turn order">
        {view.turnOrder.map((id) => {
          const p = room.players.find((p) => p.id === id)!;
          const state = view.players.find((p) => p.id === id)!;
          return (
            <div
              key={id}
              className={styles.player}
              data-player={p.seat}
              data-active={!view.result && id === view.turn.playerId}
              data-out={state.eliminated}
            >
              <Icon name={marks[p.seat]!} />
              <span>
                <strong>
                  {p.displayName}
                  {id === playerId ? ' (you)' : ''}
                </strong>
                <small>
                  {state.eliminated
                    ? 'Eliminated'
                    : !p.connected
                      ? 'Disconnected'
                      : state.quadrant.toUpperCase()}
                </small>
              </span>
              {!view.result && id === view.turn.playerId && (
                <span
                  className={styles.turnDot}
                  role="img"
                  aria-label="Current turn"
                />
              )}
            </div>
          );
        })}
      </div>
      <div className={styles.gameLayout}>
        <div className={styles.boardColumn}>
          <div className={styles.turnBar}>
            <span>
              {view.result ? (
                'Final board'
              ) : (
                <>
                  Round <strong>{view.turn.round}</strong>
                  <span className={styles.muted}>
                    {' '}
                    / {view.dimensions.rounds}
                  </span>
                </>
              )}
            </span>
            {!view.result && (
              <>
                <strong className={styles.turnName}>
                  {myTurn ? 'Your turn' : `${actor?.displayName}’s turn`}
                </strong>
                <Timer />
              </>
            )}
          </div>
          <div className={styles.boardStage}>
            <Board
              view={view}
              room={room}
              playerId={playerId}
              legal={legal}
              selected={s?.cell ?? null}
              onSelect={select}
            />
            {cardPicker}
          </div>
          <div className={styles.boardCaption}>
            {tower ? (
              <span>
                {tower.type === 'town_hall' ? 'Town Hall' : 'Tower'} ·{' '}
                {coordinate(selectedCell!.cell)} ·{' '}
                <span aria-label={`${tower.health} health`}>
                  {'★'.repeat(tower.health)} {tower.health}/10
                </span>
                {tower.ownerId === playerId
                  ? ` · ${view.cells.filter((c) => c.visibility === 'visible' && c.tower?.id === tower.id).length} cells`
                  : ''}
              </span>
            ) : s?.cell ? (
              <span>
                {coordinate(s.cell)} ·{' '}
                {selectedCell?.visibility === 'hidden' ? 'Hidden' : 'Empty'}
              </span>
            ) : (
              <span />
            )}
            <button onClick={() => setLeaving(true)}>
              <Icon name="home" size={18} />
              Home
            </button>
          </div>
        </div>
        <aside className={styles.controls} aria-label="Turn controls">
          {view.result ? (
            <section className={styles.results}>
              <Icon name="star" size={36} />
              <h1>{winner?.displayName} wins</h1>
              <p className={styles.muted}>
                {view.result.reason === 'last_survivor'
                  ? 'Last player standing'
                  : `${view.dimensions.rounds} rounds complete`}
              </p>
              <div className={styles.scores}>
                {[...view.result.scores]
                  .sort((a, b) => b.points - a.points)
                  .map((score) => (
                    <details key={score.playerId}>
                      <summary>
                        <span>
                          {
                            room.players.find((p) => p.id === score.playerId)
                              ?.displayName
                          }
                        </span>
                        <strong>{score.points} pts</strong>
                      </summary>
                      <p>
                        {score.health} health ·{' '}
                        {score.townHall ? 'Town Hall standing' : 'No Town Hall'}{' '}
                        · {score.timedOutTurns} timeouts
                      </p>
                      <ul>
                        {score.towers.map((t, i) => (
                          <li key={t.towerId}>
                            Tower {i + 1}: {t.size} cells → {t.points} points
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
              </div>
              {view.result.tieBreakers.length > 0 && (
                <p className={styles.tieBreak}>
                  Tie resolved by{' '}
                  {view.result.tieBreakers
                    .map(
                      (t) =>
                        ({
                          health: 'total health',
                          town_hall: 'Town Hall survival',
                          timeouts: 'fewer timeouts',
                          turn_order: 'earlier turn order',
                        })[t.criterion],
                    )
                    .join(' → ')}
                  .
                </p>
              )}
              <button
                className={styles.primary}
                disabled={
                  !!pending ||
                  connection !== 'online' ||
                  room.players.find((p) => p.id === playerId)?.rematchVote
                }
                onClick={() =>
                  void send('rematch:vote', {
                    commandId: crypto.randomUUID(),
                    matchId: view.matchId,
                  })
                }
              >
                {room.players.find((p) => p.id === playerId)?.rematchVote
                  ? 'Rematch requested'
                  : 'Play again'}
                <Icon name="arrow" />
              </button>
              <p className={styles.muted}>
                {room.players.filter((p) => p.rematchVote).length}/
                {room.players.length} votes ·{' '}
                {room.players.filter((p) => p.connected).length}/
                {room.players.length} connected
              </p>
              <ul className={styles.votes}>
                {room.players.map((p) => (
                  <li key={p.id}>
                    {p.displayName}
                    <span>
                      {p.rematchVote ? 'Voted' : 'Not voted'}
                      {!p.connected ? ' · Offline' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <>
              {(!chooseCard || s?.cardId) && (
                <div className={styles.actionHeading}>
                  <h1>
                    {eliminated
                      ? 'You’re eliminated'
                      : chooseCard
                        ? target
                          ? 'Choose a target'
                          : 'Confirm your card'
                        : myTurn
                          ? 'Your actions'
                          : 'Waiting for your turn'}
                  </h1>
                  {myTurn && !chooseCard && (
                    <span
                      className={styles.actionCount}
                      role="img"
                      aria-label={`${view.turn.actionsRemaining} actions remaining`}
                    >
                      {[0, 1].map((i) => (
                        <i
                          key={i}
                          data-filled={i < view.turn.actionsRemaining}
                        />
                      ))}
                    </span>
                  )}
                </div>
              )}
              {!chooseCard && (
                <div className={styles.actions}>
                  {(['build', 'upgrade', 'expand', 'attack'] as const).map(
                    (action) => (
                      <button
                        key={action}
                        aria-pressed={s?.action === action}
                        disabled={!actionsAvailable}
                        onClick={() => setSelection({ ...base(), action })}
                      >
                        <Icon name={action} size={30} />
                        <span>
                          {action[0]!.toUpperCase() + action.slice(1)}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              )}
              {instruction && (
                <div className={styles.targeting}>
                  <span>{instruction}</span>
                  <button aria-label="Cancel selection" onClick={clear}>
                    <Icon name="close" size={18} />
                  </button>
                </div>
              )}
              {card && (
                <div className={styles.confirm}>
                  <button
                    className={styles.primary}
                    disabled={!enabled || !!target}
                    onClick={() =>
                      void send('card:choose', {
                        ...mutation(),
                        cardId: card.id,
                        targets: s!.targets,
                      }).then((ok) => {
                        if (ok) clear();
                      })
                    }
                  >
                    Play {cardTitle(card.name)}
                    <Icon name="check" size={18} />
                  </button>
                  {Object.keys(s!.targets).length > 0 && (
                    <button
                      onClick={() =>
                        setSelection({ ...s!, targets: {}, cell: null })
                      }
                    >
                      Reselect target
                    </button>
                  )}
                  {Object.keys(s!.targets).length === 0 && !target && (
                    <button onClick={clear}>Choose another card</button>
                  )}
                </div>
              )}
              {s?.action === 'attack' && s.cell && (
                <button
                  className={styles.attackConfirm}
                  disabled={!actionsAvailable}
                  onClick={() =>
                    void send('action:submit', {
                      ...mutation(),
                      action: { type: 'attack', cell: s.cell! },
                    }).then((ok) => {
                      if (ok) clear();
                    })
                  }
                >
                  Attack {coordinate(s.cell)}
                  <Icon name="attack" size={18} />
                </button>
              )}
              {myTurn && !chooseCard && view.turn.actionsRemaining === 0 && (
                <button
                  className={styles.primary}
                  disabled={!enabled}
                  onClick={() => void send('turn:end', mutation())}
                >
                  End turn
                  <Icon name="arrow" />
                </button>
              )}
              {view.effects.length > 0 && (
                <details className={styles.effects} open>
                  <summary>
                    Active effects <span>{view.effects.length}</span>
                  </summary>
                  {view.effects.map((effect) => (
                    <div key={effect.id}>
                      <Icon name="shield" size={18} />
                      <span>
                        <strong>
                          {cardNames.get(effect.cardId) ?? 'Card effect'}
                        </strong>
                        <small>
                          {
                            room.players.find((p) => p.id === effect.ownerId)
                              ?.displayName
                          }
                          {effect.remainingCharges != null
                            ? ` · ${effect.remainingCharges} charge${effect.remainingCharges === 1 ? '' : 's'}`
                            : ''}
                          {effect.expiresRound != null
                            ? ` · ends at round ${effect.expiresRound}`
                            : effect.expiresTurn != null
                              ? ' · temporary'
                              : effect.expiresOwnerTurn != null
                                ? ' · expires on an owner turn'
                                : ''}
                        </small>
                      </span>
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
        </aside>
      </div>
      <div
        className={styles.srOnly}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {history.length
          ? eventText(history[history.length - 1]!, room, cardNames)
          : ''}
      </div>
      {leaving && (
        <Dialog
          title={view.result ? 'Return home?' : 'Leave the board?'}
          close={() => setLeaving(false)}
        >
          <p>
            {view.result
              ? 'Your seat remains available for a rematch.'
              : 'You can resume this seat from home, but you will be eliminated if you do not reconnect within one minute.'}
          </p>
          <div className={styles.dialogActions}>
            <button onClick={() => setLeaving(false)}>Stay</button>
            <button
              className={styles.primary}
              disabled={!!pending || connection !== 'online'}
              onClick={() => void leave()}
            >
              Go home
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
