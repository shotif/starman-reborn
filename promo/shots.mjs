// The trailer's shots: how each is staged (through the game's own test hooks, as
// tests/e2e/screenshots.spec.ts stages them) and flown (with real mouse and keyboard events).
// See SHOTLIST.md for what each is for.
import { api, centreMouse, clock, dockAt, ease, freeze, launch, look, newGame, place, press, putAway, rig, step, targets, waitUntil, warp } from './lib/harness.mjs';

export const size = (page) => page.cssSize;

/** Moves the cursor to a point given from the screen centre, in half-screens (+x right, +y down). */
export async function cursor(page, nx, ny) {
  const v = size(page);
  await page.mouse.move(v.width / 2 + (nx * v.width) / 2, v.height / 2 + (ny * v.height) / 2);
}

/** No toast on screen (they run on wall-clock time, so a shot starts without one). */
export async function quiet(page, timeout = 20_000) {
  await page.locator('.toast').first().waitFor({ state: 'detached', timeout }).catch(() => {});
}

/** A new game in flight out of Halcyon Ring, on a date (the comets stand where JPL has them on it). */
export async function inSol(page, { date = '2027-01-20T00:00:00Z' } = {}) {
  await newGame(page);
  await api(page, 'startedOn', date);
  await dockAt(page, 'earth-port');
  await launch(page);
  await centreMouse(page);
}

/**
 * A pilot's hands in a fight, a frame at a time: the cursor eased toward the selected hostile's
 * lead marker (or toward the edge of the screen it is off), the trigger held while the aim is close.
 */
export function gunner(page, { follow = 0.16, trigger = 70 } = {}) {
  const v = size(page);
  let x = v.width / 2;
  let y = v.height / 2;
  let firing = false;
  let asked = 0;
  return {
    get firing() {
      return firing;
    },
    async frame({ fire = true } = {}) {
      const hud = await api(page, 'hud');
      const t = hud?.target;
      let aim = null;
      let onLead = false;
      if (t?.hostile) {
        const m = hud.markers.find((k) => k.id === t.id);
        if (t.lead) {
          aim = t.lead;
          onLead = true;
        } else if (m?.onScreen) aim = { x: m.x, y: m.y };
        else if (m) aim = { x: v.width / 2 + Math.cos(m.edgeAngle) * v.width * 0.36, y: v.height / 2 + Math.sin(m.edgeAngle) * v.height * 0.36 };
      } else if (hud && asked-- <= 0) {
        // Nearest hostile, asked for now and then until there is one.
        await page.keyboard.press('KeyH');
        asked = 20;
      }
      if (aim) {
        x += (aim.x - x) * follow;
        y += (aim.y - y) * follow;
      }
      await page.mouse.move(x, y);
      const on = fire && onLead && Math.hypot(aim.x - x, aim.y - y) < trigger;
      if (on !== firing) {
        if (on) await page.mouse.down({ button: 'right' });
        else await page.mouse.up({ button: 'right' });
        firing = on;
      }
      return hud;
    },
    async release() {
      if (firing) await page.mouse.up({ button: 'right' });
      firing = false;
    },
  };
}

/** Two pilots hired for the wing at Halcyon Ring and Deimos Depot, as the screenshots journey hires them. */
export async function hireWing(page) {
  await api(page, 'setCredits', 60_000);
  const hire = async () => {
    await press(page, 'room-bar');
    if (!(await page.getByTestId('people-window').isVisible().catch(() => false))) await press(page, 'station-people');
    await page.locator('[data-testid^="person-w."]').first().click();
    await press(page, await page.locator('[data-testid^="hire-"]').first().getAttribute('data-testid'));
  };
  await dockAt(page, 'earth-port');
  await hire();
  await dockAt(page, 'mars-depot');
  await hire();
}

/** A border battle of a kind at Ross 154, under way, the ship just launched from Waymark Waypoint. */
export async function toBattle(page, kind) {
  await api(page, 'meetBattles', true);
  await api(page, 'quietPacks', true);
  const found = await api(page, 'findBattle', { system: 'ross-154', kind, from: await clock(page) });
  if (!found) throw new Error(`no ${kind} at Ross 154`);
  await api(page, 'advanceClock', found.opens - (await clock(page)) - 40);
  await dockAt(page, 'waymark-waypoint');
  if (await page.getByTestId('rank-dialog').isVisible({ timeout: 1_500 }).catch(() => false)) await press(page, 'rank-continue');
  await launch(page);
  await api(page, 'setTimeScale', 4);
  await waitUntil(page, `the ${kind} opens`, async () => !!(await api(page, 'battle')).flight?.active?.startsWith(`${kind}:`), 90_000);
  await api(page, 'setTimeScale', 1);
  return found;
}

