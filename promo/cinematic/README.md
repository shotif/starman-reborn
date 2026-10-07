# The cinematic cut: "The Stars Are Real"

A two-minute trailer for YouTube: a pilot looking back over a career among the real nearby stars.
The narration is their logbook, and every place the edit names is stamped REAL or FICTION with the
game's own badge. Like the Steam cut ([../README.md](../README.md)), every frame is the build in
this repository running in a browser. Unlike it, the sound is not all the game's: there is a
narrator and a score.

Out: `promo/out/starman-reborn-cinematic.mp4` (1920×1080, 24 fps, 120 s). `--uhd` also writes a
3840×2160 copy for upload.

## Rebuild

```bash
npm ci && npm ci --prefix promo
PROMO_GPU=1 node promo/capture.mjs --cinematic   # the shots, about fifteen minutes on an Apple GPU
node promo/cinematic/voice.mjs        # needs the ElevenLabs key (below); skip if assets/vo/ is there
node promo/cinematic/sfx.mjs          # needs the key; skip if assets/sfx/ is there
node promo/cinematic/score.mjs        # no key: the score is synthesised here
node promo/cinematic/build.mjs        # cards, mix, picture, master, checks
```

With the shots in `promo/out/shots/` and the generated audio in `assets/`, **`node
promo/cinematic/build.mjs` is the one command** that makes the cut again (about two minutes).

### The ElevenLabs key

Narration and sound design are generated with ElevenLabs. The key is read from `promo/.env`,
which git ignores:

```
ELEVENLABS_API_KEY=…
ELEVENLABS_API_BASE=https://api.eu.residency.elevenlabs.io
```

It is sent only to that host, as the `xi-api-key` header (`../lib/eleven.mjs`); nothing prints it
or writes it anywhere else. What it generates lands in `promo/cinematic/assets/`, which git also
ignores: the audio is made on an account's credits and under its licence, so it stays on the
machine that made it.

## What is here

| File | What it does |
| --- | --- |
| `script.json` | The narration's lines, the voices to try and which is in use, the score's plan, the sound design's prompts. |
| `edl.json` | The cut: clips, stamps, the end card, where each line of narration and each designed sound goes, the mix. Times are seconds or bars of the score ("b25", "b25:3"). |
| `shots.mjs` | How each `c-…` shot is staged, flown and filmed. `node promo/capture.mjs --list` lists them. |
| `voice.mjs` | Narration: each line generated on its own with the time of every word, then transcribed back and compared with the script. `--audition` makes one file of every voice. |
| `sfx.mjs` | Trailer sound design (impact, riser, pass-by, drone, reverse swell, rumble), each measured for where it starts, peaks and ends. |
| `score.mjs` | The score: written as notes and synthesised from oscillators, noise and filters. |
| `music.mjs` | ElevenLabs' music model, to the same plan (see "The score"); also the analysis both scores share. |
| `cards.mjs` | The stamps and the end card, drawn in the game's own page. |
| `build.mjs` | Mix, picture, encode, checks. |
| `cues/` | Each shot's cue sheet: every sound the game asked for, to the frame. |

## Picture

Captured as the Steam cut is (virtual clock, the `?test=1` hooks, real mouse and keyboard), with
three differences, all in `../lib/harness.mjs`:

- **24 frames a second with real motion blur.** The game is stepped four times for every frame of
  film and each step captured; three of every four are averaged (a 270° shutter). The steps are
  deleted as soon as a shot is blended, so a shot costs megabytes on disk.
- **True slow motion.** `rec.slow = 5` steps the game a fifth as far each time. The wide battle
  shot does this for 2.2 s whenever a ship blows up.
- **Camera rigs.** Most shots hide the interface and place the game's own camera: beside the ship,
  fixed in space while the ship flies by (`anchor: 'fixed'`), or circling a target (`around`).
  The star map's own camera is turned and pulled back steadily (`mapMove`), and its panels are
  hidden so only the stars and their names show.

Four shots keep the interface on, so it is plainly a game: Proxima Centauri b (the HUD's own REAL
badge), the trader's buy dialog, and two fights.

On an Apple GPU Chromium now and then draws a step with a tile of the 3D canvas missing. Each shot
is scanned for those steps before blending (`../scan.mjs`, which now also catches two or three in
a row) and each takes the step before's place; the finished master is scanned again.

## Sound

- **Narration.** ElevenLabs text-to-speech, `eleven_multilingual_v2`, one of the account's stock
  voices (`script.json` → `voice.use`; four sets are generated for comparison). Every line came
  back transcribed exactly as written.
- **Score.** `score-own`, composed and synthesised by `score.mjs`: D minor, 90 beats a minute,
  45 bars, one theme carried from a piano to horns to full brass. It is here because ElevenLabs'
  music model answered "Music is not available in this region" on the EU data centre this
  project's key belongs to. The cut is timed to the score's eight sections, and `script.json`
  carries the same eight as a plan for that model, so a track generated to the plan elsewhere
  drops in: save it as `assets/music/<name>.wav`, set `music.use`, rebuild.
- **The game's own effects.** Engines, guns, blasts, the lane, the jump: rendered from the cue
  sheets through the game's mix chain, as in the Steam cut.
- **Sound design.** Six sounds from ElevenLabs' sound-effects model, placed on cuts.

The mix ducks the score and the effects under the voice and masters to −14 LUFS. `build.mjs`
reports how far the voice sits above everything else during each line and fails under 6 dB.

Nobody listened to any of it while it was made: narration is checked by transcription, the rest by
measurement. The voice, the score and the balance need a pair of ears.

## What the narration and the stamps claim

The narrator is a character and their career is fiction. What they say about the sky is not:

| Line or stamp | Source |
| --- | --- |
| "Two hundred and seven star systems lie within twenty-seven light-years of the Sun. Every one of them is real." | README, first line; `SYSTEMS.length` is 207, and Pyre, the invented star, is not among them |
| "Four light-years to Alpha Centauri." · stamp: 4.39 light-years, REAL | The star map lists Alpha Centauri at 4.39 ly |
| "There's a planet at Proxima. That part is true." | README; the HUD in the shot: "Proxima Centauri b · REAL · Confirmed exoplanet · discovered 2016" |
| Stamp: Earth, REAL · Halcyon Ring, FICTION | README: planets are real; stations are fiction |
| Stamp: Jump drive, FICTION, "fictional technology" | The game's own jump card says so |
| Stamp: Lalande 21185, 8.30 light-years, REAL | The star map lists it at 8.30 ly (the outpost there is the player's, and fiction) |
| Stamp: Comet 2P/Encke, REAL | README: fourteen real comets, Encke among them |
| "The night Pyre died" · stamps: Pyre, FICTION, "the one invented star"; Pyre's black hole, FICTION | README: "the one star the game invents" |

Pyre's death is shown as the star, a ship leaving it, a dip to white on the score's hit, and the
black hole: the game does not draw the explosion in Pyre's own system, so the trailer does not either.

## If this is published

The narrator's voice, the sound design and (if swapped in) a generated score are AI-generated.
YouTube and Steam both have disclosure rules for synthetic media; check what applies before
uploading, and check the ElevenLabs plan's terms for commercial use.
