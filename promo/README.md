# The 60-second trailer

Tooling that makes `out/starman-reborn-trailer-60s.mp4` from the game itself: every frame is the
build in this repository running in a browser, and every sound is rendered by the game's own audio
engine (`src/audio`). No stock footage, music or samples. The brief is
[docs/PROMO_TRAILER_PROMPT.md](../docs/PROMO_TRAILER_PROMPT.md); what each shot is and how it is
staged is in [SHOTLIST.md](SHOTLIST.md).

Rendered frames, audio stems and videos go to `promo/out/`, which is ignored by git (about 25 GB of
frames). Everything there can be made again from what is committed here.

## Rebuild

```bash
npm ci                         # the game's own dependencies, in the repository root
npm ci --prefix promo          # ffmpeg and ffprobe for the edit (ffmpeg-static, ffprobe-static)
node promo/capture.mjs --all   # capture every shot the edit uses (see "Capture" for how long)
node promo/build.mjs           # cards, soundtrack, picture, master, silent loop and checks
```

With the frames already in `promo/out/frames/`, **`node promo/build.mjs` is the one command** that
makes the whole trailer again from the frames and the cue sheets. It takes about two minutes and
ends with "All checks passed", or with what failed.

It needs Node 22.18 or newer and a Chromium that Playwright has downloaded
(`npx playwright install chromium`), or Google Chrome; `PROMO_CHROME` names another. The dev server
(`npx vite --port 5173`) is started if it is not already running: the capture patches modules
through it, so it must be the dev server and not a build.

## What is here

| File | What it does |
| --- | --- |
| `edl.json` | The edit: clips (shot, in-point, length in beats), captions, the end card, the music's mood, seed and intensity, the hits placed on cuts, the mix and the encode. |
| `shots.mjs` | How each shot is staged and flown. |
| `capture.mjs` | Captures shots to `out/frames/<shot>/`, one PNG a frame, and writes each shot's cue sheet. `--preview` saves one frame in twenty and a contact sheet, for framing. `--list` lists the shots. |
| `lib/harness.mjs` | The browser, the virtual clock, the capture-only overrides, the recorder. |
| `cues/<shot>.json` | Cue sheets: every sound the game asked for in a shot (effects, music mood, combat intensity, engine state, room), to the frame. `cues/timeline.json` is where the edit puts them. |
| `audio.mjs` | Renders the soundtrack's stems in OfflineAudioContexts through the game's mix chain, then mixes and masters with ffmpeg. |
| `cards.mjs` | Draws the captions and the end card in the game's own page, with its stylesheet and fonts. |
| `build.mjs` | Cuts the frames as the EDL says, lays the cards and the soundtrack over, encodes, and checks the result. `--picture` skips the cards and soundtrack; `--draft` makes a quick 960×540 `out/draft.mp4`. |
| `scan.mjs` | Finds frames with part of the picture missing (see "Capture"). |
| `sync.mjs` | Measures picture against sound in the master. |
| `peek.mjs`, `cuesum.mjs` | A contact sheet of part of a shot, and a shot's cue sheet in brief: for choosing in-points. |

## Capture

A shot is staged in real time through the game's `?test=1` hooks, then the game's clock is frozen
and stepped one sixtieth of a second a frame, a screenshot after each step. The page is laid out at
1280×720 CSS pixels at a device scale factor of 1.5 (so the HUD is large enough to read in a small
player), and the 3D canvas is drawn at 3840×2160 and scaled down, which is the anti-aliasing.

- **In software (the default)**, with the SwiftShader flags of `playwright.config.ts`: about 0.7 s
  a frame at this size, so `--all` (about 9,900 frames) takes between one and two hours. Every
  frame is whole.
- **On the GPU**, `PROMO_GPU=1`: about 0.1 s a frame on an Apple M4 Pro, `--all` in ten to fifteen
  minutes. Chromium 153's compositor on Metal now and then draws a frame with a
  tile of the 3D canvas missing (about one frame in three hundred; more where the picture is mostly
  black). `capture.mjs` scans each shot for such frames afterwards and fails the shot if there is
  one; `build.mjs` refuses a clip that includes one, and scans the finished master too.

The trailer as built here used both: `undock`, `lane`, `race`, `station` and `comet-clean` are
software captures, because the GPU dropped tiles in them; the rest are GPU captures whose flagged
frames (listed in `out/glitches.json`) fall outside the parts the edit uses.