/** In flight at Pyre once its black hole can be reached (the lane open again), the hole selected: its target id. */
export async function atHole(page) {
  await newGame(page);
  await api(page, 'skyFrom', 0);
  const sky = await api(page, 'sky');
  await api(page, 'edgeAt', Math.max(await clock(page), sky.timeline.bhGone) + 60);
  const pyre = await api(page, 'pyre');
  await api(page, 'advanceClock', pyre.timeline.laneOpens + 60 - (await clock(page)));
  await warp(page, 'pyre');
  await centreMouse(page);
  const id = `hole:${pyre.holeId}`;
  await api(page, 'selectTarget', id);
  return id;
}

/** Shots, by name. `run(session, rec)` stages the scene, then records it with `rec`. */
export const SHOTS = {
  // ------------------------------------------------------------------------------- the real sky
  comet: {
    about: 'Hook. Into comet 2P/Encke’s tails three weeks before it passes the Sun, Jupiter beyond (HUD on)',
    async run({ page }, rec) {
      await inSol(page);
      await api(page, 'selectTarget', 'comet:comet-2p');
      await api(page, 'viewComet', { id: 'comet-2p', distance: 11_000 });
      await look(page, { hud: true });
      await quiet(page);
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(9, async (i, t) => {
        if (i === 30) {
          await page.keyboard.press('Space');
          rec.mark('cruise');
        }
        // A slow bank toward the coma, then level.
        const k = Math.sin(Math.PI * ease(t / 9));
        await cursor(page, -0.22 * k, -0.06 * k);
      });
      await page.keyboard.up('KeyW');
    },
  },
  'comet-clean': {
    about: 'The same flight from off the ship’s quarter, HUD hidden (the silent loop, and an alternate hook)',
    async run({ page }, rec) {
      await inSol(page);
      await api(page, 'viewComet', { id: 'comet-2p', distance: 11_000 });
      await look(page, { hud: false });
      await rig(page, { from: { az: 30, el: 7, dist: 34, ahead: 46, side: -8 }, to: { az: 18, el: 9, dist: 30, ahead: 46, side: -8 }, seconds: 9 });
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(9, async (i, t) => {
        if (i === 30) await page.keyboard.press('Space');
        const k = Math.sin(Math.PI * ease(t / 9));
        await cursor(page, -0.22 * k, -0.06 * k);
      });
      await page.keyboard.up('KeyW');
    },
  },
  station: {
    about: 'Halcyon Ring over Earth: the title screen’s own backdrop with its menu hidden (the end card’s plate)',
    halfRate: true,
    async run({ page }, rec) {
      await look(page, { hud: false });
      await page.waitForTimeout(1_500);
      await rec.start();
      await rec.run(12);
    },
  },

  // ------------------------------------------------------------------------------------- flying
  undock: {
    about: 'Launching from Halcyon Ring over Earth, seen from ahead of the ship as it clears the bay',
    async run({ page }, rec) {
      await newGame(page);
      await dockAt(page, 'earth-port');
      // Once out and back, so the first launch's controls sheet is behind us.
      await launch(page);
      await dockAt(page, 'earth-port');
      await look(page, { hud: true });
      await centreMouse(page);
      await quiet(page);
      await rig(page, { from: { az: 158, el: 5, dist: 30, up: 2 }, to: { az: 128, el: 9, dist: 44, up: 2 }, seconds: 7 });
      await rec.start();
      await page.getByTestId('dock-launch').click();
      await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
      await rec.run(8);
    },
  },
  flyby: {
    about: 'Boosting past the Moon with Earth beyond, then cruise',
    async run({ page }, rec) {
      await inSol(page);
      await api(page, 'placeNear', { id: 'planet:moon', distance: 2_400 });
      await api(page, 'face', { id: 'planet:earth', below: 6 });
      await look(page, { hud: true });
      await quiet(page);
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(8, async (i, t) => {
        if (i === 40) {
          await page.keyboard.down('ShiftLeft');
          rec.mark('boost');
        }
        if (i === 200) {
          await page.keyboard.up('ShiftLeft');
          await page.keyboard.press('Space');
          rec.mark('cruise');
        }
        const k = Math.sin(Math.PI * ease(t / 8));
        await cursor(page, 0.3 * k, 0.05 * k);
      });
      await page.keyboard.up('KeyW');
    },
  },
  lane: {
    about: 'Into the Earth–Mars trade lane: the last of the line-up, the gate, then lane speed',
    async run({ page }, rec) {
      await inSol(page);
      await api(page, 'selectTarget', 'lane:sol-earth-mars:fwd');
      await api(page, 'placeNear', { id: 'lane:sol-earth-mars:fwd', distance: 500 });
      await look(page, { hud: true });
      await waitUntil(page, 'the lane offered', async () => /lane/i.test((await api(page, 'hud'))?.context?.label ?? ''), 20_000).catch(() => {});
      await quiet(page);
      // The autopilot lines the ship up with the lane for six seconds: those pass unrecorded.
      await freeze(page);
      await page.keyboard.press('KeyE');
      await step(page, 5.2);
      await rec.start();
      await rec.run(5.4);
    },
  },
  jump: {
    about: 'The star map’s Jump to Alpha Centauri: the drive charging, the tunnel, arrival',
    async run({ page }, rec) {
      await inSol(page);
      await api(page, 'setCredits', 5_000);
      await page.keyboard.press('Tab');
      await page.getByTestId('galaxy-map').waitFor();
      await press(page, 'map-system-alpha-centauri');
      await page.waitForTimeout(1_500);
      await look(page, { hud: true });
      await quiet(page);
      await rec.start();
      await rec.run(1);
      await page.getByTestId('map-jump').click();
      rec.mark('jump');
      await rec.run(9);
    },
  },
  arrival: {
    about: 'Alpha Centauri: A and B ahead, flying in from the beacon',
    async run({ page }, rec) {
      await newGame(page);
      await warp(page, 'alpha-centauri');
      await centreMouse(page);
      console.log((await api(page, 'targets')).map((t) => t.id).join(' '));
      await api(page, 'selectTarget', 'star:alpha-centauri-b');
      await look(page, { hud: true });
      await quiet(page);
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(7, async (i, t) => {
        if (i === 20) await page.keyboard.press('Space');
        const k = Math.sin(Math.PI * ease(t / 7));
        await cursor(page, -0.18 * k, -0.04 * k);
      });
      await page.keyboard.up('KeyW');
    },
  },

  // ------------------------------------------------------------------------------------ the map
  map: {
    about: 'The 3D star map: from Sol out to the neighbourhood, turning, then Alpha Centauri picked',
    async run({ page }, rec) {
      await inSol(page);
      await page.keyboard.press('Tab');
      await page.getByTestId('galaxy-map').waitFor();
      await waitUntil(page, 'the map at rest', async () => (await api(page, 'mapView'))?.moving === false, 20_000);
      const v = size(page);
      const view = await api(page, 'mapView');
      const cx = view.origin.x + view.centre.x;
      const cy = view.origin.y + view.centre.y;
      // In close on Sol first (the wheel zooms toward the cursor, held on the middle of the stage).
      await page.mouse.move(cx, cy);
      for (let i = 0; i < 14; i++) await page.mouse.wheel(0, -200);
      await page.waitForTimeout(400);
      console.log('map distance in close', (await api(page, 'mapView')).distance, 'viewport', v);
      await look(page, { hud: true });
      await rec.start();
      await rec.run(0.4);
      // Drag to turn (left button on the stage) while the wheel pulls back.
      await page.mouse.down({ button: 'left' });
      let x = cx;
      let y = cy;
      await rec.run(6.6, async (i, t) => {
        const k = ease(t / 6.6);
        const speed = 1.6 * Math.sin(Math.PI * Math.min(1, t / 6.6)) + 0.35;
        x -= speed;
        y += 0.12 * Math.cos(Math.PI * k);
        await page.mouse.move(x, y);
        // Out to the whole neighbourhood over the first four seconds.
        if (t < 4.2) await page.mouse.wheel(0, 11 * Math.sin(Math.PI * (t / 4.2)) + 2);
      });
      await page.mouse.up({ button: 'left' });
      await press(page, 'map-system-alpha-centauri');
      rec.mark('select Alpha Centauri');
      await rec.run(0.3);
      await page.getByTestId('map-system-alpha-centauri').dblclick();
      rec.mark('centre Alpha Centauri');
      await rec.run(3.2);
    },
  },

  // ----------------------------------------------------------------------------------- fighting
  dogfight: {
    about: 'The raider off Mars (the opening contract’s fight), flown with the mouse on the lead marker',
    async run({ page }, rec) {
      await press(page, 'title-play');
      await press(page, 'intro-ok');
      await press(page, 'accept-lifeline');
      await press(page, 'buy-medical');
      await press(page, 'buy-confirm');
      await press(page, 'dock-launch');
      await waitUntil(page, 'undocked', async () => (await putAway(page), (await api(page, 'player'))?.autopilot === 'none'));
      await centreMouse(page);
      await api(page, 'selectTarget', 'station:mars-depot');
      await api(page, 'setTimeScale', 8);
      await page.keyboard.press('KeyG');
      await waitUntil(page, 'the raider off Mars', async () => (await api(page, 'hud'))?.encounterActive ?? false, 240_000);
      await api(page, 'setTimeScale', 1);
      await look(page, { hud: true });
      await rec.start();
      const hands = gunner(page);
      let fired = 0;
      await rec.run(22, async (i) => {
        const hud = await hands.frame();
        if (hud?.missileLock === 'locked' && i - fired > 150 && hud.missiles > 0) {
          await page.keyboard.press('KeyF');
          rec.mark('seeker');
          fired = i;
        }
        if (hud?.incoming > 0 && i % 90 === 0) {
          await page.keyboard.press('KeyC');
          rec.mark('decoy');
        }
      });
      await hands.release();
    },
  },
  clash: {
    about: 'The clash at the Ross 154 beacon line: Transit Authority and Wake ships, the wing, the pilot in it',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'fit', 'gear.pulse.2.halden');
      await hireWing(page);
      await toBattle(page, 'clash');
      await centreMouse(page);
      const battle = await api(page, 'battle');
      console.log(JSON.stringify(battle.flight.ships));
      const foe = battle.flight.ships.filter((x) => x.side === 'wake' && !x.over).sort((a, b) => a.distance - b.distance)[0];
      await api(page, 'placeNear', { id: `ship:${foe.id}`, distance: 420 });
      await api(page, 'selectTarget', `ship:${foe.id}`);
      await look(page, { hud: true });
      await rec.start();
      await page.keyboard.down('KeyW');
      const hands = gunner(page);
      let fired = -200;
      await rec.run(15, async (i) => {
        const hud = await hands.frame();
        if (hud?.missileLock === 'locked' && i - fired > 180 && hud.missiles > 0) {
          await page.keyboard.press('KeyF');
          rec.mark('seeker');
          fired = i;
        }
        if (hud?.incoming > 0 && i % 90 === 0) {
          await page.keyboard.press('KeyC');
          rec.mark('decoy');
        }
      });
      await hands.release();
      await page.keyboard.up('KeyW');
    },
  },

  assault: {
    about: 'The Wake’s assault on Regent Concourse (Ross 154): the fight at the station',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'fit', 'gear.pulse.2.halden');
      await hireWing(page);
      await toBattle(page, 'assault');
      await centreMouse(page);
      const battle = await api(page, 'battle');
      console.log(JSON.stringify(battle.flight.ships));
      const foe = battle.flight.ships.filter((x) => x.side === 'wake' && !x.over).sort((a, b) => a.distance - b.distance)[0];
      await api(page, 'placeNear', { id: `ship:${foe.id}`, distance: 480 });
      await api(page, 'selectTarget', `ship:${foe.id}`);
      await look(page, { hud: true });
      await rec.start();
      await page.keyboard.down('KeyW');
      const hands = gunner(page);
      let fired = -200;
      await rec.run(14, async (i) => {
        const hud = await hands.frame();
        if (hud?.missileLock === 'locked' && i - fired > 180 && hud.missiles > 0) {
          await page.keyboard.press('KeyF');
          rec.mark('seeker');
          fired = i;
        }
        if (hud?.incoming > 0 && i % 90 === 0) {
          await page.keyboard.press('KeyC');
          rec.mark('decoy');
        }
      });
      await hands.release();
      await page.keyboard.up('KeyW');
    },
  },

  // --------------------------------------------------------------------------------- living it
  race: {
    about: 'The Moon Loop out of Halcyon Ring: the count, then away through the start ring with the field',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'setReputation', 'sta');
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
      await look(page, { hud: true });
      await quiet(page);
      await rec.start();
      await rec.run(0.5);
      await page.keyboard.press('KeyE');
      rec.mark('start');
      // Still in the box through the count, then away with the field, the cursor on the first gate's marker.
      const v = size(page);
      let x = v.width / 2;
      let y = v.height / 2;
      const steer = async () => {
        const hud = await api(page, 'hud');
        const race = hud?.race;
        const gate = race ? hud.markers.find((m) => m.id === `race-gate:${race.gate}`) : null;
        if (gate && race.phase === 'on') {
          const aim = gate.onScreen ? { x: gate.x, y: gate.y } : { x: v.width / 2 + Math.cos(gate.edgeAngle) * v.width * 0.4, y: v.height / 2 + Math.sin(gate.edgeAngle) * v.height * 0.4 };
          x += (aim.x - x) * 0.14;
          y += (aim.y - y) * 0.14;
        }
        await page.mouse.move(x, y);
        return race;
      };
      let away = -1;
      await rec.run(6.2, async (i) => {
        const race = await steer();
        if (race?.phase === 'on' && away < 0) {
          away = i;
          await page.keyboard.down('KeyW');
          rec.mark('go');
        }
        if (away >= 0 && i === away + 40) await page.keyboard.down('ShiftLeft');
      });
      await page.keyboard.up('ShiftLeft');
      await page.keyboard.up('KeyW');
    },
  },
  mining: {
    about: 'The mining laser on a rock in Sol’s main belt',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'fit', 'gear.mining-laser.1.eridani');
      await warp(page, 'sol');
      await centreMouse(page);
      await api(page, 'placeNear', { id: 'belt:sol-main-belt', distance: 0 });
      await waitUntil(page, 'rocks near the ship', async () => ((await api(page, 'mining'))?.rocks.length ?? 0) > 0, 60_000);
      const rock = [...(await api(page, 'mining')).rocks].sort((a, b) => a.distance - b.distance)[0];
      await api(page, 'selectTarget', rock.id);
      await api(page, 'placeNear', { id: rock.id, distance: 260 });
      await waitUntil(page, 'Mine offered', async () => (await putAway(page), (await api(page, 'hud'))?.context?.action === 'mine'), 30_000);
      await look(page, { hud: true });
      await quiet(page);
      await rig(page, { from: { az: 64, el: 9, dist: 60, ahead: 120 }, to: { az: 40, el: 12, dist: 52, ahead: 120 }, seconds: 9 });
      await rec.start();
      await rec.run(0.6);
      await page.keyboard.press('KeyB');
      rec.mark('mine');
      await rec.run(8.4, async (i, t) => {
        await cursor(page, 0.1 * Math.sin(t * 0.9), 0.05 * Math.sin(t * 0.7));
      });
    },
  },
  deck: {
    about: 'Halcyon Ring’s deck: the ship on its pad, Earth through the bay',
    halfRate: true,
    async run({ page }, rec) {
      await newGame(page);
      await dockAt(page, 'earth-port');
      await press(page, 'room-deck');
      await page.waitForTimeout(2_500);
      await look(page, { hud: true });
      await quiet(page);
      await rec.start();
      await rec.run(6);
    },
  },
  bar: {
    about: 'Halcyon Ring’s bar and the people in it',
    halfRate: true,
    async run({ page }, rec) {
      await newGame(page);
      await dockAt(page, 'earth-port');
      await press(page, 'room-bar');
      await page.waitForTimeout(1_500);
      if (await page.getByTestId('window-close').isVisible().catch(() => false)) await press(page, 'window-close');
      await page.waitForTimeout(2_500);
      await look(page, { hud: true });
      await quiet(page);
      await rec.start();
      await rec.run(3);
      await page.getByTestId('station-people').click();
      rec.mark('people');
      await rec.run(3);
    },
  },
  trade: {
    about: 'The trader: buying medical supplies at Halcyon Ring',
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
      await rec.run(1.5);
      await page.getByTestId('buy-medical').click();
      rec.mark('buy dialog');
      await rec.run(1);
      for (let i = 0; i < 6; i++) {
        await page.getByTestId('buy-plus').click();
        rec.mark('plus');
        await rec.run(0.18);
      }
      await rec.run(0.6);
      await page.getByTestId('buy-confirm').click();
      rec.mark('bought');
      await rec.run(2.5);
    },
  },
  outpost: {
    about: 'A station of your own: the outpost chartered at Lalande 21185 b, opened, seen from the ship',
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
      console.log(JSON.stringify((await targets(page)).filter((t) => ['station', 'planet', 'star'].includes(t.kind))));
      await api(page, 'placeNear', { id, distance: 520 });
      await api(page, 'selectTarget', id);
      await api(page, 'face', { id, below: 7 });
      await look(page, { hud: true });
      await quiet(page);
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(7, async (i, t) => {
        await cursor(page, 0.2 * Math.sin((Math.PI * t) / 7), -0.03);
      });
      await page.keyboard.up('KeyW');
    },
  },

  // --------------------------------------------------------------------------------- witnessing
  flare: {
    about: 'Wolf 359 in a strong flare, seen from 9 km',
    async run({ page }, rec) {
      await newGame(page);
      const f = await api(page, 'nextFlare', { systemId: 'wolf-359', kind: 'strong' });
      await api(page, 'advanceClock', f.start + 120 - (await clock(page)));
      await dockAt(page, 'ledger-institute');
      await launch(page);
      await centreMouse(page);
      await api(page, 'placeNear', { id: 'star:wolf-359', distance: 9_000 });
      await api(page, 'selectTarget', 'star:wolf-359');
      await api(page, 'face', { id: 'star:wolf-359', below: 10 });
      console.log('flare', JSON.stringify(await api(page, 'flare')));
      await look(page, { hud: true });
      await quiet(page);
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(7, async (i, t) => {
        await cursor(page, 0.12 * Math.sin((Math.PI * t) / 7), 0);
      });
      await page.keyboard.up('KeyW');
    },
  },
  supernova: {
    about: 'Betelgeuse’s supernova at its peak in Sol’s sky (fiction, and badged so on the HUD)',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'skyFrom', (await clock(page)) - 1_200);
      const sky = await api(page, 'sky');
      console.log('sky', JSON.stringify(sky));
      await api(page, 'advanceClock', sky.timeline.peak + 60 - (await clock(page)));
      await dockAt(page, 'earth-port');
      await launch(page);
      await centreMouse(page);
      await api(page, 'selectTarget', 'sky:betelgeuse');
      await api(page, 'face', { id: 'sky:betelgeuse', below: 9 });
      await look(page, { hud: true });
      await quiet(page);
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(6);
      await page.keyboard.up('KeyW');
    },
  },
  pyre: {
    about: 'Pyre, the invented red supergiant, from its observatory before it dies (badged as fiction)',
    async run({ page }, rec) {
      await newGame(page);
      await api(page, 'skyFrom', 0);
      const sky = await api(page, 'sky');
      await api(page, 'edgeAt', Math.max(await clock(page), sky.timeline.bhGone) + 60);
      const pyre = await api(page, 'pyre');
      console.log('pyre', JSON.stringify(pyre));
      await api(page, 'advanceClock', pyre.timeline.warning + 90 - (await clock(page)));
      await dockAt(page, 'pyre-observatory');
      await launch(page);
      await centreMouse(page);
      await api(page, 'selectTarget', 'star:pyre');
      await api(page, 'face', { id: 'star:pyre', below: 9 });
      await look(page, { hud: true });
      await quiet(page);
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(6, async (i, t) => {
        await cursor(page, -0.15 * Math.sin((Math.PI * t) / 6), 0);
      });
      await page.keyboard.up('KeyW');
    },
  },
  hole: {
    about: 'Hero. The black hole Pyre leaves and its accretion disk, flown toward (badged as fiction)',
    async run({ page }, rec) {
      const id = await atHole(page);
      await api(page, 'placeNear', { id, distance: 17_000 });
      await api(page, 'face', { id, below: 5 });
      await look(page, { hud: true });
      await quiet(page);
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(9, async (i, t) => {
        if (i === 20) await page.keyboard.press('Space');
        await cursor(page, 0.1 * Math.sin((Math.PI * t) / 9), 0.02);
      });
      await page.keyboard.up('KeyW');
    },
  },
  'hole-clean': {
    about: 'The black hole from off the ship’s quarter, HUD hidden (an alternate hero)',
    async run({ page }, rec) {
      const id = await atHole(page);
      await api(page, 'placeNear', { id, distance: 15_000 });
      await api(page, 'face', { id, below: 3 });
      await look(page, { hud: false });
      await rig(page, { from: { az: -32, el: 6, dist: 36, ahead: 50, side: 8 }, to: { az: -16, el: 8, dist: 30, ahead: 50, side: 8 }, seconds: 9 });
      await rec.start();
      await page.keyboard.down('KeyW');
      await rec.run(9, async (i) => {
        if (i === 20) await page.keyboard.press('Space');
      });
      await page.keyboard.up('KeyW');
    },
  },
};

void place;
