import type { JobDef } from '../../economy/jobs.ts';
import type { Arc, ArcId, Character, CharacterId } from './types.ts';

/**
 * The three faction arcs (docs/PROCGEN.md §14), written by hand. Each mission is a job built from
 * the contract objectives, plus beats: words at the docks, comms in flight, a choice or two with
 * standing consequences, and a finale. The people, stations and events are fiction; the stars
 * they happen around are real.
 */

/** The opening delivery (economy/jobs.ts LIFELINE_ID): every lawful arc starts after it. */
const OPENING = 'lifeline';

export const CHARACTERS: Record<CharacterId, Character> = {
  castell: { id: 'castell', name: 'Rhea Castell', role: 'Auditor, Transit Authority internal audit', factionId: 'sta', locationId: 'earth-port' },
  kettering: { id: 'kettering', name: 'Sabine Kettering', role: 'Independent hauler, Kettering Line', factionId: null, locationId: 'waymark-waypoint' },
  quist: { id: 'quist', name: 'Amara Quist', role: 'Relief coordinator, Frontier Cooperative', factionId: 'frontier', locationId: 'meridian-outpost' },
  brandt: { id: 'brandt', name: 'Ilse Brandt', role: 'Foreman, Stonecrop Gardens', factionId: 'frontier', locationId: 'stonecrop-gardens' },
  ansari: { id: 'ansari', name: 'Dr Pell Ansari', role: 'Botanist, Dawnfield Institute', factionId: 'frontier', locationId: 'dawnfield-institute' },
  salt: { id: 'salt', name: 'Salt', role: 'Captain of the Graveyard Nest crews', factionId: 'hollow-wake', locationId: 'graveyard-nest' },
};

export const ARCS: Record<ArcId, Arc> = {
  sta: {
    id: 'sta',
    title: 'Clean Manifests',
    factionId: 'sta',
    giver: 'castell',
    summary: 'Contraband the Transit Authority seizes keeps finding its way back to the Hollow Wake. An auditor wants to know how.',
    hook: 'An auditor is looking for a pilot nobody at customs knows.',
  },
  frontier: {
    id: 'frontier',
    title: 'The Stonecrop Blight',
    factionId: 'frontier',
    giver: 'quist',
    summary: 'A mould is eating the crops of Stonecrop Gardens at Procyon, and half the Frontier’s outposts eat what the Gardens grow.',
    hook: 'The Cooperative’s relief coordinator has bad news from Procyon.',
  },
  wake: {
    id: 'wake',
    title: 'Salt’s Crew',
    factionId: 'hollow-wake',
    giver: 'salt',
    summary: 'Friends of the Wake are cheap. A berth in a Wake crew is earned, and Salt decides who earns one.',
    hook: 'A Wake captain called Salt wants to see what you are made of.',
  },
};

export const ARC_ORDER: readonly ArcId[] = ['sta', 'frontier', 'wake'];

const DECISION = { reward: 0, repReward: {}, difficulty: 1 as const, difficultyNote: 'A decision, not a flight' };

