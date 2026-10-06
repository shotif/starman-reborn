# Astronomy sources, snapshot and uncertainty

Starman Reborn separates **observed** astronomy from **illustrated** depiction and **fictional**
game content. This document explains where every real value comes from, how it is processed, and
what is uncertain.

## Current status of the bundled data

| Dataset | File | Status |
| --- | --- | --- |
| Star astrometry (252 stars in the 206 systems beyond Sol) | `src/data/generated/astrometry.json` | **Snapshot** of 2026-09-30: Gaia DR3 for 141 stars, SIMBAD's adopted values (cited by bibcode) for the rest |
| Planets (99: 77 confirmed, 22 contested, no candidates) | `src/data/generated/exoplanets.json` | **Snapshot** of 2026-09-30: NASA Exoplanet Archive and the Extrasolar Planets Encyclopaedia |
| Catalogue systems (202 beyond the hand-authored five: 27 from HYG and the Open Exoplanet Catalogue, 175 added by the snapshot) | `src/data/generated/catalog-systems.json` | **Snapshot** of 2026-09-30 |
| Belts and debris discs (9) | `src/data/generated/belts.json` | **Snapshot** of 2026-09-30, each citing its source |
| The Solar System's orbital elements (8 planets) | `src/data/generated/solar-elements.json` | JPL, retrieved 2026-09-30 and checked against Horizons |
| Far stars beyond the map (2: Betelgeuse and Antares) | `src/data/generated/far-stars.json` | **Provisional**: HYG v4.0 (Hipparcos), until a snapshot checks them (see *Far stars*) |

The development container cannot reach the archives: the ESA Gaia archive, NASA Exoplanet Archive,
SIMBAD and VizieR hosts are blocked by its network policy. The snapshot is therefore fetched on
GitHub's runners and processed offline (see *Pipeline: the sky snapshot*). Before the first
snapshot the game ran on stopgap values in `data/provisional/`: transcriptions of the cited
catalogs, not machine-verified retrievals, flagged `verification: "provisional"` and shown with a
**Pending verification** badge (title screen, star map, encyclopedia, discovery cards). Those files
remain the game's own record of its stars and planets, which every snapshot checks; a record a
snapshot does not cover is still flagged and badged (today only the two far stars, which no
snapshot has been asked for yet: see *Far stars*).

To take a new snapshot:

```bash
npm run data:fetch      # needs the archives: raw answers under data/snapshot/raw/<date>/
npm run data:process    # offline: data/snapshot/*-input.json and data/snapshot/REPORT.md
npm run data:build      # regenerates src/data/generated/*.json from the snapshot
npm run data:validate   # must pass before committing
```

`npm run data:snapshot` runs the first two. `data:build` prefers `data/snapshot/*` when present,
and the as-of dates shown in game are the retrieval date.

## Catalogue systems: HYG and the Open Exoplanet Catalogue

