/**
 * Dev-only harness for the touch flight HUD (dev/hud.html). Not bundled into the production build.
 * Lays the HUD and the touch controls over a painted backdrop as a phone or tablet shows them, so
 * the clear centre (docs/PROCGEN.md §52) can be judged at any size without flying.
 *
 * Query parameters:
 *   scene=flight|encounter|fight|hail|moon|race   what the HUD shows       swap=1      left-handed layout
 *   box=1                               outline the clear centre       wing=1      a wing flies along
 *   textScale=1.3                       --text-scale                   count=3     a race's countdown
 *
 * `window.__layout()` lists the boxes of everything that stays on screen, and what reaches into the
 * clear centre.
 */
import '../ui/styles/base.css';
import { setToastRoot, toast, commToast } from '../ui/components.ts';
import { h } from '../ui/dom.ts';
import { Hud, type HudStatus } from '../ui/hud/Hud.ts';
import { emptyHudModel, type HudMarker, type HudModel } from '../ui/hud/hudModel.ts';
import { clearCentre, intrusions, type Box } from '../ui/touch/clearCentre.ts';
import { TouchControls } from '../ui/touch/TouchControls.ts';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'flight';
const textScale = params.get('textScale');
if (textScale) document.documentElement.style.setProperty('--text-scale', textScale);

const ui = document.getElementById('ui')!;
// A starfield, and the ship where the chase camera draws it: below the centre.
document.body.style.background =
  'radial-gradient(ellipse at 50% 40%, #1b2a4a 0%, transparent 55%), radial-gradient(circle at 20% 70%, #2a1a3a 0%, transparent 40%), #04060b';
const ship = h('div', {
  style:
    'position:absolute;left:50%;top:64%;width:min(52vw,320px);height:min(9vh,70px);transform:translate(-50%,-50%);background:linear-gradient(90deg,transparent,#5a6b8c 30%,#c8d4e8 50%,#5a6b8c 70%,transparent);clip-path:polygon(0 70%,40% 20%,50% 0,60% 20%,100% 70%,60% 100%,40% 100%);opacity:0.8',
});
ui.appendChild(ship);

const noop = () => {};
const hud = new Hud(ui, { onMap: noop, onPause: noop, onHelp: noop, onAvoidCombat: noop, onContextAction: noop, onSelectMarker: noop, onCommand: noop });
const touch = new TouchControls(ui, { onAction: noop, onAimAssistCycle: noop, onAvoidCombat: noop, onActivity: noop });
hud.setScheme('touch');
hud.setVisible(true);
touch.setVisible(true);
touch.setSwapSides(params.get('swap') === '1');
touch.setAimAssist('low');
touch.setCounts(4, 1, 2);
touch.setThrottle(0.35);
setToastRoot(hud.toastSlot);

const W = () => window.innerWidth;
const H = () => window.innerHeight;
const marker = (id: string, name: string, kind: HudMarker['kind'], fx: number, fy: number, distance: number, extra: Partial<HudMarker> = {}): HudMarker => ({
  id,
  name,
  kind,
  x: W() * fx,
  y: H() * fy,
  onScreen: true,
  edgeAngle: 0,
  distance,
  hostile: false,
  selected: false,
  objective: false,
  dataClass: 'fictional',
  ...extra,
});

