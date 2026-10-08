# Known gaps

This is an honest list of what the prototype does not do yet, or what has not been verified.

## Needs your action

1. **Real-device testing has started on one phone.** The automated tests run in headless Chromium
   with emulated phone and tablet viewports, touch events, multi-touch and a gamepad (see
   [TEST_RECORD.md](TEST_RECORD.md)). One real phone, the owner's Android, has passed the hands-on
   checklist (1 October 2026); nothing has run on a physical iPhone, iPad or mid-range phone yet
   (none was to hand, so increment 13 closed without one), or with a physical controller. Please run the checklist in the test record on one, over HTTPS, at
   <https://shotif.github.io/starman-reborn/>, and paste the device report
   (Settings → **Copy report**) with your notes: it carries the load times, the frame rate and
   whether offline play is ready. On the Android phone (a recent high-end one): 99 fps on average
   on High with bloom, and over 4G the title at 0.5 s and Play at 1.1 s.

## The sky, as verified

The star and planet data were checked against the archives on 30 September 2026 by the sky
snapshot workflow on GitHub's runners (SIMBAD, Gaia DR3, Hipparcos, the NASA Exoplanet Archive and
the Extrasolar Planets Encyclopaedia; see [ASTRONOMY_SOURCES.md](ASTRONOMY_SOURCES.md)): 252 stars
in 207 systems, 99 planets and 9 debris belts. Two choices of this edition are deliberate:

- **Contested planets are kept.** 22 planets that an archive flags as controversial, or that no
  archive confirms any more, stay in the game; each says so in its science card and survey
  briefings, with what each archive says. Nothing the archives dispute was removed.
- **Names** are the archives' own. A few systems show a variable-star or survey name (FL
  Virginis for Wolf 424, WISE 0722−0540) rather than the better-known one.

The workflow can be run again at any time from the repository's Actions tab; it commits a new
snapshot branch only when the archives changed.

## Not verified here

- **Frame-rate targets** (60 fps on a laptop, 30 fps on a mid-range phone during the fight): the
  test browser renders WebGL in software (SwiftShader, ~10–20 fps at any size), so only real
  devices tell. The one real phone so far is a recent high-end Android (99 fps on High); how a
  mid-range phone fares, and whether Auto's step down to Low comes when it should there, is not
  known yet.
- **iOS Safari audio.** The unlock follows the iOS rules (context created inside a gesture, silent
  buffer, resume on interruption). Only Chromium was exercised. On iPhone, sound also depends on
  the Ring/Silent switch; the settings screen explains this.
- **Safe-area insets** were tested by overriding the CSS variables, not on a device with a notch
  or home bar.
- **The star map's search on a real phone.** Pinch zoom toward the fingers is confirmed on a real
  phone (1 October 2026). The Find dialog was exercised with emulated touch only: with an on-screen
  keyboard up, it keeps to the visible part of the screen through the Visual Viewport API, and how
  iOS Safari scrolls around a focused field needs a real iPhone to confirm. Double tap and Missions
  have not been tried on a real phone either.
- **WebGL context loss** is forced in a browser test (the `WEBGL_lose_context` extension, in
  flight): the notice shows, the game freezes and saves, and it carries on when the context comes
  back. How often a real phone's browser takes the context away, and whether it gives it back, was
  not seen.
- **The first load on a real phone network.** The title now appears from a 16 KB first screen and
  the game (621 KB gzipped in all, with three.js 144 KB and the game code with the world and sky
  445 KB) loads behind it with a progress bar. On simulated slow 4G (1.6 Mbit/s, 150 ms) in the
  test browser, the title shows at 0.45 s (it took 4.8 s before) and Play is ready at about 5.2 s
  (4.8 s before: the fonts now arrive with the game rather than after it). A phone's slower
  processor adds to the second figure; nothing was timed on a real phone or network. The first load
  has since grown to 806 KB (8 October 2026). Loaded on demand: Sol's real sky (~22 KB: the comets,
  asteroids, moons and spacecraft) once the game's files are in, while its code starts; the star map (~27 KB)
  on first open, the science notes (~5 KB), and bloom (~4 KB) on the High preset only.

## Deliberate prototype limits

