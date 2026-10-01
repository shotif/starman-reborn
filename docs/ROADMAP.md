# Roadmap

From prototype to a full game. Each step ships to the live site (<https://shotif.github.io/starman-reborn/>)
when it is done, so the game stays playable throughout. Status: ✅ done · 🔨 in progress · ⏳ proposed.

## Where the game stands

After the scripted opening (10–20 minutes), the neighbourhood is an open sandbox: 207 real
systems out to 27 light-years, checked against the astronomical archives; 322 generated stations
of twelve kinds; 23 goods with stock-based prices; traders and patrols on the lanes and raider
packs in lawless space; 39 ships and 139 pieces of equipment; and generated contracts on every job
board. Increments 1–12 (under [Done so far](#done-so-far)) added world events and news, contracts
of every kind, the law and the outlaw path, goals, four story arcs, combat depth, people in the
bars and a trade computer, a world that answers, a fleet of your own, mining in the real belts,
the frontier and a border war.

What it lacks now:

- **Real phones.** Every test runs in a desktop browser with emulated phones and touch. The title
  now shows at once and the game loads behind it, measured on a simulated slow phone network; on a
  real phone, only the star map's pinch zoom has been tried (it works).
- **A frontier with a life of its own.** The 141 systems beyond 17.5 light-years are settled by the
  same rules as the core (thin colonies, dens, survey work), with no story or events of their own.
- **Company across jumps.** Escorts and convoys stay within one system; only wingmen follow you
  through a lane.

## Proposed next increments

Everything proposed before is done (see below). Candidates for what comes next, in the order I
would build them:

### 13. Phones, measured and tuned 🔨 (M)

- ✅ **A first load that shows the title at once.** A 15 KB first screen draws the title with a bar
  where Play will be, and the game (three.js, the world, the sky and the game code, 609 KB in all)
  loads behind it; a failed download offers to try again. On simulated slow 4G the title shows at
  0.45 s instead of 4.8 s. The sky turned out to be only 68 KB of the game, so the game loads as a
  whole behind the title rather than the data alone; the star map's code already loaded on first
  open. A first-load budget runs after every build ([PROCGEN.md §4.6](PROCGEN.md#46-performance)).
- ✅ **Offline after one visit**, and **WebGL context loss**, both forced in browser tests.
- ⏳ The real-device checklist in [TEST_RECORD.md](TEST_RECORD.md) on an Android phone and an
  iPhone (this needs you; pinch zoom is confirmed on Android), then tuning from what it finds.

### 14. The frontier's own stories ⏳ (M)

- A short arc among the frontier colonies, and events of their own (a first harvest, a drive
  failure far from any dock, a survey that settles a contested planet in the game's fiction without
  changing what the archives say).
- **Guardrails**: nothing invented about real planets; contested ones stay marked as contested.

### 15. Convoys across jumps ⏳ (M)

- Escorts and convoys that follow you through the lanes, with ambushes at the beacons, and a
  convoy finale for The Long Border's truce that crosses the line.

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

### The real sky, verified ✅

A workflow on GitHub's runners (`.github/workflows/sky-snapshot.yml`) asks SIMBAD, Gaia DR3,
Hipparcos, the NASA Exoplanet Archive and the Extrasolar Planets Encyclopaedia about every star
within about 27 light-years, and commits their answers to a `sky-snapshot` branch;
`scripts/sky-process.ts` turns them into the game's data, with a report. On 30 September 2026:
252 stars in 207 systems, 99 planets (77 confirmed, and 22 contested, kept in this edition and
marked so) and 9 debris belts with their papers. The *Pending verification* badges are gone, and
the Solar System's planets sit where they are on the game date (JPL's elements, held to JPL
Horizons in the unit tests) ([ASTRONOMY_SOURCES.md](ASTRONOMY_SOURCES.md)).

### 7. Trade computer, rumours and people in the bars ✅

A trade computer at every dock (and its best routes in the trader) ranks routes from the prices
you have seen, with each price's age and the profit per minute for your hold after fees and
transit time; a price watch tells you when a watched good moves as you dock nearby; the bars have
people (regulars by station type, the story characters, pilots for hire) with procedural
portraits, and a round of drinks buys a rumour that is always true: a price, an event before the
news, a den's guns, an ace, a wreck, a story or a border front
([PROCGEN.md §16](PROCGEN.md#16-people-and-information)).

### 8. A world that answers ✅

A shortage you help fill ends sooner and pays a relief bonus; raiders destroyed during a raid break
it; goods spill along the lanes out of sight, so gluts drain and hard-worked routes flatten; packs
that saw you and cargo pods left adrift are still there if you come back within half an hour; a
crime is known where it was seen and spreads a jump every ten minutes, and fines lapse after three
hours without a new one ([PROCGEN.md §17](PROCGEN.md#17-a-world-that-answers)).

### 9. A fleet of your own ✅

Keep up to four ships parked at stations and switch between them; hire captains to haul routes you
know, worked out from the game clock for well under what flying them earns, with raids and
insurance; lease a hold at a station, and buy up to 10% of a station's trade for an hourly
dividend ([PROCGEN.md §18](PROCGEN.md#18-a-fleet-of-your-own)).

### 10. Mining in the real belts ✅

Rocks in the belts the papers describe (the Solar System's main and Kuiper belts, Epsilon
Eridani's belts and the other catalogued debris discs, each with its source), mining lasers and
prospecting scanners at the outfitters, ore, ice and volatiles for the refineries, mining claims
on the boards, and raiders who hunt miners ([PROCGEN.md §19](PROCGEN.md#19-mining)).

### 11. The frontier, out to 27 light-years ✅

175 new systems straight from the verified sky, 141 of them beyond 17.5 light-years: the frontier,
reached through lanes that need a long-range jump drive (sold where a pilot without one can reach
it). Thin, lawless space with independent colonies and dens, survey work for the codex paid half
as much again, and two milestones. The core world and every save are locked: a fingerprint test
holds the 32 original systems exactly as they were
([PROCGEN.md §7.7](PROCGEN.md#77-growth-and-the-frontier)).

### 12. The arcs converge ✅

Five border fronts where lawful space meets a raider den swing between the law pushing the Wake
back, skirmishes, blockades and a station falling to the Wake, with a 48-hour tide and the
player's deeds; war contracts on both sides; and The Long Border, a fourth arc that reads the
choices of the other three, branches three ways (for the Authority, for the Wake, or a truce) and
settles the Ross 154 – Wolf 1061 line for good. A dock with repairs is always within reach, and
the finale can be reached as a lawful pilot, an outlaw or neither
([PROCGEN.md §20](PROCGEN.md#20-the-border-war)).

### Polish and reach ✅

Three save slots besides the autosave, with export to a file and import on any device; gamepad
controls; music that follows where you are (the title, the map, the docks and bars, the five
hand-made systems, deep space, lawless space and the dens), station ambience, and the local radio
of the traffic around you. Still to do: the
real-device checklist, which needs you (increment 13).

### Finding your way on the star map ✅

The map was hard to use on a phone. **Find** searches every system by its name or any star,
planet, station, belt or catalogue name in it (accents and a typo or two forgiven); **Missions**
lists the systems your active missions send you to, each with its next step and how many jumps
away it is. Choosing either brings the system to the middle with its neighbours around it. A pinch
or the wheel zooms toward the fingers or the cursor, a double tap zooms in on the spot, the 2D view
zooms and pans too, and a short hint shows the gestures the first few times on a touch screen.

### Quick wins ✅

Sort and filter the job board, a sound and a comm line when a contract pays, the last open window
remembered at each station, and orders for wingmen (attack my target, form up).

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

32 systems within about 17 light-years from the HYG database and the Open Exoplanet Catalogue,
with generated fictional stations and jump lanes; since verified against the archives and grown to
207 systems (the real sky, verified, and increment 11).

### Story and polish ✅

The opening chain, three faction arcs (increment 5) and The Long Border (increment 12); the polish
track is done except the real-device checklist.

## Text generation

The rules always decide facts (who, where, how much); only wording varies. Default: templates with
phrase pools, offline. Optional: AI-written text packs generated at build time (reviewed, no API key
in the game). Live AI while playing would need a small server and is deferred.
