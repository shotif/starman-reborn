import { OBSERVE_LINES, SKY_COMMS, SKY_NEWS } from '../content/stellar/lines.ts';
import { STELLAR } from '../content/stellar/rules.ts';
import type { Issue } from '../content/validate.ts';
import { ALL_LOCATIONS, FAR_STARS, SYSTEMS } from '../data/systems.ts';
import { MAX_REWARD } from './contractGuards.ts';
import { farStar, peakMagnitude, skyDirection } from './stellar.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export type StellarRules = typeof STELLAR;

/** The full Moon's apparent magnitude, and Sirius's, the brightest star in Earth's night sky. */
const FULL_MOON = -12.7;
const SIRIUS = -1.46;

/**
 * Stellar death guardrails (docs/PROCGEN.md §25.6): the timeline runs forward; the dying stars are
 * far stars of the catalogue; the supernova, from a typical peak and the star's real distance,
 * outshines every star yet stays fainter than the full Moon, and fades to a remnant still in view;
 * Antares goes out; a parallax baseline the map can give shifts the star by at least a degree; the
 * rewards and prices make sense; research stations exist to post the work; every direction in the
 * sky is a unit vector within the parallax the map allows; and no line holds a number of its own.
 */
export function validateStellar(rules: StellarRules = STELLAR): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const S = rules.supernova;
  const B = rules.blackHole;

  // The timeline.
  if (!(rules.alertAfterOpening > 0 && rules.alertAfterLoad > 0)) report('rules', 'alert', 'an alert that does not come after the opening');
  if (![S.lightAfterAlert, S.rise, S.plateau, S.fade, B.lightAfterAlert, B.hold, B.fade].every((t) => t > 0)) report('rules', 'timeline', 'a stretch of the timeline that is not positive');
  if (!(B.alertAfterSupernova > S.rise + S.plateau)) report('rules', 'blackHole', 'Antares stirs before the supernova is past its peak');

  // The stars and how bright they get.
  const sn = farStar(S.star);
  const bh = farStar(B.star);
  if (!sn || !bh || (S.star as string) === (B.star as string)) report('stars', `${S.star}/${B.star}`, 'not two different far stars of the catalogue');
  if (sn) {
    const peak = rules.supernova.peakAbsoluteMagnitude + 5 * Math.log10(1000 / sn.parallaxMas / 10);
    if (!(peak < SIRIUS && peak > FULL_MOON)) report('brightness', sn.id, `a peak of magnitude ${peak.toFixed(1)}: not brighter than every star and fainter than the full Moon`);
    if (!(peak < sn.magnitudeV)) report('brightness', sn.id, 'a supernova fainter than the star was');
    if (!(S.remnantMagnitude > peak + 0.5 && S.remnantMagnitude < rules.nakedEye)) report('brightness', sn.id, 'a remnant brighter than the plateau, or out of sight');
    // A parallax the map can give: two systems that far apart, and a shift of at least a degree.
    const shift = (rules.observe.baselineLy / sn.distanceLightYears) * (180 / Math.PI);
    const widest = Math.max(...SYSTEMS.map((a) => Math.max(...SYSTEMS.map((b) => Math.hypot(a.positionLy[0] - b.positionLy[0], a.positionLy[1] - b.positionLy[1], a.positionLy[2] - b.positionLy[2])))));
    if (!(shift >= 1) || !(rules.observe.baselineLy <= widest / 2)) report('observe', 'baselineLy', `a baseline of ${rules.observe.baselineLy} ly: a shift of ${shift.toFixed(2)}°, or too wide for the map`);
    if (rules === STELLAR && Math.abs(peakMagnitude(sn) - peak) > 1e-9) report('brightness', sn.id, 'the game reckons the peak differently from the rules');
  }
  if (bh && !(B.brighten > 0 && B.brighten < 3)) report('brightness', bh.id, 'a failed supernova that does not brighten a little');

  // Rewards, prices, and who posts the work.
  if (Object.values(rules.observe.reward).some((r) => !(r > 0 && r <= MAX_REWARD))) report('observe', 'reward', `a reward that is not positive, or above the ${MAX_REWARD} any contract may pay`);
  if (!(rules.market.price > 1 && rules.market.price <= 2) || !rules.market.goods.length) report('market', 'price', 'a price effect out of 1–2, or on no goods');
  if (ALL_LOCATIONS.filter((l) => l.stationType === 'research-station' && l.status === 'functional').length < 3) report('observe', 'stations', 'fewer than three research stations to post the work');

  // The sky: unit directions, from every system within the parallax the map allows.
  for (const f of FAR_STARS.stars) {
    const fromSol = skyDirection('sol', f.id);
    for (const sys of SYSTEMS) {
      const d = skyDirection(sys.id, f.id);
      if (Math.abs(Math.hypot(...d) - 1) > 1e-9) report('sky', `${sys.id}/${f.id}`, 'not a unit direction');
      const angle = Math.acos(Math.min(1, fromSol[0] * d[0] + fromSol[1] * d[1] + fromSol[2] * d[2]));
      const bound = Math.asin(Math.min(1, Math.hypot(...sys.positionLy) / f.distanceLightYears)) + 1e-6;
      if (angle > bound) report('sky', `${sys.id}/${f.id}`, `${((angle * 180) / Math.PI).toFixed(2)}° from Sol's direction: more than its parallax allows`);
    }
  }

  // The lines: no digits; placeholders the line can fill.
  const check = (subject: string, text: string, allowed: readonly string[]) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
  };
  const news = ['star', 'designation', 'distance', 'years', 'peak'];
  for (const [kind, n] of Object.entries(SKY_NEWS)) {
    check(`news.${kind}`, n.headline, news);
    check(`news.${kind}`, n.detail, news);
  }
  for (const [kind, line] of Object.entries(SKY_COMMS)) check(`comms.${kind}`, line, ['star']);
  for (const [kind, l] of Object.entries(OBSERVE_LINES)) {
    check(`observe.${kind}`, l.title, ['star']);
    check(`observe.${kind}`, l.briefing, ['star', 'distance', 'baseline', 'shift']);
  }
  return issues;
}
