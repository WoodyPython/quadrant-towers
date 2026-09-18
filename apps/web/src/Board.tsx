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
  const surface = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const size = view.dimensions.boardSize;
  const ownQuadrant =
    view.players.find((p) => p.id === playerId)?.quadrant ?? 'nw';
  const ownOrigin = {
    x: ownQuadrant.endsWith('e') ? size / 2 : 0,
    y: ownQuadrant.startsWith('s') ? size / 2 : 0,
  };
  const [focused, setFocused] = useState<Point>(ownOrigin);
  const [zoomUi, setZoomUi] = useState({ cell: 1, fit: 1, max: 3 });
  const dragging = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    distance: number;
    cell: number;
    contentX: number;
    contentY: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const fitCell = useRef(1);
  const cellSize = useRef(1);
  const baseSide = useRef(1);
  const initialized = useRef(false);
  const animation = useRef<number | null>(null);
  const gestureFrame = useRef<number | null>(null);
  const wheelFrame = useRef<number | null>(null);
  const pendingGesture = useRef<{
    cell: number;
    contentX: number;
    contentY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const wheelFactor = useRef(1);
  const wheelPoint = useRef({ x: 0, y: 0 });
  const wheelCommit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coarse =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(pointer: coarse)').matches;
  const minimum = coarse ? 44 : 28;
  const limits = useCallback(() => {
    const fit = fitCell.current;
    return { fit, max: Math.max(minimum, fit) * 3 };
  }, [minimum]);
  const clampZoom = useCallback(
    (next: number) => {
      const { fit, max } = limits();
      return Math.min(max, Math.max(fit, next));
    },
    [limits],
  );
  const updateSurface = useCallback((next: number) => {
    const el = viewport.current;
    const boardSurface = surface.current;
    const boardGrid = grid.current;
    if (!el || !boardSurface || !boardGrid) return;
    const scale = next / fitCell.current;
    const side = baseSide.current * scale;
    boardSurface.style.width = `${side}px`;
    boardSurface.style.height = `${side}px`;
    boardGrid.style.transform = `scale(${scale})`;
    cellSize.current = next;
  }, []);
  const zoomToContent = useCallback(
    (
      nextValue: number,
      contentX: number,
      contentY: number,
      offsetX: number,
      offsetY: number,
    ) => {
      const el = viewport.current;
      if (!el) return;
      const next = clampZoom(nextValue);
      updateSurface(next);
      const scale = next / fitCell.current;
      el.scrollLeft = contentX * scale - offsetX;
      el.scrollTop = contentY * scale - offsetY;
    },
    [clampZoom, updateSurface],
  );
  const zoomAt = useCallback(
    (next: number, offsetX: number, offsetY: number) => {
      const el = viewport.current;
      if (!el) return;
      const scale = cellSize.current / fitCell.current;
      zoomToContent(
        next,
        (el.scrollLeft + offsetX) / scale,
        (el.scrollTop + offsetY) / scale,
        offsetX,
        offsetY,
      );
    },
    [zoomToContent],
  );
  const commitZoom = useCallback(() => {
    const { fit, max } = limits();
    setZoomUi({ cell: cellSize.current, fit, max });
  }, [limits]);
  const flushGesture = useCallback(() => {
    if (gestureFrame.current !== null) {
      cancelAnimationFrame(gestureFrame.current);
      gestureFrame.current = null;
    }
    const pending = pendingGesture.current;
    pendingGesture.current = null;
    if (pending)
      zoomToContent(
        pending.cell,
        pending.contentX,
        pending.contentY,
        pending.offsetX,
        pending.offsetY,
      );
  }, [zoomToContent]);
  const stopAnimation = useCallback(() => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  }, []);
  const animateZoom = useCallback(
    (targetValue: number, done?: () => void) => {
      const el = viewport.current;
      if (!el) return;
      stopAnimation();
      const target = clampZoom(targetValue);
      const start = cellSize.current;
      const offsetX = el.clientWidth / 2;
      const offsetY = el.clientHeight / 2;
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || Math.abs(target - start) < 0.01) {
        zoomAt(target, offsetX, offsetY);
        commitZoom();
        done?.();
        return;
      }
      const started = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - started) / 180);
        const eased = 1 - Math.pow(1 - progress, 3);
        zoomAt(start + (target - start) * eased, offsetX, offsetY);
        if (progress < 1) animation.current = requestAnimationFrame(tick);
        else {
          animation.current = null;
          commitZoom();
          done?.();
        }
      };
      animation.current = requestAnimationFrame(tick);
    },
    [clampZoom, commitZoom, stopAnimation, zoomAt],
  );
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      stopAnimation();
      const rect = el.getBoundingClientRect();
      wheelPoint.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      const unit =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      wheelFactor.current *= Math.exp(-e.deltaY * unit * 0.0018);
      if (wheelFrame.current === null)
        wheelFrame.current = requestAnimationFrame(() => {
          wheelFrame.current = null;
          const factor = wheelFactor.current;
          wheelFactor.current = 1;
          zoomAt(
            cellSize.current * factor,
            wheelPoint.current.x,
            wheelPoint.current.y,
          );
        });
      if (wheelCommit.current) clearTimeout(wheelCommit.current);
      wheelCommit.current = setTimeout(commitZoom, 120);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelCommit.current) clearTimeout(wheelCommit.current);
    };
  }, [commitZoom, stopAnimation, zoomAt]);
  const pick = useCallback((point: Point) => onSelect(point), [onSelect]);
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
    const boardGrid = grid.current;
    if (!el || !boardGrid) return;
    const measure = () => {
      const side = Math.min(el.clientWidth, el.clientHeight);
      if (!side) return;
      const oldFit = fitCell.current;
      const oldSide = baseSide.current * (cellSize.current / oldFit);
      const centerX = oldSide
        ? (el.scrollLeft + el.clientWidth / 2) / oldSide
        : 0.5;
      const centerY = oldSide
        ? (el.scrollTop + el.clientHeight / 2) / oldSide
        : 0.5;
      const wasFit =
        !initialized.current || Math.abs(cellSize.current - oldFit) < 0.5;
      const nextFit = Math.max(1, (side - 26) / size);
      fitCell.current = nextFit;
      baseSide.current = 26 + size * nextFit;
      boardGrid.style.setProperty('--cell', `${nextFit}px`);
      const next = wasFit ? nextFit : clampZoom(cellSize.current);
      updateSurface(next);
      el.scrollLeft =
        centerX * (baseSide.current * (next / nextFit)) - el.clientWidth / 2;
      el.scrollTop =
        centerY * (baseSide.current * (next / nextFit)) - el.clientHeight / 2;
      initialized.current = true;
      const { max } = limits();
      setZoomUi({ cell: next, fit: nextFit, max });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [clampZoom, limits, size, updateSurface]);
  useEffect(() => {
    return () => {
      stopAnimation();
      if (gestureFrame.current !== null)
        cancelAnimationFrame(gestureFrame.current);
      if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current);
    };
  }, [stopAnimation]);
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
        left: direction.x * cellSize.current * 3,
        top: direction.y * cellSize.current * 3,
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
    const target = Math.max(minimum, fitCell.current);
    animateZoom(target, () => {
      const el = viewport.current;
      if (!el) return;
      const scale = target / fitCell.current;
      const quadrant = size / 2;
      el.scrollTo({
        left:
          (24 + (x + quadrant / 2) * fitCell.current) * scale -
          el.clientWidth / 2,
        top:
          (24 + (y + quadrant / 2) * fitCell.current) * scale -
          el.clientHeight / 2,
        behavior: 'instant',
      });
    });
  }
  return (
    <section className={styles.boardSection} aria-label="Game board">
      <div className={styles.boardTools}>
        <button onClick={() => animateZoom(fitCell.current)}>Fit board</button>
        <button onClick={myQuadrant}>My quadrant</button>
        <span className={styles.spacer} />
        <div
          className={styles.zoomControls}
          role="group"
          aria-label="Board zoom controls"
        >
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            disabled={zoomUi.cell <= zoomUi.fit + 0.01}
            onClick={() => animateZoom(cellSize.current / 1.25)}
          >
            <Icon name="minus" size={18} />
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            disabled={zoomUi.cell >= zoomUi.max - 0.01}
            onClick={() => animateZoom(cellSize.current * 1.25)}
          >
            <Icon name="build" size={18} />
          </button>
        </div>
      </div>
      <div
        ref={viewport}
        className={styles.boardViewport}
        onKeyDown={navigate}
        onPointerDown={(e) => {
          stopAnimation();
          if (e.pointerType === 'touch') {
            e.currentTarget.setPointerCapture(e.pointerId);
            if (touches.current.size === 0) suppressClick.current = false;
            touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (touches.current.size === 2) {
              suppressClick.current = true;
              dragging.current = null;
              const [a, b] = [...touches.current.values()] as [
                { x: number; y: number },
                { x: number; y: number },
              ];
              const rect = e.currentTarget.getBoundingClientRect();
              const offsetX = (a.x + b.x) / 2 - rect.left;
              const offsetY = (a.y + b.y) / 2 - rect.top;
              const scale = cellSize.current / fitCell.current;
              pinch.current = {
                distance: Math.hypot(a.x - b.x, a.y - b.y),
                cell: cellSize.current,
                contentX: (e.currentTarget.scrollLeft + offsetX) / scale,
                contentY: (e.currentTarget.scrollTop + offsetY) / scale,
              };
            } else {
              dragging.current = {
                pointerId: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                left: e.currentTarget.scrollLeft,
                top: e.currentTarget.scrollTop,
                moved: false,
              };
            }
            return;
          }
          if (e.pointerType !== 'mouse' || e.button !== 0) return;
          suppressClick.current = false;
          dragging.current = {
            pointerId: e.pointerId,
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
              const rect = e.currentTarget.getBoundingClientRect();
              pendingGesture.current = {
                cell: p.cell * (distance / p.distance),
                contentX: p.contentX,
                contentY: p.contentY,
                offsetX: (a.x + b.x) / 2 - rect.left,
                offsetY: (a.y + b.y) / 2 - rect.top,
              };
              if (gestureFrame.current === null)
                gestureFrame.current = requestAnimationFrame(() => {
                  gestureFrame.current = null;
                  const pending = pendingGesture.current;
                  if (pending)
                    zoomToContent(
                      pending.cell,
                      pending.contentX,
                      pending.contentY,
                      pending.offsetX,
                      pending.offsetY,
                    );
                });
            } else if (touches.current.size === 1) {
              const d = dragging.current;
              if (!d || d.pointerId !== e.pointerId) return;
              const dx = e.clientX - d.x;
              const dy = e.clientY - d.y;
              if (Math.hypot(dx, dy) > 7) {
                d.moved = true;
                suppressClick.current = true;
              }
              if (d.moved) {
                e.currentTarget.scrollLeft = d.left - dx;
                e.currentTarget.scrollTop = d.top - dy;
              }
            }
            return;
          }
          const d = dragging.current;
          if (!d || d.pointerId !== e.pointerId) return;
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
            if (touches.current.size < 2) {
              pinch.current = null;
              flushGesture();
              commitZoom();
              const remaining = [...touches.current.entries()][0];
              dragging.current = remaining
                ? {
                    pointerId: remaining[0],
                    x: remaining[1].x,
                    y: remaining[1].y,
                    left: e.currentTarget.scrollLeft,
                    top: e.currentTarget.scrollTop,
                    moved: true,
                  }
                : null;
            }
            return;
          }
          dragging.current = null;
        }}
        onPointerCancel={(e) => {
          if (e.pointerType === 'touch') {
            touches.current.delete(e.pointerId);
            if (touches.current.size < 2) {
              pinch.current = null;
              dragging.current = null;
              flushGesture();
              commitZoom();
            }
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
        <div ref={surface} className={styles.boardSurface}>
          <div
            ref={grid}
            className={styles.boardGrid}
            style={
              {
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
      </div>
    </section>
  );
});