- The written story is the opening chain, three short optional jobs, three faction arcs of five
  missions each, The Long Border (five steps, branching three ways at its choice), First
  Harvest, out in the frontier (five steps, branching two ways), The Long Winter, among Sol's
  belt crews (five steps, branching two ways, or ended early by a buy-out), and Last Light at Pyre
  (five steps, branching three ways); everything else on the job boards is generated. A stand in a
  belt (The Long Winter's crews' finale) is not saved while it is under way: leaving Sol and coming
  back starts it afresh. Last Light at Pyre is offered only before Pyre's warning, so a save where
  Pyre has gone never sees it; once taken, Pyre's death waits for its choice however long that
  takes, holding back Pyre's own work too. Its lifeboats not yet gathered are not saved, and a
  flight there starts them where they would be by then; staying for the light, a pilot not clear by
  the collapse loses the arc for good, unmarked. The faction arcs know about each other only through standing and through
  Kettering, whose briefings follow the choices made in them. The lasting marks an arc leaves on
  the world are a dark den (for six hours), the Ross 154 – Wolf 1061 front, settled for good by
  The Long Border (with the markets and boards around it), and one station's market (and most
  often its board) for each way First Harvest and the three faction arcs can end. A mark moves
  prices and stock and posts a run; it does not change who runs a station, its look or its
  people.
- The frontier's own events (harvests, survey seasons, drive failures) follow the clock like the
  others; a stranded hauler waits for the player's rescue however long it takes, and only the
  player's rescue is flown. A survey season's readings never settle a contested planet: the
  archives do.
