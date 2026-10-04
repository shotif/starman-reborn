# Test record

Environment for everything below: Linux container, Node 22.22, Chromium 141 (Playwright 1.56.1)
in headless mode, with WebGL 2 rendered in software by SwiftShader. **No physical phone, tablet or
GPU was available.** Emulated devices use Playwright viewports with `hasTouch`/`isMobile`, and
touch input is real Chromium touch events sent over the DevTools protocol.

## Automated checks

| Check | Command | Result |
| --- | --- | --- |
| TypeScript typecheck (app + scripts/tests) | `npm run typecheck` | Pass |
| Astronomy data validation | `npm run data:validate` | Pass (22 warnings: the contested planets this edition keeps) |
| Unit tests | `npm test` | Pass: 965 tests in 61 files |
| Production build | `npm run build` | Pass |
| First-load budget | `npm run size` | Pass: first screen 16 KB of 32, first load 760 KB of 800 (gzipped) |
| Browser tests, desktop 1440×900 | `npx playwright test --project=desktop` | Pass: 51 passed (5 touch-only tests skipped) |
| Browser tests, touch 844×390 | `npx playwright test --project=touch` | Pass: 51 passed (2 desktop-only tests, the slow-network measurement and the two offline tests skipped) |
| Layout screenshots + audits, 7 sizes + 2 large-text phones | `npm run screenshots` | Pass: 612 screenshots, no audit findings (one size, which timed out waiting for a derelict's hail, passed run again on its own) |

### Unit tests (Vitest)

- `data.test.ts`: coordinate conversion, parallax → light-years, proper-motion propagation,
  dataset validation (and that broken data is caught), the five hand-authored systems first and
  every system reachable from Sol, every star and planet checked against the archives with the map
  grown by the systems they add, familiar distance bands, Proxima separate from A/B, every planet
  kept (contested ones marked, Proxima b confirmed), a functional dock in every system, jump
  routing and fees.
- `world.test.ts`: the world generator passes every guardrail for the real catalogue and twelve
  other seeds, is deterministic, keeps the hand-authored core, grows lawless toward the edge,
  hides raider dens away from Sol, attaches stations to real stars and confirmed planets, builds
  every kind of station, stocks every outfitter and shipyard; broken worlds are caught.
- `scenes.test.ts`: every catalogue system's generated scene draws exactly its catalogued stars and
  confirmed planets, keeps stations and arrivals clear of them, lanes clear of stars, raider dens
  hostile and undockable, builds and disposes in node, and shows only catalogued bodies out of a
  generated station's bay.
- `market.test.ts`: economy guardrails for the real world and other seeds (every good made and
  wanted, bands, spreads, viable and non-absurd routes, the designed opening prices); live prices
  over 1,500 random market states stay in their bands with buy above sell; no buy-and-sell-back
  round trip pays at any dock or standing; stock moves and recovers; drift stays gentle.
- `traffic.test.ts`: fleets fly real catalogue ships; Sol busy and safe, the lawless edge quiet
  and dangerous, no packs next to Sol; fewer ships on phones; bounties; a trader flies around a
  planet and docks, runs for a haven when shot at; a patrol flies its loop.
- `economy.test.ts`: cargo bounds, exact trade arithmetic with every unit priced at the stock it
  leaves, stock recovery, rejected orders leave state unchanged,
  max-buy limits, no same-dock arbitrage, the Earth → Mars → Proxima profit, route returns from
  known markets only, repair affordability, reputation effects on repairs, prices and welcome
  text; the outfitter (replacing a shield with a 70% buy-back, mount classes and standing gates,
  selling non-core items only, armour and cargo pods, rounds and repair kits) and the shipyard
  (trade-in with repairs deducted, cargo carried across, a buy-and-sell round trip never profits).
- `content.test.ts`: the rule-driven catalogue passes every guardrail, is deterministic, keeps ids
  and stats when only the seed changes, offers six classes from several makers and over 100 items,
  builds in under 20 ms; the starting ship flies exactly like the original player ship; broken
  rules are caught; a balance table snapshot records every ship and item.
- `jobs.test.ts`: the full delivery chain, detours (other systems, selling and re-buying cargo),
  early scans, reputation-gated contracts, visit-only couriers, rescue after defeat.
- `contracts.test.ts`: every station's contract board, and every follow-up it leads to, passes the
  guardrails over forty time slots (reach, pay against fees and repairs, deposits against the
  cargo's value, bounties and aces only where raiders roam, escorts only where there is something to
  fear, surveys of confirmed planets, time limits that can be kept, event work matching an event
  under way, escorts at home and across jumps and convoys) and is deterministic; the hand-made
  stations post only after the first delivery; each kind played through (freight loads cargo against
  a deposit and refunds it, parcels complete on docking, supply runs brief the source, bounties
  count kills, surveys complete on a scan and are not offered twice, escorts pay on arrival and fail
  when lost or left behind, aces pay for one named kill, recoveries find the item and bring it
  back); an escort across jumps keeps with the player, holds the jump while too far away, jumps with
  them, is seen in at the far end with raiders at the beacon, fails when left in its destination's
  system, and waits where it was after a tow; a convoy across jumps pays when two of three are in
  and fails when two are lost; the guardrails catch an escort with nothing to fear, a convoy that is
  not three and a difficulty that ignores the trip; an older save's escort is where it set off; a
  rescue loads its ship components against a deposit, steers to the stranded hauler, does nothing
  while parts are missing (and says how many), and pays with the deposit back when they are handed
  over, or fails if the hauler is destroyed; urgent jobs pay the bonus in time and cost standing
  when late; follow-ups are offered at the destination, pay more, can be taken, and lapse; refusals
  without hold space or credits; abandoning (deposit forfeit, cargo kept, standing lost, no second
  try, story jobs kept); the five-contract limit; accepted contracts survive later boards and the
  save; v4 → v5 and v5 → v6 migrations and damaged contracts rejected.
- `flightContracts.test.ts`: a real `FlightSession` in node flies an escorted hauler that sets off
  with the player, is ambushed part-way and ends docked or lost; a hauler and a convoy on their way
  to another system that keep station with the player (no ambush out of a dock), hold the jump while
  more than 2.5 km away, catch up after a long cruise and report their loss; raiders waiting at the
  beacon for escorted ships arriving through it, from ahead and going for them; a hauler stranded
  more than 12 km from any dock, in the same place for the same job, watched by a scavenger, that
  the objective steers to, says once what is missing, takes the parts alongside and then makes for a
  dock, or reports its loss; an ace with two guards that is tougher than a guard in the same ship
  and drops credits and a cargo pod; and a wreck, guarded, whose item the tractor beam pulls in.
- `events.test.ts`: world events pass their guardrails over 300 hours of clock (no overlaps, only
  goods the station deals in, never Sol or the opening goods, prices in their bands, news text
  quoting the change, raids and sweeps only where they can happen, a sensible rate, every kind);
  they are a pure function of the clock; a shortage raises what a station pays and a glut lowers
  what it asks; moved stock recovers toward the event's normal stock; raids bring nastier packs and
  fewer traders and sweeps clear them; news reaches two jumps, nearest first, and keeps recent
  events for half an hour; boards post a shortage run, a surplus haul and a raid response; every
  event there was before the frontier's own is exactly as it was (100 hours fingerprinted); a
  harvest comes in only at a frontier farm, floods its food and posts a harvest haul; a survey
  season at a frontier research post studies a real planet within reach, says a contested one is
  contested and that the readings settle nothing, and posts a survey of it; a drive failure strands
  a named colony hauler in a frontier system without moving prices or traffic; none of them happen
  anywhere else; traders top short stock up without flooding a market or emptying a maker; each jump
  moves the clock on.
- `law.test.ts`: the law passes its guardrails (a pardon lifts standing above Hostile, repairs
  within one jump of every system, contraband sold somewhere with a smuggling route into claimed
  space past customs, dens with black markets and work, no crime in the story); crimes fine and
  cost standing, and a kill wins the Wake's regard; Hostile standing alone makes patrols hunt;
  scans confiscate and fine contraband and pass a clean hold; a pardon costs the fines (and 50 cr a
  point of standing below Wary), ends the hunt and lifts standing to Wary, a Hostile pilot owing
  nothing can still buy one, a Wary one has nothing to pardon; hunted pilots dock for repairs only
  and dens open only to Wake friends; a Wary faction offers easy work only; smuggling runs load
  contraband against a deposit and pay on delivery; dens post piracy and count the haulers downed;
  a customs depot scans every ship docking; v6 saves gain a clean record, damaged fines rejected.
- `flightLaw.test.ts`: a real `FlightSession` in node: the player's bolts hit a lawful ship only
  when it is the selected target; firing on a patrol is reported once and turns it; patrols hunt a
  pilot owing fines; a passing patrol scans a hold with contraband (staying finishes the scan,
  fleeing is evasion); the autopilot, cruising, holds for a scan coming up from behind instead of
  carrying the pilot away from it; bounty hunters come for big fines in secure space and pay nothing when
  downed; raiders spare a pilot the Wake trusts until provoked; the dens take that pilot in.
- `frameGovernor.test.ts`: Auto starts at Medium; dynamic resolution falls to its floor when
  frames run over budget and comes back with headroom; docked and menu screens drawn every other
  refresh are not slow (the same frames at the full rate are); under Auto, a device still slow at
  the resolution floor steps down one preset, drawing the same pixels across the step, and stops at
  Low once its budget is met; a preset chosen in Settings never steps down, and Auto never steps
  up; choosing a preset again forgets the history.
- `deviceReport.test.ts`: the device report: a flight's average frame rate and its slowest second,
  nothing before a second of flight, a minute behind another app left out, a new flight starting
  afresh; the report's text line by line for a phone, and plainly what is missing (no graphics, no
  flight yet, a load from the browser's cache, download sizes the service worker hides, no network
  details, offline play part-kept with the files not yet kept named without their hashes, not
  supported, off in tests, needing HTTPS or not set up yet).
- `progress.test.ts`: the codex lists exactly the catalogued stars, confirmed planets and the Solar
  System's bodies, each scannable in its scene; a scan counts once and off-catalogue bodies are
  ignored; research stations buy a completed survey once; ratings follow the career record;
  milestones are earned once and the whole sky pays the grant; the what-next hint puts fines first,
  then repairs, the hold, the codex, a route and a job board; it suggests a better ship the pilot
  can afford at a shipyard already visited (never one the station will not sell them), the
  long-range jump drive after six jumps without one, and the last few points of standing that make
  a lawful faction Friendly; v6 saves start the codex from the bodies already scanned.
