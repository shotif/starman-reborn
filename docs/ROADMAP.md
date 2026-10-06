# Roadmap

From prototype to a full game. Each step ships to the live site (<https://shotif.github.io/starman-reborn/>)
when it is done, so the game stays playable throughout. Status: ✅ done · 🔨 in progress · ⏳ proposed.

## Where the game stands

After the scripted opening (10–20 minutes), the neighbourhood is an open sandbox: 207 real
systems out to 27 light-years, checked against the astronomical archives; 322 generated stations
of twelve kinds; 23 goods with stock-based prices; traders and patrols on the lanes and raider
packs in lawless space; 39 ships and 146 pieces of equipment; and generated contracts on every job
board. Increments 1–42 (under [Done so far](#done-so-far)) added world events and news, contracts
of every kind, the law and the outlaw path, goals, ranks with each faction that open doors, races round real planets and moons against racers who really fly, a wing that takes orders and grows with every fight, border battles to see and join, seven story arcs, combat depth, people in the
bars and a trade computer, a world that answers, gluts that ship their surplus out and relief to
escort through raided lanes, a fleet of your own whose captains fly the lanes, a crew aboard your own ship,
up to three stations of your own to build and defend, refineries in the real belts, captains who supply them and mine for them, outposts that trade with their neighbours, have news of their own and people who live there, passengers and sightseers, rival pilots with careers and stories of their own, a
supernova in every sky (as fiction), real flare stars that flare (when is fiction), an invented star at the map's edge that explodes and leaves a
black hole to fly to (fiction too), encounters on the lanes between the docks, wrecks and derelicts to fly to with short trails across a few systems, mining in the real belts, the frontier with a life of its own,
a border war whose fronts can be won for good, story endings that change stations for good, escorts
and convoys across jumps, haulers with real cargo on a timetable, and a game measured and tuned on a
real phone.

What it lacks now:

- **More real phones.** The automated tests run in a desktop browser with emulated phones and
  touch. One real phone, a recent high-end Android, has passed the whole checklist (99 fps on High,
  Play 1.1 s after opening the site over 4G); an iPhone and a mid-range phone have not been tried.

## Proposed next increments

Chosen by the owner on 5 October 2026, once The Long Winter was live: People at your outposts and
then another written arc, both now done. Asked again on 6 October, the owner left the choice to me,
and I chose flare stars, the option I had recommended; it is done too. The next are for the owner to
choose.

### How an increment ships

Rules go in data files with guardrails ([PROCGEN.md](PROCGEN.md)). Each increment adds unit tests
for its rules, a browser test for the player's path, and layout screenshots at every test size
when screens change. Then the docs are updated (PROCGEN, TEST_RECORD, KNOWN_GAPS), and it deploys
to the live site once CI passes.

## Done so far

### 42. Flare stars ✅

Ten real red dwarfs on the map are flare stars, among them Proxima Centauri, Wolf 359 and UV Ceti,
each with the variable-star name SIMBAD gives it. Every so often one flares, for ten to fifty
minutes: the star glows brighter, and in its system shields recharge slower and scanners reach less
far, by more for a strong flare and most for a superflare. The radio and a line on the HUD say so,
the News within two jumps tells of it, the star map's card and the star's own target say whether one
is flaring, and research stations near by pay pilots to fly there and scan the star while it lasts.
That the stars flare is real; when, how strongly and what it does to ships are the game's fiction,
labelled so ([PROCGEN.md §43](PROCGEN.md#43-flare-stars)).

### 41. Last Light at Pyre ✅

A seventh written arc, at the edge of the map: the people of Pyre Observatory, which watches Pyre,
the invented star, must get out before it dies. It is offered at GJ 915 Freeport before Pyre's
warning, and once taken Pyre waits for it. Carry instruments and metals for bunks through Pyre's
lane, visit a prospector who will not leave, then choose who gets the last berths: the Authority's
cutter (escort it to GJ 4274 Institute), the Co-op's barges (two of three to Fomalhaut B Orchard),
or six who stay for the light. The choice starts Pyre's last hour; staying, gather the observatory's
lifeboats as it dies and take them out through the lane before the collapse, a new kind of flight.
Each ending changes a station for good ([PROCGEN.md §42](PROCGEN.md#42-last-light-at-pyre)).

### 40. People at your outposts ✅

Each of your outposts has people of its own: a quartermaster from the day it opens, a resident more
when it becomes a station and two more as a port, each with a trade (an engineer, a grower, a medic,
a broker) and a face. Now and then one asks you for something: goods brought in, someone of theirs
fetched from a station a jump or two away, or a body of its own system scanned. Each person has a
story of two asks: the first adds a little to the income for good, the second builds their work (the
engineer's workshop patches hulls there at cost, the grower's green bay grows food for its market,
the medic's clinic keeps people well while you are away, the broker's desk sells what it makes). The
outpost's spirit rises with asks done and raids held and falls with asks ignored, raids lost and long
absences, nudging the income up to 5% either way. Meet them in the Outpost window's People, in a word
as you dock, and in the Fleet window's reports while you are away
([PROCGEN.md §41](PROCGEN.md#41-people-at-your-outposts)).

### 39. The Long Winter ✅

A sixth written arc, the belt crews' own, told by their spokeswoman Tamsin Rook at Deimos Depot.
The ice-cutter *Long Winter* has gone quiet in the Kuiper Belt: fly out and scan the belt for her
beacon, take her the drive parts where she drifts in the ice, and carry her sheared coupling to
Rhea Castell's lab at Halcyon Ring (Castell remembers what you did in Clean Manifests). Then
choose: give Castell the case, and escort the crews' recall convoy across Sol to Halcyon Ring; let
the crews settle it, and stand with their three cutters in the Kuiper Belt against two waves of
claim-jumpers, a new kind of fight; or take Hale's money and end it there. Each ending changes
Deimos Depot for good ([PROCGEN.md §40](PROCGEN.md#40-the-long-winter)).

### 38. Outposts have news ✅

Your outposts now have the world's events as any station does: shortages, gluts, booms and strikes
(harvests and survey seasons in the frontier) on the same odds, Sol's outposts included. They move
its prices and, gently, its income (a shortage × 0.85, a strike × 0.7, a boom × 1.2), and the world
answers: relief haulers come for a shortage, a glut ships out, boards within two jumps post shortage
runs and boom supplies to it, its own board answers its own events, and your sales there count
toward relief (with no bonus from your own people). A toast and a line in the Fleet window's reports
tell you when one starts or ends, and the Outpost window has its News. Jobs on an outpost's own board
can now be taken: a fault in reading their ids had kept them from it
([PROCGEN.md §39](PROCGEN.md#39-outposts-have-news)).

### 37. Outposts join the trade ✅

Your outposts now trade with the world. Once open, each has haulers of its own on the timetable,
sending what its market makes to stations within two jumps and drawing in what it uses from the
makers near it: about one an hour at a frame, two at a station and three at a port, seen in flight
like any hauler (yours shown first when the scene is busy), raided like any. Every one pays a dock
fee, 3% of its cargo's worth, with the hour's income (about 30–90 cr an hour at Sol's main belt
refinery), and the Outpost window says who comes next and what the fees have paid. The haulers who
only called are gone. Boards within two jumps post freight and passages to your outposts, the star
map's search finds them by name, and their markets share the drift of stock with their neighbours.
The world's own timetable is just as it was ([PROCGEN.md §38](PROCGEN.md#38-outposts-join-the-trade)).

### 36. Captains supply outposts ✅

Your captains can now work for your outposts. Hire one in the Fleet window to supply an outpost
being built: the captain takes the next stage's materials from your storage at the ship's dock
first, then buys the rest there, for a tenth of the goods' value, and hands them over stage after
stage until the outpost is complete. Or put a ship with a mining laser to work for a belt refinery:
its captain flies there and works the belt in cycles, seen in flight at its spot in the ring with
the beam on its rock, and each load is refined within the refinery's hourly allowance (your own
refining included), the captain taking 30% of the pay (about 1,240 cr an hour at a frame and 2,480 at
a port). These captains are never raided. Recall brings them home
([PROCGEN.md §37](PROCGEN.md#37-captains-supply-outposts)).

### 35. Outposts in the belts ✅

A station of your own can now stand in a real belt, and you can run three. Every cited belt has a
site, Sol's main belt and Kuiper Belt among them (nine in eight systems), always a refinery, chartered
from a station of its system and built as any outpost; any mix of planet and belt sites, one to a
system. From its frame on, a belt refinery takes the ore, ice and gases you mine and pays at once,
more than any market pays for them raw, 40 units an hour at first and 80 as a port, and its market
sells what it makes of them, one refined unit for every two. Independent haulers called about every
four hours (until the timetable's own came, in 37). An outpost can be sold to its system's
faction for half of what went into it, or abandoned: the site is free again, a pilot docked there
rides out to the nearest dock, and the journal keeps the last six you have had. Rocks in a ring now
keep clear of a station standing in it, the Eridani Mining Hub's too
([PROCGEN.md §36](PROCGEN.md#36-outposts-in-the-belts)).

### 34. The border in sight ✅

The border war is now fought where you can see it. While a front fights, its faction's patrol
fighters and the Hollow Wake's raiders clash off the jump beacon in its systems, on a schedule from
the clock, whether you join or not; a battle strip counts the ships on each side and marks yours. When
a station on the line is about to fall, the Wake comes for it in two waves; when it is about to be
freed, the law comes to retake it. You fight on the law's side unless the law hunts you or the Wake
trusts you, and whoever you fire on treats you as an enemy. A battle won with your part pushes the
front your way (a turning battle as much as a war contract), so you can hold a station for a turn of
the tide but not for good, and the side pays a purse and a little standing. The News tells a turning
battle you helped win, and the journal keeps the battles you saw through
([PROCGEN.md §35](PROCGEN.md#35-the-border-in-sight)).

### 33. Wing command ✅

The wing on your pay takes six orders from a card that pauses the game (V then 1–6, the Wing chip on
touch, Back held on a pad): engage at will, attack my target, defend the friendly ship you select,
cover the hauler you escort or answer, hold here, or break off and form up, each locked with why when
it cannot be given. Wingmen grow with every fight beside you and every raider they down, through four
grades from Steady hand to Veteran wing, aiming, reacting and jinking better while staying below a
raider's aim, and ask a higher fee as they do. They come to trust you, or not: loyal ones fly on credit
when you are short, wary ones give notice. Badly hit, a wingman holds back; shot down, they eject, are
picked up and rejoin at your next dock, hurt until they mend or a medic sees to them. Nobody on the wing
is lost for good. A word in the bar, the journal and your former wingmen keep their story
([PROCGEN.md §34](PROCGEN.md#34-wing-command)).

### 32. Races on the lanes ✅

Sixteen racing clubs in well-policed space hold a Sprint round a real planet, moon or star (Halcyon
Ring's is the Moon Loop) and a Run between docks, a heat every half hour. Enter at the bar, fly to the
start box and press Start: four or five racers line up beside you, club members and any rival pilot
docked in the system, and really fly the gates, boosting, cruising on a Run and now and then slipping,
on a clock of their own so a heat comes out the same on any device. Pass the gates in order (a miss
means turning back), with guns, the autopilot and docking sealed, cruise too on a Sprint. Hulls race in
two classes, light and heavy, on raw time; clubs come at three levels; the purse is kept below what
trading pays, beating a course record pays once more, and a fourth rating, Racing, rises with every
finish, podium, win and record. The record board, the journal and the News keep it
([PROCGEN.md §33](PROCGEN.md#33-races-on-the-lanes)).

### 31. Ranks that open doors ✅

Standing and a record now earn a rank with each faction: Bonded Carrier, Lane Officer and
Lightkeeper with the Transit Authority; Field Hand, Shareholder and Elder with the Frontier Co-op;
Cold Hand, Pack Leader and Long Shadow with the Hollow Wake. Each needs standing and a record in
either of two ratings the faction values, and comes at your next dock of theirs with a short
ceremony. A rank opens doors: commissions on their boards for their own ranks, better paid; up to
12% off ships and equipment at their yards; their docks clearing you in even with raiders near; a
sixth contract at the top; the Wake's raiders leaving your outpost alone more often; and your rank
in the News, on the deck and in the greeting. Let your standing slip ten below what earned it and the
rank falls a step; while a faction hunts you, its perks wait. The Wake's ranks and the law's are
independent ([PROCGEN.md §32](PROCGEN.md#32-ranks-that-open-doors)).

### 30. Wrecks to fly to ✅

Lane hails and scans now lead somewhere in flight. Answering a mayday, a lifepod or cargo adrift
marks it on the HUD to fly to: alongside the ship in distress, its pilot pays; the lifepod or the
pods come in on the tractor. Two new hails, a wreck beacon and an old beacon, mark a wreck to salvage
(scan its log, tractor in its pods) or an old derelict, invented and labelled fiction, drifting near
a real planet or star, to board by holding steady alongside. A scan of a planet, star or belt may pick
up a faint return too. Raiders pick some wrecks over in plain sight; others lie dark by a hulk or a
decoy and come out when you get close, unless a scan from further off shows them first. One log in
three, and always the first you read, holds a lead into a short trail across a few systems: a lost
crew's lifeboat, a strongbox to return to its insurers or sell to a fence, an old hull's sister ship
and its vault. A site waits two hours, a trail's step three
([PROCGEN.md §31](PROCGEN.md#31-wrecks-to-fly-to)).

### 29. Your crew ✅

Up to three people now sign on aboard the ship you fly: an engineer, a gunner and a navigator, found
looking for a berth at the tables of the bigger bars and paid by the hour of flight at each dock.
Each makes a measured difference by grade and morale: the engineer mends damaged systems in flight
when no hostile is near and the shield recharges faster; the gunner's guns hit harder and seekers
lock on sooner; the navigator's jumps cost less and scans reach further. Ships have crew quarters by
size, never shared with passengers: fighters one, couriers and surveyors two, freighters and
gunships three. Each has a heart (soft-hearted, rule-bender or ex-patrol) that likes and hates what
you do, and their morale follows it: unhappy at a dock, they give notice, and leave at the next
unless things change. A hit to the system they work may hurt them; they mend in two hours of flight
or with a dock's medic, and nobody dies. Each has one story: their tale, then a favour (a letter, a
sealed crate, an old quarry's pack) that earns them a grade
([PROCGEN.md §30](PROCGEN.md#30-your-crew)).

### 28. Defend your outpost ✅

Raiders now come for your outpost. Every few hours, in thin or lawless space, a raid may be due:
its watch sees it coming a quarter of an hour off, says so over the radio, and a job asks you to
defend it, with the odds of holding shown in its window. Build turrets there from hauled materials
(one for each stage it has grown to, three at most), and hire guards by the hour at the outpost or
from the Fleet window at any big dock; they take up their post a quarter of an hour later. Be there
when it strikes and fight beside them: the raiders go for its stores, the turrets and guards for the
raiders, and every raider down holds it. Away, the defence it had decides it. A raid lost halves its
income for a few hours, leaves its market short of a good, takes a quarter of what you store there
and knocks a turret out; never your credits. The first is only a probe, to show what is coming
([PROCGEN.md §29](PROCGEN.md#29-defend-your-outpost)).

### 27. Rival stories ✅

Each of the six rival pilots now has a story in your save, one each, shaped by how you stand with
them. Stand well with one, known a while, and at their table they ask for a loan, back with interest
when their next run docks; then for a deed: fly escort on their next run, or, when their drive fails
out on the lanes, bring the parts before the tow gets there. Done, they are an ally: ask at their
table and they fly on your wing in their own ship until you next dock, and a bounty hunter among
them hands you their claims. Cross one until they are hostile and a feud begins: they tip customs
off about you near their home, or send hired guns after you in lawless space, then call you out to a
duel off a lawless beacon. It is one on one, each in your own ship as it is fitted, so a weak ship
should stay away; it starts when you close in with a sound hull and ends when one of you yields,
before a ship is lost. Win and the purse is yours; yield or run and they take the stake; either way
the feud is over. Amends end one at any point. While a story holds a rival (waiting for your escort,
adrift, on your wing, lying in wait, at the duel) their career pauses and picks up from where the
story left them. The People window tags them, the journal follows each story, and the News and the
radio tell it ([PROCGEN.md §28](PROCGEN.md#28-rival-stories)).

### 26. Lane encounters ✅

The flight between docks is no longer quiet. About every twenty minutes of flight, outside Sol,
someone hails: a mayday, a lifepod from a hauler raiders destroyed there, a Hollow Wake toll gate at
the beacon, a customs patrol when there is contraband in the hold, a scientist stranded by a sight of
the real sky, cargo adrift, or a lost trader. The hail waits on the HUD and never pauses the game;
answering (Q, the banner, the action button or a pad's A) opens a card that does, with what each
choice does or why it is closed to you. Some hails are traps, and the card names the odds but never
whether this one is: a mayday or cargo may be bait that brings raiders, a bribe may be a sting. Pay
the Wake's toll and its packs let you be until you dock or jump; refuse or ignore it and they attack.
Survivors and scientists ride to a station for a fare, returned cargo pays and earns standing, a lost
trader shares what they know of the markets. Each system's time is cut into slots, so a loaded game
meets the same, and the journal keeps what you met. A pad now works every dialog: the D-pad moves
between its buttons, A presses, B closes ([PROCGEN.md §27](PROCGEN.md#27-lane-encounters)).

### 25. Stellar death II: a doomed star at the edge ✅

No real star within the map can go supernova, and the nearest known black hole is about 1,560
light-years away, so this one is invented outright, an exception chosen by the owner: **Pyre**, a
red supergiant just beyond the edge of the real census of the Sun's neighbourhood, 33 light-years
away toward Phoenix, reached by one lane from GJ 915 with the long-range drive. It is labelled as
fiction wherever it shows (*Fiction: there is no star called Pyre.*) and never written into the real
sky's data. Some hours after you first reach the frontier, its observatory's neutrino alarm sounds:
the observatory evacuates and wants its last observers carried out, and research stations want a
last record of the star. Fifty minutes later it explodes; a ship still there is carried out by its
emergency drive (fiction again). Its light then sweeps across the map a light-year a minute,
peaking in each sky in turn at magnitude −20.4 at GJ 915 and −16.7 from Earth, every number worked out
from its invented mass, luminosity and temperature with the real physics; the institutes near it
want its first light seen twice, outrunning it through a lane. Once the debris has thinned, its lane
opens on a black hole: a dark shadow ringed with bent light, feeding on a fading disc of the star's
gas, whose tides strain a hull that goes too near. Read it for the institutes, and later dock at the
remnant station built well clear of it. The star map, the News, the radio, the markets and the
encyclopedia all tell it ([PROCGEN.md §26](PROCGEN.md#26-stellar-death-ii-a-doomed-star-at-the-edge)).

### 24. Gluts that ship out ✅

A glut, or a frontier farm's harvest, now ships its surplus out, as a shortage draws relief: two
named haulers load it for the nearest stations that take the good, and leave fifteen to forty-five
minutes after it starts. The News at the station lists them, loading and leaving in so many
minutes, on their way, delivered or lost. Their cargo leaves as they set off, and with both gone
the glut is over, so cheap goods do not last; buying it up yourself clears it sooner. Where they
land, the good is a little cheaper for a while. And a relief hauler or a shipment bound through a
raided system now asks for an escort: its sender's bar posts the job under the hauler's own name
until it is due to leave. Take it and the hauler waits for you, then flies with you and jumps with
you; see it docked and its cargo arrives, relieving the shortage it was meant for. Along the way, a
shortage at a raider den no longer draws lawful relief haulers to a dock nobody can enter
([PROCGEN.md §21.6–21.7](PROCGEN.md#216-gluts-that-ship-out)).

### 23. Stellar death, as fiction ✅

Some time after the opening, the research stations catch a neutrino burst from Betelgeuse, a real
red supergiant some 500 light-years away; a quarter of an hour later its light arrives, and the
supernova outshines everything in every sky, in the star's true direction from wherever you fly,
then fades to a faint remnant. Hours later Antares flickers and goes out, collapsing into a black
hole without exploding. The stars and their places, distances and brightness are the catalogue's;
their deaths are fiction, an exception to the rule that real astronomy is never invented, chosen by
the owner and labelled as fiction wherever they show. How bright the supernova gets is worked out
from a typical supernova's peak and the star's real distance (magnitude −10.8). The News and the
research stations' radio tell it as it happens, research stations pay more for data cores and
electronics, and post observation work: catch the first light, watch it fade, watch Antares go
out, or measure Betelgeuse's distance by parallax from two systems 20 light-years apart. In flight
the dying star is a target you observe with the action button
([PROCGEN.md §25](PROCGEN.md#25-stellar-death-as-fiction)).

### 22. Rival pilots ✅

Six named pilots (fiction) with careers of their own: two traders, two bounty hunters and two
runners, each working the stations within a jump of home, an hour of game time a run. The traders
carry the best cargo between two stations, so a route the player runs pays a little less while
they are on it; the hunters take bounties off the boards as they set off, and the Jobs window shows
them taken, with what the claim costs to buy back; the runners race relief to fresh shortages, and
can end one before the player gets there. Meet them in the bars (a round raises their opinion of
you, and a friendly rival says where it is going next), in the News, and in flight, named, with
what they carry. Shoot one and it remembers; destroy one and it spends three hours refitting at
home, and a hostile rival comes for you in lawless space
([PROCGEN.md §24](PROCGEN.md#24-rival-pilots)).

### 21. Passengers and sightseers ✅

People, not only cargo. Fit a passenger cabin (two to four berths, from three makers, for a little
top speed) and the boards post fares: passages for a party of one to three to another station, and
tours for sightseers who pay to be flown close to a real sight within two jumps and brought home.
The sights are the real sky's: 143 confirmed planets, white and brown dwarfs and belts, the rarer
paying more. Come close enough for a good look and they say so, with a fact from the archives'
record of it (a planet's year, its mass, when and how it was found), never one made up. They hate
a fight: each hit to the hull with them aboard comes off the fare, down to 40% of it, and they say
that too. The real sky now pays its way, not only the codex
([PROCGEN.md §23](PROCGEN.md#23-passengers-and-sightseers)).

### 20. A station of your own ✅

After a fleet, a station. At any station of a system with a confirmed planet (66 sites in 37
systems; none in Sol or the other first systems), the Fleet window offers its sites: charter one for
8,000 cr, choose what it will be (a mine, refinery, factory, farm, research station, relay, trade
port or free port, as the system's security allows) and one of three names. Bring the materials and
hand them over at the site: habitat modules, metals and machinery raise its frame, and it opens with
a market and repairs; then a station with a job board; then a port with an outfitter. It pays by the
hour from the day it opens (300, 800, then 1,600 cr), less in an hour raiders swarm its system, and
your captains can haul to it. It is yours alone: nobody else's prices, boards or haulers change
because of it ([PROCGEN.md §22](PROCGEN.md#22-a-station-of-your-own)). Sites in the catalogued
belts came with increment 35.

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
