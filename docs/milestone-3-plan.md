# Milestone 3 implementation plan — Playable UI

Status: proposed implementation sequence; no gameplay implementation included.

## Goal and baseline

Deliver the screens and interactions in GAME_PLAN.md sections 3 and 8. The exit criterion is a complete four-person local match without database or developer-tool intervention.

The engine and multiplayer service already implement gameplay, filtered views, durable commands, deadlines, reconnects, results, and rematches. `docs/milestone-2.md` describes the client contract. The web app currently contains only a React service-status screen and CSS; it has neither Socket.IO client nor Zustand dependencies. Browser tests currently verify only the shell, service failure, and SPA fallback.

Keep the server authoritative and use the existing framework card catalog. Final card design and balance belong to Milestone 5; deployment and operational hardening belong to Milestone 4. Protocol changes should be limited to demonstrated UI gaps.

## 1. Client state and connection foundation

- Add Socket.IO client and Zustand to `apps/web`, using the shared protocol types and runtime schemas.
- Split the entry point into an application shell, screens, connection layer, state store, and pure presentation/target-selection helpers. Keep socket setup independent of React rendering and safe under StrictMode.
- Separate authoritative room/match/content state from temporary selections, viewport state, pending requests, connection status, and errors. Screens follow room/match status; help is available without losing the current session.
- Persist the returned identity immediately in localStorage. Rejoin on each new socket connection, then synchronize before enabling mutations. Handle unavailable storage, rejected tokens, removed seats, and service outages with actionable messages.
- Treat a server-forced disconnect as a stopped connection with an explicit resume control; do not automatically reclaim a seat repeatedly from another tab. Four local players need separate browser profiles, devices, or Playwright contexts because storage and seat identity are shared across same-origin tabs.
- Validate inbound events and acknowledgements. Replace state from complete views, ignore older versions within the same match, and synchronize on gaps, stale versions, reconnects, or content changes. Guard against late responses from an old connection or match, including a rematch resetting the version to zero.
- Allow one outstanding gameplay mutation. Give each new command a UUID and preserve its exact payload for uncertain retries. An acknowledgement timeout is not proof of rejection. Reconcile with sync and retry the identical command when needed; never change its expected version while retaining its ID. Create/join are not idempotent commands and must not use this automatic retry path.
- Derive the countdown from the server deadline and server-time offset. Recompute after tab visibility changes and timer events. At zero, wait for the server transition; do not simulate timeout actions locally.

Completion check: a real browser can create/rejoin a seat, receive validated views, and recover from lost connections without duplicate mutations or stale state.

## 2. Home, lobby, and help

- Home: display name, create/join forms, six-letter room code, and all four presets. Default to Medium and show quadrant size, total dimensions, rounds, and expected duration for each option.
- Lobby: four seats, connection indicators, immutable preset summary, room-code copy with fallback, host badge, start, leave, and eligible disconnected-seat removal. Drive host changes and removal eligibility from server room views and timestamps.
- Enable Start only for the host when all four seats are connected; display server rejection messages if presence changes during submission.
- Define leave/home behavior explicitly: leaving a lobby releases the seat; leaving an active match does not pause the timer or release its seat. Retain a way to resume an active seat.
- Add concise rules/help covering turn order, card choice, actions, fog, elimination, scoring, timeouts, and rematches. Keep form validation aligned with shared request schemas.

Completion check: four users can create, join, start, leave, and recover a lobby through the UI.

## 3. Board and accessible navigation

- Render only `MatchView.cells` using CSS Grid and semantic cell buttons. Hidden cells expose only their coordinate and hidden status, including in labels and tooltips.
- Show coordinates A–AB and 1–28 as needed, quadrant borders, player colors plus icons/patterns, distinct Town Halls, shared-health stars, and separate outlines for adjacent friendly towers. Do not infer unrevealed enemy tower footprints.
- Add a selected-tower panel using authorized information. Own towers can show their complete footprint; enemy panels must not imply visible cells are the full tower.
- Fit Small/Medium into the main play area. Add controlled zoom, pan, Fit board, My quadrant, and reset for Large/Massive, with touch and keyboard alternatives to dragging. Distinguish a drag from a target click.
- Use arrow-key cell navigation and a managed tab stop rather than requiring hundreds of Tab presses. Keep the focused cell visible and provide Enter/Space activation and Escape cancellation.
- Use memoized cell components with stable scalar props so timer updates and selection changes do not redraw all 784 cells unnecessarily. Check actual Massive-board interactions before adding virtualization.
- On tablet/mobile, keep the board scroll/zoom contained and place action/card panels within reach without page overflow. Preserve visible focus, adequate touch targets, contrast, and reduced-motion behavior.