The five hand-authored systems (Sol, Alpha Centauri, Barnard's Star, Sirius, Epsilon Eridani) are
joined by 27 more systems within about 17 light-years, from Wolf 359 to Altair. The archives above
were blocked, so `scripts/extract-catalogs.ts` reads two public catalogues that were reachable
(through raw.githubusercontent.com) instead:

- **HYG star database v4.0** by David Nash (astronexus), which combines the Hipparcos, Yale Bright
  Star and Gliese catalogues: positions (J2000), proper motions, distances and spectral types.
  Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Source:
  <https://github.com/astronexus/HYG-Database/tree/main/hyg/CURRENT>.
- **Open Exoplanet Catalogue** by Hanno Rein and contributors: planets on its "Confirmed planets"
  list only; controversial and retracted entries are skipped. Licence: MIT, Copyright (C) 2012
  Hanno Rein (notice in [data/provisional/NOTICE.md](../data/provisional/NOTICE.md)). Source:
  <https://github.com/OpenExoplanetCatalogue/open_exoplanet_catalogue>.

What this means for the data:

- The systems are picked by name in the script (a fixed list, so the world does not shift when a
  catalogue is updated). Components are matched by HIP or Gliese number and every record keeps the
  URL of the catalogue it came from.
- Distances were HYG's (from Hipparcos parallaxes, or Gliese distances where Hipparcos has none),
  without parallax errors. The snapshot has since replaced every position and distance with archive
  values, each with its error: GJ 1061 moved from 14.0 to 12.0 ly and BL Ceti by 0.3 ly, and no
  other star moved more than 0.25 ly (`data/snapshot/REPORT.md`).
- Planet masses were the catalogue's values; the snapshot replaced them with the NASA Exoplanet
  Archive's wherever it lists the planet. The three planets it does not list (Tau Ceti e,
  Kapteyn's Star b, 40 Eridani A b) keep the catalogue's values and are marked contested.
- Everything from these catalogues was flagged **provisional** until the snapshot of 2026-09-30
  checked it against SIMBAD, Gaia DR3, the NASA Exoplanet Archive and the Extrasolar Planets
  Encyclopaedia.
- **Licences of the derived files.** The positions, distances and spectral types derived from HYG
  in `data/provisional/catalog-astrometry-input.json` and `src/data/generated/astrometry.json` are
  shared under CC BY-SA 4.0 (the rest of the project keeps its own licence). The planet values
  derived from the Open Exoplanet Catalogue keep its MIT notice.

To regenerate (the raw files are not committed):

```bash
mkdir -p data/raw
curl -L -o data/raw/hygdata_v40.csv.gz https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v40.csv.gz
curl -L -o data/raw/oec-systems.xml.gz https://raw.githubusercontent.com/OpenExoplanetCatalogue/oec_gzip/master/systems.xml.gz
gunzip data/raw/*.gz
node scripts/extract-catalogs.ts && npm run data:build && npm run data:validate
```

Stations, owners, security levels and jump lanes in these systems are **fiction** made by the world
generator ([PROCGEN.md §7](PROCGEN.md#7-the-world-generator)); they attach only to the catalogued
stars and confirmed planets and never add a body that is not in the catalogues. These 32 systems
are the world's core, generated from frozen seeds, so a better value for a star moves it on the map
but never moves a station, lane or owner (PROCGEN.md §7.6).

## Far stars

Two real stars far beyond the map, **Betelgeuse** (Alpha Orionis, HIP 27989) and **Antares** (Alpha
Scorpii, HIP 80763), shine in every system's sky in their true direction, as bright as their
magnitude. They are there for a piece of game fiction (their deaths: see *Fiction* below and
[PROCGEN.md §25](PROCGEN.md#25-stellar-death-as-fiction)); the values themselves are real and
cited like the map's stars, in `src/data/generated/far-stars.json`.

- **Source.** Until a snapshot verifies them, `scripts/extract-far-stars.ts` reads them from the HYG
  star database v4.0 (above): position (J2000), proper motion, distance (from the Hipparcos
  parallax), spectral type and visual magnitude, into `data/provisional/far-stars-input.json`, each
  value citing the HYG record. They are flagged provisional and shown with the **Pending
  verification** badge. Licence: the derived values are shared under CC BY-SA 4.0
  ([data/provisional/NOTICE.md](../data/provisional/NOTICE.md)).
- **Checked by the snapshot.** The fetch asks SIMBAD for them with the game's stars (by HIP number
  and name), and Hipparcos for their HIP numbers. Processing takes their astrometry the same way as
  the map's stars (Gaia DR3 when its solution passes the cuts, which these very bright stars are not
  expected to, else SIMBAD's adopted values cited by bibcode), their spectral type and V magnitude
  from SIMBAD, and writes `data/snapshot/far-stars-input.json`; the report lists how far each moved.
  If SIMBAD gives nothing usable for either star, both keep their provisional values, and the report
  says why.
- **Checks.** `validateFarStars` (run by `npm run data:validate`): ids unlike any star of the map,
  ICRS at the map's epoch, positions consistent with their parallaxes, more than three times the
  map's radius away, a catalogue id and https sources.
- **Uncertainty.** Betelgeuse's distance is poorly known: published values run from about 500 to over
  700 light-years, and its brightness varies by about a magnitude. The game shows the cited value
  with its error, when the source gives one.

To regenerate the provisional file (the raw catalogue is not committed):

```bash
node scripts/extract-far-stars.ts data/raw/hygdata_v40.csv && npm run data:build && npm run data:validate
```

## Flare stars

Ten stars of the map are flare stars (`FLARE_STARS`, `src/content/stellar/flares.ts`), for a piece
of game fiction: they flare in the game, on a schedule the game draws (see *Fiction* below and
[PROCGEN.md §43](PROCGEN.md#43-flare-stars)). What is real about them is cited:

- **Their names as variable stars** (V645 Cen for Proxima Centauri, CN Leo for Wolf 359, BL Cet and
  UV Cet in Luyten 726-8, EV Lac, AD Leo, YZ Cet, V1216 Sgr for Ross 154, YZ CMi and DX Cnc) are
  SIMBAD identifiers as the sky snapshot of 30 September 2026 holds them
  (`data/snapshot/raw/2026-09-30/simbad-idents-*.json`). A unit test finds each star's SIMBAD
  record through its Gaia DR3 source and checks the name is among its identifiers, so a new
  snapshot that drops one fails the tests. Such names are given by the General Catalogue of
  Variable Stars (Samus et al. 2017, *General catalogue of variable stars: Version GCVS 5.1*,
  Astronomy Reports 61, 80, [2017ARep...61...80S](https://ui.adsabs.harvard.edu/abs/2017ARep...61...80S)).
  Barnard's Star has a variable-star name too (V2500 Oph), but SIMBAD's object type for it is a BY
  Draconis variable, so it is not counted among them.
- **Their spectral types** are the map's own (above), all red dwarfs (M).
- **What flares are**, as the encyclopedia tells it, is general knowledge of these stars; one of
  Proxima Centauri's flares is cited: MacGregor et al. 2021, *Discovery of an extremely short
  duration flare from Proxima Centauri using millimeter through far-ultraviolet observations*, ApJL
  911, L25 ([2021ApJ...911L..25M](https://ui.adsabs.harvard.edu/abs/2021ApJ...911L..25M)), a paper
  SIMBAD lists for Proxima in the snapshot.
- **Not claimed:** how often each star really flares, how strongly, or how its flares compare with
  another's. The game's flares are alike for all ten and are fiction.

## Pipeline: the sky snapshot

1. **Fetch** (`scripts/sky-fetch.ts`) is the only step that needs the network. It saves raw
   answers only: one file per query under `data/snapshot/raw/<date>/`, exactly as the archive sent
   it, and a `manifest.json` of what was asked, of whom, and whether it worked. A busy archive is
   asked again before the query becomes an asynchronous job. It asks:
   - **SIMBAD** (TAP): every star in the game by its HIP, Gliese and Gaia DR3 identifiers and its
     names, and the far stars beyond the map (see *Far stars*) the same way; everything with a parallax of at least 120 mas (about 27 ly), with identifiers, fluxes
     and multiple-star links (`h_link`, following only parents that are multiple stars, not
     clusters or moving groups); and, from its bibliography, papers on debris discs, dust belts and
     infrared excesses for every star in the neighbourhood.
   - **ESA Gaia DR3** `gaiadr3.gaia_source`: astrometry by `source_id` for every Gaia DR3
     identifier the game or SIMBAD gives, and cone searches around Alpha Centauri A and B and
     Sirius, which record what Gaia DR3 holds for those very bright stars.
   - **VizieR I/311/hip2** (Hipparcos, new reduction, van Leeuwen 2007): by HIP number, and every
     star it measured with a parallax of at least 120 mas.
   - **NASA Exoplanet Archive** `pscomppars`: every confirmed planet within 8.3 pc, with the archive
     name, host, controversy flag (`pl_controv_flag`), discovery year and method, orbital period,
     semi-major axis, mass (with the minimum-mass `M sin i` qualifier when the archive gives one)
     and radius.
   - **The Extrasolar Planets Encyclopaedia** (exoplanet.eu, the Paris Observatory's EPN-TAP
     service): every planet it lists within 8.4 pc, with its status, so a planet the NASA archive
     does not confirm can be named and dated rather than silently dropped. When its HTTPS endpoint
     does not answer, the fetch asks over plain HTTP.
   - **JPL**: the Keplerian elements for approximate planet positions (1800–2050), and Horizons
     heliocentric vectors for the eight planets at three dates, to test the elements against.

   The Gaia DR3 cone searches and the Hipparcos answers are kept as evidence; the processing below
   does not read them.

   The workflow `.github/workflows/sky-snapshot.yml` runs the fetch on GitHub's runners, which can
   reach the archives: when the fetch script or the workflow changes on a `claude/**` branch, by
   hand, and on the 3rd of every month. It then processes, builds, validates and tests what it
   fetched (a failure there does not stop it), commits `data/snapshot` and `src/data/generated`,
   and force-pushes them to the `sky-snapshot` branch for review before anything is merged. What
   was fetched is pushed even when a query failed, so the raw answers can be read.
2. **Process** (`scripts/sky-process.ts`) runs offline and deterministically on the latest raw
   snapshot (or the date given). It reads the game's own records in `data/provisional/` and writes
   `data/snapshot/astrometry-input.json`, `systems-input.json`, `exoplanets-input.json`,
   `belts-input.json`, `solar-elements.json` and (once the fetch has asked for them)
   `far-stars-input.json`, and `data/snapshot/REPORT.md`, which lists every change star by star and
   planet by planet. The rules:
   - **Nothing already in the game is removed.** Stars keep their ids, names and colours.
   - **The game's stars**: each is matched to one SIMBAD object (a star without a match stops the
     run). Its astrometry comes from Gaia DR3 when the solution passes the quality cuts: five or six
     parameters, a positive parallax, RUWE < 1.4 and parallax/error > 100. Otherwise it takes
     SIMBAD's adopted values, each cited by bibcode, and the report says why Gaia DR3 was not used.
   - **Companions**: one with no parallax of its own, a less precise one (an error over 2%, and
     larger than its primary's), one more than 15% from its primary's, or a Gaia DR3 solution that
     fails the cuts beside a sound primary, is plotted at its primary's distance, with a position
     note.
   - **New systems**: everything SIMBAD lists with a parallax of at least 120 mas that the game
     lacks (stars, white dwarfs and brown dwarfs; not planets, objects of uncertain type, or the
     entries that stand for a whole multiple system), plus the other members of a multiple system
     with one in the neighbourhood. Objects are grouped into one system when they share a
     multiple-star parent in SIMBAD, or when they sit close together on the sky at the same
     distance: less than 0.25 ly apart across the line of sight and less than 0.4 ly apart along it
     (1.5 ly when they are within an arcminute of each other, where one parallax may be poor). A
     group that holds a game star joins that star's system; a group in which no star has a parallax
     is left out. A new system is named the way astronomers know it: a proper name, else a Bayer or
     Flamsteed name, the planet archive's host name, a variable-star name, an old catalogue name
     (Wolf, Ross, Groombridge and the like), or a designation.
   - **Planets**: see *Planets: confirmed, contested and candidate* below.
   - **Belts and debris discs**: the Solar System's main belt and Kuiper Belt from NASA; elsewhere a
     disc wherever SIMBAD links a star to papers reporting dust around it, citing the earliest and
     the latest. Extents are given only where the cited source gives them; otherwise the belt's
     place in the game is schematic.
   - **The Solar System**: JPL's elements for the eight planets, the accuracy JPL states for them,
     and the Horizons positions to test them (see *The Solar System on the real date*).
3. **Build** (`scripts/build-dataset.ts`) writes `src/data/generated/astrometry.json`,
   `exoplanets.json`, `catalog-systems.json`, `belts.json`, `solar-elements.json` and
   `far-stars.json`. It takes
   `data/snapshot/*-input.json` when present, else `data/provisional/`, plus the catalogue extras
   (always provisional) for any star or planet the primary input does not cover. It propagates
   every position to one epoch (**ICRS, J2016.0**) using linear proper motion, converts parallax to
   distance and computes Sol-centred Cartesian coordinates in light-years:
   - `d [ly] = (1000 / parallax [mas]) × 3.261563777` (IAU parsec, Julian-year light-year)
   - `x = d cos δ cos α`, `y = d cos δ sin α`, `z = d sin δ` (double precision)
   - the 1-sigma distance error is propagated from the parallax error.
4. **Validate** (`scripts/validate-data.ts`, also run by the unit tests) checks unique ids,
   RA/Dec ranges, positive parallax, distance/position consistency with RA/Dec/parallax, a single
   frame and epoch, companion parents in the same system, one primary per system, planets with
   existing hosts and a known status (a contested or candidate planet must carry a note saying what
   the archives say, and a planet flagged controversial is never marked confirmed), https source
   URLs, dated snapshots, a functional dock in every system, symmetric jump links and a jump graph
   where every system is reachable from Sol. Familiar distance bands (Alpha Centauri ~4.2–4.4 ly,
   Barnard ~6, Sirius ~8.6, Epsilon Eridani ~10.5) produce warnings if a value strays, and so does
   every planet that is not confirmed. It also runs the world guardrails (PROCGEN.md §7.5).
5. **Runtime** uses only the bundled JSON. No archive or NASA API is contacted while playing.

The snapshot of 2026-09-30: 45 of 46 queries worked (the Encyclopaedia's HTTPS endpoint did not
answer; plain HTTP did). All 44 of the game's stars matched a SIMBAD object, and 24 of them take
Gaia DR3 astrometry. The snapshot added 175 systems and 3 stars joining systems the game had
(Luyten 726-8 C, and Epsilon Indi Ba and Bb).

## Planets: confirmed, contested and candidate

Every planet has a status (`PlanetStatus` in `src/data/types.ts`), and the game never drops one:

- **confirmed**: the NASA Exoplanet Archive lists it as confirmed, without a controversy flag;
- **contested**: the NASA archive flags it as controversial or does not list it (candidates aside);
- **candidate**: a planet the game did not have that only the Extrasolar Planets Encyclopaedia
  lists, as a candidate.

Keeping contested planets is a choice of this fictional edition of the game: nothing the archives
dispute is removed, and each planet that is not confirmed carries a note saying what each archive
says about it. `scripts/sky-process.ts` decides the status in three passes:

1. Every planet the game had stays. One the NASA archive lists is confirmed, or contested when the
   archive flags it; one it does not list is contested, whatever the Encyclopaedia says (listed,
   retracted or absent).
2. Confirmed planets the game lacked come from the NASA archive (contested when flagged), when
   their host is among the stars within reach.
3. Planets only the Encyclopaedia lists come in as candidates when it calls them candidates (or
   unconfirmed), and as contested otherwise, when their host is among the stars within reach.
   Retracted planets are never added, and a companion of more than 13 Jupiter masses is a brown
   dwarf, not a planet: the game shows brown dwarfs as stars, from SIMBAD (Epsilon Indi Ba and Bb,
   for one).

The snapshot of 2026-09-30 holds 99 planets: 77 confirmed and 22 contested, among them the game's
Tau Ceti e, Kapteyn's Star b and 40 Eridani A b, which neither archive lists any more. It holds no
candidates. The planet card and the system's science notes show the status with its note and name
the source of the values; the labels in flight show the status.

## The Solar System on the real date

Sol's eight planets sit in their real directions from the Sun on the game date: when the save
began, plus the time played on the game clock (`src/data/solar.ts`). The positions come from JPL's
Keplerian elements for 1800–2050 ("Approximate Positions of the Planets", Standish & Williams,
<https://ssd.jpl.nasa.gov/planets/approx_pos.html>), fetched with the snapshot and solved with
Kepler's equation in the J2000 ecliptic frame. Sizes and distances stay compressed, and Mars is
drawn at most 140° round from Earth so the Earth–Mars lane never runs through the Sun; the scale
note says when that happens. Outside 1800–2050, or without the elements, Sol keeps its schematic
layout.

`tests/unit/solar.test.ts` holds the elements to JPL Horizons. For the 24 bundled Horizons
positions (the eight planets on 1 January 2000, 2025 and 2030), the heliocentric longitude agrees
within twice the accuracy JPL states for that planet (Horizons is geometric and the elements are
fitted) plus 60 arcseconds for light time, and the distance within twice the stated error plus 1.5
million km (the Sun's wobble about the barycentre; the game uses only the directions). The test
also reads the game date from when a save began and the time played, and checks that the planets go
the right way round, faster nearer the Sun.

## Exceptions and special handling

- **Alpha Centauri A and B.** Too bright for usable Gaia DR3 astrometry, so the adopted values come
  from SIMBAD with bibcodes: in the snapshot of 2026-09-30, the Hipparcos parallax of Perryman et
  al. 1997 (1997A&A...323L..49P) for both stars. The provisional set had used the joint A/B
  parallax of Akeson et al. 2021 (2021AJ....162...14A).
- **Proxima Centauri** is stored as a companion of Alpha Centauri A. On the map it sits about
  0.2 ly (some 14,000 AU at the adopted distances) from the A/B pair and is never merged with it.
- **Sirius A and B.** Sirius A uses SIMBAD's Hipparcos value (van Leeuwen 2007). Sirius B lies
  about 10 arcseconds from A, and its own Gaia DR3 parallax fails the quality cuts beside its bright
  primary, so it is plotted at Sirius A's distance (position note in the data).
- **b Centauri** is a different star and is not part of this dataset.

## Uncertainty and what is not claimed

- Distances are shown with the source-backed value and its propagated 1-sigma error. Proper-motion
  propagation is linear. Neglecting radial velocity and perspective acceleration shifts positions
  by far less than 0.001 ly, below map resolution.
- Gaia DR3's small parallax zero-point offset (~0.02 mas) is negligible for these stars (relative
  effect ~10⁻⁵) and is not applied.
- No planet around Alpha Centauri A or B is shown: the snapshot of 2026-09-30 brings none. A planet
  the archives do not confirm is shown only with its status and note (see *Planets*), and
  retracted planets are never added.
- Planet surfaces, atmospheres and habitability are shown as **Unknown**. In-game globes, star
  colours, glows and nebula backgrounds are artist's impressions, not observations.
- Solar System planet names and types follow NASA's planet reference. In flight their directions
  from the Sun are real on the game date (see *The Solar System on the real date*); their sizes and
  spacing are compressed.

## Science facts shown in the encyclopedia

Descriptive facts are kept brief and each cites one of these pages:

- NASA: Alpha Centauri as a triple system —
  <https://science.nasa.gov/exoplanets/other-stars-other-worlds/our-nearest-celestial-neighbor-an-exotic-3-star-system/>
- NASA exoplanet catalog: Proxima Centauri b — <https://science.nasa.gov/exoplanet-catalog/proxima-centauri-b/>
- NASA: the eight Solar System planets — <https://science.nasa.gov/solar-system/planets/>
- NASA: Barnard's Star and its four small planets —
  <https://science.nasa.gov/universe/exoplanets/discovery-alert-four-little-planets-one-big-step/>
- NASA/Hubble: Sirius A and B — <https://science.nasa.gov/asset/hubble/an-artists-impression-of-sirius-a-and-sirius-b-annotated/>
- NASA: SOFIA observations of Epsilon Eridani —
  <https://science.nasa.gov/universe/exoplanets/sofia-confirms-nearby-planetary-system-is-similar-to-our-own/>
- ESA Gaia archive — <https://gea.esac.esa.int/archive/>
- NASA Exoplanet Archive — <https://exoplanetarchive.ipac.caltech.edu/>

## Fiction

Stations, factions, trade lanes, jump links, jump fees, transit times, markets, ships and all
story text are original game fiction. They always carry a **Fiction** badge in the UI. The map
legend reads: *"Star positions and distances based on astronomical data; travel technology and
local scale are fictional."*

**Stellar death** is the one place the game invents astronomy, two exceptions chosen by the owner.
First, in each save Betelgeuse explodes as a supernova, and later Antares collapses into a black
hole and goes out ([PROCGEN.md §25](PROCGEN.md#25-stellar-death-as-fiction)). Neither has happened.
The stars' places, distances and brightness stay the catalogue's; the event is applied on top in the
save's own timeline and is never written into the data or its sources. Every story in the News wears
the **Fiction** badge and says that the star is real and has not exploded (or collapsed); the dying
star's target in flight wears the **Fiction** badge; and the encyclopedia's *Far stars* says what is
fiction. The supernova's peak brightness is worked out, not invented: a typical Type II-P supernova's
peak absolute magnitude, −16.75 (Richardson et al. 2014, AJ 147, 118), at the star's cited distance.

Second, **Pyre** is an invented star: a red supergiant placed beyond the archives' census of the
Sun's neighbourhood (33 light-years away, where the census of everything with a parallax of at
least 120 mas stops at 27.18), so the map never claims a star the census lacks. Each save, some hours
after the pilot first reaches the frontier, it explodes and leaves a black hole the pilot can fly to
([PROCGEN.md §26](PROCGEN.md#26-stellar-death-ii-a-doomed-star-at-the-edge)). It is held in the
game's rules only (`src/content/stellar/doomed.ts`), never in the sky snapshot, the generated data
or their sources, and the tests check that none of those files names it. Everything that shows it
says it is invented: *Fiction: there is no star called Pyre.* Its numbers are worked out with real
physics from invented values typical of an M2 supergiant (25 solar masses, log L/L☉ = 5.35, 3,650 K;
compare Levesque et al. 2005, ApJ 628, 973): absolute magnitude −7.0, about 1,180 times the Sun's
size, a supernova peaking at −16.7 from Earth (Richardson et al. 2014's typical peak), and a black
hole of ten solar masses 59 km across whose tides would pull a 10 m ship apart within about 6,470 km.
The fading of its black hole's infalling gas follows the fallback rate's t^−5/3 (Chevalier 1989, ApJ
346, 847), and what such a supernova would mean for Earth is told as the published estimates: ozone
thinned within somewhere from 8 pc (Gehrels et al. 2003, ApJ 585, 1169) to 20 pc (Fields et al. 2020,
PNAS 117, 21008). What is real: no star near enough to harm Earth is known to be about to explode.

**Flare stars** flare on a schedule the game draws from its world seed and the clock
([PROCGEN.md §43](PROCGEN.md#43-flare-stars)): when each flares, how strongly, for how long, and what
a flare does to ships (shields recharging slower, scanners reaching less far) are fiction. The stars,
their variable-star names and that they flare are real (see *Flare stars* above). Every story in the
News wears the **Fiction** badge and says *Fiction: when {star} flares, and what it does to ships, is
the game's. {star} is a real flare star, the variable star {name}.*; the science card badges its line
on the flare under way as fiction; and the encyclopedia's *Flare stars* says which is which.
