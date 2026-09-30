# Known gaps

This is an honest list of what the prototype does not do yet, or what has not been verified.

## Needs your action

1. **Real-device testing is pending.** Everything was tested in headless Chromium with emulated
   phone and tablet viewports, touch events, multi-touch and a gamepad (see
   [TEST_RECORD.md](TEST_RECORD.md)). Nothing ran on a physical iPhone, iPad or Android device, or
   with a physical controller. Please run the hands-on checklist in the test record over HTTPS, at
   <https://shotif.github.io/starman-reborn/>.

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
- **WebGL context loss** is handled (overlay with reload, automatic resume on restore) but was not
  forced in automated tests.
- **Transferred size on mobile networks.** Measured from the production build: about 620 KB
  gzipped for the first scene (three.js 147 KB, game code and the bundled sky and world data
  449 KB, addons 7 KB, CSS 16 KB, HTML). It has grown with the verified sky (207 systems) and
  the game's systems; splitting the world data out of the first load is the obvious next step
  when phones are tuned. Loaded on demand: the star map (~20 KB) on first open, the science notes
  (~4 KB), and bloom (~4 KB) on the High preset only. Real-network timings were not measured.

## Deliberate prototype limits

- The written story is the opening chain, three short optional jobs, three faction arcs of five
  missions each and The Long Border (five steps, branching three ways at its choice); everything
  else on the job boards is generated. The faction arcs know about each other only through
  standing and through Kettering, whose briefings follow the choices made in them. The lasting
  marks an arc leaves on the world are a dark den (for six hours) and the Ross 154 – Wolf 1061
  front, settled for good by The Long Border.
- The border war is a tide on the clock plus the player's deeds, not a simulation of fleets. It
  runs only on the five lanes where a den's system touches lawful space, and only The Long Border
  settles a front; the other four swing for ever.
- Goods move between stations out of sight as a spill along the lanes, not as individual ships;
  only the player's own system has traders flying.
- Traffic and raider packs exist only around the player. Packs that saw the player and cargo pods
  left adrift wait for 30 minutes of game clock (in the last six systems), as do the packs and
  wrecks of the player's own contracts; everything else is generated again on arrival.
- Escorts run between two stations of one system; there are no escorts across jumps.
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
- The offline cache (service worker) is a stretch-goal implementation: it registers only in
  production builds over HTTPS or on localhost, and was not tested offline on a phone.
