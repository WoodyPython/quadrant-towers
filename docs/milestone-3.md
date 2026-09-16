# Milestone 3 — Playable UI

The browser now supports home, room creation/joining, the four-seat lobby, all four board presets, card selection and targeting, all actions, explicit turn end, effects, move history, results, rematches, and seat recovery. The server remains authoritative. The release card catalog remains the existing framework catalog; final card content and balance are Milestone 5.

Design follows the requested UI/UX Pro Max guidance and references in [milestone-3-design.md](milestone-3-design.md). Controls use concise labels and contextual targeting hints. CSS/SVG visuals include quadrant colors and player symbols, shared-health indicators, connected tower outlines, and short state-change animations. Reduced motion is supported.

## Play locally

Use the README setup commands. Open the app in four separate browser profiles, four devices, or other isolated browser sessions. Ordinary tabs in one profile share a seat. A second tab taking that seat stops the first tab until the player explicitly reconnects.

Create a room, choose a preset, share the six-letter code, then start when all four players are connected. Choose a card and any required target, take two actions, then select End turn. Attack requires an inline confirmation. Expand selects a tower before an adjacent empty cell.

Refresh to recover your seat and saved card offer. A lost acknowledgement locks additional mutations until Check result retries the identical command. Create/join cannot safely be retried automatically because those server operations have no durable command receipt. If storage is unavailable the UI warns that the seat cannot be saved across refresh.

## Mobile and installation

This is an installable web app, not native app-store packages. The manifest, 192/512px icons, Apple touch icon, standalone display mode, and safe-area layout are included. In iPhone Safari use Share → Add to Home Screen; in Android Chrome use Install app / Add to Home screen. Installation and service workers require HTTPS on actual devices (localhost is allowed for desktop testing).

The board uses touch scrolling and large touch cells. Fit board provides an overview; tapping a cell in a small overview zooms into the area before a move can be selected. My quadrant restores an actionable view. Zoom buttons and keyboard navigation provide alternatives to gestures. Portrait puts controls below the board; landscape places them alongside when space permits. Browser zoom is retained.

Online access is required for gameplay. The service worker caches only the static offline page, never API/socket responses, tokens, or match data. It does not serve an old cached game while offline.

For phone testing on a trusted LAN, run Vite with `corepack pnpm --filter @quadrant/web dev --host 0.0.0.0` and add the exact `http://<computer-LAN-IP>:5173` origin to the server's `ALLOWED_ORIGINS`. Keep existing local origins as needed. This permits browser play; installation still needs HTTPS. Production hosting/HTTPS remains Milestone 4.

## Verification

Verified locally: formatting, lint, typecheck, production build, 115 unit/contract tests, 17 PostgreSQL integration tests, and 7 Playwright browser tests passed.

- Unit checks cover legal action/card targets, fog labels, coordinates beyond Z, view ordering, timer offset, filtered event formatting, duplicate commands, lost acknowledgements, and late responses after disconnect.
- PostgreSQL integration tests retain the engine/server recovery and privacy coverage from Milestone 2.
- Playwright runs against an isolated, migrated, randomly named database and the production build. Its setup closes the app and drops only that generated database afterward; the configured application database is not modified.
- Four independent browser contexts complete a Small match and rematch entirely through UI controls, with refresh preserving the card offer. Other flows exercise Medium/Large/Massive boards, touch-sized portrait/landscape layouts, actions, keyboard focus, reconnect, seat takeover, and the installed offline fallback.
- Build configuration loads server environment files only for the development proxy, so a development `.env` cannot silently produce a development React bundle or disable production service-worker registration.

Automated browser coverage uses Chromium mobile emulation. A physical iPhone/Android installation check, screen-reader review, and the required four-human local playtest remain manual acceptance work. Do not mark the milestone's human-playtest exit criterion complete until that session is recorded.

## Manual playtest record

Pending. Record date, four participants/devices, preset, completion/rematch, reconnect results, any external intervention, and remaining usability defects. The automated four-context match is verification of the implementation, not a substitute for four human players.