Staging runs in real time, so a fight is not the same fight twice. After capturing `clash` or
`assault` again, run `node promo/cuesum.mjs clash assault` and move the fight clips' `in` points in
`edl.json` so that each blast (`explosion-large`) still lands where the cut wants it; the notes
beside the fight clips below say where.

## The edit

The trailer is cut to the title theme, D major at 68 beats a minute: one beat is 0.882 s, a bar
3.53 s, and 17 bars are exactly 60 s. Times in `edl.json` are beats ("b12" is beat 12) or seconds.

- The fight's five clips are placed so the blasts fall on beats: 19.42 s (b22), 22.05 s (b25),
  28.22 s (b32) and 30.87 s (b35).
- `trade` plays at double speed. Nothing else is retimed. `title` is the only reframed clip (a slow
  push in on the plate).
- `grade: "pop"` (contrast 1.05, saturation 1.1) is on the fight only; everything else is as captured.

## The soundtrack

Four stems, each rendered by the game's own classes in an OfflineAudioContext with the game's
`MixGraph` (buses, reverb, limiter) at the game's default volumes:

- **music**: `MusicPlayer` playing the `title` mood (the EDL's seed), its combat layer brought up
  and down by the EDL's `intensity` points: 0.3 as the ship launches, full for the fight and again
  for the black hole, off for the end card.
- **sfx**: `SfxPlayer` playing every effect in the cue sheets of the clips used, where the edit puts
  it, and the EDL's `hits`: the game's own `jump-charge`, `jump-exit`, `cruise-charge`,
  `explosion-large`, `boost-start`, `scan`, `dock-clamp`, `lane-enter` and `mission-complete`
  placed on cuts. Effects with pitched tones are transposed into the theme's key (`jump-exit` and
  the lane sounds a tone up; `mission-complete` a fourth up).
- **engine**: `EngineSound` following the engine states in the cue sheets.
- **ambience**: `AmbiencePlayer` playing the deck, trader and bar beds under the station shots.

ffmpeg then mixes them (levels in `edl.json`; the music a little brighter and ducked under the
effects) and masters: gain into a limiter that works at four times the sample rate, the gain found
by trial until the integrated loudness is on target. `out/audio/report.md` has every stem's and the
master's levels; `out/audio/*.png` are spectrum and waveform pictures.

## Checks

`build.mjs` fails unless the master is 3,600 frames of 1920×1080 at a constant 60 fps, H.264 High,
yuv420p, with AAC-LC stereo at 48 kHz, the `moov` atom at the front, integrated loudness within
1 LU of −14 LUFS, true peak at or under −1 dBTP, no glitched frame, and sound within two frames of
picture on every sharp sound the game drew and voiced in the same frame (the fight's blasts, the
launch, cruise engaging). It writes `out/qa/facts.json`, `out/qa/sync.json`, contact sheets of a
frame every half second (`out/qa/sheet-*.jpg`) and the master's spectrum and waveform.

## What the captions claim

| Caption | Source |
| --- | --- |
| 207 real star systems | README, first line; the title screen's own tagline; `SYSTEMS.length` is 207 |
| Out to 27 light-years | README, first line; the farthest system is 27.2 ly |
| 322 stations · 39 ships · 7 story arcs | README: "322 generated stations of twelve kinds", "39 ships in six classes", "Seven hand-written story arcs" |
| Fly, Fight, Race, Mine, Trade | The title screen's tagline ("Fly, trade, mine and fight"); README on races and mining |
| Hire a crew | README: "Sign on a crew of your own", and wingmen for hire in the bars |
| Run your own outpost | README: "stations of your own (up to three, one to a system)" |
| Real flare stars · Wolf 359 · 7.86 light-years | README: "ten real red dwarfs are flare stars, Proxima Centauri and Wolf 359 among them"; the star map lists Wolf 359 at 7.86 ly. That they flare is real; when is the game's, and the caption does not say otherwise |
| Then a star dies · Pyre · the one invented star | README: "Pyre dies: the one star the game invents"; the HUD badges Pyre and its black hole FICTION in the same shots |
| Starman Reborn · Among real nearby stars · Wishlist now | The title screen's logotype and its line; the call to action the brief asks for |

Betelgeuse's supernova is not in the trailer, and nothing invented is captioned as real.
