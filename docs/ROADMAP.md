# Roadmap

From prototype to a full game. Each step ships to the live site (<https://shotif.github.io/starman-reborn/>)
when it is done, so the game stays playable throughout. Status: ✅ done · 🔨 in progress · ⏳ proposed.

## Where the game stands

After the scripted opening (10–20 minutes), the neighbourhood is an open sandbox: 32 real
systems, 58 generated stations of twelve kinds, 23 goods with stock-based prices (two of them
contraband), traders and patrols on the lanes, raider packs in lawless space, 35 ships with over
100 pieces of equipment, and generated contracts on every job board. Increments 1–6 (under
[Done so far](#done-so-far)) added world events and news, escorts, deadlines, aces, chains and
recoveries, the law and the outlaw path, ratings, a codex and milestones, three faction story
arcs, and combat depth.

What it lacks now:

- **Planning.** Trading is the core loop, but the player plans from memory, and the bars are
  rooms without people in them.
- **Something to build.** After the biggest ship there is nothing left to own, and no reason to
  open the game for a short session.
- **A world that answers.** Events, stock and traffic run on the clock; what the player does
  barely moves them, and nothing persists after a jump.
- **A third career.** Trading and fighting (and scanning), but no mining, although the Solar
  System's asteroid belt is real and not in the game yet.
- **An ending.** The three arcs end separately and leave one mark on the world, a dark den.
- **A verified sky.** Every real value still shows *Pending verification*.

The proposals below go after these, numbered in the order I would build them. Sizes are relative:
S, M, L.

## Proposed next increments

### First, alongside: the real sky, verified ⏳ (S–M)

The snapshot script covers only the seven stars (and their seven planets) of the five hand-made
systems; the other 37 stars and 30 planets come from HYG and the Open Exoplanet Catalogue. The
container I work in cannot reach the archives, but GitHub's runners can, and I can drive them
from here without any change to the environment:

- **Cover the whole sky in the game**: extend `scripts/fetch-astro-snapshot.ts` to all 44 stars
  (SIMBAD by HIP or Gliese number; the Gaia DR3 id from SIMBAD's cross-identifiers; Gaia DR3
  astrometry where it passes the quality cuts, otherwise SIMBAD's adopted values with their
  bibcodes; Hipparcos as a cross-check) and to every confirmed planet of their hosts in the NASA
  Exoplanet Archive.
- **A verification report**: star by star, how far the archive values move each star from what
  the game shows (distance and position); planets the archive adds, drops or marks controversial;
  and the stations, codex entries and saves that touches. Nothing is merged without reading it.
- **A workflow on GitHub's runners** (`.github/workflows/sky-snapshot.yml`): `npm ci`, then
  `data:snapshot`, `data:build`, `data:validate` and the unit tests. The report goes into the
  run's log, and the dated snapshot, the raw archive responses and the report are committed to a
  `sky-snapshot` branch with the run's own token. It starts when the workflow or the snapshot
  script is pushed to the development branch; once it is on `main`, it can be re-run on demand
  and runs monthly, committing only when the archives changed.
- **Review and merge from here**: I follow the run and read its log through the GitHub
  connection, fetch the branch with git (both work from this container), read the report, run
  every check locally and merge. The badges disappear, and distances get their error bars.
- **The Solar System on the real date**: the same run fetches JPL's Keplerian elements for
  1800–2050 ([Approximate Positions of the Planets](https://ssd.jpl.nasa.gov/planets/approx_pos.html))
  and a few Horizons positions to test against. Sol's planets then sit at their real heliocentric
  longitudes for the game date (distances stay compressed), and a unit test holds them to Horizons
  within JPL's stated accuracy.
- **Nothing needed from you.** The runner has open internet, and pushing a branch needs only the
  permission the workflow file asks for. (A workflow that opens a pull request would need a
  repository setting, so it pushes a branch instead.)
- **Risks**: an archive may refuse or rate-limit a runner (the run fails, commits nothing, and its
  log says why); a planet the NASA archive does not confirm would take away the station built on
  it (the report names it first, and a save migration keeps older saves loading).

### 7. Trade computer, rumours and people in the bars ⏳ (M)

Cheap, and it improves every session: trading gets a planning tool, and the bars get people.

- **Trade computer** (a journal page, and Plan at the trader): the best routes from prices you
  have seen, with the age of each price, profit per minute for your hold after jump fees and
  transit time, and the news that will move them. It knows only what you know.
- **Price watch**: mark a good at a station; docking within two jumps tells you if it moved.
- **Rumours** for the price of a drink: true facts from the game's state (a shortage before it
  reaches the news, where an ace was last seen, a den's defences, a wreck worth recovering),
  never invented.
- **People in the bars**: the story characters sit in their bars, and a small cast of generated
  regulars (traders, pilots, a fixer) offer rumours, contracts and wingmen face to face, with
  procedural portraits.
- **Guardrails**: rumours are drawn from the model only, routes only from seen prices, and a
  rumour never costs more than it is worth.

### 8. A world that answers ⏳ (M)

- **Events react**: a shortage you help fill ends sooner and pays whoever filled it; destroying
  raiders shortens a raid.
- **Goods move everywhere**: traffic moves stock along the lanes out of sight too, so a glut
  drains into its neighbours and a route you work hard flattens.
- **Encounters persist**: a pack you fled is still there for a while; a wreck keeps its cargo.
- **Witnesses**: a crime is known where it was seen and travels with the traffic; fines lapse.
- **Guardrails**: still a function of the seed and the clock, plus a short log of what the player
  did; prices stay in their bands; the tutorial is left alone.

### 9. A fleet of your own ⏳ (L)

A long-term goal, and a reason to open the game for five minutes.

- **More than one ship**: park ships at stations and switch where one is parked.
- **Haulers on your routes**: give a parked ship a hired captain and a route you have flown; it
  runs out of sight as a function of the clock (trips, profit, losses to raiders by the route's
  security) and reports when you dock.
- **Storage and stakes**: rent a hold at a station; later, buy a share of a station's trade.
- **Guardrails**: a hauler earns well below flying yourself; losses are bounded and can be
  insured; nothing runs in the background (it is worked out from the clock on load, the same on
  every device).

### 10. Mining in the real belts ⏳ (M)

A third career, for pilots who would rather not fight.

- **Real belts only**: the Solar System's main belt and Kuiper belt (missing today), Epsilon
  Eridani's two belts, and other catalogued debris discs, each with its source.
- Mining lasers and prospecting scanners at the outfitters; ore, ice and volatiles for the
  refineries; claim contracts; raiders who hunt miners.
- **Guardrails**: mined goods stay in their price bands, and no belt without a citation.

### 11. The frontier, out to 25 light-years ⏳ (L)

The map stops at about 17 light-years; the next shell holds some of the best-known planetary
systems (Gliese 581 and HD 219134 among them, if the archive query agrees).

- New systems straight from the verified pipeline (Gaia DR3, SIMBAD, the NASA Exoplanet
  Archive), not from HYG.
- A long-range jump drive to reach them; a thin, lawless frontier with independent colonies;
  survey contracts for the codex.
- **Guardrails**: the same world generator and checks; the 32 systems and existing saves stay as
  they are.

### 12. The arcs converge ⏳ (L)

- **A contested border**: the Transit Authority and the Hollow Wake contest systems through the
  world tick (blockades, skirmishes, a station changing hands), and the player's work tips it.
- **A fourth arc** that reads the choices made in the other three, with different endings, and
  war contracts on both sides.
- **Guardrails**: a dock with repairs is always reachable, no dead ends, and the finale can be
  reached as a lawful pilot, an outlaw or neither.

### Parallel track: polish and reach ⏳ (M)

- **Save slots with export and import**, early: browser storage can be cleared, and there are no
  cloud saves.
- Gamepad support.
- The real-device checklist in [TEST_RECORD.md](TEST_RECORD.md) on an Android phone and an iPhone
  (this one needs you), then performance tuning from what it finds.
- More music, station ambience, and chatter from traffic.

### Quick wins (S each)

- Sort and filter the job board (reward, reward per jump, kind).
- A sound and a comm line when a contract pays.
- Remember the last open window at each station.
- Orders for wingmen: attack my target, form up.

### How an increment ships

Rules go in data files with guardrails ([PROCGEN.md](PROCGEN.md)). Each increment adds unit tests
for its rules, a browser test for the player's path, and layout screenshots at every test size
when screens change. Then the docs are updated (PROCGEN, TEST_RECORD, KNOWN_GAPS), and it deploys
to the live site once CI passes.

## Done so far

### 1. A world that moves: events, news and restocking ✅

World events computed from the seed and the clock (shortages, gluts, strikes, raids, booms and
sweeps) move prices and traffic; traders restock markets; the News room reports events within two
jumps and the star map marks them; boards near an event post matching work at a premium
([PROCGEN.md §11](PROCGEN.md#11-world-events)). Sol's stations and the opening goods are never
touched, and each jump adds two minutes of lane transit to the clock.

### 2. Contracts II: escorts, deadlines, named targets and chains ✅

Escorts between two stations of one system (the hauler holds position if you fall behind), urgent
jobs with deadlines and a bonus, aces who drop credits and a cargo pod, chains of follow-up
parcels and hauls, and wreck recoveries with the tractor beam
([PROCGEN.md §10](PROCGEN.md#10-contracts)). Every active contract is marked on the star map.

### 3. Law and consequences: customs, contraband and the outlaw path ✅

While you owe fines or are Hostile, a faction's patrols attack and its stations give emergency
docking only (repairs at a surcharge and the customs desk); a pardon costs the fines (and more for
Hostile standing), and big fines bring bounty hunters. Two contraband goods, patrol scans and
customs at depots and military bases, piracy (haulers spill cargo pods), smuggling runs at free
ports and dens, piracy jobs at dens, and raider dens with a black market for pilots the Wake
trusts. A Wary faction offers easy work only
([PROCGEN.md §12](PROCGEN.md#12-the-law-and-the-outlaw-path)).

### 4. Goals: ratings, a codex of the real sky, milestones, a hint of what to do next ✅

Three pilot ratings (ace hunts and den assaults need a Hardened combat rating), a codex of 91 real
bodies with survey sales to research stations and a grant for the whole sky, twenty milestones,
and a hint that puts fines first, then the hold, stories waiting, the codex, a known route and a
job board nearby ([PROCGEN.md §13](PROCGEN.md#13-goals)).

### 5. Faction story arcs ✅

Clean Manifests (a customs scandal, ending in an assault on a raider den with a Transit Authority
wing), The Stonecrop Blight (a colony's crops failing at Procyon, ending in a convoy defence) and
Salt's Crew (for pilots the Wake trusts, ending in holding a den against an Authority sweep); five
missions each, with dialogue at the docks, comms in flight and a choice each, two of which can end
their arc early ([PROCGEN.md §14](PROCGEN.md#14-story-arcs)).

### 6. Combat depth ✅

Seekers fired by heavy raiders, aces and hunters, and decoy flares against them; mines dropped by
raiders breaking off and guarding dens; damage to the engines, guns and shield generator; cargo
pods and equipment crates kept in a stash; wingmen for hire, paid per jump; every den defends
itself and can be knocked out (paid by the law, reported in the news, dark for six hours), with
den assault contracts on lawful boards; hit flashes and radio chatter
([PROCGEN.md §15](PROCGEN.md#15-combat-depth)).

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
provisional: the archive snapshot (see the real sky, verified, at the top of the proposals, and
[KNOWN_GAPS.md](KNOWN_GAPS.md)).

### Story and polish

The opening chain and three faction arcs (increment 5); the rest is in the polish track.

## Text generation

The rules always decide facts (who, where, how much); only wording varies. Default: templates with
phrase pools, offline. Optional: AI-written text packs generated at build time (reviewed, no API key
in the game). Live AI while playing would need a small server and is deferred.
