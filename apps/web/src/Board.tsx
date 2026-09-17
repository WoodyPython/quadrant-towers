import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import type { MatchView, RoomView } from '@quadrant/protocol';
import {
  cellLabel,
  coordinate,
  isAvailable,
  key,
  quadrant,
  type Point,
} from './board-model';
import { Icon } from './Icon';
import styles from './App.module.css';

const BoardCell = memo(function BoardCell({
  x,
  y,
  label,
  fog,
  health,
  hall,
  owner,
  edge,
  joined,
  legal,
  selected,
  focused,
  unavailable,
  onSelect,
  onFocus,
}: {
  x: number;
  y: number;
  label: string;
  fog: boolean;
  health: number;
  hall: boolean;
  owner: number;
  edge: string;
  joined: string;
  legal: boolean;
  selected: boolean;
  focused: boolean;
  unavailable: boolean;
  onSelect: (p: Point) => void;
  onFocus: (p: Point) => void;
}) {
  return (
    <button
      type="button"
      data-cell={`${x},${y}`}
      data-player={owner}
      data-fog={fog}
      data-legal={legal}
      data-selected={selected}
      data-unavailable={unavailable}
      data-edge={edge}
      className={styles.cell}
      aria-label={label}
      aria-disabled={unavailable}
      aria-pressed={selected}
      tabIndex={focused ? 0 : -1}
      onFocus={() => onFocus({ x, y })}
      onClick={() => {
        if (!unavailable) onSelect({ x, y });
      }}
    >
      {health > 0 && (
        <span
          className={styles.piece}
          data-joined={joined}
          key={`${health}-${hall}`}
        >
          <Icon name={hall ? 'tower' : 'square'} size={22} />
          <span className={styles.cellHealth}>{health}</span>
        </span>
      )}
      {legal && !health && <span className={styles.targetDot} />}
    </button>
  );
});
export const Board = memo(function Board({
  view,
  room,
  playerId,
  legal,
  selected,
  preview = new Set<string>(),
  onSelect,
}: {
  view: MatchView;
  room: RoomView;
  playerId: string;
  legal: Set<string>;
  selected: Point | null;
  preview?: Set<string>;
  onSelect: (p: Point) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const size = view.dimensions.boardSize;
  const ownQuadrant =
    view.players.find((p) => p.id === playerId)?.quadrant ?? 'nw';
  const ownOrigin = {
    x: ownQuadrant.endsWith('e') ? size / 2 : 0,
    y: ownQuadrant.startsWith('s') ? size / 2 : 0,
  };
  const positioned = useRef(false);
  const [available, setAvailable] = useState(640);
  const [zoom, setZoom] = useState(1);
  const [overview, setOverview] = useState(false);
  const [focused, setFocused] = useState<Point>(ownOrigin);
  const dragging = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    distance: number;
    zoom: number;
    overview: boolean;
    midX: number;
    midY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const coarse =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(pointer: coarse)').matches;
  const fitted = Math.max(8, Math.floor((available - 36) / size));
  const minimum = coarse ? 44 : 28;
  const cellSize = overview ? fitted : Math.max(minimum, fitted) * zoom;
  const live = useRef({ zoom, overview, minimum, fitted });
  const zoomScroll = useRef<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    live.current = { zoom, overview, minimum, fitted };
    const el = viewport.current;
    if (el && zoomScroll.current) {
      // Apply after the grid resizes, so the old scroll bounds cannot clamp it.
      el.scrollLeft = zoomScroll.current.left;
      el.scrollTop = zoomScroll.current.top;
      zoomScroll.current = null;
    }
  });
  const zoomAt = useCallback(
    (
      next: number,
      oldCellSize: number,
      anchorX: number,
      anchorY: number,
      offsetX: number,
      offsetY: number,
    ) => {
      const current = live.current;
      if (!current.overview && next === current.zoom) return;
      const ratio =
        (Math.max(current.minimum, current.fitted) * next) / oldCellSize;
      // The coordinate axis stays 24px wide at every zoom level.
      zoomScroll.current = {
        left: 24 + (anchorX - 24) * ratio - offsetX,
        top: 24 + (anchorY - 24) * ratio - offsetY,
      };
      setOverview(false);
      setZoom(next);
    },
    [],
  );
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const current = live.current;
      const base = current.overview ? 1 : current.zoom;
      const oldCellSize = current.overview
        ? current.fitted
        : Math.max(current.minimum, current.fitted) * base;
      const next = Math.min(
        3,
        Math.max(1, base * Math.exp(-e.deltaY * 0.0018)),
      );
      const rect = el.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      zoomAt(
        next,
        oldCellSize,
        offsetX + el.scrollLeft,
        offsetY + el.scrollTop,
        offsetX,
        offsetY,
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (positioned.current || !el || available !== el.clientWidth) return;
    positioned.current = true;
    if (coarse || size > 16)
      el.scrollTo(ownOrigin.x * cellSize, ownOrigin.y * cellSize);
  }, [available, cellSize, coarse, size, ownOrigin.x, ownOrigin.y]);
  const pick = useCallback(
    (point: Point) => {
      if (overview && cellSize < minimum) {
        setOverview(false);
        setZoom(1);
        requestAnimationFrame(() =>
          viewport.current?.scrollTo({
            left: Math.max(0, point.x * minimum - available / 2),
            top: Math.max(
              0,
              point.y * minimum - (viewport.current?.clientHeight ?? 300) / 2,
            ),
          }),
        );
        return;
      }
      onSelect(point);
    },
    [overview, cellSize, minimum, available, onSelect],
  );
  const names = useMemo(
    () => new Map(room.players.map((p) => [p.id, p.displayName])),
    [room.players],
  );
  const closedQuadrants = (['nw', 'ne', 'sw', 'se'] as const).filter(
    (quadrant) => !view.players.some((player) => player.quadrant === quadrant),
  );
  const onFocus = useCallback((p: Point) => setFocused(p), []);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setAvailable(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const start = () => {
      suppressClick.current = false;
    };
    el.addEventListener('touchstart', start, { passive: true });
    const move = () => {
      suppressClick.current = true;
    };
    el.addEventListener('touchmove', move, { passive: true });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
    };
  }, []);
  function navigate(event: KeyboardEvent) {
    const movement: Record<string, Point> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    };
    const direction = movement[event.key];
    if (!direction) return;
    event.preventDefault();
    if (event.shiftKey) {
      viewport.current?.scrollBy({
        left: direction.x * cellSize * 3,
        top: direction.y * cellSize * 3,
      });
      return;
    }
    const next = {
      x: Math.max(0, Math.min(size - 1, focused.x + direction.x)),
      y: Math.max(0, Math.min(size - 1, focused.y + direction.y)),
    };
    setFocused(next);
    const cell = viewport.current?.querySelector<HTMLButtonElement>(
      `[data-cell="${key(next)}"]`,
    );
    cell?.focus({ preventScroll: true });
    cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function myQuadrant() {
    const q = view.players.find((p) => p.id === playerId)?.quadrant ?? 'nw';
    const x = q.endsWith('e') ? size / 2 : 0;
    const y = q.startsWith('s') ? size / 2 : 0;
    setOverview(false);
    setZoom(1);
    requestAnimationFrame(() =>
      viewport.current?.scrollTo({
        left: x * Math.max(minimum, fitted),
        top: y * Math.max(minimum, fitted),
        behavior: 'instant',
      }),
    );
  }
  return (
    <section className={styles.boardSection} aria-label="Game board">
      <div className={styles.boardTools}>
        <button
          onClick={() => {
            setZoom(1);
            setOverview(true);
            viewport.current?.scrollTo(0, 0);
          }}
        >
          Fit board
        </button>
        <button onClick={myQuadrant}>My quadrant</button>
      </div>
      <div
        ref={viewport}
        className={styles.boardViewport}
        onKeyDown={navigate}
        onPointerDown={(e) => {
          if (e.pointerType === 'touch') {
            touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (touches.current.size === 2) {
              suppressClick.current = true;
              const [a, b] = [...touches.current.values()] as [
                { x: number; y: number },
                { x: number; y: number },
              ];
              pinch.current = {
                distance: Math.hypot(a.x - b.x, a.y - b.y),
                zoom: overview ? 1 : zoom,
                overview,
                midX: (a.x + b.x) / 2,
                midY: (a.y + b.y) / 2,
                scrollLeft: e.currentTarget.scrollLeft,
                scrollTop: e.currentTarget.scrollTop,
              };
            }
            return;
          }
          if (e.pointerType !== 'mouse' || e.button !== 0) return;
          suppressClick.current = false;
          dragging.current = {
            x: e.clientX,
            y: e.clientY,
            left: e.currentTarget.scrollLeft,
            top: e.currentTarget.scrollTop,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          if (e.pointerType === 'touch') {
            if (!touches.current.has(e.pointerId)) return;
            touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const p = pinch.current;
            if (touches.current.size === 2 && p) {
              e.preventDefault();
              const [a, b] = [...touches.current.values()] as [
                { x: number; y: number },
                { x: number; y: number },
              ];
              const distance = Math.hypot(a.x - b.x, a.y - b.y);
              const next = Math.min(
                3,
                Math.max(1, p.zoom * (distance / p.distance)),
              );
              const oldCellSize = p.overview
                ? fitted
                : Math.max(minimum, fitted) * p.zoom;
              const rect = e.currentTarget.getBoundingClientRect();
              const offsetX = p.midX - rect.left;
              const offsetY = p.midY - rect.top;
              zoomAt(
                next,
                oldCellSize,
                offsetX + p.scrollLeft,
                offsetY + p.scrollTop,
                offsetX,
                offsetY,
              );
            }
            return;
          }
          const d = dragging.current;
          if (!d) return;
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
          if (Math.hypot(dx, dy) > 7) {
            d.moved = true;
            suppressClick.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          if (d.moved) {
            e.currentTarget.scrollLeft = d.left - dx;
            e.currentTarget.scrollTop = d.top - dy;
          }
        }}
        onPointerUp={(e) => {
          if (e.pointerType === 'touch') {
            touches.current.delete(e.pointerId);
            if (touches.current.size < 2) pinch.current = null;
            return;
          }
          dragging.current = null;
        }}
        onPointerCancel={(e) => {
          if (e.pointerType === 'touch') {
            touches.current.delete(e.pointerId);
            if (touches.current.size < 2) pinch.current = null;
            return;
          }
          dragging.current = null;
        }}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.stopPropagation();
            e.preventDefault();
            suppressClick.current = false;
          }
        }}
      >
        <div
          className={styles.boardGrid}
          style={
            {
              '--cell': `${cellSize}px`,
              '--size': size,
              '--quadrant': size / 2,
            } as CSSProperties
          }
        >
          <span />
          {Array.from({ length: size }, (_, x) => (
            <span key={x} className={styles.axis}>
              {coordinate({ x, y: 0 }).replace('1', '')}
            </span>
          ))}
          {Array.from({ length: size }, (_, y) => (
            <div className={styles.boardRow} key={y}>
              <span className={styles.axis}>{y + 1}</span>
              {view.cells.slice(y * size, (y + 1) * size).map((c) => {
                const tower = c.visibility === 'visible' ? c.tower : null;
                const joined = tower
                  ? (
                      [
                        ['top', 0, -1],
                        ['right', 1, 0],
                        ['bottom', 0, 1],
                        ['left', -1, 0],
                      ] as const
                    )
                      .filter(([, dx, dy]) => {
                        const x = c.cell.x + dx,
                          y = c.cell.y + dy;
                        if (x < 0 || x >= size || y < 0 || y >= size)
                          return false;
                        const neighbor = view.cells[y * size + x];
                        return (
                          neighbor?.visibility === 'visible' &&
                          neighbor.tower?.id === tower.id
                        );
                      })
                      .map(([side]) => side)
                      .join(' ')
                  : '';
                const q = quadrant(c.cell, size / 2);
                const p = view.players.find((p) => p.quadrant === q);
                const unavailable = !isAvailable(view, c.cell);
                const owner =
                  room.players.find((p2) => p2.id === p?.id)?.seat ?? 0;
                return (
                  <BoardCell
                    key={key(c.cell)}
                    x={c.cell.x}
                    y={c.cell.y}
                    label={
                      unavailable
                        ? `${coordinate(c.cell)}, unavailable region`
                        : cellLabel(c, names)
                    }
                    fog={c.visibility === 'hidden'}
                    health={tower?.health ?? 0}
                    hall={tower?.type === 'town_hall'}
                    owner={owner}
                    edge={`${c.cell.x === size / 2 ? 'left ' : ''}${c.cell.y === size / 2 ? 'top' : ''}`}
                    joined={joined}
                    legal={legal.has(key(c.cell))}
                    selected={
                      preview.has(key(c.cell)) ||
                      (!!selected && key(selected) === key(c.cell))
                    }
                    focused={key(focused) === key(c.cell)}
                    unavailable={unavailable}
                    onSelect={pick}
                    onFocus={onFocus}
                  />
                );
              })}
            </div>
          ))}
          {closedQuadrants.map((quadrant) => (
            <span
              key={quadrant}
              className={styles.closedQuadrant}
              data-quadrant={quadrant}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    </section>
  );
});