function model(): { model: HudModel; status: HudStatus } {
  const m = emptyHudModel();
  m.speed = 41;
  m.throttle = 0.35;
  m.shield = 1;
  m.hull = 1;
  m.shieldValue = 60;
  m.hullValue = 100;
  m.energy = 0.9;
  m.weapon = 'Pulse cannon';
  m.missiles = 4;
  m.launcher = 'Seekers';
  m.repairKits = 1;
  m.decoys = 2;
  m.reticle = { x: W() / 2, y: H() / 2, inArc: true, assisted: false };
  m.nearestDock = { name: 'Halcyon Ring', distance: 196 };
  const status: HudStatus = {
    credits: 17_803,
    cargoUsed: 6,
    cargoCapacity: 20,
    objective: 'Dock at Deimos Depot (Mars) for departure clearance',
    systemName: 'Sol',
    scaleNote: '',
  };
  if (scene === 'flight') {
    m.context = { label: 'Go to', action: 'goto', icon: 'goto' };
    m.target = { id: 'station:deimos-depot', name: 'Deimos Depot', kind: 'station', subtitle: 'Depot · fictional location', distance: 55_100, hostile: false, faction: 'sta', dataClass: 'fictional', lead: null, inGunRange: false };
    m.markers = [
      marker('station:deimos-depot', 'Deimos Depot', 'station', 0.52, 0.47, 55_100, { selected: true, objective: true, faction: 'sta' }),
      marker('planet:jupiter', 'Jupiter', 'planet', 0.12, 0.47, 600_000, { dataClass: 'observed' }),
      marker('comet:9p', '9P/Tempel 1', 'comet', 0.3, 0.4, 95_500, { dataClass: 'observed' }),
      marker('drone:0', 'Practice drone', 'drone', 0.6, 0.3, 850),
    ];
  } else if (scene === 'moon') {
    status.objective = 'Rhea Castell at Halcyon Ring (Sol) has work for you: “Clean Manifests”.';
    m.context = { label: 'Scan', action: 'scan', icon: 'scan' };
    m.target = { id: 'planet:moon', name: 'Moon', kind: 'planet', subtitle: 'Earth’s natural satellite · real direction and phase; schematic size and distance', distance: 1_800, hostile: false, dataClass: 'observed', lead: null, inGunRange: false };
    m.markers = [marker('planet:moon', 'Moon', 'planet', 0.5, 0.36, 1_800, { selected: true, dataClass: 'observed' })];
  } else if (scene === 'fight') {
    m.context = { label: 'Dock', action: 'interact', icon: 'dock' };
    m.target = { id: 'ship:raider-1', name: 'Wake Cinder', kind: 'ship', subtitle: 'Raider · Hollow Wake', distance: 640, hostile: true, dataClass: 'fictional', shield: 0.4, hull: 0.8, lead: { x: W() * 0.55, y: H() * 0.44 }, inGunRange: true };
    m.markers = [
      marker('ship:raider-1', 'Wake Cinder', 'ship', 0.54, 0.45, 640, { selected: true, hostile: true }),
      marker('ship:raider-2', 'Wake Ember', 'ship', 0.7, 0.55, 1_200, { hostile: true }),
    ];
    m.warnings = ['Hostile contact'];
    m.encounterActive = true;
    m.battle = { title: 'Clash at the Ross 154 beacon line', law: 3, wake: 4, side: 'law', lawName: 'Transit Authority' };
  } else if (scene === 'encounter') {
    m.context = { label: 'Go to', action: 'goto', icon: 'goto' };
    m.target = { id: 'ship:raider-1', name: 'Wake Cinder', kind: 'ship', subtitle: 'Raider · Hollow Wake', distance: 2_400, hostile: true, dataClass: 'fictional', shield: 1, hull: 1, lead: null, inGunRange: false };
    m.markers = [marker('ship:raider-1', 'Wake Cinder', 'ship', 0.56, 0.43, 2_400, { selected: true, hostile: true })];
    m.warnings = ['Hostile contact'];
    m.encounterActive = true;
  } else if (scene === 'hail') {
    m.context = { label: 'Answer', action: 'answer', icon: 'info' };
    m.hail = { from: 'Mayday', text: 'Mayday, mayday: the Shelduck, drive failing, life support on reserve. Anyone on this channel?', left: 45, held: false, tone: 'comms' };
    m.target = { id: 'station:shindig', name: 'Shindig Bazaar', kind: 'station', subtitle: 'Bazaar · fictional location', distance: 9_300, hostile: false, dataClass: 'fictional', lead: null, inGunRange: false };
    m.markers = [marker('station:shindig', 'Shindig Bazaar', 'station', 0.5, 0.46, 9_300, { selected: true })];
  } else if (scene === 'race') {
    m.context = { label: 'Start', action: 'interact', icon: 'play' };
    m.race = params.get('count')
      ? { name: 'Moon Loop', phase: 'countdown', gate: 0, gates: 8, time: 0, split: null, count: params.get('count'), place: 1, of: 4, sealedCruise: false }
      : { name: 'Moon Loop', phase: 'on', gate: 3, gates: 8, time: 42.3, split: -1.2, count: null, place: 2, of: 4, sealedCruise: false };
    m.target = { id: 'gate:3', name: 'Gate 4', kind: 'gate', subtitle: 'Moon Loop · gate 4 of 8', distance: 2_400, hostile: false, dataClass: 'fictional', lead: null, inGunRange: false };
    m.markers = [marker('gate:3', 'Gate 4', 'gate', 0.48, 0.42, 2_400, { selected: true })];
  }
  if (params.get('wing') === '1' || scene === 'fight') m.wing = { count: 2, order: 'free', hurt: 0 };
  return { model: m, status };
}

function draw(): void {
  const { model: m, status } = model();
  hud.update(m, status);
  hud.setEncounterBanner(scene === 'encounter');
  touch.setEncounter(scene === 'encounter');
  touch.setContextAction(m.context?.label ?? null, m.context?.action ?? null, m.context?.icon);
  touch.setWing(m.wing);
  drawBox();
}

const boxEl = h('div', { style: 'position:absolute;border:1px dashed rgba(255,80,80,0.9);pointer-events:none;z-index:50' });
if (params.get('box') === '1') document.body.appendChild(boxEl);
function drawBox(): void {
  const b = clearCentre(W(), H());
  Object.assign(boxEl.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.right - b.left}px`, height: `${b.bottom - b.top}px` });
}

/** What stays on screen in touch flight (src/ui/touch/clearCentre.ts). */
export const STEADY = '.hud-status, .hud-wallet, .hud-buttons, .hud-objective, .hud-race, .hud-battle, .hud-target, .tbtn, .throttle, .assist-chip, .wing-chip, .zone-hint';

/** The HUD's buttons that a touch at their middle would not reach (the touch controls lie over them). */
function covered(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.hud button:not(.marker)')]
    .filter((el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden')
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit?.closest('[data-testid="touch-controls"]');
    })
    .map((el) => el.getAttribute('data-testid') ?? el.textContent ?? '?');
}

function layout(): { box: Box; items: { name: string; box: Box }[]; into: string[]; covered: string[] } {
  const items = [...document.querySelectorAll(STEADY)]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    })
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { name: (el.getAttribute('data-testid') ?? el.className).toString().slice(0, 40), box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
    });
  const box = clearCentre(W(), H());
  return { box, items, into: intrusions(box, items), covered: covered() };
}
(window as unknown as { __layout: typeof layout }).__layout = layout;

draw();
if (scene === 'hail') {
  toast('Docking clearance for Shindig Bazaar: ask on approach.', 'info', 600_000);
  commToast('Shindig Bazaar', 'Traffic is light today, pilot.', 600_000);
}
window.addEventListener('resize', draw);