- `story.test.ts`: the story arcs pass their guardrails, and broken arcs (a missing step, a crime in
  a lawful arc, a den as a dock, a place out of reach, choices that all end or that the next step
  does not follow, missing words, a stranger speaking, a cheap finale, the Wake's arc open to
  anyone, an escort setting off more than two jumps from where it is going) are caught; only the
  step in hand of each arc shows, and a finished step leaves the board; Clean Manifests is played
  through (words at the relay told once, comms in Ross 154, the wreck, the witness, a choice that
  pays and moves standing, a finale whose words follow the choice, the milestone); selling the
  evidence ends the arc with no finale; choices are made at their dock, once; The Stonecrop Blight's
  water run and convoy (two ships lost fails it and it goes back to its giver, two of three in
  completes it); a story escort left behind goes back to its giver; Salt's Crew needs the Wake's
  trust, hands over its contraband, counts haulers taken, and its betrayal is a pardon that ends the
  arc; the Wake's finale counts sweep ships; a knocked-out den is rebuilt after six hours; First
  Harvest is given at Squall Relay after the opening delivery to anyone, and played through both
  ways (the drive parts handed over to the Wrenna in Achird, HD 219134 d and f scanned with f still
  contested, the harvest convoy across one jump to Doppler Freeport or to Squall Relay, and its
  milestone); First Harvest's lasting marks pass their guardrails, and broken ones are caught (a
  den, goods not traded, a price out of bounds, two marks on the same goods that could both be
  left, a run of goods not made there, out of reach or overpaid, a mark no finale leaves, one left
  by a step before the finale, by two finales or unknown); ended at Doppler Freeport, food and fine food are cheaper at
  Harrow and medicine is not, and every board after carries one harvest run of fine food to
  Doppler after the rest of the board, unchanged; ended at Squall Relay, medicine is cheaper and
  food is not, and the board carries the relay's share; nowhere else changes, and the news within
  two jumps tells of it; a mark is left once, kept in the save, and damaged marks are refused;
  the faction arcs' marks: each of the eight ways the three arcs can end leaves one mark and every
  mark is left by one ending (a mark on an answer that goes on, on an answer nobody can give, on a
  finale for an answer that does not lead to it, unknown, or left twice, is caught); each ending
  played from its choice (the finale's den assault, convoy or sweep done) leaves exactly its mark:
  the goods concerned dearer or cheaper than without it, the run on the board in every time slot to
  where it says (none where the mark has no run), and the news nearby; marks that follow other
  answers to the same choice leave nothing behind; v7 saves gain an empty story, damaged story data
  rejected.
- `flightStory.test.ts`: a real `FlightSession` in node flies a convoy of three that sets off
  together, is ambushed in two waves along its route and reports each ship lost; a den assault
  with three turrets that fire on a pilot in range, a reactor that shrugs off hits until the
  turrets are down, two guards and a wing of three that keeps station, ending with the den wrecked
  and silent; an assault with turrets already destroyed bringing only the rest; a knocked-out den
  closed even to Wake friends; and a sweep coming for a den in waves, whose ships can be hit
  without selecting them, each kill counted (and a crime), the second wave when the first is spent.
- `combat.test.ts`: salvaged equipment goes into the stash, and is sold on the spot once it is
  full; stashed items are fitted (the old item sold) or sold at an equipment dealer only; new ships
  carry decoys and the outfitter sells more up to capacity; damaged systems cost more to repair the
  worse they are; pilots for hire are posted where they should be, the same for everyone; hiring
  costs one fee, every jump pays the wing, an unpaid pilot leaves and a shot-down one is picked up
  (§34), nobody flies with a wanted pilot; a den knocked out on the player's own account is dark for six hours, paid by the
  nearest law and resented by the Wake; den assault contracts come from the law, need Friendly
  standing and a Hardened record, and are not offered against a dark den; v7 saves gain decoys,
  intact systems, an empty stash and no wing, damaged combat data rejected.
- `flightCombat.test.ts`: a real `FlightSession` in node: hull hits damage systems, which slow the
  ship (and the HUD says so) until a repair kit patches them up; a hull hit flashes the screen's
  edges and the flash fades in under half a second at any frame rate; heavy raiders fire seekers
  at the player and a decoy draws them off; a mine arms, goes off near the player and hurts; hired
  wingmen launch with the player, catch up and are reported when lost; the wing takes orders (attack
  my target, form up, engage at will) given from the card, which the key asks the game for; a den wakes when an
  untrusted pilot comes near (turrets, mines, no wing), pays turret bounties and reports its
  reactor down on the player's own account; a den stays quiet for a Wake friend; raiders talk when
  they find you, and a patrol taking on raiders within radio range calls it (from across the
  system, nobody hears).
- `save.test.ts`: v1, v2 and v3 migrations (the v2 courier and its upgrades become catalogue
  items; v3 saves gain untouched markets),
  unknown ships, fittings and rounds rejected, future/damaged save rejection, IndexedDB round trip with
  backup rotation, fallback to the backup, coalesced writes, **save after jump** survives a fresh
  load, reset keeps settings, settings sanitising.
- `saveSlots.test.ts`: three save slots beside the autosave, in IndexedDB: empty at first, then
  stored, listed with their summaries, loaded, overwritten and deleted; a slot keeps a copy, not
  the running game; slot writes queue in order with pending autosaves; the autosave keeps its key,
  is never touched by slot writes, and resetting it keeps the slots; an older game in a slot is
  listed from its stored summary and migrated only when loaded; damaged slots are listed as such,
  fail to load cleanly and can be deleted; an imported game keeps the time it was saved. Summaries
  read the place, credits, play time and save time (ids from a newer game shown as they are). Save
  files are named by date and slot, round-trip through export, import and `migrateSave` (an older
  game inside is migrated), and unreadable, foreign, newer, damaged and oversized files are refused
  with a clear message.
- `flight.test.ts`: **pointer ownership for the two touch sticks** (third finger, wrong-pointer
  moves, cancel, hold button), frame-rate independence (30 Hz vs 120 Hz), drift, boost/cruise,
  bounded sub-steps, ship orientation, autopilot arrival, the portrait camera field of view,
  intercept maths, a lead shot hitting an off-axis crossing target, gun-arc clamping, shield/hull
  damage and regeneration, damage-type multipliers on shields and hull, and the autopilot's
  obstacle avoidance (clear paths, the nearest blocking sphere on the right side, spheres behind).
- `galaxy-map.test.ts`: camera-relative transforms, orbit controller, projection and label layout,
  jump-button rules; zoom about a point on screen (stars nearer and farther than the focus all stay
  under it, and zooming back returns to the start), the zoom limits, a target radius that reaches
  the far shell; gestures that zoom about the pinch point and drop lost fingers without forgetting
  a tap.
- `map-search.test.ts`: finding a system by its own name or a star, planet, station, belt or
  catalogue name in it (case, accents, punctuation and Greek letters ignored; Gliese numbers in all
  three spellings), typos forgiven only when nothing matches as typed, one row per system with
  equal matches nearest first, highlights on the name as written; the missions list grouped by
  system with the tracked objective first, then by jumps, unreachable last.
- `load.test.ts`: the first load: the loading title counts the systems as the game does before the
  sky has arrived; the build's list of files is read and anything malformed dropped; the bar rises
  to exactly 1 in many steps, even when a file is larger or smaller than listed or comes without a
  readable body; a missing file fails the load so the title can offer to try again; the build lists
  the boot chunk, its imports and its CSS, largest first, and leaves out what the page already
  loaded and what loads on demand; the offline list has every script, style and font and no source
  maps; the first-load budget passes a build within it and catches a grown first screen, a first
  load over budget and a page that lists no game files.
- `rooms.test.ts`: station interiors: structure per station, camera moves and cuts, reduced
  motion, omitted rooms, determinism, draw-call and triangle budgets per quality, lights per room,
  hotspots on desktop and phones, portrait framing and disposal; generated interiors for every
  station type and owner at every quality (budgets, lights, determinism, ship, dealer, mechanic
  and bar crowd in shot on desktop and phone, flicker only with motion allowed), the shipyard hull
  on the slip floodlit and shaded top to bottom, factory goods matte and never pale, mining-hall
  rock walls holding some light away from the floodlights, and fingerprints proving the six
  hand-made interiors are unchanged.
- `stationgen.test.ts`: every station type builds in every owner palette with one lit docking bay,
  a clear approach corridor at every animated pose, a radius that encloses every vertex and light,
  identical geometry for the same look, mesh and triangle budgets per quality, and clean disposal.
- `shipgen.test.ts`: every catalogue ship builds a mesh, deterministically, facing −Z, with one
  muzzle per gun mount, filling its class radius, within the triangle budget; shared geometry
  survives other ships' disposal.
- `audio.test.ts`: music theory, deterministic seeded patterns, mood definitions, voice limits,
  engine parameter mapping.
- `soundscape.test.ts` and `ambience.test.ts`: the mood rules (title and map themes, the bar and
  docked themes, a system's theme in flight, the den near a den until it is knocked out, deep-space
  drones on long rides and never in a fight, only moods that exist); each system's peacekeeper,
  dens and radio traffic; a bed for every station room with its own sounds, within level, pitch,
  rate and node limits; sparse events planned deterministically; a local radio that stays silent in
  quiet systems and faint under the comm blip.
- `gamepad.test.ts`: one job per button with Xbox and PlayStation names; sticks with a dead zone,
  inverted pitch and a springing reticle; each press acting once, held buttons repeating, Start and
  Back heard by the pause menu and the map; Back tapped opening the map as it lets go and held 0.4 s
  opening the wing's orders once (not when held as the pad connects); presses for a dialog (the D-pad, A and B) read once;
  connections and disconnections reported once; the last device used owns the HUD, and a drifting
  stick never takes it.
- `portraits.test.ts`: portraits are a pure function of seed and look, differ between seeds, keep
  the face when only the clothes change, dress each role and faction, grey with age, give the eight
  story characters faces of their own, stay well-formed and light, and describe themselves to screen
  readers.
- `people.test.ts`: a bar of regulars at every dock, the same for everyone in a shift; story
  characters in their own bars; whatever anyone says in any bar, at any time, holds in the game; a
  price tip is worth more than its round, and a round buys one true thing a shift; the trade
  computer knows nothing it has not been told and ranks routes by profit per minute with fees, trip
  time and the age of each price; the price watch; v8 saves.
- `answers.test.ts`: selling into a shortage relieves it early, with a bonus and standing; enough
  raiders destroyed break a raid; a glut drifts into its neighbours, peaks and fades; a crime is
  known where it was seen and the news travels a jump at a time; fines lapse after a quiet spell,
  but not for a Hostile pilot; a pack that saw the player, and pods left adrift, are there on a
  return; v9 saves and damaged world logs.
- `fleet.test.ts`: buy and keep, the hangar's limit, switching ships (each keeps its cargo and
  gear), selling a parked ship; leased storage; stakes of 1–10% in at most five stations, paid by
  the hour and moved by events, bought up or sold mid-hour fairly; haulers only to docks you know,
  loading, selling and coming home, waiting while a run does not pay, recalled, and a very long
  absence worked out quickly; a hauler earns well below flying yourself, the worst a run can do is
  bounded and insurable, and settling is deterministic however often it happens; the reports; v9
  saves and damaged fleets.
