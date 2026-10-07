# Prompt: a 60-second Steam trailer for Starman Reborn

You're working in the Starman Reborn repository, a Three.js/TypeScript browser game about trading,
fighting and exploring among the real stars within 27 light-years of the Sun. Your job is to make
a finished 60-second promotional trailer, with sound, of the kind that autoplays at the top of a
game's Steam store page. Every shot must be real gameplay captured from this build, and every sound
must come from the game's own audio engine.

This is a long job with several stages: shot design, a few hours of automated capture, audio
rendering, editing and QA. Work through to a finished file on your own. Only stop to ask if you
reach a decision that only I can make.

## What the trailer has to do

Steam autoplays store trailers, often muted, and viewers decide within a few seconds whether to
keep watching. So:

- Open on the strongest gameplay image you have, inside the first 2 seconds. No studio logo, no
  slow fade from black, no title card first.
- Tell the story with pictures first and sound second. Someone watching muted on a small player
  should still get the pitch from the images and short on-screen text.
- Build energy across the minute: wonder, then action, then scale, then spectacle, then the title.
- End on the game's name and a call to action ("Wishlist now"), on screen long enough to read
  (at least 3 s).
- Show the actual game, with the HUD visible in a good share of shots. Steam's guidelines ask for
  store trailers that show gameplay, and players feel cheated by trailers that don't. Cinematic
  shots without the HUD are fine too, as long as the game rendered everything on screen.

## The pitch, and the features worth showing

Read `README.md` first. It's the authoritative feature list. Below are the features I think set
this game apart, roughly ordered by how well they sell on screen. Use your own judgement once
you've seen them render.

1. **The real sky.** 207 star systems out to 27 light-years, with positions and planets taken from
   the astronomical archives (Gaia, SIMBAD, the NASA Exoplanet Archive). The 3D star map (Tab/M) is
   a natural hook: orbit it, then zoom from Sol out to the neighbourhood. The sky also has real
   exoplanets (Proxima Centauri b), real binary orbits (Alpha Centauri A/B, Sirius A/B) and real
   comets with coma and tails, placed where JPL has them on the game's date (Halley, Encke).
2. **Flight and combat.** Mouse or gamepad flight behind a chase camera: gun bolts, seekers and
   decoy flares, explosions, raider packs, wingmen, and raider dens that fire back. There are also
   border-war battles fought in sight off the beacons (for example the Ross 154 beacon line) and
   one-on-one duels with rival pilots.
3. **Spectacle.** The fictional Betelgeuse supernova outshining every sky. Pyre, the one invented
   star, collapsing and leaving a black hole with an accretion disk. Flare stars like Wolf 359
   flaring. Comets near the Sun.
4. **Racing** through gates around a real planet or moon, such as the Moon Loop out of Halcyon Ring.
5. **A living economy and a career.** Stations with 3D interiors (deck, bar with people, trader,
   outfitter), trading, and mining real asteroid belts with a mining laser. Named haulers fly the
   trade lanes, and jump drives link the stars. Later come a fleet, captains, and outposts of your
   own built in orbit of real planets.
6. **Scale and story:** hundreds of stations, dozens of ships, seven hand-written story arcs.

The numbers change as the game grows. Take every number you put on screen from the current README
or the data, not from this prompt.

### Accuracy rules for on-screen text

The game is careful about what's real and what's fiction (look at the REAL and FICTION badges in
the HUD). The trailer has to be just as careful.

- The stars, planets, belts, comets and binary orbits are real. The stations, factions, ships,
  jump travel, trade lanes and story are fiction.
- Betelgeuse's supernova, Antares going dark, and Pyre are fiction. Never caption them as real
  events (no "watch Betelgeuse explode, for real"). Show them, but don't call them real.
- Every claim in a caption has to trace back to `README.md` or the code. Keep a short list of
  claims and their sources for your final report.
- Don't invent features, reviews, awards, quotes, release dates or prices. Leave out Steam and
  Valve logos and other games' names. The end card says "Wishlist now", and I'll adjust the
  platform wording myself.

## Hard constraints

- Exactly 60.0 s long (give or take one frame).
- 1920×1080 at 16:9. H.264, High profile, yuv420p, in an MP4 with `+faststart`. Constant 30 or
  60 fps. High bitrate: CRF 16 or lower, or at least 15 Mbps. Audio in AAC-LC, stereo, 48 kHz,
  320 kbps.