- The border war is a tide on the clock plus the player's deeds, not a simulation of fleets. It
  runs only on the five lanes where a den's system touches lawful space. Its battles (PROCGEN §35)
  are fought only where the pilot is: out of sight nothing is flown, and only a battle won with the
  pilot's part moves the front. A battle is one at a time in a system, the sides fly patrol fighters
  and raiders only (no gunships, freighters or the stations' own guns), a fled ship never comes back,
  and a battle under way is not saved. The Long Border settles its
  front, and the player's decisive operations settle the other four; a front swings with the tide
  until then, and nobody but the player ever settles one. A settled front cannot be reopened.
- The stations' freight is a timetable of haulers: they fly as ships only in the player's system,
  and elsewhere a raid loses them by its odds. Only shortages draw relief (not gluts, booms or
  strikes), and haulers avoid raids but not border blockades. What the player leaves at a dock
  still evens out with its neighbours as a spill out of sight.
- A glut ships out (PROCGEN §21.6) its first good only (a harvest of food and fine food ships its
  food), to the two nearest stations that take it, and only a shipment's arrival moves the market
  where it lands. An escort for relief or a shipment (§21.7) goes at most two jumps and never into
  the frontier from outside it; an escort given up lets the hauler go on its timetable as if it
  had left on time, so it may already be in, or lost, by then.
- The player's own captains fly the lanes too (PROCGEN §18.6), but only the run's one raid, where
  and when its luck says, can be flown in sight; a timetable raid's odds (§21.2) do not apply to
  them, and the star map does not show them (the Fleet window says which system each one is in).
  A ship guarded through an ambush comes out of it whole: damage taken in sight is not kept. In the
  scene a captain flies at its ship's own speed, so it may dock a little before or after the run's
  schedule says; the sale goes by the schedule.
- Stations of your own (PROCGEN §22, §36) are three to a save at most, one to a system. Their
  materials come by the player's hand or a supply captain's (§37), who loads only at the dock where
  its ship is parked; their frames borrow a shipyard's look while they are built. Their events (§39)
  are the world's kinds only, worked out from what the outpost is now (so one that grows mid-event
  keeps its event, sized anew), and only the latest three an outpost's news has are told after a
  long time away. Once open they trade (§38),
  but only with the world's stations: an outpost's haulers never run to another of the pilot's
  outposts, only lawful boards within two jumps post work to them (never the outposts' own boards),
  and a trade haul that docks there moves its market no more than any trade haul moves any market
  (it is the normal flow, §21.3). Away for more than three days, the hours before the last three pay
  no dock fees. A belt outpost is
  always a refinery, the only kind that refines, and only the ore, ice and gases the pilot brings or
  a mining captain cuts in its own belt. Selling one waits while goods are stored there, a captain
  is on a run to it or mining for it, or a job of its board is under way.
- The people at the pilot's outposts (PROCGEN §41) are drawn, not met in a bar: they live only in
  the Outpost window and the words said on docking, never walk the station or fly. Their asks are
  not jobs: they are not on the job board, the HUD objective or the star map, and a scan ask's body
  must be found and scanned by the pilot. One fetched rides in the jump seat, needing no berth. An
  ask that comes in the second half of an hour shows once that hour is paid (a few minutes of game
  time later); asks made or lapsed while away are told three at most an outpost. The spirit counts
  raids and asks only: the outpost's news (§39) and its haulers do not move it.
- Supply and mining captains (PROCGEN §37) are never raided, by the owner's choice: raiders do not
  hunt them in flight, and nothing is lost on the way. A supply captain carries only what the next
  stages need and buys nothing its home market does not sell; leftovers stay aboard. A mining captain
  works only for the pilot's own belt refineries, its load in its belt's mean shares (not rock by
  rock as the pilot's beam cuts), and its ship is seen at work only while the pilot flies in that
  system; it takes no part in the pilot's own mining field.
- Passengers and sightseers (PROCGEN §23) ride with the player only: a captain does not carry them,
  and the passengers have no lasting names or memories (a party is a contract's, gone when it
  ends). A good look at a sight is a matter of distance, not of where the ship is pointing, and the
  sights are bodies and belts of the catalogue only (no moons, comets or nebulae; Sol's planets are
  not among them). Three confirmed planets whose systems' jump beacons sit within sight of them
  are left out of tours. A fright cuts a fare by the share of hull lost, whoever fired; it is not
  calmed by flying gently afterwards.
- Rival pilots (PROCGEN §24) are six, with careers on the clock: they do not learn from the player
  or follow the player's own routes (only the best routes of their patches), never die (a rival
  destroyed ejects and refits), cannot be hired (an ally flies with the player now and then, §28),
  and fight only as a hostile rival in lawless space, with hired guns, or in a duel. Out of the player's sight they are never lost to raids. A hunter's claim only takes
  the job off the board: the pack it hunts is not destroyed for anyone else. Rivals' trades move
  stock at each end, but they do not buy or sell at the player's own outpost.
- Stellar death (PROCGEN §25) happens once a save, to the two far stars only, on a timeline compressed
  from months to hours: the supernova changes nothing in the world beyond the News, the radio,
  research stations' prices and observation work (no radiation, no new nebula to fly to, no change
  to the star map). The far stars appear in the sky and the encyclopedia but not on the star map.
  Their values are provisional (HYG v4.0) until a snapshot checks them. A reading is taken with the
  action button from anywhere in flight, whichever way the ship is pointing.
- Pyre, the invented star at the edge (PROCGEN §26), dies once a save, on a timeline compressed from
  days and years to minutes and hours. Its black hole is drawn schematically: a black sphere, a ring
  and a disc, with no bending of the sky behind it (no gravitational lensing) and no knots or
  filaments of the remnant to fly through; the remnant is a coloured sky. Its tides are the only
  danger there: no radiation drains shields, and the explosion does nothing to other systems beyond
  their sky, the News, the radio, prices and work. Its system has no traffic, raiders or rival pilots,
  and no hauler, captain or event ever goes there. Its light reaches each system on the map in turn,
  but Betelgeuse's and Antares' still reach every system at once. On the 3D star map its label says
  Fiction, but only the flat map draws a dashed ring round it. A pilot docked when a moment comes
  hears of it in the News, not on the radio (the clock stands still while docked).
- Binary orbits (PROCGEN §44): in flight each pair stands as it did when the orbits were taken from
  the catalogue (6 October 2026), not as it stands on the game's date; only the cards, the star map
  and the encyclopedia follow the date. Separations in flight are compressed, and a companion that
  would crowd the arrival point, a lane or another station stands further out along its real
  direction. Which side of the sky a companion's far side lies on is unknown for every pair (the
  catalogue identifies none of their nodes), so the game takes the catalogue's convention. Pairs the
  catalogue holds no orbit for, grades poorly, or holds only for components the game does not draw
  apart (Epsilon Indi Ba and Bb, LTT 1445's B and C, GJ 1245's A and its close companion) keep their
  schematic places; so does Proxima Centauri, whose orbit round A and B the catalogue grades
  indeterminate. A measurement is read with a single scan of the companion; the pair's primary is not
  scanned.
