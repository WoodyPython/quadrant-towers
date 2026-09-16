# Milestone 3 design direction

The requested UI/UX Pro Max skill was retrieved from [its upstream repository](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) into the ignored project cache. Its initial gaming search suggested a showcase/3D direction, which conflicts with this game's DOM-based board and the requested restrained UI. A narrower style search returned Minimalism & Swiss Style. Apply its geometric layout, contrast, essential controls, short transitions, keyboard access, touch targets, safe areas, and reduced-motion guidance. React search guidance informed subscription cleanup and selective board-cell memoization.

## Online references

- [The Battle of Polytopia](https://polytopia.io/): mobile turn-based strategy reference; use a prominent board and compact contextual actions. Use original CSS/SVG visuals, not its assets.
- [Lichess](https://lichess.org/): direct entry into play, readable turn/timer information, restrained controls, and accessible board operation.
- [Antiyoy developer game list](https://yiotro.com/games/): reference for the scope of simple mobile strategy games.

## Applied choices

Warm paper background, dark ink, and green primary controls. Four muted quadrant colors pair with distinct player symbols. No marketing sections, slogans, decorative dashboard headings, or text added just to fill space. Card descriptions and contextual targeting hints explain actual decisions.

Animations communicate piece updates, new moves, and dialog entry; they never delay command handling. Respect reduced motion. The mobile board has native overflow scrolling, separate zoom controls, and large cells for coarse pointers. Keep controls usable below the board in portrait and alongside it in landscape. Browser page zoom remains available.

Mobile delivery is an installable web app, as confirmed by the user. Provide a manifest, original icons, safe-area layout, and a static offline fallback. Never cache private game responses, and do not imply offline gameplay is supported.
