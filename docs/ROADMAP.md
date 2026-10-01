# Roadmap

From prototype to a full game. Each step ships to the live site (<https://shotif.github.io/starman-reborn/>)
when it is done, so the game stays playable throughout. Status: ✅ done · 🔨 in progress · ⏳ proposed.

## Where the game stands

After the scripted opening (10–20 minutes), the neighbourhood is an open sandbox: 207 real
systems out to 27 light-years, checked against the astronomical archives; 322 generated stations
of twelve kinds; 23 goods with stock-based prices; traders and patrols on the lanes and raider
packs in lawless space; 39 ships and 139 pieces of equipment; and generated contracts on every job
board. Increments 1–19 (under [Done so far](#done-so-far)) added world events and news, contracts
of every kind, the law and the outlaw path, goals, five story arcs, combat depth, people in the
bars and a trade computer, a world that answers, a fleet of your own whose captains fly the lanes,
mining in the real belts, the frontier with a life of its own, a border war whose fronts can be won
for good, story endings that change stations for good, escorts and convoys across jumps, haulers
with real cargo on a timetable, and a game measured and tuned on a real phone.

What it lacks now:

- **More real phones.** The automated tests run in a desktop browser with emulated phones and
  touch. One real phone, a recent high-end Android, has passed the whole checklist (99 fps on High,
  Play 1.1 s after opening the site over 4G); an iPhone and a mid-range phone have not been tried.

## Proposed next increments

Candidates for what comes next, in the order I would build them:

### Gluts that ship out ⏳ (S)

A glut sends its surplus out in haulers, as a shortage draws relief, and boards post escorts for
relief bound through raided lanes.

### How an increment ships

Rules go in data files with guardrails ([PROCGEN.md](PROCGEN.md)). Each increment adds unit tests
for its rules, a browser test for the player's path, and layout screenshots at every test size
when screens change. Then the docs are updated (PROCGEN, TEST_RECORD, KNOWN_GAPS), and it deploys
to the live site once CI passes.

## Done so far

### 19. Your captains on the lanes ✅

The runs of your own captains now fly the lanes like the stations' haulers. Each run goes through
its route's systems leg by leg, so the Fleet window says where each captain is now, and in that
system you meet your ship in flight: named as yours, with its captain and cargo, marked green on
the HUD and in the target cycle. Raiders who strike a run do it at one place and time, in the
riskiest system on its way out; if you are there, the raid is flown. Beat the ambush off, or see
the captain to its dock or the jump beacon, and the run gets through with its cargo; if the ship is
destroyed in front of you, it is lost there and then, half its cargo spilling where you can scoop
it up, and insurance pays (not for your own guns). Leave mid-fight and the raid takes its course.
The fleet now keeps up in flight too, so its news comes as it happens, and a run from the core
into the frontier, which used to take for ever, gets in
([PROCGEN.md §18.6](PROCGEN.md#186-your-captains-on-the-lanes)).

### 18. Traders you can see ✅

The stations' freight now flies the lanes as named haulers with real cargo, on a timetable every
device shares. A shortage draws relief from the stations that make what it lacks: the News says
who is on the way and when they are due, each arrival fills the station's stock, and all of it
arriving ends the shortage, so a pilot who gets there first sells at the shortage's prices. Raids
take haulers in their lanes, and the station they were bound for goes without. In flight, the
haulers about you are the timetable's, named with their cargo and where it is going; destroy one
and half its cargo spills (and its shortage runs on), or stand by one under attack and its owners
send thanks ([PROCGEN.md §21](PROCGEN.md#21-haulers-on-the-lanes)).

### 17. The faction arcs leave their marks ✅

However the three faction arcs end, each now changes a station for good, as First Harvest and the
settled border fronts do: eight endings, eight marks. Clean Manifests opens Deimos Depot's
manifests to the Cooperative if the evidence went to the press, cleans up Halcyon Ring's supply
lines if it stayed inside the Authority, and leaves Deimos Depot's back door open if it was sold
back. The Stonecrop Blight makes Dawnfield Institute the home of the blight cure if the Gardens
were sealed, or gives Stonecrop Gardens new bays if they were burnt and reseeded. Salt's Crew
brings the crews' salvage to Pinball Freeport if Salt was told everything, gives Juno Fiske a yard
at Sandbar Bazaar if Juno was warned, and dries Pinball Freeport's trade up if the Nest was sold.
Each moves a market, and most post a standing run on the board
([PROCGEN.md §14.7](PROCGEN.md#147-lasting-marks)).

### 16. Border wars that end ✅

The four border fronts no story settles can now be won. Once the player's war work on a front adds
up (two or three contracts close together), that side offers a decisive operation: for the
Frontier Cooperative, knock out the den across the line with a wing of its own; for the Hollow
Wake, hold the den against the Cooperative's last sweep. Done, the front is settled for good: the
law holds it, or the Wake holds the lanes and the station that can fall. Settled fronts, The Long
Border's included, leave lasting marks: the stations around a front the law holds ship more and
post a run of it; where the Wake holds it, the lawful stations go short and the den does well
([PROCGEN.md §20.7](PROCGEN.md#207-fronts-that-end)).

### 13. Phones, measured and tuned ✅

- ✅ **A first load that shows the title at once.** A 15 KB first screen draws the title with a bar
  where Play will be, and the game (three.js, the world, the sky and the game code, 609 KB in all)
  loads behind it; a failed download offers to try again. On simulated slow 4G the title shows at
  0.45 s instead of 4.8 s. The sky turned out to be only 68 KB of the game, so the game loads as a
  whole behind the title rather than the data alone; the star map's code already loaded on first
  open. A first-load budget runs after every build ([PROCGEN.md §4.6](PROCGEN.md#46-performance)).
- ✅ **Offline after one visit**, and **WebGL context loss**, both forced in browser tests.
- ✅ **A device report** in Settings: the phone, browser, screen, safe areas and graphics chip,
  the load times, the last flight's frame rate and whether the game is kept for offline play, as
  text to copy with one tap, so the checklist below takes minutes to report.
- ✅ **The real-device checklist on an Android phone** (a recent high-end one): all fine, 99 fps on
  High, and a first load over 4G with the title at 0.5 s and Play at 1.1 s. Tuned from it: offline
  play retries a failed download (it had kept 13 of 15 files), and Auto quality starts at Medium
  instead of Low on every phone, stepping down only where frames stay slow; half-rate docked and
  menu screens no longer lower the resolution on 60 Hz screens.
- Not done: the checklist on an iPhone or iPad and on a mid-range phone (no such device to hand;
  see [KNOWN_GAPS.md](KNOWN_GAPS.md)).

### First Harvest leaves its mark ✅

How First Harvest ends now changes Harrow Farmstead for good. Sold at Doppler Freeport, the
harvest pays for new fields: food is plentiful at Harrow, and its board posts a harvest run of
fine food to Doppler in every time slot. Given to Squall Relay's crews, Harrow keeps a share for
the edge: medicine is plentiful there, and its board sends the relay's share, paid better. The
news within two jumps says so. Lasting marks are data with guardrails, so later stories can leave
their own ([PROCGEN.md §14.7](PROCGEN.md#147-lasting-marks)).

### A smarter hint, and station art rough edges ✅

The what-next hint now also says when the ship needs a mechanic first, when a better ship is
affordable at a shipyard already visited, when the long-range jump drive is worth buying for the
frontier, and when a few more points of standing would open a faction's best work
([PROCGEN.md §13.4](PROCGEN.md#134-what-next)). In generated stations, the half-built hull outside
a shipyard's bay is floodlit and reads as round, goods on factory conveyors no longer glint white
in the starlight through the bay, and mining-hall rock walls hold some light away from the lamps.

### 14. The frontier's own stories ✅

The frontier has a life of its own: harvests come in at its farms (food floods, haulers wanted),
its research posts hold survey seasons, and its colony haulers lose their drives far from any dock,
to be rescued with ship components handed over alongside. First Harvest, a five-step arc from
Squall Relay at the core's edge out to Harrow Farmstead at HD 219134, ends with a harvest convoy
across a jump. Every other event in the world is exactly as it was. The roadmap's idea of a survey
that settles a contested planet in the fiction was dropped: readings settle nothing the archives
do not, and the game says so ([PROCGEN.md §11](PROCGEN.md#11-world-events),
[§14.6](PROCGEN.md#146-first-harvest)).

### 15. Convoys across jumps ✅

Escorts now go up to two jumps: the hauler, or a convoy of three of which two must arrive, keeps
with the player and jumps with them when within 2.5 km (the star map says why it waits
otherwise), and raiders wait at the beacon where there is something to fear. The Long Border's
truce ends with the envoys crossing the Ross 154 – Wolf 1061 line to Flotsam Diggings
([PROCGEN.md §10.2](PROCGEN.md#102-kinds), [§20.5](PROCGEN.md#205-the-long-border)).

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
