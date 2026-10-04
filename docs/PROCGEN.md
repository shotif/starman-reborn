# Content generation: guidelines and guardrails

Starman Reborn generates most of its content from **rules** instead of scripting every item,
station or job by hand. This document is the contract for that system: what the rules look like,
how generators use them, and the guardrails every generated thing must pass before a player sees
it. The first application is the ship and equipment catalogue (`src/content/`); stations, points
of interest, jobs, people and news follow the same pattern.

## 1. Principles (non-negotiable)

1. **Rules decide facts; wording is separate.** Stats, prices, rewards, places and targets come from
   rules and seeded randomness. Names and flavour text come from naming grammars and phrase pools
   (optionally AI-written text packs, generated at build time and reviewed). Text never changes a
   fact, and any number in generated text is printed from the data it describes.
2. **Real astronomy is never generated.** Stars, planets and their numbers come only from the
   catalogue snapshot (`src/data/`). Generated fiction (stations, companies, wrecks, jobs) may be
   *attached* to catalogued bodies, never invent one. Everything generated is labelled fiction in
   the game.
3. **Deterministic.** Same rules + same seed = same content, on every device. Nothing depends on
   `Math.random()`, the clock or iteration order of unordered collections.
4. **Stable ids.** Ids derive from rule keys (`gear.pulse.3.halden`, `ship.courier.1.halden`), not
   from random numbers, so saves stay valid when rules are tuned. Saves store ids, never names or
   stats. Removing or renaming a key needs a save migration.
5. **Validated before use.** Every generator's output passes the guardrails in this document. The
   unit tests run them over the whole catalogue; a rule change that breaks one fails CI with a
   readable list of issues.
6. **Original.** Names, companies, ships and text are invented for this game. No names, data or
   text from other games, and no real-world trademarks.
7. **Human-editable.** Rules are small typed data files with comments. Tuning the game means
   editing numbers in rule files, not generator code.

## 2. Layers

```
rules      src/content/rules/*.ts     makers, ship classes, equipment families, shops, balance knobs
   ↓
generators src/content/gen/*.ts       pure functions of (rules, seed)
   ↓
content    the catalogue, the world, markets, traffic, contracts (later: people, news)
   ↓
guardrails src/content/validate.ts    §4; tests/unit/content.test.ts runs them
   ↓
runtime    src/content/catalog.ts     lookups, what a station sells, standing gates, resale
           src/content/loadout.ts     what a ship does with its fittings (flight and combat stats)
```

`src/content/score.ts` holds the power-score formulas shared by generators, guardrails and the UI.

## 3. Determinism, seeds and ids

- One helper, `rng(seed, ...keys)` (`src/content/random.ts`), derives an independent stream per
  purpose, e.g. `rng(seed, "ship-names", "halden")`. Adding a new stream never changes another.
- The **ship and equipment catalogue** uses a fixed content seed (`CATALOG_SEED`), so every player
  sees the same catalogue and it can be discussed and balanced. Its stats have no random jitter:
  they follow from the rules alone. The seed only decides which name from a maker's pool each model
  gets, so names can move when a maker's line-up changes; ids and stats cannot.
- **World content** (stations, jobs, people) will use a per-save world seed stored in the save, plus
  a log of changes.
- Numbers are rounded to steps that read like designed values: damage to 0.5 under 20, speeds and
  ranges to 10 m/s and 10 m, fire rates to 0.05/s, prices to 1, 5, 50 or 100 cr by size.

## 4. Guardrails

### 4.1 Balance budgets (catalogue)

Every item gets a **power score** from its stats, and every class (equipment) or tier (ships) has
a target. The generator applies the family's per-class drift and the maker's tendencies to an
item's secondary stats, then **solves the primary stat** so the item lands on its target. A maker
that likes fast-firing guns therefore gets smaller shots, not more damage.

| Thing | Score (`src/content/score.ts`) | Primary stat solved | Guardrail |
| --- | --- | --- | --- |
| Gun | damage × rate × type effectiveness × (bolt speed/800)^0.35 × (range/1000)^0.25 × (14/energy per s)^0.25 | damage per shot | ±10% of the class target; all gun families share the pulse cannon's curve |
| Shield | capacity ÷ type exposure × (10 × regen/capacity)^0.3 × (3/delay)^0.2 | capacity (regen keeps its ratio) | ±10%; all shields share the balanced shield's curve |
| Launcher | damage × (1 + 0.1 × turn rate) × (speed/300)^0.3 | damage | ±10% of its own family's curve |
| Engine | (cruise/620) × thrust^0.5 × (1.8/spin-up)^0.25 | thrust (acceleration) | ±10% |
| Thruster | (boost/95) × (28/drain)^0.5 | boost speed | ±10% |
| Power plant | (store/100)^0.4 × (regen/20)^0.6 | both, together | ±10% |
| Utility | amount ÷ class 1 amount | amount | ±10% |
| Ship frame | geometric mean of hull^0.4, turn^0.25, speed^0.2, cargo^0.1, capacitor^0.05 against the class's Mk I | hull | ±12% of the tier target |

Other balance guardrails:
- **Classes step up.** Inside a maker's line, each class beats the one below by the family's
  minimum step (18% for guns and shields, 5–15% for the rest), and costs more.
- **Prices.** Equipment costs base × growth^(class − 1) × maker price trait; same-class items of a
  family stay within ±25% of the median. Ship hulls cost the class base × 2.2^(tier − 1) × maker
  price trait; the shipyard price adds the stock fittings.
- **Damage types have counters.** Per class, no main damage type's average gun score is more than
  10% above another's. Every typed shield resists one type and is weak to another; balanced shields
  have neither. The matrix lives in `rules/balance.ts`:

  | vs | deflector | diffuser | balanced | hull |
  | --- | --- | --- | --- | --- |
  | energy (pulse) | 1.3 | 0.7 | 1 | 0.9 |
  | kinetic (mass driver) | 0.7 | 1 | 1 | 1.2 |
  | plasma | 0.9 | 1.3 | 1 | 1 |
  | ion | 1.6 | 1.6 | 1.5 | 0.25 |

- **Time to kill.** Two stock ships of the same class and tier (any makers) at a 30% hit rate need
  4.5–45 s to kill each other with guns (mirror matches sit around 10–15 s; hard counters are
  quicker). A ship two tiers up kills at least twice as fast as it dies.
- **Flight envelope.** Top speed 80–135 m/s, turn rate 0.9–2 rad/s, turn response 3.5–8, boost
  ≤ 140 m/s, cruise ≤ 800 m/s, radius ≤ 13 m, so autopilot, docking and collisions keep working.
- **Trade-offs are real.** Freighters out-carry every other class; fighters out-fight every
  freighter within 20% of their price; armour costs agility; cargo pods cost speed; maker traits
  must stay within 0.8–1.25.
- **Fittings fit.** A stock loadout only uses the ship's own slots within their class limits, and
  every ship leaves the yard with guns, a shield, an engine, a thruster and a power plant.

### 4.2 Economy guardrails

- Commodity prices stay inside per-commodity bands; no station pair gives a buy-low/sell-high loop
  on the same dock (§8.4 lists the economy guardrails).
- Dealers pay back 70% of the price for ships and equipment, so buying and selling never makes
  money.
- Job rewards scale with distance, danger and time within bands; a job's reward is never below its
  fees and expected repairs (§10.4 lists the contract guardrails).

### 4.3 Availability and progression

- Every ship and item of a maker with a home station is sold somewhere a player can reach. Raider
  equipment (Wake Salvage) is flown by raiders, not sold.
- A maker's home station sells its whole range.
- A class 1 item for every slot type is sold in Sol without standing requirements, so every ship
  can be fitted from the start.
- Higher classes and tiers need standing with the station's faction: equipment class 4 needs
  friendly (10), class 5 needs 25; Mk III ships need friendly.
- Nothing required by a job is only sold behind that job.

### 4.4 Names and text

- Unique within their kind; words never repeat a station, system or faction name (makers named
  after their home are the exception).
- Built from the maker's grammar (Halden names ships after seabirds, Ares after forge tools and
  fortifications), so a name tells you who built it.
- Plain, readable English; no slurs or real people; checked against a small denylist.
- Numbers in descriptions must be the item's own stats (the guardrail checks every number). Ship
  descriptions quote no numbers; the UI shows the stats.

### 4.5 World content

- Stations and points of interest attach only to catalogued bodies, with placement rules per type
  (mining at small confirmed planets; research near notable bodies; pirate dens only where lawful
  influence is low). The world generator and its guardrails are described in §7.
- Every generated job is reachable, completable with a ship the player can buy by then, and pays
  within band; jobs never target the player's own faction without warning (contracts: §10).
- News and rumours only report facts that exist in the world state.

### 4.6 Performance

- The whole catalogue builds in under 20 ms (the test measures it; it takes a few milliseconds);
  world generation per system under 50 ms, and only for systems being entered.
- **The first load.** The page first loads only the loading title (`src/app/loader.ts`): the
  title's frame, its styles and fonts, and a bar where Play will be. It must not import three.js,
  the world, the sky or the game code; it fetches those itself from the list the build writes into
  the page (`scripts/bootFiles.ts`), counting their bytes for the bar, and the game's own imports
  then find them in the browser's cache. The system count on the loading title is worked out at
  build time, and a unit test holds it to the game's.
- **Budgets**, in gzipped kilobytes, checked after every build by `npm run size`
  (`scripts/load-budget.ts`, in `npm run check` and CI): the first screen at most **32 KB** (16 KB
  on 1 October 2026) and the whole first load, first screen and game, at most **800 KB** (621 KB on
  1 October; the owner raised it from 700 KB on 2 October 2026, when Your crew took it to 704 KB).
  Fonts (71 KB, already compressed) and what loads on demand (the star map, the science notes,
  bloom: 35 KB) are reported, not budgeted. Going over is a decision to make, not an accident: raise
  the budget in the same change, with the reason.