- Comets (PROCGEN §45): where a comet stands is reckoned as if only the Sun pulled on it, from JPL
  Horizons' elements on 6 October 2026; it matches Horizons within 0.06° for a year either side, but
  drifts by up to 3° four years on, and further from the snapshot it is less sure (perihelia outside
  the six years checked are given only by their year). A comet grows its coma and tails by one rule,
  within 4 AU of the Sun, so 29P, which is active much further out, is drawn bare; its brightness is
  given only within 4 AU, where the magnitude law holds. Comets are drawn far larger than life, are
  not solid, and are not in the codex (it stays the catalogue of stars and planets, so no finished
  survey of Sol reopens). Only these fourteen periodic comets are in Sol; none of the long-period or
  newly found comets of the day.
- Spacecraft (PROCGEN §49): eleven craft only. Those orbiting another planet (Juno at Jupiter,
  BepiColombo, due to go into orbit round Mercury late in 2026), the Mars orbiters and landers,
  and Earth's own satellites are left out, as are Lucy's, Psyche's and the others' targets where
  they are not already among the named asteroids. Where a craft is between Horizons' places four days
  apart is reckoned on two-body arcs (Parker within 0.15° of Horizons hourly through its nearest
  passes of the Sun); after the snapshot it is where its mission planned it then, and outside the span
  Horizons has it for (Psyche after February 2029, Parker after January 2030) it is not drawn. The
  Pioneers' positions are old reconstructions, the Voyagers' predictions from tracking that ended
  in 1992. Each is drawn far larger than life as a schematic of its kind, not its true shape, and is
  not in the codex. A mission's facts are as its sources gave them on the snapshot's day; what was
  planned is told as planned, whatever the game's date. Voyager 2's heliopause crossing is left out
  (the sources disagree on its date).
- Moons of the giant planets (PROCGEN §48): only five large moons are drawn (none of Saturn's others,
  nor Uranus's or Neptune's). A moon's motion is a turning circle with first-order eccentricity fitted to
  Horizons' positions: within a degree for six years, Europa's the least sure, and less sure beyond.
  Distances from the planets are compressed by a power of their own for each planet, so Jupiter's
  four look closer together than they are. Jupiter's and Saturn's axes are drawn along their moons'
  mean orbit plane, not from the IAU's poles. A save
  that had finished its survey of Sol has it open again until the moons are scanned.
- Earth's Moon (PROCGEN §51): its motion is reckoned from Horizons' positions over six years and
  checked against them for ten years after (to October 2040); beyond that it is less sure. Where the
  Sun is comes from JPL's approximate elements. Eclipses are only told of (the News, the Moon's card,
  the encyclopedia): nothing darkens in flight, neither the Moon in Earth's shadow nor Earth in the
  Moon's, and they are dated by NASA's own time scale, with no time of day or place for the player to
  see them from. Only NASA's tables for 2021–2040 are taken (from two years before the snapshot).
  Earth Port, its practice range and the lane to Mars lie the way to Mars at about the Moon's drawn
  distance, so the Moon is moved out along its direction on about one day in thirteen and turned off
  its true place along its orbit on one in fifteen (by 20° at the median, 41° at most), said in the
  scene's note; with distances compressed, its phase as drawn is within about 10° of the real one.
  The Moon is drawn the same size whatever its distance.
- Asteroids (PROCGEN §47): only fifteen named asteroids are in Sol, not the main belt's million;
  the belts' rocks stay schematic. Where one stands is reckoned as if only the Sun pulled on it,
  from JPL Horizons' elements on 7 October 2026: within 0.05° of Horizons for a year either side and
  1° (Psyche) six years on, less sure beyond. Apophis's 2029 pass changes its orbit all at once at
  its nearest, from the elements Horizons gives a month after it; the pass itself is drawn from
  Horizons' hourly path from Earth's centre, in straight lines between the hours. Only passes within
  0.05 AU listed by JPL to January 2034 are told of. The spacecraft that visited them (Dawn, NEAR
  Shoemaker, Galileo, Rosetta, Hayabusa and Hayabusa2, OSIRIS-REx, DART) are not yet on their
  cards. Asteroids are drawn far larger than life, turn far faster, are not solid, and are not in
  the codex. Where a pass is drawn from Earth follows the logarithm between Earth's drawn surface and
  the Moon's drawn distance, so near Earth the scene's distances are compressed too; and where its
  direction runs close to Earth Port, the Earth–Mars lane or the Moon, Apophis is pushed further out along it for an hour or so (an hour and a half before
  its nearest, out past the Moon). From a quarter of an hour before its nearest to an hour after, it
  is drawn where the rule puts it, well inside the Moon.
