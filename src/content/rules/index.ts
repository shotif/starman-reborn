import type { ContentRules } from '../types.ts';
import { BALANCE, FLIGHT_LIMITS } from './balance.ts';
import { GEAR_FAMILIES } from './gearFamilies.ts';
import { MANUFACTURERS } from './manufacturers.ts';
import { SHIP_CLASSES } from './shipClasses.ts';
import { SHOPS } from './shops.ts';

/** Every rule the catalogue is generated from. */
export const RULES: ContentRules = {
  makers: MANUFACTURERS,
  classes: SHIP_CLASSES,
  families: GEAR_FAMILIES,
  shops: SHOPS,
  balance: BALANCE,
  limits: FLIGHT_LIMITS,
};

/** Fixed seed of the ship and equipment catalogue: every player sees the same catalogue. */
export const CATALOG_SEED = 0x57a2_2e0b;

/** The starting ship (its stock loadout is the original player ship). */
export const STARTER_SHIP_ID = 'ship.courier.1.halden';
