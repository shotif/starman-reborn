# Design notes

## Direction

Starman Reborn takes the approachable feel of Microsoft/Digital Anvil's 2003 game *Freelancer*:
mouse flight, trade lanes, dockable bases, a readable dogfight, factions and simple trading. It
moves that feel into our **real** solar neighbourhood. Nothing from the original game is used:
no dialogue, story, maps, models, logos, recordings, music or data. The title, ships, stations,
factions, text, music and sound are original. If the project is ever distributed, Microsoft's
[content usage guidance](https://www.microsoft.com/en-us/legal/intellectualproperty/copyright/permissions)
is the relevant reference.

The prototype is a small, complete loop (10–20 minutes). One job chain teaches every system:
trade → fight or bypass → dock and upgrade → interstellar jump → discovery → delivery → free
exploration.

## Two scales

| Scale | Units | Owner |
| --- | --- | --- |
| Neighbourhood map | light-years, double precision, Sol at origin, ICRS J2016.0 | `src/galaxy/` |
| Local system scenes | game units (~1 m at ship scale), compressed and schematic | `src/world/` |

Light-years never map into the flight scene. Local layouts compress real proportions so travel
takes minutes: in Sol, Earth to Mars is about 26 km of game space, and Alpha Centauri A/B to
Proxima is about 235 km. Every scene shows a small scale note.

The map renders camera-relative: all positions stay in double precision, and each frame every
object is placed at `worldPos − cameraPos` with the camera at the origin. Three.js already builds
model-view matrices in double precision on the CPU, so local scenes up to ~250,000 units keep
sub-centimetre vertex precision. The depth range is near 0.5 to far 2,000,000, and art avoids
thin coplanar shells (atmospheres are a rim shader) to prevent z-fighting.

## Flight model (`src/flight/ShipBody.ts`)

- Damped arcade motion: velocity eases toward `forward × throttle speed + strafe`, with a response
  rate of 1.6/s (0.8/s in cruise). Engines-off drift keeps the current velocity.
- Every smoothing term is `1 − exp(−rate × dt)`, so it is frame-rate independent (unit-tested).
  Frames are clamped to 100 ms and split into ≤1/60 s sub-steps; after a tab resume the loop
  restarts with a zero delta, so nothing teleports.
- Mouse flight: the cursor offset from the screen centre (with a 7% dead zone and a gentle curve)
  sets the yaw/pitch rate. Roll levels to the scene's up axis, and the ship's visual banking is
  cosmetic.
- Speeds: 110 m/s at full throttle, +95 boost, 620 cruise (1.8 s spin-up), lanes 2,600–9,500 m/s.
- Autopilot: Go To plans a route and uses a trade lane when it saves ≥20% time. Docking is an
  approach followed by a short scripted final glide, and undocking is scripted.

## Aiming and combat (`src/combat/`)

- Guns fire at the **3D point under the reticle**, i.e. along the camera ray through the visible
  cursor (desktop) or the aim-stick reticle (touch). Bolts are clamped to a 32° swivel arc around
  the nose and inherit the ship's velocity. The reticle turns dashed outside the arc.
- The lead marker solves the intercept `|r + v t| = s t` using the relative velocity.
- Aim assist, touch only by default and set to Low: when the reticle is within a small radius of
  the selected target's lead marker it is pulled part of the way toward it. The reticle shows a
  glow when this happens. Assist never selects a target.
- Ships and equipment come from the rule-generated catalogue (see [PROCGEN.md](PROCGEN.md)). The
  starting Halden courier Mk I has a 60-point balanced shield (6/s regen after 3 s), hull 100 (no
  regeneration) and two pulse cannons (9 damage per bolt, 2.75 bolts/s each, taking turns), with
  weapon energy shared with boost. Every gun mount fires its own gun; bolts carry a damage type
  that shields resist or suffer (energy beats deflectors, kinetic beats hulls, plasma beats
  diffusers, ion strips any shield but barely touches hulls). Seekers and torpedoes lock on inside
  a 40° cone and 1.7 km after their lock time (0.8 s and 1.6 s); rockets fly unguided at the aim
  point.
- Raiders fly Wake Salvage kit: a deflector shield and plasma guns.
- The Hollow Wake raider flies attack runs with lead aiming and burst fire, breaks off to avoid
  ramming, jinks when its shield collapses and flees below 22% hull. Difficulty scales its damage,
  accuracy and health. The encounter lasts roughly one to two minutes and ends in one of three ways:
  destroyed (220 cr bounty and salvage pod), escaped (80 cr), or bypassed with the one-click
  "Avoid combat" route.
- Losing the ship triggers a rescue to the last dock for at most 150 cr, with cargo kept.

## Economy (`src/economy/`)

Three commodities with different cargo sizes (medical 1, fabricator parts 2, deuterium 3) and
fixed per-dock prices. Friendly or trusted standing improves prices by 7–12% and repairs by
25–40%. The trade computer only uses prices the player has **seen at a visited dock** or been
**told in a contract briefing**.

Reference route with a 20-unit hold and 800 cr start. Medical supplies cost 38 at Earth, sell for
54 at Mars and 96 at Meridian (Proxima). A full hold sold at Meridian earns +58 per unit, the jump
fee is covered by the delivery contract, and repairs cost 2 cr per hull point. The first delivery
also pays a 1,000 cr reward and the optional bounty adds 220 cr. Each voyage report shows its net
profit.

Equipment and ships: every station with an outfitter sells its makers' equipment up to a class
limit (classes 4–5 need standing), rounds for your launchers and repair kits; the Barnard relay
sells repair kits only. The outfitter is organised by your ship's mounts: pick a mount, and the
dealer lists what fits it, priced after buying back what it replaces at 70%. Shipyards on the
hangar deck sell ships of their makers and credit your ship and fittings at 70%; the new ship
comes with its stock loadout and full racks, and your cargo moves across if it fits. See
[PROCGEN.md](PROCGEN.md) §6 for the makers, classes and families.

## Factions and reputation

- **Sol Transit Authority.** Runs Sol and the Barnard relay. +15 for destroying the raider.
- **Frontier Cooperative.** Runs Proxima, Sirius and Epsilon Eridani stations. +20 for the first
  delivery.
- **Hollow Wake.** Raiders, always hostile.

Standing changes dock welcome text, prices, repair discounts and contract availability. For
example, the Sirius survey contract needs Friendly Frontier standing.

## Jobs (`src/economy/jobs.ts`)

Objectives are evaluated from state, so detours never break a job. Leaving for another system,
selling the cargo, or scanning Proxima b early are all handled: the objective text adapts (e.g.
"Jump to Alpha Centauri, then …" or "Acquire 2 more medical supplies"). The first delivery chain
is: buy 6 medical supplies → dock at Deimos Depot (grants interstellar clearance) → scan Proxima b
→ deliver at Meridian Outpost. The raider ambush near Mars is part of that leg. Follow-up
contracts exist at Barnard, Meridian and Sirius.

## Saves (`src/app/save/`)

- The whole solo state is one versioned record (`GameState`, format v2), stored in IndexedDB. Each
  write is a single transaction that also rotates the previous save into a backup slot.
  localStorage is the fallback, then memory.
- The game saves after docking, trades, rewards, jumps, discoveries and encounter outcomes, every
  20 s in flight, and on tab hide or page hide.
- Loading migrates older formats (v1 → v2 is covered by tests), validates the result, and falls
  back to the backup when the main save is damaged.
- Settings are stored separately and survive **New game** and **Reset save**.

## Rendering and performance

- One WebGL 2 `WebGLRenderer` is shared by flight, docked backdrops and the map. ACES tone mapping
  and sRGB output.
- Quality presets: Low (DPR ≤ 1, 30 fps budget), Medium (DPR ≤ 1.5) and High (DPR ≤ 2 plus bloom,
  loaded lazily). `Auto` picks Low on touch devices and Medium on desktop. Dynamic resolution
  lowers the pixel ratio (down to ×0.55) when frames run over budget and restores it with
  headroom.
- The loop stops while the tab is hidden and renders at roughly half rate on docked and menu
  screens.
- WebGL context loss shows a recoverable overlay with a reload path.
- Without WebGL 2, a friendly compatibility screen still shows the 2D star map and the science
  encyclopedia.

## UI and accessibility

- HTML/CSS for all text and controls; the canvas draws only the 3D scene. Sizes use rem, so the
  Text size setting (100–150%) scales every menu and the HUD.
- States always pair colour with a shape and a word: hostile ◆ diamonds with "Hostile" text,
  station squares, dotted planet circles, and Observed / Illustrated / Fiction / Pending
  verification badges with icons.
- Menus work by keyboard (visible focus rings, focus trapping in dialogs, Esc to close) and by
  touch (≥44 px targets).
- Reduced motion calms effects and removes the speed FOV. Camera shake and bloom each have a
  toggle.
- Touch-action `none` applies only to the flight canvas, stick zones, buttons and slider; menus
  scroll normally. Every edge-anchored control respects safe-area insets.

## Interface direction

The 2026 redesign follows the feel of *Freelancer*'s interface, studied from gameplay screenshots
the project owner supplied (not stored in this repository). What makes that interface feel like a
game rather than a web page, and how Starman Reborn adapts it with original work:

**The place is the menu.** Docking puts you in a rendered 3D room — a hangar deck with your ship
on its pad, a bar with people at tables, a trader's floor — and the interface is a thin layer on
top. We build procedural interiors per station (`src/world/rooms/`), styled by who runs the
station and the light of its star: one hangar hall holds the deck, the trader's cargo floor and
the outfitter's workshop (the camera glides between them), and the bar is a separate room the
view cuts to behind a quick fade. Each station has its own palette, pillars, bay, props, crew and
bar decor, and the view through the bay shows its real sky, star and planet.

**Rails of icons instead of tabs.** A room rail is attached to the top edge of the screen: one
large glyph per room, the current room lit amber. A small tab hangs below it with the actions of
the current room (launch from the deck; jobs and news in the bar). A second, smaller rail at the
top right holds the always-available screens (star map, journal, science notes, menu). In flight,
the same top rail carries the flight commands (free flight, go to, dock, cruise).

**Framed glass.** Panels are translucent navy glass with 45° cut corners, a thin cyan edge that is
brighter along the cuts, and a faint scanline texture. Buttons follow the same shape. Nothing
uses rounded web cards.

**Icons and numbers first, prose on demand.** Lists are rows of icon · name · number, colour-coded
(hostile red, friendly green, neutral white) and always paired with a shape or word. Descriptions
open from an info button. Gauges are segmented bars; tabular figures keep numbers aligned.

**Typography.** Saira Condensed for labels, rails, buttons and HUD; Saira Semi Condensed for
reading text (both SIL Open Font License, bundled — no font requests to third parties).

**Adapting to phones.** The reference is a 4:3 desktop game. On landscape phones the rails stay
at the top; on portrait phones the room rail stays at the top and the global rail moves to the
bottom edge, and windows become full-width sheets between them. Touch targets stay ≥ 44 px, text
scaling up to 130% (and 130% page zoom) must not cut anything off, and the flight HUD keeps both
thumb areas clear.

Nothing is copied: no icons, fonts, logos, names, textures or layouts are taken from the original
game; the shapes, glyphs, palette variations and 3D rooms are drawn for this project.

## Audio (`src/audio/`)

Everything is synthesized at runtime with Web Audio. There are generative music moods per system,
plus docked, map and title moods, and a combat layer. The 32 sound effects and a continuous engine
hum are also synthesized. The AudioContext is created inside a user gesture (iOS-safe unlock),
suspends while the page is hidden, and a limiter keeps peaks below 0 dBFS.
