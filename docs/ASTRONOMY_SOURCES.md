# Astronomy sources, snapshot and uncertainty

Starman Reborn separates **observed** astronomy from **illustrated** depiction and **fictional**
game content. This document explains where every real value comes from, how it is processed, and
what is uncertain.

## Current status of the bundled data

| Dataset | File | Status |
| --- | --- | --- |
| Star astrometry (7 components) | `src/data/generated/astrometry.json` | **Provisional** until a dated archive snapshot is captured |
| Confirmed planets | `src/data/generated/exoplanets.json` | **Provisional** until a dated archive snapshot is captured |

The development environment could not reach the archives when the prototype was built: the ESA
Gaia archive, NASA Exoplanet Archive, SIMBAD and VizieR hosts were blocked by the network policy.
Until a snapshot replaces them:

- the stopgap values in `data/provisional/` are transcriptions of the cited catalogs, not
  machine-verified retrievals;
- every provisional record carries `verification: "provisional"`, and the game shows a
  **Pending verification** badge wherever these values appear (title screen, star map,
  encyclopedia, discovery cards);
- planets list only names, hosts, discovery year and method. Orbital and mass values are
  left blank ("pending archive snapshot") rather than typed in from memory.

To replace them with a dated snapshot on a machine that can reach the archives:

```bash
npm run data:snapshot   # writes data/snapshot/*.json and raw responses under data/snapshot/raw/<date>/
npm run data:build      # regenerates src/data/generated/*.json from the snapshot
npm run data:validate   # must pass before committing
```

`data:build` prefers `data/snapshot/*` when present. After a successful snapshot the badges
disappear automatically and the as-of dates shown in game become the retrieval date.

## Pipeline

1. **Snapshot** (`scripts/fetch-astro-snapshot.ts`) queries archives by catalog identifier, never
   by a bare common name:
   - **ESA Gaia DR3** `gaiadr3.gaia_source` by `source_id` for Proxima Centauri
     (5853498713190525696), Barnard's Star (4472832130942575872) and Epsilon Eridani
     (5164707970261890560). A Gaia solution is accepted only when it is five-parameter with
     RUWE < 1.4 and parallax/error > 100.
   - **Cone searches** around Alpha Centauri A/B and Sirius A/B record what Gaia DR3 holds for
     those very bright stars (entries are missing or lack usable astrometry at their brightness).
     The raw responses are kept as evidence.
   - **SIMBAD** (`basic` joined with `ident`, by HIP number or Gaia identifier) supplies the
     adopted position, parallax and proper motion for the bright stars. SIMBAD records a bibcode
     per value, and the game cites that primary publication. SIMBAD's cross-identifiers are also
     checked against the Gaia DR3 id used for each star; a mismatch aborts the snapshot.
   - **VizieR I/311/hip2** (Hipparcos new reduction, van Leeuwen 2007) is queried as a
     cross-check. Its parallaxes are printed alongside the adopted values.
   - **NASA Exoplanet Archive** `pscomppars` lists confirmed planets only. For each planet the
     snapshot keeps the archive name, host, controversy flag (`pl_controv_flag`), discovery
     year/method, orbital period, semi-major axis, mass (with the minimum-mass `M sin i`
     qualifier when the archive gives one), radius and the row-update date.
2. **Build** (`scripts/build-dataset.ts`) propagates every position to one epoch (**ICRS,
   J2016.0**) using linear proper motion, converts parallax to distance and computes Sol-centred
   Cartesian coordinates in light-years:
   - `d [ly] = (1000 / parallax [mas]) × 3.261563777` (IAU parsec, Julian-year light-year)
   - `x = d cos δ cos α`, `y = d cos δ sin α`, `z = d sin δ` (double precision)
   - the 1-sigma distance error is propagated from the parallax error.
3. **Validate** (`scripts/validate-data.ts`, also run by the unit tests) checks unique ids,
   RA/Dec ranges, positive parallax, distance/position consistency with RA/Dec/parallax, a single
   frame and epoch, companion parents in the same system, one primary per system, confirmed-only
   planets with existing hosts, https source URLs, dated snapshots, a functional dock in every
   system, symmetric jump links and a jump graph where every system is reachable from Sol.
   Familiar distance bands (Alpha Centauri ~4.2–4.4 ly, Barnard ~6, Sirius ~8.6,
   Epsilon Eridani ~10.5) produce warnings if a value strays.
4. **Runtime** uses only the bundled JSON. No archive or NASA API is contacted while playing.

## Exceptions and special handling

- **Alpha Centauri A and B.** Too bright for usable Gaia DR3 astrometry, so the adopted values come
  from SIMBAD with bibcodes. The provisional set uses the joint A/B parallax of Akeson et al. 2021
  (2021AJ....162...14A) for both stars. If a component's own parallax is much less precise than
  its primary's, the snapshot plots it at the primary's parallax (they are a bound pair about 23 AU
  apart) and records a position note.
- **Proxima Centauri** is stored as a companion of Alpha Centauri A. On the map it sits about
  0.2 ly (~13,000 AU) from the A/B pair and is never merged with it.
- **Sirius A and B.** Sirius A uses SIMBAD/Hipparcos values. Sirius B lies about 10 arcseconds
  from A, so at map scale it is plotted at Sirius A's position and parallax (position note in the
  data).
- **b Centauri** is a different star and is not part of this dataset.

## Uncertainty and what is not claimed

- Distances are shown with the source-backed value and its propagated 1-sigma error. Proper-motion
  propagation is linear. Neglecting radial velocity and perspective acceleration shifts positions
  by far less than 0.001 ly, below map resolution.
- Gaia DR3's small parallax zero-point offset (~0.02 mas) is negligible for these stars (relative
  effect ~10⁻⁵) and is not applied.
- No planet around Alpha Centauri A or B is shown: none is listed as confirmed. Candidate or
  retracted planets are never bundled.
- Planet surfaces, atmospheres and habitability are shown as **Unknown**. In-game globes, star
  colours, glows and nebula backgrounds are artist's impressions, not observations.
- Solar System planet names and types follow NASA's planet reference. Their in-flight sizes,
  spacing and positions are schematic and do not match today's sky.

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
