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

The second application builds the world around the real stars: `generateWorld(seeds, seed)` in
`src/content/world/generate.ts`, a pure function of the catalogued systems (`WORLD_SEEDS` in
`src/data/systems.ts`), the world rules (`src/content/world/rules.ts`) and a fixed seed
(`WORLD_SEED`), so every player flies the same world. The five hand-authored systems keep their
stations, owners and lanes; the generator only builds around them.

### 7.1 Jump lanes

1. The hand-authored lanes.
2. The shortest lanes that connect every system (a minimum spanning tree over real distances).
3. Extra short lanes so no system is a dead end (at least two lanes wherever a neighbour lies within
   8.5 ly and has room; at most five lanes per system).
4. Very short hops (under 3.2 ly) become lanes too, which makes loops.

A system far from everything (Altair, 40 Eridani) stays a dead end: the lane would be longer than
the rules allow.

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

- lanes are two-way, reach every system from Sol, stay under 9.5 ly (hand-authored lanes aside)
  and leave no avoidable dead end;
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

- **More systems**: add them to the pick list in `scripts/extract-catalogs.ts`, rerun it and
  `npm run data:build`. If a name pool runs out, the guardrails say so; add words.
- **A new station type**: add it to `StationType` (`src/content/world/types.ts`) and a rule to
  `STATION_TYPES` in `rules.ts`; give it a shop entry if it sells equipment and a market profile in
  `src/content/economy/rules.ts`. The coverage guardrail makes sure it appears somewhere; add an
  archetype to the exterior generator and a character to the interior generator.

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
prices you have seen or been briefed on. The star map and the encyclopedia say what each station
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
  player for another station in the same system; only in systems with something to fear (raider
  packs, or security below 0.75). It keeps to sublight speed and holds position while the player is
  more than 2.5 km away. A quarter to nearly half of the way along, raiders of the system's threat
  (at least 1) ambush it from ahead, and half of them go for the hauler until the player draws them
  off. The contract pays when the hauler docks; it fails if the hauler is destroyed or the player
  jumps out of the system first.
- **Ace hunt**: a named Hollow Wake ace (names from invented pools) in a heavy fighter, 80% tougher
  and 30% deadlier than its hull suggests, with two guards, near a marked spot within three jumps
  where packs are nasty (threat 2 or more). Always difficulty 3. The guards pay the usual bounty;
  the ace drops a salvage pod worth 500–900 cr and a pod of 3–6 luxuries, electronics, small arms
  or ship components, tractored in like any loot.
- **Recovery**: a wreck (a dead hauler, slowly turning) lies a few kilometres off a station within
  three jumps. In systems where raiders roam, guards of the system's threat wait by it. Tractor the
  item aboard (a flight recorder, a sealed cargo pod, a survey drone, a data vault or a courier's
  strongbox), then bring it back to the station that posted the job. The HUD steers to the item.

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
  level on escorts, 150 cr per guard level on recoveries). Work that answers an event pays 30% more
  on the varying part. Rounded to 5 cr.
- **Difficulty** 1–3: one more for a lawless destination (security below 0.35) and one more for
  three jumps or more; supply runs count the trip to the source; bounties and escorts take the
  threat level; aces are always 3. The briefing notes the route and the risk.
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
- escorts: two stations of the posting station's system, something to fear there, the ambush
  threat matching the system, a hauler from the catalogue;
- aces: one named target at the top difficulty, where packs are nasty;
- recoveries: find and bring back, guards matching the system, a known item;
- surveys: the planet is a confirmed planet of that system;
- urgent terms only on parcels and hauls, with at least twice the expected trip and a real bonus;
- work that answers an event answers one under way where it says, one per board at most;
- pay beats 1.2 × the jump fees there and back plus 40 cr of expected repairs per difficulty level
  (plus the goods on a supply run);
- no station's board is empty in more than one time slot in ten; every kind, urgent jobs, event
  work and follow-ups all occur.

`tests/unit/flightContracts.test.ts` flies an escort with its ambush, an ace with its guards and
loot, and a wreck's recovery in a real `FlightSession` (in node, without rendering).

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
  - **strike** (5%): the goods it makes; price × 1.2–1.35, stock × 0.5.

  The hand-made stations' three opening goods and small arms are never touched. The lower stock
  moves the price further through scarcity, and the price bands (0.4–2.2 × base) still hold.
- **Systems** have three-hour windows:
  - **raid** (22%, below security 0.75): one more raider threat level (at most 3), one more pack
    at a time, packs sooner and more often, half the traders; 40–100 minutes;
  - **security sweep** (12%, in claimed space where packs roam): no packs, one more patrol wing.
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
  of its glut, or a *raid response* bounty on a raid within two jumps (the raid's threat). Their
  varying pay is 30% higher.

### 11.4 Event guardrails

`validateEvents` (`src/economy/eventGuards.ts`, run over 300 hours of clock in
`tests/unit/events.test.ts`) checks that events never overlap at a place or spill out of their
window, never touch Sol or the opening goods, only concern goods the station deals in the right
way, keep effects inside the rules, state the change they cause, keep live prices inside their
bands with buy above sell, put raids only below security 0.75 with the threat one above the
system's, put sweeps only where packs roam in claimed space, happen at a sensible rate (3–25
station events under way on average) and cover every kind.

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
  and the Solar System's eight planets and the Moon (91 entries today). It grows only with the
  dataset: no invented body is ever an entry.