- Loudness around −14 LUFS integrated, true peak no higher than −1 dBTP, and no clipping.
- All footage comes from this game's build. In the edit you may use cuts, crops and reframes
  (better still, capture at the final framing), speed ramps, colour grading, fades and dips,
  motion blur from frame blending, and text overlays. You may not use stock footage, AI-generated
  imagery, effects painted onto gameplay that the game doesn't render, or mock-up UI.
- All sound comes from the game's own procedural audio engine (`src/audio`). No stock music,
  samples or third-party sounds. Editing, layering, EQ, reverb, and pitch or time changes to the
  game's own sounds are fine.
- Don't change committed game code to get a shot. Capture-only tweaks (injected scripts, dev-server
  module patches, CSS overrides) belong in your capture scripts, so the game stays as shipped.
- Put your tooling in a new `promo/` directory: scripts, shot list, EDL and cue sheets. Rendered
  frames, audio stems and videos are large and can be regenerated, so add them to `.gitignore`.

## How to capture: what has been tested in this environment

I tested all of this before writing the prompt, using headless Chromium through the repo's own
Playwright with SwiftShader WebGL. Trust these results, but re-measure the timings on your
machine.

### Running the game

- Run `npm ci`, then `npx vite --port 5173`. You need the dev server for the module patches below.
  Open `http://localhost:5173/?test=1`.
- Launch Chromium with the GL flags from `playwright.config.ts`:
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
  Use the repo's own Playwright (`node_modules/playwright-core`). Don't run `playwright install`.
- `?test=1` exposes `window.__starman`, the test hooks in `testApi()` in `src/app/Game.ts`. It also
  keeps Auto quality from stepping down. Lane encounters and border battles stay off unless you
  call `meetLanes(true)` or `meetBattles(true)`.
- Set graphics to High before you play: on the title screen, `title-settings`, then select
  `set-quality` = `high`, then `sheet-close`. The setting is kept in IndexedDB for that browser
  context.

### Real-time recording won't work; frame-stepping does

SwiftShader draws about 13 fps at 1080p, so recording in real time gives choppy footage. The game
loop (`src/app/Loop.ts`) runs only on `requestAnimationFrame` timestamps. That means you can run
the game on a virtual clock and take a screenshot of each frame. This init script worked:

```js
await page.addInitScript(() => {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const realCancel = window.cancelAnimationFrame.bind(window);
  const vt = { on: false, now: 0, q: new Map(), id: 1e6 };
  window.__vt = vt;
  performance.now = () => (vt.on ? vt.now : realNow());
  window.requestAnimationFrame = (cb) => {
    if (!vt.on) return realRaf(cb);
    const id = ++vt.id;
    vt.q.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => { vt.q.delete(id); realCancel(id); };
  window.__vtStart = () => { vt.now = realNow(); vt.on = true; };
  window.__vtStep = (ms) => {
    vt.now += ms;
    const cbs = [...vt.q.values()];
    vt.q.clear();
    for (const cb of cbs) cb(vt.now);
  };
});

// Set the shot up in real time, then:
await page.evaluate(() => window.__vtStart());
for (let i = 0; i < frames; i++) {
  await page.evaluate((ms) => window.__vtStep(ms), 1000 / 30);
  await page.screenshot({ path: `promo/out/frames/${shot}/${String(i).padStart(5, '0')}.png` });
}
```

Measured cost per 1080p frame: about 0.7 s on Medium and about 1.0 s on High with bloom. A minute
at 30 fps is 1,800 frames, so roughly 30 minutes. Plan to shoot two to three times more footage
than you use, and run captures in the background. Before you rely on parallel browsers, check
that they actually speed things up. For a hero shot or two you can supersample: capture with
`deviceScaleFactor: 2` on High (its pixel-ratio cap is 2) and scale down to 1080p. It costs
several times more per frame.

Gotchas, all confirmed in testing:

- **Dynamic resolution.** The frame governor (`src/app/frameGovernor.ts`) compares the loop's
  virtual frame time with a 16.7 ms budget. Stepping at 1/30 s makes it think the game is running
  slow, and it lowers the resolution (from 1.0 to 0.9 within 4 s, and down to 0.55 over time).
  Turn it off in the dev server before you capture:
  `const { FrameGovernor } = await import('/src/app/frameGovernor.ts'); FrameGovernor.prototype.record = () => null;`
  This works because Vite's dev server returns the same module instance the game is using. Then
  check that `__starman.renderInfo().pixelRatio` stays at 1.
