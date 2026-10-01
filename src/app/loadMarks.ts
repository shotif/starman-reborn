/**
 * Marks the loading title and the title leave in the browser's performance timeline, for the
 * device report (src/app/deviceReport.ts). Kept apart so the first screen's script stays small.
 */
export const LOAD_MARKS = { firstScreen: 'starman:first-screen', title: 'starman:title' } as const;
