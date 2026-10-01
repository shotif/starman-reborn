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
| Unit tests | `npm test` | Pass: 637 tests in 41 files |
| Production build | `npm run build` | Pass |
| First-load budget | `npm run size` | Pass: first screen 16 KB of 32, first load 621 KB of 700 (gzipped) |
| Browser tests, desktop 1440×900 | `npx playwright test --project=desktop` | Pass: 30 passed (5 touch-only tests skipped) |
| Browser tests, touch 844×390 | `npx playwright test --project=touch` | Pass: 31 passed (2 desktop-only tests, the slow-network measurement and the offline test skipped) |
| Layout screenshots + audits, 7 sizes + 2 large-text phones | `npm run screenshots` | Pass: 117 screenshots, no audit findings |

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
  den, goods not traded, a price out of bounds, two marks on the same goods, a run of goods not
  made there, out of reach or overpaid, a mark no finale leaves, one left by a step before the
  finale, by two finales or unknown); ended at Doppler Freeport, food and fine food are cheaper at
  Harrow and medicine is not, and every board after carries one harvest run of fine food to
  Doppler after the rest of the board, unchanged; ended at Squall Relay, medicine is cheaper and
  food is not, and the board carries the relay's share; nowhere else changes, and the news within
  two jumps tells of it; a mark is left once, kept in the save, and damaged marks are refused;
  v7 saves gain an empty story, damaged story data rejected.
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
  costs one fee, every jump pays the wing, an unpaid or shot-down pilot leaves, nobody flies with a
  wanted pilot; a den knocked out on the player's own account is dark for six hours, paid by the
  nearest law and resented by the Wake; den assault contracts come from the law, need Friendly
  standing and a Hardened record, and are not offered against a dark den; v7 saves gain decoys,
  intact systems, an empty stash and no wing, damaged combat data rejected.
- `flightCombat.test.ts`: a real `FlightSession` in node: hull hits damage systems, which slow the
  ship (and the HUD says so) until a repair kit patches them up; a hull hit flashes the screen's
  edges and the flash fades in under half a second at any frame rate; heavy raiders fire seekers
  at the player and a decoy draws them off; a mine arms, goes off near the player and hurts; hired
  wingmen launch with the player, catch up and are reported when lost; a den wakes when an
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
  Back heard by the pause menu and the map; connections and disconnections reported once; the last
  device used owns the HUD, and a drifting stick never takes it.
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
  milestone); border saves.

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
  and pay at Halcyon Ring), then the choice about Oren Vail made in its dialogue, and the journal's
  record of the arc. The Long Border: eight hours on, a blockade of Ross 154 in the
  News at Waymark Waypoint, Kettering's arc on the board, and at the three letters the Wake's answer
  closed (with what it needs) to a pilot the Wake does not trust; the truce chosen, its next step
  on the board.
- `convoy.spec.ts`: **a convoy across a jump**: The Long Border's truce finale accepted at Waymark
  Waypoint; at launch the three envoys keep with the player and the HUD says to jump with them
  close; the jump to Wolf 1061 from the star map's Missions list takes them along (the save says
  so); over the line they make for Flotsam Diggings and the raiders waiting at the beacon go for
  them.
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
- `screenshots.spec.ts`: the loading title (caught part-way, with the game's largest file held
  back), title, Settings at its device report, job board, buy dialog, station deck, shipyard, outfitter, fleet,
  flight HUD, star map and its Missions and Find dialogs at 360×640, 640×360, 390×844, 844×390, 768×1024, 1024×768 and 1440×900, plus two
  large-text phones: 411×741 with 130% text scaling, and 316×570 (a 411-wide phone at 130% page
  zoom). Saved in `docs/screenshots/` once any smooth scrolling has come to rest. Each is audited
  for page scroll overflow, clipped controls (controls inside a scrolling panel count only if the
  panel itself is off-screen), content cut off inside any box that is not meant to scroll, text
  under 10 px, touch targets under 40 px, and overlaps between HUD panels, touch clusters and
  toasts.

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
| Android phone (the owner's): Adreno 750 graphics, 384 × 832 at pixel ratio 2.81 | Android, Chrome 154 | 7: star map pinch; the device report | 99 average, 54 in the slowest second (a 29 s flight, High with bloom) | 1 October 2026: a pinch over the star map zooms toward the fingers, with the star staying under them. The device report (build c7bb929, on 4G at about 8.7 Mbit/s): the title at 0.7 s and Play at 1.4 s, but on a repeat visit through the offline copy, so not yet a first load over the phone network; no safe-area insets (the browser keeps the page clear of the status bar); offline play 13 of 15 files kept. That led to two fixes: the service worker now tries a failed download twice more, and the report names any file not yet kept and no longer calls hidden download sizes "from the cache". The rest of step 7 (double tap, Find with the on-screen keyboard up, Missions) and steps 2–6 and 8–11 not reported yet. |
| _pending_: the whole checklist on an Android phone and an iPhone or iPad | | | | Find with the on-screen keyboard up matters most on iPhone Safari. |