- **Only `requestAnimationFrame` and `performance.now` are virtual.** `setTimeout`, CSS animations
  and transitions still run on wall-clock time. At about 1 s per frame, a 5 s toast lasts only
  about 5 frames, and HUD transitions snap. Set up each shot so that no toast or dialog is on
  screen (wait for `.toast` count 0, as `tests/e2e/screenshots.spec.ts` does), or hide `.toasts`
  with injected CSS for that shot.
- **Input after arrival.** After `warp` or an undock, wait until
  `__starman.player().autopilot === 'none'` and then a couple of seconds more before you fire or
  steer. Input isn't live during the arrival sequence. Holding the right mouse button across
  stepped frames fires the guns: in testing that gave 4 shots, each with its laser sound, per
  1.5 s of virtual time.
- **The ship steers toward the mouse cursor.** Leave the cursor at the centre of the screen for a
  steady shot, and move it smoothly between steps for banking turns. `fightWithMouse` in
  `tests/e2e/journey.spec.ts` shows how to aim at the lead marker using `__starman.hud()`.
- **Clean shots.** For cinematic shots, hide the HUD by injecting CSS on `#ui`. The title screen
  shows a "Prototype · build …" label (`.title-build`), which you should hide as well.
- **Camera.** In flight there's only the chase camera (`src/flight/ChaseCamera.ts`). Frame shots
  through the ship's own pose with `face`, `placeNear`, `viewComet` and mouse steering. The star
  map has its own orbit and zoom camera. If you need one or two establishing shots from a free
  camera, a capture-only override is acceptable, as long as it only moves the game's own camera
  and draws the game's own scene. Mention it in your report.

### Staging shots

Don't play hours of career to reach late-game scenes. `tests/e2e/screenshots.spec.ts` already
stages nearly every showcase moment through the test hooks, so read it and reuse its setups. Useful
hooks:

- Getting around: `warp`, `dockAt`, `goTo`, `selectTarget`, `face`, `placeNear`, `viewComet`.
- Time and progress: `completeJobs`, `advanceClock`, `setTimeScale`, `startedOn` (sets the game
  date, which places the comets).
- Spectacle: `skyFrom` and `sky` (the supernova), `edgeAt` and `pyre` (Pyre's death and its black
  hole), `nextFlare` (flare stars).
- Action: `findBattle` and `meetBattles` (border battles), `findRaceVenue` and `raceAt` (races).
- Setup: `fit`, `parkShip`, `setCredits`, `setCargo`, `setSeed`.

The images in `docs/screenshots/desktop-1440x900-*.jpg` show what each scene looks like. Look at
them when you choose shots.

### Sound

The game ships no audio files. All music and sound effects are synthesized at runtime in Web Audio
(`src/audio`). Headless frame capture can't record live audio in sync, so build the soundtrack
offline from the same engine. These steps were tested:

- In the dev server, `await import('/src/audio/offline.ts')` gives you `renderMood(mood, { seconds,
  intensity, seed })`, `renderSfx(id, { opts })`, `renderBurst` and `renderEngine(state, { seconds
  })`. They render through the game's exact mix chain (buses, reverb, limiter) in an
  OfflineAudioContext, faster than real time: 12 s of music took about 1.7 s. Convert each
  AudioBuffer to 16-bit WAV in the page and pass it back as base64.
- `await import('/src/audio/AudioEngine.ts')` returns the running game's module. You can wrap
  `AudioEngine.prototype.play` (and `setMusic`, `setCombatIntensity` and `setEngine`) to log every
  sound the game triggers, stamped with `performance.now()`, which is the virtual clock. That gives
  you a cue sheet for each shot that is in sync to the frame. `setEngine` runs every frame, so log
  only its changes. Re-render the cues offline and place them on the edit timeline. Ideally,
  schedule them all in one OfflineAudioContext with the game's `MixGraph` and `SfxPlayer`, so the
  game's own limiter and reverb bind them together.
- The music moods (`src/audio/moods.ts`) are title, docked, map, sol, alpha-centauri, barnard,
  sirius, epsilon-eridani, bar, frontier, deep-space and den. They're ambient, 50–100 BPM, in
  different keys. The combat layer (intensity 0 to 1) adds a percussion pulse near 124 BPM, so one
  mood with a scheduled intensity ramp can carry calm, then action, then climax. `renderMood` takes
  a fixed intensity; for a ramp, copy its suspend/resume loop and call `setIntensity` at the times
  you choose. Crossfading moods in different keys tends to clash. Prefer one mood as the spine, or
  moods in related keys, and cut the picture to its bar grid (tempo and beatsPerBar are in
  `MOODS`). If no mood can carry a trailer, you may compose a short trailer cue with the game's own
  synth and composer (`src/audio/synth.ts`, `composer.ts`, `theory.ts`) in the same harmonic
  language.
