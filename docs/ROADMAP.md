# Roadmap

From prototype to a full game. Each step ships to the live site (<https://shotif.github.io/starman-reborn/>)
when it is done, so the game stays playable throughout. Status: ✅ done · 🔨 in progress · ⏳ proposed.

## Where the game stands

After the scripted opening (10–20 minutes), the neighbourhood is an open sandbox: 32 real
systems, 58 generated stations of twelve kinds, 23 goods with stock-based prices (two of them
contraband), traders and patrols on the lanes, raider packs in lawless space, 35 ships with over
100 pieces of equipment, and generated contracts on every job board. Since this plan was written,
increments 1–6 below have added world events and news, escorts, deadlines, aces, chains and
recoveries, the law and the outlaw path, ratings, a codex and milestones, three faction story
arcs, and combat depth (seekers and decoys, mines, system damage, loot, wingmen, dens under fire).

When this plan was written, what the game lacked was mostly **reasons and consequences**: the
world only changed when you traded, nothing after the opening told a story, standing barely bit,
and there was no long-term goal beyond a bigger ship. Increments 1–6 went after that, in the
order below; the parallel tracks and quick wins are still open. Sizes are relative: S, M, L.

## Proposed next increments

### 1. A world that moves: events, news and restocking ✅

Trading is the core loop, and today a route that pays once pays forever. Events give reasons to
change plans, reward keeping informed, and make the News room worth opening.

- **World tick**: computed from the world seed and the game clock (no background simulation, the
  same on every device). Shortages, gluts, strikes, raids and booms start and end at stations and
  systems and last one to three hours of play. A shortage lifts a wanted good's price and drains
  its stock, a glut does the opposite, a raid raises a system's raider threat and thins its
  traffic, a strike closes one service for a while (never repairs).
- **Traders restock markets**: stock flows from makers to buyers along the lanes at the rate the
  traffic plan implies, so the traders you see in flight are the local part of a real flow.
- **News**: every station's News window reports events within two jumps, dated; the star map
  marks them. News only reports events that exist ([PROCGEN.md §4.5](PROCGEN.md)).
- **Event contracts**: boards near an event post matching work at a premium (supply runs into a
  shortage, freight out of a glut, bounties during a raid).
- **Guardrails**: event prices stay inside the price bands, one event per station at most, the
  opening route is left alone during the tutorial, every event ends, and the tests sample the
  tick over thousands of clock values.

Shipped as proposed ([PROCGEN.md §11](PROCGEN.md#11-world-events)); Sol's stations and the opening
goods are never touched, and each jump now adds two minutes of lane transit to the clock.

### 2. Contracts II: escorts, deadlines, named targets and chains ✅

Builds straight on the contract boards, while they are fresh, and gives fighters and couriers
something new on each visit.

- **Escorts**: protect a named trader from one station to another. It flies with the traffic
  system, raiders try to intercept it, and the contract fails if it is lost.
- **Urgent jobs**: some freight and parcels carry a deadline and a bonus; missing it costs
  standing. The other contracts stay deadline-free. Deadlines are checked against the route
  flown in the starting ship, with a margin.
- **Named targets**: an ace raider with escorts and a better ship, posted as a top-difficulty
  bounty where packs roam. It drops rare salvage or a piece of equipment to tractor in.
- **Chains**: some contracts lead to a follow-up at their destination (a parcel's reply, survey
  data to carry to a research station): two or three steps with rising pay.
- **Recovery**: fetch a flight recorder or cargo pod from a wreck site near a station (fiction,
  like the stations) with the tractor beam.
- **Guardrails**: escort routes only through systems the trader can fly, named targets only
  where packs roam, chains always end, deadlines reachable with margin.

Shipped ([PROCGEN.md §10](PROCGEN.md#10-contracts)): escorts run between two stations of one
system (the hauler holds position if you fall behind), aces drop credits and a cargo pod, and
follow-ups are parcels or hauls. Marking every contract on the star map came with it.

### 3. Law and consequences: customs, contraband and the outlaw path ✅

Standing changes prices, welcome text and a few contract gates. It should also change who
shoots at you and where you can dock. A second way to play doubles the replay value of the same
world.

- **Standing that bites**: at Hostile standing a faction's patrols attack you and its stations
  refuse docking (a distress dock with repairs always remains); Unfriendly means higher fees and
  fewer contracts.
- **Customs**: customs depots and patrols in secure space scan holds. Small arms and new
  contraband goods outside free ports mean a fine and confiscation. Free ports post smuggling
  runs that pay well.
- **The outlaw path**: today the player's guns only hurt raiders. Allow attacking lawful ships,
  with consequences (a bounty on you, hunters, hostile patrols), and let Hollow Wake standing
  rise through jobs at free ports. Friendly with the Wake, the raider dens open as docks with a
  black market.
- **A way back**: fines and pardons at customs depots, so no choice is a dead end.
- **Guardrails**: a dock with repairs is always reachable, contraband prices stay in band, and
  the story never requires a crime.

Shipped ([PROCGEN.md §12](PROCGEN.md#12-the-law-and-the-outlaw-path)) with fines instead of a
bounty on the player: while you owe fines or are Hostile, a faction's patrols attack and its
stations give emergency docking only (repairs at a surcharge and the customs desk), a pardon
costs the fines (and more for Hostile standing), and big fines bring bounty hunters. Two
contraband goods, patrol scans and customs at depots and military bases, piracy (haulers spill
cargo pods), smuggling runs at free ports and dens, piracy jobs at dens, and raider dens with a
black market for pilots the Wake trusts. A Wary faction offers easy work only.

### 4. Goals: ratings, a codex of the real sky, milestones, a hint of what to do next ✅

After the opening, the game does not say what to aim for. This is cheap, and it makes every
other system feel like progress.

- **Pilot ratings** in trade, combat and exploration, ranked from the career statistics and
  shown in the journal; higher ranks open better contracts.
- **A codex of the real sky**: every catalogued star and confirmed planet is an entry that fills
  in when you scan it, with its catalogue data and sources. Research stations pay for completed
  systems, and completing the codex has a reward.
- **Milestones** (first 10,000 cr, first Mk III ship, every system visited...) with a toast and a
  line in the journal.
- **What next**: after the opening, the HUD suggests one thing to do: a contract that fits your
  ship, a route you know, or an unscanned planet nearby.

Shipped ([PROCGEN.md §13](PROCGEN.md#13-goals)): three ratings (ace hunts need a Hardened combat
rating), a codex of 91 real bodies with survey sales to research stations and a grant for the
whole sky, seventeen milestones, and a hint that puts fines first, then the hold, the codex, a
known route and a job board nearby.

### 5. Faction story arcs ✅

The opening shows the game can tell a small story; three short arcs give the sandbox a spine.

- One arc per faction, four to six missions each (a customs scandal for the Transit Authority, a
  colony in trouble for the Frontier Cooperative, an outlaw arc for the Hollow Wake). They are
  built from contract objectives plus scripted beats: named characters in the bars, comms in
  flight, and a choice or two with standing consequences.
- Finales use increments 2 and 3 (a convoy defence, an assault on a raider den).
- Written by hand, reviewed, and tested as browser journeys like the opening.

Shipped ([PROCGEN.md §14](PROCGEN.md#14-story-arcs)): Clean Manifests (a customs scandal, ending in
an assault on a raider den with a Transit Authority wing), The Stonecrop Blight (a colony's crops
failing at Procyon, ending in a convoy defence) and Salt's Crew (for pilots the Wake trusts, ending
in holding a den against an Authority sweep); five missions each, with dialogue at the docks, comms
in flight and a choice each, two of which can end their arc early. Den turrets, a reactor and a
lawful wing came with it, ahead of increment 6.

### 6. Combat depth ✅

- Countermeasures against seekers and torpedoes, and mines.
- Subsystem damage (engines, guns, shields), repaired at docks or with kits.
- Wingmen for hire in the bars, paid per jump.
- Raider dens with turrets and a reactor: destroying one clears its system for a while (a world
  event from increment 1).
- Loot beyond credits: cargo pods and rare equipment to tractor in.
- Hit and damage effects, radio chatter in fights.

Shipped ([PROCGEN.md §15](PROCGEN.md#15-combat-depth)): seekers fired by heavy raiders, aces and
hunters, and decoy flares against them; mines dropped by raiders breaking off and guarding dens;
damage to the engines, guns and shield generator; cargo pods and equipment crates kept in a stash;
wingmen for hire, paid per jump; every den defends itself and can be knocked out (paid by the law,
reported in the news, dark for six hours), with den assault contracts on lawful boards; hit
flashes and radio chatter.

### Parallel track: the real sky, verified ⏳ (S)

- The astronomy snapshot is still provisional because the build container cannot reach the
  archives (ESA Gaia, SIMBAD, VizieR, the NASA Exoplanet Archive). A GitHub Actions workflow,
  run by hand or monthly, can run `npm run data:snapshot`, `data:build` and `data:validate` on
  GitHub's runners and open a pull request with the dated snapshot. That clears the two
  provisional warnings.
- Solar System planets at their real positions for the game date, from JPL's Keplerian elements
  for 1800–2050 ([Approximate Positions of the Planets](https://ssd.jpl.nasa.gov/planets/approx_pos.html)),
  instead of the schematic placement.

### Parallel track: polish and reach ⏳ (M)

- The real-device checklist in [TEST_RECORD.md](TEST_RECORD.md) on a mid-range Android phone and
  an iPhone, then performance tuning from what it finds.
- Gamepad support; save slots with export and import.
- More music, station ambience, radio chatter from traffic.

### Quick wins (S each)

- ~~Mark every active contract on the star map, not only the first one.~~ Done with increment 2.
- Sort and filter the job board (reward, reward per jump, kind).
- A short sound and comm line when a contract pays.
- Remember the last open window at each station.

### How an increment ships

Rules go in data files with guardrails ([PROCGEN.md](PROCGEN.md)). Each increment adds unit tests
for its rules, a browser test for the player's path, and layout screenshots at every test size
when screens change. Then the docs are updated (PROCGEN, TEST_RECORD, KNOWN_GAPS), and it deploys
to the live site once CI passes.

## Done so far

### Fix what real phones hit ✅

Menus cut off on an Android phone with larger text: tab bars could be squeezed by their column,
labels wrapped, toasts covered panels. Fixed, and the layout audit now reproduces large-text
phones (130% text scaling, and 130% page zoom = a 316-wide viewport) and flags content cut off
inside any box that is not meant to scroll.

### Redesign the menus and HUD ✅

A game interface instead of web pages, inspired by the classic space-trader look (see
[DESIGN.md](DESIGN.md#interface-direction)): docking puts you in a 3D place, room and command
rails replace tabs, framed glass windows, icons and numbers first, prose on demand.

- Design system: condensed technical typeface, navy-glass frames with cut corners and cyan edges,
  amber active state, original icon set.
- Station hub: procedural 3D interiors for every station, each in its own style: hangar deck
  (your ship on its pad), trader, outfitter and a bar with people; the camera glides between the
  hangar views and cuts to the bar. Room rail and action tab; two-list dealer windows; job board
  in the bar; shipyard on the deck.
- Title screen, pause, settings and map chrome in the same style.
- Flight HUD: command rail (free flight, go to, dock, cruise), contact list, weapons list,
  segmented gauges, bracketed target box. Touch keeps the thumb areas clear.

### Content generator ✅

Guidelines and guardrails: [PROCGEN.md](PROCGEN.md). Generated from rule files and checked by
guardrails in the unit tests: the ship and equipment catalogue (6 makers, 6 ship classes, 17
equipment families), the world (jump lanes, territory and security, 58 stations of twelve kinds
with generated exteriors and interiors, raider dens), the economy (23 goods, market profiles,
stock-based prices), world events, traffic and raider packs, and the contract boards. The
scripted chain stays as the tutorial.

### Living world ✅

Done: prices that move with stock and drift, traders and patrols on the lanes, raider packs,
reputation that changes prices, welcome text and contract access, world events with news and
restocking (increment 1), and the law (increment 3).

### Ships and combat ✅

Done: 35 buyable ship models across six classes from five makers, and over 100 pieces of
equipment: four gun families whose damage types counter shield types, rocket pods, seekers and
torpedoes, three shield types, engines, thrusters, power plants, armour, cargo pods, scanners and
tractor beams, sold by a shipyard (trade-in at 70%) and an outfitter by slot. Every ship has its
own procedural 3D model. Raider packs, patrols, bounties and bounty contracts, and the combat depth
of increment 6.

### More real stars ✅

32 systems within about 17 light-years, with 44 stars and 37 confirmed planets from the HYG
database and the Open Exoplanet Catalogue, generated fictional stations and jump lanes. Still
provisional: the archive snapshot (see the parallel track above and [KNOWN_GAPS.md](KNOWN_GAPS.md)).

### Story and polish

The opening chain and three faction arcs (increment 5); the rest is in the polish track.

## Text generation

The rules always decide facts (who, where, how much); only wording varies. Default: templates with
phrase pools, offline. Optional: AI-written text packs generated at build time (reviewed, no API key
in the game). Live AI while playing would need a small server and is deferred.