- Scanning a body fills in its entry once. The encyclopedia's system page shows the system's
  entries with a tick for each one scanned, and the journal shows the total.
- **Survey sales**: once every entry of a system is scanned, a research station (or one of the
  hand-made research outposts) buys the survey, once: 120 cr per entry, at least 240 cr.
- Cataloguing the whole sky earns the Frontier Cooperative's 10,000 cr grant.

### 13.2 Ratings

Three ratings follow the career record and show in the journal with the next rank:

| Rating | Score | Ranks |
| --- | --- | --- |
| Combat | hostile ships and den turrets destroyed | Green, Blooded (3), Steady (10), Hardened (25), Veteran (50), Ace (100), Legend (200) |
| Trade | contract and survey pay, plus a quarter of sales | Hauler, Dealer (2,000), Merchant (8,000), Broker (20,000), Magnate (50,000), Tycoon (120,000) |
| Exploration | 3 per system visited, 1 per codex entry | Stay-at-home, Drifter (10), Wayfarer (30), Pathfinder (60), Surveyor (100), Cartographer (150) |

Ace hunts (§10.2) need a Hardened combat rating.

### 13.3 Milestones

Twenty milestones, each earned once and toasted when it happens: the first and the 25th
contract, 10,000 and 50,000 credits in hand, flying a Mk II and a Mk III ship, ten and all
systems visited, ten confirmed planets scanned, half and all of the codex, ten and fifty raiders
down, Friendly with the Transit Authority and with the Frontier Cooperative, trusted by the Hollow
Wake, a top rank in any rating, and each of the three story arcs (§14) finished. The journal lists
those earned.

### 13.4 What next

After the opening chain, when no contract is under way, the HUD's objective line suggests one
concrete thing from what the player already knows, in this order: pay fines owed (and where); sell
goods in the hold where the best known price is; see someone with a story mission waiting (§14);
catalogue a body of this system the codex lacks; run a known trade route from the last dock; or dock
at a station here with a job board. The hint
is worked out again after a scan, a launch or a jump.

### 13.5 Progress saves

Save version 7 adds the codex, the surveys sold, the milestones earned, the fines owed and the
career's sales and contract pay. Older saves start their codex from the bodies already scanned,
with no fines and no milestones yet (they are awarded at the next save if already earned).

## 14. Story arcs

Three short arcs give the sandbox a spine, one per faction (`src/content/story/arcs.ts`, played by
`src/economy/story.ts`). Unlike everything else in this document they are written by hand, not
generated, and reviewed like code: the guardrails below check them, unit tests play each one
through, and a browser test flies the first steps.

### 14.1 How an arc is built

- A **mission** is a job with story data: its arc and step, the character who gives it, and its
  words. Its objectives are the contract objectives (dock, deliver, scan, escort, recover, bounty,
  piracy) plus three made for the story: a **choice** made at a dock, a **den assault** and a **den
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
  standing lifted to Wary.
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
  the three must arrive; losing more fails the convoy.
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

- each arc has four to six missions in a chain, step by step, ending in its one finale, the lawful
  arcs after the opening delivery;
- every speaker exists and gives missions where they are; every place is a real, open station in
  the system named, within four jumps of where the mission is given; lawful arcs never dock at a
  raider den; den fights are finales at dens;
- choices offer two or three options, each changing standing (by at most 50) and paying sensibly;
  at least one option goes on, the next step follows exactly the options that go on, and every
  option has its own words wherever later words depend on it;
- lawful arcs never ask for a crime (piracy, a den defence, contraband); the Wake's arc starts only
  for pilots it trusts;
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
  is over and its nearer neighbour hold four larger rocks each (26–60 m in radius), seeded
  where they sit, so they are the same rocks every time.
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
  a cargo pod beside the rock (a unit a pod, six adrift at most). The tractor leaves a pod alone
  while the hold cannot take it.
- The beam stops when its target is lost (another one selected), out of reach or spent, when the
  hold and the six pods are full, and on docking or entering a lane.
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
- Every unit the laser cuts of that good in that belt counts (the job's `mined`); once the count is
  met the load is delivered like freight. The star map marks the belt's system, and in flight the
  belt is the objective, with Go to.

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
  yield; a rock is spent after its amount; the hold fills, then the pods;
- mined goods reach a market only from the hold, and thirty loads into one dock keep every price in
  its band;
- with a class 1 laser the typical core belt pays within the middle half of the hauling routes near
  Sol (the trade computer's estimates), and no belt, even with two class 3 lasers, pays more than
  the best hauling route;
- claims pass the contract guardrails at every station (a cited belt, a good it yields, reach, the
  load and pay above what the load would fetch), count only their belt and good, and pay on
  delivery;
- in a real `FlightSession` in node: belts and rocks as targets, the beam's rate into the hold, why
  it stops, the pods, a spent rock growing back, a claim's belt as the objective, and raiders
  coming for a miner in a lawless belt.

`tests/e2e/mining.spec.ts` scans Sol's main belt and mines one of its rocks in the browser.