- Big moments need big sounds. The game's `explosion-large`, `jump-charge`/`jump-exit`,
  `cruise-charge`/`cruise-engage`, `missile-launch`, `lane-enter` and `boost-start` work as hits,
  risers and transitions. Time them to cuts and to the music's downbeats.
- Offline renders come out quiet (the title mood peaked around −13.6 dBFS). Master to the target
  loudness at the end with a two-pass `loudnorm`.
- You can't listen to the result, so check it objectively. Use `ebur128` and `astats` for loudness
  and clipping. Make `showspectrumpic` and `showwavespic` images and look at them. Check that
  transients line up with the frames where explosions and shots happen.

## A suggested shape (change it once you've seen the footage)

| Time | Beat | Ideas |
| --- | --- | --- |
| 0–5 s | Hook | The single most striking image: comet tails across Sol with Jupiter behind, or the black hole's disk. Caption: the real-sky claim, checked ("207 real star systems" is on the game's own title screen). |
| 5–15 s | Fly | Undock from Halcyon Ring, burn past the planets, cruise, enter a lane, jump. |
| 15–22 s | The map | Orbit and zoom the 3D star map from Sol out to the neighbourhood, landing on Alpha Centauri or Proxima b. |
| 22–36 s | Fight | A raider dogfight, seekers and flares, explosions, a border battle, wingmen. Bring up the music's combat layer. |
| 36–46 s | Live it | Fast cuts: a race gate round the Moon, the mining laser on a rock, the station deck or bar, trading, your own outpost and haulers. |
| 46–54 s | Witness | A flare star, the Betelgeuse supernova, Pyre's death and the black hole as the hero shot. |
| 54–60 s | Title | STARMAN REBORN, the game's own tagline ("Among real nearby stars"), "Wishlist now". |

On-screen text: 2–5 words per card, set large, on screen for at least 1.5 s. Use the game's own
type and colours: Saira Condensed and Saira Semi Condensed (in `node_modules/@fontsource`),
background `#04060b`, text `#e8eef8`, accent `#5cc8ff`, and the gold title treatment from the title
screen (`src/ui/screens/TitleScreen.ts`, `src/ui/styles/screens.css`). Render the cards as HTML in
the same headless browser so they match the game. Keep text inside the 90% title-safe area.

## Process

1. Read `README.md`, `docs/DESIGN.md`, the screenshots spec and the screenshot images. Write
   `promo/SHOTLIST.md`. For each shot, give its purpose, how it's staged (which hooks), its
   duration, HUD on or off, the sound cues you expect, and its capture cost.
2. Look development: capture one still per shot at the final framing and quality, look at each one,
   and fix the framing before you start any long capture. Cut weak shots at this stage.
3. Capture the shots into `promo/out/frames/<shot>/`, with a cue log for each shot. Make a contact
   sheet per shot (`ffmpeg … tile`) and look for glitches: black or half-loaded frames, flashing
   toasts, popping detail, debug text, a stray cursor, overlapping HUD.
4. Build the soundtrack: the music spine, the SFX from the cue logs, and hits and risers on the
   cuts.
5. Assemble the trailer with a scripted, reproducible ffmpeg pipeline driven by an EDL
   (`promo/edl.json`). One command should regenerate the whole trailer from the frames and stems.
6. Check the master. Extract a frame every 0.5 s into contact sheets and review them the way a
   muted viewer would see them. Check the spelling and accuracy of every caption. Check the specs
   with `ffprobe` and the loudness with `ebur128`. Confirm the duration is exactly 60.0 s, and
   check A/V sync on at least three hits. Fix and re-render until it's clean.
7. Review it critically, as a Steam marketing lead would. Would the first 3 seconds stop someone
   scrolling? Is there a dull stretch? Is any shot unreadable at 640×360? Tighten it and render
   again.

## Deliverables

- `promo/out/starman-reborn-trailer-60s.mp4`, the master. Send it to me when it's done.
- A silent 5 s loop of the best moment (`promo/out/hook-loop.mp4`) for the Steam page and social
  media.
- The `promo/` tooling, committed: capture scripts, `SHOTLIST.md`, `edl.json`, cue sheets, the
  audio render script, and a `README.md` with the one-command rebuild.
- A short report covering:
  - the final shot list with timecodes;
  - what each caption claims, with its source;
  - any capture-only overrides you used;
  - anything you'd do with more time or a real GPU.
