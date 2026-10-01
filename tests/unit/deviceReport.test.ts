import { describe, expect, it } from 'vitest';
import { formatReport, FrameRateLog, shortName, type DeviceFacts } from '../../src/app/deviceReport.ts';

/**
 * The device report in Settings (docs/TEST_RECORD.md, the real-device checklist): the frame rate
 * of a flight, and the plain text a tester copies.
 */

const PHONE: DeviceFacts = {
  build: 'abc1234',
  taken: new Date(2026, 9, 1, 9, 5),
  browser: 'Mozilla/5.0 (Linux; Android 14) Chrome/129.0 Mobile Safari/537.36',
  screen: { width: 412, height: 915, ratio: 2.625 },
  window: { width: 412, height: 839 },
  visible: { width: 412, height: 520 },
  safeArea: { top: 24, right: 0, bottom: 16, left: 0 },
  input: { touchPoints: 5, coarse: true, hover: false, gamepads: 0 },
  graphics: { webgl2: true, gpu: 'ANGLE (Qualcomm, Adreno (TM) 730, OpenGL ES 3.2)', maxTexture: 4096 },
  quality: { setting: 'auto', preset: 'medium', pixelRatio: 1.75, bloom: false },
  frameRate: { average: 51.6, slowest: 37.8, seconds: 192.4 },
  load: { firstScreen: 0.62, title: 3.94, downloadedKB: 690.4, viaWorker: false },
  network: { type: '4g', downlink: 9.5 },
  offline: { kind: 'kept', kept: 15, of: 15, missing: [] },
  sound: { state: 'on', muted: false },
  textScale: 1,
  reducedMotion: false,
};

describe('device report: frame rate over a flight', () => {
  it('averages the flight and finds its slowest second', () => {
    const log = new FrameRateLog();
    log.start();
    for (let i = 0; i < 120; i++) log.frame(1 / 60); // two seconds at 60 fps
    for (let i = 0; i < 30; i++) log.frame(1 / 30); // a second at 30
    const s = log.summary()!;
    expect(s.seconds).toBeCloseTo(3, 5);
    expect(s.average).toBeCloseTo(150 / 3, 5);
    expect(s.slowest).toBeCloseTo(30, 5);
  });

  it('says nothing before a second of flight, leaves out pauses and starts again at each flight', () => {
    const log = new FrameRateLog();
    log.start();
    for (let i = 0; i < 30; i++) log.frame(1 / 60);
    expect(log.summary()).toBeNull();
    // Another app in front for a minute is not one very slow frame.
    log.frame(60);
    log.frame(0);
    expect(log.summary()).toBeNull();
    for (let i = 0; i < 60; i++) log.frame(1 / 60);
    expect(log.summary()!.average).toBeCloseTo(60, 5);
    log.start();
    expect(log.summary()).toBeNull();
  });
});

describe('device report: the text', () => {
  it('lists the device, the load, the frame rate and offline play, one fact a line', () => {
    expect(formatReport(PHONE)).toBe(
      [
        'Starman Reborn device report',
        'Build: abc1234',
        'Taken: 2026-10-01 09:05 (local time)',
        'Browser: Mozilla/5.0 (Linux; Android 14) Chrome/129.0 Mobile Safari/537.36',
        'Screen: 412 × 915 at pixel ratio 2.63, portrait',
        'Window: 412 × 839; visible 412 × 520',
        'Safe areas: top 24, right 0, bottom 16, left 0',
        'Input: touch (5 points), finger-sized pointer, no hover, no gamepad',
        'Graphics: WebGL 2, ANGLE (Qualcomm, Adreno (TM) 730, OpenGL ES 3.2); textures up to 4096 px',
        'Quality: Auto (now Medium), pixel ratio 1.75, bloom off',
        'Frame rate, last flight: 52 fps on average, 38 in the slowest second (3 min 12 s)',
        'Load: title showed at 0.6 s, Play at 3.9 s after opening the page; 690 KB downloaded',
        'Network: 4g, about 9.5 Mbit/s',
        'Offline play: ready: all 15 files kept',
        'Sound: on',
        'Text size 100%, reduced motion off',
      ].join('\n'),
    );
  });

  it('says plainly what is missing or not yet done', () => {
    const text = formatReport({
      ...PHONE,
      screen: { width: 1440, height: 900, ratio: 1 },
      visible: null,
      input: { touchPoints: 0, coarse: false, hover: true, gamepads: 2 },
      graphics: null,
      quality: { setting: 'high', preset: 'high', pixelRatio: 1, bloom: true },
      frameRate: null,
      load: { firstScreen: null, title: null, downloadedKB: 0, viaWorker: false },
      network: null,
      offline: { kind: 'kept', kept: 13, of: 15, missing: ['boot.js', 'saira-condensed-latin-600-normal.woff2'] },
      sound: { state: 'waiting for a first tap or key press', muted: true },
      textScale: 1.25,
      reducedMotion: true,
    });
    expect(text).toContain('Screen: 1440 × 900 at pixel ratio 1, landscape');
    expect(text).toContain('Window: 412 × 839\n');
    expect(text).toContain('Input: no touch, fine pointer, hover, 2 gamepads');
    expect(formatReport({ ...PHONE, input: { touchPoints: 1, coarse: true, hover: false, gamepads: 1 } })).toContain('Input: touch (1 point), finger-sized pointer, no hover, 1 gamepad');
    expect(text).toContain('Graphics: not available');
    expect(text).toContain('Quality: High, pixel ratio 1, bloom on');
    expect(text).toContain('Frame rate, last flight: no flight yet');
    expect(text).toContain('Load: not measured; all from the browser’s cache');
    expect(text).toContain('Network: not reported by this browser');
    expect(text).toContain('Offline play: 13 of 15 files kept so far (not yet: boot.js, saira-condensed-latin-600-normal.woff2)');
    expect(text).toContain('Sound: waiting for a first tap or key press, muted');
    expect(text).toContain('Text size 125%, reduced motion on');
  });

  it('does not guess download sizes the service worker hides', () => {
    const line = formatReport({ ...PHONE, load: { firstScreen: 0.7, title: 1.4, downloadedKB: null, viaWorker: true } })
      .split('\n')
      .find((l) => l.startsWith('Load'));
    expect(line).toBe('Load: title showed at 0.7 s, Play at 1.4 s after opening the page; the offline copy handed over the files, so their download size is not known');
  });

  it('names build files without their content hash', () => {
    expect(shortName('./assets/boot-CCQjQR63.js')).toBe('boot.js');
    expect(shortName('./assets/GalaxyMapView-C2uyinKQ.css')).toBe('GalaxyMapView.css');
    expect(shortName('./assets/saira-semi-condensed-latin-400-normal-DBFPQfhT.woff2')).toBe('saira-semi-condensed-latin-400-normal.woff2');
    expect(shortName('./assets/encyclopedia-Bk09aQ9-.js')).toBe('encyclopedia.js');
  });

  it('explains why the game is not kept for offline play', () => {
    const line = (offline: DeviceFacts['offline']) => formatReport({ ...PHONE, offline }).split('\n').find((l) => l.startsWith('Offline play'));
    expect(line({ kind: 'unsupported' })).toBe('Offline play: not possible in this browser (no service workers)');
    expect(line({ kind: 'tests' })).toBe('Offline play: off in test runs');
    expect(line({ kind: 'insecure' })).toBe('Offline play: needs the site over HTTPS');
    expect(line({ kind: 'not-yet' })).toBe('Offline play: not kept yet (it starts once the game has loaded)');
  });
});
