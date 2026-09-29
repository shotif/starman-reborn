# Known gaps

This is an honest list of what the prototype does not do yet, or what has not been verified.

## Needs your action

1. **Astronomy snapshot not captured.** The build environment could not reach the ESA Gaia archive,
   SIMBAD, VizieR or the NASA Exoplanet Archive (blocked by its network policy). The bundled star
   and planet data are therefore **provisional transcriptions**, and every place in the game that
   shows them displays a *Pending verification* badge. On a machine with internet access, run
   `npm run data:snapshot && npm run data:build && npm run data:validate`, then commit the result.
   The badges disappear automatically and the dated archive values replace the stopgaps. See
   [ASTRONOMY_SOURCES.md](ASTRONOMY_SOURCES.md).
2. **Real-device testing is pending.** Everything was tested in headless Chromium with emulated
   phone and tablet viewports, touch events and multi-touch (see [TEST_RECORD.md](TEST_RECORD.md)).
   Nothing ran on a physical iPhone, iPad or Android device. Please run the hands-on checklist in
   the test record over HTTPS (GitHub Pages or `npm run dev:https`).
3. **GitHub Pages must be enabled once** (*Settings → Pages → Source: GitHub Actions*) before the
   deploy workflow can publish the site. Private repositories need a paid GitHub plan for Pages.

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

- Only the first delivery chain is fully scripted. Three short optional contracts follow; the
  economy is fixed-price, not dynamic.
- One raider type and one scripted ambush. Other systems are peaceful apart from practice drones in
  Sol.
- No ship purchasing, subsystem damage, fleet battles, multiplayer, cloud saves or cross-device
  sync (out of scope per the spec).
- Solar System planet positions are schematic and do not follow an ephemeris.
- Stations and ships do not collide with each other in detail (spheres only).
- The offline cache (service worker) is a stretch-goal implementation: it registers only in
  production builds over HTTPS or on localhost, and was not tested offline on a phone.