export const ARC_JOBS: readonly JobDef[] = [
  // ------------------------------------------------------------ Clean Manifests (Transit Authority)
  {
    id: 'arc.sta.1',
    title: 'A quiet audit',
    giverLocationId: 'earth-port',
    factionId: 'sta',
    briefing:
      '“Contraband we seize keeps turning up in raider holds again. I need a pilot nobody at customs knows. Fly to Barnard Transit Relay and copy its customs manifests: the relay keeps copies Sol doesn’t.”',
    objectives: [
      { kind: 'visit', locationId: 'barnard-relay', text: 'Dock at Barnard Transit Relay and copy its customs manifests' },
      { kind: 'visit', locationId: 'earth-port', text: 'Bring the manifests to Rhea Castell at Halcyon Ring' },
    ],
    reward: 600,
    repReward: { sta: 5 },
    difficulty: 1,
    difficultyNote: 'Quiet lanes',
    destinationLocationId: 'earth-port',
    requires: { jobComplete: OPENING, minRep: { faction: 'sta', value: 0 } },
    story: {
      arc: 'sta',
      step: 1,
      speaker: 'castell',
      beats: [
        {
          after: 0,
          lines: [
            { who: 'comm', text: 'The relay clerk copies the manifests without asking why. Three shipments stand out: seized combat stims, sent from Deimos Depot as “medical waste for incineration”.' },
            { who: 'comm', text: 'Each is signed by Deputy Collector Oren Vail of Deimos customs, and each was flown by the same small outfit: the Kettering Line.' },
          ],
        },
      ],
      debrief: [
        { who: 'castell', text: 'Oren Vail. Twenty years at Deimos and never a complaint. Nobody burns stims that way: somebody sold them. Let me find out where that hauler went.' },
      ],
    },
  },
  {
    id: 'arc.sta.2',
    title: 'Medical waste',
    giverLocationId: 'earth-port',
    factionId: 'sta',
    briefing:
      '“The Kettering Line’s hauler went dark near Regent Concourse in Ross 154, the day after its last ‘medical waste’ run. Find the wreck and bring me its flight recorder. If the Wake is picking it over, don’t argue with them for long.”',
    objectives: [
      { kind: 'recover', systemId: 'ross-154', locationId: 'regent-concourse', item: 'Kettering Line flight recorder', guard: 1, text: 'Recover the Kettering Line’s flight recorder near Regent Concourse' },
      { kind: 'visit', locationId: 'earth-port', text: 'Bring the flight recorder to Rhea Castell at Halcyon Ring' },
    ],
    reward: 900,
    repReward: { sta: 6 },
    difficulty: 2,
    difficultyNote: 'Raiders at the wreck',
    destinationLocationId: 'earth-port',
    requires: { jobComplete: 'arc.sta.1' },
    story: {
      arc: 'sta',
      step: 2,
      speaker: 'castell',
      comms: [{ at: 0, lines: [{ who: 'castell', text: 'The recorder’s beacon is faint, but it’s there. Raiders have been seen near the wreck. Careful.' }] }],
      debrief: [
        { who: 'castell', text: 'Listen to this. Raiders meet the hauler, and someone sends them Authority clearance codes to board her. Vail’s codes. Then they scuttle her to make it look like a raid.' },
        { who: 'castell', text: 'The pilot got away in the lifeboat: Sabine Kettering. If Kettering will talk, we have Vail.' },
      ],
    },
  },
  {
    id: 'arc.sta.3',
    title: 'The witness',
    giverLocationId: 'earth-port',
    factionId: 'sta',
    briefing:
      '“Sabine Kettering is hiding at Waymark Waypoint in Ross 154, and the Wake knows it. Pick Kettering up and escort that hauler to Regent Concourse, where an Authority cutter is waiting. Lose the witness and we lose the case.”',
    objectives: [
      { kind: 'visit', locationId: 'waymark-waypoint', text: 'Meet Sabine Kettering at Waymark Waypoint (Ross 154)' },
      {
        kind: 'escort',
        systemId: 'ross-154',
        fromLocationId: 'waymark-waypoint',
        locationId: 'regent-concourse',
        model: 'ship.freighter.1.halden',
        shipName: 'Kettering Line II',
        level: 2,
        text: 'Escort Sabine Kettering to Regent Concourse',
      },
    ],
    reward: 1_300,
    repReward: { sta: 8 },
    difficulty: 2,
    difficultyNote: 'The Wake wants the witness dead',
    destinationLocationId: 'regent-concourse',
    requires: { jobComplete: 'arc.sta.2' },
    story: {
      arc: 'sta',
      step: 3,
      speaker: 'castell',
      beats: [
        {
          after: 0,
          lines: [
            { who: 'kettering', text: 'I flew what Vail told me to fly. When I saw who met us out there, I knew I’d be next. Get me to that cutter and I’ll say all of it on the record.' },
            { who: 'kettering', text: 'My ship is the Kettering Line II, on the pad. I launch when you do.' },
          ],
        },
      ],
      debrief: [
        { who: 'castell', text: 'Kettering is aboard the cutter and talking. The manifests, the recorder, and now a witness. Come and see me at Halcyon Ring: we need to decide what happens to Oren Vail.' },
      ],
    },
  },
  {
    id: 'arc.sta.4',
    title: 'Deputy Collector Vail',
    giverLocationId: 'earth-port',
    factionId: 'sta',
    briefing:
      '“We have enough to finish Oren Vail. How it ends is your call as much as mine: you flew for it. You should also know that Vail has sent word you could name your price.”',
    objectives: [
      {
        kind: 'choice',
        locationId: 'earth-port',
        choiceId: 'sta.vail',
        text: 'Decide what happens to the evidence against Oren Vail',
        prompt: 'The manifests, the recorder and a witness. What do you do with them?',
        options: [
          {
            id: 'press',
            label: 'Give it to the Frontier press',
            outcome: 'The story breaks on every station at once. The Authority is embarrassed, but nobody can bury it now, and Vail is arrested at the Deimos customs desk. Castell pays you for the flying.',
            rep: { sta: -4, frontier: 10 },
            credits: 800,
          },
          {
            id: 'internal',
            label: 'Keep it inside the Authority',
            outcome: 'Vail is quietly removed and the Authority owes you. The Frontier will only ever hear rumours. Castell pays you, with a little extra from a budget that does not exist.',
            rep: { sta: 12, frontier: -3 },
            credits: 1_200,
          },
          {
            id: 'bribe',
            label: 'Sell it back to Vail',
            outcome: 'Vail pays, the evidence disappears, and Castell is posted to a relay at the edge of Authority space. The Wake keeps its supplier.',
            rep: { sta: -10, 'hollow-wake': 10 },
            credits: 3_000,
            ends: true,
          },
        ],
      },
    ],
    ...DECISION,
    destinationLocationId: 'earth-port',
    requires: { jobComplete: 'arc.sta.3' },
    story: { arc: 'sta', step: 4, speaker: 'castell' },
  },
  {
    id: 'arc.sta.5',
    title: 'Maw Roost',
    giverLocationId: 'earth-port',
    factionId: 'sta',
    briefing:
      '“I have the den Vail’s stims went to: Maw Roost, at Wolf 1061. A patrol wing is going in, and they want you with them: knock out the den’s turrets, then its reactor.”',
    objectives: [{ kind: 'assault', systemId: 'wolf-1061', locationId: 'maw-roost', text: 'Destroy Maw Roost’s turrets, then its reactor (Wolf 1061)' }],
    reward: 4_000,
    repReward: { sta: 20, frontier: 5, 'hollow-wake': -25 },
    difficulty: 3,
    difficultyNote: 'A raider den and its guns',
    destinationLocationId: 'maw-roost',
    requires: { jobComplete: 'arc.sta.4', choice: { id: 'sta.vail', oneOf: ['press', 'internal'] } },
    story: {
      arc: 'sta',
      step: 5,
      speaker: 'castell',
      finale: true,
      comms: [{ at: 0, lines: [{ who: 'comm', text: 'Authority wing leader: we have you on scope. Turrets first, then the reactor. We’ll keep the raiders busy.' }] }],
      variant: {
        choiceId: 'sta.vail',
        briefing: {
          press:
            '“With the story out, the Authority has to be seen to act, and I have the den Vail’s stims went to: Maw Roost, at Wolf 1061. A patrol wing is going in, and they want the pilot who started all this with them: knock out the den’s turrets, then its reactor.”',
          internal:
            '“Quietly, the Authority is cleaning house, and I have the den Vail’s stims went to: Maw Roost, at Wolf 1061. A patrol wing goes in, off the record, and they want you with them: knock out the den’s turrets, then its reactor.”',
        },
        debrief: {
          press: [{ who: 'castell', text: 'Maw Roost is dark, and every newsfeed from Sol to Tau Ceti has your name next to it. The Authority won’t love either of us for a while. I can live with that.' }],
          internal: [{ who: 'castell', text: 'Maw Roost is dark, and officially nothing happened. Unofficially, the Authority owes you, and it remembers its debts. So do I.' }],
        },
      },
    },
  },

  // ------------------------------------------------------------ The Stonecrop Blight (Frontier Cooperative)
  {
    id: 'arc.frontier.1',
    title: 'Word from Procyon',
    giverLocationId: 'meridian-outpost',
    factionId: 'frontier',
    briefing:
      '“Stonecrop Gardens at Procyon grows food for half our outposts, and something is killing its crop. You got Meridian through its worst week: will you go and look? See Foreman Ilse Brandt at the Gardens, then take the samples to Dr Pell Ansari at Dawnfield Institute. The Cooperative covers your jumps to Procyon.”',
    objectives: [
      { kind: 'visit', locationId: 'stonecrop-gardens', text: 'Dock at Stonecrop Gardens (Procyon) and see Ilse Brandt' },
      { kind: 'visit', locationId: 'dawnfield-institute', text: 'Take the blight samples to Dawnfield Institute' },
    ],
    reward: 800,
    repReward: { frontier: 5 },
    difficulty: 1,
    difficultyNote: 'Two jumps from Sol',
    destinationLocationId: 'dawnfield-institute',
    coversJumpFeesTo: 'procyon',
    requires: { jobComplete: OPENING },
    story: {
      arc: 'frontier',
      step: 1,
      speaker: 'quist',
      beats: [
        {
          after: 0,
          lines: [
            { who: 'brandt', text: 'It started as grey fuzz in the east bays. Now it’s in every bay we have. We’ve burned two harvests’ worth of seed trying to stay ahead of it.' },
            { who: 'brandt', text: 'Take these samples to Ansari, and tell the Institute we don’t have long.' },
          ],
        },
        {
          after: 1,
          lines: [{ who: 'ansari', text: 'A mould, and an old one: greenhouses on Earth have fought it for centuries. It can be beaten. But it lives in water, and the Gardens’ water is full of it.' }],
        },
      ],
      debrief: [{ who: 'ansari', text: 'First things first: the Gardens need clean water. Come and see me when you’re ready to haul some.' }],
    },
  },
  {
    id: 'arc.frontier.2',
    title: 'Clean water',
    giverLocationId: 'dawnfield-institute',
    factionId: 'frontier',
    briefing:
      '“The Gardens can’t use their own water until the mould is out of the tanks. Bring them six loads of clean water ice from a mine: the mining outposts at Luyten’s Star are one jump away.”',
    objectives: [{ kind: 'deliver', commodity: 'water', qty: 6, locationId: 'stonecrop-gardens', text: 'Deliver 6 water ice to Stonecrop Gardens' }],
    reward: 900,
    repReward: { frontier: 6 },
    difficulty: 1,
    difficultyNote: 'Buy the ice at a mine',
    destinationLocationId: 'stonecrop-gardens',
    requires: { jobComplete: 'arc.frontier.1' },
    story: {
      arc: 'frontier',
      step: 2,
      speaker: 'ansari',
      debrief: [{ who: 'brandt', text: 'Clean water, and the bays are drinking it. That buys us a few weeks. Ansari wants to know where the mould came from. So do I.' }],
    },
  },
  {
    id: 'arc.frontier.3',
    title: 'The ice hauler',
    giverLocationId: 'stonecrop-gardens',
    factionId: 'frontier',
    briefing:
      '“Our last ice delivery came cheap, off the books, from a hauler that went dark near Wildrye Works on its way out. Its sample canister is still aboard the wreck, and Ansari thinks it will tell us if the mould came in with that ice. Raiders have been at the wreck.”',
    objectives: [
      { kind: 'recover', systemId: 'procyon', locationId: 'wildrye-works', item: 'ice sample canister', guard: 1, text: 'Recover the ice sample canister near Wildrye Works' },
      { kind: 'visit', locationId: 'dawnfield-institute', text: 'Bring the canister to Dr Pell Ansari at Dawnfield Institute' },
    ],
    reward: 1_100,
    repReward: { frontier: 6 },
    difficulty: 2,
    difficultyNote: 'Raiders at the wreck',
    destinationLocationId: 'dawnfield-institute',
    requires: { jobComplete: 'arc.frontier.2' },
    story: {
      arc: 'frontier',
      step: 3,
      speaker: 'brandt',
      debrief: [
        { who: 'ansari', text: 'It came in with the ice: a cheap load, never inspected, bought to save a few hundred credits. I can make a fungicide.' },
        { who: 'ansari', text: 'But the Gardens have to decide what to do while I make it, and Ilse and I don’t agree. Go and hear Ilse out.' },
      ],
    },
  },
  {
    id: 'arc.frontier.4',
    title: 'Quarantine',
    giverLocationId: 'stonecrop-gardens',
    factionId: 'frontier',
    briefing:
      '“Pell wants the Gardens sealed until the fungicide has done its work: no ships, no food out, for a season. I want to burn the worst bays tonight, reseed from clean stock and keep feeding people. The Cooperative says you’ve seen more of this than anyone. So: which is it?”',
    objectives: [
      {
        kind: 'choice',
        locationId: 'stonecrop-gardens',
        choiceId: 'frontier.quarantine',
        text: 'Decide how the Gardens fight the blight',
        prompt: 'Seal the Gardens until they are clean, or burn the worst bays and reseed?',
        options: [
          {
            id: 'seal',
            label: 'Seal the Gardens (Ansari’s way)',
            outcome: 'The Gardens close to traffic. The outposts will eat thin for a season, but the mould goes no further. The Cooperative pays you for your trouble.',
            rep: { frontier: 10 },
            credits: 900,
          },
          {
            id: 'burn',
            label: 'Burn and reseed (Brandt’s way)',
            outcome: 'The worst bays burn tonight and clean seed goes in tomorrow. Food keeps moving, and the Gardens pay you out of what they save.',
            rep: { frontier: 5 },
            credits: 1_600,
          },
        ],
      },
    ],
    ...DECISION,
    destinationLocationId: 'stonecrop-gardens',
    requires: { jobComplete: 'arc.frontier.3' },
    story: { arc: 'frontier', step: 4, speaker: 'brandt' },
  },
  {
    id: 'arc.frontier.5',
    title: 'The relief convoy',
    giverLocationId: 'dawnfield-institute',
    factionId: 'frontier',
    briefing:
      '“The fungicide is ready: three haulers of it, with clean seed stock, from here to the Gardens. Every raider in the system has heard there is cargo worth taking. Keep at least two of the three alive.”',
    objectives: [
      {
        kind: 'escort',
        systemId: 'procyon',
        fromLocationId: 'dawnfield-institute',
        locationId: 'stonecrop-gardens',
        model: 'ship.freighter.1.toliman',
        shipName: 'relief convoy',
        level: 2,
        convoy: { names: ['Sorrel', 'Tansy', 'Clover'], need: 2, waves: 2 },
        text: 'Escort the relief convoy to Stonecrop Gardens',
      },
    ],
    reward: 3_200,
    repReward: { frontier: 20, sta: 4, 'hollow-wake': -8 },
    difficulty: 3,
    difficultyNote: 'Two waves of raiders',
    destinationLocationId: 'stonecrop-gardens',
    requires: { jobComplete: 'arc.frontier.4', choice: { id: 'frontier.quarantine', oneOf: ['seal', 'burn'] } },
    story: {
      arc: 'frontier',
      step: 5,
      speaker: 'ansari',
      finale: true,
      comms: [{ at: 0, lines: [{ who: 'quist', text: 'Quist here, on the Cooperative channel. Every outpost is listening. Bring them home.' }] }],
      variant: {
        choiceId: 'frontier.quarantine',
        briefing: {
          seal: '“The fungicide is ready: three haulers of it, with clean seed stock, from here to the Gardens. With the Gardens sealed, every raider in the system knows how badly that cargo is wanted. Keep at least two of the three alive.”',
          burn: '“The fungicide is ready: three haulers of it, with clean seed stock for the new bays, from here to the Gardens. The smoke from the burning bays can be seen from the lanes, and so can our haulers. Keep at least two of the three alive.”',
        },
        debrief: {
          seal: [{ who: 'brandt', text: 'Pell was right, and I’ll say it once: the Gardens will be clean by spring. When we open again, your berth here is free for life.' }],
          burn: [{ who: 'brandt', text: 'The new bays are green already, and we never stopped feeding anyone. When you pass Procyon, there’s a berth and a hot meal here for you, always.' }],
        },
      },
    },
  },

  // ------------------------------------------------------------ Salt’s Crew (Hollow Wake)
  {
    id: 'arc.wake.1',
    title: 'Salt’s test',
    giverLocationId: 'graveyard-nest',
    factionId: 'hollow-wake',
    briefing:
      '“Friends of the Wake are cheap. Crew is earned. Here are six transponder spoofers: a buyer at Regent Concourse in Ross 154 is waiting for them. Authority patrols scan cargo out there, so don’t let one get a look in your hold. Then come back and tell me how it went.”',
    objectives: [
      { kind: 'deliver', commodity: 'spoofers', qty: 6, locationId: 'regent-concourse', text: 'Deliver 6 transponder spoofers to Regent Concourse (Ross 154)' },
      { kind: 'visit', locationId: 'graveyard-nest', text: 'Report back to Salt at Graveyard Nest' },
    ],
    reward: 1_100,
    repReward: { 'hollow-wake': 6 },
    difficulty: 2,
    difficultyNote: 'Contraband past Authority scans',
    destinationLocationId: 'graveyard-nest',
    requires: { minRep: { faction: 'hollow-wake', value: 10 } },
    story: {
      arc: 'wake',
      step: 1,
      speaker: 'salt',
      cargo: { commodity: 'spoofers', qty: 6 },
      debrief: [{ who: 'salt', text: 'A clean run. Juno Fiske bet me you’d lose your nerve at the first patrol; Juno owes me a drink. Stay close. There’s real work coming.' }],
    },
  },
  {
    id: 'arc.wake.2',
    title: 'Toll on the lane',
    giverLocationId: 'graveyard-nest',
    factionId: 'hollow-wake',
    briefing:
      '“Authority customs have been squeezing our buyers, so we squeeze back. Two Authority haulers in Ross 154: I don’t care what they carry, I care that they don’t arrive. Their patrols will come for you after. That’s the toll.”',
    objectives: [{ kind: 'piracy', systemId: 'ross-154', faction: 'sta', count: 2, text: 'Destroy 2 Transit Authority haulers in Ross 154' }],
    reward: 1_500,
    repReward: { 'hollow-wake': 10 },
    difficulty: 2,
    difficultyNote: 'A crime, and patrols after it',
    destinationLocationId: 'graveyard-nest',
    requires: { jobComplete: 'arc.wake.1' },
    story: {
      arc: 'wake',
      step: 2,
      speaker: 'salt',
      debrief: [{ who: 'salt', text: 'The Authority is shouting on every channel. Good. Come home: I need someone I trust for something quieter.' }],
    },
  },
  {
    id: 'arc.wake.3',
    title: 'The strongbox',
    giverLocationId: 'graveyard-nest',
    factionId: 'hollow-wake',
    briefing:
      '“One of my crews dumped a strongbox near Flotsam Diggings in Wolf 1061 when an Authority patrol ran them down. The crew didn’t make it. The box did. Bring it to me unopened.”',
    objectives: [
      { kind: 'recover', systemId: 'wolf-1061', locationId: 'flotsam-diggings', item: 'Wake strongbox', guard: null, text: 'Recover the Wake strongbox near Flotsam Diggings (Wolf 1061)' },
      { kind: 'visit', locationId: 'graveyard-nest', text: 'Bring the strongbox to Salt at Graveyard Nest' },
    ],
    reward: 1_000,
    repReward: { 'hollow-wake': 6 },
    difficulty: 1,
    difficultyNote: 'Quiet, if nobody else finds it first',
    destinationLocationId: 'graveyard-nest',
    requires: { jobComplete: 'arc.wake.2' },
    story: {
      arc: 'wake',
      step: 3,
      speaker: 'salt',
      debrief: [
        { who: 'salt', text: 'Credits, a pair of dice, and this: a list of every Nest from here to Gliese 876, with approach codes. Written for the Authority. In Juno Fiske’s hand.' },
        { who: 'salt', text: 'Juno has flown with me for nine years. I need to think, and so do you. Find me when you’re ready.' },
      ],
    },
  },
  {
    id: 'arc.wake.4',
    title: 'Juno Fiske',
    giverLocationId: 'graveyard-nest',
    factionId: 'hollow-wake',
    briefing:
      '“Juno is down in the hangar, fixing a drive coil like nothing is wrong. I could ask. I’d rather you decide what I’m told. You found the box: that makes this yours.”',
    objectives: [
      {
        kind: 'choice',
        locationId: 'graveyard-nest',
        choiceId: 'wake.fiske',
        text: 'Decide what Salt is told about Juno Fiske',
        prompt: 'The list of Nests is in Juno Fiske’s hand. What do you do?',
        options: [
          {
            id: 'loyal',
            label: 'Tell Salt everything',
            outcome: 'Juno is put off the Nest in a lifeboat with a day’s air and a beacon. Salt doesn’t say thank you. Salt doesn’t have to.',
            rep: { 'hollow-wake': 12 },
            credits: 1_200,
          },
          {
            id: 'warn',
            label: 'Warn Juno first',
            outcome: 'By the time Salt hears, Juno’s ship is gone from the hangar. Salt looks at you for a long moment and says nothing.',
            rep: { 'hollow-wake': -4 },
          },
          {
            id: 'betray',
            label: 'Sell the Nest to the Authority',
            outcome: 'You send the list on yourself, with Salt’s name at the top. The Authority clears your record and pays well. The Wake will never forget it.',
            rep: { sta: 20, frontier: 5, 'hollow-wake': -45 },
            credits: 2_500,
            pardon: true,
            ends: true,
          },
        ],
      },
    ],
    ...DECISION,
    destinationLocationId: 'graveyard-nest',
    requires: { jobComplete: 'arc.wake.3' },
    story: { arc: 'wake', step: 4, speaker: 'salt' },
  },
  {
    id: 'arc.wake.5',
    title: 'Break the sweep',
    giverLocationId: 'graveyard-nest',
    factionId: 'hollow-wake',
    briefing: '“The Authority is coming for the Nest: a sweep, four ships at least. Every crew I have is flying. So are you. Break them before they reach the docks.”',
    objectives: [{ kind: 'defend', systemId: '70-ophiuchi', locationId: 'graveyard-nest', count: 4, text: 'Destroy 4 ships of the Authority sweep at Graveyard Nest' }],
    reward: 5_000,
    repReward: { 'hollow-wake': 20 },
    difficulty: 3,
    difficultyNote: 'An Authority sweep; every kill is a crime',
    destinationLocationId: 'graveyard-nest',
    requires: { jobComplete: 'arc.wake.4', choice: { id: 'wake.fiske', oneOf: ['loyal', 'warn'] } },
    story: {
      arc: 'wake',
      step: 5,
      speaker: 'salt',
      finale: true,
      comms: [{ at: 0, lines: [{ who: 'salt', text: 'Sweep ships coming in from the jump beacon. Every crew, on me. Don’t let them near the docks.' }] }],
      variant: {
        choiceId: 'wake.fiske',
        briefing: {
          loyal: '“Juno sent the list before we caught up. The Authority is coming for the Nest: a sweep, four ships at least. Every crew I have is flying. So are you. Break them before they reach the docks.”',
          warn: '“Juno’s list reached the Authority, as you’d expect of a list written for them. A sweep is coming for the Nest, four ships at least. I don’t know what you are to me any more. Fly with us anyway, and we’ll find out.”',
        },
        debrief: {
          loyal: [{ who: 'salt', text: 'They’ll be back one day, with more. Not this year. The Wake doesn’t give titles; it gives berths. You have one at every Nest, for as long as you fly.' }],
          warn: [{ who: 'salt', text: 'You flew like crew today. Whatever you did for Juno, you did for a reason, and I can live with not knowing it. You have a berth at every Nest.' }],
        },
      },
    },
  },
];
