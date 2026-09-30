# Known gaps

This is an honest list of what the prototype does not do yet, or what has not been verified.

## Needs your action

1. **Astronomy snapshot not captured.** The build environment could not reach the ESA Gaia archive,
   SIMBAD, VizieR or the NASA Exoplanet Archive (blocked by its network policy). The bundled star
   and planet data are therefore **provisional transcriptions**, and every place in the game that
   shows them displays a *Pending verification* badge. The 27 catalogue systems added later come
   from the HYG database and the Open Exoplanet Catalogue (reachable through GitHub) and are
   provisional too. On a machine with internet access, run
   `npm run data:snapshot && npm run data:build && npm run data:validate`, then commit the result.
   The badges disappear automatically and the dated archive values replace the stopgaps. See
   [ASTRONOMY_SOURCES.md](ASTRONOMY_SOURCES.md).
2. **Real-device testing is pending.** Everything was tested in headless Chromium with emulated
   phone and tablet viewports, touch events and multi-touch (see [TEST_RECORD.md](TEST_RECORD.md)).
   Nothing ran on a physical iPhone, iPad or Android device. Please run the hands-on checklist in
   the test record over HTTPS, at <https://shotif.github.io/starman-reborn/>.

## Not verified here

- **Frame-rate targets** (60 fps on a laptop, 30 fps on a mid-range phone during the fight) could
  not be measured: the test browser renders WebGL in software (SwiftShader, ~10–20 fps at any
  size). Dynamic resolution and the Low preset exist for phones, but real numbers need real
  hardware.
- **iOS Safari audio.** The unlock follows the iOS rules (context created inside a gesture, silent
  buffer, resume on interruption). Only Chromium was exercised. On iPhone, sound also depends on
  the Ring/Silent switch; the settings screen explains this.
- **Safe-area insets** were tested by overriding the CSS variables, not on a device with a notch
  or home bar.
- **WebGL context loss** is handled (overlay with reload, automatic resume on restore) but was not
  forced in automated tests.
- **Transferred size on mobile networks.** Measured from the production build: about 288 KB
  gzipped for the first scene (three.js 149 KB, game code 124 KB, addons 7 KB, CSS 7 KB, HTML).
  Loaded on demand: the star map (~19 KB) on first open, the science notes (~11 KB), and bloom
  (~4 KB) on the High preset only. Real-network timings were not measured.

## Deliberate prototype limits

- Only the first delivery chain is scripted as a story, with three short optional jobs after it.
  Everything else on the job boards is generated (freight, parcels, supply runs, bounties,
  surveys): contracts do not chain into stories, have no deadlines, and do not react to what
  happens in the world (a bounty pack exists only while you are in its system).
- Market stock only moves when the player trades; traders flying the lanes are scenery for the
  economy (they do not restock stations), and nothing is simulated in systems the player is not in.
- Traffic and raider packs exist only around the player: nothing persists after you jump or dock.
- Generated stations have generated exteriors and interiors (twelve kinds in four owner
  palettes). Known rough edges: the half-built hull outside a shipyard bay reads as a flat block
  on the phone deck view, some white crates on factory conveyors bloom under the lamps, and mining
  hall rock walls are dark away from the floodlights.
- No subsystem damage, fleet battles, multiplayer, cloud saves or cross-device sync (out of scope
  per the spec).
- Solar System planet positions are schematic and do not follow an ephemeris.
- Stations and ships do not collide with each other in detail (spheres only).
- The offline cache (service worker) is a stretch-goal implementation: it registers only in
  production builds over HTTPS or on localhost, and was not tested offline on a phone.
