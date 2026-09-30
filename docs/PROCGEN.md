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
content    the catalogue (later: stations, jobs, people, news)
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
  fees and expected repairs.

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
  within band; jobs never target the player's own faction without warning.
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