- The logbook (PROCGEN §46) writes only what happens from when it began: a save from before it starts
  with what the save can date (milestones, the current rank with each faction, finished stories and
  stations of its own) and one line for the systems visited before, with no dates for them. Raiders
  downed, contracts finished and goods traded are not written one by one (the ratings and the
  ledger keep them), and the most credits held is sampled when the game saves, so a peak spent
  before the next save can be missed. At most 400 entries are kept; past that the oldest go, but
  never the first.
- Flare stars (PROCGEN §43) flare on a schedule the game draws, about once every four hours of game
  time each for ten to fifty minutes, far fewer and longer than real flares; how strongly a star
  flares is not tied to how active it really is (all ten are alike). A flare does only two things to
  ships, shields and scanners, and to every ship in its system alike; nothing else feels it (no
  radiation damage, no effect on traffic, prices or the planets' people). The star map's card and the
  News say a flare is under way, but the map draws nothing different. A flare watch whose flare ends
  before the pilot gets a reading stays in the journal, closed, until abandoned. The variable-star
  names were checked against the sky snapshot's SIMBAD identifiers; that each is a flare star (rather
  than another kind of variable) is the General Catalogue's, not re-read by the snapshot.
- Raids on the player's outpost (PROCGEN §29) strike only the outpost: never its captains or
  stakes, and nobody repairs a stores barge between raids (it is whole each time). In flight the
  raiders come out of the dark rather than flying in from a den the player can see them leave, and
  a patrol wing joins only if it happens to be near. Guards fly a loop rather than a patrol of their
  own, and once in the scene they stay until the player leaves it, even past the end of their term;
  a turret or guard shot down in the fight is whole again next time. Away, a raid is decided by odds
  from the defence the outpost had, not flown out.
- Your crew (PROCGEN §30) have one story each and one hurt at a time, and mend only while the
  clock runs (in flight). Their deeds are counted from what the save records and a few hooks
  (lane encounters, sites flown to, contraband sold, rescue and smuggling jobs done, customs finds,
  attacks on lawful ships, raiders downed), not from everything a pilot might do; the trade computer's route
  fees leave out the navigator's discount. Crew never stay aboard parked ships or fly with your
  captains, and those who leave are gone for good. A favour's place is the nearest of its kind,
  not one of their own choosing.
- Rival stories (PROCGEN §28) are one a rival a save, along two paths of three steps, and their words
  are by voice (brash, dry or warm), not each rival's own. A friend's escort is flown as the
  contracts' escorts are, the rival's ship theirs in name and model only. An ally flies as a hired
  wingman does, and does not drop in on a fight uninvited. Hired guns come out of the dark a few
  kilometres off rather than lying in wait at a spot, and an opening that finds nobody is simply
  over. A duel is one on one as far as the scene can make it: no new raider packs come, the wing
  holds its fire and patrols leave the rival be, but raiders already there (from an earlier visit, or
  called by a lane encounter) can still join in. The rival's ship has its stock fittings.
- Lane encounters (PROCGEN §27): raiders called by a refused toll drop out of the dark a few
  kilometres off rather than waiting at the spot. A hail counts down only while no hostiles are near,
  and one in a system the pilot leaves goes with them unanswered (it is not met again). The Wake's
  toll covers only the system it was paid in, until the next dock or jump. A lost trader's tip is a
  price within reach of the system's first station. In browser tests encounters are off unless a
  test turns them on.
