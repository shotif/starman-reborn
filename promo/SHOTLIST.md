# Shot list

The shots captured for the 60-second trailer, how each is staged and flown, and where the edit
(`edl.json`) uses it. Every shot is the game itself, in a browser, on a new save: staged through the
`?test=1` hooks as `tests/e2e/screenshots.spec.ts` stages its scenes, then flown with real mouse and
keyboard events while the game runs on a virtual clock (`lib/harness.mjs`). The staging code is
`shots.mjs`; `node promo/capture.mjs --list` lists the shots.

The trailer is cut to the title theme's beat: 68 to the minute, so one beat is 0.882 s and its 17
bars last exactly 60 s. "b12" below is beat 12.

## In the trailer

| Trailer | Shot | What it is for | Staged with | HUD | Sounds the game makes in it | Capture |
| --- | --- | --- | --- | --- | --- | --- |
| 0:00–0:05.3 (b0–6) | `comet` | **Hook.** The real sky: comet 2P/Encke's tails three weeks before it passes the Sun, Jupiter beyond, the HUD's REAL badge on it. Cruise engages a third of a second in. | New game, `startedOn` 2027-01-20, launch from Halcyon Ring, `viewComet` 11 km off; W held, Space for cruise, a slow bank with the mouse | on | `cruise-charge`, `cruise-engage`, engine | 9 s, GPU |
| 0:05.3–0:07.9 (b6–9) | `undock` | Fly: the ship clears Halcyon Ring's bay over Earth. | `dockAt` Halcyon Ring, Launch pressed with the clock already virtual; the camera rig looks back at the ship from ahead | on | `undock`, engine | 8 s, software |
| 0:07.9–0:10.6 (b9–12) | `lane` | Fly: into the Earth–Mars trade lane, 2,600 m/s past its rings. | `placeNear` the lane's entrance, E; the five seconds of lining up pass unrecorded | on | `lane-enter`, lane engine | 5.4 s, software |
| 0:10.6–0:15 (b12–17) | `map` | The 3D star map: out from Sol to the whole neighbourhood, turning. | Tab; the wheel in close on Sol first, then a mouse drag to turn while the wheel pulls back | the map's own UI | none | 10.5 s, GPU |
| 0:15–0:17.6 (b17–20) | `jump` | The jump to Alpha Centauri: the tunnel and the jump card (4.39 ly OBSERVED, transit FICTION), ending on the arrival flash. | Alpha Centauri picked on the map, Jump pressed | the jump card | (the trailer adds the game's `jump-charge` and `jump-exit` on the cut) | 10 s, GPU |
| 0:17.6–0:31.8 (b20–36) | `clash`, `assault` | **Fight.** Five cuts from two border battles at Ross 154 (clash, assault, assault, clash, clash): seekers away, guns on the lead marker, shields taking hits, and four large blasts on beats 22, 25, 32 and 35. | A better gun fitted, two wing pilots hired in the bars, `findBattle` and `meetBattles` for a clash at the beacon line and the Wake's assault on Regent Concourse, `placeNear` a Wake ship; then flown: H for the nearest hostile, the cursor eased onto the lead marker, right button held, F on a lock, C against seekers | on | `laser`, `laser-mk2`, `laser-enemy`, `missile-lock`, `missile-launch`, `hit-shield`, `hit-hull`, `player-hit-shield`, `shield-down`, `explosion-small`, `explosion-large`, `pickup`, `credits` | 15 s + 14 s, GPU |
| 0:31.8–0:34.4 (b36–39) | `race` | Race: the Moon Loop's count runs out and the field goes through the start ring. | Entered at Halcyon Ring's club (Transit Authority standing set as the screenshots journey sets it), `raceAt` the start box, E; still through the count, then W, Shift and the cursor on the first gate | on | `ui-confirm`, `boost-start`, engine | 6.7 s, software |
| 0:34.4–0:37.1 (b39–42) | `mining` | Mine: the mining laser cutting a rock in Sol's main belt, Encke in the sky behind. | `fit` a mining laser, `placeNear` the belt, then a rock at 260 m, B; the camera rig stands off the ship's quarter | on | `mining` | 9 s, GPU |
| 0:37.1–0:39.3 (b42–44.5) | `deck` | Trade: Halcyon Ring's deck, the ship on its pad, Earth through the bay. | `dockAt`, Deck | station UI | deck ambience | 6 s, GPU |
| 0:39.3–0:40.6 (b44.5–46) | `trade` | Trade: twelve medical supplies bought (played at double speed). | The opening contract accepted, Trader, Buy, plus six times, Buy | station UI | `credits`, trader ambience | 6.7 s, GPU |
| 0:40.6–0:42.4 (b46–48) | `bar` | The bar and the people in it. | `dockAt`, Bar, the job board closed | station UI | bar ambience | 6 s, GPU |
| 0:42.4–0:45 (b48–51) | `outpost` | A station of your own: Tidewell Quarry at Lalande 21185 b, its star behind. | Chartered at Wayfarer Array, materials delivered through the Outpost window until it opens, launch, `placeNear` 520 m | on | engine | 7 s, GPU |
| 0:45–0:46.8 (b51–53) | `flare` | Witness: Wolf 359 in a strong flare (a real flare star; when it flares is the game's). | `nextFlare`, `advanceClock` into it, `placeNear` 9 km | on | engine | 7 s, GPU |
| 0:46.8–0:48.5 (b53–55) | `pyre` | Witness: Pyre, the one invented star, with its observatory; the HUD's FICTION badge on it. | `skyFrom`, `edgeAt`, `advanceClock` past the warning, launch from Pyre Observatory, `face` | on | engine | 6 s, GPU |
| 0:48.5–0:50.3 (b55–57) | `hole` | Witness: the black hole Pyre leaves, badged as fiction on the HUD. | As `pyre`, `advanceClock` until the lane opens again, `warp`, `placeNear` 17 km; W, Space | on | `cruise-charge`, `cruise-engage`, engine | 9 s, GPU |
| 0:50.3–0:52.9 (b57–60) | `hole-clean` | **Hero.** The same black hole from off the ship's quarter, at cruise. | As `hole`, from 15 km, the camera rig off the port quarter | off | engine | 9 s, GPU |
| 0:52.9–1:00 (b60–68) | `station` | The end card's plate: Halcyon Ring over Earth, a comet above. | The title screen's own backdrop, its menu hidden | off | none | 12 s, software |

`comet-clean` (the hook's flight from off the ship's quarter, HUD hidden; 9 s, software) is the
silent loop, `out/hook-loop.mp4`: five seconds of it at cruise, its end dissolved into its start.

## Looked at and left out

| Shot | Why not |
| --- | --- |
| `supernova` | Betelgeuse at its peak is a bright point in the sky with a HUD bracket round it: true to the game, but it does not read as spectacle at trailer size. Pyre and its black hole carry that beat. |
| `dogfight` | The opening contract's raider off Mars, with Mars and Jupiter behind. One raider at 400 m is a dot and a marker; the border battles put ships and blasts close to the camera. |
| `flyby`, `arrival` | A boost past the Moon and the flight in to Alpha Centauri A and B: fine, but each repeats what `comet` and `lane` already show. |

## Capture-only overrides

None of these changes committed game code; all are in `lib/harness.mjs`.

- **Virtual clock.** `requestAnimationFrame` and `performance.now` are replaced, so the game only
  moves when the recorder steps it, one sixtieth of a second a frame. On the title and docked
  screens, which draw every other refresh, each frame is stepped in two halves.
- **Resolution.** The frame governor is held at a fixed scale: the 3D canvas is drawn at 3840×2160
  while a shot is recorded and scaled down to the 1920×1080 frame by the browser (High's bloom
  chain has no multisampling, so this is the anti-aliasing), and High's pixel-ratio cap is lifted to
  allow it. The page is laid out at 1280×720 CSS pixels with a device scale factor of 1.5, so the
  HUD is half as large again as at 1920×1080 and reads in a small player.
- **Sound log.** `AudioEngine`'s `play`, `setMusic`, `setCombatIntensity`, `setEngine` and
  `setAmbience` are wrapped to write the cue sheets in `cues/`.
- **CSS.** The cursor, the toasts and the title's build label are hidden; in `hole-clean`,
  `comet-clean` and `station` the whole interface is.
- **Rendering.** Five shots are drawn in software (SwiftShader) and the rest on the GPU; see the
  README's "Capture".
- **Camera rig.** In `undock`, `mining`, `hole-clean` and `comet-clean` the game's own camera is
  placed off the ship (ahead looking back, or off a quarter) after the chase camera has run. It
  draws the game's own scene; nothing else changes. Every other flight shot is the chase camera.
- **Staging.** The test hooks listed above, as the game's own browser tests use them; `promo.place`
  and `promo.targets` exist in the harness but no shot in the trailer needs them.