Completion check: all presets can be inspected and targeted with mouse, keyboard, and touch, including Massive at a narrow viewport.

## 4. Turn controls, cards, and feedback

- Show turn order, current player, round limit, countdown, elimination status, and two-action tracker. Disable mutations when disconnected, synchronizing, pending, eliminated, or outside the player's turn.
- Require card resolution before actions. Render the three offered cards using pinned content metadata, including rarity text/icon/color and lifecycle. Never import executable card handlers into the browser.
- Build a target-selection flow keyed by target definition rather than card ID. Support own tower, own tower below 10 health, enemy cell, and hidden enemy cell; collect all required targets before one atomic `card:choose` request. Provide cancel/back controls before submission.
- Highlight legal action targets from the authorized view: Build on own empty cells; Upgrade on own towers below 10 health; Expand from an own tower to an orthogonally adjacent own empty cell; Attack anywhere in an enemy quadrant. The server revalidates every request.
- Attack interaction: choose a target, show its coordinate and an inline Confirm attack control, and submit only on confirmation. Use the same flow for keyboard and touch, without a modal on every action.
- Enable explicit End turn after both actions resolve, matching the existing `turn:end` contract. Reset invalid selections when a new view changes the turn, selected tower, available targets, or match.
- Render active effects using metadata and only the fields present in the view. Show charges/expiry when provided; do not invent an exact remaining duration when the projection lacks the counters needed to calculate it.
- Format the filtered history into a public event feed and authorized personal feedback for hits, misses, prevention, destruction, reveal, actions, card resolution, and expiry. Validate known history detail shapes before formatting and use generic fallbacks for unknown entries.
- Make repeated snapshots idempotent so reconnect/sync does not replay old notifications. Never infer missing private event details or reveal hidden data through animation, labels, or notifications.

Completion check: each action and supported card target type is usable; errors preserve the correct action count, and timeout/turn changes cancel stale input safely.

## 5. Results and rematch

- Display the server's winner, end reason, fully revealed board/history, per-tower score breakdown, and ordered tie-break explanation. Do not recompute the authoritative winner in the browser.
- Show rematch votes and connection state for all four original players. Explain that all four must vote and be connected; the preset and seats carry forward.
- On a new match ID, clear old selections, pending display state, notifications, and viewport assumptions; load the newly pinned content before accepting gameplay input.
- Provide Home and resume behavior consistent with the identity rules in step 2.

Completion check: a completed match reaches understandable results and all four players can start a rematch through the UI.

## 6. Verification and milestone handoff

- Add focused Vitest coverage for view ordering, old-match responses, uncertain command retries, reconnect state, target selection, coordinates beyond Z, timer offset, and privacy-preserving event formatting. Keep these helpers testable without a DOM where practical.
- Replace shell-only Playwright expectations with the new home/help/service-error behavior. Add four-context browser coverage for create/join/start, card choice, both actions, explicit turn end, refresh/rejoin, results, and rematch. Exercise all four presets for correct dimensions and navigation; complete at least one browser match.
- Use an isolated test database for browser matches, extending the existing disposable-database approach if needed. Complete browser games through actual UI actions; avoid production timers or catalog changes made solely to accelerate tests.
- Add targeted browser checks for keyboard-only play, a narrow viewport, touch targeting/panning, fog labels, double clicks, offline recovery, and one-controller seat behavior. Reuse existing server integration coverage for exhaustive gameplay and restart permutations; broader production browser coverage remains Milestone 4.
- Run formatting, lint, typecheck, unit tests, multiplayer integration tests, build, and browser tests. Verify real touch interaction and screen-reader announcements manually where automation cannot establish usability.
- Conduct the required four-person local playtest using separate sessions. Record preset, completion, reconnect behavior, usability issues, and any need for external intervention. Automated tests do not substitute for this exit criterion.
- Add `docs/milestone-3.md` describing implemented flows, local playtest setup, validation results, and remaining limitations. Update README to reflect the playable UI only after implementation is complete.

## Delivery order and review boundaries

Implement in six reviewable increments matching the steps above. Steps 1–2 establish the real multiplayer path; step 3 establishes board navigation; step 4 completes playable turns; step 5 completes the match loop; step 6 verifies and documents the milestone. Add relevant tests alongside each increment rather than postponing all verification.

The main integration risks are stale or duplicated socket responses, accidental seat takeover between tabs, pending commands crossing a timeout/rematch, incomplete metadata for effect presentation, and usable targeting on Massive boards. Resolve these within the corresponding increment before proceeding to visual polish.
