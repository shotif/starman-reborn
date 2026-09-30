# Roadmap

From prototype to a full game. Each step ships to the live site (<https://shotif.github.io/starman-reborn/>)
when it is done, so the game stays playable throughout. Status: ✅ done · 🔨 in progress · ⏳ next.

## 1. Fix what real phones hit ✅

Menus cut off on an Android phone with larger text: tab bars could be squeezed by their column,
labels wrapped, toasts covered panels. Fixed, and the layout audit now reproduces large-text
phones (130% text scaling, and 130% page zoom = a 316-wide viewport) and flags content cut off
inside any box that is not meant to scroll.

## 2. Redesign the menus and HUD ✅

A game interface instead of web pages, inspired by the classic space-trader look (see
[DESIGN.md](DESIGN.md#interface-direction)): docking puts you in a 3D place, room and command
rails replace tabs, framed glass windows, icons and numbers first, prose on demand.

- Design system: condensed technical typeface, navy-glass frames with cut corners and cyan edges,
  amber active state, original icon set.
- Station hub: procedural 3D interiors for all six stations, each in its own style: hangar deck
  (your ship on its pad), trader, outfitter and a bar with people; the camera glides between the
  hangar views and cuts to the bar. Room rail and action tab; two-list dealer windows; job board
  in the bar; shipyard on the deck.
- Title screen, pause, settings and map chrome in the same style.
- Flight HUD: command rail (free flight, go to, dock, cruise), contact list, weapons list,
  segmented gauges, bracketed target box. Touch keeps the thumb areas clear.

## 3. Content generator 🔨

Guidelines and guardrails: [PROCGEN.md](PROCGEN.md). First application done: the ship and
equipment catalogue is generated from rule files (6 makers, 6 ship classes, 17 equipment families)
and checked by guardrails in the unit tests.

Next: rules and guidelines as data files (factions, station types and where they may appear, mission
types with conditions and reward formulas, economy, names, tone). A seeded generator builds
stations, points of interest, traffic and people; a daily world tick moves prices, faction
influence and pirate activity; jobs come out of that state. Every generated item is validated
(reachable, completable, fairly paid, attached only to real catalogued stars and planets), and a
test generates 1,000 worlds. Saves store the seed plus changes. The scripted chain stays as the
tutorial.

## 4. Living world

Dynamic prices, faction influence and conflicts, news, reputation that changes prices, access and
who attacks you, traffic in the lanes.

## 5. Ships and combat 🔨

In progress: 35 buyable ship models across six classes from five makers, and over 100 pieces of
equipment: four gun families whose damage types counter shield types, rocket pods, seekers and
torpedoes, three shield types, engines, thrusters, power plants, armour, cargo pods, scanners and
tractor beams. They come to the game with a shipyard (trade-in at 70%) and an outfitter by slot.

Then: mines and countermeasures, loot to tractor in, pirate packs, patrols, bounty targets with
escorts, hired wingmen, subsystem damage.

## 6. More real stars

From 5 to about 20–30 systems within about 15 light-years, using only catalogue data and
confirmed planets, with generated fictional stations and physical jump gates, and real planet
positions in the Solar System. Needs the astronomy archive snapshot (see
[KNOWN_GAPS.md](KNOWN_GAPS.md)).

## 7. Story and polish

A short campaign on the mission system, controller support, save slots with export/import, more
music and radio chatter, performance tuning on real phones.

## Text generation

The rules always decide facts (who, where, how much); only wording varies. Default: templates with
phrase pools, offline. Optional: AI-written text packs generated at build time (reviewed, no API key
in the game). Live AI while playing would need a small server and is deferred.
