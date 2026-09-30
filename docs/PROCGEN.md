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
  on the same dock.
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

### 4.5 World content (for the generators that follow)

- Stations and points of interest attach only to catalogued bodies, with placement rules per type
  (mining near belts or airless moons; research near notable bodies; pirate dens only where lawful
  influence is low).
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

The shipyard credits your current ship and its fittings at 70% of their value. The new ship
arrives with its stock loadout; cargo moves across if it fits (otherwise the sale is refused until
you sell the excess).

### Adding content

- **A new maker**: add an entry to `rules/manufacturers.ts` (traits, line-up, name pools, style),
  then list it in a shop. The tests tell you if a name collides, a trait is out of range or
  something is not sold anywhere.
- **A new equipment family**: add it to `rules/gearFamilies.ts` and give makers a product line for
  it. Guns and shields automatically join the shared budget curve.
- **A new ship class**: add it to `rules/shipClasses.ts`; duels, trade-offs and the envelope are
  checked for it automatically.
