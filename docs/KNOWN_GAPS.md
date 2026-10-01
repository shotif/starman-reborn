# Known gaps

This is an honest list of what the prototype does not do yet, or what has not been verified.

## Needs your action

1. **Real-device testing has barely started.** Everything was tested in headless Chromium with
   emulated phone and tablet viewports, touch events, multi-touch and a gamepad (see
   [TEST_RECORD.md](TEST_RECORD.md)). On a real phone, only the star map's pinch zoom has been
   confirmed so far (1 October 2026); nothing else has run on a physical iPhone, iPad or Android
   device, or with a physical controller. Please run the rest of the hands-on checklist in the test
   record over HTTPS, at <https://shotif.github.io/starman-reborn/>.

## The sky, as verified

The star and planet data were checked against the archives on 30 September 2026 by the sky
snapshot workflow on GitHub's runners (SIMBAD, Gaia DR3, Hipparcos, the NASA Exoplanet Archive and
the Extrasolar Planets Encyclopaedia; see [ASTRONOMY_SOURCES.md](ASTRONOMY_SOURCES.md)): 252 stars
in 207 systems, 99 planets and 9 debris belts. Two choices of this edition are deliberate:

- **Contested planets are kept.** 22 planets that an archive flags as controversial, or that no
  archive confirms any more, stay in the game; each says so in its science card and survey
  briefings, with what each archive says. Nothing the archives dispute was removed.
- **Names** are the archives' own. A few systems show a variable-star or survey name (FL
  Virginis for Wolf 424, WISE 0722−0540) rather than the better-known one.

The workflow can be run again at any time from the repository's Actions tab; it commits a new
snapshot branch only when the archives changed.

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
- **The star map's search on a real phone.** Pinch zoom toward the fingers is confirmed on a real
  phone (1 October 2026). The Find dialog was exercised with emulated touch only: with an on-screen
  keyboard up, it keeps to the visible part of the screen through the Visual Viewport API, and how
  iOS Safari scrolls around a focused field needs a real iPhone to confirm. Double tap and Missions
  have not been tried on a real phone either.
- **WebGL context loss** is forced in a browser test (the `WEBGL_lose_context` extension, in
  flight): the notice shows, the game freezes and saves, and it carries on when the context comes
  back. How often a real phone's browser takes the context away, and whether it gives it back, was
  not seen.
- **The first load on a real phone network.** The title now appears from a 15 KB first screen and
  the game (609 KB gzipped in all, with three.js 144 KB and the game code with the world and sky
  433 KB) loads behind it with a progress bar. On simulated slow 4G (1.6 Mbit/s, 150 ms) in the
  test browser, the title shows at 0.45 s (it took 4.8 s before) and Play is ready at about 5.2 s
  (4.8 s before: the fonts now arrive with the game rather than after it). A phone's slower
  processor adds to the second figure; nothing was timed on a real phone or network. Loaded on
  demand: the star map (~27 KB) on first open, the science notes (~4 KB), and bloom (~4 KB) on the
  High preset only.

## Deliberate prototype limits

- The written story is the opening chain, three short optional jobs, three faction arcs of five
  missions each, The Long Border (five steps, branching three ways at its choice) and First
  Harvest, out in the frontier (five steps, branching two ways); everything else on the job boards
  is generated. The faction arcs know about each other only through standing and through
  Kettering, whose briefings follow the choices made in them. The lasting marks an arc leaves on
  the world are a dark den (for six hours) and the Ross 154 – Wolf 1061 front, settled for good by
  The Long Border; First Harvest's ending changes standing and words, not the world.
- The frontier's own events (harvests, survey seasons, drive failures) follow the clock like the
  others; a stranded hauler waits for the player's rescue however long it takes, and only the
  player's rescue is flown. A survey season's readings never settle a contested planet: the
  archives do.
- The border war is a tide on the clock plus the player's deeds, not a simulation of fleets. It
  runs only on the five lanes where a den's system touches lawful space, and only The Long Border
  settles a front; the other four swing for ever.
- Goods move between stations out of sight as a spill along the lanes, not as individual ships;
  only the player's own system has traders flying.
- Traffic and raider packs exist only around the player. Packs that saw the player and cargo pods
  left adrift wait for 30 minutes of game clock (in the last six systems), as do the packs and
  wrecks of the player's own contracts; everything else is generated again on arrival.
- Escorts go at most two jumps. On the way to another system the haulers keep station behind the
  player rather than flying a route of their own, catch up after a lane as wingmen do, and come
  back whole each time the player launches (only ships destroyed count against a convoy).
- The law is simple: a crime is known where it was seen and spreads a jump every ten minutes;
  fines lapse after three hours without a new crime; a patrol scans at most once a flight.
  Selling contraband at a station is not a crime; only having it in the hold at a scan is.
- Wingmen take two orders (attack my target, form up) and talk in a few lines. Seekers (from heavy
  raiders, aces and bounty hunters) are the only missiles fired at the player, and decoy flares
  the only countermeasure.
- Ratings change nothing in the world except the combat rank that ace hunts and den assaults ask
  for; milestones are a record, with one grant (the whole codex). The what-next hint looks only at
  fines, the hold, stories waiting, the codex, known prices and job boards, not at ships, equipment
  or standing.
- Generated stations have generated exteriors and interiors (twelve kinds in four owner
  palettes). Known rough edges: the half-built hull outside a shipyard bay reads as a flat block
  on the phone deck view, some white crates on factory conveyors bloom under the lamps, and mining
  hall rock walls are dark away from the floodlights.
- Damage to systems is modelled for the player only (other ships just lose shield and hull); no
  fleet battles, multiplayer, cloud saves or cross-device sync (out of scope per the spec).
- Solar System planets sit at their real heliocentric longitudes for the game date (JPL's
  approximate elements, valid 1800–2050; outside those years the layout is schematic), with
  distances compressed so the system can be flown; Mars is kept within 140° of Earth.
- Stations and ships do not collide with each other in detail (spheres only).
- The offline cache (service worker) is a stretch goal: it registers only in production builds
  over HTTPS or on localhost, keeps every file of the build after one visit, and is tested in
  Chromium with the server switched off (the game starts and the star map opens). It was not tried
  offline on a phone. On iPhone, Safari can clear a site's stored data, offline files and saves
  alike, after seven days of browsing without a visit, unless the game is added to the Home Screen;
  exporting a save keeps it safe.