- `mining.test.ts`: every belt record belongs to a system, circles one of its stars and cites a
  source, and rings are drawn only for belt records (Sol's main belt between Mars and Jupiter and
  the Kuiper Belt beyond Neptune, on any date); rocks are the same whenever the player comes by,
  cut at the lasers' rate in their shares, give more to a prospecting scanner, are spent and grow
  back; the hold fills, then pods, with nothing lost; raiders come to lawless belts often and
  patrolled ones rarely; mined goods sell within their price bands and come only from the hold; a
  miner earns like a modest trade route and never above the best hauling route near each belt;
  claims are posted where they should be, count each unit once, guide the flight to their belt and
  pay on delivery; in a real `FlightSession`: belts as targets, the beam's reach and stops, scans,
  pods, spent rocks, and raiders coming for a miner in a lawless belt.
- `frontier.test.ts`: the frontier is the far shell of new systems and every lane into it needs the
  long-range drive; a pilot without one is turned away, one with a short drive is told the lane's
  length; the whole neighbourhood outside it stays reachable without a drive, and drives are sold
  where such a pilot can buy one; no board outside the frontier sends a pilot into it.
- `worldLock.test.ts`: the frozen core generates exactly as it shipped, is untouched by the systems
  the world grows into, and every body a core station orbits is still in the dataset.
- `solar.test.ts`: JPL's elements put every planet where JPL Horizons does, within the accuracy JPL
  states; the game date follows the save's start and the time played; the planets move the right
  way round, faster nearer the Sun.
- `border.test.ts`: every front runs from a working den to lawful space and never leaves a system
  without a repair dock or takes a story character's home; fronts swing with the tide through every
  phase, the same on every device; deeds push, fade and are kept only so long; a fallen station
  gives lawful pilots an emergency berth and its friends the usual welcome, posts no board, and no
  board asks for a delivery to a station that can fall; traffic and the news follow the fronts;
  war contracts are posted by the law only while its front fights and by the dens against the front
  faction's haulers, push the front their way and stop once it is settled; The Long Border reads
  the other arcs' choices and is finished as a lawful pilot, an outlaw hunted by the Authority, and
  neither (the envoys keeping with the player in Ross 154, jumping with them over the line, and met
  by raiders at the Wolf 1061 beacon), each ending holding the front for good (and earning its
  milestone); fronts that end: the four fronts no story settles each have a law station to ask and
  a den to answer; neither side offers its decisive operation without the momentum, with too
  little, once it has faded, or on The Long Border's front; the law's names the den across the line
  and the Wake's the faction's sweep at it, within the pay ceiling; done for the law, the YZ Ceti
  line holds for a whole tide, its stations ship more (machinery at Hearthstone Works is cheaper),
  its board posts the reopened lanes (and the same time slot's board, changed, reuses no id for
  another contract), war work on it stops and the news says the Cooperative holds it; done for the Wake, Hearthstone Works falls for good, and WISE 0722−0540, with no station to
  lose, is blockaded for good in the news; a settled front's operation cannot be taken; a save in
  which The Long Border ended before marks gets the Ross 154 front's marks on load (a truce leaves
  none); every front has marks for both endings, every run a mark promises is on its station's
  board in every time slot once the mark is left, and broken marks are caught; border saves.
- `hauls.test.ts`: the haul timetable passes its guardrails over a day of every station's hauls and
  every shortage's relief, and broken hauls are caught (to a den, from where the cargo is not made,
  contraband, overloaded, along a lane that does not exist, a leg out of time, an unknown name, a
  raider's ship); a station's haul in a slot never changes; Sol, Procyon and Tau Ceti have more
  than one hauler in their lanes on average over six hours, each on a leg in that system; nobody
  sets off into or out of a raid; a shortage's relief comes from makers, sets off in time, carries
  its share, and all of it arriving ends the shortage, the station's stock filling as each arrives
  and its price no higher, and once it is over, its stock is back to normal (the relief part of
  that); with the first hauler in, the player selling the rest relieves it and is
  paid the bonus; a raid loses a hauler in its lanes, which leaves those lanes, is missed where it
  was bound and is in the news there; seen safe through that system it gets through (seen elsewhere,
  it does not), and lost stays lost; a relief hauler destroyed leaves its shortage to run on; the
  world log keeps three hours, older saves have none, and damaged records are refused; in a real
  `FlightSession` in node, the haulers shown in Sol are the timetable's, named, with their cargo and
  where it is going, as many as the plan allows; one destroyed by the player is lost and spills
  exactly half its cargo, of its own good; they leave the scene safe and others join as their legs
  begin; one kept alive through an attack by the player's guns sends thanks when it gets away, and
  one the player fired on sends none; stock the hauls move stays within reason.
- `captains.test.ts`: **your captains on the lanes**. A run's way: between two docks of one system
  one leg each way, over a jump out of the dock, a jump and in to the dock (home the same way back),
  from the end of loading for the run's time each way; the lanes' guardrails pass on every route a
  captain can fly (2,769 of them, the frontier's long routes among them), and broken ways and raids
  are caught (a leg out of time, a system off the route, home not the way back, a raid off the
  middle of its leg or in the wrong system); a run into the frontier takes a finite time and gets
  in (it never did). Where raiders strike: the same runs as before, in the least secure system at
  the middle of the leg; out of sight they take the cargo there and then (the report says where),
  and the robbed run flies on empty, sells nothing and comes home; a ship they destroy is lost at
  the raid, insured or not. A raid in the player's sight waits while the ship is in sight where it
  is due (not elsewhere), and strikes at its own time once the player has gone; seen safely past it
  does not strike and the run sells (seen in another system it counts for nothing), the save keeps
  that and refuses a damaged record, and settling once or in steps comes out the same; destroyed in
  sight, the ship is lost there and then with its cargo, insurance paying for raiders and not for
  the player's guns, and on the way home only the ship is lost. `captainsIn` and the Fleet window's
  status say where each one is. In a real `FlightSession` in node: the player's own hauler flies
  in their system, named as theirs with its captain, cargo and destination, marked and in the
  target cycle, whatever the traffic plan's cap, and leaves at the beacon; one flying behind its
  schedule is not doubled when its run turns for home; a raid due in sight
  brings an ambush on it (the fleet holding the raid meanwhile), and beaten off, the captain says
  thanks and the run sells (the ship its luck would have lost kept); left to it, the raid would
  strike as its luck says, and the captain making its dock with the raiders on it got away;
  destroyed by raiders or by the player, it is lost at once, spills half its cargo of its own good,
  and is no crime.
- `outposts.test.ts`: **a station of your own**. The outpost guardrails pass, and broken rules and
  sites are caught (contraband needed, income that does not grow, a stage that drops the market, one
  that pays for itself at once, a name word already a station's, a site in a hand-made system or of
  a kind outside its band); there is one site at each confirmed planet of the generated systems and
  none in Sol or Alpha Centauri. The charter: offered only at a station of the site's system, for
  the fee, with a name offered, once to a pilot, and not without the credits. The outpost is the
  save's only: found by its id, never among the world's stations, a dock clear of its planet in its
  system's scene (built in node, a shipyard's frames while it is built), and gone for another
  save. Building it: only what the next stage needs, only at the outpost, the frame opening it with
  a market and repairs (the trader's room, live quotes, no board yet), the station posting work and
  the port selling consumables; nobody else's market tables, prices or board change. Its income:
  nothing while it is built, then by the hour moved by raids in its system, the same however often
  it is settled; a captain can be hired to it once it trades. Saves keep it (docked there too) and
  refuse a damaged outpost, or a dock at one the save does not have.
- `passengers.test.ts`: **passengers and sightseers**. Cabins give 2, 3 or 4 berths by class, cost
  a little speed and are sold at outfitters. The passenger guardrails pass (143 sights, every kind
  among them), and broken ones are caught: a number written into a line, a field a line cannot
  fill, a sight that is not real. A sight's facts are its record's (a planet's period to two places
  under ten days, a minimum mass said as "at least"), and every line about every sight fills. A
  passage: posted with a party, refused without the berths, kept with its cabin fitted, its fare cut
  by a fright down to the floor, and paid on arrival with the rough trip noted and a goodbye. A
  tour: its sight still to see though scanned before, seen once with a line from the sightseer,
  then home and paid in full. In a flight scene: a planet seen from within range only, once, a
  belt from inside its band, nothing from the arrival point, and the few sights in view from a jump
  beacon never a tour's; hull hits felt as a share of the hull, shield hits not. Saves keep a party,
  a sight seen and a fright, and refuse damaged ones.
- `rivals.test.ts`: **rival pilots**. The rival guardrails pass over two days of every career (with
  trade runs, hunts and races among them), and broken rules, rosters, lines and runs are caught (a
  turn too short, a shot that raises standing, a family name the bars use, a home in Sol, a number
  in a line, a run that overruns, contraband). Careers start after the opening, each run from where
  the last ended, the same in every save; a rival rests in the bar, flies its legs, waits docked at
  the maker while a runner loads, and docks where it was going. A trade run takes its cargo out of
  the market where it loads and into the one where it sells. A hunter takes a bounty off a board as
  it sets off; bought back, it is on the board again for the claim's price and a little standing; a
  hostile hunter will not sell, and a job the player holds is not shown taken. A runner's race ends
  a shortage sooner, and beaten to it by the player it sells nothing and the News says so.
  Standing: a round once a shift up to its cap, friendly tips, a shot once a flight, hostile and
  amends. A knock-out: out of the game, its run lost, in the News, back at work from home. In a
  flight scene: a rival met, named, with its ship and cargo, shot and destroyed (an attack and a
  crime, as for a trader); hostile in a lawless system, it fights as a raider with no bounty and no
  crime. Saves keep standing, knock-outs and claims bought, and refuse damaged ones.
- `stellar.test.ts`: **stellar death, as fiction**. The far stars' data passes its checks (and one
  placed inside the map is caught); their directions in the sky are their ecliptic places (Betelgeuse
  about 16° south of the ecliptic, Antares about 4.6°), within the parallax the map allows. The
  stellar guardrails pass, the supernova's peak is a typical Type II-P peak at Betelgeuse's distance
  (magnitude −10.8), and broken rules are caught (a peak brighter than the full Moon, a stretch of
  the timeline that runs back, Antares stirring before the peak, an unpaid observation, a baseline
  too short to measure, a number written into a line). The timeline is
  set once the opening is done (and for an old save past it, from loading), and runs in order; the
  stars look the catalogue's until the light comes, then the supernova rises, holds, fades to its
  remnant, and Antares brightens and is gone. The News tells each moment newest first, from the
  catalogue's numbers, and moves on long after; the stations call the big moments. Research stations
  pay more for data cores while a star dies, nowhere else and not after. Observation jobs: posted at
  research stations only while a star dies, passing the contract guardrails; accepted, nothing to
  read before the light; a reading in the window counted, a second from the same system a moment
  later not stored twice; back at the station, paid in full. A parallax only from two systems far
  enough apart, both in the window; Antares has a watch of its own. Saves keep the timeline and the
  readings, and refuse damaged ones. In a flight scene: Betelgeuse a target with its distance in
  light-years and the Fiction badge, Antares not yet; Observe offered and taken; never flown to; its
  remnant still labelled fiction, and before its light the catalogue's star.
