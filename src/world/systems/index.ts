import type { SystemId } from '../../data/types.ts';
import type { SystemSceneDef } from '../sceneTypes.ts';
import { ALPHA_CENTAURI_SCENE } from './alphaCentauri.ts';
import { BARNARD_SCENE } from './barnard.ts';
import { EPSILON_ERIDANI_SCENE } from './epsilonEridani.ts';
import { SIRIUS_SCENE } from './sirius.ts';
import { SOL_SCENE } from './sol.ts';

export const SCENE_DEFS: Record<SystemId, SystemSceneDef> = {
  sol: SOL_SCENE,
  'alpha-centauri': ALPHA_CENTAURI_SCENE,
  barnard: BARNARD_SCENE,
  sirius: SIRIUS_SCENE,
  'epsilon-eridani': EPSILON_ERIDANI_SCENE,
};
