import { siteOfStation } from '../../content/outposts/sites.ts';
import { saveLocations, saveLocationsKey } from '../../data/systems.ts';
import type { SystemId } from '../../data/types.ts';
import type { SceneStationDef, SystemSceneDef } from '../sceneTypes.ts';
import { siteDock } from '../siteDock.ts';
import { ALPHA_CENTAURI_SCENE } from './alphaCentauri.ts';
import { BARNARD_SCENE } from './barnard.ts';
import { catalogSceneDef } from './generated.ts';
import { EPSILON_ERIDANI_SCENE } from './epsilonEridani.ts';
import { PYRE_ALIVE_SCENE, PYRE_GONE_SCENE } from './pyre.ts';
import { pyreStage } from '../../economy/doomed.ts';
import { SIRIUS_SCENE } from './sirius.ts';
import { SOL_SCENE, solScene } from './sol.ts';

/** The hand-made scenes. */
export const SCENE_DEFS: Record<SystemId, SystemSceneDef> = {
  sol: SOL_SCENE,
  'alpha-centauri': ALPHA_CENTAURI_SCENE,
  barnard: BARNARD_SCENE,
  sirius: SIRIUS_SCENE,
  'epsilon-eridani': EPSILON_ERIDANI_SCENE,
  // Pyre, the one invented star (docs/PROCGEN.md §26).
  pyre: PYRE_ALIVE_SCENE,
};

/**
 * The scene of any system: hand-made for the five originals, generated for the catalogue systems.
 * `jd` is the game date (a Julian date): Sol's planets then sit where they really are. `clock` is
 * the game clock: Pyre's scene is its black hole once the star has gone (docs/PROCGEN.md §26).
 */
export function sceneDefFor(systemId: SystemId, jd: number | null = null, clock: number | null = null): SystemSceneDef {
  if (systemId === PYRE_ALIVE_SCENE.systemId) return clock !== null && pyreStage(clock) === 'gone' ? PYRE_GONE_SCENE : PYRE_ALIVE_SCENE;
  const def = systemId === 'sol' && jd !== null ? solScene(jd) : (SCENE_DEFS[systemId] ?? catalogSceneDef(systemId));
  return withOwnStations(def);
}

const withOwn = new WeakMap<SystemSceneDef, { key: string; def: SystemSceneDef }>();

/**
 * A scene with the save's own stations in it (the player's outposts, docs/PROCGEN.md §22, §36):
 * each where its site stands (world/siteDock.ts).
 */
function withOwnStations(def: SystemSceneDef): SystemSceneDef {
  const own = saveLocations(def.systemId);
  if (!own.length) return def;
  const key = saveLocationsKey();
  const hit = withOwn.get(def);
  if (hit?.key === key) return hit.def;
  const stations = own.flatMap((l): SceneStationDef[] => {
    const site = siteOfStation(l.id);
    const dock = site ? siteDock(def, site) : null;
    if (!dock || !l.look) return [];
    return [{ locationId: l.id, kind: 'proxima-outpost', look: l.look, ...dock }];
  });
  const out = { ...def, stations: [...def.stations, ...stations] };
  withOwn.set(def, { key, def: out });
  return out;
}
