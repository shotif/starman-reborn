import type { CraftStory } from './spacecraft.ts';

/**
 * The facts of each spacecraft's mission (docs/PROCGEN.md §49.4), quoted from Horizons' record of the
 * craft or NSSDCA's page on it. They are part of Sol's sky, fetched behind the title with the craft
 * themselves (data/sky.ts, §50), so they are kept apart from the rules and lines in spacecraft.ts.
 */
const NASA_PAGE = 'National Aeronautics and Space Administration (United States)';
const NASA_OSSA = 'NASA-Office of Space Science Applications (United States)';

export const CRAFT_STORIES_DATA: Record<string, CraftStory> = {
  'voyager-1': {
    agency: { line: 'NASA', source: 'nssdca', quote: `Funding Agency ${NASA_OSSA}` },
    summary: { line: 'One of a pair sent to explore the outer planets and the space between them', source: 'nssdca', quote: 'Voyager 1 was one of a pair of spacecraft launched to explore the planets of the outer solar system and the interplanetary environment' },
    launched: { on: '1977-09-05', line: 'Launched', source: 'nssdca', quote: 'Launch Date: 1977-09-05' },
    events: [
      { on: '1979-03-05', line: 'Flew past Jupiter', source: 'nssdca', quote: 'Voyager 1 then proceeded to Jupiter (making its closest approach on 05 March 1979)' },
      { on: '1980-11-12', line: 'Flew past Saturn', source: 'nssdca', quote: 'Saturn (with closest approach on 12 Nov. 1980)' },
      { on: '1990-02-14', line: 'Looked back and took the first “family portrait” of the Solar System: the Sun and six of its planets', source: 'nssdca', quote: 'On 14 Feb. 1990, Voyager 1 looked back from whence it came and took the first "family portrait" of the solar system, a mosaic of 60 frames of the Sun and six of the planets' },
      { on: '1998-02-17', line: 'Became the farthest thing people have made from the Sun, passing Pioneer 10', source: 'nssdca', quote: 'Late on 17 February 1998, Voyager 1 became the most distant man-made object from the Sun, surpassing the distance of Pioneer 10' },
      { on: '2012-08-25', line: 'Crossed the heliopause, where the Sun’s wind gives way to the space between the stars', source: 'horizons', quote: '2012-Aug-25 Passes heliopause and termination shock boundary' },
    ],
    notes: [{ line: 'Carries a gold-plated record of the sounds and images of Earth', source: 'nssdca', quote: 'Each Voyager has mounted to one of the sides of the bus a 12-inch gold-plated copper disk. The disk has recorded on it sounds and images of Earth' }],
  },
  'voyager-2': {
    agency: { line: 'NASA', source: 'nssdca', quote: `Funding Agency ${NASA_OSSA}` },
    summary: { line: 'One of a pair sent to explore the outer planets and the space between them', source: 'nssdca', quote: 'Voyager 2 was one of a pair of spacecraft launched to explore the planets of the outer solar system and the interplanetary environment' },
    launched: { on: '1977-08-20', line: 'Launched, the first of the two', source: 'nssdca', quote: 'Voyager 2 was the first of the two spacecraft to be launched, with liftoff occurring 20 Aug. 1977' },
    events: [
      { on: '1979-07-09', line: 'Flew past Jupiter', source: 'nssdca', quote: 'flew by Jupiter (closest approach on 09 July 1979)' },
      { on: '1981-08-26', line: 'Flew past Saturn', source: 'nssdca', quote: 'Saturn (26 August 1981)' },
      { on: '1986-01-24', line: 'Flew past Uranus', source: 'nssdca', quote: 'Voyager 2 made successful flybys of Uranus (24 January 1986)' },
      { on: '1989-08-25', line: 'Flew past Neptune', source: 'nssdca', quote: 'Neptune (25 August 1989)' },
    ],
    notes: [{ line: 'Carries a gold-plated record of the sounds and images of Earth', source: 'nssdca', quote: 'Each Voyager has mounted to one of the sides of the bus a 12-inch gold-plated copper disk. The disk has recorded on it sounds and images of Earth' }],
  },
  'pioneer-10': {
    agency: { line: 'NASA', source: 'nssdca', quote: `Funding Agency ${NASA_OSSA}` },
    summary: { line: 'The first craft sent to the outer Solar System, and the first to Jupiter', source: 'nssdca', quote: 'This mission was the first to be sent to the outer solar system and the first to investigate the planet Jupiter' },
    launched: { on: '1972-03-03', line: 'Launched', source: 'nssdca', quote: 'Launch Date: 1972-03-03' },
    events: [
      { on: '1973-12-04', line: 'Flew past Jupiter, about 200,000 km from it', source: 'nssdca', quote: 'The spacecraft achieved its closest approach to Jupiter on 04 December 1973, when it reached approximately 2.8 Jovian radii (about 200,000 km)' },
      { on: '2002-03-03', line: 'Sent data home for the last time, thirty years to the day after its launch', source: 'nssdca', quote: "The last successful data acquisitions through NASA's Deep Space Network (DSN) occurred on 03 March 2002, the 30th anniversary of Pioneer 10's launch date" },
      { on: '2003-01-23', line: 'Its signal was heard for the last time', source: 'nssdca', quote: 'The spacecraft signal was last detected on 23 January 2003' },
    ],
    notes: [
      { line: 'Heading generally towards Aldebaran, the red eye of Taurus', source: 'nssdca', quote: 'The spacecraft is heading generally towards the red star Aldebaran, which forms the eye of Taurus' },
      { line: 'Carries a plaque with drawings of a man, a woman, and where the Sun and Earth are in the Galaxy', source: 'nssdca', quote: 'A plaque was mounted on the spacecraft body with drawings depicting a man, a woman, and the location of the sun and the earth in our galaxy' },
    ],
  },
  'pioneer-11': {
    agency: { line: 'NASA', source: 'nssdca', quote: `Funding Agency ${NASA_OSSA}` },
    summary: { line: 'The second craft to Jupiter, and the first to Saturn and its rings', source: 'nssdca', quote: 'Pioneer 11 was the second mission to investigate Jupiter and the outer solar system and the first to explore the planet Saturn and its main rings' },
    launched: { on: '1973-04-06', line: 'Launched', source: 'nssdca', quote: 'Launch Date: 1973-04-06' },
    events: [
      { on: '1974-12-03', line: 'Flew past Jupiter, within 43,000 km of its cloud tops', source: 'nssdca', quote: "During its closest approach, 03 December 1974 (SCET-UT) , Pioneer 11 passed to within 43,000 km of Jupiter's cloud tops" },
      { on: '1979-09-01', line: 'Flew past Saturn, 21,000 km from its cloud tops', source: 'nssdca', quote: "It passed by Saturn on 01 September 1979, at a distance of 21,000 km from Saturn's cloud tops" },
      { on: '1995-09-30', line: 'Fell silent, its power too low to run any of its instruments', source: 'nssdca', quote: 'Science operations and daily telemetry ceased on 30 September 1995 when the RTG power level was insufficient to operate any experiments' },
    ],
    notes: [{ line: 'Carries a plaque with drawings of a man, a woman, and where the Sun and Earth are in the Galaxy', source: 'nssdca', quote: 'contains a plaque that has a drawing depicting man, woman, and the location of the sun and earth in the galaxy' }],
  },
  'new-horizons': {
    agency: { line: 'NASA', source: 'nssdca', quote: `Funding Agency ${NASA_PAGE}` },
    summary: { line: 'Sent to fly past Pluto and its moon Charon, then on into the Kuiper Belt', source: 'nssdca', quote: 'New Horizons is a mission designed to fly by Pluto and its moon Charon and transmit images and data back to Earth. It will then continue on into the Kuiper Belt' },
    launched: { on: '2006-01-19', line: 'Launched', source: 'nssdca', quote: 'Launch Date: 2006-01-19' },
    events: [
      { on: '2007-02-28', line: 'Swung past Jupiter, which sped it on towards Pluto', source: 'nssdca', quote: 'It reached Jupiter for a gravity assist on 28 February 2007' },
      { on: '2015-07-14', line: 'Flew past Pluto', source: 'nssdca', quote: 'Flyby of Pluto took place on 14 July 2015' },
      { on: '2019-01-01', line: 'Flew past Arrokoth in the Kuiper Belt, 3500 km from its centre', source: 'horizons', quote: '2019-Jan-1 ... Arrokoth (2014 MU69) flyby @ 05:33 UTC, 3500 km from center)' },
    ],
    notes: [{ line: 'Came within 12,500 km of Pluto, and 27,000 km of Charon', source: 'nssdca', quote: 'New Horizons flew within 12500 km of Pluto at a relative velocity of 11 km/s at closest approach and came as close as 27,000 km to Charon' }],
  },
  'parker-solar-probe': {
    agency: { line: 'NASA', source: 'nssdca', quote: `Funding Agency ${NASA_PAGE}` },
    summary: { line: 'Built to orbit the Sun and pass close to it again and again, to trace how its corona is heated and its wind driven', source: 'nssdca', quote: 'The Parker Solar Probe is designed to orbit the Sun, making numerous close approaches, in order to trace the flow of energy, study the heating of the solar corona, and explore the acceleration of the solar wind' },
    launched: { on: '2018-08-12', line: 'Launched', source: 'nssdca', quote: 'The Parker Solar Probe launched on 12 August 2018' },
    events: [
      { on: '2018-10-03', line: 'Flew past Venus for the first time', source: 'nssdca', quote: 'A Venus flyby at an altitude above the surface of approximately 2500 km on 03 October 2018' },
      { on: '2024-11-06', line: 'Flew past Venus for the seventh and last time', source: 'horizons', quote: '2024-Nov-06: Venus flyby #7 (last one)' },
      { on: '2024-12-24', line: 'Made the first of its closest passes of the Sun', source: 'horizons', quote: '2024-Dec-24: Perihelion #22 (first close approach)' },
    ],
    notes: [
      { line: 'At its nearest it passes 6.16 million km from the Sun’s surface', source: 'nssdca', quote: "range from 24.3 million km to 6.86 million km (6.16 million km from the Sun's surface)" },
      { line: 'Named for Eugene Parker, who first put forward the solar wind, in 1958', source: 'nssdca', quote: 'The mission is named for physicist Eugene Parker, who, in 1958, first theorized the existence of the solar wind' },
    ],
  },
  'james-webb-space-telescope': {
    agency: { line: 'NASA', source: 'nssdca', quote: `Funding Agency ${NASA_PAGE}` },
    summary: { line: 'A large infrared telescope, to study the earliest times of the universe, how galaxies, stars and planets form, and planets of our own and other solar systems', source: 'nssdca', quote: 'The James Webb Space Telescope (JWST) is a large infrared (IR) optimized space observatory designed to study the earliest phases of the universe, how galaxies formed, how stars and protoplanetary systems develop, and to observe planets in our own and other solar systems' },
    launched: { on: '2021-12-25', line: 'Launched', source: 'nssdca', quote: 'JWST launched on 25 December 2021' },
    events: [],
    notes: [
      { line: 'It goes round the Sun–Earth L2 point, about 1.5 million km from Earth, once every six months', source: 'nssdca', quote: 'It was placed in a 6 month orbit about the Earth-Sun Lagrange 2 (L2) point, about 1.5 million km from Earth' },
      { line: 'Its mirror, 6.6 metres across, is 18 gold-coated beryllium segments', source: 'nssdca', quote: 'The primary mirror of JWST is made up of 18 hexagonal gold-coated beryllium segments, 1.32 meters wide (flat-to-flat) that fit together to form the 6.6 meter wide' },
    ],
  },
  lucy: {
    agency: { line: 'NASA', source: 'nssdca', quote: `Funding Agency ${NASA_PAGE}` },
    summary: { line: 'Flying past seven asteroid systems: two in the main belt and five of the Trojans that share Jupiter’s orbit', source: 'horizons', quote: 'The 12-year mission will fly past seven different asteroid systems; two main belt objects and five Jupiter Trojans' },
    launched: { on: '2021-10-16', line: 'Launched', source: 'nssdca', quote: 'Lucy launched on 16 October 2021' },
    events: [
      { on: '2022-10-16', line: 'Swung past Earth', source: 'nssdca', quote: 'its first Earth flyby exactly one year after launch, on 16 October 2022' },
      { on: '2023-11-01', line: 'Flew past the small asteroid Dinkinesh, and found it has a moon', source: 'nssdca', quote: 'asteroid 152830 Dinkinesh on 1 November 2023, with closest approach coming at approximately 16:54 UT. Images from the flyby showed that Dinkinesh had a heretofore unknown 220 meter diameter moon' },
      { on: '2024-12-13', line: 'Swung past Earth again', source: 'nssdca', quote: 'a second Earth flyby on 13 December 2024' },
      { on: '2025-04-20', line: 'Flew past the asteroid Donaldjohanson, 960 km from it', source: 'nssdca', quote: 'main belt asteroid 52246 Donaldjohanson, which took place on 20 April 2025 at 17:51 UT at a distance of 960 km' },
      { on: '2027-08-12', line: 'To fly past the Trojan Eurybates and its moon Queta', source: 'nssdca', quote: 'It flies by 3548 Eurybates and its small satellite Queta on 12 August 2027' },
      { on: '2027-09-15', line: 'To fly past the Trojan Polymele and its moon', source: 'nssdca', quote: 'Polymele and its small satellite on 15 September 2027' },
      { on: '2028-04-18', line: 'To fly past the Trojan Leucus', source: 'horizons', quote: '2028-Apr-18 11351 Leucus' },
      { on: '2028-11-11', line: 'To fly past the Trojan Orus', source: 'horizons', quote: '2028-Nov-11 21900 Orus' },
      { on: '2033-03-03', line: 'To fly past the Trojan Patroclus and its moon Menoetius, nearly as large', source: 'horizons', quote: '2033-Mar-03 617 Patroclus (113 km diameter; 104 km satellite (Menoetius)' },
    ],
    notes: [],
  },
  psyche: {
    agency: { line: 'NASA', source: 'nssdca', quote: `Funding Agency ${NASA_PAGE}` },
    summary: { line: 'Sent to the metal-rich asteroid 16 Psyche in the main belt, to study it from orbit', source: 'nssdca', quote: 'Psyche is a NASA Discovery mission designed to rendezvous with a metallic asteroid, 16 Psyche, in the main asteroid belt and study it from orbit' },
    launched: { on: '2023-10-13', line: 'Launched', source: 'nssdca', quote: 'Psyche launched on 13 October 2023' },
    events: [
      { on: '2026-05-15', line: 'Swung past Mars', source: 'horizons', quote: 'A gravity-assist flyby of Mars will nominally occur May 15, 2026' },
      { on: '2029-08', line: 'To reach the asteroid Psyche', source: 'nssdca', quote: 'it will reach the asteroid Psyche in August 2029' },
    ],
    notes: [{ line: 'Driven by electric thrusters, powered by sunlight', source: 'nssdca', quote: 'It has a solar electric propulsion system' }],
  },
  'europa-clipper': {
    agency: { line: 'NASA', source: 'horizons', quote: "NASA's Europa Clipper spacecraft" },
    summary: { line: 'Sent to find whether Jupiter’s ice-covered moon Europa could support life, and to confirm the ocean thought to lie beneath its ice', source: 'horizons', quote: "carries a suite of science instruments to assess habitability of Jupiter's ice-covered moon Europa (502) while confirming the existence and nature of an expected sub-surface ocean" },
    launched: { on: '2024-10-14', line: 'Launched', source: 'horizons', quote: 'Launched : 2024-Oct-14 16:06 UTC' },
    events: [
      { on: '2025-03-01', line: 'Swung past Mars', source: 'horizons', quote: 'Mars gravity assist : 2025-Mar-01' },
      { on: '2026-12-03', line: 'To swing past Earth', source: 'horizons', quote: 'Earth gravity assist: 2026-Dec-03' },
      { on: '2030-04-11', line: 'To reach Jupiter', source: 'horizons', quote: 'Arrival : 2030-Apr-11' },
    ],
    notes: [{ line: 'At Jupiter it is to go round 75 times and fly past Europa 49 times, as low as 25 km', source: 'horizons', quote: 'The spacecraft is expected to orbit Jupiter 75 times and conduct 49 flybys of Europa at altitudes as low as 25 km' }],
  },
  juice: {
    agency: { line: 'ESA', source: 'horizons', quote: 'is an ESA mission' },
    summary: { line: 'Sent to study Ganymede and whether it could support life, and to compare it with Europa and Callisto', source: 'horizons', quote: 'The JUICE orbiter will investigate Ganymede and evaluate its potential to support life. Investigations of Europa and Callisto will compare these Galilean moons' },
    launched: { on: '2023-04-14', line: 'Launched', source: 'horizons', quote: 'is an ESA mission launched April 14, 2023' },
    events: [
      { on: '2024-08-20', line: 'Swung past the Earth and the Moon', source: 'horizons', quote: '2024-Aug-20: Earth-Moon system (gravity-assist' },
      { on: '2025-08-31', line: 'Swung past Venus', source: 'horizons', quote: '2025-Aug-31: Venus (gravity assist' },
      { on: '2026-09-28', line: 'Swung past Earth again', source: 'horizons', quote: '2026-Sep-28: Earth #2 (gravity assist' },
      { on: '2029-01', line: 'To swing past Earth a third time', source: 'horizons', quote: '2029 Jan : Earth #3 (gravity assist)' },
      { on: '2031-07', line: 'To reach Jupiter', source: 'horizons', quote: 'arriving at Jupiter in July, 2031' },
      { on: '2034-12', line: 'To go into orbit round Ganymede, the first craft to orbit a moon other than Earth’s', source: 'horizons', quote: "In December 2034, the spacecraft will enter orbit around Ganymede, becoming the first spacecraft to orbit a moon other than Earth's" },
    ],
    notes: [],
  },
};
