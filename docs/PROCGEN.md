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
  (`scripts/load-budget.ts`, in `npm run check` and CI): the first screen at most **32 KB** (15 KB
  on 1 October 2026) and the whole first load, first screen and game, at most **700 KB** (609 KB).
  Fonts (71 KB, already compressed) and what loads on demand (the star map, the science notes,
  bloom: 35 KB) are reported, not budgeted. Going over is a decision to make, not an accident: raise
  the budget in the same change, with the reason.
- **On a real device**, the device report (Settings; `src/app/deviceReport.ts`) shows what the
  phone or computer and its browser tell the game: the screen and safe areas, the input, the
  graphics chip, the quality in use, the load times (the loading title and the title leave marks in
  the browser's performance timeline), the last flight's average frame rate and slowest second,
  the network, and whether the game is kept for offline play. It is only shown, never sent: the
  tester copies it.

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

- **Traders** fly between the system's open stations, or arrive through the jump beacon, in
  haulers of the owner's makers (independents in unclaimed space). About one per station, fewer
  where security is low, at most six; half the traffic is already under way when you arrive.
  They fly around planets and stations, and when shot at they call a mayday and run for the
  nearest station. A lost freighter spills salvage.
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
  can be found again from its id.
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
  or failed) are kept for the journal.
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
- **Traders**: a hauler docking in the player's system moves a small load (6–14 units) of something
  its destination wants or trades, taken from its origin when it came from a station that makes
  it. Deliveries top short stock up to at most 1.2 × normal and never take a maker below 0.8 ×
  normal, so traffic refills markets without flooding them. Elsewhere, stock recovers toward
  normal on its own.

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

- **Piracy**: a destroyed hauler spills one or two pods of its cargo (3–8 units each) to tractor in.
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

Three ratings follow the career record and show in the journal with the next rank:

| Rating | Score | Ranks |
| --- | --- | --- |
| Combat | hostile ships and den turrets destroyed | Green, Blooded (3), Steady (10), Hardened (25), Veteran (50), Ace (100), Legend (200) |
| Trade | contract and survey pay, plus a quarter of sales | Hauler, Dealer (2,000), Merchant (8,000), Broker (20,000), Magnate (50,000), Tycoon (120,000) |
| Exploration | 3 per system visited, 1 per codex entry | Stay-at-home, Drifter (10), Wayfarer (30), Pathfinder (60), Surveyor (100), Cartographer (150) |

Ace hunts (§10.2) need a Hardened combat rating.

### 13.3 Milestones

Twenty-four milestones, each earned once and toasted when it happens: the first and the 25th
contract, 10,000 and 50,000 credits in hand, flying a Mk II and a Mk III ship, ten and all
systems visited, the first frontier system and 25 of them visited (§7.7), ten confirmed planets
scanned, half and all of the codex, ten and fifty raiders down, Friendly with the Transit
Authority and with the Frontier Cooperative, trusted by the Hollow Wake, a top rank in any rating,
and each of the five story arcs (§14, §20.5) finished, The Long Border and First Harvest whichever
way they end. The journal lists those earned.

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
finales (the Wake's arc makes an outlaw of anyone who finishes it).

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
- Its finale earns a milestone. The arc's ending changes standing and words, not the world.

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
  180 cr per whole system, standing discounts applied. The HUD lists damaged systems.

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
- Hiring costs the first fee; every jump pays the wing. A pilot the player cannot pay leaves, and so
  does one whose ship is destroyed. At most two fly at once. They launch with the player, keep
  station off the player's wing (catching up after a lane), and go for raiders near the player that
  are not sparing them. Nobody flies with a pilot the law is hunting.

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
- **Wing orders**: V (or the Wing chip on touch) cycles the wing's standing order: engage at will
  (the default), attack my target (the player's selected target when it is fair game, otherwise as
  at will), or form up (no fighting). The wing acknowledges on the radio.

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
- `border`: the player's deeds on each border front, and how The Long Border ended there (§20).

The event engine reads the log of the save being played (`useWorldLog`), so events stay a pure
function of the clock except for the endings recorded there. `tidyWorldLog` runs at every docking:
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
is worked out from the game clock when the player docks, jumps or loads a save, the same on every
device.

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
  jump, 30 s in) each way: about 7 minutes in a system, 15 for one jump, 23 for two. It buys 90%
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
  worse while a raid (§11) is under way in a system on the route when it sets out. Raiders take the
  cargo; a quarter of the time they destroy the ship too (the captain escapes). Insured, a lost ship
  pays back 60% of its model's price. The luck of each run is drawn from a stream keyed by the
  save's seed, the ship, the hire and the run.
- **Recall**: a captain at home parks the ship at once; one on a run finishes it, flies home and
  parks. Insurance can be taken or dropped at any time (it counts when a run arrives).
- **Reports**: every sale, raid, lost ship, reported wait and captain signing off is a report with
  its game-clock time; the save keeps the newest 20. Docking, a jump or loading shows the new ones
  as toasts: a lost ship always, two or fewer as they are, more as one summary line, and the
  dividends paid.

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
(set out, arrive, get home) and every hour of dividends, merged in time order, so a dividend can pay
for the next load and one hauler's purchase can raise the next one's price. Each step depends only
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
  ships like the flown one, at most four, a hauler's route starting where its ship is parked,
  storage within 60 units, stakes of 1–10% at no more than five stations, reports of known kinds.

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
  Long Border has settled posts no war work.
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