- Wrecks to fly to (PROCGEN §31): a site waits two hours (a trail's step three), at most four at once.
  Hulls are catalogue ships, a derelict a larger dark one rather than a ruin of its own; they are
  scenery the ship can pass through, with no collision. Boarding is a wait alongside, not a walk
  inside. A ship in distress, once helped, stays where it is rather than flying on to a dock. Wrecks
  hold salvage and cargo, never equipment, and are never the wreck of a hauler lost on the timetable.
  There are three trails, each once a save and one at a time, and the strongbox's fence is always a
  free port, never a den. Finds come only from manual scans of planets, stars and belts. Raiders lying
  dark come out of hiding by the hull rather than flying in. Nobody else is simulated salvaging:
  *another salvor got there first* is only how a site lapses. None lie in Sol or at Pyre; the star
  map shows sites only through the Missions list, and the News says nothing of them.
- Traffic and raider packs exist only around the player. Packs that saw the player and cargo pods
  left adrift wait for 30 minutes of game clock (in the last six systems), as do the packs and
  wrecks of the player's own contracts; everything else is generated again on arrival.
- Escorts go at most two jumps. On the way to another system the haulers keep station behind the
  player rather than flying a route of their own, catch up after a lane as wingmen do, and come
  back whole each time the player launches (only ships destroyed count against a convoy).
- The law is simple: a crime is known where it was seen and spreads a jump every ten minutes;
  fines lapse after three hours without a new crime; a patrol scans at most once a flight.
  Selling contraband at a station is not a crime; only having it in the hold at a scan is.
- Wingmen (PROCGEN §34) take six orders but no waypoints: Hold keeps the point where the pilot was,
  and Cover picks its hauler by a fixed order rather than being told which. Two fly at most, and the
  card gives one order to the whole wing. Their grades come from fights and downs only (not the
  pilot's rank or a trainer), and they talk in a few lines by what they remember last. Seekers (from
  heavy raiders, aces and bounty hunters) are the only missiles fired at the player, and decoy flares
  the only countermeasure.
- Ratings change the world through the factions' ranks (PROCGEN §32) and the combat rank that ace
  hunts and den assaults ask for (Racing, §33.6, opens nothing yet); milestones are a record, with one
  grant (the whole codex).
- Ranks (PROCGEN §32) are three a faction. They open no ships or gear of their own, and commissions
  are the boards' usual kinds of work at better pay; the people in the bars do not speak of ranks, and
  What next does not point at one within reach. The Wake's outpost perk matters only to a pilot with
  an outpost. A promotion comes as the pilot docks, so standing earned while already docked counts at
  the next dock (or the next contract accepted there). The what-next hint suggests one
  thing at a time and only from places already visited: it never compares ships or equipment
  across the whole sky, and suggests no weapons or shields.
- Races (PROCGEN §33): the racers cannot see or touch the pilot or each other, and steer round no
  traffic; only the pilot's own heats are run, so the News and the board tell nothing of heats the
  pilot did not race, and the record is the club's worked-out best, not a time anyone flew. Times are
  the same on every device and frame rate, though two browsers' maths may differ in the last few
  thousandths of a second. There are no outlaw races in lawless space and no wagers; classes go by
  hull, so fittings count in full; Epsilon Eridani and Luyten's Star have no club. A race under way is
  not saved: loading a save made mid-race puts the pilot back before the start. The factions' ranks do
  not ask for the Racing rating yet.
- Generated stations have generated exteriors and interiors (twelve kinds in four owner
  palettes).
- Damage to systems is modelled for the player only (other ships just lose shield and hull); no
  fleet battles, multiplayer, cloud saves or cross-device sync (out of scope per the spec).
- Solar System planets sit at their real heliocentric longitudes for the game date (JPL's
  approximate elements, valid 1800–2050; outside those years the layout is schematic), with
  distances compressed so the system can be flown; Mars is kept within 140° of Earth.
- Stations and ships do not collide with each other in detail (spheres only).
- The offline cache (service worker) is a stretch goal: it registers only in production builds
  over HTTPS or on localhost, keeps every file of the build after one visit, and is tested in
  Chromium with the server switched off (the game starts and the star map opens). It was not tried
  offline on a phone. On iPhone, Safari can clear a site's stored data, offline files and saves
  alike, after seven days of browsing without a visit, unless the game is added to the Home Screen;
  exporting a save keeps it safe.