- `gluts.test.ts`: **gluts that ship out**. A glut's shipments go to the nearest stations that take
  its good, a share of its surplus each, in their time, on the timetable (their ids, sender, cargo,
  loads and departures, each found by its id), and pass the haul guardrails; the glut clears once
  both have gone (each counted as it sets off), and sooner as the player buys it up (another good
  does not count, nor does buying once it is over). Shipments take their cargo off the glut station
  as they leave, and add it where they arrive; the News lists them, and they fly the lanes. A
  harvest ships its first good; a raider den's shortage draws no relief. Broken shipments are caught
  (not out of a glut, out of their time, too small to send). Escorts for relief and shipments
  through raided lanes: posted by the sender from the event's start until the haul is due to set
  off, passing the contract guardrails; taken on, the haul waits for the pilot, off its timetable and
  posted no more, and is delivered when the escort sees it docked; lost with the escort, and back on
  its timetable when the job is given up; gone once the haul has set off alone. Saves keep an
  escorted haul and refuse a damaged record.
- `doomed.test.ts`: **Pyre, the invented star**. Its guardrails pass (apart from everything real,
  beyond the census, near its frontier anchor, a red supergiant), and broken rules are caught
  (inside the census, a catalogue-like or taken name, the wrong anchor, a lane that opens too soon,
  a number in a line, pay over the ceiling, a crowd of observers, first light nobody can outrun, gas
  that fades too soon, tides that do nothing); its id and name are in none of the real sky's data
  files; its brightness, size and black hole are what the physics makes them (−7.0 from Earth,
  −10.7 from GJ 915, a peak of −16.7, about 1,180 solar radii, a 29.5 km horizon radius, tides within
  6,000–7,000 km). Its warning is set once Antares has gone and the frontier reached, and never
  moves; its timeline runs forward and its light crosses the map a light-year a minute; how it looks
  in each sky changes only once its light arrives there. The News, radio and research prices tell
  each moment; saves keep the warning and refuse one before Antares has gone. In flight: its own
  system (the star marked as fiction, its observatory, no traffic), Pyre in GJ 915's sky counting
  down to its light, its black hole once gone (no star, the hole a fiction target, its remnant
  station, its tides an obstacle the autopilot keeps out of), the gas's glow fading as t^−5/3, the
  hull strained inside the tides as 1/r³ and the ship lost at the shadow, the autopilot stopping
  short, the scan offered from outside; a ship still there at the breakout carried out once; the
  lane closed to arrivals from the collapse until the debris thins (counting the jump's time); the
  rescue dock and docking refusals; its work posted where and when the rules say, sound by the
  contract guardrails and shown only while posted, the last record paid, the observers carried out
  even when caught by the explosion, first light counted only within minutes of arriving and from
  two systems the second farther out, the hole read where it is; its stations' own markets; its
  status line and its stations' welcomes.
- `outpostRaids.test.ts`: **defending your outpost**. The guardrails pass, with raids hurting an
  undefended port without ruining it (more in lawless space than thin) and three turrets paying for
  themselves in 20–60 hours; broken rules and lines are caught (odds falling with lawlessness, a hold
  table that dips, a loss that pays, a guard too slow to arrive, a number in a line). The odds of
  holding climb with the defence, raiders downed count, and read in words. The windows: none before
  the outpost has been open three hours, the probe first (one pair at threat 1, seen half an hour
  off), the same for the same save, full raids after it at the band's threat (a frame one lower),
  more raids as the outpost grows and a quarter as many for a pilot the Wake trusts. The watch's
  warning (once, the job posted, its objective counting down). Raids decided away in time order with
  the income: a weak defence loses them (the income halved for its hours, the market dearer for its
  good, a quarter of what is stored taken, never the credits), a strong one holds most; a raid due
  while the player flies in its system waits for the flight, and the outpost's hours with it.
  Turrets built from materials one a stage, their upkeep out of the income, repaired when knocked
  out. Guards: two offers a posting, hired for a term paid up front, on post a quarter of an hour
  later and gone at its end, at most two, from the outpost or a full-service dock, never for a hunted
  pilot. Saves keep it all and refuse damaged defences. In a real flight: the turrets and a guard by
  the outpost, the raid striking at its time with half its raiders for the stores, a turret firing on
  a raider in range, the raid held when the last raider is down (their bounties paid), and lost when
  the stores are broken open, the raiders making off; a guard hired for later joining the flight at
  their time and saying so over the radio, one whose term is over not coming.
- `crew.test.ts`: **your crew**. The guardrails pass, and broken rules and words are caught (a
  bonus falling with grade or worth a class step, a wage over a sharp guard's, a deed both liked and
  hated, quarters not by size, a he or she or a number in a line). Hands sit at a bar by its kind
  (two engineers at a shipyard, gunners at a military base, a navigator at a relay, nobody at a farm
  or a station not yet open), the same for every pilot within a shift, and none for a wanted pilot.
  Signing on costs two hours' wages; one of each role, as many as the ship's quarters (two in the
  courier), with passengers' berths untouched; a ship with too few quarters cannot be bought or
  switched to. Bonuses by grade, scaled by morale, gone while hurt; the navigator's cheaper jump.
  Morale: each heart weighing the deeds since the last dock (held to so much a dock), rest, a round
  once a shift; wages paid at each dock for the clock flown, an unpaid hand owed and unhappy; notice
  given at one dock and served at the next, or taken back; letting someone go; settling twice at a
  dock changing nothing. Hurt: once at a time, untreated docks, a medic, mending with time, the ship
  lost hurting everyone. Stories: two rescues bring a soft-hearted engineer's tale, an hour on the
  favour, a letter carried a grade and standing; a rule-bender's crate loaded when taken (refused
  with a full hold) for a free port; an ex-patrol's tale after three raiders and a pack in a lawless
  system; a favour untaken lapsing, one taken and not done failing. Saves keep the crew and refuse
  damaged records. In a real flight: a gunner's guns hit harder and lock sooner, a navigator's scans
  reach further, an engineer's shield recharges faster; an engineer mends a damaged system at their
  grade's rate down to the floor and says so over the radio; a hit hurts the gunner at the rules'
  rate from the crew's own luck.
