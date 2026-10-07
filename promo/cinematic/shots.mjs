// The cinematic cut's shots ("The Stars Are Real"): staged like the Steam cut's (../shots.mjs), but
// mostly with the interface hidden and the game's own camera placed by a rig, and recorded at
// 24 frames a second with real motion blur (see Recorder's `cine` in ../lib/harness.mjs).
import { api, centreMouse, clock, dockAt, ease, freeze, launch, look, mapMove, newGame, place, press, rig, step, targets, waitUntil, warp } from '../lib/harness.mjs';
import { atHole, cursor, gunner, hireWing, inSol, quiet, toBattle } from '../shots.mjs';

/** The star map with only its stars and their names: every panel put away. */
const MAP_ONLY = '.gmap-top, .gmap-list, .gmap-tools, .gmap-zoom, .gmap-hint, .gmap-card, .gmap-foot, .gmap-foot-info, .gmap-legend { display: none !important; }';

/** The gunner's hand at the recorder's step rate (its easing is tuned for sixty steps a second). */
const hands = (page, rec) => gunner(page, { follow: 1 - Math.pow(1 - 0.16, 60 / rec.fps) });

/** A fight flown as in the Steam cut: seekers on a lock, decoys against seekers. `each` sees every step. */
async function fight(page, rec, seconds, each) {
  const h = hands(page, rec);
  let fired = -1e9;
  await rec.run(seconds, async (i, t) => {
    const hud = await h.frame();
    if (hud?.missileLock === 'locked' && t - fired > 3 && hud.missiles > 0) {
      await page.keyboard.press('KeyF');
      rec.mark('seeker');
      fired = t;
    }
    if (hud?.incoming > 0 && i % Math.round(rec.fps * 1.5) === 0) {
      await page.keyboard.press('KeyC');
      rec.mark('decoy');
    }
    await each?.(i, t);
  });
  await h.release();
}

/** How many of an effect the game has asked for since recording began. */
const heard = (page, id) => page.evaluate((x) => window.__promo.cues.filter((c) => c.kind === 'sfx' && c.id === x).length, id);