- **On a real device**, the device report (Settings; `src/app/deviceReport.ts`) shows what the
  phone or computer and its browser tell the game: the screen and safe areas, the input, the
  graphics chip, the quality in use, the load times (the loading title and the title leave marks in
  the browser's performance timeline), the last flight's average frame rate and slowest second,
  the network, and whether the game is kept for offline play, naming any file not kept yet. When
  the service worker hands the page its files, the browser reports their sizes as nothing, so the
  report says the size is not known rather than guess. It is only shown, never sent: the tester
  copies it.
- **Offline play** (`public/sw.js`): once the game is up, the page gives the service worker the
  list of every build file to keep; a download that fails is tried twice more (after 2 and 6
  seconds), and anything still missing is tried again on the next visit.

## 5. Testing

- **Unit tests** (`tests/unit/content.test.ts`) build the catalogue, run every guardrail, check
  determinism, check that the starting ship still flies exactly like the original player ship, and
  feed deliberately broken rules to prove the guardrails catch them.
- A **balance table** of every ship and item is kept as a test snapshot, so any tuning shows up as
  a readable diff in review (`npx vitest -u` after an intended change).
- **Property tests** will run world generators over many seeds (1,000 in CI) and assert the
  guardrails.
- **Save compatibility**: tests load old saves through the migrations and check every referenced id
  still exists.

## 6. The first application: ships and equipment

### Manufacturers (fiction)

| Maker | Based at | Faction | Tendency | Ships named after |
| --- | --- | --- | --- | --- |
| Halden Orbital Works | Halcyon Ring, Sol | Transit Authority | balanced reference maker; the starting ship | seabirds |
| Ares Foundry | Deimos Depot, Sol | Transit Authority | armoured, slow to turn; slow, hard-hitting guns | forge tools and fortifications |
| Toliman Cooperative Yards | Meridian Outpost, Alpha Centauri | Frontier Cooperative | roomy holds, efficient power, quick-recharging shields | trees |
| Horizon Dynamics | Horizon Platform, Sirius | Frontier Cooperative | fast, agile, power-rich, lightly armoured, expensive | optics and orbital terms |
| Eridani Shipwrights | Eridani Mining Hub | Frontier Cooperative | freighters and haulers; roomy and cheap | rivers and tides |
| Wake Salvage | (raider scrapyards) | Hollow Wake | quick, vicious, thin-skinned; not sold | predators and ash |

### Ship classes (Mk I baseline)

| Class | Role | Gun mounts (Mk I–III) | Cargo | Notes |
| --- | --- | --- | --- | --- |
| Courier | fast runs, light trade | 2 | 20–31 | the starting class |
| Light fighter | dogfights, escorts | 2–3 | 8–12 | most agile |
| Heavy fighter | hunting, bounties | 4–5 | 12–17 | armour plate as stock |
| Gunship | holding ground | 5–6 | 17–24 | two launchers, torpedoes |
| Freighter | bulk trade | 1–2 | 56–111 with its stock pod | guns up to class 2 on a Mk I |
| Surveyor | exploration, science jobs | 2 | 30–47 | scanner and tractor beam as stock |

Slots take equipment up to class 3 on a Mk I, 4 on a Mk II and 5 on a Mk III. Each model comes
with a stock loadout of tier-matched equipment, preferring the maker's own families.

Every model's 3D mesh is generated too (`src/world/art/shipgen/`, gallery at `/dev/ships.html`):
the class sets the layout (a courier's canopy and belly pod, a freighter's spine of cargo
sections, a surveyor's dish), the maker's style sets palette, silhouette, wings and surface
detail, the tier adds fins, stripes and antennae, and the model id seeds small variations. The
mesh fills the class's collision radius and puts one muzzle on each gun mount.

### Equipment families

- **Guns** (one per gun mount): pulse cannons (energy), mass drivers (kinetic), plasma cannons
  (plasma), ion disruptors (ion: strip shields, barely touch hulls).
- **Launchers**: rocket pods (unguided), seeker launchers (homing), torpedo tubes (heavy).
- **Shields**: balanced, deflector (resists kinetic, weak to energy), diffuser (resists energy,
  weak to plasma).
- **Engines** (cruise speed, spin-up, acceleration), **thrusters** (boost), **power plants**
  (energy for guns and boost; a ship's capacitor bank multiplies it).
- **Utility**: armour plating (hull, costs agility), cargo pods (cargo, cost speed), scanners (scan
  range), tractor beams (loose-cargo pickup range).
- **Consumables**: rockets, seekers and torpedoes (per launcher), nanite repair kits.

### Buying ships

The shipyard credits your current ship and its fittings (and any rounds in its racks) at 70% of
their value, less the cost of outstanding hull repairs. The new ship arrives with its stock
loadout and full racks; cargo and repair kits move across if they fit (otherwise the sale is
refused until you sell the excess).

### Adding content

- **A new maker**: add an entry to `rules/manufacturers.ts` (traits, line-up, name pools, style),
  then list it in a shop. The tests tell you if a name collides, a trait is out of range or
  something is not sold anywhere.
- **A new equipment family**: add it to `rules/gearFamilies.ts` and give makers a product line for
  it. Guns and shields automatically join the shared budget curve.
- **A new ship class**: add it to `rules/shipClasses.ts`; duels, trade-offs and the envelope are
  checked for it automatically.

## 7. The world generator

The second application builds the world around the real stars: `generateWorld(seeds, seed, growth)`
in `src/content/world/generate.ts`, a pure function of the catalogued systems (the frozen core's
`CORE_SEEDS` and the verified sky's `GROWTH_SEEDS` in `src/data/systems.ts`, §7.6–7.7), the world
rules (`src/content/world/rules.ts`) and a fixed seed (`WORLD_SEED`), so every player flies the same
world. The five hand-authored systems keep their stations, owners and lanes; the generator only
builds around them.

### 7.1 Jump lanes

1. The hand-authored lanes.
2. The shortest lanes that connect every system (a minimum spanning tree over real distances).
3. Extra short lanes so no system is a dead end (at least two lanes wherever a neighbour lies within
   8.5 ly and has room; at most five lanes per system).
4. Very short hops (under 3.2 ly) become lanes too, which makes loops.

A system far from everything stays a dead end: the lane would be longer than the rules allow. In the
core, Altair and 40 Eridani were; both have since gained lanes to new systems (§7.7).

### 7.2 Territory and security

Each lawful faction radiates influence from its home systems (`weight / (1 + (d / 5 ly)²)`,
summed per faction). A system belongs to the strongest faction when its influence passes the claim
threshold, and its security (0 lawless … 1 patrolled core) grows with that influence. The threshold
is chosen so that claimed space is never lawless. Below security 0.35, raiders operate openly.

### 7.3 Stations

A system gets one to four stations: one, plus one with two or more confirmed planets, one around an
F, G or K star, and one in well-patrolled space. Each is drawn by weight from the station types
allowed at that security (trade ports and customs depots in secure space, free ports only in
lawless space, mining outposts only where a small confirmed planet exists, research stations
favour white dwarfs and planets, and so on). Every station orbits a catalogued star or confirmed
planet; nothing is placed around a body the catalogues do not list. Then:

- **Pirate dens** appear in lawless systems at least two jumps from Sol (75% chance each). They
  are never dockable for lawful pilots.
- **Coverage**: every kind of station exists somewhere. A kind the dice missed is added to the
  system that suits it best.
- **Names** are a first word from the owner's pool (Transit Authority words are civic and
  nautical, Frontier words pastoral, independents' flashy, raiders' grim) and a noun of the type
  ("Sagebrush Yards", "Hazard Bazaar"). Each first word is used once.
- **Shops**: stations that sell equipment carry one or two of their owner's makers; shipyards
  always include a maker that builds what they sell; free ports carry salvaged Hollow Wake gear
  next to one lawful maker. Other stations with repairs sell consumables.
- **Look**: each station gets a `StationLook` (type, owner, seed, star colour, size, wear) that the
  exterior and interior art generators build from. Wear grows as security falls.

### 7.4 Station art

Each generated station is built from its `StationLook` twice:

- **Exterior** (`src/world/art/stationgen/`, gallery at `/dev/stations.html`): the type sets the
  silhouette (a ring port on a spindle, a customs hangar with scanner gates, open shipyard frames
  with half-built hulls, a habitat clamped to a mined rock, refinery towers and flare stacks,
  factory blocks on a conveyor spine, a farm drum of glowing greenhouse rings, research domes and
  dishes, a relay mast, a military wedge with turrets, a free port of mismatched modules and neon,
  a raider den dug into a rock or a wreck); the owner sets the paint, size the scale, wear the
  grime and failing lights. One lit docking bay, a clear approach corridor and a bounding radius
  are guaranteed and tested.
- **Interior** (`generateInteriorStyle` in `src/world/rooms/stylegen.ts`): halls, dressing, trade
  goods, bar and crowd by type, palette and signage by owner, crowd and clutter by size, grime and
  flickering lamps by wear. The view out of the bay shows only catalogued bodies: the confirmed
  planet the station orbits, no planet around a lone star, and the system's second star.

Both are deterministic, stay within per-quality mesh, triangle and light budgets, and the
hand-made stations keep their authored models and rooms (their rooms are fingerprinted in tests).

### 7.5 World guardrails

`validateWorld` (`src/content/world/validate.ts`) checks, and the unit tests run it for the real
world and for twelve other seeds:

- lanes are two-way, reach every system from Sol, stay under 9.5 ly (hand-authored lanes aside;
  12 ly for a lane that touches a new system, §7.7) and leave no avoidable dead end;
- security stays in range, claimed space is never lawless, hand-authored owners are kept and Sol is
  Transit Authority core space;
- every station orbits a catalogued star or confirmed planet of its system, has a sane orbit and
  look, fits its type's security band and owner, and ids and names are unique;
- pirate dens only in lawless, unclaimed space two or more jumps from Sol, never dockable;
- every system has an open station, none has more than four, and every station type exists;
- names come from the owner's pool (a warning sign that the pool ran out), never repeat a ship,
  equipment, maker, faction or system name, and pass the denylist;
- every shipyard has something to sell and every outfitter that sells equipment stocks a maker.

### 7.6 Adding to the world

- **The core is locked.** The world's first 32 systems (the five hand-authored ones and 27 from the
  HYG and Open Exoplanet catalogues) are generated from frozen seeds
  (`src/content/world/core-seeds.json`: their positions, stars and planets as that first catalogue
  gave them), never from the live dataset. Better astronomy moves a star on the map, never a
  station, lane, owner or name, so saves keep working. The core is built with the same rules as
  everything else (station types with their weights and bands, the core's name pools `NAME_WORDS`,
  the territory and lane rules), so changing them can move it; the lock test then fails (§7.7), and
  the change would need a save migration.
- **More systems** come from the verified sky (`docs/ASTRONOMY_SOURCES.md`): a new snapshot and
  `npm run data:build` put them in `src/data/generated/catalog-systems.json`, and the world grows
  around the core (§7.7). There is no pick list to edit.
- **A new station type**: add it to `StationType` (`src/content/world/types.ts`) and a rule to
  `STATION_TYPES` in `rules.ts`; give it a shop entry if it sells equipment and a market profile in
  `src/content/economy/rules.ts`. The coverage guardrail makes sure it appears somewhere; add an
  archetype to the exterior generator and a character to the interior generator. The core draws
  from the same list, so a type its systems qualify for can move the core: run the lock test.

### 7.7 Growth and the frontier

The sky snapshot of 2026-09-30 (`docs/ASTRONOMY_SOURCES.md`) added 175 systems within about 27 ly
to the 32 of the core: 207 in all. `growWorld` (`src/content/world/generate.ts`) places them around
the finished core without changing it, nearest to Sol first, by the rules in `GROWTH`
(`src/content/world/rules.ts`):

- **Lanes** (`growJumpNetwork` in `src/content/world/network.ts`): each new system joins the nearest
  placed system with room (fewer than five lanes), or the nearest at all if none has room. Then a
  new system with fewer than two lanes links to its nearest placed systems within 10 ly
  (`GROWTH.maxExtraLinkLy`) that have room, a core dead end gains lanes to new systems only, and
  hops under 3.2 ly with a new system at one end become lanes too. Every growth lane touches a new
  system, so no lane is ever added between two core systems. Today 21 core systems have gained a
  lane.
- **Territory**: the same anchors decide who claims a new system (§7.2); today the Frontier
  Cooperative claims five and the rest are unclaimed. An unclaimed system with a catalogued planet,
  or an F, G or K primary star, is settled by independent colonies that keep a militia: its
  security is at least a value drawn for it from 0.3–0.42 (`GROWTH.colonySecurity`), so farms, labs
  and free ports can open there.
- **Stations** follow §7.3, named from pools of their own (`GROWTH_NAME_WORDS`; independents have
  the most) so the core's names never shift. When a pool runs out, a station is named after its
  system ("GJ 393 Bazaar"); 105 of the 264 new stations are. A lawless new system two or more jumps
  from Sol gets a raider den with a chance of 0.4 (`GROWTH.denChance`), against 0.75 in the core:
  the frontier is thinner than the core's edge.
- **The frontier** is the far shell: new systems farther than 17.5 ly from Sol
  (`GROWTH.frontierLy`), 141 of the 175 today (`isFrontier` in `src/data/systems.ts`). A lane with a
  frontier system at either end (`laneNeedsDrive`) needs a long-range jump drive whose reach is at
  least the lane's length. `laneTaker(reach)` (`src/galaxy/jumpRules.ts`) answers that for each
  lane, and route finding takes it as `RouteOptions.canTake` (`src/galaxy/routing.ts`), so routes
  skip the lanes a ship cannot take. The drive is a utility fitting (the `jump-drive` family): 11 ly
  at class 1, 11.7 at class 2 and 12.4 at class 3. Horizon Dynamics makes classes 1–3 and Wake
  Salvage classes 1–2; outfitters that stock either sell them. From Sol, a class 1 or 2 drive
  reaches 138 of the 141 frontier systems and a class 3 drive all of them. Without a drive, the star
  map's jump panel says what reach the frontier lane needs and who sells drives; with one too
  short, how long the lane is.
- **Work**: a board outside the frontier never sends a pilot into it (for a contract, a frontier
  system is out of reach from outside); frontier boards send anywhere. Every frontier board except
  a den's adds 2 to the weight of surveys (`FRONTIER_SURVEY_WEIGHT`), and a survey of a frontier
  planet pays half as much again on its varying part (`CONTRACTS.reward.survey.frontier`, §10.3). A
  survey of a contested or candidate planet says so, and that the readings go in the station's
  log: only the archives can settle it (§1).
- **A life of its own**: harvests come in at its farms, its research posts hold survey seasons,
  and its colony haulers lose their drives far from any dock (§11), each with work to match; and
  First Harvest (§14.6) is its story.
- **The star map** frames the core's systems (zoom out for the far shell), draws frontier lanes in
  dashed amber on the 3D map with a line in the key, gives the labels of the core's systems and of
  systems visited priority over the far shell's, and draws new systems' drop lines fainter.
- **Milestones** (§13.3): *Into the frontier*, for a first frontier system visited, and
  *Twenty-five frontier systems visited*.

Guardrails:

- `tests/unit/worldLock.test.ts` generates the core from its frozen seeds and holds it to
  `tests/unit/fixtures/core-world.json`: every station's id, name, system, type, owner and anchor,
  every lane, and every system's owner and security. In the grown world the core's stations come
  first and unchanged, every core system keeps its owner, security and lanes and gains lanes to new
  systems only, no new system takes a core id, and every body a core station orbits is still in the
  dataset.
- `tests/unit/frontier.test.ts`: there are more than 50 frontier systems, each a new system more
  than 17 ly out, and every lane of theirs needs the drive (Sol to Alpha Centauri does not). A pilot
  without a drive is refused a frontier system with a reason naming the long-range jump drive; one
  with a 12.4 ly drive gets a route through a frontier lane; one whose drive falls short of that
  lane, if refused, is told it lies beyond the drive. Every system outside the frontier is reachable
  from Sol without a drive, and every frontier system with a 12.4 ly one. Drives are sold outside
  the frontier, somewhere a pilot without one can reach. No board at sixty stations outside the
  frontier, over six time slots, sends a pilot into it, and frontier boards have work.
- The world guardrails (§7.5) run on the grown world, with lanes that touch a new system allowed
  12 ly (`GROWTH.maxLinkLy`), core systems gaining lanes to new systems only, no word in both the
  core's and the growth name pools, and a new system's station allowed its system's name once its
  pool has run out.

## 8. The economy

Twenty-one goods (`src/content/economy/goods.ts`): raw materials (water ice, metal ore, volatile
gases), fuels (deuterium, helium-3), refined stock (metals, polymers), food (staple and fine),
manufactured goods (medical supplies, machinery, electronics, fabricator parts, consumer goods,
ship components, habitat modules), science (research samples, survey data cores), luxury goods,
small arms (restricted: military bases and free ports) and salvage.

### 8.1 Who makes and wants what

Each kind of station has a market profile (`STATION_MARKETS` in `src/content/economy/rules.ts`):
goods it **makes** (sells cheap, buys back for less), goods it **wants** (buys dear, never sells)
and goods it **trades** both ways near the going rate. Mines dig ore, ice and gases and want food,
machinery and luxuries; refineries turn ore, ice and salvage into metals, fuel and polymers;
factories turn metals and polymers into machinery, electronics and consumer goods; farms grow food
and want water and machinery; research stations sell samples and data and want electronics; free
ports sell salvage and small arms and pay well for luxuries. The hand-authored stations have their
own profiles, and the three goods of the opening contracts keep their designed prices.

### 8.2 Prices

- **Equilibrium**: makers sell at about 0.72 × base; stations that want a good pay 1.16 × base
  plus 6% per jump to the nearest maker (up to five jumps), plus a risk premium in lawless space
  (up to 25%). Each station and good varies by ±6%.
- **Stock**: every market has a normal stock (makers hold 140–260, buyers 30–60). Price moves with
  `(normal stock ÷ stock)^0.35` (clamped to 0.62–1.6): buying drains stock and raises the price,
  selling fills it and lowers the price. Every unit of an order is priced at the stock it leaves,
  so bulk orders move the price and no round trip at one dock makes money.
- **Recovery**: stock returns to normal with a 30-minute time constant (game clock). Only stock the
  player has moved is saved (`GameState.markets`, save format 4).
- **Drift**: every price wanders ±6% over 40–120 minutes of play, from zero at the start of a game.
- **Standing** with the station's faction improves both prices; buy and sell never come closer
  than 4%, and everything stays inside a band of 0.4–2.2 × base.

### 8.3 What the player sees

The trader lists what the station makes, trades and wants, with what you pay and what you
receive, the stock on hand and the best price you know elsewhere. The trade computer only uses
prices you know: seen, briefed, heard in a bar or relayed by the price watch (§16). The star map and the encyclopedia say what each station
makes and wants (public knowledge, without prices).

### 8.4 Economy guardrails

`validateEconomy` (`src/content/economy/validate.ts`) runs on the equilibrium tables for the real
world and for other world seeds; the unit tests also check live prices over many market states:

- every good is made somewhere and wanted somewhere;
- equilibrium prices stay within 0.4–2 × base and spreads within 4–30%;
- the hand-authored opening prices reproduce exactly;
- every market sells something that another market within four jumps pays at least 12% more for,
  and no route pays more than 2.8 times its price;
- at least three goods are worth hauling within two jumps of the starting station;
- live prices stay in their bands, buy stays above sell at every standing, a buy-and-sell-back
  round trip always loses money, stock recovers and drift stays gentle.

## 9. Traffic and raider packs

Every system has traffic that fits it (`src/world/traffic/plan.ts`, flown by `FlightSession`):

- **Traders** are the haulers of the timetable (§21) flying in the system: out of a dock to the
  jump beacon, in from the jump to a dock, across on their way elsewhere, or from one station to
  another. The plan caps how many are shown at once (about one per station, fewer where security
  is low, at most six; fewer on the Medium and Low presets), relief for a shortage first. They fly
  around planets and stations, and when shot at they call a mayday and run for the nearest
  station. A lost hauler spills salvage and half its cargo.
- **Patrols** (wings of two fighters of the owner's makers) fly between the stations and the jump
  beacon in claimed space with security 0.4 or more (two wings in the core). They engage raiders
  within 4 km. They leave the scripted opening raid near Mars to the player.
- **Raider packs** appear below security 0.6 and never in Sol: after a 35-second grace period,
  then every one to two minutes (sooner in lawless space) while fewer than the maximum are about
  (two in lawless systems with a den). Threat level 1 (one or two Wake light fighters) at the
  border, 2 (two or three, some heavier) in low-security space, 3 (two to four, mostly heavy
  fighters) in lawless space; one level more five or more jumps from Sol. They come out of a den
  or out of the dark, sweep toward where the player was, then prowl the station approaches and
  the jump beacon. They attack the player within 4.5 km and hunt traders and patrols within 9 km;
  after four minutes with nothing to hunt they leave.
- **Fights**: bolts only hit ships of the other side (no friendly fire among lawful ships or
  among raiders). NPC ships fly their catalogue loadouts, but their guns deal a quarter of the
  damage (the opening raider's level), scaled by the difficulty setting when aimed at the player.
- **Bounties**: a raider the player destroys (hit by the player within the last 30 seconds) pays
  150 cr plus 110 cr per tier above Mk I, 80 cr more for heavy fighters, from the system's owner
  (the Transit Authority in unclaimed space), with a little standing with that owner.
- **Warnings**: the star map and encyclopedia show each system's security, owner and raider
  threat; the HUD shows *Hostile contact* while a pack is on you, and jumping needs clear space.
- Fewer ships on the Medium and Low quality presets (phones).

## 10. Contracts

Every station with a contracts service posts a board of generated contracts next to the hand-made
story jobs (`src/economy/contracts.ts`; rules in `src/content/contracts/rules.ts`). The six
hand-made stations join in once the opening delivery is done.

### 10.1 Boards

- A board is a pure function of the station, its time slot and the world, world events included
  as they stand when it is posted (`rng(WORLD_SEED, "contracts", station, slot)`). Boards change
  every 25 minutes of play (the game clock). Ids are `c.<station>.<slot>.<index>`, so a contract
  can be found again from its id; a decisive operation (§20.7) is `c.<station>.<slot>.decisive` and a
  lasting mark's run (§14.7) `c.<station>.<slot>.run-<mark>`, because they come and go within a time
  slot and must never take the id of a contract a pilot already holds. A commission for a faction's
  own ranks (§32.4) is `c.<station>.<slot>.rank`, from its own stream, so nothing else on the board
  moves; rival hunters never take one, and the bars never tell of one.
- Two contracts per board, one more at large stations and one more at trade ports and military
  bases (at most four), plus at most one that answers a world event (§11.3). No board posts two
  contracts of a kind to the same place.
- What a station posts depends on its type:

  | Station | Freight | Parcel | Supply | Bounty | Survey | Escort | Ace | Recovery |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Trade port | 3 | 2 | 2 | 1 | | 1 | | |
  | Customs depot | 1 | 2 | | 3 | | | 1 | 1 |
  | Shipyard | 1 | 1 | 3 | | | | | 1 |
  | Mining outpost | 2 | | 2 | 1 | | 1 | | |
  | Refinery | 2 | 1 | 2 | | | 1 | | |
  | Factory | 3 | | 2 | | | 1 | | |
  | Agri station (farm) | 3 | 1 | 1 | | | 1 | | |
  | Research station | | 2 | 1 | | 3 | | | 2 |
  | Relay | | 3 | | 1 | | | | 1 |
  | Military base | | 1 | | 4 | | | 2 | |
  | Free port | 2 | 2 | 1 | 1 | | 1 | 1 | 1 |

  The hand-made stations have their own mixes (Horizon Platform posts surveys, Deimos Depot
  bounties and aces, and so on).
- Accepting copies the contract into the save (`GameState.contracts`, save format 6), so the board
  moving on or the rules being tuned never changes a contract under the player. At most five
  generated contracts can be in progress; the 30 most recent finished ones (completed, abandoned
  or failed) are kept for the journal. A pilot at the top rank with any faction may have six (§32.3).
- A survey of a planet the player has already scanned is not offered.

### 10.2 Kinds

- **Freight**: the station loads goods it makes (8–30 hold units, worth at most 900 cr at base
  prices; never small arms) for a station within three jumps that wants or trades them. The player
  pays a deposit of 110% of what the cargo fetches at its destination (events there included); it
  comes back with the pay on delivery, so selling the cargo instead always loses money.
- **Courier parcel**: a pocket-sized parcel for any open station within four jumps. No cargo
  space; completes on docking there.
- **Supply run**: the station is short of a good it wants. The briefing names the nearest station
  within three jumps that makes it, with its price there right now (the trade computer learns that
  price). The pay covers the goods at that price plus a 35% markup.
- **Bounty**: a Hollow Wake pack preying near a marked spot (the system's raider den, or one of its
  stations) in a system within two jumps where raiders roam. The pack has the system's threat
  level and one more raider than that level. It appears shortly after the player arrives, a few
  kilometres off the station's approach (or outside the den), loiters there and never leaves;
  patrols leave it to the player. Leave and come back and the rest of the pack is still there.
  The contract pays when the last one goes down (instead of the per-kill bounty) and costs 3
  standing with the Hollow Wake.
- **Survey**: fly close enough to a confirmed planet within three jumps for the scanner to log it
  (real catalogued planets only). Pays as soon as the scan is logged.
- **Escort**: a hauler of the station's owner (independents' otherwise) sets off alongside the
  player for another station, in the same system or up to two jumps away (six in ten go to another
  system when one is in reach), and only to a system with something to fear (raider packs, or
  security below 0.75). In its destination's system it keeps to sublight speed and holds position
  while the player is more than 2.5 km away. A quarter to nearly half of the way along, raiders of
  that system's threat (at least 1) ambush it from ahead, and half of them go for the hauler until
  the player draws them off. The contract pays when the hauler docks; it fails if the hauler is
  destroyed, or if the player jumps out of the destination's system without it.
- **Escorts across jumps**: on the way to another system the hauler keeps station behind the
  player instead (never fighting) and catches up after a lane or a long cruise, as wingmen do. The
  jump drive waits, and the star map says why, while it is more than 2.5 km away; within that it
  jumps with the player, and the save records the system it is in (`escortAt`). Arriving through a
  jump with escorted ships in a system with something to fear, raiders of the escort's threat are
  waiting at the beacon: they strike a few seconds later from ahead, and half of them go for the
  haulers. If the player is towed home after a defeat, the haulers wait where they were.
- **Convoys**: a third of the escorts across jumps are a convoy of three haulers of one hull (named
  from an invented pool), two of which must arrive. Ships lost count against it wherever they fall;
  one wave of raiders comes on the way to the dock (two where the threat is 3), besides the beacons.
- **Ace hunt**: a named Hollow Wake ace (names from invented pools) in a heavy fighter, 80% tougher
  and 30% deadlier than its hull suggests, with two guards, near a marked spot within three jumps
  where packs are nasty (threat 2 or more). Always difficulty 3. The guards pay the usual bounty;
  the ace drops a salvage pod worth 500–900 cr and a pod of 3–6 luxuries, electronics, small arms
  or ship components, tractored in like any loot.
- **Recovery**: a wreck (a dead hauler, slowly turning) lies a few kilometres off a station within
  three jumps. In systems where raiders roam, guards of the system's threat wait by it. Tractor the
  item aboard (a flight recorder, a sealed cargo pod, a survey drone, a data vault or a courier's
  strongbox), then bring it back to the station that posted the job. The HUD steers to the item.
- **Mining claim** (§19.5): mines, refineries and the Eridani Mining Hub pay for a load mined in a
  cited belt within three jumps and brought back to them.
- **War work** (§20.4): only while a border front within two jumps is fighting; the law pays for
  a raider pack broken on its lanes, the dens for the front faction's haulers hit.
- **Rescue** (only as work answering a drive failure, §11): 3–5 ship components for a frontier
  hauler stranded within two jumps, loaded on acceptance against a deposit of 110% of their base
  value (returned with the pay). The hauler drifts at least 12 km from any dock and clear of stars
  and planets, in the same place every time for the same job; scavengers of the system's threat
  may watch it. Coming within 400 m with the parts in the hold hands them over and pays; short of
  them, the HUD and a message say how many are missing. A few seconds later the hauler's drive is
  back and it makes for the nearest dock. Destroyed first, the rescue fails.

Two variations:

- **Urgent** (three in ten parcels and hauls): a bonus of 40% of the pay for finishing within a time
  limit counted from acceptance on the game clock: 2.5 times the expected trip (45 s to fly out,
  165 s per jump including two minutes of lane transit, 30 s to dock), and at least 8 minutes.
  Late deliveries still pay, without the bonus, and cost 2 standing. The HUD counts down.
- **Follow-ups**: a delivered parcel or haul leads, in 45% of cases (decided by its id, so always
  the same), to a follow-up offered at its destination: a parcel or haul from there, paying a
  quarter more per step, up to three steps. The offer waits in the save and lapses after two board
  changes.

### 10.3 Pay, difficulty and standing

- **Pay** = 2.5 × the one-way jump fees (always paid in full) + the goods on a supply run + a part
  that varies by ±10% from one posting to the next: a base (110–900 cr by kind), a danger part
  times (1 − the destination's security), and the kind's own part (15% of the freight's base value,
  the 35% markup on supply goods, 150 cr per raider per threat level on bounties, 180 cr per threat
  level and 220 cr per jump on escorts, a convoy 1.8 times as much, 150 cr per guard level on
  recoveries). Work that answers an event pays 30% more on the varying part. Rounded to 5 cr.
- **Difficulty** 1–3: one more for a lawless destination (security below 0.35) and one more for
  three jumps or more; supply runs count the trip to the source; bounties take the threat level,
  escorts the destination's threat and one more for two jumps; aces are always 3. The briefing
  notes the route and the risk.
- **Standing** with the station's owner: +2, +4 or +6 by difficulty; difficulty 3 needs Friendly
  standing (10). Independent stations have no gates and give no standing.
- **Abandoning** a generated contract (from the journal): any deposit is forfeit, the cargo stays
  in the hold, standing with the owner drops by 3, and the contract stays on its board as
  abandoned so it cannot be taken again. **Failing** one (an escort lost or left behind) costs the
  same standing. The story jobs cannot be abandoned.

### 10.4 Contract guardrails

`validateContracts` (`src/economy/contractGuards.ts`) checks every board at every station over
forty time slots, and every follow-up those boards lead to (`tests/unit/contracts.test.ts`):

- ids name their station and time slot (follow-ups their station) and are unique on a board; text
  is filled in (no `undefined`, `NaN` or braces);
- rewards between 0 and 4,500 cr; difficulty 1–3; the standing gate matches the difficulty;
- every target is within the kind's reach, and destinations are open stations;
- freight: the giver makes the goods, the destination wants or trades them, the deposit is at
  least what the cargo fetches there, and the load is a contract-sized one;
- supply runs: the giver wants the goods and the named source makes them;
- bounties: raiders roam the system, and the pack's size and threat match the system's (or the
  raid's);
- escorts: from the posting station to another open station within two jumps, something to fear
  at the destination, the ambush threat and difficulty matching the destination and the trip, a
  hauler from the catalogue; convoys only across jumps, three named ships of which two must
  arrive, with the waves the threat calls for; local escorts, escorts across jumps and convoys all
  occur;
- aces: one named target at the top difficulty, where packs are nasty;
- recoveries: find and bring back, guards matching the system, a known item;
- surveys: the planet is a catalogued planet of that system (a survey season's, its own);
- rescues: a hauler of that name is stranded there right now, in the frontier; the parts loaded are
  the ones handed over, against a deposit at least their value; scavengers match the system;
- urgent terms only on parcels and hauls, with at least twice the expected trip and a real bonus;
- work that answers an event answers one under way where it says, one per board at most;
- pay beats 1.2 × the jump fees there and back plus 40 cr of expected repairs per difficulty level
  (plus the goods on a supply run);
- no station's board is empty in more than one time slot in ten; every kind, urgent jobs, event
  work and follow-ups all occur.

`tests/unit/flightContracts.test.ts` flies an escort with its ambush, an escort and a convoy on
their way to another system (keeping with the player, holding the jump while too far, catching up,
and the ambush at the beacon), an ace with its guards and loot, and a wreck's recovery in a real
`FlightSession` (in node, without rendering).

### 10.5 What the player sees

- The job board in the bar: each card shows the kind, who posts it (or *Independent*), where it
  sends you, the reward and the difficulty, and tags for follow-ups, urgent jobs and work in the
  news; opened, the briefing, the route note, the cargo, the deposit, the time limit and the chain
  step. The accept button shows the reward and the deposit.
- The HUD objective and the map marker follow the story job first, then the other contracts in the
  order they were accepted; bounties count kills (*k/N*), urgent jobs count down, recoveries steer
  to the wreck's item. The star map marks every system an active contract sends you to.
- The journal lists contracts in progress, with *Abandon* for the generated ones.

## 11. World events

The neighbourhood does not stand still (`src/economy/events.ts`; rules in
`src/content/events/rules.ts`). Like the markets, events are a pure function of the world seed and
the game clock: nothing runs in the background and nothing is saved, and every device sees the
same events at the same clock. The clock runs while flying, and each jump adds two minutes of lane
transit, so the world moves on while you travel.

### 11.1 What happens

- **Stations** (every station with a market, except Sol's two, which keep the opening as designed)
  have one two-hour window after another, each shifted by the station's own phase so the
  neighbourhood never goes quiet at once. In each window there may be one event, lasting 30–90
  minutes inside the window, so a station never has two at once:
  - **shortage** (18% of windows): one good the station wants; its price × 1.2–1.4 and its normal
    stock × 0.6;
  - **glut** (10%): one good it makes; price × 0.7–0.85, stock × 1.8;
  - **boom** (7%): a construction boom, a founders' festival, a research push or a fleet refit
    raises up to three goods it wants or trades; price × 1.15–1.3, stock × 0.8;
  - **strike** (5%): the goods it makes; price × 1.2–1.35, stock × 0.5;
  - **harvest in** (14%, frontier farms only): the farm's food or fine food floods in; price ×
    0.65–0.8, stock × 2;
  - **survey season** (12%, frontier research posts only): the post takes fresh readings of a real
    planet of its system or one jump away (one the archives disagree about, when there is one) and
    wants electronics, helium-3 or fabricators; price × 1.15–1.3, stock × 0.8. Its news says
    plainly that the readings go in the post's log and settle nothing the archives do not (§1).

  The frontier's own kinds come last in the odds, so they take only windows that were quiet
  before: every other event is exactly as it was (a unit test fingerprints 100 hours of them).
  The hand-made stations' three opening goods and small arms are never touched. The lower stock
  moves the price further through scarcity, and the price bands (0.4–2.2 × base) still hold.
- **Systems** have three-hour windows:
  - **raid** (22%, below security 0.75): one more raider threat level (at most 3), one more pack
    at a time, packs sooner and more often, half the traders; 40–100 minutes;
  - **security sweep** (12%, in claimed space where packs roam): no packs, one more patrol wing;
  - **drive failure** (15%, frontier systems only): a colony hauler (named from an invented pool)
    has lost its drive far from any dock. It moves no prices or traffic; it wants rescuing.
- News text says what an event does in numbers printed from the event itself ("pays up to 49%
  more than usual"), with the cause from a small pool of phrases.

### 11.2 How the world feels them

- **Markets**: live prices and stock follow the event while it lasts (stock the player moved
  recovers toward the event's normal stock).
- **Traffic**: raids and sweeps change the traffic plan when the player arrives or launches, and
  the HUD says so.
- **Haulers**: a shortage draws relief haulers from the stations that make what it lacks; their
  cargo fills its stock as each arrives, and all of it arriving ends it (§21). A haul lost to a
  raid is missed where it was bound. Otherwise stock recovers toward normal on its own.

### 11.3 News and work

- **News** reaches two jumps: the bar's News window lists events under way (then those over within
  the last half hour), nearest first, with how long they have run and how long they have left. The
  star map marks systems in the news and the system card repeats it. The trader window flags the
  goods an event moves at that station.
- **Work**: a station's board posts at most one contract answering an event: a *shortage run* or
  *boom supplies* into its own shortage or boom (markup 60% instead of 35%), a *surplus haul* out
  of its glut, a *harvest haul* out of its harvest, a *survey season* survey of the planet its
  season studies, a *rescue* for a hauler stranded within two jumps (§10.2), or a *raid response*
  bounty on a raid within two jumps (the raid's threat). Their varying pay is 30% higher.

### 11.4 Event guardrails

`validateEvents` (`src/economy/eventGuards.ts`, run over 300 hours of clock in
`tests/unit/events.test.ts`) checks that events never overlap at a place or spill out of their
window, never touch Sol or the opening goods, only concern goods the station deals in the right
way, keep effects inside the rules, state the change they cause, keep live prices inside their
bands with buy above sell, put raids only below security 0.75 with the threat one above the
system's, put sweeps only where packs roam in claimed space, happen at a sensible rate (5–45
station events under way per hundred stations on average) and cover every kind. The frontier's
own happen only there: harvests at its farms, of what they grow; survey seasons at its research
posts, of a real planet within reach, a contested one said to be contested and never said to be
settled; drive failures in its systems, with the hauler named.

## 12. The law and the outlaw path

The Transit Authority and the Frontier Cooperative keep the law in the space they claim; the
Hollow Wake keeps none, but remembers (`src/economy/law.ts`; rules in `src/content/law/rules.ts`).

### 12.1 Crimes, fines and pardons

- **Crimes** against a lawful faction (the ship's own, or the system's owner for an independent
  hauler; in unclaimed space an independent's loss goes unpunished):
  - firing on a lawful ship: 500 cr and −8 standing (reported once per ship);
  - destroying one: 1,000 cr and −15 standing (and +4 with the Hollow Wake);
  - leaving a patrol's cargo scan before it finishes: 400 cr and −5 standing;
  - contraband found: confiscated, fined at twice its base value, −3 standing.
- The player's guns hit a lawful ship only when it is the selected target or it is attacking the
  player, so no crime happens by accident in a crossfire. Firing back at a lawful ship that is
  attacking you is self-defence and is not fined; destroying it still is.
- **Hunted**: while a pilot owes a faction fines, or its standing is Hostile (−30 or worse), its
  patrols attack on sight within 6 km and its stations give **emergency docking** only: the deck
  (hull repairs at a 50% surcharge) and the bar's News window, where the **customs desk** takes
  fines. A **pardon** costs every fine owed to that faction plus 50 cr for each point of standing
  below −10 (so a Hostile pilot who owes nothing still has a way back): the hunt ends and standing
  rises to −10 (Wary) if it was lower. A Wary faction offers easy (difficulty 1) contracts only.
- **Bounty hunters**: two of them come for a pilot owing 1,500 cr or more, 45 seconds after arriving
  in space with security 0.6 or more. They fight only the player, pay no bounty and wait out lanes
  and docking. Patrols leave them alone.
- The HUD shows *Wanted* and the fines owed; the journal lists fines with standing.

### 12.2 Contraband and scans

- **Contraband**: combat stims and transponder spoofers, banned in claimed space. Free ports and
  raider dens sell them; mining outposts and refineries want stims, trade ports and shipyards want
  spoofers. Ordinary contracts never carry contraband (or small arms).
- **Patrol scans** in claimed space at security 0.5 or more: a patrol passing within 1.2 km scans
  the hold (always with contraband aboard, a quarter of the time otherwise; at most one scan a
  flight). The ship drops out of cruise and the Go To autopilot holds until the scan is done, so the
  autopilot never runs from a scan; the patrol keeps station off the player's wing for 5 seconds,
  and flying more than 2.2 km away first (the pilot's own choice) is evasion. The HUD counts the
  scan down.
- **Customs** at customs depots and military bases of a lawful owner scans every ship that docks.

### 12.3 The outlaw path

- **Piracy**: a destroyed hauler spills half its real cargo (§21) in pods of four to nine units to
  tractor in; where it was bound goes without (a relief hauler's shortage runs on).
- **Smuggling runs** (free ports and dens, open to anyone): contraband loaded against a deposit, for
  a buyer in claimed space within three jumps, never at a dock whose customs scans every ship. Pay:
  the fees, 300 cr, danger, and 30% of the goods' base value; +6 standing with the Wake, nothing
  with the law unless caught.
- **Piracy jobs** (dens only): destroy two or three haulers of a system's lawful owner within two
  jumps; +10 with the Wake. Every hauler is still a crime.
- **Trusted by the Wake** (standing 10 or more): its raiders leave you alone until you (or someone
  in their pack) hit them, and the **raider dens** take you in: a black market (they sell
  contraband, small arms and salvage, and buy luxuries, fine food, medical supplies, electronics,
  ship components and consumer goods), repairs, and a board of smuggling, piracy and courier work.
  Dens are never touched by world events, and never dockable for anyone else.

### 12.4 Law guardrails

`validateLaw` (`src/economy/lawGuards.ts`, run in `tests/unit/law.test.ts`) checks that a pardon
lifts standing above Hostile, that every system has a station with repairs within one jump, that
each contraband good is sold somewhere and has a smuggling route into claimed space to a dock
without customs, that customs scans somewhere, that every den has a black market and posts work,
and that no story job asks for a crime. The contract guardrails (§10.4) check smuggling runs
(contraband from its seller to a buyer in claimed space, no customs at the dock, a deposit worth the
goods, Wake standing only) and piracy jobs (dens only, the system's lawful owner, haulers there).
`tests/unit/flightLaw.test.ts` flies the law in a real `FlightSession`.

## 13. Goals

Things to aim for beyond the next contract (`src/economy/progress.ts` and
`src/economy/advisor.ts`; rules in `src/content/progress/rules.ts`). Every name here is invented
for this game.

### 13.1 The codex of the real sky

- The codex lists every real body the game shows: each catalogued star, each confirmed planet,
  and the Solar System's eight planets and the Moon (361 entries today, contested planets
  included). It grows only with the dataset: no invented body is ever an entry.
- Scanning a body fills in its entry once. The encyclopedia's system page shows the system's
  entries with a tick for each one scanned, and the journal shows the total.
- **Survey sales**: once every entry of a system is scanned, a research station (or one of the
  hand-made research outposts) buys the survey, once: 120 cr per entry, at least 240 cr.
- Cataloguing the whole sky earns the Frontier Cooperative's 25,000 cr grant.

### 13.2 Ratings

Four ratings follow the career record and show in the journal with the next rank:

| Rating | Score | Ranks |
| --- | --- | --- |
| Combat | hostile ships and den turrets destroyed | Green, Blooded (3), Steady (10), Hardened (25), Veteran (50), Ace (100), Legend (200) |
| Trade | contract and survey pay, plus a quarter of sales | Hauler, Dealer (2,000), Merchant (8,000), Broker (20,000), Magnate (50,000), Tycoon (120,000) |
| Exploration | 3 per system visited, 1 per codex entry | Stay-at-home, Drifter (10), Wayfarer (30), Pathfinder (60), Surveyor (100), Cartographer (150) |
| Racing | points for heats finished, podiums, wins and course records, times the club's level (§33.6) | Onlooker, Rookie (10), Contender (40), Pacesetter (120), Laureate (250), Champion (450) |

Ace hunts (§10.2) need a Hardened combat rating, and the factions' ranks (§32) ask for a record in two
of them each.

### 13.3 Milestones

Twenty-six milestones, each earned once and toasted when it happens: the first and the 25th
contract, 10,000 and 50,000 credits in hand, flying a Mk II and a Mk III ship, ten and all
systems visited, the first frontier system and 25 of them visited (§7.7), ten confirmed planets
scanned, half and all of the codex, ten and fifty raiders down, Friendly with the Transit
Authority and with the Frontier Cooperative, trusted by the Hollow Wake, a top rank in any rating
(Racing among them), each of the five story arcs (§14, §20.5) finished, The Long Border and First
Harvest whichever way they end, the first heat won and a course record set (§33). The journal lists
those earned.

### 13.4 What next

After the opening chain, when no contract is under way, the HUD's objective line suggests one
concrete thing from what the player already knows, in this order:

1. pay fines owed (and where);
2. get repairs when the hull is below half or a system is at least 40% damaged, with what a
   mechanic in this system charges;
3. sell goods in the hold where the best known price is;
4. see someone with a story mission waiting (§14);
5. buy a better ship at a known shipyard the player can afford with 1,000 cr left over, after the
   trade-in: one with half as much hold again, or of a higher class;
6. or, failing that, buy a long-range jump drive at a known outfitter once the pilot has made six
   jumps without one and not yet reached the frontier (§7.7, past 17.5 light-years);
7. catalogue a body of this system the codex lacks;
8. earn the last few points (five at most) of standing that make a lawful faction Friendly, whose
   boards then offer their hardest, best-paid work (§10.3);
9. run a known trade route from the last dock; or
10. dock at a station here with a job board.

Ships and equipment are only ever suggested from places the player has docked at, and only when
the station sells them to this pilot (§10.3). The thresholds live in `HINT`
(`src/content/progress/rules.ts`). The hint is worked out again after a scan, a launch or a jump.

### 13.5 Progress saves

Save version 7 adds the codex, the surveys sold, the milestones earned, the fines owed and the
career's sales and contract pay. Older saves start their codex from the bodies already scanned,
with no fines and no milestones yet (they are awarded at the next save if already earned).

## 14. Story arcs

Three short arcs give the sandbox a spine, one per faction, a fourth, The Long Border (§20.5),
is where they meet, and a fifth, First Harvest (§14.6), belongs to the frontier's farms
(`src/content/story/arcs.ts`, played by `src/economy/story.ts`). Unlike
everything else in this document they are written by hand, not generated, and reviewed like code:
the guardrails below check them, unit tests play each one through, and a browser test flies the
first steps.

### 14.1 How an arc is built

- A **mission** is a job with story data: its arc and step, the character who gives it, and its
  words. Its objectives are the contract objectives (dock, deliver, scan, escort, recover, bounty,
  piracy, rescue) plus three made for the story: a **choice** made at a dock, a **den assault** and a **den
  defence**.
- **Beats** are the words: the briefing (in the giver's voice, sometimes following an earlier
  choice), lines said when an objective is done, comms when the player arrives in the system of the
  objective in hand, and a debrief when the mission is complete. Each is told once: as dialogue at
  a dock, as comms in flight. The journal keeps each arc's progress, the choices made and the last
  words said.
- **Gating**: the first mission of an arc shows at its giver's dock from the start (locked until
  its conditions are met); every later one shows only once the step before is done, and after a
  choice only the way it went. Finished missions leave the board. The two lawful arcs start after
  the opening delivery; the Wake's arc is given at a raider den, to pilots the Wake trusts.
- **A way back**: a story mission that fails (an escort lost or left behind, a convoy that loses too
  many ships) goes back to its giver to try again; nothing in an arc is lost for good except by
  choice.
- **Choices** have two or three options, each with standing (and often credits) attached, shown
  before the player decides. An option may end the arc early: the arc is then over, with no
  finale. A deal with the law (in the Wake's arc) is a pardon: every fine cleared and lawful
  standing lifted to Wary. An option may ask for standing (shown, with what it needs, but closed
  until then), and a choice may branch the arc: each answer then has its own later steps and
  finale. Briefings may also carry **echoes**: a line for each choice made in another arc.
- Save version 8 records the choices made, the beats told and the dens knocked out.

### 14.2 The three arcs

| Arc | Faction and giver | Steps | Choice | Finale |
| --- | --- | --- | --- | --- |
| Clean Manifests | Transit Authority: Rhea Castell, auditor, at Halcyon Ring | an audit at Barnard Transit Relay, a flight recorder from a wreck in Ross 154, a witness escorted across Ross 154 | what happens to the evidence against a corrupt customs officer: the Frontier press, the Authority's own hands, or sold back (ends the arc) | an assault on Maw Roost, the den at Wolf 1061 |
| The Stonecrop Blight | Frontier Cooperative: Amara Quist, relief coordinator, at Meridian Outpost | a visit to Stonecrop Gardens and Dawnfield Institute at Procyon, clean water ice hauled from a mine, a sample canister from a wreck | seal the Gardens, or burn the worst bays and reseed | a relief convoy of three haulers under two ambushes |
| Salt's Crew | Hollow Wake: Salt, a Wake captain, at Graveyard Nest | transponder spoofers smuggled into Ross 154, two Authority haulers taken, a strongbox recovered in Wolf 1061 | what Salt is told about Juno Fiske, who wrote a list of Nests for the Authority: everything, a warning to Juno first, or the Nest sold to the Authority (a pardon, and the end of the arc) | holding Graveyard Nest against an Authority sweep |

Each finished arc is a milestone. Standing moves with every step, most of all at the choices and
finales (the Wake's arc makes an outlaw of anyone who finishes it). However an arc ends, at its
finale or at a choice that ends it, it changes one station for good (§14.7).

### 14.3 Finales in flight

Rules in `src/content/dens/rules.ts`.

- **Convoy**: the ships set off together alongside the player and wait when left behind; ambushes
  come in waves as the leading ship passes a fifth of the route and three quarters of it. Two of
  the three must arrive; losing more fails the convoy. A convoy for another system keeps with the
  player and jumps with them like any escort across jumps (§10.2), and raiders wait for it at the
  beacon on the way.
- **Den assault**: three gun turrets (240 hull, 90 shield, 1.5 km range) stand around the den, and
  the reactor pod on its far side (900 hull) is shielded while any turret stands. Two raiders defend
  it, and a wing of three Transit Authority fighters flies with the player, keeping station off
  their wing and going for raiders and turrets near them. Turrets destroyed stay destroyed if the
  player leaves and comes back.
- **A den knocked out** goes dark for six hours of game clock: it is shown wrecked, sends no raider
  packs and cannot be docked at, even by friends of the Wake. Then it is rebuilt.
- **Den defence**: a sweep of lawful ships comes from the jump beacon in two waves (one ship more
  than must be downed), the second when the first is down to one ship. Two of the den's crews fly
  with the player. The sweep's ships attack the player on sight, so the player's guns hit them
  without selecting them; each one destroyed is still a crime (§12.1).

### 14.4 Story guardrails

`validateStory` (`src/economy/storyGuards.ts`, run in `tests/unit/story.test.ts`, which also feeds
it broken arcs to prove it catches them) checks that:

- each arc has four to six steps in a chain, ending in a finale (one for each way a branching
  choice can go, each way following its own branch), every arc but the Wake's after the opening
  delivery;
- every speaker exists and gives missions where they are; every place is a real, open station in
  the system named, within four jumps of where the mission is given; lawful arcs never dock at a
  raider den; den fights are finales at dens;
- choices offer two or three options, each changing standing (by at most 50) and paying sensibly;
  at least one option goes on and is open to every pilot, the next step follows exactly the
  options that go on, every option has its own words wherever later words depend on it, and
  every echo answers a real question of another arc;
- lawful arcs never ask for a crime (piracy, a den defence, contraband); the Wake's arc starts only
  for pilots it trusts; an arc of nobody's asks for one only on the branch of a choice only the
  Wake's friends can make;
- missions pay 300–6,000 cr (decisions pay through their options) and each finale pays the most in
  its arc; escorts fly real catalogue ships and convoys can be brought home;
- every briefing, line and objective has words, within length limits.

### 14.5 Writing for the story

- The people, their stations and what happens to them are fiction and marked so; the stars and
  planets they live around are real and are never given invented properties (a story may send
  the player to scan a planet, never tell them something about it the catalogues do not).
- Short plain lines: a briefing under 520 characters, a line under 300. British spelling. The giver
  speaks the briefing; scene lines are in the third person.
- No real people, organisations or other games' names, places or plots.

### 14.6 First Harvest

The frontier's own story, nobody's faction's, out past the core at HD 219134 (a real star with
seven catalogued planets, three of them contested), where Harrow Farmstead, a farm colony, is
bringing in its first harvest. It is given after the opening delivery and asks no standing.

| Step | Giver | What |
| --- | --- | --- |
| 1. The far farms | Ines Halloway, keeper of Squall Relay (EV Lacertae, at the core's edge) | dock at Harrow Farmstead, one jump out; the briefing says a long-range jump drive is needed |
| 2. Dead in the water | Orla Fenwick, steward of Harrow Farmstead | four ship components (handed over on acceptance) to the Wrenna, adrift in Achird far from any dock with a scavenger watching her, then back to Harrow |
| 3. Readings | Fenwick | scan HD 219134 d (confirmed) and f (contested), and take the readings to Curlew Institute; the Institute says f stays as the archives have it |
| 4. Where it goes | Fenwick | the choice: sell the harvest at Doppler Freeport (Achird), or feed the crews at Squall Relay who passed on Harrow's calls |
| 5. The harvest run | Fenwick | the finale: a convoy of three haulers (two must arrive) across one jump, to Doppler Freeport or to Squall Relay, raiders at the beacon and a wave on the way in |

- **Honest about the sky**: the readings of HD 219134 f settle nothing (§1): the planet stays
  contested, with what each archive says, and the words say so.
- Its finale earns a milestone, and its ending changes Harrow Farmstead for good (§14.7).

### 14.7 Lasting marks

A story's ending can change a station for good (`src/content/story/marks.ts`), and so can a
border front settled for good (§20.7). A finale leaves its mark (`leaves`), or one for each answer
to the choice it follows (`variant.leaves`), and an answer that ends its arc early can leave one
too (the option's `leaves`). When such a finale is done, such an answer given, or a front settled,
the mark is written to the save's world log (§17.5), once. From then on:

- **its market** moves as under a world event that never ends: the goods concerned have their
  price and normal stock multiplied, on top of any event there (§11);
- **its job board** posts a standing run in every time slot, after the rest of the board (which is
  as it was): the station's own produce to one place, paid a premium on the usual freight (a mark
  may have no run: a den has no board, and a back door posts no contracts);
- **the news** within two jumps says so, for good.

First Harvest's two endings each leave one on Harrow Farmstead (fiction):

| Ending | Market | Standing run |
| --- | --- | --- |
| Sold at Doppler Freeport: machinery for new fields and a second hauler | food and fine food: price ×0.85, stock ×1.6 | Harvest run: fine food to Doppler Freeport (Achird), usual pay |
| Fed to Squall Relay's crews, who answer Harrow's calls first | medicine: price ×0.85, stock ×1.6 | The relay's share: staple food to Squall Relay (EV Lacertae), pay ×1.25 |

The three faction arcs leave one for each way they can end (fiction): at the finale, after the
answer that led to it, or at an answer that ends the arc.

| Arc and ending | Station | Market | Standing run |
| --- | --- | --- | --- |
| Clean Manifests: the evidence to the Frontier press, then Maw Roost | Deimos Depot (Sol): open manifests | food and water: price ×0.9, stock ×1.5 | Open manifests: machinery to Eridani Mining Hub, pay ×1.15 |
| Clean Manifests: kept inside the Authority, then Maw Roost | Halcyon Ring (Sol): clean supply lines | medicine and fabricators: price ×0.9, stock ×1.4 | Audited supply: medicine to Barnard Transit Relay, pay ×1.15 |
| Clean Manifests: sold back to Vail (the arc ends) | Deimos Depot: the back door | weapons: price ×0.8, stock ×1.6 | none |
| The Stonecrop Blight: the Gardens sealed, then the relief convoy | Dawnfield Institute (Procyon): the blight cure | medicine: price ×0.85, stock ×1.6 | Ansari's cure: medicine to Horizon Platform (Sirius), pay ×1.1 |
| The Stonecrop Blight: burnt and reseeded, then the relief convoy | Stonecrop Gardens (Procyon): new bays | food and fine food: price ×0.85, stock ×1.6 | Clean-seed harvest: food to Meridian Outpost (Alpha Centauri), pay ×1.1 |
| Salt's Crew: Salt told everything, then the sweep broken | Pinball Freeport (70 Ophiuchi): the crews trade there | salvage: price ×0.8, stock ×1.6 | Nest salvage: salvage to Velvet Stillworks, pay ×1.1 |
| Salt's Crew: Juno Fiske warned, then the sweep broken | Sandbar Bazaar (DX Cancri): Juno's yard | salvage: price ×0.85, stock ×1.5 | Juno's salvage: salvage to Moss Smelter (Ross 614), pay ×1.1 |
| Salt's Crew: the Nest sold to the Authority (the arc ends) | Pinball Freeport: the Nest's trade dries up | salvage and weapons: price ×1.15, stock ×0.7 | none |

Guardrails (`validateMarks`, `src/economy/storyGuards.ts`, run in `tests/unit/story.test.ts` and
`tests/unit/border.test.ts`): a mark changes an open station (or a den) with a market, only goods it
trades, with price ×0.7–1.2 and stock ×0.6–2; a run needs a job board, and carries the station's
own produce to another open station within freight reach that takes it, at a premium of ×1–1.5;
marks on one station never touch the same goods, unless only one of them can be left (they answer
one front with different endings, or follow different answers to one choice); a story mark is left
by exactly one finale or ending answer, only those leave them, and a finale's marks follow answers
that lead to it; a front's marks name real fronts.

## 15. Combat depth

What a fight is made of beyond guns and shields (`src/content/combat/rules.ts`, the phrase pools in
`src/content/combat/chatter.ts`, the economy side in `src/economy/combat.ts`). The numbers are game
balance; every name is invented.

### 15.1 Seekers, decoys and mines

- **Seekers**: raiders flying heavy fighters, aces and bounty hunters fire a seeker at the player
  every 16–26 seconds (the first after 6–12) when the player is 450–1,700 m away and roughly ahead
  of them: 24 damage (scaled by the difficulty setting), 330 m/s, a turn rate the player can
  out-turn, nine seconds of fuel. The HUD warns of seekers inbound and the screen's edges pulse.
- **Decoy flares** (C, or the Decoy button): each seeker homing on the player within 2.2 km goes
  for the flare with a chance of 80%; a flare burns for four seconds. New ships carry two; the
  outfitter sells them (45 cr, six at most).
- **Mines**: a raider breaking off drops one half of the time; three guard each den's reactor.
  A mine arms after two seconds, goes off when any ship comes within 90 m, and hurts every ship
  within 150 m (55 damage at the centre, less at the edge). One or two bolts set it off.

### 15.2 Damage to systems

- A hull hit may damage one of the player's systems (a chance of 1.2% per point of hull damage, at
  most 60% a hit), by 30–60% at a time up to 100%. At full damage the engines lose 40% of their
  speed, the guns half their rate of fire, and the shield generator 70% of its recharge and 40% of
  its capacity.
- A repair kit patches every system up (and restores 40 hull); a dock with repairs fixes them for
  180 cr per whole system, standing discounts applied. The HUD lists damaged systems. An engineer
  aboard mends them in flight down to 20%, and a hit to a system may hurt whoever of the crew works
  it (§30).

### 15.3 Loot

- Raiders drop salvage credits as before; a third of them also drop a cargo pod (salvage, small
  arms, combat stims, ship components or electronics, 2–5 units) and a few an **equipment crate**
  (4%, 8% or 14% by the raider's threat; aces always): a catalogue item within a class of the
  raider's own.
- Crates go into a stash of four aboard the ship (with no room, the crate is sold on the spot at the
  dealer's price). An outfitter with an equipment dealer fits a stashed item (selling what it
  replaces) or buys it.

### 15.4 Wingmen for hire

- Military bases (two pilots), trade ports, free ports, shipyards and Sol's two stations (one each)
  have pilots looking for work, the same for everyone in a time slot, flying their faction's patrol
  fighters. A steady hand costs 180 cr a jump in a Mk I fighter and 320 cr in a Mk II; a sharp shot
  a quarter more, and hits harder.
- Hiring costs the first fee; every jump pays the wing. At most two fly at once. They launch with the
  player, keep station off the player's wing (catching up after a lane), and go for raiders near the
  player that are not sparing them. Nobody flies with a pilot the law is hunting. Their orders, grades,
  trust, pay and hurts are §34's: none is lost for good.

### 15.5 Raider dens under fire

- Every den defends itself: when a pilot the Wake does not trust comes within 3 km, three turrets,
  the reactor behind them (shielded while a turret stands) and three mines wake up, with two raiders
  of the den's crews (§14.3 has the numbers). Aces and bounty packs that lurk by a den wait 3.6 km
  out from it, clear of its guns, so hunting them does not wake it.
- Knocking a den out on your own pays: 150 cr a turret, and 2,500 cr from the lawful faction nearest
  the den with 8 standing; the Wake takes 15 off. The den is dark for six hours of game clock: no
  packs in its system, closed to everyone. Station news within two jumps reports it, and arriving in
  its system says so.
- **Den assaults**: customs depots, military bases and Deimos Depot post them against dens within
  three jumps (about 2,400 cr and the route's fees, top difficulty, a Hardened combat rating, and
  never against a den already dark); a wing of three of the poster's fighters flies with the player.
  The contract guardrails check them (§10.4).

### 15.6 The feel of a fight

- Hull hits flash the screen's edges red and shield hits blue (gentler with reduced motion); badly
  hurt ships still show their sparks.
- Radio chatter: raiders spotting the player, breaking off or losing one of theirs, patrols
  engaging raiders, a den warning an untrusted pilot off, a wingman joining, scoring a kill or
  taking fire; only from ships within 4 km of the player, at most one line every seven seconds,
  from small phrase pools.

## 16. People and information

Who sits in a station's bar, what they know, and what the player does with it
(`src/economy/people.ts`, `src/economy/tradeComputer.ts` and `src/economy/trade.ts`; rules in
`src/content/people/rules.ts`, words in `src/content/people/lines.ts`). The People window is in
every bar (`src/ui/station/people.ts`) and the trade computer on every dock's menu rail
(`src/ui/station/computer.ts`). The rules decide every fact; the phrase pools only vary the wording.
Nothing runs in the background: who sits where and what they know is worked out from the clock and
the save when the player asks.

### 16.1 Who sits in the bar

- **Story characters** (§14) sit in their own bars. Sitting down with one gives a line from where
  their arc stands: work on offer (with a button to the job), the work in hand, what they are
  waiting for, or how it ended.
- **Regulars**: two or three a bar, drawn from a fixed seed, the station and the shift, so every
  player meets the same people at the same clock. A shift is two job-board time slots (50 minutes of
  game clock); then new people take the seats. The station type sets who is likely to sit there (a
  role listed twice is twice as likely):

  | Station | Regulars drawn from |
  | --- | --- |
  | Trade port | trader (twice), fixer, colonist |
  | Customs depot | officer, trader, fixer |
  | Shipyard | pilot, trader, miner |
  | Mining outpost | miner (twice), trader |
  | Refinery | miner, trader, colonist |
  | Factory | trader, colonist, miner |
  | Agri station (farm) | colonist (twice), trader |
  | Research station | scientist (twice), trader |
  | Relay | pilot, trader, officer |
  | Military base | officer (twice), pilot |
  | Free port | fixer (twice), trader, pilot |
  | Raider den | fixer (twice), pilot |

  The hand-made stations' bars are like the type closest to them: Halcyon Ring and Eridani Mining
  Hub are trade ports, Deimos Depot a customs depot, Meridian Outpost and Horizon Platform research
  stations, Barnard Transit Relay a relay.
- A regular has a name from invented pools, a title for the role ("Freight broker", "Rig
  foreman"), a greeting and an age. Officers, miners and scientists belong to the station's owner;
  traders, pilots, fixers and colonists are independents two times in five.
- **Pilots for hire** (§15.4) sit at the tables too while the station gives the player full service.
  The People window hires them, and lists the wing already on the player's pay with a way to
  dismiss each.
- **Faces** (`src/ui/portraits.ts`): everyone has a small SVG portrait, a pure function of a seed
  and a look. The faction sets the clothes, palette and insignia; the role the kit (a pilot's
  headset, a miner's goggles or visor, an officer's collar tabs, a trader's or scientist's data
  slate, a fixer's hood); age greys the hair and lines the face; the seed decides the rest. The
  story characters have faces chosen for them (`STORY_PORTRAITS`), and a regular's seed is moved
  clear of theirs (`src/ui/station/personPortrait.ts`), so no regular wears a story face.

### 16.2 Rumours

- **A round** for the table costs 30 cr and buys one thing the person knows this shift. With nothing
  worth telling, the round is on the house; a person who has told this shift's thing says so and
  charges nothing; a round needs 30 cr in hand. Story characters sell no rumours.
- **What people know**, within two jumps of the bar unless noted:
  - **price**: the best sale within reach for a good the bar's own dock sells, or a bargain (a dock
    selling a good at 80% or less of its usual price). It is only told when a full hold of the
    player's ship on it is worth at least four rounds (120 cr). The price goes into what the player
    knows, as heard, for the trade computer to use.
  - **event**: a world event (§11) that starts within the next 45 minutes: news before it is news.
  - **den**: the nearest raider den within three jumps, with its guns awake or how long it has been
    dark (§15.5).
  - **ace** and **wreck**: an ace hunt or a recovery posted on this board or one within reach:
    where it is, who pays, and the reward (an ace) or the item still aboard (a wreck).
  - **story**: a story mission waiting for the player, anywhere, and where to go.
  - **front**: how a border front within reach stands, and where its tide takes it in the next four
    hours when that is a different phase (§20).
- **Talk order**: each role has its subjects in order. A person starts at a place in the list set by
  their seed and goes round it, and tells the first subject with something true to tell. Officers
  list the front first and pilots last.

  | Role | Subjects |
  | --- | --- |
  | Trader | price, event, wreck |
  | Pilot | den, ace, event, front |
  | Fixer | ace, story, wreck, price |
  | Officer | front, den, event, ace |
  | Miner | event, price, wreck |
  | Scientist | event, story, price |
  | Colonist | event, price, story |

- **Rumours are true.** Every rumour is read from the game's own state at the moment it is told
  (live prices, the event schedule, the dens, the posted boards, the story, the fronts) and its
  numbers are printed from that state. Nothing is invented.
- The journal keeps the last 12 things heard, newest first, with the bar and when. Save version 9
  adds what was heard and the price watch (`GameState.rumours`, `GameState.priceWatch`).

### 16.3 The price watch

- Up to six prices can be watched: a good at a station, from the buy dialog at a trader (*Watch
  this price*) or from a route's destination in the trade computer.
- Docking within two jumps of a watched station brings its price up to date (the station docked at
  is recorded by the visit itself). A move of 5% or more in what it pays or asks is reported as a
  toast.
- Word of one good, heard or watched, keeps its own time, so the rest of what the player knows
  about that market keeps its age. The trade computer lists the watched prices with how and when
  each was had (seen, briefed, heard or watched), and stops a watch.

### 16.4 The trade computer

- It knows only prices the player has had: seen at a dock (docking records the whole market), read
  in a briefing, heard in a bar or relayed by the watch. Never the hidden market. The price where
  the player is docked is the live one.
- A route buys a good at one known market and sells it at another that pays more. The load is a
  full hold, as far as the credits in hand pay for it. The fees are the jump fees from the buyer to
  the seller, plus from here to the buyer when the route starts elsewhere. The time is the expected
  trip (§10.2: 45 s out, 165 s a jump with lane transit, 30 s in) from the buyer to the seller, plus
  the trip to the buyer, in whole minutes (at least one). Profit is the load times the margin, less
  the fees; only profitable routes are listed, by profit per minute and then profit, eight at most.
- When docked at a market it shows routes from anywhere known, or only those that buy here; the
  trader window shows the best four that buy here, with a button for the rest.
- Each route shows both prices with their age (*live* where the player is docked), the load, the
  fees, the profit, the minutes and the credits a minute; a risk tag from the lower security of its
  two ends (*Patrolled*, *Thin patrols* below 0.6, *Lawless* below 0.35); and news within the
  player's reach that bears on it (an event moving the good at either end, a raid in either end's
  system). A route whose older price is more than an hour old (game clock) is dimmed and marked
  *Old prices*. A *Watch* button on each route watches its destination's price.

### 16.5 Small conveniences

- **The job board** filters (all, hauling, combat, other) and sorts (as posted, by reward, by reward
  per jump) once it lists more than three jobs; the choice lasts the session.
- **Payment**: when a contract pays, the poster's dispatcher confirms it on the radio, in words that
  fit the poster's faction (story missions have their own words).
- **Where you left off**: after the opening, docking with nothing more pressing opens the room and
  window last open at that station (kept on the device, not in the save).
- **Wing orders**: V (or the Wing chip on touch, or Back held on a pad) opens the wing's order card,
  paused; the six orders are §34's. The wing acknowledges on the radio.

### 16.6 People guardrails

`tests/unit/people.test.ts` checks that:

- every open bar seats two or three regulars, the same when drawn again at the same clock, with
  roles from its station type's list, two-word names and real greetings; a trade port's regulars
  change with the shift;
- every story character sits in their own bar, and a military base has pilots for hire;
- rumours are true: at three moments of the clock, everything every regular in every bar would say
  has its words filled in; a price names the station, the good and one of that good's live prices
  there; an event is one that starts within 45 minutes; a den is a real raider den; an ace or a
  wreck names a real station; more than twenty things are told in all;
- every price tip is worth at least four rounds for a full hold;
- a round is charged once and puts the live price in what the player knows and the tip in the
  journal; a second round that shift is refused at no cost, and a round with nothing to tell costs
  nothing;
- the trade computer knows nothing it has not been told: a new game has no route, even docked in
  Sol. From twelve markets seen ten minutes apart it ranks routes by profit per minute, with the
  prices the player saw, fees at least the jump fees between the ends, times at least the expected
  trip, and profit equal to the load's margin less the fees; docked, routes that buy here start at
  the live price;
- a watched price at a Sol station, moved by a big sale there, comes up to date with one report
  when the player docks at Halcyon Ring, and not when docking more than 12 ly from Sol; a seventh
  watch is refused;
- a version 8 save gets an empty watch and nothing heard; a watch on an unknown station or a rumour
  of an unknown kind is rejected.

`tests/unit/portraits.test.ts` holds the portraits to a pure function of seed and look: a different
face for each seed, the same face whatever the clothes, well-formed SVG under 10,000 characters for
every faction, role and age, the kit each role wears, grey hair and lines with age, and the six
story characters' faces with the traits that make them. `tests/e2e/people.spec.ts` buys rounds in
Halcyon Ring's bar until someone tells something, finds it in the journal, and watches a price at
the trader that then shows in the trade computer.

## 17. A world that answers

The world keeps what the player does to it (`src/economy/answers.ts`, `src/economy/markets.ts`,
`src/economy/law.ts`; rules in `EVENTS.react` in `src/content/events/rules.ts`, `ECONOMY.spill` in
`src/content/economy/rules.ts`, `LAW.witness` and `LAW.lapse` in `src/content/law/rules.ts`, and
`TRAFFIC.linger` in `src/world/traffic/plan.ts`). Events, markets and traffic are still worked out
from the seed and the game clock (§8, §9, §11). What the player changes is written to the save's
world log (§17.5) and read back from it, so another save's world is untouched.

### 17.1 Shortages relieved and raids broken

- **Relief**: every unit the player sells into a shortage (§11.1) while it lasts counts toward its
  relief. A shortage leaves the station short of 40% of its normal stock of the good; once the
  player has sold 60% of that shortfall (`EVENTS.react.relief`), the shortage ends at once. The
  station pays a relief bonus on top of the sales, 25% of the base value of every unit sold into
  it (`reliefBonus`), and standing with its owner rises by 3.
- **A raid broken**: every raider the player destroys for a bounty in a raided system counts. At
  three plus the raid's threat level (`raidKills`) the raid ends at once, and standing with the
  system's lawful owner rises by 3 (none in unclaimed space).
- A toast says so, and the news within reach reports the event as relieved or broken by a pilot,
  and how long ago (§11.3). Markets and the traffic plan follow the new end, and an event ended
  early cannot be ended again.

### 17.2 Goods on the move

- As a station's stock recovers from what the player (or one of the player's captains, §18) left it
  at, a share of the difference (`ECONOMY.spill.share`, a half) drifts along the lanes to the other
  stations that trade the good in its system and the systems one jump away (`spill.jumps`), split
  evenly between them. It rises to a peak one recovery time (30 minutes of game clock) after the
  trade and fades after that.
- A glut the player sells into one dock therefore fills its neighbours a little and lowers their
  prices; a dock the player drains draws stock from its neighbours, and their prices rise too.
- Nothing more is saved for it: the drift is worked out from the moved stock already in the save
  (§8.2) and the clock, and added to each neighbour's own stock (never below zero).

### 17.3 Encounters that persist

- When the player leaves a system or docks, raider packs that saw the player are remembered with
  their threat level, the ships left and where they were, and so are pods still adrift (salvage,
  cargo or an equipment crate; at most eight). A bounty contract's pack, an ace, bounty hunters, a
  den's turrets and reactor, and the scripted opening raid are not.
- Back in flight there within 30 minutes of game clock (`TRAFFIC.linger`), the packs are where they
  were and hunting again, the pods where they were left, and the HUD warns that raiders who saw the
  player last time are still hunting there. Later than that, the record is dropped.
- The save keeps such records for at most six systems; the oldest goes first.

### 17.4 Witnesses, and fines that lapse

- A crime (§12.1) is known where it was seen: the fine is booked with the system and the time, and
  the news travels one jump every 10 minutes of game clock (`LAW.witness.perJump`). A faction's
  patrols and stations act on the fines they know of where they are: a pilot is hunted there, and
  gets emergency docking only, once the news has arrived. The HUD shows *Wanted* with the fines
  known here, or that news of a crime is spreading.
- Once the news has reached every system, the fine goes on the record (settled on docking and after
  every jump). A pardon (§12.1) settles everything booked, known everywhere yet or not.
- **Lapse**: after three hours of game clock without a new crime against a faction (`LAW.lapse`),
  every fine owed to it lapses, and a toast says so. Never while the pilot is Hostile with it.

### 17.5 The world log

`GameState.world` (save version 10) holds the player's mark on the world:

- `relief`: units sold into each shortage; `raidKills`: raiders downed in each raid;
- `ended`: the events the player ended early, with the time;
- `lingering`: what is still out there, by system (§17.3);
- `border`: the player's deeds on each border front, and how The Long Border ended there (§20);
- `marks`: the lasting marks a story's ending or a settled front left on a station, with the time (§14.7, §20.7; optional,
  so a save from before them simply has none);
- `hauls`: what became of the haulers the player saw (§21.4), kept three hours (optional too).

The event engine reads the log of the save being played (`useWorldLog`), so events stay a pure
function of the clock except for the endings and marks recorded there. `tidyWorldLog` runs at every docking:
endings over a day old are forgotten, and the relief and raid tallies keep their 40 newest events.
The crimes whose news is still travelling, and each faction's last crime, are in `GameState.law`
(§17.4). A version 9 save keeps its fines on record, counts them as committed at its own clock for
the lapse, and starts with an empty world log.

### 17.6 Guardrails

`tests/unit/answers.test.ts` checks that:

- a shortage one unit short of its relief share runs on; the next unit ends it, pays exactly the
  bonus and raises standing with the owner, and the news shows it over and ended early; without the
  save's world log, the same event runs its course;
- a raid runs on until exactly three plus its threat level raiders are down, then breaks;
- 300 units of water left at one dock drift into a neighbour: nothing at first, more at one
  recovery time than at a fifth of one or at four, and less than 1% of the load after twelve;
- a crime in Sol is owed in Sol at once but not two jumps away, where a lawful station still gives
  full service; twenty minutes later it is owed there and that station gives emergency docking
  only; the news reaches everywhere well before a fine could lapse, and settling then puts it on
  the record;
- fines lapse after exactly three quiet hours, not a second sooner, and never for a Hostile pilot;
- a version 9 save keeps its fines and gets an empty world log; a lingering record for an unknown
  system, or a travelling crime with a bad time, is rejected;
- in a real `FlightSession` (in node, without rendering), a pack of two that saw the player and a
  pod adrift are remembered, and flying in again brings back both raiders within a kilometre of
  where they were, and the pod.

`tests/unit/law.test.ts` checks that a fine is on the record at once and owed where the crime was
seen, and `tests/unit/market.test.ts` that moved stock recovers with its 30-minute time constant.

## 18. A fleet of your own

Something to build after the biggest ship: more ships, captains to fly them, a hold at a station and
a share in its trade (`src/economy/fleet.ts`; rules in `src/content/fleet/rules.ts`; the Fleet
window on every dock's deck, `src/ui/station/fleet.ts`). Nothing runs in the background: the fleet
is worked out from the game clock when the player docks, jumps or loads a save, and in flight as
its steps fall due, the same on every device. The captains' runs fly the lanes where the player can
meet them (§18.6).

### 18.1 The hangar

- **Buy and keep**: the shipyard's purchase dialog offers the trade-in as before, or the full price
  with the ship you fly parked at that station as it is: its fittings, rounds, repair kits, decoys
  and damage. Your cargo moves across when it fits the new hold (otherwise it stays aboard the
  parked ship). You can own four ships besides the one you fly, and a second of the model you fly.
- **Switch** at any station where one of your ships is parked: the ship you flew is parked in its
  place. Each ship keeps its own hold and gear; the one you take has its shields charged, and the
  save checks it like any flown ship. Ships are only ever parked where you bought them or where a
  captain brought them home.
- **Sell** a parked ship at a shipyard for the trade-in the yard pays for the ship you fly (70% of
  the hull and fittings, less repairs), once its hold is empty.

### 18.2 Haulers

- **Hiring**: a parked ship with an empty hold gets a captain (a name from the bars' pools, seeded
  by the ship and the clock) and a route: from the station where it is parked, which is where you
  hire, to a dock **you have docked at yourself**, with prices you know there (the captain flies on
  your charts and your contacts, so a route you have never seen cannot be handed over). The cargo
  is one lawful good (no contraband, no small arms) sold at the home dock and bought at the other
  end; raider dens are never on a route. The dialog shows each good's run at the live price at home
  and the last price you had at the far end, sliding as the load is sold (the slide at the far
  end's normal stock): the goods, the sale, jump fees both ways, the captain's cut, the time and the
  risk. No captain takes a run that pays under 50 cr.
- **A run**, on the game clock: 180 s loading, then 1.5 × the expected trip (45 s out, 165 s a
  jump by the fewest lanes, 30 s in) each way: about 7 minutes in a system, 15 for one jump, 23 for
  two. (Runs from the core into the frontier once took for ever: the count the contract boards use
  never sends a core pilot there. A captain's run counts the lanes it flies, so it gets in.) It buys 90%
  of the ship's hold (as much as the stock allows) at the home dock's price when it sets out and
  sells at the far end's price when it arrives, both at the list price without your standing.
  Everything the run needs is paid when it sets out: the goods, the jump fees there and back, and
  the captain's 40 cr. On arrival the captain takes 30% of the run's profit (sale less those
  costs, nothing on a loss), and insurance 8% of it; the rest is yours.
- **Stock moves**: every purchase drains the home dock's stock and every sale fills the far end's,
  in time order (`moveStock`), exactly as your own trades do, and the neighbours feel it through the
  spill of §17. A route worked hard flattens: the price at home climbs and the price at the far end
  falls, and the captain waits for them to recover. Hauled sales do not relieve shortages, count
  toward the trade rating or go in the ledger (the voyage report counts your own flying).
- **Waiting**: when it is time to load, the captain prices the run with the real prices at both
  ends. A run that would pay under 50 cr after every cut is refused, and one you cannot pay for
  waits too; the captain looks again every 15 minutes. A wait for credits is reported at once, a
  wait for prices once it has lasted an hour (a route worked hard often needs a look or two), and
  each wait only once. Credits never go below zero.
- **Raids**: each run meets raiders with a chance set by the route's worst security (every system
  on the shortest route): 8% lawless (below 0.35), 3% thin (below 0.6), 0.8% patrolled; one level
  worse while a raid (§11) is under way in a system on the route when it sets out. They strike on
  the way out, at one place and time (§18.6), and take the cargo there; a quarter of the time they
  destroy the ship too (the captain escapes). A run robbed on the way flies on to the far end empty,
  sells nothing and comes home. Insured, a ship lost to raiders pays back 60% of its model's price
  (one the player's own guns destroy pays nothing). The luck of each run is drawn from a stream
  keyed by the save's seed, the ship, the hire and the run.
- **Recall**: a captain at home parks the ship at once; one on a run finishes it, flies home and
  parks. Insurance can be taken or dropped at any time (it counts when a run arrives).
- **Reports**: every sale, raid, lost ship, reported wait and captain signing off is a report with
  its game-clock time (a raid or a lost ship says in which system); the save keeps the newest 20.
  Docking, a jump, loading or a step in flight shows the new ones as toasts: a lost ship always, two
  or fewer as they are, more as one summary line, and the dividends paid. The Fleet window says where
  each captain is now (*now in Wolf 1061*, or *in a jump*), so the player can go and meet them.

### 18.3 Storage and stakes

- **Storage**: a 60-unit hold at a station, leased once for 400 cr and kept. While docked there,
  cargo moves between your ship and the hold (item sizes count, as in a ship's hold).
- **Stakes**: 1–10% of a station's trade, at most five stations, bought where you are docked, by the
  per-cent: a trade port 900 cr for each 1%, a shipyard 1,000, a factory 800, a free port 750, a
  refinery 700, a research station 650, a customs depot 600, an agri-station 550, a mining outpost
  500, a relay 400; military bases and raider dens sell none (the hand-made stations count as the
  type they are closest to, as their bars do, §16). A stake pays 1.2% of its price an hour of game
  time, whole hours from the purchase, each hour moved by the station's fortunes at its middle: a
  boom × 1.5, a glut × 0.9, a shortage × 0.7, a strike × 0.4, and a raid in its system × 0.6 (a
  sweep × 1). 10% of a trade port (9,000 cr) pays 108 cr an hour in quiet times. The station buys a
  stake back at 85% of its price, from any dock. Buying more of a stake, or selling it, first pays
  the part of the hour under way at the stake as it was, and its hours start again from then. Stakes and leases go in the ledger (`fleet`), and
  the voyage report shows them.

### 18.4 Settling from the clock

`settleFleet` works out everything due since the last settle, up to the clock: every hauler step
(set out, raiders striking, arrive, get home) and every hour of dividends, merged in time order, so
a dividend can pay for the next load and one hauler's purchase can raise the next one's price. It
runs when the player docks, jumps or loads, and once a second in flight (cheap when nothing is
due), so the fleet's news comes as it happens. Each step depends only
on the save and its own time, so settling once, twice or every few minutes comes out the same
(tested), and so does every device. Docking settles the fleet before the prices seen there are
recorded, so they include what its haulers bought and sold. A save left very long works out at most
300 looks at the route a hauler at once (every run begins with one, and a waiting captain looks every
15 minutes; after that the captain rests until the clock) and pays stakes' hours older than 30 days
at the plain rate in one sum, so a settle never loops for long.

### 18.5 Fleet guardrails

- **A hauler earns well below flying yourself.** A run takes 3.5–5.4 times the trip the trade
  computer counts for you (both ways, at 1.5 × the time, plus loading), carries 90% of the hold, gives up
  30% of its profit, 40 cr and both ways' fees, and flattens its own route. On the best route from
  every dock with a shipyard, a Petrel hauler earns 1–5% of the trade computer's estimate for flying
  the route yourself (about 600–4,000 cr an hour of game time); the unit tests hold every one of
  them under a fifth.
- **Losses are bounded and can be insured.** The worst a run can do is lose what it set out with
  (the goods, the fees and the captain's fee, all paid up front, so never more than the player had)
  and one ship; insurance pays back 60% of the ship's price. The tests find a run that loses both
  and check the books, with and without insurance.
- **Nothing runs in the background**: see §18.4. The fleet in the save is checked in full: owned
  ships like the flown one, at most four, a hauler's route starting where its ship is parked (and a
  record of a run seen safely past its raid naming a real system), storage within 60 units, stakes
  of 1–10% at no more than five stations, reports of known kinds.
- **The lanes add up**: `validateFleetLanes` (`src/economy/fleetGuards.ts`, run in
  `tests/unit/captains.test.ts` over every route from a dock a captain loads at to every other within
  two jumps, and from Halcyon Ring to every dock in reach, the frontier's long routes among them)
  checks that every run takes a finite time; that its way runs through the route's systems along
  real lanes, out and home again, in legs of the right kinds and in order with a jump between, from
  the end of loading for the run's time each way; that its raid strikes in a system of the way out,
  at the middle of its leg there, where the rules say; and that the rules make sense (ambush levels
  1–3, chances 0–1). Broken ways (a leg out of time, a system off the route, home not the way back)
  and raids in the wrong place or at the wrong time are caught.

### 18.6 Your captains on the lanes

The captains' runs fly the same lanes as the timetable's haulers (§21), and the player can meet
them on the way, guard them through a raid, or lose them to one. Rules in `FLEET.lanes` and
`FLEET.risk`; the run's way and its raid are worked out in `src/economy/fleet.ts` (`runWay`,
`runRaid`, `captainsIn`), and `FlightSession` flies them.

- **The way** (`runWay`): a run flies its route's systems (the shortest route, the one its risk is
  reckoned on) in legs like a timetable haul's: out of the dock to the jump beacon, across each
  system on the way, in from the jump to the dock, with a jump between (between two docks of one
  system, one leg), scaled so the whole way takes the run's time each way. The way out starts when
  the loading is done; the way home is the same systems in reverse. A run's way depends only on its
  route and when it began loading, so it is the same on every device.
- **Where raiders strike** (`runRaid`): a run its luck sends raiders against (§18.2, the same runs
  as ever) meets them on the way out, in the first system of its way with a raid (§11) under way
  when it set out, otherwise in the least secure (the first, on ties), at the middle of the run's
  leg there. Out of sight, the cargo is lost then (and a quarter of the time the ship), and the
  report says where.
- **In flight** (§9): the player's own haulers flying in the player's system show with the
  timetable's (and whatever the traffic plan's cap): those under way when the scene starts,
  wherever they are along their leg, then each as its leg begins, never popping in near the player,
  and one ship once (one still flying behind its run's schedule comes in before its next leg).
  Each is named as the player's (*Your Halden Petrel*), with its captain, cargo and where it is
  bound (*Captain Ada Moss · 18 electronics for Deimos Depot*; *flying home to …, empty*; *robbed,
  flying on to … empty*), flies the player's ship as it is fitted, and is marked as the player's on
  the HUD: a green double square, always shown (at the screen's edge when off it), *■ Yours* in the
  target box, and in the target cycle. Its captain's maydays always reach the player.
- **A raid due in sight is flown**: when a run's raid is due in the player's system while its ship is
  in the scene, raiders jump the captain at that moment (an escort's ambush, §10, of threat level
  `FLEET.lanes.ambush` by how dangerous the route is: 1 patrolled or thin, 2 lawless). The fleet
  holds that run's raid, and the rest of the run, while the ship is in sight (`settleFleet`'s
  `inSight`).
- **Guarded**: every raider of the ambush destroyed, fleeing or gone, or the captain at its dock or
  through the jump beacon with them still on it: the captain says thanks over the radio, and the
  run is marked seen safely past its raid there (`Hauler.sight`, as the world log does for the
  timetable's haulers, §21.4). A captain the player sees to its dock or the beacon before the
  raid's moment has come is marked the same way. The raid does not strike; the run sells as usual.
- **Lost in sight**: destroyed in the player's sight by anyone, the ship is lost there and then
  (`captainLost`), with whatever it still carried and what the run had at stake; half its cargo
  spills in pods the player can scoop up (`HAULS.spill`, as a timetable hauler's does); the captain
  gets away in a pod. Insurance pays for a ship raiders destroyed, not for one the player's own guns
  did. Firing on or destroying your own ship is no crime.
- **Left to it**: if the player leaves (docks, jumps or is towed home) while the ambush is still on,
  the raid takes its course as the run's luck says, at its own time.
- A captain seen anywhere else, or past the middle of a leg with no raid due there, changes
  nothing: the run is decided where its raid strikes.

## 19. Mining

A third career, for pilots who would rather not fight (`src/content/mining/rules.ts`, the economy
side in `src/economy/mining.ts`, in flight `src/world/MiningField.ts`). Belts come only from the
cited belt records, and where they lie in flight is schematic; the rocks, what they hold and the
claims are game fiction, and the numbers are game balance.

### 19.1 Belts in the real sky

- The belts are the records of `src/data/generated/belts.json` (the sky snapshot,
  `scripts/sky-process.ts`): the Solar System's main belt and Kuiper Belt, from NASA's pages with
  their extents (2.2–3.2 au and 30–50 au), and the debris discs of the stars SIMBAD links papers
  about their dust to: Epsilon Eridani, Tau Ceti, Vega, Fomalhaut, Fomalhaut C, GJ 581 and Proxima
  Centauri (in Alpha Centauri). `BELTS` and `beltsOf(systemId)` (`src/data/systems.ts`) keep only
  belts of systems in the game that cite a source.
- In flight each belt is a ring of rock placed schematically; every scene ring names its record
  (`SceneBeltDef.beltId`). Sol's main belt lies between the compressed orbits of Mars and Jupiter
  and its Kuiper Belt beyond Neptune: the au figures only order them, and as circles round the Sun
  they suit the real-date layout. Proxima's dust belt lies beyond the compressed orbit of
  Proxima c, where the lane crosses it in transit. Epsilon Eridani's two drawn rings are its one
  record. A catalogue system's ring lies beyond its host's planets, stations and arrival point,
  with dust, since debris discs are seen by their dust.
- The star map's card and the encyclopedia list each belt: name, kind, note, the extent where the
  source gives one, its sources, and that it is placed schematically. In flight the belt is a
  target at its point nearest the player; scanning it opens the same card.

### 19.2 Rocks

- Each ring is cut into stretches of about 8 km. Within 14 km of the band, the stretch the player
  is over and its nearer neighbour hold four larger rocks each (26–60 m in radius), seeded where
  they sit, so they are the same rocks every time; a stretch stays out while the player is next to
  it. No rock sits within 1.5 km of a station, planet or star (the Eridani Mining Hub lies in its
  belt).
- What a rock holds, by kind of belt (a weight per good drawn per rock, then scaled to add up to
  one): main belt 55–85% metal ore, the rest water ice; Kuiper Belt 50–75% water ice, the rest
  volatile gases; debris discs ore, ice and volatiles mixed. A rock holds 40–110 units of rock.
- A scan (X, or the action button) reads a rock within 4 km (times the scanner's range): its
  shares and what is left of it. Mining an unread rock reads it.
- A rock is spent when its amount is cut, and grows back: each rock's growth turns over every
  45 minutes of game clock, at its own time, with new contents. What has been cut is kept in memory
  between flights (never in the save), so docking and launching again does not refill a rock.

### 19.3 The mining laser

- Outfitters sell mining lasers (Eridani's Pickaxe, Ares's Chisel: 6 units of rock a minute at
  class 1, 8 at class 2, 10 at class 3, summed over the lasers fitted) and prospecting scanners
  (Eridani's Dowser, Toliman's Assayer: ×1.2 at class 1, ×1.3 at class 2; the best one counts).
- With a laser fitted and a rock selected within 600 m of its surface, the Mine action starts the
  beam and the same action stops it: **B** on the keyboard; on touch the action button, which turns
  amber and reads *Mine* only then (*Stop mining* while it cuts); **A** on a gamepad, as the action
  button's action, since every standard button already has a job.
- The beam cuts the lasers' rate of rock; each unit of rock gives the prospector's multiplier in
  goods, in the rock's shares. Each whole unit goes into the hold when it fits, and otherwise out in
  a cargo pod beside the rock (a unit a pod); nothing cut is thrown away. The tractor leaves a pod
  alone while the hold cannot take it, and pods of cut rock left adrift last time still count.
- The beam stops when its target is lost (another one selected), out of reach or spent, when six
  pods are adrift and the hold cannot take one more unit of each of the rock's goods, and on docking
  or entering a lane.
- The beam runs from the ship's nose to the cut, with sparks where it bites and its own grinding
  sound; the HUD shows the laser in the loadout and what the beam has cut.

### 19.4 Selling, and what a miner earns

- Ore, ice and volatiles sell through the normal markets like any cargo, so stock moves and prices
  stay in their bands: refineries want all three, ports, depots and farms want ice or volatiles,
  and free ports trade ore.
- `miningEstimates` works out a round: cut a full hold, fly to the buyer (the contracts' trip
  estimate, plus a minute each way out to the rocks), sell at the market's order price, fly back.
  The starter courier with a class 1 laser makes about 1,300 cr an hour in Sol's main belt (water
  ice at Deimos Depot), 2,700 in the Kuiper Belt (volatiles; less in practice, as the belt is
  further out than a minute's flight) and 3,900 at Tau Ceti (volatiles at Larkspur Stillworks);
  hauling routes near Sol pay it 900–4,500 an hour in their middle half and 28,000 at best. A
  class 1 freighter with a laser and a prospector makes 2,700–7,600 an hour in the core belts,
  where its hauling pays 2,600–14,200 in the middle half and 96,000 at best.

### 19.5 Claims

- Mining outposts, refineries and the Eridani Mining Hub post **claims** on a cited belt within
  three jumps: mine N units of a good the belt yields there (9–18 hold units, a young pilot's hold
  carries it), then deliver them to the station. Pay: the route's fees as for every contract, plus
  160 cr and 200 cr × the belt's danger (both varying a little), plus 2.4 times the goods' base
  price, more than any market pays for the load.
- Every unit the laser cuts of that good in that belt counts (the job's `mined`), for one claim
  only, the claim taken first filled first; once the count is met the load is delivered like
  freight. The star map marks the belt's system, and in flight the belt is the objective, with
  Go to.

### 19.6 Raiders who hunt miners

- Every 30 seconds of beam a pack may come out of the dark for the miner: a chance of 25% in lawless
  belts, 8% in thinly patrolled ones and 1% in patrolled ones; one or two raiders of the system's
  threat (2 in lawless space and 1 elsewhere when the system has no packs of its own). One pack
  comes at a time, and none for a pilot the Wake trusts.

### 19.7 Mining guardrails

`tests/unit/mining.test.ts` checks:

- no belt without a citation: every belt record is of a system in the game, circles one of its
  stars and cites a source; every scene ring names a record of its own system, every record is
  drawn, and a system without one has no ring; extents only from NASA's Solar System pages;
- Sol's belts lie between the right orbits on any date, and stations and arrival points stay clear
  of every ring (the Eridani Mining Hub sits in its inner ring by design);
- rocks are the same on every visit, with shares by kind of belt, and grow back in their own time;
  the beam cuts at the lasers' rate, the same in one step or many; the prospector multiplies the
  yield; a rock is spent after its amount; the hold fills, then the pods, and every unit cut is in
  one or the other; no rock near the Eridani Mining Hub;
- mined goods reach a market only from the hold, and thirty loads into one dock keep every price in
  its band;
- with a class 1 laser the typical core belt pays within the middle half of the hauling routes near
  Sol (the trade computer's estimates), and no belt, even with two class 3 lasers, pays more than
  the best hauling route;
- claims pass the contract guardrails at every station (a cited belt, a good it yields, reach, the
  load and pay above what the load would fetch), count only their belt and good, each unit for one
  claim, and pay on delivery;
- in a real `FlightSession` in node: belts and rocks as targets, the beam's rate into the hold, why
  it stops, the pods, a spent rock growing back, a claim's belt as the objective, and raiders
  coming for a miner in a lawless belt.

`tests/e2e/mining.spec.ts` scans Sol's main belt and mines one of its rocks in the browser.

## 20. The border war

Where a lawful faction's space meets a Hollow Wake den, the two sides fight over the lanes
(`src/economy/border.ts`; rules in `src/content/border/rules.ts`). Like the world events of §11, a
front is a function of the seed and the game clock, plus a short log of what the player did there
(`world.border` in the save, version 10).

### 20.1 Fronts

- A **front** is a lane between a system with a working raider den and a neighbouring system that
  the Transit Authority or the Frontier Cooperative owns. The world has five: the Ross 154 – Wolf
  1061 line (the Authority's, against Maw Roost) and four the Cooperative holds against dens further
  out (two at Lacaille 9352, one at YZ Ceti, one at WISE 0722−0540).
- Each front may have an **exposed station**: the station on the lawful side that can fall. It is
  never a story character's home, and a front gets one only when another dock with repairs stays
  open in the lawful system (WISE 0722−0540 has only its military base, so its front can be
  blockaded but never broken). Regent Concourse is the Ross 154 line's; Waymark Waypoint, Sabine Kettering's home,
  never falls.

### 20.2 Pressure and phases

- **Pressure** runs from −100 (the Wake) to +100 (the law): a tide of 70 × sin(2π (clock / 48 h +
  phase)), each front with its own phase from the seed, plus the player's deeds, each fading with
  a time constant of 24 hours of game clock. The newest 24 deeds of a front are kept.
- **Phases**: pushed back (35 or more), skirmish, blockade (−30 or less), fallen (−60 or less, only
  where there is an exposed station), and truce (only as an ending, §20.5). Left alone, a front
  goes round them all every 48 hours of game time, and its station is held for about eight.
- **Deeds**: a war contract done moves its front 18 its way; a raider destroyed in a front's
  system +2; a lawful patrol or hauler destroyed there −3. A kill counts on every front through the
  system.

### 20.3 How the world feels it

- **Traffic** (`withBorder` in `src/world/traffic/setup.ts`): a skirmish brings a patrol wing and a
  raider pack more (level 2) to both systems; a blockade halves the lawful side's traders and adds
  two packs (level 2, or 3 once the station has fallen); a front pushed back sends a patrol wing
  into the den's system; a truce clears the packs from the lawful side. A raid or a sweep (§11)
  under way comes on top: a sweep clears the border's packs too.
- **A fallen station** is held by the Wake: lawful pilots get emergency docking only (repairs and
  the customs desk, §12), friends of the Wake dock as usual, and it posts no contracts.
- **Battles in sight** (§35): clashes off the jump beacon while a front fights, and a turning battle at
  the exposed station as it is about to fall or be retaken.
- **News**: the News room reports every front within three jumps (a headline and a line), and
  officers and pilots in the bars tell how a front within two jumps stands and where its tide
  takes it in the next four hours (§16).

### 20.4 War contracts

- War work joins a board only while a front within two jumps is fighting, so every other board is
  exactly as it was. Lawful military bases (weight 3), customs depots (2), trade ports and relays
  (1) of the front's own faction post it while the front is in a skirmish, a blockade or fallen;
  raider dens (2) post it for any front not at peace.
- **The law's**: destroy a pack near the lawful system's exposed station (or another of its
  stations): three raiders at level 2 in a skirmish, four at level 3 in a blockade; retaking a
  fallen station is five at level 3 and pays a quarter more. Pay: 450 cr + 140 per raider per
  level, plus the jump fees (§10.3); −4 standing with the Wake.
- **The Wake's**: destroy two or three of the front faction's haulers in the lawful system (450 cr
  + 240 a ship), +12 standing with the Wake. Each hauler is a crime, as in piracy.
- Done, a war contract pushes its front 18 its way (the pay message says so). A front that The
  Long Border or a decisive operation (§20.7) has settled posts no war work.
- A station that can fall is never the destination of a delivery (generated parcels, hauls and
  supply runs go elsewhere, and such stations post no supply runs or mining claims, whose loads
  come back to them), so a contract never waits on a station the Wake might hold. A wreck's find may still be brought back to one: that is a visit,
  and docking is enough.

### 20.5 The Long Border

The fourth arc (`src/content/story/arcs.ts`) is given by Sabine Kettering, an independent hauler
at Waymark Waypoint in Ross 154, to any pilot after the opening delivery. It decides the Ross 154 –
Wolf 1061 line for good.

| Step | For the Authority | For the Wake | For neither |
| --- | --- | --- | --- |
| 1 | Fly the line: dock at Flotsam Diggings, on the Wake side, and report | | |
| 2 | Letters under fire: a mail pouch from a wreck near Jackpot Stillworks | | |
| 3 | Three letters: the choice | | |
| 4 | the Wake's forward pack at Flotsam Diggings | two Authority haulers in Ross 154 | a letter to both sides and back |
| 5 | break the Wake's push on Regent Concourse | break the Authority's sweep at Maw Roost | escort the envoys from Waymark Waypoint across the line to Flotsam Diggings (two of three must arrive; raiders at the Wolf 1061 beacon) |

- **It reads the other arcs**: Kettering's first briefing, and the choice, carry a line for each
  choice made in the other three arcs (what happened to Oren Vail, the quarantine at Stonecrop,
  Juno Fiske).
- **The choice** is open by standing: flying for the Authority asks for neutral standing with it
  (0 or more), flying for the Wake for a friend of the Wake (10 or more); the truce is open to
  everyone. The choice dialog shows what a closed answer needs. So the finale can be reached as a
  lawful pilot, an outlaw or neither, and each way has its own step 4 and finale.
- **The endings hold the front for good**: the Authority's at pressure 70 (pushed back, and Regent
  Concourse never falls), the Wake's at −80 (Regent Concourse the Wake's for good), the truce at 0
  (quiet lanes, no packs on the Authority's side). Deeds no longer move it.
- Kettering asks nobody's leave: a pilot the Authority hunts, on an emergency berth at Waymark
  Waypoint, is still offered her missions (and nothing else there).

### 20.6 Border guardrails

- **A dock with repairs is always within reach**: every exposed station leaves another open dock
  with repairs in its system, and no story character's home can fall (`tests/unit/border.test.ts`
  checks every front).
- **No dead ends**: a held station posts nothing, no contract asks for a delivery to a station that
  can fall, and the contract guardrails do not count a held station's empty board against it.
- **The story guardrails** (§14.4) allow a choice to branch an arc, each way to its own steps and
  finale; one way on must be open to every pilot; an arc of nobody's may ask for a crime only on the
  branch of a choice that only the Wake's friends can make; and every echo answers a real question
  of another arc.
- **The finale can be reached as a lawful pilot, an outlaw (the Authority hunting them) or
  neither**: the unit tests play all three ways through and check what each ending does to the
  front, its station and its news.
- **Deterministic**: the tide repeats every 48 hours, deeds fade and only 24 are kept, boards are
  cached per save (the log is the save's own), and the log round-trips through the save and is
  checked when loaded.

### 20.7 Fronts that end

The four fronts no story settles (the Frontier Cooperative's, at Lacaille 9352, YZ Ceti and WISE
0722−0540) can now be settled by the player, either way (`BORDER.campaign`):

- **Momentum**: the player's own deeds on a front (§20.2), as they stand after fading. Once they
  come to 40 one side's way (two or three war contracts close together), that side offers its
  **decisive operation**; as the deeds fade below 40, the offer goes. A front a story settles (The
  Long Border's) is left to its story.
- **The law's** is posted at every station of the front's faction with a job board within two
  jumps of the lawful system: knock out the den across the line, turrets then reactor, with a wing
  of the faction's flying alongside (as a den assault, §15; it asks the same combat record). Pay
  3,200 cr and the jump fees; −20 standing with the Wake.
- **The Wake's** is posted at the den, for pilots it trusts: hold the den against the faction's last
  sweep, five of its ships destroyed (each a crime). Pay 2,800 cr; +20 with the Wake.
- **Done, the front is settled for good** that side's way, as The Long Border's endings settle
  theirs (§20.5): the law holds it pushed back, or the Wake holds it, its exposed station fallen for
  good (a front with none, WISE 0722−0540's, stays blockaded for good, and the news says so). War
  work on it stops, and a second decisive operation for it cannot be taken.
- **Settled fronts leave lasting marks** (§14.7), made from the front's stations and their markets
  (`src/economy/marks.ts`, rules in `BORDER.settled`):

| Ending | Where | Market, for good | Board |
| --- | --- | --- | --- |
| The law's | every open station of the front's faction, or independent, on either side of the line | what it makes (a relay: what it trades), up to three goods: price ×0.9, stock ×1.4 | a standing run of its first good to the nearest station that takes it, clear of the fronts (and not into the frontier from outside it), pay ×1.1 ("Reopened lanes") |
| The Wake's | the faction's stations in the lawful system that do not fall | what it needs, up to three goods: price ×1.15, stock ×0.7 (scarce, so they pay more) | none |
| The Wake's | the den across the line | its own wares: price ×0.85, stock ×1.6 | none |

  The Long Border's endings leave the Ross 154 front's marks too (its truce leaves none), and a save
  in which it ended before marks existed gets them when loaded.
- **Guardrails** (`tests/unit/border.test.ts`): every one of the four fronts has a law station to
  ask and a den to answer; nothing is offered without the momentum, or once it has faded, or for The
  Long Border's front; each operation names its front's den and system, pays within the contract
  ceiling and moves Wake standing as said; each ending holds for a whole tide, leaves exactly its
  marks and stops the front's war work; every front has marks for both endings, and they pass the
  lasting-mark guardrails (a broken front, price or goods is caught).

## 21. Haulers on the lanes

The stations send each other freight as ships with names, cargo and a timetable
(`src/economy/hauls.ts`, rules in `HAULS` in `src/content/economy/hauls.ts`). Like the world's
events (§11), every haul is a function of the seed, the game clock and the save's world log:
nothing runs in the background, and every device sees the same haulers at the same moment. The
haulers, their names and their owners are fiction; the stars they fly between are real.

### 21.1 The timetable

- **Trade**: every open station with a market that makes goods (no contraband) may send one haul
  in each five-minute slot (`slotSeconds`), more likely where its system is secure (a chance of
  0.3 + 0.5 × security). It carries one of the goods it makes to an open station within two jumps
  (`maxJumps`) that uses or trades it, nearer ones more often, a quarter of that station's normal
  stock (8–40 units, `load`). Nobody sends a hauler out of a raided system, or into one.
- **Relief**: a shortage (§11.1) draws two hauls (`relief.hauls`) from the nearest stations within
  three jumps that make what it lacks, sent four to fifteen minutes after it starts, each carrying
  30% of what the station lacks (`relief.share`, at least eight units). A raider den's shortage, or
  a closed dock's, draws none.
- **Shipments**: a glut ships its surplus out (§21.6).
- **The way**: the fewest jumps, ties to the first lane in name order; the haulers' drives reach the
  frontier's long lanes. A haul flies five minutes from its dock to the jump beacon, two minutes per
  jump (as the player's jumps take, §11), three minutes across each system on its way, and five
  from the jump to its dock (`legs`); between two stations of one system, six minutes.
- **Who flies it**: a hauler of its sender's owner's fleet (§9; independents' where the sender has
  no lawful owner), with a name from a list (`HAULER_NAMES`, all invented).
- Ids: `h.<station>.<slot>` for trade, `h.<event id>.<k>` for a shortage's relief or a glut's
  shipments.

### 21.2 What becomes of a haul

- **Raids**: in the lanes of a system with a raid on (§11.1), where the player is not, a haul is
  lost with a chance by the raid's threat level (`raidLoss`: 20%, 35%, 50%), at the middle of its
  leg there; a raid broken early by the player loses none after it ends.
- **In the player's sight** the flight decides: a hauler destroyed is lost (whoever destroyed it),
  and one that flew through the player's system past the middle of its leg there, or docked or
  jumped out, gets through, whatever a raid there would have done (§21.4).
- Otherwise it is delivered when its timetable says.

### 21.3 How the world feels them

- **Shortages fill**: each relief haul that arrives adds its cargo to the station's stock while the
  shortage lasts, fading as the market recovers (30 minutes); what the relief has delivered counts toward the shortage's
  relief with what the player sells (§17.1), and all of it arriving (60% of what the station lacks)
  ends the shortage at once. The news says it was relieved by its haulers. A pilot who gets there
  first sells at the shortage's prices; one who destroys a relief hauler leaves the shortage to run
  on.
- **Losses are missed**: a trade haul lost to a raid, or destroyed where the player saw it, takes
  its cargo off the stock where it was bound, from when it was due, fading the same way. The rest
  of the trade is the markets' normal flow (§8), already in their prices.
- **The News** (§11.3) lists each shortage's relief under it (loading, on its way and due in so
  many minutes, in, or lost to raiders or to a pirate), and the hauls lost to raiders within two
  jumps over the last half hour, at most three (`news`).
- **In flight** (§9) the haulers flying in the player's system are the timetable's: those under way
  when the scene starts, wherever they are along their leg, then each as its leg begins (out of a
  dock, or out of the jump), never popping in near the player. Each is named, with its owner, its
  cargo and where it is going (*The Bramble · Transit Authority · 18 food for Halcyon Ring*). A
  hauler destroyed spills half its cargo in pods of four to nine units (`spill`), whoever
  destroyed it; destroying one is piracy (§12.1). The player's own haulers fly alongside them,
  marked as the player's (§18.6).
- **Standing by**: a hauler that called a mayday and got away after the player destroyed at least
  one raider since its call (and was never hit by the player) sends thanks: 6 cr a unit it carries,
  at least 80 cr, and a point of standing with its owner (`thanks`).

### 21.4 The world log

`GameState.world.hauls` (optional) holds, by haul id, what became of the hauls the player saw:
`safe` through a system (and which), or `lost` (and by whom), with the time. A lost haul stays
lost. Records older than three hours (`keepSeconds`) are dropped when the next is written. A save
with a damaged record (an unknown fate or system) is rejected.

### 21.5 Guardrails

`validateHauls` (`src/economy/haulGuards.ts`, run in `tests/unit/hauls.test.ts` over a day of
every station's hauls and the relief of every shortage under way) checks that every haul goes from
an open station that makes its cargo to another that takes it, within reach, over real lanes; that
its legs run through the systems of its way, as long as the rules say, with a jump's time between
them; that its load is within bounds; that its name is a hauler's and its ship one of its owner's
fleet; and that the rules make sense (all of a shortage's relief arriving relieves it, chances
between 0 and 1, no name twice or shared with a station). Broken hauls (to a den, from where the
cargo is not made, contraband, overloaded, along a lane that does not exist, a leg out of time, an
unknown name or a raider's ship) are caught. The tests also check that a station's haul in a slot
never changes; that the core's lanes have a hauler or more on average; that nobody sets off into
or out of a raid; that a shortage's relief comes from makers, all of it arriving ends the
shortage, each arrival fills its stock, and with the player's sales it counts toward the relief
bonus; that a raid loses hauls, the loss is missed where they were bound and in the news, a hauler
seen safe through the raided system gets through (but not if seen elsewhere), and a destroyed one
stays lost and leaves its shortage to run on; that the world log keeps three hours and refuses
damaged records; and, in a real `FlightSession` in node, that the haulers shown are the
timetable's, named with their cargo and capped by the plan, that one destroyed by the player is
lost and spills its real cargo, that they leave the scene safe at their dock or the jump beacon and
others join as their legs begin, and that one kept alive through an attack by the player's guns
sends thanks, and one the player fired on does not. The shipments and escorts of §21.6–21.7 are
checked in `tests/unit/gluts.test.ts`.

### 21.6 Gluts that ship out

A glut (§11.1), and a frontier harvest (a glut of food at a farm), ships its surplus out, as a
shortage draws relief (`HAULS.shipOut`):

- **The shipments**: two hauls (`hauls`) to the nearest open stations within two jumps that use or
  trade the good (a different one each, while there are), each carrying 30% of the surplus
  (`share`; the surplus is what the glut leaves the station with beyond its normal stock: four
  fifths of it for a glut, all of it for a harvest; at least eight units). They are sent fifteen to
  forty-five minutes after it starts (`dispatch`), never after it was due to end, and fly the lanes
  like any haul. A harvest ships its first good. A raider den's glut, or a closed dock's, ships
  nothing.
- **Clearing**: a shipment's cargo leaves the station as it sets off, and when 60% of the surplus
  has gone (`EVENTS.react.relief`: both shipments), the glut is over and the station's prices are
  back to normal. Every unit the player buys there while it lasts counts too (with what has been
  shipped), so a pilot can clear it sooner (`clearGlut` in `src/economy/answers.ts`); there is no
  bonus for it, as the low prices were the reward. A toast says so.
- **Stock**: while the glut lasts, each shipment takes its cargo off the station's stock as it
  sets off, fading as the market recovers (30 minutes); once the glut is over, the station's normal
  stock is back. Where a shipment arrives, its cargo adds to the stock the same way, so the good is a
  little cheaper there for a while. A shipment lost to raiders (or to the player's guns) brings
  nothing; the glut is not the worse for it, as the cargo had left.
- **The News** (§11.3) lists each glut's shipments under it: loading and leaving in so many
  minutes, on its way and due in so many, delivered, or lost to raiders or a pirate. A glut cleared
  says *shipped out by its haulers*, or *bought up by a pilot*, and how long ago.
- **In flight** the shipments are flown as relief is: named, with their owner and cargo.

### 21.7 Escorts for relief through raided lanes

A relief haul or a shipment whose way crosses a raid (one on in a system of its way at the middle
of its leg there), within two jumps (`CONTRACTS.maxJumps.escort`), gets an escort posted on its
sender's board, if the sender has one: *Escort the Bramble to Dogwood Port*. It is posted from when
the event begins until the haul is due to set off (`until`); its id is its own
(`c.<station>.<slot>.escort-<haul id>`), as it comes and goes within a time slot.

- **The work**: an escort (§10.2) of the haul's own ship, under its own name, to the station it is
  bound for. Its threat is the worst raid on the way, and its difficulty one more for two jumps; it
  pays as an escort does, with the premium of work answering an event (`eventPremium`). The briefing
  says what it carries and why, and where the raiders are.
- **Taken on**, the haul waits for the pilot: it is off its timetable (not flown in the lanes, and
  not posted again), and sets off with the player like any escorted ship, jumping with them. The
  world log (§21.4) keeps it as `escort` until the escort sees it docked (`arrived`: its cargo
  delivered from that moment, relieving its shortage or reaching its buyer) or it is destroyed
  (`lost`). An escort given up or failed for another reason (left behind) lets the haul go on its
  timetable as if nobody had taken the job.
- **The News** says a haul is with its escort while it is.
- An escort for a haul is posted beside a board's own event work (§11), so a board may have both.

The guardrails (§21.5) also check that a glut's shipments leave a glut of their cargo at their
sender, in their time, and that all of them gone clears it; and the contract guardrails (§10.4) that
an escort for a haul names a haul of the timetable from its sender, with its ship and name, through
a raid that sets its threat, posted while its event is on and before it sets off.


## 22. A station of your own

After a fleet, a station: the player charters a site in orbit of a real planet, builds an outpost
there by bringing the materials, stage by stage, and it trades and pays an income by the hour
(`src/economy/outposts.ts`; rules in `OUTPOSTS`, `src/content/outposts/rules.ts`; sites in
`src/content/outposts/sites.ts`; the Fleet window and the Outpost window,
`src/ui/station/outpost.ts`). The outpost, its name and its people are fiction; the planet it
orbits is real, and nothing is invented about it.

### 22.1 Sites

One site in orbit of each confirmed planet of the generated systems: 66 sites in 37 systems today.
Sol and the four other hand-made systems keep their own stations, and contested planets have none.
A site's orbit (1,600–2,800 units from the surface, `orbit`) is drawn from its own seeded stream,
so the world's stations, which are locked (§7.6), never move. What an outpost can be (`kinds`):
a mine, refinery, factory, farm, research station, relay, trade port or free port, each only where
the system's security is within that kind's band (§7.3), and a mine only round a small planet.

### 22.2 The charter

At any station of the site's system where the player has full access, the Fleet window lists the
system's sites. Chartering one costs 8,000 cr (`charter`); the player picks its kind and one of three
names offered for that kind at that site (a name word, `nameWords`, and the noun of the kind, such
as *Hearthlight Exchange*). One outpost to a save (`max`).

### 22.3 Building it

The site is a dock at once: a shipyard's frames, small and new, where the player can dock but
nothing is sold. At the site, the Outpost window lists what the next stage needs and hands it over
from the hold. Each stage done changes the station (`stages`):

| Stage | Needs | Then it has | Income (cr an hour) |
| --- | --- | --- | --- |
| Frame | 8 habitat modules, 20 refined metals, 6 machinery | a market and repairs: it opens | 300 |
| Station | 12 habitat modules, 30 polymers, 15 electronics, 8 fabricator parts | a job board | 800 |
| Port | 16 habitat modules, 15 ship components, 15 machinery, 20 electronics | an outfitter (consumables, `shop`) | 1,600 |

Its size, which sets its market's normal stock, its structure and its crowd, grows with each stage
(0.3, 0.55, 0.8); its look is its kind's, independent, barely worn.

### 22.4 Open

- **Its market** is priced by the same rules as everyone's (§8): its kind's profile, the makers
  within reach and its security. The player and the player's captains (§18) trade there; a captain
  can be hired to it once it trades.
- **Its board** (from the station on) posts the work its kind posts anywhere (§10).
- **Its income** is paid by the hour from when it opens, with the fleet (§18.4), and moved by what
  happens in its system as stakes' dividends are: a raid that hour × 0.6. It has no world events
  of its own. A save left very long is paid its oldest hours at the plain rate in one sum.
- **On the map** it is listed with its system's stations, and it is a station of its system's
  scene, to fly to and dock at.

### 22.5 One save's own

The outpost lives in the save's world log (`world.outpost`), and the world finds it by its id
(`outpost.<planet>`): `getLocation` resolves the save's own stations (`setSaveLocations`), the
market tables answer for it by id, its system's scene adds its dock, and its board and outfitter
are its own. It is never added to the shared world's lists (`ALL_LOCATIONS`, a system's stations,
the market tables as they are gone through), so nobody else's prices, boards, the haul timetable
(§21), traffic or events change because of it, for that player or any other.

Guardrails (`validateOutposts`, `src/economy/outpostGuards.ts`, run in
`tests/unit/outposts.test.ts`): every stage needs lawful goods somebody makes, in whole numbers;
stages grow in size and income and keep the services they had, and the first opens a market; each
pays for itself (at the goods' galaxy-wide prices, the charter with the frame) in 8–60 hours, and
the whole outpost in 10–60 hours at full income; every kind has a market, a board and a bar; the
name words are distinct and never a station's or a system's name, and three names are offered for
every kind at every site; every site orbits a confirmed planet of a generated system, within its
orbit's bounds, allowing only kinds the world's rules allow there, and its outpost would clash with
no station. Broken rules (contraband needed, income that does not grow, a stage that drops its
market, one that pays for itself at once, a name already a station's) and broken sites (in a
hand-made system, a kind outside its band) are caught. The tests also check the charter (only in
the site's system, for the fee, once), that the outpost is the save's only (another save does not
have it; the shared lists never do), its dock in the scene, the stages (the market opening with the
frame, the board with the station, consumables at the port), that nobody else's prices or board
change, its income by the hour however often it is settled, captains hired to it, and saves that
keep it and refuse a damaged one.

## 23. Passengers and sightseers

People, not only cargo: fares between stations, and tours out to the real sky's sights, carried in
a passenger cabin (`src/economy/passengers.ts`; rules in `PASSENGERS`,
`src/content/passengers/rules.ts`; the sights in `src/content/passengers/sights.ts`; what
passengers say in `src/content/passengers/lines.ts`). The passengers, their names and their words
are fiction. Every sight is a body or a belt the archives list, and every number a sightseer says
is printed from that record, never written into a line.

### 23.1 Cabins and berths

A passenger cabin is a utility fitting, a gear family like any other (§9): two berths at class 1,
three at class 2 and four at class 3, for about 235–565 cr, and it costs a little top speed (3%).
Three makers build them: Halden's *Snug* (classes 1–2), Toliman's *Bunkhouse* (1–3) and Eridani's
*Houseboat* (1–2), sold at outfitters as their other gear is. A ship's berths are its cabins'
total. With passengers aboard, a cabin they need cannot be sold, and the player cannot switch to a
ship (or keep one) with too few berths for them. The crew (§30) have quarters of their own and
never take a berth.

### 23.2 Passages and tours

The contract boards (§10) post two new kinds, where people travel: trade ports, relays, farms and
free ports post passages; research stations, trade ports, relays and Sirius's platform post tours.

- **A passage** takes a party of 1–3 to another open station within 3 jumps. Fare: 140, 120 a
  jump, 90 a passenger, scaled by the route's danger as other work is.
- **A tour** takes a party of 1–4 to see a sight within 2 jumps and back to the station that
  posted it. Fare: 220, 150 a jump, 110 a passenger, times the sight's interest (`interest`: a
  planet 1, a giant 1.15, a belt 1.2, a brown dwarf 1.3, a white dwarf 1.4).

Each passenger needs a free berth: a job a party would not fit says so on the board ("Needs 2
free passenger berths (you have 1): fit a passenger cabin") and cannot be taken. The job card
names the party and the berths it needs.

**The sights** are every confirmed planet (a giant above `GIANT_EARTH_MASSES`), every white dwarf
(spectral class D) and brown dwarf (L, T, Y) the archives list, and every belt or debris disc a
cited source reports: 143 sights in 100 systems today (68 planets, 9 giants, 11 white dwarfs, 46
brown dwarfs, 9 belts). A good look is within `sightRange` (9,000 units) of a planet's or dwarf's
surface, or inside a belt's band (`sightInView`, `src/world/sightseeing.ts`). It counts whether
the body was scanned before or not. A tour is a trip out: it never goes to a sight in view from
where a pilot jumps in (three planets today, whose systems' beacons sit close by, are left out of
tours) or from the dock that posts it.

### 23.3 What they say, and fright

The party's first passenger speaks for it, over the radio:

- arriving in the sight's system ("{system} at last. Where is {sight}?");
- at the sight, a line about it filled from its record (`SIGHT_LINES`): a planet's period, its
  mass (an archive's minimum mass is said as "at least"), its distance from its star, its width,
  the year and the way it was found; a dwarf's spectral type or distance; a belt's source. A line
  is only picked when the record has every field it needs, and every sight has a line that needs
  none;
- at home, or at the passage's end, a thank-you.

Passengers hate a fight. Each share of the hull the ship loses with them aboard (shields do not
count) takes `perHull` (1.5) times that share off their fare, never below `floor` (40%) of it: a
hit taking a tenth of the hull costs 15% of the fare. They say so, at most once every 20 seconds.
The fare paid says what a rough trip cost. If the ship is lost, they leave with the tug's crew
and the job fails.

### 23.4 Guardrails

`validatePassengers` (`src/economy/passengerGuards.ts`, run in `tests/unit/passengers.test.ts`):
parties no cabin is too small for, the same reach as the contract boards, fares that are positive,
a fright that cuts a fare but never wipes it out, interests within 1–2 and a positive sight range;
no line with a number of its own or a field it cannot fill, and a line for every kind of sight that
needs no field; every sight a record of the catalogue (a confirmed planet, a dwarf of its class, a
cited belt) with a target in its system's scene and a fact for every field it gives; every tour
sight out of view from its system's arrival point and beacons, and nine in ten sights at least left
to tours. The contract guardrails (§10) check that each posted passage goes to another open station
and each tour to a sight of the system it names, out of view from the beacons and the dock that
posted it, and back. The tests also break the guardrails (a number in a line, a field it cannot
fill, a planet that is not real) to see them caught; carry a passage with a fright to its fare's
floor; take a tour out to its sight (scanned before, still to be seen) and home; see a planet from
within range and a belt from inside its band in a flight scene, and nothing at the arrival point;
feel hull hits and not shield hits; and keep a party, a sight seen and a fright in a save while
refusing a damaged one.

## 24. Rival pilots

Six named pilots with careers of their own, who work the same lanes as the player
(`src/economy/rivals.ts`; the six and their rules in `RIVALS` and `ROSTER`,
`src/content/rivals/rules.ts`; what they say in `src/content/rivals/lines.ts`). The rivals, their
names, their ships' names and their words are fiction; the stations and stars are the world's.
Like the haulers' timetable (§21), a career is a function of the seed, the game clock and the
save's world log: nothing runs in the background.

### 24.1 The six

| Rival | Style | Home | Ship |
| --- | --- | --- | --- |
| Mara “Quickstep” Venn | Trader | Sirius Platform | *Merry Dancer*, a class 2 freighter |
| Bastian “Tally” Okonjo | Trader | Dogwood Port (Luyten 726-8) | *Fair Exchange*, a class 3 freighter |
| Ione “Lantern” Sallow | Bounty hunter | Regent Concourse (Ross 154) | *Long Night*, a heavy fighter |
| Dax “Two Bells” Corrigan | Bounty hunter | Ledger Institute (Wolf 359) | *Last Orders*, a gunship |
| Pell “Halfpenny” Arkwright | Runner | Dawnfield Institute (Procyon) | *Spare Change*, a fast courier |
| Saoirse “Sundown” Kalu | Runner | Millstone Relay (GJ 1061) | *Late Light*, a courier |

Each works a patch: the open stations with a market within one jump of home, never in Sol, whose
prices are the opening's (`patch`). The two hunters' patches do not overlap.

### 24.2 Careers

Careers start two hours into a game (`from`), once the player has found their feet, so the
opening's prices are always the designed ones. A career is a run of turns of one game hour
(`turnSeconds`): the rival rests 5–10 minutes in the bar where it is (`rest`), then flies a run
to the next station, leg by leg like a hauler (§21.1), and docks there until the next turn.

- **A trader** picks a station of its patch and carries the best lawful cargo between the two (the
  good the first sells and the second takes with the widest gap between their normal prices),
  16–32 units. With nothing worth carrying, it flies empty; picking where it already is, it stays.
- **A bounty hunter** takes one bounty or ace posted on a board of its patch as it sets off, on a
  pack within two jumps of home (`hunt.reach`), and flies to the pack's station. Without one, it
  flies light to another station of its patch, looking for work.
- **A runner** races to a shortage that began at a station of its patch in the turn before, still
  on (not ended by the player, nor by the haulers' relief), loading half of what the station lacks
  (`race.share`) at the nearest maker within a jump of it, then flying it in. Without one, it trades.

Every run is over before the next turn sets off. Each run starts where the last one ended, so a
rival is always somewhere: resting in a bar, flying a leg, in a jump, or refitting.

### 24.3 What the markets feel

A trader's or runner's cargo leaves the market where it loads and arrives where it sells, and both
fade as the markets recover (`ECONOMY.recoverySeconds`), as the haulers' lost cargo does (§21.3).
A rival on a route the player runs makes it pay a little less for a while. A runner's cargo counts
toward the relief that ends its shortage (§21.2): a runner can end one before the player gets
there. If the shortage is over before the runner arrives (relieved by the player, say), it sells
nothing, and the News says it was beaten to it.

### 24.4 Claims

From the moment a hunter takes a bounty until the board's posting rolls over, the bounty is gone
from that board's list, and the Jobs window shows it under *Taken by rival pilots*, with what the
claim costs: 35% of the reward (`hunt.claim`), half that from a friendly hunter. A hunter knocked
out lets its claim go. Buying it back
puts the job on the board again for the player, and costs a little standing with the hunter
(`standing.outbid`). A hostile hunter will not sell. A job the player already holds stays theirs
(the hunter may still turn up after the same pack), and a turn is longer than a posting, so a
hunter never takes two from one board.

### 24.5 Standing

The player's standing with each rival runs from −100 to 100, from 0, in the factions' tiers
(hostile, wary, neutral, friendly). A round bought in the bar where a rival sits raises it by 5,
once a shift, up to 30 (`standing.round`, `roundsUpTo`; up to 40 for a friend whose story's deed is
done, §28.1); a claim bought back lowers it by 6; the
player's first shot at a rival in a flight by 25; destroying its ship by 60. A hostile rival will
not drink with the player, but amends (1,500 cr) bring it to wary. A friendly rival says, in the
bar, what it is doing next, and sells a claim for half.

### 24.6 In flight, in the bars, in the News

- **In flight**, a rival flying a leg in the player's system is a ship of the scene, named
  (*Mara “Quickstep” Venn*) with its ship and what it carries (*Rival · Merry Dancer · 24
  electronics for Marram Gardens*), and says hello over the radio. Shooting one is an attack on an
  independent ship, and destroying one is a crime, as for any trader; its hold spills half its
  cargo, and the rival ejects and spends three hours refitting at home (`downSeconds`), its run
  lost. A hostile rival in a lawless system (security under 0.5) comes for the player instead:
  it fights as a raider, but pays no bounty and leaves no salvage.
- **In the bars**, a rival docked at the station sits in the People window under *Rival pilots*,
  with its style and the player's standing. Sitting with it, the player hears its greeting (by
  standing, and, friendly, its next run), and can buy a round or make amends.
- **In the News**, within two jumps and over the last hour: trade runs made and under way, bounties
  taken, races run (and won or lost), and rivals knocked out.

### 24.7 Guardrails

`validateRivals` (`src/economy/rivalGuards.ts`, run in `tests/unit/rivals.test.ts`): a turn longer
than a board's posting, a rest that fits in it, loads and claim prices and shares in range, standing
that moves the right way, amends that leave a rival wary, a knock-out longer than a turn; the six
distinct, with no first name, family name or nickname the bars, the aces or the wingmen use, no
story character's name and no hauler's ship name, at home at an open station with a market outside
Sol, in a ship of the catalogue, with a patch of at least three stations, the hunters' patches
apart, every style among them; no line with a number of its own or a field it cannot fill; and over
two days of every career, every run over before the next turn, its legs in order along real lanes,
its cargo lawful and traded that way at its two stations, a hunt a bounty posted in the patch on a
pack within reach, a race to a shortage of the patch with its maker within a jump. The tests also
break the rules (a turn too short, a shot that raises standing), the roster (a name the bars use, a
home in Sol), a line (a number in it) and runs (one that overruns, contraband) to see them caught;
check careers (none before the opening is over, each run from where the last ended, the same in
every save), where a rival is through a run (resting, flying, loading at the maker, docked), the
stock a trade run moves at each end, a claim taken off a board and bought back (its price, the job
back, standing), a hostile hunter that will not sell, a race that ends a shortage sooner and one
beaten to it, standing through rounds, shots and amends, a knock-out (the run lost, the News, back
at work from home), the flight scene (a rival met, named, shot and destroyed with the crimes that
go with it; a hostile one in lawless space as a raider with no bounty), and saves that keep it all
and refuse damaged ones.

## 25. Stellar death, as fiction

Two real red supergiants far beyond the map die in the game's sky: Betelgeuse explodes as a
supernova, and later Antares collapses quietly into a black hole and goes out
(`src/economy/stellar.ts`; the rules in `STELLAR`, `src/content/stellar/rules.ts`; what is said in
`src/content/stellar/lines.ts`). This is an exception to the rule that real astronomy is never
invented, chosen by the owner, and it is kept apart from the real sky: the stars, their places,
distances and brightness are the catalogue's (`src/data/generated/far-stars.json`;
[ASTRONOMY_SOURCES.md, *Far stars*](ASTRONOMY_SOURCES.md#far-stars)); that they die, and when and
how, is fiction, applied on top in each save's own timeline and never written into the data. It is
labelled wherever it shows: each story in the News wears the **Fiction** badge and says that the
star is real and has not exploded (or collapsed); in flight, the star's target wears the
**Fiction** badge from the moment its light arrives; the encyclopedia's *Far stars* says so too.

The idea is that the sky itself can change under the player, with the science told straight. An
invented star at the edge of the map whose death leaves a black hole to fly to is §26.

### 25.1 The far stars

| Star | Designation | Spectral type | Distance | Brightness (V) |
| --- | --- | --- | --- | --- |
| Betelgeuse | Alpha Orionis | M2Ib | 498 ly | 0.45 |
| Antares | Alpha Scorpii | M1Ib + B2.5V | 554 ly | 1.06 |

Both are in every system's sky in their true direction from the system's real position, drawn as
bright as their magnitude (`src/world/art/farStars.ts`). They are some 500 light-years away and the
map reaches 27, so their direction shifts across the map by up to about 3° (the parallax that the
distance job below measures). The values are provisional (HYG v4.0, from Hipparcos) and badged
*Pending verification* until the monthly archive snapshot checks them against SIMBAD.

### 25.2 The timeline

Each save holds one number for it in its world log (`world.sky.from`): when the first neutrino alert
comes, 90 minutes of game time after the opening delivery is done (`alertAfterOpening`), or 30
minutes after loading a save already past it (`alertAfterLoad`). Everything follows from it and the
clock, the same in every save:

| Moment | After the alert | What happens |
| --- | --- | --- |
| Alert | 0 | Neutrino detectors at the research stations catch a burst from Betelgeuse |
| Light | 15 min | Its light arrives; it brightens over ten minutes (`rise`) |
| Peak | 25 min | Magnitude −10.8, the brightest light in every sky; it holds near it for an hour, dimming half a magnitude (`plateau`) |
| Fading | 1 h 25 min | Past its brightest, it fades over four hours (`fade`) |
| Remnant | 5 h 25 min | A faint glow of magnitude 4.5 is left where it shone, for good |
| Antares' alert | 3 h 15 min | A weaker burst from Antares |
| Antares' light | 3 h 25 min | It brightens by a magnitude (`brighten`) and holds ten minutes, with no explosion |
| Gone | 4 h 20 min | It has faded out of sight over 45 minutes, for good |

Real time is compressed throughout: SN 1987A's neutrinos came some three hours before its light,
and a Type II-P supernova holds near its peak for about a hundred days. How bright the supernova
gets is worked out, not written in: a typical Type II-P supernova's peak absolute magnitude, −16.75
(the mean of the sample in Richardson et al. 2014, *Absolute-magnitude distributions of
supernovae*, AJ 147, 118), at Betelgeuse's real distance, m = M + 5 log₁₀(d / 10 pc), gives −10.8:
brighter than every star and planet, fainter than the full Moon. A red supergiant that collapses
without a bright supernova, a *failed supernova*, is how some astronomers think such a star can end
(the candidate N6946-BH1 is the best known); in the game it is Antares.

In the sky the supernova grows with its brightness, and from magnitude −3 it has a halo with faint
spikes and casts a faint light on the ships from its side of the sky (never more than a fill). Its
colours at the peak and as a remnant are artistic.

### 25.3 What the world says

- **The News** at every station tells each moment as it comes, newest first, for six hours after
  each star's story is over, every number in it from the catalogue (the star's distance, how long
  its light has been on its way, its peak).
- **The research station network** calls the big moments over the radio: the alert, the light,
  Antares' burst and its going out (in flight, or on the next launch).
- **Markets**: research stations pay 1.3 times the price for data cores and electronics from
  Betelgeuse's alert until it has faded, and from Antares' alert until it has gone (`market`).

### 25.4 Observation work

While a star dies, every research station posts observation jobs, in the postings its windows
overlap:

| Job | Window | Pay |
| --- | --- | --- |
| Catch the first light of Betelgeuse | From its light to the end of the peak | 2,200 cr |
| Watch Betelgeuse fade | From the end of the peak until it has faded | 1,200 cr |
| Measure the distance to Betelgeuse | From its light until it has faded: readings from two systems at least 20 ly apart (`baselineLy`) | 4,200 cr |
| Watch Antares go out | From Antares' light until it has gone | 1,600 cr |

In flight a dying star is a target (and a star a job wants watched, while it shows): picked like
any other, at its distance in light-years, never flown to (*Go to* does nothing). With a job's window
open, the action button reads **Observe**: one press takes a reading from that system (one a minute
per system is kept). Then the readings go back to the station that posted the job. The distance
job is parallax, as astronomers measure every star's distance: seen from two systems 20 light-years
apart, Betelgeuse shifts by about 2.3° against the far sky.

### 25.5 One save's own

The alert time is kept in the save's world log, so a game loaded again has the same sky, the same
News and the same jobs. Saves keep the readings taken for each job, and refuse a damaged timeline or
reading (`src/app/save/migrate.ts`).

### 25.6 Guardrails

`validateStellar` (`src/economy/stellarGuards.ts`) and `validateFarStars` (`src/data/validate.ts`,
also run by `npm run data:validate`), both run in `tests/unit/stellar.test.ts`: the far stars with
unique ids, in the map's frame and epoch, positions consistent with their parallaxes, more than
three times the map's radius away, with a catalogue id and https sources; the timeline running
forward, with Antares stirring only after the supernova's peak; two different far stars; a peak
brighter than Sirius and every star and fainter than the full Moon, and brighter than the star was;
a remnant fainter than the plateau and still in sight; a failed supernova that brightens a little;
a parallax baseline that shifts the star by at least a degree and that the map can give; rewards
positive and within what any contract pays; a price effect between 1 and 2; at least three research
stations; every direction in the sky a unit vector within the parallax the map allows; and no line
with a number of its own or a field it cannot fill. The contract guardrails check every observation
job (posted by a research station, a far star, a window that opens, back to the station that posted
it). The tests also break the rules, the data and a line to see them caught, and check the
timeline (scheduled once the opening is done, or for an old save), how the stars look through it,
the News and the radio, the markets, the jobs (posted only at research stations while a star dies,
accepted, a reading taken in the window and not stored twice, paid on return), parallax only from
systems far enough apart, saves that keep it and refuse damaged ones, and the flight scene (the
star a target with its distance in light-years and the Fiction badge, Observe offered and taken,
never flown to, labelled fiction after it has faded).

## 26. Stellar death II: a doomed star at the edge

**Pyre** is the one star the game invents: a red supergiant just beyond the edge of the map, which
explodes in each game some time after the pilot first reaches the frontier, its light sweeping
across the map a light-year a minute, and whose core leaves a black hole a pilot can fly to
(`src/economy/doomed.ts`, its physics in `src/economy/pyrePhysics.ts`; the rules in `DOOMED`,
`src/content/stellar/doomed.ts`; what is said in `src/content/stellar/doomedLines.ts`). It is an
exception chosen by the owner, as §25 is, and kept further apart still: it is held in the rules
only, never written into the real sky's data (`src/data/generated`, `data/`) or given a source, and
never in `SYSTEMS`, `ALL_LOCATIONS` or the world's jump network, so nothing built from the real map
(lanes, owners, events, boards, timetables, prices) changes with it. `getSystem` and `getLocation`
find it and its two stations; the star map, the jump rules and saves use `MAP_SYSTEMS`,
`MAP_LINKS` and `KNOWN_SYSTEM_IDS`, which add it and its one lane. Wherever it shows it is labelled:
each story in the News wears the **Fiction** badge and says *Fiction: there is no star called
Pyre.*; its target in flight, its science card, its star-map label and card, the jump overlay, the
map legend and the encyclopedia's *The invented star* all say it is invented.

The idea: a star dies where a pilot can be, with real physics, and what is real behind it told
straight.

### 26.1 Where it is, and what it is

Its place is invented: toward Phoenix (RA 357.5°, Dec −45.5°), 33 light-years from the Sun, at
(23.11, −1.01, −23.54) ly in the map's frame. That is beyond the archives' census of the Sun's
neighbourhood (everything with a parallax of at least 120 mas, out to 27.18 ly), so the map never
claims a star the census lacks. The nearest real system is GJ 915, a white dwarf at the frontier's
edge, 6.06 ly away (Fomalhaut B is next, at 11.9); one lane joins them, which needs the long-range
jump drive. The game's numbers for it are those of a typical M2 supergiant: about 25 solar masses at
birth, luminosity log L/L☉ = 5.35, a surface at 3,650 K (compare Levesque et al. 2005, ApJ 628, 973,
for the temperatures of red supergiants), and a bolometric correction of −1.6 in V. From them, with
the real physics:

| | Worked out | |
| --- | --- | --- |
| Absolute magnitude (V) | M = 4.74 − 2.5 log L − BC | −7.0 |
| Seen from Earth | m = M + 5 log₁₀(d / 10 pc) | −7.0, some seven times brighter than Venus at its brightest |
| Seen from GJ 915 | | −10.7 |
| Size | L ∝ R²T⁴ | about 1,180 times the Sun's |
| Supernova's peak from Earth | Richardson et al. 2014's −16.75 at 33 ly | −16.7, some forty times the full Moon; from GJ 915, −20.4 |
| Black hole (10 solar masses) | Schwarzschild radius 2GM/c² | 29.5 km (its horizon about 59 km across) |
| Tides | a 10 m ship pulled apart at 10 g | within about 6,470 km |

Most exploding stars are thought to leave a neutron star; which leave black holes depends on how
their cores are built, and no supernova has yet been seen for certain to leave one. In this game
Pyre's core falls back into a black hole, the less certain way, and the game says so.

### 26.2 The timeline

Each save holds one more number in its world log (`world.sky.edge`): when Pyre's warning comes.
It is set once the far stars' story (§25) is under way and the pilot has reached the frontier: an
hour after Antares has gone (`afterAntares`) and two hours after the first frontier system
(`afterFrontier`), or half an hour after loading a save already past both (`afterLoad`). Everything
follows from it and the clock:

| Moment | After the warning | What happens |
| --- | --- | --- |
| Warning | 0 | Detectors at Pyre Observatory catch the neutrinos of a dying core: the observatory evacuates |
| Collapse | 45 min | The core collapses: the lane closes to arrivals, the observatory closes |
| Breakout | 50 min | The shock breaks out of the surface: the light leaves Pyre; a ship still in its system is carried out (26.4) |
| Its light | 50 min + 1 min a light-year | It reaches GJ 915 six minutes later and the far side of the map within the hour (`secondsPerLy`) |
| Lane open | 2 h | The debris has thinned: ships may jump to where it was (`laneOpensAfterBreakout`) |
| Station open | 6 h | Pyre Remnant Station opens, well clear of the black hole (`stationOpensAfterBreakout`) |

In each system's sky (§25's far-star art) Pyre shows from its warning, counting down to its light
(*Its light arrives in m:ss*), then rises to its supernova over the same curve as Betelgeuse's
(`STELLAR.supernova`), and fades to a remnant glow of absolute magnitude −1. Real time is compressed
throughout: a core gives its neutrino warning hours to days before it collapses, the shock takes
about a day to break out of a red supergiant, and light crosses a light-year in a year.

### 26.3 What the world says, and markets

- **The News** at every station tells each moment as it comes there, newest first: the warning, the
  collapse, its light arriving and fading in that sky, the lane and the station opening (Pyre's own
  stations tell no light arriving). Each story carries the Fiction line. When its light reaches
  Sol, Sol's stations add what such a star would mean for Earth: a supernova could thin the ozone
  layer if it went off within somewhere from 26 to 65 light-years (8 pc through its radiation,
  Gehrels et al. 2003, ApJ 585, 1169; 20 pc through the cosmic rays that follow it, Fields et al.
  2020, PNAS 117, 21008), any harm building over years to millennia.
- **The radio** says the warning, the collapse, its light arriving where the pilot is and the lane
  opening, in flight.
- **Markets**: research stations pay 1.3 times the price for data cores and electronics from the
  warning until it has faded in their own sky (`market`). Pyre's two stations have market tables
  of their own, priced like everyone's through its one lane, never anyone else's makers.
- **The star map** marks Pyre: a **Fiction** tag on its label, a dashed ring on the flat map, a legend
  line (*Pyre: an invented star, not in the real sky*), and a card that shows nothing as observed,
  says it is invented and how things stand there now (`pyreStatus`). The jump overlay badges its
  distance *Invented*; a jump that would arrive from the collapse until the lane opens is refused
  with the reason, counting the time the jump takes (`laneClosedReason`).

### 26.4 Its system, and its black hole

While it lives, its system holds the star (drawn as a red supergiant far smaller than one would be,
with a slow pulse) and Pyre Observatory at a wary distance; nothing else, no traffic, no raiders.
After the breakout the scene is the black hole (`PYRE_GONE_SCENE`, `src/world/art/blackHole.ts`):
a black shadow, the thin bright ring of light bent round it, a disc of the star's gas still falling
back in, and the glowing cloud of its outer layers all round; and Pyre Remnant Station well clear of
it. The gas glows less and less: the rate at which a star's gas falls back drops as time to the power
−5/3 (Chevalier 1989, ApJ 346, 847), and its glow is drawn following it, full when the lane opens
(`fallbackDecay`). Nothing is pulled in from afar: away from it, its pull is no stronger than that
of a star of the same mass.

- **Its tides**: a faint dashed ring marks where they begin (drawn at 22,000 units, far nearer than
  the real 6,470 km would be at the scene's scale). Inside it the hull strains, 3 points a second at
  its edge and more as the cube of how much nearer the ship goes (`hullStrainPerSecond`); shields are
  no help. A ship that reaches the shadow is lost. The autopilot never takes a ship inside: flying
  to the hole it stops 600 units beyond the ring, and it steers round the ring on any other way.
- **Caught at the breakout**: a ship still in Pyre's system when its light leaves is carried out
  through the lane to GJ 915 Freeport by its emergency drive, repaired, charged as a rescue (at most
  150 cr), its cargo and passengers kept; the card says *Fiction: no ship this near an exploding star
  would live through it.* A pilot whose last dock was Pyre's observatory, lost after it closed, comes
  round at GJ 915 Freeport too (`rescueDockId`).
- **Docking**: the observatory refuses ships once evacuated, the remnant station until it opens.
- **Scanning** Pyre or its black hole opens a science card (`src/ui/screens/pyreCard.ts`) that says
  it is invented and gives its numbers from 26.1. Neither joins the codex.

### 26.5 Its work

| Job | Posted at | From – until | What | Pay |
| --- | --- | --- | --- | --- |
| The last of Pyre | Every research station | Warning – breakout | Observe Pyre from open space anywhere, then back to the station | 1,400 cr |
| Out of Pyre's reach | Pyre Observatory | Warning – collapse | Carry two or three observers to GJ 915 Freeport (a passage: a berth each) | 2,800 cr |
| First light, twice | Research stations within three jumps of GJ 915 | Warning – its light reaching the station | See its first light from two systems, each within 3 minutes of its arrival there, the second at least 2 ly farther from Pyre: outrun the light through a lane | 3,600 cr |
| Read the black hole | Those stations from the lane opening, Pyre Remnant Station once open | Until its gas glows at less than 5% (about 7 hours after the breakout) | Scan the black hole from outside its tides, then back | 2,400 cr |

Each is on a board only from its moment until it lapses (`contract.posted`, `contract.until`), with
ids of their own (`.pyre-<kind>`). Pyre's stations post only Pyre's work. Observations use §25's
**Observe** (Pyre in another system's sky) and **Scan** (Pyre in its own system, or its black hole);
observers carried out with a ship caught at the breakout count as delivered at GJ 915 Freeport.

### 26.6 One save's own

The warning is kept in the save's world log, so a game loaded again has the same story. Saves may be
in Pyre's system or docked at its stations; they refuse a warning before Antares has gone
(`src/app/save/migrate.ts`).

### 26.7 Guardrails

`validateDoomed` (`src/economy/doomedGuards.ts`, run in `tests/unit/doomed.test.ts`): kept apart
(no id or name of the game's, nothing like a catalogue name, not in the jump network); beyond the
census by three light-years and within 40; its anchor the nearest system, in the frontier, with fewer
than five lanes, and clearly nearest, within a first long-range drive's reach; a red supergiant's
mass, absolute magnitude and size, enough mass to leave its black hole; brighter than Venus from
Earth; its supernova between the full Moon and the Sun in every system's sky, and its remnant fainter;
tides that tear a ship apart outside the horizon; a hull strain and a fading glow in range; a
timeline that runs forward, after Antares, its lane opening after the peak and its station after the
fade, and its light crossing the map within two hours; prices in range; work under the contracts'
ceiling, a party the passages take, a lane near it a pilot can outrun its light through, and gas
still glowing when its station opens; Earth's ozone estimates in order; and no line with a number of
its own or a field it cannot fill. The contract guardrails check every piece of its work (Pyre's
stations reaching the world through its one lane). The tests also break the rules to see them
caught, check that its id and name are in none of the real sky's data files, and check the physics,
the timeline, how it looks from each system, the News, radio and prices, saves, its own system alive
and gone (the black hole a fiction target, its tides an obstacle, the hull strained inside them, the
ship lost at the shadow, the autopilot stopping outside), the breakout rescue, the lane closing, the
rescue dock, its work (where and when posted, sound by the guardrails, shown only while posted, paid,
first light counted only fresh and farther out), its stations' markets, and its status line.

## 27. Lane encounters

Short choices that come up in flight, between the docks (`src/economy/lanes.ts`; the rules in
`LANES`, `src/content/lanes/rules.ts`; what is said in `src/content/lanes/lines.ts`). Like every
event in the world they are worked out, not rolled: each system's time is cut into slots of nine
minutes (`slotSeconds`), and a slot holds one encounter or none, with a chance by the system's
security (`chance`: 45% in secure space, 55% patrolled, 60% lawless), its kind one that fits the
system as it stood when the slot began, and everything about it (who, which ship, the pay, whether it
is a trap) drawn from the world's seed and the slot. A loaded game meets the same. The people, ships
and events are fiction, and every card says so.

| Kind | Where | Choices |
| --- | --- | --- |
| Mayday | Any system with a station | Go to them (the ship marked on the HUD, §31: flown alongside, a reward, 220–520 cr, and standing with the system's law; or, if it was bait, raiders lying dark by a decoy); fly on |
| Lifepod | Where raiders destroyed a hauler in the half hour before (§21) | Take the survivor aboard (the pod marked to tractor in, §31, then a passage to a station there, 260–420 cr; needs a berth); call it in (standing); leave it |
| Toll | Lawless systems where raider packs roam | Pay the toll (150/300/500 cr by the packs' threat): the Wake's packs there let the ship be until it docks, jumps or fires on them; refuse (they attack) |
| Customs | Systems with a law and security of 0.5 or more, a hold with contraband in it | Declare it (taken, half the fine); bribe the officer (35% of the fine; a sting one time in five: taken, a 600 cr fine, standing −8); dump it (standing −3) |
| Stranded scientist | Systems with a sight of the real sky (§23) and a research station within two jumps | A berth to the station (a passage at 1.25 times the usual fare, and a data core); spare them helium-3 (paid twice its base price); call a tow (standing) |
| Cargo adrift | Any system with a station | Return it (its pods marked to tractor in, §31, then a delivery to its owner for 60% of its base value and standing with its law); keep it (worth its full price); leave it. Bait: raiders lying dark by the pods |
| Lost trader | Any system with a station | Share your charts (they tell you a true price within reach, as a round in a bar would, §16); sell them a fix (60 cr); ignore them |
| Wreck beacon | Any system with a station | Mark it and go (a wreck to salvage, §31); log it for the salvors (standing +1 with the system's law); leave it |
| Old beacon | Two jumps or more from Sol | Mark it and go (an old derelict near a real body, to board, §31); report it (standing +1); leave it |

### 27.1 Meeting one

A pilot meets an encounter only once the opening delivery is done, never in Sol or at Pyre, at most
one a slot and one in fifteen minutes (`cooldown`), and only what fits the pilot too: a customs
patrol hails only a hold with contraband in it, and the Wake does not toll a pilot it trusts. The
first a pilot ever meets is never a trap, a toll or a customs patrol. In flight it hails only when
the ship is flying quietly: twenty seconds after a launch (eight after an arrival), no hostiles within
6 km, clear of the docks, not docking, in a lane or under a patrol's scan (`grace`, `quiet`). With
slots and the cooldown, a pilot touring the lanes meets one about every twenty minutes of flight.

### 27.2 The hail and the card

The hail never pauses the game (the owner's choice, 2 October 2026): it shows on the HUD under the
objective (violet for a call, red for the Wake, blue for the law), with **Answer** and how long it
waits: 45 seconds of quiet flight (`hailSeconds`), held while hostiles are near (*Not now: hostile
contact*). Answering (Q, the banner's button, the action button, or A on a pad; on touch, the action
button, as the HUD lies under the thumb zones) opens its card, which
pauses: who calls and what is happening, the risk the rules name, each choice with what it does or
why this pilot cannot take it (no berth, no room in the hold, not enough credits, no helium-3
aboard), and the fiction line. A number key chooses; *Not now* leaves the hail waiting. Let lapse,
most encounters just go; the Wake takes silence as a no and attacks, and a customs patrol scans
anyway (confiscating and fining in full, §12). Where an encounter may be a trap, the card names the
odds from the rules (*Maydays out here are sometimes bait: about one in four*), never whether this one
is (the owner's choice).

A pad works every card (and every other dialog): the D-pad moves between its buttons, A presses the
one in focus, B closes it.

### 27.3 What follows

Answers act at once: credits, standing, cargo in or out of the hold, fines on the record (§12), a job
taken on (a passage for a scientist, §23), a price learned. A mayday answered, a lifepod taken
aboard, cargo adrift claimed and the two beacons marked instead put a site on the HUD to fly to
(§31), with a job that steers there; bait is found out there, where raiders lie dark by a decoy.
Raiders called by a refused toll drop out of the dark a few kilometres off and hunt the ship (a pack
at the system's threat, §5). The journal keeps the last twelve encounters, where, and what came of
each.

### 27.4 One save's own

The save's world log keeps the encounters met (`world.lanes`, by slot): when, what, and the choice
made, the newest forty and none older than a day (`keep`). A slot met is never met again. Saves
refuse a record of an unknown kind or system, or one whose id does not name its slot.

### 27.5 Guardrails

`validateLanes` (`src/economy/laneGuards.ts`, run in `tests/unit/lanes.test.ts`): chances rising with
lawlessness; slots, cooldown and the hail's time in range; bait never in secure space and at most
three times in five; a sting, a declared share and a bribe in range, and a sting and a dump that cost
something; tolls rising with the threat; pay positive and under the contracts' ceiling; no contraband
adrift; lines with no number written in or field they cannot fill, short enough for the HUD (160
characters) and the card, and choices the engine knows; ship names their own. Over every system and
many slots: none in Sol, each kind only where it fits (a toll only in lawless space at the packs'
toll, customs only under a law, stations open and where they should be, a scientist bound for a
research station), traps only where the kind can be one, every kind somewhere, 25–65% of slots
holding one; and a quiet pilot touring the lanes meeting one every 15–25 minutes (the owner's
choice). The tests also break the rules and a line to see them caught, and check the world's slots
(the same every time, never in Sol or at Pyre), the pilot's gate, every kind's choices and what they
bring (rewards and bait, berths and fares, tolls and passes, declarations, bribes, stings and dumps,
berths and helium-3, cargo returned, kept or bait, fixes and tips), the words, the save, the hail in a
real flight (when it comes, written into the save, answered, lapsing) and its raiders and pass.

In browser tests lane encounters are off unless a test turns them on (the lanes test and the
screenshot audit do), since they would otherwise come up in other tests' flights.

## 28. Rival stories

Each of the six rival pilots (§24) has one story in a save, along one of two paths by how the player
stands with them (`src/economy/rivalStories.ts`; the rules in `RIVAL_STORY`,
`src/content/rivals/stories.ts`; what is said in `src/content/rivals/storyLines.ts`). A friend asks
for help and ends as an ally; an enemy opens a feud and ends it in a duel. The people, their words
and their stories are fiction.

| Rival | A friend's deed | An enemy's opening |
| --- | --- | --- |
| Mara “Quickstep” Venn | Escort | Customs tipped off |
| Bastian “Tally” Okonjo | Rescue | Customs tipped off |
| Ione “Lantern” Sallow | Rescue | Hired guns |
| Dax “Two Bells” Corrigan | Escort | Hired guns |
| Pell “Halfpenny” Arkwright | Escort | Customs tipped off |
| Saoirse “Sundown” Kalu | Rescue | Hired guns |

The owner chose (2 October 2026) that a story may hold a rival off their career for a while, that a
duel is fought in each pilot's own ship as it is fitted, and that each rival has one story a save,
with amends ending a feud.

### 28.1 A friend's story

- **The loan.** At standing 20 or more, once the player has known them two hours (from the first
  time the player sat at their table or met them in flight, `knownSeconds`), a rival asks at their
  table for a loan: 1,500 cr for a trader, 1,200 for a hunter, 900 for a runner (`loan.amount`). It
  comes back with 20% interest (`loan.interest`) when the first run they set off on after it docks;
  lending is worth 10 standing. *Not now* leaves the offer standing.
- **The deed**, once the loan is back:
  - *An escort* (Quickstep, Two Bells, Halfpenny): at their table, they ask the player to fly escort
    on their next run, to wherever it is bound, for 800 cr (`escort.reward`). It is an escort as the
    contracts' are (§10.2): their own ship sets off alongside the player, raiders of threat 2 come
    for it on the way, and it is done when it docks. They wait at their ship for up to three hours
    (`escort.wait`); left waiting, they fly alone and think less of the player (−10).
  - *A rescue* (Tally, Lantern, Sundown): their drive fails on the first run that sets off at least
    half an hour after the loan came back (`rescue.after`), 40% of the way along its longest leg.
    A distress call comes over the radio and a job with it: bring four ship components alongside
    within two hours (`rescue.qty`, `giveUp`), paid at their base price and 400 cr besides.
    Unanswered, they are towed home (−15).
  Done, either way, is worth 15 standing, and the story ends with a friend.
- **The ally.** Once the deed is done, at standing 40 (`ally.standing`; rounds bought for them now
  go up to it, not just to 30), they will fly on the player's wing when asked at their table: free,
  in a wing place, in their own ship with its stock fittings, until the player next docks, at most
  once every three hours (`ally.every`). An ally who is a bounty hunter hands their claims over for
  nothing (§24.4). Lost on the wing, an ally ejects and spends three hours refitting at home, and
  thinks no less of the player.
- Made hostile, a friend's story ends there, as a falling-out, and an ally on the wing leaves it.

### 28.2 An enemy's story

- **A feud** begins when something the player does makes a rival hostile (standing −30 or less) and
  they have no story yet. Its opening comes at the first turn of their career at least an hour
  later (`after`), at least two hours after the player met them (`sinceMet`), and once they are back
  in a ship if the player knocked them out.
- **The opening:**
  - *Customs tipped off* (Quickstep, Tally, Halfpenny): for two hours, in lawful systems within two
    jumps of the rival's home (`tipoff`), the next patrol in range scans the player whatever the hold
    holds, and so does any lawful dock, not only customs depots and military bases (§12). The first
    scan spends it, and the game says who tipped them off. A pilot with nothing to hide loses
    nothing.
  - *Hired guns* (Lantern, Two Bells, Sundown): for three hours, the first flight in a lawless system
    (security under 0.5) within two jumps of their home meets them 20–40 seconds in (`ambush`): two
    raiders of threat 2; a bounty hunter hires one and flies with them in their own ship. They want
    the player only, spare nobody the Wake trusts, pay no bounty and leave no salvage.
- **The duel** is posted at the first turn of their career half an hour after the opening is over
  (`duel.postedAfter`), and once they are back in a ship: a call over the radio and a job, open for
  two hours (`duel.open`). The rival waits 6 km off the jump beacon of the lawless system nearest
  their home (`offBeacon`). It is one on one: no raider packs come to that system while it is set,
  the player's wing holds its fire, and patrols leave the rival be. Each pilot flies their own ship as
  it is fitted (the owner's choice): the rival's with its stock fittings (a heavy fighter's seekers
  included), the player's with everything fitted. A weak ship would do well to stay away. The duel
  starts when the player comes within 1.5 km with at least 80% of their hull (`startWithin`,
  `minHull`; with less, the rival says to patch up first), or fires on the rival. Each side yields at
  35% of its hull (`yieldAt`), before a ship is lost.
  - The rival yields: the 1,000 cr purse (the job's pay), standing back to 0, and the feud is over.
  - The player yields, or leaves the duel once it has started (more than 5 km off, docking, jumping,
    or losing the ship): the 500 cr stake (all the player has, if less), standing at −10, and the
    feud is over.
  - Missed: the feud stands, unsettled, until amends.
  Firing on a rival who has yielded is a shot like any other (§24.5).
- **Amends** (1,500 cr, §24.5) end a feud at any point: before its opening nothing comes, and a duel
  posted is off.

### 28.3 Careers held

While a story holds a rival, their career (§24.2) pauses: waiting at their ship for the escort,
adrift after the drive failure (the run cut short there, its cargo lost to the markets), on the
player's wing, lying in wait with hired guns, at the duel's beacon. A run that would set off inside
a hold never sets off, and a hunter held lets its claim go. Afterwards the career picks up from
where the hold left them: the escort's destination, where the rescued run was bound (or home, on a
tow), the dock where the player docked with the ally, home after a feud's wait or its duel, home
refitting after a knock-out. The holds are worked out from the story and the rules, never stored,
and a career with no story is exactly what it was before stories.

### 28.4 What the world says

- **At their table**, a line on how the story stands (*Owes you 1,800 cr, back when their next run
  docks*; *Waiting for you at the beacon in Wolf 1061, until day 1, 14:05: a duel*), and what the
  story asks now, with its action and *Not now*. In the bar a rival's card carries a tag: *Story*
  when they have something to ask, *Ally*, or *Feud*.
- **Over the radio**, the rival: the loan back, the distress call, the challenge, the duel's start,
  yield or win, and the hired guns' arrival. **As notices**, the game: *Customs were tipped off:
  Mara “Quickstep” Venn told them to look you over.*, *Hired guns! Ione “Lantern” Sallow paid them to
  find you.*
- **The journal** has a *Rival pilots* section: each rival with a story, and how it stands.
- **The News** (within two jumps, over the last hour): a drive failure ended by a friend's parts or
  a tow, a duel called (while it is open), and how it went, or that nobody came.
- **The HUD** shows the duel's job as the objective, with the rival marked. A rescue or a duel
  posted while the player is flying in its system brings its ship into the scene at once.

### 28.5 One save's own

The save's world log keeps each rival's story (`world.rivals.stories`): its path and when it began;
a friend's loan (and when it came back), deed (when, its job, where the run was bound, where it left
them, done or not) and flights on the wing (the latest six); an enemy's opening spent and duel
posted and started; and how it ended (friends, towed, let down, ship lost, fell out; won, lost,
forfeit, missed, amends). A rival's standing keeps when the player first met them (`met`), and an
ally on the wing is a wingman marked `ally`. Saves refuse a story of an unknown rival or path, or
one with a bad time, station, system or ending.

### 28.6 Guardrails

`validateRivalStories` (`src/economy/rivalStoryGuards.ts`, run in `tests/unit/rivalStories.test.ts`):
a friend's story opening at friendly standing; an ally within reach of the loan and the deed alone;
loans and their interest, pay and costs in range; a drive failure on its leg; an ally asked at most
once a turn; a yield at 20–50% of the hull and a start well above it; a duel that starts closer than
it is forfeit; a purse under the contracts' ceiling and a stake no larger; a duel's ending that
leaves nobody hostile; windows (a rescue, an escort's wait, the openings, the duel) at least half
again the longest trip of any career; every rival with a story it can play (a lawless system within
three jumps to call the player out to, lawful or lawless space near home for its opening, runs for
its drive to fail on), every deed and opening among them; lines with no number written in, no he or
she, no name of their own, only fields they can fill, at most 300 characters; and every career held
by a story of each path over two days: no run setting off inside a hold, the next run setting off
from where its hold left the rival, and every run passing the careers' own guardrails (§24.7). The
tests also break the rules, the paths and a line to see them caught; hold careers with no story to
a fingerprint of what they were before stories (runs, whereabouts and hunters' claims over three
days); and check a friend's loan and its repayment, the escort (held, done, waited out), the rescue
(the drive failure, the distress, the parts handed over, the tow), the ally (asked, on the wing,
leaving at a dock, not again too soon, the wing full) and a friend's rounds and an ally's claims;
an enemy's feud (when it begins), the tip-off, the hired guns, the duel (posted, won, lost, missed),
amends, falling out, saves; and in a real flight an ally on the wing, the hired guns (when they
strike, who, no bounty), the duel (waiting, no packs, too battered to start, started, the rival's
yield, the player's yield, forfeit) and customs tipped off scanning a clean hold.

## 29. Defend your outpost

Raiders come for the player's own outpost (§22) now and then (`src/economy/outpostRaids.ts`; the
rules in `OUTPOST_RAIDS`, `src/content/outposts/raids.ts`; what is said in
`src/content/outposts/raidLines.ts`). The player defends it with turrets built from hauled
materials, with guards hired by the hour, or in person. The raids, raiders and guards are fiction,
and the Outpost window and the guards' dialog say so.

The owner chose (2 October 2026) that guards are hired at the outpost or from the Fleet window at
any full-service dock, taking up their post a quarter of an hour later; that a raid lost takes
income, market stock, a share of the goods stored there and a turret, never credits; and that
turrets are built from hauled materials.

### 29.1 When raids come

Like the world's events, raids are worked out, not rolled as the game runs. The outpost's time is
cut into windows of three hours (`window`), shifted by its site, and a window holds at most one
raid, striking somewhere in its middle half (`strike`), decided by the save's seed, the site and
the window. None come until the outpost has been open three hours (`grace`), none in secure space
(security 0.75 or more), none during a sweep of its system and none while the system's raider den
is dark (§14.3). The chance a window holds one is set by the system's band, as the trade computer
reckons routes (`odds`: thin space 30%, lawless 40%; every outpost site is in one or the other),
times the outpost's stage (`stage`: a frame half that, a port a quarter more); a raid under way in
its system (§11) raises it by half and the raiders' threat by one; a pilot the Wake trusts sees a
quarter as many. The raiders' threat is the band's (`threat`: 2), one lower against a frame, and
they come one more than their threat. The first raid is a probe: a single pair at threat 1, seen
half an hour off; in thin or lawless space the first window after the grace always holds it.

### 29.2 The watch, and the job

A quarter of an hour before a raid strikes (`warning`; half an hour for the probe), the outpost's
watch sees it coming: it says so over the radio, a notice gives the ships, the minutes and the odds
of holding (*Your defences will probably hold (72%).*), and a job, *Defend {outpost}*, shows in the
journal, on the star map's Missions and as the HUD objective with its countdown. The Outpost window
shows the raid watch and a bar of the odds.

### 29.3 Defences

- **Turrets**: one for each stage built (three at most), each from materials hauled to the outpost
  and handed over in its window (`turrets.needs`: ship components, machinery and electronics, then
  refined metals too), as the stages are. Each costs 15 cr an hour out of the income (`upkeep`). A
  turret knocked out in a raid is down six hours, or repaired there for 350 cr (`downSeconds`,
  `repair`).
- **Guards**, hired by the hour: two pilots looking for the work each posting (§8), with the
  wingmen's names, in the patrol fighters of the outpost's system's owner, steady (55 cr an hour) or
  sharp (70); at most two at once, for 2, 4 or 8 hours, paid up front, no refund (`guards`). They are
  hired at the outpost, or from the Fleet window at any dock with a market, repairs and a job board,
  and take up their post a quarter of an hour after hiring, just in time for a raid seen coming.
  Nobody guards for a pilot with a price on their head (fines of 1,500 cr or more, §12).
- **The system itself**: its patrol wings, and the player's friendly standing with its owner.

### 29.4 How a raid goes

- **With the player there** (in flight in its system when it strikes): the raiders come out of the
  dark 6 km off (from the system's den if it has one, otherwise from the jump beacon's side), half
  of them for the outpost's stores (a barge moored by it, its hull by stage: 600, 900 or 1,200), the
  rest for whoever defends it. The turrets stand on a ring round the outpost and turn their guns on
  raiders in range (1.6 km); the guards fly a loop round it and go for raiders near it (a guard hired
  for later joins the flight when their time on post comes, and says so over the radio); the
  player's guns never hit the outpost's own. Every raider down or gone, the raid is held; the stores broken
  open, it is lost and the raiders make off. Wake raiders pay their bounty as anywhere (§12).
  Undecided after half an hour, or left (docking, jumping, the ship lost), the clock decides it as
  below, with the raiders already downed counted.
- **Away**: the defence it had (`defence`: 2 for each turret up, 1.5 for a steady guard on post and
  2 for a sharp one, 1.5 for each patrol wing of the system, 1.5 for friendly standing with its
  owner) against the raiders' strength (`strength`: 2, 4.5 or 8.5 by threat); the chance of holding
  climbs with their ratio (`hold`: none undefended, 35% at half, 65% at even, 85% at half as much
  again, 95% at double, and never more). Three turrets against threat 2 hold about four times in
  five; with two sharp guards too, nearly always.
- **Lost** (`lost`): its income is halved for two, three or four hours by threat; its market is short
  of one good it trades as long (stock halved, the price a fifth higher); a quarter of each good
  stored in a hold leased there (§18) is taken; and a turret is knocked out. Never the player's
  credits.

### 29.5 What the world says

The watch over the radio (*{outpost} watch*) as a raid is seen coming, as it strikes and as it goes;
notices of how it went, away or there; the News within two jumps over the last hour; the Fleet
window's line on the outpost's defences; and in the Outpost window, its turrets (built, down,
repairs), guards (on post, coming, how long), the raid watch and the odds, and the last raids.

### 29.6 One save's own

The outpost's record keeps when it opened (`opened`) and its defences (`defence`): turrets built and
the materials toward the next, when each is down until, the guards hired (who, flying what, on post
from and until), the last eight raids (when, threat, held or lost, there or away, what was taken),
the window raids are settled to, the raid last warned of, and a lost raid's hurt (from, until, the
good). Raids are settled with the fleet (§18), in time order with the outpost's hours of income; a
raid due while the player flies in its system waits for the flight to decide it, and the hours
after it wait too. Saves refuse defences that do not fit the outpost (more turrets than its
stages), guards in no ship of the catalogue, and raids or hurts that make no sense.

### 29.7 Guardrails

`validateOutpostRaids` (`src/economy/outpostRaidGuards.ts`, run in `tests/unit/outpostRaids.test.ts`):
odds rising with lawlessness and the outpost's growth; a raid event and the Wake's trust moving the
odds the right way; threat and strength rising; a warning long enough to hire a guard in; a turret
for each stage, each needing something, with upkeep, repairs and knock-outs in range; guards'
terms and pay in order; a hold table that climbs and never promises more than 95%; a loss that hurts
without ruining; and the lines with no number written in, no he or she, and only fields they can
fill. Worked out over many windows of real sites and saves (`raidBalance`): an undefended port away
loses 10–35% of its income in thin or lawless space, under 10% where patrols fly; and in lawless
space a port's three turrets pay back their materials in 20–60 hours of income saved. The tests
also break the rules and a line; check the windows (none before the grace, the probe first, the
same for the same save, more raids as the outpost grows, a quarter for a pilot the Wake trusts), the
warning and its job, raids decided away (held by a strong defence, lost by a weak one, and what a
loss takes, never credits), a raid waiting for the flight, turrets (built one a stage, upkeep,
repairs), guards (offers, hire, on post a quarter of an hour on, at the outpost or a full-service
dock, never for a hunted pilot), saves, and in a real flight the turrets and guards by the outpost,
the raid striking at its time with half for the stores, a turret firing, the raid held to the last
raider, and lost with the stores, the raiders making off.

## 30. Your crew

Up to three people sign on aboard the ship the player flies: an engineer, a gunner and a navigator
(`src/economy/crew.ts`; the rules in `CREW`, `src/content/crew/rules.ts`; what they and the game
say in `src/content/crew/lines.ts`). Each makes a measured difference in flight, by grade and
morale; morale follows what the pilot does as each one's heart sees it; each has one small story.
The crew, their names and their stories are fiction, and every crew dialog and the hire dialog say
so. Hired wingmen (§15.4) are another thing: they fly their own ships.

The owner chose (2 October 2026) that every ship has crew quarters by its size, never shared with
passengers (fighters one, freighters and gunships three); that nobody dies (the hurt always mend);
and that three is the most aboard, one of each role.

### 30.1 Who signs on

Hands looking for a berth sit at the tables of a bar that gives full service, drawn per bar shift
(§16) from the world's seed, the same for every pilot: two engineers at a shipyard, two gunners at
a military base, a navigator at a relay or research station, an engineer at a mining outpost, a
gunner at a customs depot, one of any role at a trade port or free port (`offers.where`). A raider
den's one gunner, always a rule-bender, sits down only with a pilot the Wake trusts. Grades are
green (half of them), seasoned (35%) or veteran (15%); the three hearts come alike. Nobody signs on
with a wanted pilot, and stations not yet open have nobody at their tables.

### 30.2 What they do aboard

Each bonus is by grade (green, seasoned, veteran), scaled by morale: Low ×0.5, Steady ×1, High
×1.25 (`morale.factor`). A hurt crew member's skill does nothing until they mend.

| Role | Green / seasoned / veteran |
| --- | --- |
| Engineer | Mends each damaged system (§15.2) by 3 / 5 / 7 points a minute while no hostile is within 3.5 km, down to 20% (the rest wants a kit or a dock); the shield recharges 6 / 9 / 12% faster. |
| Gunner | Guns hit 5 / 8 / 12% harder; seekers and torpedoes lock on 20 / 30 / 40% sooner. |
| Navigator | Jump fees 8 / 12 / 16% lower; scans reach 10 / 15 / 20% further. |

At their best (a veteran in high spirits) the gunner and engineer add 15%, under one class step of
gear (18%, §4). The HUD's damage warning adds *(mending)* while the engineer works, and the engineer
says over the radio when they have done what can be done out there.

### 30.3 Quarters and wages

Crew quarters by ship class (`quarters`): light and heavy fighters one, couriers and surveyors two,
freighters and gunships three; never shared with passengers, whose berths are the cabins' (§23.1).
The player cannot sign on more than the ship has quarters for, nor buy, keep or switch to a ship
with too few for the crew aboard.

Wages are 30, 45 or 65 cr a game hour by grade (`wage`), all under a sharp outpost guard's (§29.3),
paid at each dock for the clock flown since the last (the clock stands still while docked).
Signing on costs two hours' wages. A wage the player cannot pay stays owed, and costs 30 morale at
each dock it stays unpaid.

### 30.4 Morale

0–100, starting at 55; Low under 35, High from 75 (`morale`). At each dock:

- **Their heart**: each deed since the last dock that it likes, +6; each it hates, −8; at most 15
  either way a dock. Soft-hearted: likes rescues (a ship in distress reached, a lifepod tractored in
  or called in, a scientist taken aboard, a stranded hauler's rescue done, a lost crew found, §31),
  hates leaving people adrift (a mayday passed by, a ship in distress or a lifepod let lapse) and
  attacks on lawful ships. Rule-bender: likes contraband sold and smuggling runs done, hates contraband lost to
  the law and attacks on lawful ships. Ex-patrol: likes raiders downed, hates tolls and bribes paid
  and smuggling (`hearts`, `laneDeeds`, `siteDeeds`, `jobDeeds`).
- **Everyone**: a dock at least ten minutes of clock after the last, +3 (up to 65); a round for the
  crew in the bar, +5 (30 cr a head, once a shift); treated +5; hurt −10; a dock passed hurt and
  untreated −5; the ship lost −20; unpaid −30; their story's tale +10, favour done +20, failed −20,
  let drop −10.
- **Notice**: Low at a dock, they give notice; still Low at the next, they leave there (their wages
  paid if they can be); happier, they take it back. Anyone can be let go at a dock. The journal
  keeps the last six who left, where and why.

### 30.5 Hurt in a fight

A hull hit that damages a system (§15.2) may hurt whoever works it: the gunner when the guns are hit
(50%), the engineer when the engines or shield generator are (35%); one hit of a tenth of the hull or
more may hurt the navigator (25%) (`hurt`). The rolls come from the crew's own luck, so a flight
without crew draws exactly as before. The ship lost (§10) hurts everyone aboard. A hurt crew member
says so over the radio, and mends after two hours of clock, or at once with the medic of any dock
that repairs ships (150 cr each). Nobody dies.

### 30.6 Their stories

Each crew member has one story of three beats (`stories`):

1. **Their tale**, told at the first dock after two deeds their heart likes with them aboard (three
   raiders down for the ex-patrol).
2. **A favour**, asked at a dock at least an hour on that has a place for it within reach; open to
   take for three hours and, taken, three more to do. Soft-hearted: carry their letter to the nearest
   farm or relay within three jumps, which keep lists of the lanes' lost (a visit). Rule-bender: run
   a sealed crate (two transponder spoofers, loaded when it is taken; a scan will find it) to the
   nearest free port within three jumps (a delivery). Ex-patrol: break the Wake pack their old wing
   never caught, three raiders of threat 2 lurking by a station of the nearest lawless system within
   two jumps (a bounty). A favour is an ordinary job (`cs.<crew id>`), flown with the machinery of its
   kind; it pays 350, 600 or 650 cr.
3. **The payoff**: done, a grade (a veteran keeps the pay and the cheer), and for the soft-hearted
   their friend found alive and standing with the station's owner (+5); failed or let drop, the morale
   it costs.

### 30.7 What the game says

The bar's *Looking for a berth* (hands with their role, grade, wage and heart; sitting down shows
what they do, what they care about and their terms), *Your crew* (each with their morale and tags:
Hurt, Notice, Story, Favour; their dialog has what they said last, what they do now with a morale
bar, the favour to take, treatment, a round and letting them go), the deck's crew line (*2 aboard ·
Steady · the gunner hurt, well in 1 h*) and its *Treat the crew* button, the journal's crew record,
notices at each dock (wages, notice, mending, stories), and the crew on the radio in flight.

### 30.8 One save's own

`aboard` (absent until the first is hired) keeps the crew (who, role, heart, grade, hired, wages
paid to, morale, hurt, notice, what they last said, their story), the clock and kills of the last
dock and the deeds counted since, the shift of the last round, and the last six who left. A favour's
job carries `contract.crew`. Settling twice at one dock changes nothing. Saves refuse an unknown
role, heart, grade or deed, two of a role or more than three, morale outside 0–100, wages paid
before hiring, a hurt that ends before it began, a favour to an unknown station, and more than six
who left.

### 30.9 Guardrails

`validateCrew` (`src/economy/crewGuards.ts`, run in `tests/unit/crew.test.ts`): bonuses positive
and rising with grade, and at their best under a class step of gear, a quarter off fees at most,
half again the scan range and half the lock time; a mending floor above nothing (docks still
matter); morale's bands and factors in order; wages rising and under a sharp guard's; quarters by
size; hurt odds between nothing and certain, mending between half an hour and six hours and a
medic no dearer than a system's repair; every heart liking and hating something, never the same
deed, every deed mattering to some heart, and lane deeds for encounters and choices that exist;
every role offered at five open stations or more, one in Sol; every favour with somewhere to go
from at least half the docks, time to get there and pay under the contracts' ceiling; crew names of
their own (clear of every other pool of names and every place); and lines with no number, no he or
she, no star, and only fields they can fill.

## 31. Wrecks to fly to

Lane hails and scans mark a **site** in flight, somewhere in the system to fly to
(`src/economy/wrecks.ts`; the rules in `WRECKS`, `src/content/wrecks/rules.ts`; the trails in
`MYSTERIES`, `src/content/wrecks/mysteries.ts`; what is said in `src/content/wrecks/lines.ts`; where
a site lies in `src/world/sites.ts`): a ship in distress to fly alongside, pods to tractor in (a
lifepod, cargo adrift, a lifeboat's recorder, a strongbox), a wreck to salvage (its log scanned, its
pods tractored in), or an old derelict to board. About one wreck or derelict log in three holds a lead
into one of three short trails across a few systems. The sites, their ships, people and logs are
fiction, and every card says so; a derelict may drift near a real planet or star, but nothing is
ever said about the body itself.

The owner chose (2 October 2026) that a marked site waits two hours of game clock and a trail's step
three, kept in the save and never closed while the pilot flies in its system; that a scan from beyond
two kilometres shows raiders lying dark by a hull and springs them there and then; and that only the
strongbox's trail ends in a choice.

### 31.1 Sites

Every site is worked out from its id, so the save keeps only what the pilot did there:

- `lane.<system>.<slot>`: a hail's (§27), its ship, person, trap and threat the encounter's own;
- `scan.<system>.<slot>`: a scan's find (§31.3);
- `mys.<trail>.1`: a trail's find (§31.6), worked out from the site whose log began it.

| Kind | What is there | Done when |
| --- | --- | --- |
| Ship | A ship in distress, at rest, a catalogue trader | Flown alongside (within 400 m, `reach`): its drive is back, and its job pays |
| Pod | A lifepod, cargo adrift split into 2–3 pods, or a lifeboat's recorder | Every pod tractored in |
| Wreck | A trader's hull, tumbling; 2–4 salvage pods of 60–180 cr, and one time in three a pod of 2–5 units of salvage, ship parts, electronics or machinery | Its log scanned and its pods tractored in |
| Derelict | A class 3 freighter, gunship or surveyor drawn 1.8–2.6 times its size and dark, near a real body; 250–600 cr of salvage aboard, and a data core half the time (if the hold has room) | Boarded |

A hail's site lies 8–18 km from the arrival point; a derelict or a scan's find 3–6 km off its body's
surface; always 6 km or more from any station (beyond where a hail may come) and 2 km from any
planet's or star's surface (`place`). Pods drift 60–150 m round their spot. The scene itself is never
changed. A site waits two hours from when it was marked (`open`), never closing while the pilot flies
in its system; then *another salvor got there first*, its job fails, and a ship in distress or a
lifepod let lapse weighs on soft hearts (§30.4). At most four are marked at once (`maxOpen`); a
hail's *go* choice is closed beyond that.

Each site rides on an ordinary job (`c.lane.<offer>` for a hail's, `site.scan.<system>.<slot>` for a
scan's, `mys.<trail>` for a trail's), so the HUD's objective, *Go to goal*, the star map's Missions
list, the journal and *Abandon* all work as for any other; abandoning costs no standing. A new
objective kind, `site`, is met when the site is done, and steers to it in its system.

### 31.2 From the lanes

A mayday's *Go to them* marks the ship, with a job paying the mayday's reward and +2 standing with
the system's law when it is reached (contract kind rescue, so soft hearts like it). A lifepod's *Take
them aboard* keeps a berth at once and marks the pod; tractored in, the survivor is aboard and the
passage pays at its station. Cargo adrift, returned or kept, marks its pods (2–3, summing its load);
returned, the delivery follows. A wreck beacon (weight 3, any system with a station) or an old beacon
(weight 1, two jumps or more from Sol, never at Pyre) marks a wreck or a derelict, or is logged for
the salvors or reported for +1 standing with the system's law. The card names the odds of danger
(*Raiders pick over wrecks out here: about one in two*), never whether this one is dangerous.

### 31.3 From a scan

Each system's time is cut into slots of twenty minutes (`scan.slotSeconds`). A slot may hold a find
(15% in secure space, 25% patrolled, 35% lawless): a derelict one time in three where derelicts may
be, otherwise a wreck, near one of the system's confirmed planets or its primary star. The first
manual scan of a planet, star or belt in that slot finds it (*Your scan picked up a faint return near
… Marked on your HUD*), once; never before the opening delivery, in Sol or at Pyre, or with four
sites marked. In browser tests finds are off unless a test turns them on, as hails are.

### 31.4 In flight

Sites show as a warm dashed diamond on the HUD within 30 km (always when the objective or selected),
a decoy as any ship in distress. *Go to* stops 120 m off a site's hull, inside the tractor's reach
and boarding range.

- **Scan**: a site within 3 km (`scanRange`, times the scanner and a navigator's share) offers
  *Scan* once a flight: a wreck's log is read (its card), and raiders lying dark by any site are shown
  and sprung if the pilot is beyond 2 km; otherwise *nothing lying dark nearby*.
- **The tractor**: a site's pods come in like any loot (cargo needs room in the hold; a lifepod's
  berth was kept); they wait where they are for as long as the site does.
- **Alongside**: within 400 m of a ship in distress, its drive is back: *Thank you: we can make the
  nearest dock from here.*
- **Boarding**: within 250 m of a derelict's hull, slower than 25 m/s, with no hostile within 3 km,
  the action button offers *Board* (E, A on a pad, the action button on touch). Held steady for eight
  seconds (the ship eased to rest, the seconds in the autopilot's line), it is boarded; pulling away,
  drifting off, a hostile coming near or *Stop* breaks it off.
- The wreck beacon and the old beacon speak on the radio within 5 km.

### 31.5 Dangers

- **Raiders picking a wreck over** (`danger.guard`: none in secure space, a quarter patrolled, a
  little over half lawless): as many as the system's threat level, seen on the HUD, holding their
  spot, paid like any Wake bounty. All downed, they do not come back; otherwise they are back, whole,
  next visit.
- **Raiders lying dark** by bait (a mayday's or cargo's, at the lanes' bait odds) or by a derelict
  (`danger.dark`: none, 15%, 35%): two or three, coming out by the hull when the pilot comes within
  2 km, or when a scan from further out shows them. A decoy's job fails (*a Hollow Wake decoy*):
  there is nothing there to gain. Sprung once, they never come again, and nobody remembers them
  lingering (§17).
- **A pilot the Wake trusts** is waved by (*Oh, it's you. Fly on, friend.*); a decoy still holds
  nothing, and guards let them salvage.

### 31.6 Trails

Reading a log (scanning a wreck, boarding a derelict) may offer a lead, on the log's card, to
*Follow the trail* or *Leave it*: none while a trail is under way; otherwise a trail never begun whose
start fits the site and whose places can be worked out from it; the first log a pilot ever reads
always holds one, later logs one time in three (`leads.chance`). Followed, the trail's job steers to
its find, then its ending. Every place comes from the starting site's id: the find a system the rule's
jumps on (never the start, Sol or Pyre) with an ending within reach of it, the ending the nearest open
station of its kinds within reach of the find. The lifeboat's trail can start from any wreck or
derelict, so the first log always holds a lead.

| Trail | From | Find | Ending |
| --- | --- | --- | --- |
| *The lifeboat of the …* | A wreck or a derelict | 1–2 jumps on: the lifeboat's recorder, adrift (a hauler took the crew aboard) | The nearest research station or relay within two jumps: 900 cr, +4 standing (a rescue) |
| *The …’s strongbox* | A wreck | 1–2 jumps on, security under 0.5: a wreck held by raiders at the system's threat, the strongbox and a salvage pod or two | Its insurers, the nearest lawful customs depot or trade port within three jumps: 1,200 cr, +5; or a fence at the nearest free port within three jumps: 1,800 cr, Hollow Wake +6 (smuggling) |
| *The sister of the …* | A derelict | 2–3 jumps on: the sister hull, near a real body, to board (its data vault whole) | The nearest research station within three jumps: 1,500 cr, +5 |

The strongbox's card offers both endings when it is tractored in; closed, it goes back to its
insurers. A trail's step waits three hours from when it opened (`open.step`), never closing while the
pilot flies where it leads; missed, it goes cold. Abandoned, it is dropped. Each trail comes once a
save, one at a time.

### 31.7 What the game says

The lane cards (two new kinds and the changed outcomes above), the site's name and subtitle on the
HUD, the beacons on the radio, notices (marked, found, sprung, bait, boarding, salvaged, reached,
done, lapsed), the log's card (its last entries, what was found, a lead or the strongbox's choice)
and the journal's *Wrecks and trails*: the trail under way or the last, where it stands, and the
newest eight sites, where, and how each ended. Lines never write a number, a star or he or she, and a
line that names a real body only says a site drifts near it.

### 31.8 One save's own

The world log's `wrecks` (absent until the first site is marked) keeps each site marked: when, where,
its kind, the pods taken, and whether its log was read, it was boarded, reached, its guards cleared or
its raiders sprung, and how and when it ended; each trail begun (the site it began from, when, its
step and when that opened, the strongbox's choice, how it ended); and the logs read. Finished sites
are kept for a day, the newest 24 (a trail's find while its trail is remembered); a scan's job goes
with its site. Saves refuse an id that names no system and slot, a hail's site marked before its slot
or a scan's outside its slot, an unknown kind, pods taken twice, a flag other than true, an ending
before the marking, a trail from anything but a hail's or a scan's site, a choice on any trail but the
strongbox's, too many sites, and a job steering to a site the log does not hold.

### 31.9 Guardrails

`validateWrecks` (`src/economy/wreckGuards.ts`, run in `tests/unit/wrecks.test.ts`): dangers and
finds rising with lawlessness, never a trap in secure space, at most three in five; windows long
enough for the trips they ask for (one and a half times a jump there and back for a site, the longest
step for a trail) and no longer than six hours; sites clear of the docks a hail must be clear of;
boarding inside a ship in distress's reach, and between four and twenty seconds; raiders lying dark
sprung inside a scan's reach; pods, salvage and pay in range and under the contracts' ceiling, a
fence paying more than the insurers but at most 1.6 times as much; derelict hulls from the catalogue;
no contraband in a wreck; crew deeds for things sites do. The words: no number, no he or she, no star,
only fields they can fill, short enough for the HUD, the radio and the card; a real body only ever
something a site drifts *near*, *by* or *off*, and no word about it (orbit, surface, atmosphere,
water, life, moon, mass, temperature, discovered, giant and the like); the fiction line; wreck names
of their own. Over every system and many slots: none in Sol or at Pyre, every site clear of docks and
bodies, a derelict near its body, every kind somewhere, each trail able to start from at least half
the systems where its starting kinds occur, a wreck's salvage under a recovery contract's pay, and a
quiet pilot touring the lanes (scanning a body once a visit) meeting a wreck or derelict every 12 to
90 minutes. The tests also break the rules and words to see them caught, follow each trail to its end
(both of the strongbox's), and fly the sites in a real flight: hulls and pods there, a log scanned,
pods tractored in, raiders lying dark sprung near the hull or by a scan from further out, guards
holding their spot, a derelict boarded and boarding broken off, a ship in distress reached.

## 32. Ranks that open doors

Standing and a record now earn a rank with each faction, and a rank opens doors
(`src/economy/ranks.ts`; the rules in `RANKS`, `src/content/ranks/rules.ts`; what is said in
`src/content/ranks/lines.ts`). The factions, their ranks and their ceremonies are fiction, and the
promotion card says so.

The owner chose (3 October 2026) that a rank needs standing and a record in either of two ratings the
faction values; that it falls a step when standing drops ten below what earned it; and that the
Wake's ranks and the law's are independent of each other (crimes already cost lawful standing, which
does the closing).

### 32.1 The ladders

| | Rank 1 | Rank 2 | Rank 3 | Record in |
| --- | --- | --- | --- | --- |
| Sol Transit Authority | Bonded Carrier: standing 15 | Lane Officer: 40 | Lightkeeper: 70 | trade or combat |
| Frontier Cooperative | Field Hand: 15 | Shareholder: 40 | Elder: 70 | exploration or trade |
| Hollow Wake | Cold Hand: 20 | Pack Leader: 45 | Long Shadow: 75 | combat or trade |

The better of the two ratings (§13.2) must reach Blooded, Dealer or Drifter for rank 1; Hardened,
Broker or Pathfinder for rank 2; Veteran, Magnate or Surveyor for rank 3 (`record`). Rank 2 begins
where Trusted standing does.

### 32.2 Promotions and falls

- **Promotions** come at the pilot's next dock of the faction's own: one of its open stations that
  takes them in fully (not an emergency berth, not one the Wake holds), or, for the Wake, a den that
  takes them in. The pilot goes straight to the highest rank earned, with one card: the rank, a short
  ceremony, what it opens, and the fiction line. Ranks settle after the contracts at a dock, so work
  finished there counts.
- **Falls**: a rank holds while standing stays no more than ten below what earned it (`keepMargin`);
  below that, it falls a step (and another, if standing has fallen below the next one's too). Its
  perks drop at once; the save follows at the next dock, with a notice.
- **Hunted**: while a lawful faction hunts the pilot (fines it knows of, or Hostile standing), that
  rank's perks wait; the rank is kept.

### 32.3 What a rank opens

| Rank | With the law (at its own stations) | With the Hollow Wake |
| --- | --- | --- |
| 1 | Commissions on its boards (§32.4); 4% off ships and equipment at its yards; the rank named in the News, on the deck and in the greeting | Crew jobs on den boards; 4% off Wake Salvage gear and hulls at free ports and dens; the News at dens and free ports |
| 2 | 8%; its docks clear the pilot in even with raiders near (traffic control says so on the radio) | 8%; raids on the pilot's outpost (§29) come half as often |
| 3 | 12%; one more contract in progress at once (six) | 12%; six contracts |

Market prices (§16 and standing's own), repairs, ammunition and kits are untouched. Trade-ins,
resale and insurance stay on list prices, so at the top discount a ship or piece of gear bought and
sold straight back still loses 18% of its price. Cleared in under fire lifts only the dock's refusal:
jumping with hostiles near, hunters and fines are as before.

### 32.4 Commissions

Each lawful station's board, and each den's, posts one commission for its owner's ranks: work of a kind
it gives its own (the Authority's escorts, bounties, parcels and freight; the Co-op's surveys,
supplies, escorts and recoveries; the Wake's smuggling, piracy and parcels), not already on the board,
paying a quarter more and +2 standing with the owner. Difficulty 1 and 2 need rank 1, difficulty 3
rank 2. Below the rank the card shows locked, with the rank it needs (*For a Bonded Carrier of the Sol
Transit Authority or above*): a door the pilot can see. Commissions never chain to a follow-up.
Independent stations post none.

### 32.5 What the game says

The promotion card (`rank-dialog`), a notice for a fall, the rank on the deck under the station's
name and in its greeting (*Welcome back, Lane Officer.*), the News within two jumps for two hours (the
Wake's only at dens and free ports), the job card's tag (*Bonded Carrier and up*), the yard's note
(*Lane Officer of the Sol Transit Authority: 8% off ships and equipment here.*), traffic control
clearing a ranked pilot in, and the journal's *Ranks*: each faction's rank, what it opens now (or that
its perks wait), and what the next needs, with the pilot's own numbers. The Wake's row shows once
the Wake trusts the pilot.

### 32.6 One save's own

`ranks` (absent until the first promotion) keeps, for each faction, the rank given or fallen to, when
and where, and whether it came by a fall (the News tells only promotions). Eligibility, perks,
commissions, discounts and the News are all worked out from it, the standing and the ratings.
Settling twice at one dock changes nothing, and an older save is promoted at its next dock. A
commission taken keeps its `requires.rank`. Saves refuse an unknown faction, a rank outside its
ladder, a time after the clock, an unknown station, and a commission needing an unknown rank.

### 32.7 Guardrails

`validateRanks` (`src/economy/rankGuards.ts`, run in `tests/unit/ranks.test.ts`): three ranks a
ladder with standing rising within 1–90; a lawful rank never held by a wary pilot and over the boards'
gate, a Wake rank never by one the Wake does not trust; a margin smaller than the gap between ranks,
so a fall is a step at a time; records rising and within the ratings' ladders; discounts small (15% at
most) and rising, and never enough for a ship or gear bought and sold back to lose under 15%, or a
ship lost insured to pay back near its price; perks from a rank that exists, one more contract at
most, the outpost's odds between nothing and all; commissions paid a tenth to a half more and worth
up to 3 standing, needing ranks that rise with difficulty, of kinds the boards make, never outlaw work
for the law and some for the Wake; promotions told for half an hour to six hours, within the News'
reach. Names unique, no standing tier, rating or crew role, sharing no word with a station, system,
faction or character, at most 16 characters; lines with no number, no he or she, no star, only
their fields, and short enough for the card, the radio, the greeting and the News. Over the world:
each lawful faction's discount at three yards or more and the Wake's at two; over eight time slots of
every board, at most one commission a board, only at the owner's own stations, with the id that says
so, the rank its difficulty needs, kinds its faction gives, pay under the contracts' ceiling, its
standing and no follow-up; and commissions on 60% or more of each lawful faction's boards and half the
dens'. The tests also break the rules and a name to see them caught, and check the ladders' exact
thresholds, promotions only where they should come (straight to the highest, once), falls a step at a
time and perks waiting while hunted, the discounts charged on gear, ships and ships kept (and never a
profit to sell back), commissions locked and open, never chained and never a rival's, the sixth
contract, the Wake's outpost and the News, the save, and a ranked pilot cleared in under fire in a
real flight while another is refused.

## 33. Races on the lanes

Racing clubs at stations in well-policed systems hold a Sprint round a real planet, moon or star and a
Run between docks, heat after heat, and the club's racers and rival pilots really fly the gates beside
the pilot (`src/economy/racing.ts`; the courses in `src/world/courses.ts`; the racers in
`src/world/racingPilot.ts` and `src/world/RaceRun.ts`; the rules in `RACING`,
`src/content/racing/rules.ts`; what is said in `src/content/racing/lines.ts`). The clubs, their gates,
racers and records are fiction, and every screen that shows them says so; the bodies the courses round
are real, at their schematic places in the scene.

The owner chose (3 October 2026) that the other racers are real ships flown in the scene, not ghost
times; that hulls race in two classes, light and heavy, on raw time; and that racing pays fees and
purses kept below trading, a one-off purse for a course record and two milestones, and earns a fourth
rating, Racing.

### 33.1 Clubs and courses

A club sits in each system at least 0.5 secure (never Pyre) with an open lawful or independent station
to host it (the system's hand-made station, else its first open station by `venues.prefer`) and room
for both its courses: sixteen clubs, Sol's among them. They take their names in the systems' order and
a level from 1 to 3 drawn from the host (Sol's is a novice club). Epsilon Eridani has none (its belt
rings the star) and nor has Luyten's Star (its two docks sit too close together for a Run).

| | Sprint | Run |
| --- | --- | --- |
| Where | a ring round the real body nearest the host dock, 1.5–3 km off its surface (a star's counted at 1.3 radii), 200–300° of it | from 1.4–2.2 km off the host dock's bay, round a body on a ring 2.5–6 km off its surface, to off the system's farthest other dock (or back by the host) |
| Gates | 6–8, the start and finish lines included; legs 0.9–3.3 km | 6–12; legs 2–10 km |
| Length | 9–24 km | 25–80 km |
| Gate radius | 140 m | 260 m |
| Cruise | sealed | allowed |

Every gate stays 1.5 km off any star's or planet's surface (every leg 800 m), 900 m from the next, 1.8
km from any station and from any outpost a pilot might build there (§22), 400 m from a lane, outside
every belt, and no turn at a gate is sharper than 110°. A course is laid from its id: ring sizes, tilts
and starting angles are tried in an order drawn from it until all of that holds. Gate positions are kept
relative to the body the course rounds, so Sol's courses keep their shape as Earth goes round the Sun:
the Moon Loop rounds the Moon (which keeps its place by Earth), and Halcyon Ring's Run is a ring above
Earth, both checked clear in Sol's scene on 72 dates across a whole Earth–Mars cycle, since its docks
and lane move with the planets.

### 33.2 Heats, classes and fields

- **Heats**: the game clock is cut into heats of half an hour. An entry is for the heat under way if
  five minutes of it are left, else the next; either way the pilot may start as soon as they are in the
  start box. A pilot races once a heat, anywhere. An entry whose heat closes before a start lapses, its
  fee kept.
- **Classes**: light (couriers, light fighters, surveyors) and heavy (heavy fighters, gunships,
  freighters), by the hull. An entry is for the class of the ship the pilot flies; launching in the
  other class's hull voids it. Times are raw: a fast hull wins more.
- **Members**: six per club and class, named from the bars' own pools, flying hulls of the class sold
  at lawful yards at the club's tiers (level 1 Mk I, level 2 Mk I–II, level 3 Mk II–III), at skills of
  0.80–0.92, 0.86–0.98 and 0.92–1.04.
- **The field**: five racers. Up to two are rival pilots (§28) of the class docked in the club's system
  as the heat opens, unless they are out for the pilot; club members are the rest, each with a form of
  ±0.02 that heat. The same heat has the same field for every pilot.

### 33.3 The racing pilot

Every racer, club member or rival, is flown by the racing pilot in its own ship with stock fittings,
on its own fixed step of 1/60 s, reading nothing but its own ship and the course: not the pilot, not the
frame. So a heat's times are the same on every device, at any frame rate or time scale (a unit test
flies one heat in four patterns of frames and gets the same times to the step). Skill sets the reaction
off the line (1–0.2 s), the throttle (92–100%), the stick's reach (70–100%: 70% is what touch steering
manages), how far it leans through a gate toward the next (0.15–0.5 of the radius), its line's error (up
to 0.55 of the radius at the lowest), boost while energy is above 50–25%, when it drops out of cruise
short of a gate, and the chance of a moment off the throttle at a gate (30% to 2%, half a second to
two). Each racer keeps a lane of its own across the gates.

Racers pass through the pilot and each other and never touch rocks; nobody's guns fire. When the pilot
crosses the finish line, racers still flying are flown on to the finish from exactly where they are,
copies of themselves on the same steps, for the card; and then they really get there in those times.
Past the line they ease off and are gone after 20 seconds.

### 33.4 Flying a race

- **The start**: in the start box (within 450 m behind the start line, slower than 30 m/s), the
  action offers **Start** (E, the action button on touch, A on a pad). The marshal
  counts three; crossing the line before *Go* is a false start, back behind the line. The pilot's clock
  runs from *Go* and stops while the game is paused.
- **Gates** count in order. Crossing one's plane outside it, but near, says *Missed gate n: turn back
  for it*: no penalty but the time it takes; a gate taken out of order does not count.
- **Sealed** from the countdown to the finish: guns and launchers, cruise on a Sprint (the touch cruise
  button struck through), Go to, lanes and docking. No hails, raider packs, patrol scans or discovery
  cards while a race is staged; a discovery waits for the finish.
- **Retire**: held under 5 m/s for three seconds, the action offers it. Jumping out retires; losing the
  ship loses the run; the marshals close the course at three times the class's par.
- **The HUD**: a race strip in the objective panel's place (the course, gates passed, the clock, the
  split against the pilot's best or par with *ahead* or *behind*, the place on the road), the next gate
  and the one after marked with a double ring (the start box before the start), and on a narrow screen
  only the racers just ahead and just behind marked.

### 33.5 Par, records and pay

- **Par**: the racing pilot at skill 1, clean, in the class's reference hull (Halden courier Mk I,
  Halden freighter Mk I) is the class's par, which the cutoff counts from. The pilot's own par is the
  same pilot in their ship as fitted, shown in the window and used for the split until there is a best.
- **Records**: a course's record in a class is the best its members, or the rival pilots who race there,
  could fly it, clean at their very best, bettered by 1–3%: no racer in a heat ever beats it. The board
  shows its holder, or the pilot once they beat it. These times are worked out between frames when the
  window opens (a dash until they are).
- **Pay**: the fee and purse are 60 and 450 credits for a Sprint, 120 and 900 for a Run at a level-3
  club, and half and three quarters of that at levels 1 and 2; places one to three take all, 40% and 20%
  of the purse. Beating a course record pays 300 credits more, once per course and class. At the most,
  a winner at fast clubs clears (900 − 120) × 2 = 1,560 credits an hour, below the middle of hauling and
  trade. Prizes do not count toward the Trade rating. Each rival in a heat the pilot finishes thinks a
  little better of them (+2, up to 30).

### 33.6 The Racing rating

Points for each course and class raced, times the club's level: one for each heat finished, two more for
each podium, three more for each win, five for holding its record. A win at a fast club is worth 18, at a
novice club 6. The ranks are Onlooker, Rookie (10), Contender (40), Pacesetter (120), Laureate (250) and
Champion (450). The milestones *First heat won* and *A course record set* are earned with it, and *Top
rank in a rating* counts Racing. The factions' ranks (§32) do not ask for it yet.

### 33.7 What the game says

At a club's station the bar has **Races** (`races-window`): the club and its level, this heat and the
pilot's class, an entry under way, each course's card (its length, gates, fee and purse, the pilot's
par, the record, their best, this heat's field in their class with rival pilots tagged, and Enter or
why not) and the record board (each course and class: the record and its holder, the pilot's best and
in what, and how they have done). The result card (`race-dialog`): the place and time, the prize, the
record purse, a personal best, the rating's points and the whole field. The News within two jumps for an
hour tells the pilot's wins and records; the journal has *Racing* and the fourth rating row. The marshal
and rival pilots talk on the radio at the start.

### 33.8 One save's own

The world log's `racing` (absent until the first entry) keeps the entry open (course, class, heat,
when, fee), the last heat raced, for each course and class the runs, finishes, podiums, wins, best (time,
ship, when) and when its record purse was paid, and the last twelve results (place of how many, time,
prize, who won, or how it ended: retired, cut off, lost, lapsed or void). Clubs, courses, members,
fields, the racers' flying and times, par, records, prizes, the rating, the board and the News are all
worked out. A race under way is not saved: loading a save made mid-race puts the pilot back before the
start, the entry still open. Saves refuse an unknown course or class, a heat after the clock's or one
already raced, counts that do not add up, times no ship could fly, prizes over the purse, more results
than are kept, and two results in one heat.

### 33.9 Guardrails

`validateRacing` (`src/economy/racingGuards.ts`, run in `tests/unit/racing.test.ts`): heats of 20 to 60
minutes; ranges in order; gates at least ten times the widest hull (and 200 m on a Run), six radii
apart, no turn sharper than 120°; a start box wider than a gate, a countdown of two to five seconds, a
cutoff of two to four times par; every hull class in exactly one class with a reference hull of its
own; levels rising in tiers, skill and purse; a record a little better than the best racer; the racing
pilot's stick never below touch's reach, its error and slips small; a field of four to eight with at
least three club racers; fees at least a tenth of their purse, purses at most a quarter of the
contracts' ceiling, places falling, no more than 2,000 credits an hour, all record purses together under
the sky's grant; the Racing ladder six ranks rising from nothing, named like no standing, rank, rating or
crew role. Words with no number, no he or she, no star, only their fields and short enough; club names
unique, sharing no word with a station, system, faction, character, rival pilot or rank. Over the world:
ten to twenty clubs in well-policed space, Sol's among them, two novice clubs within three jumps of Sol
and clubs at every level, at least three for each lawful faction, and a club for every rival pilot;
every course clear in its scene and flown by the racing pilot in each class's fastest and slowest hull
inside the cutoff, the slowest also at the lowest skill with the stick held to touch's reach, never within
300 m of a star's or planet's surface; and in sampled heats of every course and class, no racer beating
the record and none failing to finish, while a pilot of the racing pilot's skill wins 30–90% of novice
heats in a Mk I hull, 15–65% of club heats in a Mk II hull and places in 50–97% of them, places in 5–60%
of fast clubs' heats in a Mk II hull and (almost) never wins one in a Mk I. The tests also break the rules
to see them caught, and check crossing a gate (the right way, inside, a near miss, a fast step), fields
that are the same every time with rivals of their class and none out for the pilot, par with its splits,
a heat flown the same at any frame rate with the times worked out ahead coming true, a false start, the
entry's locks and the fee, a lapse, a finish placed, paid, recorded and rated with the record purse once,
the News, the milestones, the save and a damaged one refused, and in a real flight the start from the
box, cruise and the autopilot sealed, and Retire.

## 34. Wing command

The wing on the pilot's pay (§15.4) takes six orders from a card that pauses the game, and its pilots
grow with every fight beside the pilot, come to trust (or not) the one who pays them, and are hurt,
picked up and treated (`src/economy/wing.ts`; the orders in flight in `src/world/WingCommand.ts`; the
rules in `WING`, `src/content/wing/rules.ts`; what is said in `src/content/wing/lines.ts`). The
wingmen, their insurers and their words are fiction, and the card, a word with a wingman and the
journal's wing say so.

The owner chose (4 October 2026) a paused order card (the Wing chip on touch, V then 1–6 on a keyboard,
Back held on a pad); that nobody on the wing is lost for good (shot down, a wingman ejects, is picked up
and rejoins at the next dock, hurt unless treated); and that wingmen learn from the fights they fly and
the raiders they down, at most four points a flight, through four grades that stay below a raider's aim.

### 34.1 The orders

| Order | What the wing does |
| --- | --- |
| Engage at will (the default) | Takes on raiders within 3 km of the pilot that are fair game: not one sparing the pilot, a duellist, a bounty hunter, or a den's reactor while a turret stands. |
| Attack my target | Goes for the selected ship if it is fair game or going for the pilot; otherwise as at will. |
| Defend my target | Guards the friendly ship selected (not a wingman): keeps station 220 m off it, goes for raiders going for it within 4 km, then any within 1.8 km of it, and drops a chase 2.5 km from it. |
| Cover the hauler | As Defend, for the ship the pilot escorts (a convoy's ships shared out, one wingman each in turn), else the pilot's own hauler in the system, else a hauler sending a mayday within 7 km, else the stranded ship of a rescue; chosen again each second. |
| Hold here | Holds the point where the pilot was: fights raiders within 1.5 km of it, or any going for them, and drops a chase 2.5 km from it. |
| Break off and form up | Stops fighting and flies back to its slots off the pilot's wing, boosting from more than 1 km out. |

- **The card** (`wing-orders`) opens with V (then 1–6, or a click), the Wing chip on touch, or Back
  held for 0.4 s on a pad (Back tapped opens the star map as it lets go). It pauses the game as a hail's
  card does, lists the wing (grade, hurt or not), and gives each order with what it does, or why not
  now: *Select a friendly ship first*, *That one is hostile: use Attack my target*, *No hauler here to
  cover* (a locked order is dashed). On a phone held sideways the six sit in three columns, all in
  view without scrolling. The lead hired wingman answers on the radio, *If you say so* first when wary of the pilot,
  *Right with you* when loyal. The HUD's wing row says *Wing 2 · Hold · 1 hurt*; the touch chip says
  *Wing · Hold*, with a dashed border while someone is hurt.
- **Anchored**: under Defend, Cover and Hold the wing does not catch up with a pilot far off; the order
  ends, the wing forming up and saying so, when the ward is lost or the pilot is 8 km from the ward or the
  point. A guard or a hold ends at a jump; the other orders carry over one. Each launch from a dock starts
  at will.
- **Reacting**: a wingman takes on a new foe after a moment by grade (1.2 s to 0.4 s). Nobody fires in a
  duel (§28), while hurt, or while the pilot docks or jumps. Allies (§28) take the orders too, but keep no
  record of their own.

### 34.2 Grades

A hired wingman's points are the fights flown and raiders downed beside the pilot, and four more for a
sharp hire. Grades: *Steady hand* (from 0), *Sharp shot* (4), *Seasoned wing* (12), *Veteran wing* (28).

| Grade | Guns (×) | Aim | Reacts | Jinks when the shield fails |
| --- | --- | --- | --- | --- |
| Steady hand | 0.30 | 0.60 | 1.2 s | 50% |
| Sharp shot | 0.38 | 0.66 | 0.9 s | 60% |
| Seasoned wing | 0.41 | 0.72 | 0.6 s | 70% |
| Veteran wing | 0.44 | 0.76 | 0.4 s | 75% |

A raider's guns are 0.25 of the catalogue's, aim 0.8 at standard difficulty and jink 80% of the time: a
veteran still aims and jinks worse, and two veterans fire less than the biggest raider pack. A fight
counts once for each pack, for each hired wingman who took that pack on and was within 3 km of one of its
raiders as it went down; a down counts for the wingman whose guns last hit the raider; at most two fights
and two downs a flight. So a sharp hire is a veteran in six flights at the very best, a steady hand in
seven.

### 34.3 Fees, trust and leaving

- **Fees**: the hire's base (§15.4) times 1, 1.25, 1.45 and 1.7 by grade, to the nearest 5 credits; a
  loyal wingman asks a tenth less. A new grade's fee starts at the next dock, with a note.
- **Trust** runs from 0 to 100, starting at 50: *Wary* under 30, *Loyal* from 70, *Easy* between. A
  fight beside the pilot adds 3, being treated 5; a dock passed hurt and untreated (from the second)
  takes 5, a bad hit 5, being shot down 10 and flying on credit 15. Loyalty takes seven fights or so.
- **Pay**: every jump pays the wing; one shot down and waiting to rejoin is not paid. A wingman the
  pilot cannot pay leaves, unless loyal: then they fly on credit, owed at the next dock, and leave if
  it is still not paid.
- **Notice**: at a dock a wary wingman gives notice, and leaves at a later dock if still wary; trust
  back above 30 withdraws it.
- The journal remembers the last six who flew with the pilot, and why they left: let go, unpaid or
  unhappy.

### 34.4 Hurt, down and treated

- **Hurt**: a hired wingman whose hull falls under 40% says so and holds back from fights, keeping
  station, until they mend (two hours of game clock) or a medic at any dock that repairs ships treats
  them (150 cr).
- **Down**: a hired wingman whose ship is destroyed ejects and is picked up, and rejoins at the next
  dock in a new ship from their insurers, hurt for four hours (300 cr to treat). Nobody is lost for
  good.
- The outfitter's **Treat your wing** sees to everyone hurt at once.

### 34.5 What the game says

The bar's *Your wing* lists each wingman with their grade, ship, fee and tags (*Hurt*, *Picked up*,
*Notice*, *Owed*, *Loyal*, *Wary*), Dismiss (or Part ways for an ally), and a word with them
(`wing-dialog`): what they say, by what they remember last (a fight, being treated or not, being shot
down, being paid late, a raise, flying on credit) and how they feel, their record and the points to
their next grade, and how they feel as a bar. The journal has *Your wing* and those who flew with the
pilot before. Notes at a dock: rejoined, mended, a raise, notice given, gone, credit paid.

### 34.6 One save's own

Each hired wingman on `crew` keeps fights, downs, trust, what they remember last, a hurt (when, until,
docks passed, shot down, since a loss), notice and fees owed, all absent on a new hire and in older
saves; `wingFormer` keeps up to six who have left. Grades, skills, fees, bands and words are worked
out; the order given and what the wing earns are kept only for the flight. Saves refuse an ally with a
record, counts that are not whole, trust outside 0–100, an unknown memory, a notice or hurt from the
future, nothing owed marked owed, a former wingman still on the wing or in an unknown ship, and more
former wingmen than are kept.

### 34.7 Guardrails

`validateWing` (`src/economy/wingGuards.ts`, run in `tests/unit/wing.test.ts`): a guard's and a hold's
distances in order, released beyond them, a mayday covered inside the release, at will within the
catch-up; four grades rising from nothing, a sharp hire one up, the top five to twenty flights away;
every skill better with each grade, the first two hitting as the hiring board says; at most four points
a flight, counted within reach; a veteran aiming and jinking worse than a raider, hitting under twice a
raider's guns, and a full veteran wing firing less than the biggest pack; fees rising with grade, never
doubling, a loyal discount up to a quarter; trust bands in order, loyalty taking four fights or more, one
loss not making a new hire wary, flying on credit not making a loyal one wary; holding back between 20%
and 60% of the hull, a loss slower to mend and dearer to treat, a medic no dearer than a repair (two after
a loss). Words with no number, no he or she, no star, only their fields and short enough (an order's
short label eight characters for the chip), something to say for every memory and band, and grade names
of their own. The tests also break the rules to see them caught, and check the grades, fees and the
hiring board, trust, hurts, a loss, rejoining, mending, treatment, a raise, notice, credit, pay, the
journal's six, what they say, the save and damaged ones refused; the orders on their own (carrying over a
jump, locks, reaction, guards and holds, releases, forming up, earning with its caps); and in a real
flight the grades launched, reaction by grade, holding back when hurt, holding a point, covering an
escort and a raider downed and a wingman picked up. A gamepad test checks Back tapped and held.

## 35. The border in sight

The border war (§20) is now fought where the pilot can see it: in a front's systems, the front's
faction and the Hollow Wake meet in **clashes** off the jump beacon while the front fights, and when
the exposed station is about to fall or be retaken a **turning battle** is fought at the station
itself (the schedule and outcome in `src/economy/battles.ts`; the battle in flight in
`src/world/BorderBattle.ts`; the rules in `BATTLES`, `src/content/border/battles.ts`; what is said
in `src/content/border/battleLines.ts`). Like the war, every battle is fiction, and the battle strip,
the battle line's marker and the journal say so.

The owner chose (4 October 2026) that a battle won with the pilot's help pushes the tide (a turning
battle as much as a war contract, a clash a third of that, fading like any deed), so a pilot can hold
a station for hours but not for good; that both clashes and turning battles are staged; that the
pilot fights on the law's side unless the law hunts them or the Wake trusts them, and whoever they
fire on treats them as an enemy; and that a battle won pays a purse and a little standing, below a
war contract's pay.

### 35.1 Clashes

- **When**: the game clock is cut into slots of 20 minutes. In each slot each system of a front at
  war may hold a clash, drawn from the seed, the front, the system and the slot: in a **skirmish** in
  both its systems (60%), in a **blockade** or with its station **fallen** in the lawful system (50%,
  40%: the law trying the Wake's lines), and with the Wake **pushed back** in the den's system (40%:
  the law's patrols hunting near the den). A system on two fronts (Lacaille 9352) holds at most one
  clash a slot. A front settled for good (§20.5, §20.7) or at a truce holds none.
- **Where**: the **battle line**, on the way from the system's jump beacon to what each side holds:
  in the lawful system toward the exposed station (or, with none, the faction's first station with
  repairs), in the den's system toward the den; 35% of the way, between 3 and 6 km from the beacon,
  and at least 5 km from the den, so it does not wake.
- **Who**: the front's faction's patrol fighters against Wake raiders matched to them (level 1 against
  the Authority's Mk I fighters, level 2 against the Cooperative's Mk II), three a side and a fourth for
  the side the tide favours (|tide| 35 or more); two a side (and one more) on the Low preset.
  Each side comes in from its own end: in the lawful system the Wake from the beacon (down the lane)
  and the law from its station; in the den's system the other way round.
- **Its time**: a clash opens 30 seconds into its slot, or 20 seconds after the pilot arrives if
  later, and is fought whether the pilot joins or not. Each battle ship goes for the nearest ship of
  the other side in the battle (and for the pilot, if the pilot is its enemy and within 4 km), and
  otherwise closes on the line; nobody chases a ship that has fled, or anyone more than 4.5 km from
  the line. Battle ships aim at each other alike (0.7, either side; at the pilot, raiders aim as the
  difficulty says). A side whose ships are all down or fled is beaten. A clash still undecided after
  six minutes ends with both sides pulling back: a draw.

### 35.2 Turning battles

- **The assault**: when the front's exposed station is about to fall, its pressure falling and within
  8 of the fall (−52 to −60, about an hour and a half of game time), arriving or launching in the
  lawful system stages the Wake's assault on it.
- **The retaking**: when it is held and about to be freed, its pressure rising and within 8 below the
  fall, the law comes to retake it.
- **Once each turn**: each is fought once each turn of the tide (per front, per tide cycle, per
  kind). Seen to its end (won, lost or drawn), it is not staged again that cycle; left before its
  end, it is staged again on the next arrival while still due.
- **At the station**: 2 km off its bay. The attackers come in two waves of three (two on Low), the
  second when the first is down to one ship; four defenders (three on Low) hold by the station. The
  Wake's raiders are a level above a clash's (2 against the Authority, 3 against the Cooperative).
  After eight minutes an undecided battle is the defenders': the attackers withdraw. Left to
  themselves the two sides are close, the Wake a little ahead: the tide takes the station on time
  unless the pilot tips the battle.
- **First**: one battle is fought at a time in a system, and a turning battle comes before a clash:
  no clash opens while one is due, or within two minutes of it.
- A front with no exposed station (WISE 0722−0540's) has clashes only.

### 35.3 The pilot's side

- The pilot fights on the **law's side**, unless the front's faction hunts them (fines owed or
  Hostile standing) or the Wake trusts them (it spares them, §27), when it is the **Wake's**. A
  battle ship of the other side is marked hostile; one of the pilot's side, friendly.
- **Whoever the pilot fires on treats them as an enemy**: a lawful ship fired on turns on the pilot,
  and downing one is a crime as ever (§12); raiders of a Wake the pilot is friends with turn too.
- **The pilot's part**: the pilot, or a hired wingman, downs a ship of the other side in the battle.
  Hired wingmen (§34) take on the Wake's battle ships under their orders as they do other raiders; on
  the Wake's side they hold their fire on the battle (they fly for lawful pay).

### 35.4 What a battle won changes

- A battle ended with the pilot's side winning, and the pilot's part in it, is a **deed** on its front
  (§20.2): a turning battle 18 its way (as much as a war contract), a clash 6, each fading over a day
  as any deed. So an assault beaten off keeps the station for that turn of the tide, and a retaking
  won frees it hours early; but the tide comes round again, and only a decisive operation (§20.7)
  settles a front.
- **A purse**: the side pays 900 cr for a turning battle and 300 cr for a clash (below a war
  contract's 450 cr and more), with standing: +5 and +2 with the front's faction, or with the Wake on
  its side. Raider bounties pay as ever; lawful ships downed stay crimes, whatever the Wake pays.
- A battle lost or drawn changes nothing beyond the ships downed in it, each a deed as ever (+2 a
  raider, −3 a lawful ship).

### 35.5 What the game says

- **In flight**: the side's radio as a battle opens (*Wake fighters at the beacon line, all wings
  engage*; *The Wake is coming for Regent Concourse*), a *Battle line* marker, and the **battle strip**
  in the objective's place: the battle's name, the ships still flying on each side and the pilot's
  side (underlined, and marked *you*). On a short or narrow phone the strip keeps to two lines, its
  Fiction badge an icon, and on a 640×360 phone a selected target's box keeps to the right of the
  centre, clear of the wing and aim chips. As it ends: the radio, and a toast with the purse and what
  it did to the front.
- **The News** within three jumps tells a turning battle the pilot fought in and won for two hours (*A
  pilot helps beat off the Wake's assault on Regent Concourse*). The **journal**'s *Border battles*
  lists the last battles the pilot saw to an end, how each went and the pilot's side.
- In browser tests battles are off unless a test turns them on, as lane encounters are.

### 35.6 One save's own

The front's log on `world.border` keeps the last six battles the pilot saw to an end: the kind, its
slot or tide cycle, when, the winner, the pilot's side and whether they took part (enough to stage
each once and tell it). The schedule, the lines, the ships, the sides and the purses are worked out.
A battle under way is not saved: loading puts the pilot back as they launched. Saves refuse an
unknown kind or side, a battle after the clock, a slot or cycle that does not match its time, and
more than six.

### 35.7 Guardrails

`validateBattles` (`src/economy/battleGuards.ts`, run in `tests/unit/battles.test.ts`): slots of 10
to 30 minutes, chances between 0 and 1, sizes that add at most ten ships to the scene (seven on Low),
raider levels from 1 to 3 with a turning battle's no lower than a clash's, battle ships aiming no
better than raiders at the pilot and leashed no nearer than where they form up,
a turning window of at least half an hour, purses below a war contract's least pay, deeds as the owner
chose (a turning battle the war contract's, a clash a third); every front's battle lines in both
systems on the way from the beacon, 1.5 km clear of any star's or planet's surface, 2 km from any
station and outside every belt, and at least 5 km from a den; every exposed station's battle point
clear the same way; schedules the same every time, a clash in each front at war within a few slots,
turning battles exactly when the pressure is in its window; words with no number, no he or she, no
star, only their fields and short enough for the strip. The tests also break the rules to see them
caught, and fly battles headless: both sides win some even clashes, a pilot's part counts, a deed and
a purse are paid once, and a battle left unfinished is staged again.
