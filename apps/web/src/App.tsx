import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  connect,
  forgetSeat,
  leave,
  reconnect,
  resume,
  retryPending,
  send,
  useGame,
} from './client';
import { marks, presets } from './board-model';
import { Icon } from './Icon';
import { Game } from './Game';
import styles from './App.module.css';

export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      aria-label={title}
      ref={ref}
      className={styles.dialog}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className={styles.dialogHeader}>
        <h2>{title}</h2>
        <button aria-label="Close" onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Help({ close }: { close: () => void }) {
  return (
    <Dialog title="How to play" close={close}>
      <div className={styles.rules}>
        <p>
          Four players. One quadrant each. Keep at least one tower alive and
          finish with the most points.
        </p>
        <h3>Your turn</h3>
        <p>
          Choose one of three cards, take two actions, then end your turn. You
          have 90 seconds total. Actions can repeat.
        </p>
        <dl>
          <dt>Build</dt>
          <dd>
            Place a new tower on an empty cell in your quadrant. It starts with
            1 health.
          </dd>
          <dt>Upgrade</dt>
          <dd>Add 1 health to a tower, up to 10.</dd>
          <dt>Expand</dt>
          <dd>
            Add an empty cell next to your tower. Only shared edges count.
            Touching towers stay separate.
          </dd>
          <dt>Attack</dt>
          <dd>
            Reveal an enemy cell. If occupied, deal 1 damage to its tower.
          </dd>
        </dl>
        <h3>Towers & fog</h3>
        <p>
          A tower shares health across all its cells. At zero, the whole tower
          disappears. Losing your last tower eliminates you; losing only your
          Town Hall does not. Town Halls start with 3 health.
        </p>
        <p>
          Revealed cells stay visible and show live changes. Hidden parts of a
          tower stay hidden, even after a hit.
        </p>
        <h3>Scoring</h3>
        <p>
          Towers score by size: 1 cell = 1 point, 2 = 2, 3 = 5, and 4 or more =
          twice their size. Health does not add points.
        </p>
        <p>
          Ties break by total health, surviving Town Hall, fewer timeouts, then
          earlier turn order. The last surviving player wins immediately.
        </p>
        <h3>Rejoining</h3>
        <p>
          Refresh to return to your seat. The timer keeps running while
          disconnected. On timeout, the server resolves a card and any remaining
          actions. Use separate devices or browser profiles for different
          players.
        </p>
        <h3>Board controls</h3>
        <p>
          Scroll or drag to pan. Use + and − to zoom, or My quadrant to return
          home. Arrow keys move between cells; Shift + arrows pan. Enter
          selects, Escape cancels.
        </p>
        <h3>Install on your phone</h3>
        <p>
          In Safari, use Share → Add to Home Screen. In Chrome, use the browser
          menu → Install app or Add to Home screen. Online access is required to
          play.
        </p>
      </div>
    </Dialog>
  );
}
function Home() {
  const { connection, pending, identity } = useGame();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [preset, setPreset] = useState<keyof typeof presets>('medium');
  async function submit(e: FormEvent) {
    e.preventDefault();
    useGame.setState({ home: false });
    await send(
      mode === 'create' ? 'room:create' : 'room:join',
      mode === 'create'
        ? { displayName: name, preset }
        : { displayName: name, code },
    );
  }
  return (
    <main id="main" className={styles.home}>
      <div className={styles.homeArt} aria-hidden="true">
        <div className={styles.miniBoard}>
          {Array.from({ length: 64 }, (_, i) => (
            <span key={i} data-player={(i % 8 < 4 ? 0 : 1) + (i < 32 ? 0 : 2)}>
              {[9, 14, 22, 41, 45, 54].includes(i) && (
                <Icon name="tower" size={32} />
              )}
            </span>
          ))}
        </div>
      </div>
      <section className={styles.homeForm}>
        <h1>
          Quadrant <br />
          Towers<span className={styles.titleDot}>.</span>
        </h1>
        {identity ? (
          <div className={styles.resume}>
            <button className={styles.primary} onClick={resume}>
              Resume room {identity.code}
              <Icon name="arrow" />
            </button>
            <button onClick={forgetSeat}>Use a different seat</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className={styles.tabs}>
              <button
                type="button"
                aria-pressed={mode === 'create'}
                onClick={() => setMode('create')}
              >
                Create room
              </button>
              <button
                type="button"
                aria-pressed={mode === 'join'}
                onClick={() => setMode('join')}
              >
                Join room
              </button>
            </div>
            <label className={styles.field}>
              Your name
              <input
                autoComplete="nickname"
                value={name}
                required
                maxLength={48}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {mode === 'join' ? (
              <label className={styles.field}>
                Room code
                <input
                  className={styles.codeInput}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  value={code}
                  required
                  maxLength={6}
                  pattern="[A-Za-z]{6}"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </label>
            ) : (
              <fieldset className={styles.presets}>
                <legend>Board size</legend>
                {Object.entries(presets).map(([id, p]) => (
                  <label
                    key={id}
                    className={styles.preset}
                    data-checked={preset === id}
                  >
                    <input
                      type="radio"
                      name="preset"
                      value={id}
                      checked={preset === id}
                      onChange={() => setPreset(id as keyof typeof presets)}
                    />
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.quadrant}×{p.quadrant} each · {p.board}×{p.board}{' '}
                        board
                      </small>
                    </span>
                    <span>
                      <strong>{p.duration}</strong>
                      <small>{p.rounds} rounds</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <button
              className={styles.primary}
              disabled={connection !== 'online' || !!pending}
            >
              {pending
                ? 'Connecting…'
                : mode === 'create'
                  ? 'Create room'
                  : 'Join room'}
              <Icon name="arrow" />
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
function Lobby() {
  const { room, identity, pending, connection, offset } = useGame();
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!room) return null;
  const host = room.hostPlayerId === identity?.playerId;
  const ready =
    room.players.length === 4 && room.players.every((p) => p.connected);
  const p = presets[room.preset];
  return (
    <main id="main" className={styles.lobby}>
      <div className={styles.lobbyHeading}>
        <div>
          <span className={styles.muted}>Room</span>
          <h1 className={styles.roomCode}>{room.code}</h1>
        </div>
        <button
          aria-label={copied ? 'Code copied' : 'Copy room code'}
          onClick={() => {
            if (!navigator.clipboard) {
              useGame.setState({ error: `Copy this room code: ${room.code}` });
              return;
            }
            void navigator.clipboard
              .writeText(room.code)
              .then(() => setCopied(true))
              .catch(() =>
                useGame.setState({
                  error: `Copy this room code: ${room.code}`,
                }),
              );
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} />
        </button>
      </div>
      <p className={styles.lobbySummary}>
        {p.name} · {p.board}×{p.board} · {p.rounds} rounds · {p.duration}
      </p>
      <div className={styles.seats}>
        {Array.from({ length: 4 }, (_, i) => {
          const seat = room.players.find((p) => p.seat === i);
          return (
            <div key={i} className={styles.seat} data-player={i}>
              <span className={styles.playerMark}>
                <Icon name={marks[i]!} size={28} />
              </span>
              <div>
                <strong>{seat?.displayName ?? 'Waiting for player'}</strong>
                <small>
                  {seat
                    ? seat.connected
                      ? seat.id === room.hostPlayerId
                        ? 'Host'
                        : 'Ready'
                      : 'Disconnected'
                    : 'Open seat'}
                </small>
              </div>
              {seat &&
                !seat.connected &&
                host &&
                seat.removableAt !== null &&
                now + offset >= seat.removableAt && (
                  <button
                    disabled={!!pending}
                    onClick={() =>
                      void send('room:remove', { playerId: seat.id })
                    }
                  >
                    Remove
                  </button>
                )}
            </div>
          );
        })}
      </div>
      <div className={styles.lobbyFooter}>
        {host ? (
          <button
            className={styles.primary}
            disabled={!ready || !!pending || connection !== 'online'}
            onClick={() =>
              void send('match:start', { commandId: crypto.randomUUID() })
            }
          >
            Start game
            <Icon name="arrow" />
          </button>
        ) : (
          <p className={styles.muted}>Waiting for the host to start</p>
        )}
        <button
          disabled={!!pending || connection !== 'online'}
          onClick={() => void leave()}
        >
          Leave room
        </button>
      </div>
    </main>
  );
}
export default function App() {
  const [help, setHelp] = useState(location.pathname === '/help');
  const {
    connection,
    error,
    uncertain,
    pending,
    room,
    match,
    home,
    storageWarning,
  } = useGame();
  useEffect(() => {
    connect();
    const pop = () => setHelp(location.pathname === '/help');
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  function showHelp(open: boolean) {
    setHelp(open);
    history.pushState(null, '', open ? '/help' : '/');
  }
  return (
    <>
      <a className={styles.skip} href="#main">
        Skip to game
      </a>
      <header className={styles.header}>
        <a
          className={styles.brand}
          href="/"
          onClick={(e) => {
            e.preventDefault();
            if (help) showHelp(false);
          }}
          aria-label="Quadrant Towers"
        >
          <Icon name="tower" />
          <span>Quadrant Towers</span>
        </a>
        <button aria-label="How to play" onClick={() => showHelp(true)}>
          <Icon name="help" />
        </button>
      </header>
      {connection !== 'online' && (
        <div className={styles.connection} role="status">
          <span>
            {connection === 'replaced'
              ? 'This seat is open in another tab.'
              : connection === 'offline'
                ? 'Connection lost. Your turn timer keeps running.'
                : connection === 'syncing'
                  ? 'Restoring your game…'
                  : 'Connecting…'}
          </span>
          {['offline', 'replaced'].includes(connection) && (
            <button onClick={reconnect}>Reconnect</button>
          )}
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          {uncertain ? (
            <button
              disabled={connection !== 'online'}
              onClick={() => void retryPending()}
            >
              Check result
            </button>
          ) : (
            <button
              aria-label="Dismiss error"
              onClick={() => useGame.setState({ error: null })}
            >
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
      )}
      {storageWarning && (
        <p className={styles.error}>
          Your browser could not save this seat. Keep this tab open to stay in
          the game.
        </p>
      )}
      {home || !room ? (
        <Home />
      ) : room.status === 'lobby' ? (
        <Lobby />
      ) : match ? (
        <Game key={match.matchId} />
      ) : (
        <main id="main" className={styles.loading} role="status">
          Loading board…
        </main>
      )}
      {pending && !uncertain && (
        <span className={styles.saving} role="status">
          Saving…
        </span>
      )}
      {help && <Help close={() => showHelp(false)} />}
    </>
  );
}
