import type { SystemId } from '../../data/types.ts';
import type { SystemSceneDef } from '../sceneTypes.ts';
import { ALPHA_CENTAURI_SCENE } from './alphaCentauri.ts';
import { BARNARD_SCENE } from './barnard.ts';
import { catalogSceneDef } from './generated.ts';
import { EPSILON_ERIDANI_SCENE } from './epsilonEridani.ts';
import { SIRIUS_SCENE } from './sirius.ts';
import { SOL_SCENE } from './sol.ts';

/** The hand-made scenes. */
export const SCENE_DEFS: Record<SystemId, SystemSceneDef> = {
  sol: SOL_SCENE,
  'alpha-centauri': ALPHA_CENTAURI_SCENE,
  barnard: BARNARD_SCENE,
  sirius: SIRIUS_SCENE,
  'epsilon-eridani': EPSILON_ERIDANI_SCENE,
};

/** The scene of any system: hand-made for the five originals, generated for the catalogue systems. */
export function sceneDefFor(systemId: SystemId): SystemSceneDef {
  return SCENE_DEFS[systemId] ?? catalogSceneDef(systemId);
}
