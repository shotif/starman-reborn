# Test record

Environment for everything below: Linux container, Node 22.22, Chromium 141 (Playwright 1.56.1)
in headless mode, with WebGL 2 rendered in software by SwiftShader. **No physical phone, tablet or
GPU was available.** Emulated devices use Playwright viewports with `hasTouch`/`isMobile`, and
touch input is real Chromium touch events sent over the DevTools protocol.

## Automated checks

| Check | Command | Result |
| --- | --- | --- |
| TypeScript typecheck (app + scripts/tests) | `npm run typecheck` | Pass |
| Astronomy data validation | `npm run data:validate` | Pass (2 warnings: data is provisional) |
| Unit tests | `npm test` | Pass: 137 tests in 7 files |
| Production build | `npm run build` | Pass |
| Browser tests, desktop 1440×900 | `npx playwright test --project=desktop` | Pass: 7 passed (3 touch-only tests skipped) |
| Browser tests, touch 844×390 | `npx playwright test --project=touch` | Pass: 9 passed (1 desktop-only test skipped) |
| Layout screenshots + audits, 7 sizes | `npm run screenshots` | Pass: 35 screenshots, no audit findings |

### Unit tests (Vitest)

- `data.test.ts`: coordinate conversion, parallax → light-years, proper-motion propagation,
  dataset validation (and that broken data is caught), reachability, familiar distance bands,
  Proxima separate from A/B, confirmed-only planets, jump routing and fees.
- `economy.test.ts`: cargo bounds, exact trade arithmetic, rejected orders leave state unchanged,
  max-buy limits, no same-dock arbitrage, the Earth → Mars → Proxima profit, route returns from
  known markets only, upgrade effect, repair affordability, reputation effects on repairs, prices
  and welcome text.
- `jobs.test.ts`: the full delivery chain, detours (other systems, selling and re-buying cargo),
  early scans, reputation-gated contracts, visit-only couriers, rescue after defeat.
- `save.test.ts`: v1 → v2 migration, future/damaged save rejection, IndexedDB round trip with
  backup rotation, fallback to the backup, coalesced writes, **save after jump** survives a fresh
  load, reset keeps settings, settings sanitising.
- `flight.test.ts`: **pointer ownership for the two touch sticks** (third finger, wrong-pointer
  moves, cancel, hold button), frame-rate independence (30 Hz vs 120 Hz), drift, boost/cruise,
  bounded sub-steps, ship orientation, autopilot arrival, the portrait camera field of view,
  intercept maths, a lead shot hitting an off-axis crossing target, gun-arc clamping, shield/hull
  damage and regeneration.
- `galaxy-map.test.ts`: camera-relative transforms, orbit controller, projection and label layout,
  jump-button rules.
- `audio.test.ts`: music theory, deterministic seeded patterns, mood definitions, voice limits,
  engine parameter mapping.

### Browser tests (Playwright)

- `journey.spec.ts`: **the nine-step journey from the spec** on desktop and on touch.
  1. Title (Play, Controls, About the science; audio locked until a gesture).
  2. Docked at Earth, with the contract showing reward, destination and difficulty.
  3. A purchase dialog showing price, capacity and destination.
  4. Launch, steer (mouse or touch stick), select Deimos Depot by its marker, Go To through the
     trade lane.
  5. The raider fight: flown with the mouse on desktop; the one-click Avoid combat route on touch.
  6. Mars: clearance, voyage report, selling cargo, the shield upgrade, and the faction reaction
     when the raider was destroyed.
  7. Star map with Alpha Centauri at 4.34 ly, the legend, the covered fee, and the jump.
  8. A/B and Proxima as distinct targets, discovering Proxima b (confirmed, NASA Exoplanet Archive
     link), docking at Meridian, delivering, net profit and the faction reaction.
  9. Jump to Barnard's Star, refresh and Continue, then jump to Sirius and Epsilon Eridani, with
     all five systems visited.
- `platform.spec.ts`:
  - WebGL 2 missing (`?nowebgl=1`): the compatibility screen, 2D map and science notes still work.
  - The audio gesture requirement.
  - Refresh mid-flight resumes at the same place with cargo and job intact.
  - Hidden tab: the simulation freezes, and on resume the ship does not teleport.
  - Safe-area insets respected (HUD and touch controls).
  - **Multi-touch**: steering and aiming at once, firing while held, and lifting one finger
    keeps the other in control.
  - **pointercancel** releases both sticks.
  - **Rotation mid-flight** (390×844 → 844×390) keeps the ship and re-lays out the controls.
  - **Desktop: a hit on a target away from the screen centre during a turn**, with bolts
    following the visible cursor.
- `screenshots.spec.ts`: title, contract board, buy dialog, flight HUD and star map at 360×640,
  640×360, 390×844, 844×390, 768×1024, 1024×768 and 1440×900 (saved in `docs/screenshots/`).
  Each is audited for page scroll overflow, clipped controls (controls inside a scrolling panel
  count only if the panel itself is off-screen), text under 10 px, touch targets under 40 px, and
  overlaps between HUD panels, touch clusters and toasts.

## Performance notes (not representative)

SwiftShader renders on the CPU, so frame rates here say nothing about real devices. Observed:
about 8–20 fps depending on viewport, with dynamic resolution lowering the pixel ratio as
designed. Production build transfer size for the first scene: about 288 KB gzipped (JS + CSS +
HTML). The star map (~19 KB) and science notes (~11 KB) load on first use; the bloom chain
(~4 KB) loads only on the High preset.

## Real-device checklist (pending — please run)

Open <https://shotif.github.io/starman-reborn/> (or serve over HTTPS with `npm run dev:https` or a
tunnel; see the README), then on an actual **Android phone** and an **iPhone/iPad**:

1. Open the site; tap **Play**. Sound starts after the first tap (iPhone: Ring/Silent switch set
   to Ring).
2. In flight, **steer with the left thumb and aim/fire with the right thumb at the same time**.
   Boost, Cruise, Target and the green action button should all be reachable without letting go
   of both sticks.
3. Rotate the device mid-flight in both directions. The ship keeps flying and the controls
   re-layout without a reload.
4. Check that nothing sits under the notch, rounded corners or home bar, in both orientations.
5. Settings → **Show frame rate**. During the Mars raider fight, note the fps (target ≥ 30 on a
   mid-range phone with Auto quality).
6. Dock at Mars and check the voyage report shows a profit.
7. Jump to Alpha Centauri, discover **Proxima b** and open its citation, then dock at Meridian
   Outpost and deliver.
8. **Refresh** the page and press Continue. Everything should be as you left it.
9. Switch to another app and back mid-flight. The game should not jump ahead.
10. On a tablet with a keyboard or mouse attached, the desktop controls should take over.
11. Optional (offline stretch goal): after one visit, go offline and reload.

Record results here (device, OS, browser, fps, issues):

| Device | OS / browser | Steps passed | fps (fight) | Notes |
| --- | --- | --- | --- | --- |
| _pending_ | | | | |
