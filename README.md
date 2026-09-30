# Starman Reborn

A browser space trading and combat prototype set among **real nearby stars**: 32 systems within
about 17 light-years, from Sol, Alpha Centauri and Barnard's Star out to Tau Ceti, 61 Cygni,
Gliese 876 and Altair, with 44 stars and 37 confirmed planets. You fly a small courier with the
mouse or with two thumbs. You trade medical supplies, fight or dodge a raider near Mars, jump to
Alpha Centauri, discover the real exoplanet Proxima Centauri b, and make the first delivery to a
fictional research outpost. After that the neighbourhood is open: 58 generated stations of twelve
kinds (ports, mines, refineries, farms, research stations, shipyards, free ports, raider dens...),
21 goods with stock-based prices, traders and patrols on the lanes, raider packs in lawless
space, contract boards in every station bar (freight, courier parcels, supply runs, bounties on
raider packs, planet surveys), and 35 ships in six classes from five makers with over 100 pieces
of equipment. Ships, equipment, the world, the economy and the contracts are generated from rule
files and checked by automated guardrails ([docs/PROCGEN.md](docs/PROCGEN.md)).

Star positions, distances and confirmed planets come from astronomical catalogs (see
[docs/ASTRONOMY_SOURCES.md](docs/ASTRONOMY_SOURCES.md)). Stations, factions, jump travel, trade
lanes and all story text are original fiction and are labelled that way in the game.

**Play now: <https://shotif.github.io/starman-reborn/>**

![Flight HUD on desktop](docs/screenshots/desktop-1440x900-4-flight.jpg)

## Play

- **Online (HTTPS, works on phones):** <https://shotif.github.io/starman-reborn/>. Every push to
  `main` redeploys it.
- **Locally:** see *Run it* below.

A first playthrough takes about 10–20 minutes. Progress saves automatically in the browser
(IndexedDB) after docking, trading, rewards and jumps, and when the tab is hidden. Refresh at any
time and press **Continue**.

## Run it

Requirements: **Node.js 22.18 or newer** (the data scripts run TypeScript directly) and npm.

```bash
npm ci            # install the exact locked dependencies
npm run dev       # development server at http://localhost:5173
npm run build     # production static site in dist/ (relative asset paths)
npm run preview   # serve dist/ at http://localhost:4173
```

`npm run check` runs typecheck, data validation, unit tests and the production build.

## Test on real phones and tablets (HTTPS)

Phones cannot open your desktop's `localhost`, and browser features such as audio unlock and
installability behave best over HTTPS. Pick one:

1. **GitHub Pages (recommended).** The game is live at <https://shotif.github.io/starman-reborn/>.
   Every push to `main` runs `.github/workflows/pages.yml`, which builds `dist/` and redeploys it;
   you can also run the workflow manually from the Actions tab. In a fork, first set *Settings →
   Pages → Build and deployment → Source* to **GitHub Actions**; the site then appears at
   `https://<user>.github.io/<repo>/`. GitHub Pages is free for public repositories; private
   repositories need a paid plan.
2. **Your local network with a self-signed certificate.** Run `npm run dev:https` (or
   `npm run build && npm run preview:https`). Vite prints a `https://192.168.x.x:5173` address.
   Open it on a phone on the same Wi‑Fi and accept the certificate warning.
3. **A tunnel.** Run `npm run preview`, then expose port 4173 with any HTTPS tunnel, for example
   `npx cloudflared tunnel --url http://localhost:4173`.

## Controls

| Action | Mouse and keyboard | Touch |
| --- | --- | --- |
| Steer | Move the mouse; the ship turns toward the cursor | Left thumb: drag anywhere in the lower left |
| Aim and fire | Cursor is the reticle; hold the **right** mouse button | Right thumb: drag in the lower right; fires while held |
| Select target | Left-click a marker or object; **T** cycles, **H** nearest hostile | Target button (hold for nearest hostile) or tap a marker |
| Throttle | **W / S**, mouse wheel | Slider on the left edge |
| Strafe | **A / D** | – |
| Boost | **Shift** | Boost button (hold) |
| Cruise | **Space** | Cruise button |
| Dock, enter lane, interact | **E** | Green action button |
| Go to selected target / objective | **G** | Green action button ("Go to") |
| Missile, rocket or torpedo | **F** or middle mouse | Missile button |
| Repair kit | **R** | Repair button |
| Scan | **X** | Action button ("Scan") |
| Engines off (drift) | **Z** | Drift button (landscape) |
| Star map | **Tab** or **M** | Map button |
| Pause | **Esc** or **P** | Pause button |

Settings include alternate desktop steering (drag-to-steer, or keyboard steer with mouse aim),
invert pitch, a left-handed touch layout, aim assist (Off/Low/Medium, touch default Low), difficulty,
quality presets, text size, reduced motion, camera shake, bloom and volume. A mouse or keyboard
attached to a tablet switches it to the desktop controls automatically.

## Project layout

```
src/app/       boot, game controller, renderer, loop, rules, settings, save (IndexedDB)
src/data/      curated systems, generated astronomy snapshot, coordinates, validation
src/galaxy/    neighbourhood star map (3D + 2D fallback), routing, info cards
src/flight/    ship dynamics, chase camera, autopilot, desktop and touch input
src/combat/    guns, projectiles, missiles, lead/intercept, damage, raider AI
src/world/     local system scenes (hand-made and generated), flight session, traffic and raider
               packs (src/world/traffic), procedural art (src/world/art)
src/content/   rule-driven generators and guardrails (docs/PROCGEN.md): ships and equipment,
               the world (src/content/world: lanes, territory, stations) and the economy
               (src/content/economy: goods, market profiles), contract rules (src/content/contracts)
src/economy/   live markets, trade, cargo, outfitter and shipyard, factions, jobs and generated
               contracts
src/audio/     procedural Web Audio music and sound effects
src/ui/        HUD, touch controls, station screens, encyclopedia, styles
scripts/       astronomy snapshot, catalogue extraction (HYG, Open Exoplanet Catalogue), dataset
               build and validation
tests/         unit tests (Vitest) and browser journeys (Playwright)
docs/          sources, design notes, test record, known gaps, screenshots
```

## Tests

```bash
npm test                       # unit tests (Vitest)
npx playwright install chromium  # once, to download the test browser
npm run test:e2e               # Playwright journeys on desktop and touch viewports
npm run screenshots            # layout screenshots + audits for the seven test sizes
```

The results and device coverage are recorded in [docs/TEST_RECORD.md](docs/TEST_RECORD.md). Open
issues are listed in [docs/KNOWN_GAPS.md](docs/KNOWN_GAPS.md).

## Astronomy data

`npm run data:snapshot` captures a dated snapshot from the ESA Gaia archive, SIMBAD, VizieR and
the NASA Exoplanet Archive. The 27 catalogue systems come from the HYG star database v4.0 (CC BY-SA
4.0) and the Open Exoplanet Catalogue (MIT) through `scripts/extract-catalogs.ts`; the derived
data keep those licences ([data/provisional/NOTICE.md](data/provisional/NOTICE.md)). `npm run data:build` regenerates the bundled dataset, and
`npm run data:validate` checks it. The game never calls these services at runtime. Details,
exceptions and uncertainty are in [docs/ASTRONOMY_SOURCES.md](docs/ASTRONOMY_SOURCES.md).

## Credits and rights

All code, art (procedural), music and sound effects (synthesized at runtime), UI and writing are
original to this project. The design is inspired by classic mouse-flight space-trading games; see
[docs/DESIGN.md](docs/DESIGN.md) for the design notes.