- `rivalStories.test.ts`: **rival stories**. The guardrails pass, every rival with a story it can
  play, and broken rules, paths and lines are caught (a yield too low, an ally out of reach, a duel
  window too short, a duel's loss leaving a rival hostile, a rival with no story, a he or she in a line, a
  number in one). Careers with no story are held to a fingerprint of what they were before stories
  (every run, where each rival is every few minutes, and the hunters' claims, over three days). A
  friend asks for a loan only once known two hours and at friendly standing; lent, it comes back
  with interest as their next run docks. An escort: asked at their table for their next run, a job
  with their own ship, the rival held (out of the bar, the run never setting off), seen in for the
  pay and standing, then docked where it was bound and back at work from there; left waiting, they
  go alone and think less of the player. A rescue: the drive fails on a later run (the run cut
  short, the rival adrift in its system), a distress call and a job for four ship components, paid
  for the parts and more when handed over; given up, a tow home and standing lost, told in the News
  near where it happened for an hour. An ally: asked
  at their table, on the wing for free (a jump pays them nothing), held while there, leaving the
  wing at the next dock and staying there, not again for three hours, not with the wing full,
  parting ways; a friend's rounds up to an ally's standing, and an ally hunter's claims for nothing.
  A feud: planned when a rival is made hostile, its opening at a turn an hour on and two after they
  met; customs tipped off in lawful space near home, once, then the duel posted off a lawless
  beacon (a job, the rival held there, the News telling of it); hired guns in lawless space near home, a hunter flying with
  one, the rival lying in wait meanwhile; the duel won (the purse, standing back to 0), lost (the
  stake, standing at −10), missed (the feud stands), and under way past its window; amends ending a
  feud before its opening or with a duel posted. A friend made hostile ends their story, leaves the
  wing and gets no feud. Saves keep stories, when a rival was met and an ally on the wing, and refuse
  damaged ones. In a real flight: an ally on the wing in their own ship, lost there as a wingman;
  hired guns striking after their delay, wanting the player, paying no bounty, once a flight; a
  duel's rival waiting off the beacon with no raider packs coming, too battered a player told so,
  the duel started close in, shots in it costing no standing, the rival yielding before its ship is
  lost (and a shot after that costing standing); the player yielding before theirs is, and flying
  off forfeit; customs tipped off scanning a clean hold; and a rescue or a duel posted mid-flight in
  the player's system bringing its ship into the scene at once.
- `lanes.test.ts`: **lane encounters**. The guardrails pass, and a pilot touring the lanes meets one
  every 15–25 minutes, every kind somewhere; broken rules are caught (chances falling with
  lawlessness, bait in secure space, tolls falling with the threat, a hail too brief, a number in a
  line). Odds read in words. The world's slots hold the same encounter every time, never in Sol or
  at Pyre, a toll at the packs' threat. The pilot's gate: after the opening, once a slot and a
  cooldown, the first never a toll, customs or a trap, customs only with contraband aboard, no toll
  for a pilot the Wake trusts. Every kind's choices and what they bring: a mayday's ship marked,
  paying when reached, or bait found out there, sprung, its job failed (the card naming the odds); a
  lifepod's berth kept and its pod marked, the fare paid on docking only once it is tractored in,
  closed without a berth; a toll paid (the pass), refused or let lapse (raiders), closed to a pilot who
  cannot pay; customs declared (half the fine), bribed (looked away, or a sting with its own fine and
  standing lost), dumped (standing lost), or ignored (a full scan); a scientist's berth with a data
  core, helium-3 for pay, a tow; cargo adrift marked as pods summing its load, tractored in, then
  returned and paid on delivery, or kept, or bait (sprung, nothing aboard); a lost trader's fix and
  charts; every card's words filled with no number written in, a
  choice for each line. The save keeps what was met, tidily, and refuses damaged records. In a real
  flight: the hail comes once the ship flies quietly, is written into the save, offers Answer, calls
  the card, and lapses after its time; a refused toll brings raiders, a paid one leaves the ship be.

- `wrecks.test.ts`: **wrecks to fly to**. The guardrails pass over every system, and broken rules
  and words are caught (danger falling with lawlessness, a trap in secure space, raiders lying dark
  sprung beyond a scan's reach, a step too short, a hull not in the catalogue, a fence paying less
  than the insurers, a number, *she*, a line saying something about a real body, a field it cannot
  fill). Sites are the same every time from their ids, never in Sol or at Pyre, placed clear of
  docks and bodies without touching the scene. From the lanes: a wreck or a derelict marked (near
  the hail's body, drawn larger), logged for the salvors (+1 standing) or left; four marked close the
  go choices. From a scan: the slot's find once, never before the opening, never twice. A wreck's log
  read (the first log holding a lead) and its pods tractored in for its salvage and cargo, then done;
  a derelict boarded for its salvage and a data core, or told the hold is full; leads only when no
  trail is under way, and later logs about one in three. The trails lead where they should from every
  kind of start (never Sol or Pyre, endings at stations of their kinds, insurers lawful); each is
  followed to its end and paid (the lifeboat's recorder and its crew; the strongbox, guarded, to its
  insurers and to a fence with the Wake's thanks, its extra pods still to take; the sister ship near
  its body), goes cold after its step (never while flying where it leads), drops when abandoned, and
  comes once a save. Settling lapses a site after its window, never while flying there; tidying keeps
  the rules' count; a decoy sprung for a pilot the Wake trusts is a wave and nothing to gain. The save
  keeps sites and trails and refuses damaged records. In a real flight: a wreck's hull and pods there,
  *Scan* offered and its log read, its pods tractored in and the site done, its marker gone and
  nothing left lingering; raiders lying dark by a derelict sprung near the hull (none remembered
  lingering) or shown by a scan from further out; a derelict boarded by holding steady, and boarding
  broken off by pulling away; a guarded wreck's raiders holding their spot; a ship in distress
  reached; a site marked mid-flight joining the scene once.

- `ranks.test.ts`: **ranks that open doors**. The guardrails pass over the world's boards and yards,
  and broken rules and names are caught (a discount too big, standing that falls, a Wake rank below
  its trust, a rank named like a rating, outlaw work for the law, a margin wider than the gap between
  ranks). The ladders need both standing and a record in either of two ratings, exactly at their
  thresholds. Promotions come only at the faction's own open dock (not an independent's, not on an
  emergency berth, the Wake's only at a den that takes the pilot in), straight to the highest rank
  earned, once; ranks fall a step when standing drops ten below what earned them, at any dock, and
  their perks wait while the faction hunts the pilot. The discount comes off at the faction's own
  yards only and is charged on gear, ships and ships kept, and nothing bought there at the top
  discount sells back for a profit. Commissions are found by id, locked below their rank and open at
  it, never chained, never taken by a rival; a sixth contract at the top rank. The Wake's rank keeps
  its raiders off an outpost more; the News tells promotions nearby for two hours, the Wake's only in
  its own places. The save keeps ranks and refuses damaged ones. In a real flight with a raider near
  an Authority station, a Lane Officer is cleared in (Dock offered, traffic control on the radio) and
  an unranked pilot is not.

- `racing.test.ts`: **races on the lanes**. The guardrails pass (the rules, the words and club names,
  sixteen clubs in well-policed space, every course clear and flown in each class's fastest and
  slowest hull inside the cutoff, the slowest also at the lowest skill with touch's reach of stick,
  never near a surface; sampled heats where nobody beats the record and the levels win and place as
  meant), and broken rules are caught (gates too narrow, a purse over the ceiling, a fee too small, a
  heat too short, a record no better than the racers). Clubs and courses are the same every time,
  Halcyon Ring's a novice club round the Moon, clear at twenty dates. A gate counts only crossed the
  right way inside it, a near miss is a miss, a fast step is caught. Fields are the same every time,
  rivals race in their own ship's class and never when out for the pilot; par comes with a split at
  every gate. One heat flown in frames of 1/144 s, 1/24 s, irregular ones and 0.8 s comes out to the
  same times, and the times worked out early from where the racers are come true; a start from over
  the line is a false start. Entries are locked before the opening is done, with fines, wary standing
  or no money for the fee; the fee is charged, a heat late in its half hour is the next one, and an
  unstarted entry lapses. A finish is placed, paid, recorded and rated (Rookie), the record purse
  paid once, the News and both milestones follow; a retire counts a run. The save keeps it all and
  refuses a damaged log. In a real flight: Start offered in the box, the countdown, cruise and the
  autopilot sealed, and Retire offered when held still.

- `wing.test.ts`: **wing command**. The guardrails pass, and broken rules and words are caught (a
  veteran aiming or jinking like a raider, hitting too hard, a skill not rising, too many points a
  flight, a ladder too short, fees doubling, loyalty too quick, credit souring a loyal wingman, a
  mayday beyond the release, a medic too dear, a number and a *she* in a line). Grades come from fights
  and downs with a sharp hire one up, each flying better; fees rise with grade, a loyal wingman asks
  less, and the hiring board asks the same; fights win trust, a bad hit and a loss cost it, one shot
  down is not launched, and an ally keeps no record. At a dock one shot down rejoins hurt, a dock passed
  untreated after the first weighs on them, settling twice changes nothing, the medic (dearer after a
  loss, none at a den) sees to them; a hurt mends in its time; a new grade brings a raise once; a wary
  wingman gives notice and leaves at a later dock unless won back. Short of credits a wingman leaves
  unless loyal, who flies on credit, paid at the next dock or gone; one waiting to rejoin is not paid;
  the journal keeps six. What they say follows memory and trust, the same each time. Saves keep the
  records and refuse damaged ones. The orders on their own: a guard or hold ends at a jump, Defend and
  Cover locked with why, a new foe after a moment, a guard going for whoever goes for its ward and
  keeping station off it, released when the ward is lost or the pilot is far, a hold fighting only what
  comes close or goes for them and keeping its point, nobody fighting hurt, in a duel or formed up,
  forming up boosting home, and fights and downs earned once a pack, within reach and capped. In a real
  flight: wingmen launched at their grade, a veteran reacting sooner than a steady hand, a wingman badly
  hit saying so and holding back (and one launched hurt), a hold staying behind and coming back when the
  pilot is far, Cover keeping station off an escort, and a raider downed earning a fight and a down, a
  wingman shot down picked up.

- `battles.test.ts`: **the border in sight**. The guardrails pass (every front's battle lines in
  both systems and its turning points clear, schedules the same each time, turning battles once a turn
  of the tide where a station can fall), and broken rules and words are caught (a battle too big, too
  big on Low, a purse as much as a war contract, deeds other than the owner chose, a window too short,
  a line within a den's alert, an aim too good, a certain clash, a number and a *she* in a line).
  Clashes come by slot where a front fights, sized by the tide and smaller on Low, one a slot at
  Lacaille 9352 between its two fronts, none on a settled front; a turning battle is due in the
  pressure's window before Regent Concourse falls or is freed, once a turn, and not on a front with no
  station that can fall. Settled: won with the pilot's part, the deed, 900 cr and standing, and the
  station held for that turn; a retaking won frees it at once; on the Wake's side its standing and the
  station falls early; a clash pays 300 cr; won without the pilot, lost or drawn, only the record;
  settling twice changes nothing; the News tells a turning battle for two hours within reach; saves
  keep six a front and refuse damaged records. In a real flight: a clash opens at the beacon line a
  moment after arrival, the strip counts each side, the pilot's part counts once and the winners
  hold; a pilot the Wake trusts fights on its side and the wing holds its fire; a lawful ship fired on
  turns on the pilot; an assault comes in two waves; a turning battle opens before a clash due at the
  same time; a battle left unfinished is staged again; and
  left to themselves both sides win some clashes.
- `fleetWork.test.ts`: **captains supply outposts**. The guardrails pass, and broken rules are caught
  (no share, too large a share or cut, a transit other than the mining estimates', a spot within its
  own clearance, a fraction where a whole number is due, a clearance no spot can keep). A refinery's
  spot lies in its ring. A supply run loads what is aboard, then storage, then the market, and costs
  the goods, a tenth of the loaded goods' base value and both ways' fees; a hold with goods aboard is
  not hired out; it is never raided; delivered, the goods count toward the stage. Earth Port sells
  machinery but not habitat modules or metals: the captain delivers the machinery, then waits, said
  once, until storage has the rest. From a station on, stage after stage until complete, it delivers
  and signs off. A mining captain needs a laser; its load is the belt's mean shares (a main-belt load
  70% ore); it sets out, works in cycles (out to the rocks, cutting, back, handing over), is seen
  cutting where it works, hands over only what the hour's allowance leaves after the pilot's own
  refining, is paid less its 30% cut, waits for the next hour with the rest and goes out again;
  its refinery cannot be given up meanwhile; the save round-trips; recalled, it hands over, flies home
  and signs off. Settled every 30 s or once over 12 hours, the outcome is the same, never above the
  allowance, and the refinery's market has the refined goods.
- `beltOutposts.test.ts`: **outposts in the belts**. One site in each cited belt (nine in eight
  systems, Sol's two included), always a refinery; the guardrails pass, and broken rules and places are
  caught (refining that pays no more than a market can, an allowance that does not rise, a yield other
  than half, a refined good a refinery does not make, a belt outpost of another kind, too many
  outposts, a sale fetching more than went in, an angle set for a belt that is not cited, a belt
  without its site, a site that can be something else, a station or a lane where the site is). In the
  scene a belt outpost stands halfway across its ring, level with it, its bay facing out, with no rock
  within reach of it, and none of the Eridani Mining Hub either. Up to three outposts, one a system,
  any mix of planet and belt sites, each paying its own income in one settle; none raided in Sol, the
  probe due in lawless Fomalhaut. Refining pays 2.2 times the base price at once, takes 40 an hour at
  the frame (no more, and no carry-over) and more as a port, puts half in refined goods in its market,
  and refuses a planet's outpost, an unfinished one and goods that are not raw. Selling pays half of
  the charter and the materials, frees the site, moves a pilot docked there to the nearest dock,
  leaves nothing in the save that names the station (a rumour, a watch, old jobs, its raid job, its
  prices), and round-trips; abandoning pays nothing from another station of its system; storage, a
  captain on a run there and a job bound for it each block it, and a parked captain is stood down;
  the journal keeps the last six. Saves: one from before keeps its outpost as the first; more than three,
  two in a system, a belt outpost of another kind, refining over the allowance or at a planet's, too
  many former outposts, an unknown former site, or an abandoned one that fetched something are refused.

### Browser tests (Playwright)

- `journey.spec.ts`: **the nine-step journey from the spec** on desktop and on touch.
  1. Title (Play, Controls, About the science; audio locked until a gesture).
  2. Docked at Earth, with the contract showing reward, destination and difficulty.
  3. A purchase dialog showing price, capacity and destination.
  4. Launch, steer (mouse or touch stick), select Deimos Depot by its marker, Go To through the
     trade lane.
  5. The raider fight: flown with the mouse on desktop; the one-click Avoid combat route on touch.
  6. Mars: clearance, voyage report, selling cargo, the shield upgrade, and the faction reaction
     when the raider was destroyed.
  7. Star map with Alpha Centauri at 4.34 ly, the legend, the covered fee, and the jump.
  8. A/B and Proxima as distinct targets, discovering Proxima b (confirmed, NASA Exoplanet Archive
     link), docking at Meridian, delivering, net profit and the faction reaction.
  9. Jump to Barnard's Star, refresh and Continue, then jump to Sirius and Epsilon Eridani, with
     all five systems visited.
- `platform.spec.ts`:
  - WebGL 2 missing (`?nowebgl=1`): the compatibility screen, 2D map and science notes still work.
  - The audio gesture requirement.
  - Refresh mid-flight resumes at the same place with cargo and job intact.
  - Hidden tab: the simulation freezes, and on resume the ship does not teleport.
  - Safe-area insets respected (HUD and touch controls).
  - **WebGL context loss** forced in flight (`WEBGL_lose_context`): the notice shows, the game
    freezes and is saved, and when the context is restored the notice goes and drawing and flying
    carry on, with no errors.
  - **Multi-touch**: steering and aiming at once, firing while held, and lifting one finger
    keeps the other in control.
  - **pointercancel** releases both sticks.
  - **Rotation mid-flight** (390×844 → 844×390) keeps the ship and re-lays out the controls.
  - **Taking over the controls cancels docking**: throttle (desktop) or the steering stick
    (touch) during a dock approach, and the Free flight command, all end the autopilot.
  - **Buying a ship**: the shipyard sells a freighter, the deck shows it, and after launch the HUD
    shows its guns, seekers and hold.
  - **Desktop: a hit on a target away from the screen centre during a turn**, with bolts
    following the visible cursor.
- `law.spec.ts`: a wanted pilot sees the fines on the HUD, docks at Halcyon Ring for repairs and
  the customs desk only (no trader, no job board), buys a pardon and has the whole station back;
  the journal shows the three ratings and the codex.
- `story.spec.ts`: the first step of Clean Manifests flown for real (the relay's words, the debrief
  and pay at Halcyon Ring), then the choice about Oren Vail made in its dialogue, the journal's
  record of the arc, and once the finale is done, the save holds the mark that choice leads to, the
  News at Halcyon Ring says its supply lines run clean, for good, and its board carries an
  audited-supply run of medical supplies to Barnard Transit Relay. The Long Border: eight hours on, a blockade of Ross 154 in the
  News at Waymark Waypoint, Kettering's arc on the board, and at the three letters the Wake's answer
  closed (with what it needs) to a pilot the Wake does not trust; the truce chosen, its next step
  on the board.
- `convoy.spec.ts`: **a convoy across a jump**: The Long Border's truce finale accepted at Waymark
  Waypoint; at launch the three envoys keep with the player and the HUD says to jump with them
  close; the jump to Wolf 1061 from the star map's Missions list takes them along (the save says
  so); over the line they make for Flotsam Diggings and the raiders waiting at the beacon go for
  them.
- `fronts.spec.ts`: **fronts that end**: three war contracts' worth for the Cooperative on the YZ
  Ceti – GJ 1 line, and the next time slot's board at Heather Smelter offers the decisive
  operation (knock out Cutlass Nest); done, the save holds the front settled for the law and its
  three marks, the news says the Cooperative holds the line and Heather Smelter's lanes are safe for
  good, and its board posts a run of refined metals on the reopened lanes.
- `frontier.spec.ts`: **First Harvest**: Ines Halloway's call at Squall Relay, Orla Fenwick at
  Harrow Farmstead and the drive parts loaded; in Achird the Wrenna drifts far from any dock and the
  HUD steers to her; alongside her the parts go aboard and the HUD sends the player back to
  Fenwick, whose debrief follows; the journal lists the arc. With the arc ended at Doppler
  Freeport, the save holds Harrow's lasting mark, the news there says it farms for two harvests,
  for good, and its board posts a harvest run of fine food to Doppler Freeport.
- `combat.spec.ts`: salvaged equipment fitted from the stash, damaged systems repaired and a decoy
  bought at the outfitter, then a wingman hired in the bar who launches with the player and forms
  up alongside.
- `people.spec.ts`: a round in the bar buys something true, the journal keeps it, the trade
  computer ranks what the player knows, and a price can be watched.
- `fleet.spec.ts`: buy a ship and keep the old one, switch back, lease storage and move cargo into
  it, buy a stake in the station's trade and collect its dividends, and find it all again after a
  reload.
- `gamepad.spec.ts`: a gamepad flies alongside the mouse or touch, pauses the game with Start and
  hands the controls back when it is unplugged.
- `mining.spec.ts`: a mining laser fitted, Sol's main belt scanned for its source, a rock mined with
  the Mine action (B on the keyboard, the amber action button on touch), ore in the hold, and the
  beam stopped the same way.
- `map.spec.ts`: the star map's finding aids. **Missions** lists Barnard's Star for Clean
  Manifests with its next step and jumps, and choosing it selects and centres the system; with no
  missions it says so. **Find** opens on the nearest systems, finds Alpha Centauri from "proxima b"
  (Enter takes the first match) and Barnard's Star from a typo, says when nothing matches, closes
  on Escape with the map still open, and on a keyboard opens with **/** and moves with the arrows.
  The 2D view zooms about the fingers or the cursor, pans without selecting, and the zoom and reset
  buttons work there. Touch: **a pinch zooms toward the fingers** (the star under them stays within
  6 px while the view zooms 3×), and a touch whose lift was lost does not turn the next drag into a
  pinch. Desktop: **the wheel zooms toward the cursor**.
- `load.spec.ts`: **the first load on a slow phone network**: the build served like GitHub Pages
  (gzip, ten-minute cache, `tests/e2e/pagesServer.ts`) through Chromium's throttling at slow 4G
  (1.6 Mbit/s down, 150 ms latency). The loading title shows within 1.5 s (0.45 s measured), its
  bar moves forward in many steps to 100% and then says Starting while the game starts up, the title
  with Play follows, and every game file comes
  over the network once (the game's imports find them in the cache). A download that fails shows
  the message and **Try again**, which brings the title.
- `offline.spec.ts`: **offline after one visit**: the build served from `localhost` so the service
  worker registers; after one visit the page and every file of the build are in its cache, and the
  device report says so; then the server is switched off and the browser goes offline (a fetch of
  anything else fails), and a reload brings the title, Play starts a game and the star map opens.
  A download that fails once (a 503 for the science notes, which only the worker asks for) is
  tried again, and the report then says all the files are kept; with the earlier worker, which
  gave up at once, the same test fails.
- `device.spec.ts`: **the device report** in Settings, from the title: the build, the load times
  (the loading title and Play), WebGL 2 and its texture size, the safe-area insets (set as a
  notched phone's), touch or mouse as the device has, no flight yet and offline play off in test
  runs; **Copy report** puts exactly that text on the clipboard; after a few seconds of flight, the
  report from the pause menu has the flight's average frame rate and its slowest second.
- `hauls.spec.ts`: **a shortage's relief hauler**: a little after it sets off, the News at the
  station that is short names it on its way, from where and with how much; in the system it sets off
  from, it flies, named, with its cargo; destroyed by the player's guns, the save remembers it lost
  and its cargo is adrift; back at the station, the News says it was lost to a pirate and the
  shortage runs on.
- `captains.spec.ts`: **your captain on the lanes**: Deimos Depot's prices seen, a freighter bought
  at Halcyon Ring with the courier kept, and a captain hired for the courier in the Fleet window
  (electronics to Deimos Depot, insured), which shows it loading; launched, once loaded the captain
  flies the lane in Sol named as the player's (*Captain … · 18 electronics for Deimos Depot*), and
  targeted, the target box says *Your …* and *■ Yours*; raiders destroy it in sight: the ship is
  gone from the fleet, the report (shown as a toast) says where, with what, and that insurance paid,
  the credits rise and the cargo is adrift; docked again, the Fleet window keeps the report.
- `outpost.spec.ts`: **your own outpost**: at Wayfarer Array the Fleet window offers Lalande 21185's
  sites; a charter for GJ 411 b with the name offered costs 8,000 cr and the Fleet window says its
  frame is going up; docked at the site, the Outpost window takes the frame's materials from the
  hold (there is no trader yet), and the outpost opens with a trader's room and says what the
  station needs next; an hour later it has paid its income, with a toast; launched, it is a station
  of the system's scene, named as chartered.
- `passengers.spec.ts`: **sightseers**: at Meridian Outpost the outfitter sells a Bunkhouse cabin
  for the utility mount, bought and fitted; the bar's tour to Proxima Centauri d names its party and
  the berths it needs (*1 berth (you have 2 free)*), and is taken; launched and flown close to the
  planet, the sightseer says so over the radio, naming it, and the tour turns for home; docked again
  at Meridian Outpost, it pays in full.
- `rivals.spec.ts`: **rival pilots**: a bounty a hunter took off a board as it set off is listed in
  the Jobs window as *Taken by …*, not among the contracts; bought back, the job is on the board
  again, the credits are down and the hunter's standing below zero; the News says it took the
  bounty; where its run ends, the hunter sits in the bar under *Rival pilots*, *Wary*, and a round
  brings it back to *Neutral*; out in flight, Mara “Quickstep” Venn's ship flies its leg in the
  scene, named, with the *Merry Dancer* and what it carries, and targeted, the target box names the
  rival.
- `stellar.spec.ts`: **a supernova**: in a save whose neutrino alert has just come, the News at
  Ledger Institute (Wolf 359) tells of the burst from Betelgeuse, marked *Fiction* and saying the star
  has not exploded; the bar's job to catch its first light is taken; once its light has come, the
  stations say it has exploded as the ship undocks (read from the game's log of what the radio said,
  as its message comes and goes while the ship undocks); targeted, Betelgeuse's box reads *Fiction*,
  *Supernova · magnitude −…* and *498 ly*; the action button reads *Observe*, and pressed, the
  reading is taken (*readings recorded*) and the job turns for home; docked at the institute again,
  it pays in full.
- `gluts.spec.ts`: **a glut and an escort**: a minute after a glut starts, the News at its station
  lists its shipments loading (*Shipping out: … is loading … for …*); at the sender of a relief haul
  or shipment bound through a raid, the bar posts an escort for it under the hauler's own name,
  taken on (the haul waits for the pilot); launched, the hauler sets off alongside, named as the
  haul, and the objective names it.
- `doomed.spec.ts`: **Pyre**: in a save whose far stars' story is over, Pyre's alarm comes; docked at
  Pyre Observatory, the News tells of it (*Neutrino alarm at Pyre*, *Fiction: there is no star called
  Pyre.*); the observers' passage (*Out of Pyre's reach*) is taken with a cabin fitted; launched,
  Pyre is targeted (*Invented red supergiant*, *Fiction*); when it explodes the rescue card says the
  ship is carried out to GJ 915 Freeport and that this is fiction; docked there, the observers are
  paid for (less the rescue); the News at GJ 915 tells of its light arriving; once the lane is open,
  GJ 884 Institute's job to read the black hole is taken; at Pyre the black hole is a target
  (*Invented black hole*); inside its tides the hull strains (*Tidal zone*); outside them the action
  button reads *Scan*, and pressed, the science card shows the event horizon and the Fiction line,
  and the job turns for home; docked at the institute, it pays in full.
- `lanes.spec.ts`: **lane encounters** (turned on for this test; they are off in other browser
  tests, which would otherwise meet them): a lost trader's hail on the HUD, the action button
  reading *Answer*, the card (paused, with the Fiction line) and a fix sold; a Hollow Wake toll, the
  card naming the risk, paid; back in the same system in the same slot, nothing more to meet; a
  customs patrol with contraband aboard, the risk named, bribed, the cargo kept; and a real mayday
  answered with a pad (A on the action, the D-pad to the first choice, A to take it), its ship then
  marked in the scene, flown alongside and paid.
- `ranks.spec.ts`: **ranks that open doors**: with standing and three raiders downed, the next
  Authority dock gives a Bonded Carrier's card (what it opens, the Fiction line); the deck names the
  rank and the News tells it; a commission on Halcyon Ring's board carries its tag and is taken; the
  shipyard's note takes 4% off; more standing and a harder record make a Lane Officer at Deimos
  Depot; standing let slip, the rank falls a step at the next dock; and the Wake gives a Cold Hand's
  rank at a den.
- `racing.spec.ts`: **races on the lanes**: at Halcyon Ring's club the Races window shows the light
  class's field of five, the pilot's par and the record; the Moon Loop is entered for its fee; after
  launching, the race strip says to go to the start; in the start box *Start* is on the action and
  starts the countdown (on touch the cruise button is sealed); once the leading racer is two gates
  on, every racer's finish is worked out ahead; the start line, then a gate out of order that does not
  count, then each gate in order finish ahead of them all and of the record; the card says the heat is
  won, with the record purse and the rating's points, and the prize and purse are paid; the racers
  then really finish, each within two thousandths of a second of the time worked out; and docked
  again, the journal shows the racing record and the Racing rating risen.
- `outpostTrade.test.ts`: **outposts join the trade**. The guardrails pass over a day at every belt
  site and a planet site of each kind at each stage, and broken rules are caught (a chance missing
  for a stage, above a half or falling as it grows, no fee or too large a one, fee hours too few,
  fractional or past the income's, a board chance or passage share out of range, too long a reach).
  An outpost sends and draws haulers of its own, none before it opened, more as it grows (about one
  an hour at a frame, under four and a half at a port), the sent ones with goods it makes for the
  world's stations, the drawn ones from makers of what it takes, each found again by its id; none
  while it is built or once it is gone. The world's own timetable is the same, module for module,
  with an outpost or without. Its haulers fly in the systems of their way, shown before the rest of
  the trade. At lawless Fomalhaut nobody sets off into or out of a raid, and one lost on its way in
  is missed by the outpost's market and pays no fee. Dock fees (3% of the cargo at base prices) come
  with the hour's income, the same settled hour by hour or once, within a quarter of the income, and
  only for the last 72 hours when away longer. The Outpost window names the next hauler and the fees
  so far. Boards within two jumps post freight (a good the giver makes and the outpost takes) and
  passages to it, about a third of the time, from their own stream: the rest of each board is as it
  would be without, none goes to an outpost being built, none comes from a den, and a job bound for
  it blocks giving it up. Its market is a spill neighbour both ways, and a glut left at Earth Port
  drifts to it. The star map's search finds it by name, only with the save's entries. No calls are
  left in the rules, and saves keep the fees and refuse negative, fractional or more-than-earned ones.
- `battles.spec.ts`: **the border in sight** (battles turned on for this test, and Ross 154's raider
  packs kept away while the pilot waits in flight): at Ross 154 a clash
  opens at the beacon line a moment after launch from Waymark Waypoint; the battle strip names it,
  counts *Transit Authority* (*you*) and *Wake*, and says Fiction, and the battle line is a target;
  one of the Wake's ships downed by the pilot and the rest by the law, the clash is won with the
  pilot's part and the purse paid; then, as Regent Concourse is about to fall, the Wake's assault on it
  comes in two waves and is beaten off with the pilot; docked, the standing earned brings the
  Authority's first rank, the News tells the battle and the journal's *Border battles* keeps both.
- `fleetWork.spec.ts`: **captains supply outposts**: at Earth Port, with a refinery chartered in Sol's
  main belt, a freighter's captain is hired in the Fleet window to *Supply an outpost* (the dialog
  shows what is bought here and the cost, the haul fields hidden); it loads 6 machinery, its status
  says so, and an hour on the machinery is delivered. The rest brought by hand, the refinery opens. A
  courier with a mining laser is hired to *Mine for a refinery* (the dialog gives units and credits an
  hour); in flight it is seen cutting in the belt with its beam on its rock and marked as the
  pilot's; half an hour on, a load is handed over and paid and the refinery has refined it. Recalled
  at Earth Port, it flies home and signs off.
- `beltOutpost.spec.ts`: **outposts in the belts**: at Earth Port the Fleet window offers Sol's two
  belts; the main belt's charter dialog says it is always a refinery, and once chartered the Fleet
  window says one to a system. At the site the Outpost window waits for the frame, then (open) with
  50 ore in the hold it refines 40 (*40/40 this hour*, the button then disabled) for 48 cr each. In
  flight the refinery is a target. Docked again, *Sell or abandon* names the Sol Transit Authority as the buyer; sold, the pilot is at Earth
  Port or Mars Depot, paid what the journal's *Outposts you have had* says it fetched, and the Fleet
  window offers the site again.
- `outpostTrade.spec.ts`: **outposts join the trade**: a refinery chartered in Sol's main belt from
  Earth Port and its frame built, its Outpost window's *Haulers* names who comes next (or that none
  is due) and says the dock fee is 3%, nothing paid yet; hours on, the fees have come in with the
  income and the window says how much. Launched from Earth Port just before the next hauler's leg in
  Sol, it is seen flying to or from the refinery and is a target (*The …*). Back at Earth Port, within
  a few time slots the board posts work to the refinery, shown in the jobs window; and the star map's
  search, given the first word of its name, finds Sol as *Your outpost …*.
- `wing.spec.ts`: **wing command**: a pilot hired in the bar shows their grade in *Your wing*; in
  flight the order card (V on a keyboard, the Wing chip on touch) pauses the game, lists the wingman,
  locks Defend and Cover with why, and gives Hold (the radio's reply, the HUD's *Wing 1 · Hold* or the
  chip's *Wing · Hold*); *Not now* changes nothing; Form up is given; on a pad, Back held opens the
  card. Shot down after a run of fights, the wingman rejoins at the next dock hurt, a Seasoned wing with
  a raise and *Hurt* tagged; the deck's *Treat your wing* sees to them for 300 cr; a word in the bar
  gives what they say, their record and *Easy*; a reload keeps the record; the journal's wing names
  them, and let go, the journal remembers them.
- `wrecks.spec.ts`: **wrecks to fly to** (hails and scan finds turned on for this test): a wreck
  beacon's hail answered and marked, the HUD objective naming it; from 900 m, *Scan* on the action
  button, the log's card (paused, with the Fiction line) holding a lead, followed; flown in close,
  its pods tractored in for salvage and the job done; the trail flown to its find (the lifeboat's
  recorder tractored in, its card), then docked at its ending and paid, the journal's *Wrecks and
  trails* showing it; an old beacon's derelict, *Board* on the action alongside, held steady until
  its card says what was found; and a planet's scan in a slot holding a find, the faint return
  marked in the scene.
- `outpostRaid.spec.ts`: **defending your outpost**: at Lalande 21185 the charter dialog warns of
  raids; the outpost's frame goes up; a turret is built from materials handed over in the Outpost
  window (*1/1 built*, *Up*); a guard is hired for eight hours in the guards' dialog; the watch sees
  the first raid, a probe, coming (the radio, the job, *Raiders expected in about …* in the window);
  launched, the turret and the guard are out by the outpost and the HUD objective says *Defend*; the
  raiders strike at their time, as many as the raid has, and downed to the last, the raid is held
  with the player there, the job done and the watch saying so.
- `crew.spec.ts`: **your crew**: a soft-hearted engineer looking for a berth is found and sat with
  at their bar's table (what they do, the courier's two quarters), signed on (in *Your crew*, the
  deck's *1 aboard*); launched with damaged engines, they mend them and the HUD's warning says
  *(mending)*; hurt, they do nothing until treated at the next dock's medic; two rescues bring their
  tale at the next dock, an hour on their favour, taken in their dialog, and the letter carried to
  its station brings a grade and *their favour done* in the journal; a reload keeps them aboard; and
  unhappy, they give notice at one dock and leave at the next, remembered as gone unhappy.
- `rivalStories.spec.ts`: **rival stories**: Mara “Quickstep” Venn, known a while and friendly,
  asks for a loan at their table (*1,500 cr*), lent, the credits down and the table saying what is
  owed; as their next run docks it comes back with interest, said over the radio; at their table
  again they ask the player to fly escort on their next run, taken (the job active, the rival out of
  the bar, the journal's *Rival pilots* saying they wait); seen in, they are a friend, and asked,
  fly on the wing (*Your ally* in the wing list), keeping station in flight in their own ship. Then
  Ione “Lantern” Sallow, made hostile, has a feud: once its opening has passed, the duel is posted
  (the job, the challenge over the radio, the table's line); off the lawless beacon the rival waits,
  the duel is the objective, and closing in starts it (*Begin.*); brought to the yield, the rival
  gives up: the purse paid, standing back to 0, the feud over.
- `screenshots.spec.ts`: the loading title (caught part-way, with the game's largest file held
  back), title, Settings at its device report, job board, buy dialog, station deck, shipyard, outfitter, fleet
  (with a captain loading for a run), flight HUD, the player's own captain targeted in flight, star
  map and its Missions and Find dialogs, the charter of an outpost and the Outpost window at its
  site, a party's job open at a bar with a cabin fitted, a bounty taken by a rival on a job board and
  the rival in a bar, the News at a research station telling of Betelgeuse's supernova, and the
  supernova in flight, targeted with *Observe* offered, the News at a station with a glut listing its
  shipments, the News at Pyre Observatory telling of its alarm, Pyre in flight, the card when the
  ship is carried out of its system, its black hole, Pyre's card on the star map, a mayday's hail on
  the HUD and its card, a rival asking for a loan at their table, the journal following two rivals'
  stories, a rival waiting off a lawless beacon for a duel, an outpost's guards' dialog, its defences
  with the first raid seen coming, the raid on it in flight, a hand looking for a berth at a bar's
  table, the crew in the bar (hurt, giving notice, with a favour to ask), a crew member's favour in
  their dialog, a wreck marked in flight and targeted, its log's card with a lead and its choices,
  an old derelict's card once boarded, the journal's wrecks and trails, a promotion's card, the
  journal's ranks, a commission on a board, the yard's discount with the rank on the deck, the
  News telling a promotion, a racing club's window, the start box with the racers on the line, a race
  under way with its strip, a race's result card, the record board, the journal's four ratings, the
  wing's order card in flight, the HUD with a wingman hurt, the wing in the bar, a word with a wingman,
  the journal's wing with those who flew before, a clash at Ross 154's beacon line with its battle strip
  and the battle line selected, the Wake's assault on Regent Concourse, the News of it beaten off, the
  journal's border battles, and the News with a shortage's relief
  haulers on their way, at 360×640, 640×360, 390×844, 844×390, 768×1024, 1024×768 and 1440×900, plus two
  large-text phones: 411×741 with 130% text scaling, and 316×570 (a 411-wide phone at 130% page
  zoom). Saved in `docs/screenshots/` once any smooth scrolling has come to rest. Each is audited
  for page scroll overflow, clipped controls (controls inside a scrolling panel count only if the
  panel itself is off-screen), content cut off inside any box that is not meant to scroll, text
  under 10 px, touch targets under 40 px, and overlaps between HUD panels (the battle strip among
  them), touch clusters and toasts.

## Performance notes (not representative)

SwiftShader renders on the CPU, so frame rates here say nothing about real devices. Observed:
about 8–20 fps depending on viewport, with dynamic resolution lowering the pixel ratio as
designed.

The first load, from `npm run size` on 1 October 2026 (gzipped): the first screen, the loading
title, is 16 KB (HTML, a 7.8 KB script and 7 KB of CSS); the game behind it 606 KB (the game code
with its world and sky data 445 KB, of which the sky's JSON is about 68 KB; three.js 144 KB; its
CSS 9.5 KB; addons 7 KB): 621 KB in all, plus the four interface fonts (71 KB). The star map
(~27 KB with its CSS) and science notes (~4 KB) load on first use; the bloom chain (~4 KB) only on
the High preset.

On simulated slow 4G (`load.spec.ts`, the container's CPU):

| Build | Anything on screen | Title with Play | Transferred |
| --- | --- | --- | --- |
| Before (one bundle, 1038e2d) | 4.8 s | 4.8 s | 679 KB |
| After (loading title first) | 0.45 s | 5.2 s | 683 KB |

Play comes about 0.4 s later than before because the fonts now load with the game (the loading
title uses them) instead of after the title appeared.

## Real-device checklist (partly run — please run the rest)

Open <https://shotif.github.io/starman-reborn/> (or serve over HTTPS with `npm run dev:https` or a
tunnel; see the README), then on an actual **Android phone** and an **iPhone/iPad**. The **device
report** (Settings, at the bottom: **Copy report**) answers steps 1, 5 and 11 by itself (the load
times, the last flight's frame rate, and whether the game is kept for offline play) along with the
phone, browser, screen, safe areas and graphics chip: copy it at the end and paste it with your
notes.

1. Open the site. The title should appear within a second or two, with a bar where **Play** will
   be filling as the game loads; note which network you are on (the report has the times).
   Tap **Play**. Sound starts after the first tap (iPhone: Ring/Silent switch set to Ring).
2. In flight, **steer with the left thumb and aim/fire with the right thumb at the same time**.
   Boost, Cruise, Target and the green action button should all be reachable without letting go
   of both sticks.
3. Rotate the device mid-flight in both directions. The ship keeps flying and the controls
   re-layout without a reload.
4. Check that nothing sits under the notch, rounded corners or home bar, in both orientations.
5. Fight the Mars raiders (target ≥ 30 fps on a mid-range phone with Auto quality), then open
   Settings from the pause menu: the report's frame rate is that flight's. **Show frame rate**
   shows it live.
6. Dock at Mars and check the voyage report shows a profit.
7. Jump to Alpha Centauri, discover **Proxima b** and open its citation, then dock at Meridian
   Outpost and deliver.
   On the star map: **pinch** over a star (it should stay under your fingers as the view zooms),
   double-tap empty space, open **Find** and type a name with the on-screen keyboard up (the
   field and the first matches stay visible), and choose a system from **Missions**.
8. **Refresh** the page and press Continue. Everything should be as you left it.
9. Switch to another app and back mid-flight. The game should not jump ahead.
10. On a tablet with a keyboard or mouse attached, the desktop controls should take over.
11. Optional (offline stretch goal): after one visit (wait until Play appears, then check that the
    report says offline play is ready), turn on flight mode and reload. The title should come back,
    a game should start, and the star map should open.
12. Settings → **Copy report**, and paste it with your results.
13. For the first load over the phone network, open the site in a new **Incognito** (private) tab,
    which has nothing kept from earlier visits, wait for Play, and copy that tab's report too.

Record results here (device, OS, browser, fps, issues):

| Device | OS / browser | Steps passed | fps (fight) | Notes |
| --- | --- | --- | --- | --- |
| Android phone (the owner's): Adreno 750 graphics, 384 × 832 at pixel ratio 2.81 | Android, Chrome 154 | All (1–12), reported "all fine" | 99 average, 54 in the slowest second (a 29 s flight, High with bloom) | 1 October 2026: a pinch over the star map zooms toward the fingers, with the star staying under them. The device report (build c7bb929, on 4G at about 8.7 Mbit/s): the title at 0.7 s and Play at 1.4 s, but on a repeat visit through the offline copy, so not yet a first load over the phone network; no safe-area insets (the browser keeps the page clear of the status bar); offline play 13 of 15 files kept. That led to two fixes: the service worker now tries a failed download twice more, and the report names any file not yet kept and no longer calls hidden download sizes "from the cache". With them (build 817040c, an hour later): offline play ready, all 15 files kept; the title at 0.6 s and Play at 1.6 s, again through the offline copy. **First load over the phone network** (a private tab, 4G at about 9.4 Mbit/s): the title at 0.5 s and Play at 1.1 s, 712 KB downloaded. The rest of the checklist: all fine. That private tab also showed Auto quality choosing Low (pixel ratio 1, no bloom) on a phone that runs High at 99 fps: Auto now starts every device at Medium and steps down only on one that cannot keep up, and half-rate docked and menu screens no longer count as slow (which had lowered their resolution on 60 Hz screens). |
| _pending_: the whole checklist on an Android phone and an iPhone or iPad | | | | Find with the on-screen keyboard up matters most on iPhone Safari. |
