/**
 * Marks the loading title and the title leave in the browser's performance timeline, for the
 * device report (src/app/deviceReport.ts). Kept apart so the first screen's script stays small.
 * `code` and `sky` mark when the game's code has started and when Sol's sky is in (docs/PROCGEN.md
 * §50), for the load test (tests/e2e/load.spec.ts).
 */
export const LOAD_MARKS = { firstScreen: 'starman:first-screen', title: 'starman:title', code: 'starman:game-code', sky: 'starman:sky' } as const;