export const CINE = {
  // ---------------------------------------------------------------------------------- the void
  'c-map': {
    about: 'The star map with its panels put away: out from Sol to the whole neighbourhood, turning slowly',
    async run({ page }, rec) {
      await inSol(page);
      await page.keyboard.press('Tab');
      await page.getByTestId('galaxy-map').waitFor();
      await waitUntil(page, 'the map at rest', async () => (await api(page, 'mapView'))?.moving === false, 20_000);
      const whole = (await api(page, 'mapView')).distance;
      // Sol in the middle and close (a double click on its row centres and zooms on it), then the panels away.
      await page.getByTestId('map-system-sol').dblclick();
      await page.waitForTimeout(1_200);
      await look(page, { hud: true, extra: MAP_ONLY });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await waitUntil(page, 'the map at rest', async () => (await api(page, 'mapView'))?.moving === false, 20_000);
      const close = (await api(page, 'mapView')).distance;
      console.log('map distance: whole', whole, 'close', close);
      await page.mouse.move(4, 4);
      // Out to a little short of the whole neighbourhood over the shot, at a steady apparent speed.
      const seconds = 16;
      await mapMove(page, { yaw: 0.045, pitch: -0.006, zoom: Math.pow((whole * 0.8) / close, 1 / seconds) });
      await rec.start();
      await rec.run(16);
      await mapMove(page, null);
    },
  },

  // ------------------------------------------------------------------------------- first light
  'c-earth': {
    about: 'Halcyon Ring over Earth, a comet above: the title screen’s own backdrop, its menu hidden',
    halfRate: true,
    async run({ page }, rec) {
      await look(page, { hud: false });
      await page.waitForTimeout(1_500);
      await rec.start();
      await rec.run(12);
    },
  },
  'c-deck': {
    about: 'Halcyon Ring’s deck with the interface hidden: the courier on its pad, Earth through the bay',
    halfRate: true,
    async run({ page }, rec) {
      await newGame(page);
      await dockAt(page, 'earth-port');
      await press(page, 'room-deck');
      await page.waitForTimeout(2_500);
      await look(page, { hud: false });
      await rec.start();
      await rec.run(7);
    },
  },
  'c-undock': {
    about: 'The courier clears Halcyon Ring’s bay, seen from ahead, Earth filling the frame behind',
    async run({ page }, rec) {
      await newGame(page);
      await dockAt(page, 'earth-port');
      await launch(page);
      await dockAt(page, 'earth-port');
      await centreMouse(page);
      await rig(page, { from: { az: 160, el: 4, dist: 26, up: 2 }, to: { az: 126, el: 9, dist: 46, up: 2 }, seconds: 7 });
      await rec.start();
      await page.getByTestId('dock-launch').click();
      await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
      await look(page, { hud: false });
      await rec.run(8);
    },
  },
  'c-lane': {
    about: 'Into the Earth–Mars trade lane, seen from off the ship’s quarter as it goes to lane speed',
    async run({ page }, rec) {
      await inSol(page);
      await api(page, 'selectTarget', 'lane:sol-earth-mars:fwd');
      await api(page, 'placeNear', { id: 'lane:sol-earth-mars:fwd', distance: 500 });
      await waitUntil(page, 'the lane offered', async () => /lane/i.test((await api(page, 'hud'))?.context?.label ?? ''), 20_000).catch(() => {});
      await look(page, { hud: false });
      await freeze(page);
      await page.keyboard.press('KeyE');
      await step(page, 4.6);
      await rig(page, { from: { az: 58, el: 5, dist: 30, ahead: 30 }, to: { az: 24, el: 7, dist: 34, ahead: 60 }, seconds: 5 });
      await rec.start();
      await rec.run(7);
    },
  },

  // ---------------------------------------------------------------------------------- outbound
  'c-jump': {
    about: 'The jump to Alpha Centauri with the interface hidden: the drive charging, the tunnel, arrival',
    async run({ page }, rec) {
      await inSol(page);
      await api(page, 'setCredits', 5_000);
      await page.keyboard.press('Tab');
      await page.getByTestId('galaxy-map').waitFor();
      await press(page, 'map-system-alpha-centauri');
      await page.waitForTimeout(1_500);
      // From ahead of the ship while the drive charges, Earth and its station behind it.
      await rig(page, { from: { az: 198, el: 3, dist: 26, up: 2 }, to: { az: 190, el: 4, dist: 34, up: 2 }, seconds: 1.4 });
      await rec.start();
      await page.getByTestId('map-jump').click();
      await look(page, { hud: false, extra: '.jump-overlay { display: none !important; }' });
      rec.mark('jump');
      await rec.run(2.2);
      // In the tunnel the flight's camera is not in use: the arrival's view is set while it plays.
      await rig(page, { from: { az: 30, el: 6, dist: 30, ahead: 40 }, to: { az: 14, el: 8, dist: 34, ahead: 40 }, seconds: 6 });
      await rec.run(7.8);
    },
  },
  'c-centauri': {
    about: 'Alpha Centauri A and B from the ship, flying in',
    async run({ page }, rec) {
      await newGame(page);
      await warp(page, 'alpha-centauri');
      await centreMouse(page);
      const t = await targets(page);
      const a = t.find((x) => x.id === 'star:alpha-centauri-a');
      const b = t.find((x) => x.id === 'star:alpha-centauri-b');
      console.log(JSON.stringify(t.filter((x) => ['star', 'planet', 'station'].includes(x.kind))));
      // Off to one side of the pair, far enough to hold both suns in the frame.
      const mid = a.p.map((v, i) => (v + b.p[i]) / 2);
      const gap = Math.hypot(...a.p.map((v, i) => v - b.p[i]));
      const side = [-(b.p[2] - a.p[2]) / gap, 0.18, (b.p[0] - a.p[0]) / gap];
      await place(page, mid.map((v, i) => v + side[i] * gap * 1.5), mid);
      await look(page, { hud: false });
      await rig(page, { from: { az: 16, el: 5, dist: 30, ahead: 60, side: 6 }, to: { az: -8, el: 7, dist: 34, ahead: 60, side: 6 }, seconds: 7 });
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(7, async (i) => {
        if (i === 12) await page.keyboard.press('Space');
      });
      await page.keyboard.up('KeyW');
    },
  },
  'c-proxima': {
    about: 'Proxima Centauri b, a real planet, with its star beyond; the HUD’s REAL badge on it',
    async run({ page }, rec) {
      await newGame(page);
      await warp(page, 'alpha-centauri');
      await centreMouse(page);
      const t = await targets(page);
      const star = t.find((x) => x.id === 'star:proxima-centauri');
      const planet = t.find((x) => x.id === 'planet:proxima-cen-b');
      // On the planet's sunlit side, forty degrees round from its star, so it shows as a broad crescent.
      const to = star.p.map((v, i) => v - planet.p[i]);
      const len = Math.hypot(to[0], to[2]);
      const turn = (40 * Math.PI) / 180;
      const dir = [(to[0] * Math.cos(turn) - to[2] * Math.sin(turn)) / len, 0.1, (to[0] * Math.sin(turn) + to[2] * Math.cos(turn)) / len];
      const at = planet.p.map((v, i) => v + dir[i] * (planet.r + 1_700));
      const lookAt = planet.p.map((v, i) => v + (i === 1 ? planet.r * 0.9 : 0));
      await place(page, at, lookAt);
      await api(page, 'selectTarget', 'planet:proxima-cen-b');
      await look(page, { hud: true });
      // The planet's discovery card comes up once it is in sight: put away, then the ship put back
      // (a click moves the cursor, and the ship steers toward the cursor).
      for (let i = 0; i < 8; i++) {
        const ok = page.getByTestId('discovery-ok').last();
        if (await ok.isVisible().catch(() => false)) await ok.click().catch(() => {});
        await page.waitForTimeout(300);
      }
      await centreMouse(page);
      await place(page, at, lookAt);
      await quiet(page);
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(8);
      await page.keyboard.up('KeyW');
    },
  },

  // ------------------------------------------------------------------------------- trade winds
  'c-bar': {
    about: 'Halcyon Ring’s bar and the people in it, the interface hidden',
    halfRate: true,
    async run({ page }, rec) {
      await newGame(page);
      await dockAt(page, 'earth-port');
      await press(page, 'room-bar');
      await page.waitForTimeout(3_000);
      await look(page, { hud: false });
      await rec.start();
      await rec.run(6);
    },
  },
  'c-race': {
    about: 'The Moon Loop’s start from a camera fixed beside the box: the field goes away through the ring',
    async run({ page }, rec) {
      await newGame(page);
      await page.evaluate(() => window.__starman.setReputation('sta', 45));
      await api(page, 'setRecord', { kills: 25 });
      await api(page, 'setCredits', 50_000);
      await dockAt(page, 'earth-port');
      if (await page.getByTestId('rank-dialog').isVisible({ timeout: 2_000 }).catch(() => false)) await press(page, 'rank-continue');
      await press(page, 'room-bar');
      if (!(await page.getByTestId('races-window').isVisible().catch(() => false))) await press(page, 'station-races');
      await page.getByTestId('race-enter-sprint').waitFor({ timeout: 60_000 });
      await press(page, 'race-enter-sprint');
      await launch(page);
      await centreMouse(page);
      await api(page, 'raceAt', { gate: -1 });
      await waitUntil(page, 'Start on the action', async () => (await api(page, 'hud'))?.context?.label === 'Start', 15_000);
      await look(page, { hud: false });
      await freeze(page);
      await page.keyboard.press('KeyE');
      await step(page, 2.0);
      await rig(page, { anchor: 'fixed', az: 26, el: 5, dist: 44, ahead: 70, up: 4, fov: 56 });
      await rec.start();
      let away = -1;
      await rec.run(6.5, async (i) => {
        const race = (await api(page, 'hud'))?.race;
        if (race?.phase === 'on' && away < 0) {
          away = i;
          await page.keyboard.down('KeyW');
          await page.keyboard.down('ShiftLeft');
          rec.mark('go');
        }
      });
      await page.keyboard.up('ShiftLeft');
      await page.keyboard.up('KeyW');
    },
  },
  'c-trade': {
    about: 'The trader at Halcyon Ring: twelve medical supplies bought (the station’s own screens)',
    halfRate: true,
    async run({ page }, rec) {
      await press(page, 'title-play');
      await press(page, 'intro-ok');
      await press(page, 'accept-lifeline');
      await page.waitForTimeout(500);
      await api(page, 'setCredits', 2_400);
      await press(page, 'room-trader');
      await page.waitForTimeout(2_500);
      await look(page, { hud: true });
      await quiet(page);
      await rec.start();
      await rec.run(0.8);
      await page.getByTestId('buy-medical').click();
      rec.mark('buy dialog');
      await rec.run(0.7);
      for (let i = 0; i < 6; i++) {
        await page.getByTestId('buy-plus').click();
        rec.mark('plus');
        await rec.run(0.22);
      }
      await rec.run(0.5);
      await page.getByTestId('buy-confirm').click();
      rec.mark('bought');
      await rec.run(2);
    },
  },
  'c-mine': {
    about: 'The mining laser on a rock in Sol’s main belt, from off the ship’s quarter',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'fit', 'gear.mining-laser.1.eridani');
      await warp(page, 'sol');
      await centreMouse(page);
      await api(page, 'placeNear', { id: 'belt:sol-main-belt', distance: 0 });
      await waitUntil(page, 'rocks near the ship', async () => ((await api(page, 'mining'))?.rocks.length ?? 0) > 0, 60_000);
      const rock = [...(await api(page, 'mining')).rocks].sort((p, q) => p.distance - q.distance)[0];
      await api(page, 'selectTarget', rock.id);
      await api(page, 'placeNear', { id: rock.id, distance: 260 });
      await waitUntil(page, 'Mine offered', async () => (await api(page, 'hud'))?.context?.action === 'mine', 30_000);
      await centreMouse(page);
      await look(page, { hud: false });
      await rig(page, { from: { az: 64, el: 9, dist: 60, ahead: 120 }, to: { az: 44, el: 12, dist: 52, ahead: 120 }, seconds: 6 });
      await rec.start();
      await rec.run(0.5);
      await page.keyboard.press('KeyB');
      rec.mark('mine');
      await rec.run(5.5);
    },
  },

  // ------------------------------------------------------------------------------------ battle
  'c-clash': {
    about: 'The clash at the Ross 154 beacon line, flown with the HUD on',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'fit', 'gear.pulse.2.halden');
      await hireWing(page);
      await toBattle(page, 'clash');
      await centreMouse(page);
      const foe = (await api(page, 'battle')).flight.ships.filter((x) => x.side === 'wake' && !x.over).sort((p, q) => p.distance - q.distance)[0];
      await api(page, 'placeNear', { id: `ship:${foe.id}`, distance: 420 });
      await api(page, 'selectTarget', `ship:${foe.id}`);
      await look(page, { hud: true });
      await rec.start();
      await page.keyboard.down('KeyW');
      await fight(page, rec, 13);
      await page.keyboard.up('KeyW');
    },
  },
  'c-clash-wide': {
    about: 'The same clash from off the ship’s quarter, interface hidden; each large blast in slow motion',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'fit', 'gear.pulse.2.halden');
      await hireWing(page);
      await toBattle(page, 'clash');
      await centreMouse(page);
      const foe = (await api(page, 'battle')).flight.ships.filter((x) => x.side === 'wake' && !x.over).sort((p, q) => p.distance - q.distance)[0];
      await api(page, 'placeNear', { id: `ship:${foe.id}`, distance: 420 });
      await api(page, 'selectTarget', `ship:${foe.id}`);
      await look(page, { hud: false });
      await rig(page, { from: { az: 34, el: 8, dist: 30, ahead: 70, side: 4 }, to: { az: -30, el: 10, dist: 34, ahead: 70, side: -4 }, seconds: 12 });
      await rec.start();
      await page.keyboard.down('KeyW');
      let blasts = 0;
      let until = -1;
      await fight(page, rec, 16, async (i, t) => {
        if (i % 4) return;
        const n = await heard(page, 'explosion-large');
        if (n > blasts) {
          blasts = n;
          rec.slow = 5;
          until = t + 2.2;
          rec.mark('slow');
        } else if (rec.slow !== 1 && t >= until) {
          rec.slow = 1;
          rec.mark('full speed');
        }
      });
      await page.keyboard.up('KeyW');
    },
  },
  'c-assault': {
    about: 'The Wake’s assault on Regent Concourse, flown with the HUD on',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'fit', 'gear.pulse.2.halden');
      await hireWing(page);
      await toBattle(page, 'assault');
      await centreMouse(page);
      const foe = (await api(page, 'battle')).flight.ships.filter((x) => x.side === 'wake' && !x.over).sort((p, q) => p.distance - q.distance)[0];
      await api(page, 'placeNear', { id: `ship:${foe.id}`, distance: 480 });
      await api(page, 'selectTarget', `ship:${foe.id}`);
      await look(page, { hud: true });
      await rec.start();
      await page.keyboard.down('KeyW');
      await fight(page, rec, 13);
      await page.keyboard.up('KeyW');
    },
  },

  // --------------------------------------------------------------------------------- stillness
  'c-outpost': {
    about: 'Your own outpost at Lalande 21185 b, circled slowly, its star behind',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'setCredits', 50_000);
      await dockAt(page, 'wayfarer-array');
      await press(page, 'room-deck');
      if (!(await page.getByTestId('fleet').isVisible().catch(() => false))) await press(page, 'station-fleet');
      await press(page, 'outpost-charter-gj-411-b');
      await press(page, 'outpost-charter-confirm');
      await dockAt(page, 'outpost.gj-411-b');
      await api(page, 'setCargo', { 'habitat-modules': 8, metals: 20, machinery: 6 });
      await press(page, 'room-deck');
      if (!(await page.getByTestId('outpost-window').isVisible().catch(() => false))) await press(page, 'station-outpost');
      for (const good of ['habitat-modules', 'metals', 'machinery']) await press(page, `outpost-deliver-${good}`);
      await waitUntil(page, 'the outpost open', async () => ((await api(page, 'state')).world.outposts?.[0]?.stage ?? 0) >= 1);
      await launch(page);
      await centreMouse(page);
      const id = 'station:outpost.gj-411-b';
      await api(page, 'placeNear', { id, distance: 380 });
      await api(page, 'face', { id, below: 4 });
      await look(page, { hud: false });
      await rig(page, { from: { az: 22, el: 6, dist: 36, ahead: 80, side: 8 }, to: { az: -14, el: 9, dist: 40, ahead: 80, side: 8 }, seconds: 8 });
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(8, async (i, t) => {
        await cursor(page, 0.16 * Math.sin((Math.PI * t) / 8), -0.02);
      });
      await page.keyboard.up('KeyW');
    },
  },
  'c-comet': {
    about: 'Comet 2P/Encke’s tails three weeks before it rounds the Sun, from off the ship’s quarter',
    async run({ page }, rec) {
      await inSol(page);
      await api(page, 'viewComet', { id: 'comet-2p', distance: 11_000 });
      await look(page, { hud: false });
      await rig(page, { from: { az: 30, el: 7, dist: 34, ahead: 46, side: -8 }, to: { az: 16, el: 9, dist: 30, ahead: 46, side: -8 }, seconds: 9 });
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(9, async (i, t) => {
        if (i === Math.round(rec.fps / 2)) await page.keyboard.press('Space');
        const k = Math.sin(Math.PI * ease(t / 9));
        await cursor(page, -0.22 * k, -0.06 * k);
      });
      await page.keyboard.up('KeyW');
    },
  },

  // ---------------------------------------------------------------------------------- collapse
  'c-pyre': {
    about: 'Pyre, the invented red supergiant, and its observatory, before it dies',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'skyFrom', 0);
      const sky = await api(page, 'sky');
      await api(page, 'edgeAt', Math.max(await clock(page), sky.timeline.bhGone) + 60);
      const pyre = await api(page, 'pyre');
      await api(page, 'advanceClock', pyre.timeline.warning + 90 - (await clock(page)));
      await dockAt(page, 'pyre-observatory');
      await launch(page);
      await centreMouse(page);
      await api(page, 'face', { id: 'star:pyre', below: 7 });
      console.log(JSON.stringify((await targets(page)).filter((x) => ['star', 'planet', 'station'].includes(x.kind))));
      await look(page, { hud: false });
      await rig(page, { from: { az: 28, el: 5, dist: 34, ahead: 70, side: 10 }, to: { az: 8, el: 8, dist: 30, ahead: 70, side: 10 }, seconds: 7 });
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(7, async (i, t) => {
        await cursor(page, -0.12 * Math.sin((Math.PI * t) / 7), 0);
      });
      await page.keyboard.up('KeyW');
    },
  },
  'c-pyre-close': {
    about: 'Pyre alone, filling the frame, the camera closing on it: the last look',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'skyFrom', 0);
      const sky = await api(page, 'sky');
      await api(page, 'edgeAt', Math.max(await clock(page), sky.timeline.bhGone) + 60);
      const pyre = await api(page, 'pyre');
      await api(page, 'advanceClock', pyre.timeline.warning + 90 - (await clock(page)));
      await dockAt(page, 'pyre-observatory');
      await launch(page);
      await centreMouse(page);
      const star = (await targets(page)).find((x) => x.id === 'star:pyre');
      await look(page, { hud: false });
      await rig(page, { around: 'star:pyre', from: { az: 150, el: 6, dist: star.r * 4.2 }, to: { az: 138, el: 3, dist: star.r * 2.3 }, seconds: 7, fov: 44, linear: true });
      await rec.start();
      await rec.run(7);
    },
  },
  'c-flee': {
    about: 'Away from Pyre at cruise, seen from ahead with the star behind the ship',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'skyFrom', 0);
      const sky = await api(page, 'sky');
      await api(page, 'edgeAt', Math.max(await clock(page), sky.timeline.bhGone) + 60);
      const pyre = await api(page, 'pyre');
      await api(page, 'advanceClock', pyre.timeline.warning + 90 - (await clock(page)));
      await dockAt(page, 'pyre-observatory');
      await launch(page);
      await centreMouse(page);
      const t = await targets(page);
      const star = t.find((x) => x.id === 'star:pyre');
      const me = (await api(page, 'player')).position;
      // Turned to fly straight away from the star.
      await place(page, me, me.map((v, i) => v + (v - star.p[i])));
      await look(page, { hud: false });
      await rig(page, { from: { az: 172, el: 3, dist: 30, up: 2 }, to: { az: 164, el: 5, dist: 44, up: 2 }, seconds: 6 });
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(6, async (i) => {
        if (i === 8) await page.keyboard.press('Space');
      });
      await page.keyboard.up('KeyW');
    },
  },
  'c-hole': {
    about: 'The black hole Pyre leaves, from off the ship’s quarter at cruise',
    async run({ page }, rec) {
      const id = await atHole(page);
      await api(page, 'placeNear', { id, distance: 15_000 });
      await api(page, 'face', { id, below: 3 });
      await look(page, { hud: false });
      await rig(page, { from: { az: -32, el: 6, dist: 36, ahead: 50, side: 8 }, to: { az: -14, el: 8, dist: 30, ahead: 50, side: 8 }, seconds: 10 });
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(10, async (i) => {
        if (i === 8) await page.keyboard.press('Space');
      });
      await page.keyboard.up('KeyW');
    },
  },
  'c-hole-wide': {
    about: 'The black hole and its disk alone, the camera circling slowly: the end card’s plate',
    async run({ page }, rec) {
      const id = await atHole(page);
      await api(page, 'placeNear', { id, distance: 15_000 });
      await api(page, 'face', { id, below: 0 });
      await look(page, { hud: false });
      await rig(page, { around: id, from: { az: 14, el: 9, dist: 21_000 }, to: { az: 30, el: 11, dist: 19_000 }, seconds: 16, fov: 40 });
      await rec.start();
      await rec.run(16);
    },
  },
};
