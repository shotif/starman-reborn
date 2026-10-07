import { BORDER } from '../content/border/rules.ts';
import { atWar, borderNews, occupied, pushFront, recordDeed } from '../economy/border.ts';
import { battlesDue, battlesSeen, settleBattle } from '../economy/battles.ts';
import type { BattleKind } from '../content/border/battles.ts';
import { gameJulianDate } from '../data/solar.ts';
import type { Lingering } from './state.ts';
import { TRAFFIC } from '../world/traffic/plan.ts';
import { leaveMark, markSettledFronts, raidKill, settleFront, storyMark } from '../economy/answers.ts';
import { useWorldLog } from '../economy/events.ts';
import { captainLost, captainSeen, fleetNews, folkUpTo, haulEstimate, haulGoods, hireHauler, settleFleet, type FleetSettlement } from '../economy/fleet.ts';
import { folkPeople, nextAskAt, scanFolk, spiritAt } from '../economy/folk.ts';
import { WORK_WORDS } from '../content/outposts/folk.ts';
import { LIFEBOAT_LINES } from '../content/story/embers.ts';
import { showFolkWords } from '../ui/station/folk.ts';
import { lastView } from '../ui/station/lastView.ts';
import { fill, PAYMENT } from '../content/people/lines.ts';
import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine.ts';
import type { MusicMood, SfxId } from '../audio/types.ts';
import { ALL_LOCATIONS, getComponent, getLocation, getPlanet, getSystem, hasProvisionalData, isInventedSystem, MAP_SYSTEMS, PYRE_ID, saveLocationsKey, SYSTEMS, WORLD } from '../data/systems.ts';
import { answerLane, laneEncounter, laneOfferFor, laneSlot, lapseLane, type LaneOffer } from '../economy/lanes.ts';
import { LANE_KINDS, type LaneKind } from '../content/lanes/rules.ts';
import { showLaneCard } from '../ui/lanes.ts';
import {
  boardSite,
  chooseEnding,
  clearSite,
  findOnScan,
  followLead,
  loseSite,
  mysteryPlaces,
  mysteryUnderWay,
  nearSite,
  reachSite,
  scanFind,
  scanSite,
  scanSlot,
  settleSites,
  siteSetup,
  sitesIn,
  springSite,
  takeSitePod,
  type SiteCard,
  type SiteOutcome,
} from '../economy/wrecks.ts';
import { WRECKS, type SiteKind } from '../content/wrecks/rules.ts';
import { showSiteCard } from '../ui/wrecks.ts';
import { activeLimit, coveredAt, earnedRank, heldRank, RANK_FACTIONS, type RankNote } from '../economy/ranks.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import { showPromotion } from '../ui/ranks.ts';
import { edgeComm, edgeMoment, edgeTimeline, hopsToPyre, laneClosedReason, PYRE_HOLE_ID, pyreRefugeId, pyreStage, pyreStationsNow, pyreStatus, scheduleEdge } from '../economy/doomed.ts';
import type { EdgeNewsKind } from '../content/stellar/doomedLines.ts';
import type { SystemId } from '../data/types.ts';
import { addCargo, cargoUsed, itemsThatFit } from '../economy/cargo.ts';
import { COMMODITIES } from '../economy/commodities.ts';
import { getCatalog, shipModel } from '../content/catalog.ts';
import { hashString, rng } from '../content/random.ts';
import { cargoCapacity, newShipState, performanceOf } from '../economy/loadout.ts';
import { carriesPassengers, frighten, passengerFright, passengerGoodbye, passengerJobs, seeSight, sightseersArrive, sightsIn } from '../economy/passengers.ts';
import { claimFor, holdsOf, metRival, nextRun, rivalById, rivalDestroyed, rivalHello, rivalKnockedOut, rivalName, rivalShot, rivalWhere, shift, standingWith, turnOf } from '../economy/rivals.ts';
import { allyLost, ambushIn, duelIn, duelLost, duelStarted, duelWon, settleRivalStories, spendAmbush, spendTipoff, storyOffer, storyStatus, tipoffIn, tippedPatrols, type StoryNote } from '../economy/rivalStories.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { crewAboard, crewEffects, crewOffers, hurtCrew, settleFavours, type CrewNote } from '../economy/crew.ts';
import { crewDeed } from '../economy/crewDeeds.ts';
import type { CrewDeed, CrewHeart, CrewRole } from '../content/crew/rules.ts';
import { STORY, STORY_NOTES } from '../content/rivals/storyLines.ts';
import { defenceOf, foughtPlan, nextRaid, outpostSystem, raidNote, raidWarning, settleRaid, turretsUp } from '../economy/outpostRaids.ts';
import { incomeAt, outpostAt, outpostIn, outpostsOf } from '../economy/outposts.ts';
import { nextHauler } from '../economy/outpostTrade.ts';
import { RAID_WATCH } from '../content/outposts/raidLines.ts';
import { outpostId } from '../content/outposts/sites.ts';
import { farStar, farStarLook, recordObservation, scheduleSky, skyComm, skyMoment, skyTimeline } from '../economy/stellar.ts';
import { flareStar, flareStatus, flaresBetween, flareSystems } from '../economy/flares.ts';
import { ORBIT_EPOCH_JD, orbitOf } from '../data/orbits.ts';
import { measureOffer } from '../economy/binaries.ts';
import { asteroidOf } from '../data/asteroids.ts';
import { cometOf } from '../data/comets.ts';
import { imageOffer } from '../economy/comets.ts';
import { trackOffer, useGameStart } from '../economy/asteroids.ts';
import { craftOf } from '../data/spacecraft.ts';
import { logWrite, noteAsteroid, noteComet, noteCraft, noteJump, notePaid, notePeak } from '../economy/logbook.ts';
import { openLogbook } from '../ui/logbook.ts';
import type { SkyNewsKind } from '../content/stellar/lines.ts';
import { ROSTER } from '../content/rivals/rules.ts';
import { recordMarketVisit } from '../economy/trade.ts';
import { adjustReputation, FACTIONS, standingTier, TIER_LABEL } from '../economy/factions.ts';
import { eventsAt, newsAt, stationEventsBetween, systemEventAt } from '../economy/events.ts';
import { EVENTS } from '../content/events/rules.ts';
import {
  acceptJob,
  activeJobIds,
  advanceJobs,
  assaultsIn,
  contractPacksIn,
  countMined,
  countPiracy,
  currentObjective,
  defencesIn,
  deliverJob,
  describeObjective,
  escortArrived,
  escortLost,
  escortsIn,
  failJob,
  getJob,
  handOver,
  LIFELINE_ID,
  primaryObjective,
  rescuesIn,
  standLost,
  standsIn,
  standWon,
  lifeboatAboard,
  lifeboatsClear,
  lifeboatsIn,
  lifeboatsLapse,
  wrecksIn,
  type JobEvent,
} from '../economy/jobs.ts';
import { boardEpoch, boardFor, partyName, postedContract, postedContracts } from '../economy/contracts.ts';
import { briefingFor, choiceHere, denDown, isStoryJob, knockOutDen, makeChoice, markSeen, optionLock, pendingBeats, speakerName } from '../economy/story.ts';
import { DENS } from '../content/dens/rules.ts';
import { showChoice, showDialogue } from '../ui/story.ts';
import { denBounty, stashGear, wingmanLost } from '../economy/combat.ts';
import { launchList, payWing, settleWing, trustBand, trustOf, wingFought, wingHurt } from '../economy/wing.ts';
import { TRUST_PREFIX } from '../content/wing/lines.ts';
import type { WingOrder } from '../content/wing/rules.ts';
import { showWingCard } from '../ui/wing.ts';
import { eventHauls, haulFate, raidsOnWay, recordHaul, reliefHauls, shipments, shipsOut, shortfall } from '../economy/hauls.ts';
import { HAULS } from '../content/economy/hauls.ts';
import { commitCrime, customsScan, dockAccess, finesTravelling, isLawful, scansOnDocking, settleLaw, totalFines } from '../economy/law.ts';
import { whatNext } from '../economy/advisor.ts';
import { catalogue, checkMilestones, codexProgress } from '../economy/progress.ts';
import { CODEX_GRANT } from '../content/progress/rules.ts';
import { welcomeText } from '../economy/dockText.ts';
import { DesktopInput } from '../flight/input/DesktopInput.ts';
import { GamepadInput, PAD_HOLDS, padLabel } from '../flight/input/GamepadInput.ts';
import { SchemeTracker } from '../flight/input/scheme.ts';
import { emptyInput, type InputScheme } from '../flight/input/types.ts';
import type { GalaxyMapView } from '../galaxy/GalaxyMapView.ts';
import { findRoute, type Route } from '../galaxy/routing.ts';
import type { MapState } from '../galaxy/types.ts';
import { button, clearToasts, commToast, confirmDialog, dataBadge, setModalRoot, setToastRoot, showModal, sourceLink, toast } from '../ui/components.ts';
import { formatCredits, h, signed } from '../ui/dom.ts';
import { Hud } from '../ui/hud/Hud.ts';
import { hasVoyage } from '../ui/station/journal.ts';
import { StationHub, stationRooms, type StationWindow } from '../ui/station/StationHub.ts';
import { bodyCard, controlsContent, planetCard, settingsContent, sheet } from '../ui/screens/panels.ts';
import { openSaves } from '../ui/screens/saves.ts';
import { renderTitle } from '../ui/screens/TitleScreen.ts';
import { TouchControls } from '../ui/touch/TouchControls.ts';
import { createJumpTunnel, type JumpTunnelArt } from '../world/art/effects.ts';
import { createCatalogShipArt } from '../world/art/shipgen/index.ts';
import type { ArtContext } from '../world/art/types.ts';
import { DockedView } from '../world/DockedView.ts';
import { FlightSession, type EncounterOutcome } from '../world/FlightSession.ts';
import type { MiningLedger } from '../world/MiningField.ts';
import { createStationInterior, type RoomView, type StationInterior } from '../world/rooms/index.ts';
import type { EncounterDef } from '../world/sceneTypes.ts';
import { spectralClass } from '../content/world/generate.ts';
import { sceneDefFor } from '../world/systems/index.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import { generatedInteriorStyle } from '../world/systems/interiors.ts';
import { SystemScene } from '../world/SystemScene.ts';
import type { Target } from '../world/targets.ts';
import { collectDeviceFacts, formatReport, FrameRateLog } from './deviceReport.ts';
import { GameRenderer, isTouchDevice, resolveQuality } from './GameRenderer.ts';
import { Loop } from './Loop.ts';
import { discoverBody, dockAt, jumpReadiness, performJump, rescueAfterDefeat, rescueFromPyre, RESCUE_FEE, routeFee, undock, type DockOutcome } from './rules.ts';
import type { SaveManager } from './save/SaveManager.ts';
import { applyDocumentSettings, type Settings } from './settings.ts';
import { Soundscape } from './soundscape.ts';
import { applyCredits, createNewGame, markVisited, type GameState } from './state.ts';
import { CLASS_NAMES, RACE_LINES, RIVAL_START } from '../content/racing/lines.ts';
import { RACING } from '../content/racing/rules.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { classPar, clubRecord, venues, courseById, courseKey, courseName, endEntry, finishRace, gridOf, heatStart, lineUp, ownParRun, raceClass, racingLog, settleRacing, type RaceCard, type Standing } from '../economy/racing.ts';
import { showRaceResult } from '../ui/racing.ts';
import type { RaceEvent, RaceSetup } from '../world/RaceRun.ts';

type Mode = 'loading' | 'title' | 'docked' | 'flight' | 'map' | 'jump';

interface JumpSequence {
  route: Route;
  fee: number;
  t: number;
  phase: 'charge' | 'tunnel';
  overlay: HTMLElement;
  progress: HTMLElement;
  tunnel: JumpTunnelArt | null;
  tunnelScene: THREE.Scene | null;
  arrivalReady: boolean;
}

const MOOD: Record<string, MusicMood> = {
  sol: 'sol',
  'alpha-centauri': 'alpha-centauri',
  barnard: 'barnard',
  sirius: 'sirius',
  'epsilon-eridani': 'epsilon-eridani',
};

/** Music for a system: its own theme, or the theme of the hand-made system with the most similar star. */
function moodFor(systemId: SystemId): MusicMood {
  const own = MOOD[systemId];
  if (own) return own;
  const primary = getComponent(getSystem(systemId).componentIds[0] ?? '');
  const cls = primary ? spectralClass(primary.spectralType) : 'M';
  return cls === 'M' ? 'barnard' : cls === 'D' || cls === 'A' || cls === 'B' ? 'sirius' : cls === 'K' ? 'epsilon-eridani' : 'alpha-centauri';
}

/**
 * Whether Auto quality may step down on this device. Not in test runs: the test browser draws on
 * the CPU at a fraction of a phone's speed, so Auto would always step down there, and the tests
 * would stop seeing what players see.
 */
const TEST_RUN = typeof location !== 'undefined' && new URLSearchParams(location.search).get('test') === '1';
function autoSteps(settings: Settings): boolean {
  return settings.quality === 'auto' && !TEST_RUN;
}

export class Game {
  readonly audio = new AudioEngine();
  /** Music, station ambience and local radio, kept in step with where the player is. */
  private readonly soundscape = new Soundscape(this.audio);
  /** Frame rate over the current or last flight, for the device report (Settings). */
  private readonly flightFrames = new FrameRateLog();
  readonly saves: SaveManager;
  settings: Settings;
  state: GameState | null = null;
  mode: Mode = 'loading';
  paused = false;
  scheme: InputScheme;
  timeScale = 1;

  private readonly canvas: HTMLCanvasElement;
  private readonly ui: HTMLElement;
  private readonly renderer: GameRenderer;
  private readonly loop: Loop;
  private readonly camera = new THREE.PerspectiveCamera(62, 1, 0.5, 2_000_000);
  private readonly hud: Hud;
  private readonly touch: TouchControls;
  private readonly desktop: DesktopInput;
  private readonly gamepad = new GamepadInput();
  /** Which device was used last (it drives the HUD's layout and hints). */
  private readonly schemes: SchemeTracker;
  private map: GalaxyMapView | null = null;
  private mapLoading: Promise<GalaxyMapView> | null = null;
  private readonly screenLayer: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private system: SystemScene | null = null;
  /** The game day Sol's scene was laid out for (null for other systems). */
  private systemDay: number | null = null;
  /** The save's own stations when the system scene was built (the player's outpost, docs/PROCGEN.md §22). */
  private systemOwn = '';
  /** Browser tests that want lane encounters turn them on (docs/PROCGEN.md §27). */
  private lanesInTests = false;
  /** Border battles (docs/PROCGEN.md §35) are off in browser tests unless a test turns them on. */
  private battlesInTests = false;
  /** Test-only: no raider packs in flight (a test that waits in a lawless system for something else). */
  private packsOff = false;
  /** Pyre's scene: the star, or its black hole once it has gone (docs/PROCGEN.md §26); null elsewhere. */
  private systemStage: 'alive' | 'gone' | null = null;
  private flight: FlightSession | null = null;
  /** What has been cut from the rocks this session (docs/PROCGEN.md §19): it outlives a flight, not the page. */
  private readonly minedRocks: MiningLedger = new Map();
  private dockedView: DockedView | null = null;
  private station: StationHub | null = null;
  /** The 3D rooms behind the station menus while docked. */
  private interior: StationInterior | null = null;
  private interiorsWarm = false;
  private titleEl: HTMLElement | null = null;
  private pauseEl: HTMLElement | null = null;
  private contextLostEl: HTMLElement | null = null;
  private jump: JumpSequence | null = null;
  private modeBeforeMap: Mode = 'flight';
  private autosaveTimer = 0;
  private objectiveTimer = 0;
  /** Seconds until the fleet is next settled in flight (docs/PROCGEN.md §18.6). */
  private fleetTimer = 0;
  /** Game clock when passengers last said they were frightened (docs/PROCGEN.md §23). */
  private lastFright = -Infinity;
  /** The far stars' latest moment the stations have spoken of (docs/PROCGEN.md §25). */
  private skySaid: SkyNewsKind | null = null;
  /** The last moment of Pyre's story the radio told, and where (docs/PROCGEN.md §26). */
  private edgeSaid: { kind: EdgeNewsKind | null; systemId: SystemId } | null = null;
  /** When this flight began (a rival counts the player's shots against standing once a flight). */
  private flightStart = 0;
  private objectiveText: string | null = null;
  /** The "what next" suggestion for this flight (worked out once per launch or arrival). */
  private hint: string | null = null;
  private fpsTimer = 0;
  private sheetsOpen = 0;
  private readonly toastLayer: HTMLElement;
  private toastRoot: HTMLElement;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement, saves: SaveManager, settings: Settings) {
    this.canvas = canvas;
    this.ui = ui;
    this.saves = saves;
    this.settings = settings;
    this.schemes = new SchemeTracker(isTouchDevice() ? 'touch' : 'desktop');
    this.scheme = this.schemes.scheme;
    this.renderer = new GameRenderer(canvas, resolveQuality(settings.quality));
    this.renderer.setQuality(resolveQuality(settings.quality), settings.bloom && !settings.reducedMotion, autoSteps(settings));
    this.screenLayer = h('div', { class: 'screen-layer passthrough' });
    const modalLayer = h('div', { class: 'modal-layer passthrough' });
    const toastLayer = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.toastLayer = toastLayer;
    this.toastRoot = toastLayer;
    this.fpsEl = h('div', { class: 'fps-meter num', hidden: true });
    this.hud = new Hud(ui, {
      onMap: () => this.openMap(),
      onPause: () => this.setPaused(true),
      onHelp: () => this.openControls(),
      onAvoidCombat: () => this.flight?.avoidCombat(),
      onContextAction: () => this.desktop.trigger('interact'),
      onSelectMarker: (id) => this.flight?.selectTarget(id),
      onCommand: (action) => this.desktop.trigger(action),
    });
    this.touch = new TouchControls(ui, {
      onAction: (a) => {
        if (a === 'map') this.openMap();
        else if (a === 'pause') this.setPaused(true);
        else this.desktop.trigger(a);
      },
      onAimAssistCycle: () => {
        const next = this.settings.aimAssist === 'off' ? 'low' : this.settings.aimAssist === 'low' ? 'medium' : 'off';
        this.applySettings({ ...this.settings, aimAssist: next });
        toast(`Aim assist: ${next}`, 'info', 1400);
      },
      onActivity: () => this.setScheme('touch'),
    });
    this.desktop = new DesktopInput(canvas);
    this.desktop.onActivity = () => this.setScheme('desktop');
    this.desktop.onPointerMove = (x, y) => {
      if (this.scheme === 'desktop') this.hud.moveReticle(x, y);
    };
    this.gamepad.onActivity = () => this.setScheme('gamepad');
    this.gamepad.onConnected = (supported) => {
      toast(supported ? 'Gamepad connected' : 'Gamepad connected, but its button layout is not supported', supported ? 'good' : 'bad', supported ? 3200 : 5000);
      // A new pad may name its buttons differently.
      this.refreshFlightUi();
    };
    this.gamepad.onDisconnected = (anyLeft) => this.onGamepadLost(anyLeft);
    this.gamepad.listen(window);
    ui.append(this.screenLayer, modalLayer, toastLayer, this.fpsEl);
    setModalRoot(modalLayer);
    setToastRoot(toastLayer);

    this.loop = new Loop((dt) => this.tick(dt));
    this.loop.onVisibility = (visible) => this.onVisibility(visible);
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => {
      this.touch.resetPointers();
      this.onResize();
    });
    window.visualViewport?.addEventListener('resize', () => this.onResize());
    window.addEventListener('pagehide', () => this.persist());
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') this.setScheme('touch');
    }, { capture: true });
    const unlock = () => void this.unlockAudio();
    window.addEventListener('pointerup', unlock, { capture: true });
    window.addEventListener('touchend', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    window.addEventListener('keydown', (e) => this.onGlobalKey(e));
    this.renderer.onContextLost = () => this.showContextLost();
    this.renderer.onContextRestored = () => this.hideContextLost();
    this.applySettings(settings, false);
    this.onResize();
    this.loop.start();
  }

  private get artCtx(): ArtContext {
    return { quality: this.renderer.quality, reducedMotion: this.settings.reducedMotion };
  }

  // ------------------------------------------------------------------ settings, audio, input scheme

  applySettings(next: Settings, persist = true): void {
    const prev = this.settings;
    this.settings = next;
    applyDocumentSettings(next);
    if (prev.quality !== next.quality || prev.bloom !== next.bloom || prev.reducedMotion !== next.reducedMotion || !persist) {
      this.renderer.setQuality(resolveQuality(next.quality), next.bloom && !next.reducedMotion, autoSteps(next));
    }
    this.audio.setVolumes(next.volumes);
    this.audio.setMuted(next.muted);
    this.desktop.steering = next.steering;
    this.desktop.invertY = next.invertY;
    this.touch.invertY = next.invertY;
    this.gamepad.invertY = next.invertY;
    this.touch.setSwapSides(next.swapTouchSides);
    this.touch.setAimAssist(next.aimAssist);
    this.flight?.updateSettings(next);
    this.map?.setReducedMotion(next.reducedMotion);
    if (this.dockedView) this.dockedView.reducedMotion = next.reducedMotion;
    this.fpsEl.hidden = !next.showFps;
    this.hud.textScale = next.textScale;
    if (persist) void this.saves.saveSettings(next);
  }

  private async unlockAudio(): Promise<void> {
    if (this.audio.state === 'running') return;
    await this.audio.unlock();
    this.audio.setVolumes(this.settings.volumes);
    this.audio.setMuted(this.settings.muted);
    this.soundscape.refresh();
  }

  private sfx(id: SfxId, volume = 1): void {
    this.audio.play(id, { volume });
  }

  /** A comm message in flight: the radio blips as it comes in. */
  private comm(speaker: string, text: string, ms: number): void {
    this.sfx('radio-blip');
    commToast(speaker, text, ms);
    // The last few lines said, for the tests (a toast comes and goes on its own time).
    this.said.push(text);
    if (this.said.length > 20) this.said.shift();
  }

  /** What the radio has said lately (test hook `comms`). */
  private readonly said: string[] = [];

  private setScheme(scheme: InputScheme): void {
    if (!this.schemes.use(scheme)) return;
    this.scheme = this.schemes.scheme;
    // Back on the keyboard, the guns aim at the mouse again: show the reticle there.
    const cursor = this.desktop.cursor;
    if (scheme === 'desktop' && cursor.present) this.hud.moveReticle(cursor.x, cursor.y);
    this.refreshFlightUi();
  }

  /** A pad went away: the HUD returns to the device used before it, and flight pauses rather than drift on. */
  private onGamepadLost(anyLeft: boolean): void {
    toast('Gamepad disconnected', 'info');
    if (!anyLeft && this.schemes.gamepadLost()) {
      this.scheme = this.schemes.scheme;
      if (this.mode === 'flight' && !this.paused) {
        this.setPaused(true);
        return;
      }
    }
    // The HUD's device may have changed, or a pad left behind may name its buttons differently.
    this.refreshFlightUi();
  }

  private refreshFlightUi(): void {
    const flying = this.mode === 'flight' && !this.paused;
    this.hud.setVisible(this.mode === 'flight');
    this.hud.setScheme(this.scheme, this.gamepad.style);
    this.touch.setVisible(flying && this.scheme === 'touch');
    this.desktop.setEnabled(flying);
    this.canvas.style.cursor = flying && this.scheme !== 'touch' ? 'none' : 'default';
    this.updateToastRoot();
  }

  /** Toasts go where they cannot cover controls: HUD slot (touch flight), station slot (docked). */
  private updateToastRoot(): void {
    const next = this.mode === 'flight' && this.scheme === 'touch' ? this.hud.toastSlot : this.mode === 'docked' && this.station ? this.station.toastSlot : this.toastLayer;
    if (next === this.toastRoot) return;
    next.append(...Array.from(this.toastRoot.children));
    this.toastRoot = next;
    setToastRoot(next);
  }

  // ------------------------------------------------------------------ title

  async showTitle(): Promise<void> {
    this.clearScreens();
    this.mode = 'title';
    this.loop.lowPower = true;
    this.loadSystem('sol');
    const site = this.system!.dock('earth-port') ?? null;
    this.dockedView = new DockedView(this.system!, this.camera, site);
    this.dockedView.reducedMotion = this.settings.reducedMotion;
    const loaded = await this.saves.load();
    if (loaded.warning) toast(loaded.warning, 'bad', 6000);
    const s = loaded.state;
    const summary = s
      ? `${getSystem(s.location.systemId).displayName}${s.location.dockedAt ? ` · ${getLocation(s.location.dockedAt).name}` : ' · in flight'} · ${formatCredits(s.credits)}`
      : null;
    this.titleEl = renderTitle(this.screenLayer, {
      systemCount: SYSTEMS.length,
      provisional: hasProvisionalData(),
      saveSummary: summary,
      onPlay: () => void this.newGame(!!s),
      onContinue: () => void this.continueGame(),
      onSaves: () => this.openSaves(),
      onControls: () => this.openControls(),
      onAbout: () => this.openAbout(),
      onSettings: () => this.openSettings(),
    });
    this.refreshFlightUi();
    this.soundscape.title();
    this.titleEl.querySelector<HTMLButtonElement>('button')?.focus();
    this.warmInteriors(s?.location.dockedAt ?? 'earth-port');
  }

  /** Builds and drops one interior while the title is up, so the first dock does not hitch on shared caches. */
  private warmInteriors(locationId: string): void {
    if (this.interiorsWarm) return;
    this.interiorsWarm = true;
    window.setTimeout(() => {
      if (this.mode !== 'title') return;
      this.buildInterior(locationId)?.dispose();
    }, 400);
  }

  /** The game date (Julian): when the save began plus the time played; Sol's planets sit where they really are then. */
  private gameDate(): number | null {
    return this.state ? gameJulianDate(this.state.createdAt, this.state.clock) : null;
  }

  private buildInterior(locationId: string): StationInterior | null {
    const def = sceneDefFor(getLocation(locationId).systemId, this.gameDate());
    const station = def.stations.find((s) => s.locationId === locationId);
    if (!station) return null;
    // The light through the bay comes from the nearest star (Meridian orbits Proxima, not A or B).
    const d2 = (p: THREE.Vector3) => p.distanceToSquared(station.position);
    const star = def.stars.reduce((best, s) => (d2(s.position) < d2(best.position) ? s : best));
    const model = this.state ? shipModel(this.state.ship.model) : null;
    // Generated stations get a generated interior; the hand-made ones keep their authored rooms.
    const style = generatedInteriorStyle(def, station);
    return createStationInterior(
      {
        ...(style ? { style } : { station: station.kind }),
        skybox: def.skybox,
        starColor: star.color,
        seed: hashString(locationId) % 10_000,
        rooms: stationRooms(locationId, this.state && dockAccess(this.state, locationId) === 'emergency' ? 'emergency' : 'full'),
        ...(model ? { ship: (ctx: ArtContext) => createCatalogShipArt(model, ctx) } : {}),
      },
      this.artCtx,
    );
  }

  /** A new ship from the yard: rebuild the rooms so it sits on the pad. */
  private onShipChanged(): void {
    const locationId = this.state?.location.dockedAt;
    if (this.mode !== 'docked' || !locationId || !this.station) return;
    this.disposeInterior();
    this.interior = this.buildInterior(locationId);
    if (!this.interior) return;
    const { width, height } = this.renderer.size;
    this.interior.resize(width, height);
    this.interior.setView(this.station.currentRoom, true);
  }

  private disposeInterior(): void {
    this.interior?.dispose();
    this.interior = null;
  }

  private async newGame(hasSave: boolean): Promise<void> {
    if (hasSave) {
      const ok = await confirmDialog(
        'Start a new game?',
        'This replaces the game in this browser’s autosave, and cannot be undone. Games in your save slots are kept.',
        'Start new game',
        { danger: true },
      );
      if (!ok) return;
    }
    this.state = createNewGame();
    this.minedRocks.clear();
    await this.saves.save(this.state);
    this.enterDocked('earth-port', { intro: true, room: 'bar', window: 'jobs' });
  }

  private async continueGame(): Promise<void> {
    const loaded = await this.saves.load();
    if (!loaded.state) {
      toast(loaded.warning ?? 'No saved game found.', 'bad');
      return;
    }
    this.resume(loaded.state);
  }

  /** Enters a game where it was saved: docked, or in flight at the saved pose (Continue, and loaded saves). */
  private resume(state: GameState, message = 'Progress restored'): void {
    this.state = state;
    // Rocks cut in another game are whole in this one.
    this.minedRocks.clear();
    // The fleet catches up with the clock the save was made at (docs/PROCGEN.md §18).
    useWorldLog(this.state.world);
    useGameStart(this.state.createdAt);
    // A save from before settled fronts left their marks gets them now (docs/PROCGEN.md §20.7).
    markSettledFronts(this.state);
    const fleet = settleFleet(this.state);
    const stories = this.announceStories(settleRivalStories(this.state));
    // A save past the opening gets its far stars' timeline (docs/PROCGEN.md §25); what has already happened is not said again.
    const scheduled = scheduleSky(this.state);
    this.skySaid = skyMoment(this.state.clock);
    // Pyre's warning is set once the player has reached the frontier (docs/PROCGEN.md §26); what has happened is not said again.
    const edged = scheduleEdge(this.state);
    this.edgeSaid = { kind: edgeMoment(this.state.location.systemId, this.state.clock), systemId: this.state.location.systemId };
    if (fleet.steps || scheduled || edged || stories) this.persist();
    const loc = state.location;
    if (loc.dockedAt) this.enterDocked(loc.dockedAt, { titleCard: true });
    else if (loc.flight) {
      this.enterFlight({
        kind: 'restore',
        position: new THREE.Vector3(...loc.flight.position),
        quaternion: new THREE.Quaternion(...loc.flight.quaternion),
      });
    } else this.enterFlight({ kind: 'arrival' });
    toast(message, 'good', 2000);
    this.announceFleet(fleet);
  }

  /**
   * Replaces the running game (or the title) with a loaded one: a save slot or an imported file.
   * The autosave follows it from now on, so a refresh continues the loaded game.
   */
  private async playLoaded(state: GameState, message: string): Promise<void> {
    // The running game was saved when its menu opened; drop its flight so nothing writes it back.
    this.disposeFlight();
    this.hud.setEncounterBanner(false);
    this.state = state;
    await this.saves.save(state);
    this.resume(state, message);
  }

  /** What the fleet did while the player was away, as toasts (docs/PROCGEN.md §18). */
  private announceFleet(s: FleetSettlement): void {
    for (const n of fleetNews(s)) toast(n.text, n.tone, 6000);
    // Raids on the player's outpost decided while they were away (docs/PROCGEN.md §29).
    for (const r of s.raids) {
      toast(r.text, r.tone, 7000);
      this.comm(r.speaker, r.watch, 6000);
    }
    this.announceJobEvents(s.raidJobs);
    this.watchOutpost();
  }

  /** An outpost's watch sees a raid coming (docs/PROCGEN.md §29): said once, a job to defend it, and armed in a flight there. */
  private watchOutpost(): void {
    const state = this.state;
    if (!state) return;
    let saw = false;
    for (const o of outpostsOf(state)) {
      if (o.stage <= 0) continue;
      const w = raidWarning(state, o);
      if (!w) continue;
      saw = true;
      this.sfx('alert');
      toast(w.text, 'bad', 8000);
      this.comm(w.speaker, w.watch, 7000);
      if (this.flight && this.mode === 'flight' && !state.location.dockedAt && state.location.systemId === outpostSystem(o)) {
        this.flight.armOutpostRaid({ window: w.plan.window, at: w.plan.at, threat: w.plan.threat, ships: w.plan.ships });
      }
    }
    if (saw) this.persist();
  }

  /** Leaving a raid on an outpost under way (docking, jumping, the ship lost): the clock decides it, the raiders downed counted. */
  private leaveOutpostRaid(): void {
    const state = this.state;
    const r = this.flight?.outpostRaidStatus();
    const o = state ? outpostAt(state, r?.locationId) : undefined;
    if (!state || !o || r?.state !== 'on') return;
    const plan = foughtPlan(state, o, r.setup);
    for (const n of folkUpTo(state, o, plan.at)) toast(n.text, n.tone, 6000);
    const { raid, events } = settleRaid(state, o, plan, 'away', { downed: r.downed });
    const note = raidNote(o, raid);
    toast(note.text, note.tone, 7000);
    this.announceJobEvents(events);
  }

  /** What rivals' stories said as the clock passed their moments (docs/PROCGEN.md §28), and the jobs they closed. */
  private announceStories(out: { notes: StoryNote[]; jobs: JobEvent[] }): boolean {
    const state = this.state;
    for (const n of out.notes) {
      toast(n.text, n.tone, 7000);
      if (n.line) this.comm(rivalName(n.rival), n.line, 7000);
      // A rescue or a duel posted where the player is flying: its ship comes into the scene now.
      if (n.job && state && this.flight && this.mode === 'flight' && !state.location.dockedAt) {
        const here = state.location.systemId;
        const rescue = rescuesIn(state, here).find((x) => x.jobId === n.job);
        const duel = duelIn(state, here);
        this.flight.addStoryShip({ ...(rescue ? { rescue } : {}), ...(duel?.jobId === n.job ? { duel: { jobId: duel.jobId, rivalId: duel.rival.id, started: duel.started } } : {}) });
      }
    }
    this.announceJobEvents(out.jobs);
    return out.notes.length > 0 || out.jobs.length > 0;
  }

  /** What the crew aboard did and said (docs/PROCGEN.md §30): notices, and their own words on the radio. */
  private announceCrew(out: { notes: CrewNote[]; jobs: JobEvent[] }): void {
    for (const n of out.notes) {
      toast(n.text, n.tone, 6000);
      if (n.name && n.line) this.comm(n.name, n.line, 6000);
    }
    if (out.jobs.length) this.announceJobEvents(out.jobs);
    if (out.notes.length || out.jobs.length) this.persist();
  }

  /** Leaving a duel under way (docking, jumping, or the ship lost) forfeits it (docs/PROCGEN.md §28). */
  private leaveDuel(): void {
    const state = this.state;
    const d = this.flight?.duelStatus();
    const r = d?.state === 'on' ? rivalById(d.rivalId) : undefined;
    if (!state || !r) return;
    const out = duelLost(state, r, 'forfeit');
    if (out.text) toast(out.text, 'bad', 6000);
    if (out.line) this.comm(rivalName(r), out.line, 6000);
    this.announceJobEvents(out.events);
  }

  // ------------------------------------------------------------------ scenes

  private loadSystem(systemId: SystemId): void {
    // Sol is laid out for the game date: rebuilt when the day changes (and after the title's schematic Sol).
    const jd = this.gameDate();
    const day = systemId === 'sol' && jd !== null ? Math.floor(jd) : null;
    const clock = this.state?.clock ?? null;
    const stage = systemId === PYRE_ID && clock !== null ? (pyreStage(clock) === 'gone' ? 'gone' : 'alive') : null;
    if (this.system && this.system.def.systemId === systemId && this.systemDay === day && this.systemOwn === saveLocationsKey() && this.systemStage === stage) return;
    this.disposeFlight();
    this.dockedView = null;
    this.system?.dispose();
    this.system = new SystemScene(sceneDefFor(systemId, jd, clock), this.artCtx);
    this.systemDay = day;
    this.systemOwn = saveLocationsKey();
    this.systemStage = stage;
    this.system.scene.add(this.camera);
  }

  private disposeFlight(): void {
    if (this.flight) {
      this.flight.dispose();
      this.flight = null;
    }
  }

  private clearScreens(): void {
    this.titleEl?.remove();
    this.titleEl = null;
    this.station?.destroy();
    this.station = null;
    this.disposeInterior();
    this.pauseEl?.remove();
    this.pauseEl = null;
    this.paused = false;
  }

  private enterDocked(locationId: string, opts: { intro?: boolean; room?: RoomView; window?: StationWindow | null; titleCard?: boolean }): void {
    const state = this.state!;
    // Events the player ended early (docs/PROCGEN.md §17) are in this save's world log.
    useWorldLog(state.world);
    useGameStart(state.createdAt);
    // Once the opening delivery is done, the far stars' timeline is set (docs/PROCGEN.md §25), and Pyre's once at the frontier (§26).
    scheduleSky(state);
    scheduleEdge(state);
    this.clearScreens();
    if (this.map?.isOpen) this.map.close();
    this.loadSystem(state.location.systemId);
    this.disposeFlight();
    const site = this.system!.dock(locationId) ?? null;
    this.dockedView = new DockedView(this.system!, this.camera, site);
    this.dockedView.reducedMotion = this.settings.reducedMotion;
    this.interior = this.buildInterior(locationId);
    if (this.interior) {
      const { width, height } = this.renderer.size;
      this.interior.resize(width, height);
    }
    this.mode = 'docked';
    this.loop.lowPower = true;
    this.refreshFlightUi();
    this.station = new StationHub(
      this.screenLayer,
      {
        state,
        locationId,
        access: dockAccess(state, locationId) === 'emergency' ? 'emergency' : 'full',
        save: () => this.onDockStateChanged(),
        shipChanged: () => this.onShipChanged(),
        sfx: (id) => this.sfx(id),
        launch: () => this.launch(),
        openMap: () => this.openMap(),
        openEncyclopedia: () => this.openAbout(state.location.systemId),
        openLogbook: () => this.openLogbook(),
        openSettings: () => this.openSettings(),
        openControls: () => this.openControls(),
        openSaves: () => this.openSaves(),
        quitToTitle: () => void this.quitToTitle(),
        acceptJob: (id) => this.acceptJob(id),
        decide: () => void this.offerChoice(),
        reload: (win) => this.enterDocked(locationId, { room: this.station?.currentRoom ?? 'deck', window: win === undefined ? 'news' : win }),
        dockElsewhere: (id) => {
          if (!this.state) return;
          this.state.location = { ...this.state.location, dockedAt: null, flight: null };
          this.onDocked(id);
        },
        deliverJob: (id) => void this.deliver(id),
        travelCost: (from, to) => this.travelCost(from, to),
        // The first view is set while the hub is being built: jump straight there.
        setView: (room) => {
          this.soundscape.docked(locationId, room);
          return this.interior?.setView(room, !this.station) ?? null;
        },
      },
      { room: opts.room, window: opts.window, titleCard: opts.titleCard && !opts.intro },
    );
    this.updateToastRoot();
    if (opts.intro) void this.showIntro();
  }

  /** After any docked transaction: re-evaluate contract objectives (e.g. cargo bought), then save. */
  private onDockStateChanged(): void {
    const s = this.state!;
    const events = advanceJobs(s, { dockedAt: s.location.dockedAt, systemId: s.location.systemId });
    this.announceJobEvents(events);
    this.persist();
  }

  private travelCost(from: SystemId, to: SystemId): number {
    const route = findRoute(MAP_SYSTEMS, from, to);
    if (!route) return 0;
    return routeFee(this.state!, route);
  }

  private async showIntro(): Promise<void> {
    await showModal({
      title: 'Halcyon Ring, high Earth orbit',
      body: h(
        'div',
        { class: 'stack' },
        h('p', null, 'You are an independent courier pilot: one small ship, 800 credits and a clean record.'),
        h(
          'p',
          null,
          'The contract board is flashing an urgent job. A research outpost at Proxima Centauri — the nearest star to the Sun — is running out of medical supplies after raiders hit its last supply run.',
        ),
        h('p', { class: 'muted small' }, dataBadge('fictional'), ' The people, stations and jump travel are fiction. The stars and the planet Proxima b are real.'),
      ),
      actions: [{ label: 'Open the contract board', value: 'ok', variant: 'primary', testId: 'intro-ok' }],
      dismissValue: 'ok',
      testId: 'intro-dialog',
    });
  }

  private acceptJob(jobId: string): void {
    const state = this.state!;
    const r = acceptJob(state, jobId);
    toast(r.message, r.ok ? 'good' : 'bad');
    if (r.ok) {
      this.sfx('ui-confirm');
      if (state.location.dockedAt) {
        const out = dockAt(state, state.location.dockedAt);
        this.announceJobEvents(out.jobEvents);
        this.announceRanks(out.ranks);
      }
      const cargo = isStoryJob(jobId) ? getJob(jobId).story?.cargo : undefined;
      if (cargo) toast(`Loaded ${cargo.qty} ${COMMODITIES[cargo.commodity].name.toLowerCase()} for the job.`, 'info', 4000);
      if (isStoryJob(jobId)) this.tellStory();
      if (jobId === LIFELINE_ID) {
        // The voyage report counts everything from accepting the first delivery onward.
        state.voyageStartClock = state.clock;
        state.flags.voyage = true;
        toast('Buy 6 medical supplies from the Trader, then launch for Mars.', 'info', 5000);
        this.station?.openRoom('trader');
      }
    }
    this.persist();
    this.station?.render();
  }

  private async deliver(jobId: string): Promise<void> {
    const state = this.state!;
    const locationId = state.location.dockedAt;
    if (!locationId) return;
    const job = getJob(jobId, state);
    const repBefore = { ...state.reputation };
    const welcomeBefore = welcomeText(state, locationId).text;
    const r = deliverJob(state, jobId, locationId);
    if (!r.ok) {
      toast(r.message, 'bad');
      return;
    }
    this.sfx('mission-complete');
    this.persist();
    this.station?.render();
    const repLines = (Object.keys(r.repChanges) as (keyof typeof r.repChanges)[]).map((f) => {
      const after = state.reputation[f];
      return h('li', null, `${FACTIONS[f].name}: ${signed(after - repBefore[f])} → ${TIER_LABEL[standingTier(after)]}`);
    });
    const welcomeAfter = welcomeText(state, locationId).text;
    const firstDelivery = jobId === LIFELINE_ID;
    const totals = firstDelivery ? this.voyageSummary() : null;
    await showModal({
      title: firstDelivery ? 'First interstellar delivery complete!' : `${job.title}: complete`,
      body: h(
        'div',
        { class: 'stack' },
        h('p', null, `Reward paid: ${formatCredits(r.reward)}.`),
        repLines.length ? h('div', null, h('strong', null, 'Faction reaction'), h('ul', null, repLines)) : null,
        welcomeAfter !== welcomeBefore ? h('p', { class: 'welcome improved' }, welcomeAfter) : null,
        totals,
        firstDelivery
          ? h(
              'p',
              null,
              'Meridian has what it needs. The neighbourhood is open: Barnard’s Star, Sirius and Epsilon Eridani are a jump or two away, and the outposts there have work for a pilot with a good name.',
            )
          : null,
      ),
      actions: [{ label: firstDelivery ? 'Continue exploring' : 'Continue', value: 'ok', variant: 'primary', testId: 'delivery-ok' }],
      dismissValue: 'ok',
      testId: 'delivery-dialog',
    });
    this.tellStory();
  }

  private voyageSummary(): HTMLElement {
    const s = this.state!;
    const since = s.voyageStartClock;
    let trade = 0;
    let other = 0;
    let costs = 0;
    for (const e of s.ledger) {
      if (e.t < since) continue;
      if (e.kind === 'buy' || e.kind === 'sell') trade += e.amount;
      else if (e.amount >= 0) other += e.amount;
      else costs += e.amount;
    }
    return h(
      'dl',
      { class: 'kv', 'data-testid': 'voyage-summary' },
      h('dt', null, 'Trade (sales − purchases)'),
      h('dd', { class: 'num' }, `${signed(trade)} cr`),
      h('dt', null, 'Rewards, bounties, salvage'),
      h('dd', { class: 'num' }, `${signed(other)} cr`),
      h('dt', null, 'Repairs, fees, equipment'),
      h('dd', { class: 'num' }, `${signed(costs)} cr`),
      h('dt', null, h('strong', null, 'Net profit this voyage')),
      h('dd', { class: 'num' }, h('strong', null, `${signed(trade + other + costs)} cr`)),
    );
  }

  private announceJobEvents(events: JobEvent[], tell = true): void {
    if (tell && events.length) this.tellStory();
    for (const e of events) {
      if (e.kind === 'complete') {
        const job = getJob(e.jobId, this.state!);
        const bonus = e.text.includes('on-time bonus') ? job.contract?.urgent?.bonus ?? 0 : 0;
        const paid = e.paid ?? job.reward + bonus;
        this.sfx('mission-complete');
        if (paid === 0) toast(`${job.title} complete`, 'good', 5000);
        else toast(`${job.title} complete: +${formatCredits(paid)}${bonus ? ' with the on-time bonus' : e.text.includes('(late') ? ' (late: no bonus)' : e.text.includes('rough trip') ? ' (a rough trip cut the fare)' : ''}`, 'good', 5000);
        // The poster's dispatcher confirms the payment (story missions have their own words); passengers say goodbye.
        if (paid > 0 && !job.story) {
          const giver = getLocation(job.giverLocationId);
          const lines = PAYMENT[giver.factionId ?? 'independent'];
          const goodbye = carriesPassengers(job) ? passengerGoodbye(job) : null;
          if (goodbye) commToast(goodbye.speaker, goodbye.text, 4500);
          else commToast(`${giver.name} dispatch`, fill(lines[hashString(e.jobId) % lines.length]!, { amount: formatCredits(paid) }), 4500);
        }
      } else if (e.kind === 'failed') {
        this.sfx('ui-error');
        toast(e.text, 'bad', 5000);
      } else if (e.kind === 'offer') {
        toast(e.text, 'info', 5000);
      } else {
        toast(`Objective complete: ${e.text}`, 'good');
      }
    }
    // A crew member's favour done or failed: they say so at once (docs/PROCGEN.md §30.6).
    const state = this.state;
    if (state && events.some((e) => (e.kind === 'complete' || e.kind === 'failed') && state.contracts[e.jobId]?.contract?.crew)) this.announceCrew(settleFavours(state));
  }

  // ------------------------------------------------------------------ story

  private storyQueue: Promise<void> = Promise.resolve();
  /** The wing's order, carried from one flight to the next over a jump (docs/PROCGEN.md §34). */
  private wingCarry: WingOrder = 'free';

  /**
   * Tells the story beats not yet told (docs/PROCGEN.md §14): as dialogue at a dock (then any choice
   * waiting there), as comms in flight. Queued, so dialogues never stack.
   */
  private tellStory(): void {
    this.storyQueue = this.storyQueue.then(() => this.tellStoryNow()).catch((err) => console.error(err));
  }

  private async tellStoryNow(): Promise<void> {
    const state = this.state;
    if (!state || (this.mode !== 'docked' && this.mode !== 'flight')) return;
    const docked = this.mode === 'docked';
    const beats = pendingBeats(state, !docked);
    if (beats.length) {
      markSeen(state, beats);
      this.persist();
    }
    if (!docked) {
      for (const b of beats) for (const l of b.lines) this.comm(speakerName(l.who), l.text, 9000);
      return;
    }
    for (const b of beats) await showDialogue(b.kind === 'debrief' ? `${b.title}: complete` : b.title, b.lines);
    await this.offerChoice();
  }

  /** A story choice waiting at this dock: ask, and if the player decides, make it happen. */
  private async offerChoice(): Promise<void> {
    const state = this.state;
    const here = state?.location.dockedAt;
    if (!state || !here || this.mode !== 'docked') return;
    const c = choiceHere(state, here);
    if (!c) return;
    const pick = await showChoice(c.job, c.objective, briefingFor(state, c.job), (x) => optionLock(state, x));
    if (!pick) return;
    const r = makeChoice(state, c.job.id, pick);
    if (!r.ok) {
      toast(r.message, 'bad');
      return;
    }
    this.sfx('ui-confirm');
    this.persist();
    this.station?.render();
    await showDialogue(c.job.title, [{ who: 'comm', text: r.message }]);
    this.announceJobEvents(r.events, false);
    this.persist();
    this.station?.render();
    this.tellStory();
  }

  /** Warns about a raid (or tells of a sweep) under way in the system the player is flying in, or a den knocked out here. */
  private announceSystemEvent(): void {
    const state = this.state!;
    const dark = ALL_LOCATIONS.find((l) => l.systemId === state.location.systemId && l.stationType === 'pirate-den' && denDown(state, l.id));
    if (dark) toast(`${dark.name} is dark: no raider packs here for now.`, 'good', 4500);
    const e = systemEventAt(state.location.systemId, state.clock);
    if (!e) return;
    if (e.kind === 'raid') toast(`${e.headline}: raider threat ${e.level} of 3. Watch the approaches.`, 'bad', 5000);
    else toast(`${e.headline}: the lanes are clear of raider packs for now.`, 'good', 4500);
  }

  private launch(): void {
    const state = this.state!;
    const from = state.location.dockedAt;
    if (!from) return;
    undock(state);
    this.persist();
    this.enterFlight({ kind: 'undock', locationId: from });
    this.announceSystemEvent();
    if (!state.flags.flightSchool) {
      state.flags.flightSchool = true;
      const aim =
        this.scheme === 'touch'
          ? 'hold the right thumb on the aim pad'
          : this.scheme === 'gamepad'
            ? `hold ${padLabel(PAD_HOLDS.fire, this.gamepad.style)}`
            : 'hold the right mouse button';
      this.openControls('Flight school', `Practice drones circle just outside Halcyon Ring. Target one and ${aim} to try your aim.`);
    }
  }

  private enterFlight(spawn: Parameters<FlightSession['start']>[0]): void {
    const state = this.state!;
    useWorldLog(state.world);
    useGameStart(state.createdAt);
    this.flightStart = state.clock;
    this.clearScreens();
    this.loadSystem(state.location.systemId);
    this.disposeFlight();
    this.dockedView = null;
    this.flight = new FlightSession({
      system: this.system!,
      camera: this.camera,
      state,
      settings: this.settings,
      ctx: this.artCtx,
      audio: this.audio,
      // Lane encounters (docs/PROCGEN.md §27) would come up in every browser test's flights: tests turn them on when they want them.
      lanes: !TEST_RUN || this.lanesInTests,
      callbacks: {
        onDocked: (id) => this.onDocked(id),
        onPlayerDestroyed: () => void this.onPlayerDestroyed(),
        onDiscovery: (id) => void this.onDiscovery(id),
        onScanInfo: (t) => this.onScanInfo(t),
        onEncounterStart: (def) => this.onEncounterStart(def),
        onEncounterEnd: (def, outcome) => this.onEncounterEnd(def, outcome),
        onLoot: (credits, cargo, gear) => {
          if (gear) {
            const r = stashGear(state, gear);
            toast(r.stored ? `Equipment crate: ${r.name}, in your stash (fit or sell it at an outfitter).` : `Equipment crate: ${r.name}. No room in the stash: sold for ${formatCredits(r.credits)}.`, 'good', 5000);
          }
          if (credits > 0) {
            applyCredits(state, credits, 'loot', 'Salvaged components');
            toast(`Salvage collected: +${formatCredits(credits)}`, 'good');
          }
          if (cargo) {
            const got = Math.min(cargo.qty, itemsThatFit(state.ship.cargo, cargo.commodity, cargoCapacity(state.ship)));
            if (got > 0) addCargo(state.ship.cargo, cargo.commodity, got, cargoCapacity(state.ship));
            const name = COMMODITIES[cargo.commodity].name.toLowerCase();
            toast(got > 0 ? `Cargo pod collected: ${got} ${name}${got < cargo.qty ? ' (the hold is full)' : ''}` : `No room in the hold for the ${name}`, got > 0 ? 'good' : 'bad');
          }
          this.persist();
        },
        onEscortArrived: (jobId) => {
          this.announceJobEvents(escortArrived(state, jobId));
          this.persist();
        },
        onEscortLost: (jobId) => {
          this.announceJobEvents(escortLost(state, jobId));
          this.persist();
        },
        onDenDestroyed: (locationId, jobId) => {
          if (jobId) {
            knockOutDen(state, locationId);
            const progress = state.jobs[jobId];
            if (progress?.status === 'active') progress.assault = 'done';
          } else {
            toast(denBounty(state, locationId).text, 'good', 6000);
          }
          this.sfx('mission-complete');
          this.announceJobEvents(advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId }));
          this.persist();
        },
        onCrime: (kind, faction, name, role) => {
          const out = commitCrime(state, kind, faction, state.location.systemId);
          this.sfx('alert');
          toast(kind === 'attack' ? `You opened fire on the ${name}. ${out.text}` : `The ${name} is destroyed. ${out.text}`, 'bad', 5000);
          if (kind === 'destroy' && role === 'trader') this.announceJobEvents(countPiracy(state, state.location.systemId, faction));
          // Lawful ships downed on a front help the Wake (docs/PROCGEN.md §20).
          if (kind === 'destroy' && isLawful(faction)) recordDeed(state, state.location.systemId, role === 'trader' ? BORDER.deeds.piracy : BORDER.deeds.patrolKill);
          this.persist();
        },
        onScan: (result, faction) => {
          if (!isLawful(faction)) return;
          // A rival's tip-off is spent on the scan, whatever came of it (docs/PROCGEN.md §28).
          const tip = tipoffIn(state, state.location.systemId);
          const tipped = tip ? `${spendTipoff(state, tip)} ` : '';
          if (result === 'evaded') {
            const out = commitCrime(state, 'evade', faction, state.location.systemId);
            toast(`${tipped}You ran from a cargo scan. ${out.text}`, 'bad', 5000);
          } else {
            const scan = customsScan(state, faction);
            toast(`${tipped}${scan.text}`, scan.found.length ? 'bad' : 'info', scan.found.length || tipped ? 5000 : 2600);
          }
          this.persist();
        },
        onRecovered: (jobId) => {
          const progress = state.jobs[jobId];
          const o = currentObjective(state, jobId);
          if (!progress || o?.kind !== 'recover') return;
          progress.recovered = true;
          toast(`Recovered the ${o.item}. Bring it back.`, 'good', 4000);
          this.announceJobEvents(advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId }));
          this.persist();
        },
        onHandOver: (jobId) => {
          const r = handOver(state, jobId);
          if (r.missing === 0) {
            this.announceJobEvents(r.events);
            this.persist();
          }
          return r.missing;
        },
        // A stand in a belt (docs/PROCGEN.md §40.3): won, the objective is done; lost, the mission goes back to its giver.
        onStand: (jobId, outcome) => {
          this.announceJobEvents(outcome === 'won' ? standWon(state, jobId) : standLost(state, jobId));
          this.persist();
        },
        // One of Pyre's lifeboats taken aboard (docs/PROCGEN.md §42.4).
        onLifeboat: (jobId) => {
          const n = lifeboatAboard(state, jobId);
          this.persist();
          return n;
        },
        onRescueLost: (jobId) => {
          const o = currentObjective(state, jobId);
          const ev = failJob(state, jobId, o?.kind === 'rescue' ? `the ${o.shipName} was destroyed` : 'the stranded ship was destroyed');
          if (ev) this.announceJobEvents([ev]);
          this.persist();
        },
        onWingmanLost: (id) => {
          // An ally lost on the wing ejects, and is home refitting (docs/PROCGEN.md §28); a hired wingman is picked up (§34).
          const ally = state.crew.find((w) => w.id === id)?.ally;
          const r = ally ? rivalById(ally) : undefined;
          if (r) allyLost(state, r, state.location.systemId);
          else wingmanLost(state, id);
          this.persist();
        },
        onWingOrders: () => void this.openWingCard(),
        onWingHurt: (id) => {
          wingHurt(state, id, 'hit');
          this.persist();
        },
        onWingFought: (credits) => {
          for (const c of credits) wingFought(state, c.crewId, c);
          this.persist();
        },
        // A border battle seen to its end (docs/PROCGEN.md §35): the deed, purse and standing, recorded once.
        onBattle: (e) => {
          if (e.kind !== 'ended') return;
          for (const n of settleBattle(state, e.result)) toast(n.text, n.tone, 6000);
          this.persist();
        },
        onOutpostRaid: (window, what, downed) => {
          const status = this.flight?.outpostRaidStatus();
          const o = outpostAt(state, status?.locationId);
          const setup = status?.setup;
          if (!o || !setup) return;
          const plan = foughtPlan(state, o, setup);
          if (what === 'struck') {
            this.comm(`${o.name} watch`, RAID_WATCH.struck[window % RAID_WATCH.struck.length]!, 5000);
            return;
          }
          // Fought here: held or lost as it went; undecided, the clock decides with the raiders downed counted.
          // Its people's asks up to the raid first, as a settle does (docs/PROCGEN.md §41.3).
          for (const n of folkUpTo(state, o, plan.at)) toast(n.text, n.tone, 6000);
          const { raid, events } = settleRaid(state, o, plan, 'flight', what === 'timeout' ? { downed } : { result: what, downed });
          const note = raidNote(o, raid);
          this.sfx(raid.result === 'held' ? 'mission-complete' : 'alert');
          toast(note.text, note.tone, 7000);
          this.comm(`${o.name} watch`, note.watch, 6000);
          this.announceJobEvents(events);
          this.persist();
        },
        onRivalAmbush: (id) => {
          const r = rivalById(id);
          if (!r) return;
          toast(spendAmbush(state, r), 'bad', 5000);
          this.comm(rivalName(r), STORY[r.voice].ambush, 5000);
          this.persist();
        },
        onDuel: (_jobId, id, what) => {
          const r = rivalById(id);
          if (!r) return;
          const name = rivalName(r);
          if (what === 'unfit') {
            this.comm(name, STORY[r.voice].duelUnfit, 5000);
            return;
          }
          if (what === 'started') {
            duelStarted(state, r);
            toast(STORY_NOTES.started, 'info', 5000);
            this.comm(name, STORY[r.voice].duelStart, 4000);
          } else {
            const out = what === 'won' ? duelWon(state, r) : duelLost(state, r, what);
            this.sfx(what === 'won' ? 'mission-complete' : 'alert');
            if (out.text) toast(out.text, what === 'won' ? 'good' : 'bad', 6000);
            if (out.line) this.comm(name, out.line, 6000);
            this.announceJobEvents(out.events);
          }
          this.persist();
        },
        onComm: (speaker, text) => this.comm(speaker, text, 5000),
        onPyreBreakout: () => void this.onPyreBreakout(),
        // Lane encounters (docs/PROCGEN.md §27): the radio blips as a hail comes; answered, its card; let go, what that brings.
        onHail: () => {
          this.sfx('radio-blip');
          this.persist();
        },
        onAnswerHail: (offer) => void this.onAnswerHail(offer),
        // Sites marked in flight (docs/PROCGEN.md §31): what happened there, in the save, and its words.
        onSite: (id, what, detail) => {
          const out =
            what === 'near'
              ? nearSite(state, id)
              : what === 'pod'
                ? takeSitePod(state, id, detail?.index ?? -1)
                : what === 'scanned'
                  ? scanSite(state, id, !!detail?.revealed)
                  : what === 'reached'
                    ? reachSite(state, id)
                    : what === 'boarded'
                      ? boardSite(state, id)
                      : what === 'sprung'
                        ? springSite(state, id, detail?.how ?? 'near', !!detail?.friend)
                        : what === 'cleared'
                          ? clearSite(state, id)
                          : loseSite(state, id);
          this.announceSite(out);
        },
        // A scan of a planet, star or belt may pick up a faint return (§31.3); off in browser tests unless one turns it on.
        onBodyScan: () => {
          if (TEST_RUN && !this.lanesInTests) return;
          const found = findOnScan(state, state.location.systemId);
          if (!found) return;
          this.sfx('radio-blip');
          toast(found.text, 'good', 6000);
          const setup = siteSetup(state, found.siteId);
          if (setup) this.flight?.addSite(setup);
          this.announceJobEvents(advanceJobs(state, { dockedAt: null, systemId: state.location.systemId }));
          this.persist();
        },
        onHailLapsed: (offer) => {
          const out = lapseLane(state, offer);
          this.flight?.laneOutcome(offer.id, out);
          toast(out.text, out.tone, 6000);
          this.persist();
        },
        // Sightseers at their sight (docs/PROCGEN.md §23): they say so, and the tour heads home.
        onObserve: (starId) => {
          // A far star (docs/PROCGEN.md §25), or Pyre (§26).
          const name = starId === PYRE_ID ? getSystem(PYRE_ID).displayName : farStar(starId)?.name;
          const jobs = recordObservation(state, starId, state.location.systemId);
          if (!jobs.length) {
            toast(`No contract wants ${name ?? 'that star'} observed now.`, 'info', 2600);
            return;
          }
          toast(`${name ?? 'The star'} observed from ${getSystem(state.location.systemId).displayName}: readings recorded.`, 'good', 3000);
          this.announceJobEvents(advanceJobs(state, { dockedAt: null, systemId: state.location.systemId }));
          this.persist();
        },
        onSight: (jobId) => {
          const line = seeSight(state, jobId);
          if (!line) return;
          this.comm(line.speaker, line.text, 7000);
          this.announceJobEvents(advanceJobs(state, { dockedAt: null, systemId: state.location.systemId }));
          this.persist();
        },
        // A hit on the hull frightens passengers aboard: it comes off their fare, and they say so (at most every 20 s).
        onHullHit: (share) => {
          const scared = frighten(state, share);
          if (!scared.length) return;
          if (state.clock - this.lastFright > 20) {
            this.lastFright = state.clock;
            const line = passengerFright(scared[0]!, String(Math.floor(state.clock)));
            this.comm(line.speaker, line.text, 4000);
          }
        },
        // A unit cut counts for mining claims on its belt (docs/PROCGEN.md §19); the hold itself autosaves.
        onMined: (beltId, commodity) => {
          const events = countMined(state, beltId, commodity);
          if (!events.length) return;
          this.announceJobEvents(events);
          this.persist();
        },
        onHunterDown: () => {
          state.stats.kills += 1;
          toast('Bounty hunter destroyed. Nobody pays for that one.', 'good', 3500);
          this.persist();
        },
        onBounty: (credits, name) => this.onBounty(credits, name),
        onContractKill: (jobId) => this.onContractKill(jobId),
        onHaul: (id, fate, by) => recordHaul(state.world, id, { at: state.clock, fate, systemId: state.location.systemId, ...(by ? { by } : {}) }),
        // The player's own haulers in sight (docs/PROCGEN.md §18.6): seen safely past their raid, or lost there and then.
        onCaptain: (shipId, fate, by) => {
          if (fate === 'safe') captainSeen(state, shipId);
          else this.announceFleet(captainLost(state, shipId, by ?? 'raiders', new Set(this.flight?.captainsInSight() ?? [])));
          this.persist();
        },
        onRival: (id, what, detail) => {
          const r = rivalById(id);
          if (!r) return;
          const name = rivalName(r);
          if (what === 'met') {
            metRival(state, id);
            this.comm(name, rivalHello(state, r, !!detail?.hostile), 5000);
          }
          else if (what === 'shot') {
            const line = rivalShot(state, r, this.flightStart);
            if (line) this.comm(name, line, 5000);
          } else if (detail?.by === 'player') {
            this.comm(name, rivalDestroyed(state, r, state.location.systemId), 6000);
            toast(`${name} ejected from the ${r.shipName}. They will be refitting at ${getLocation(r.home).name} for a while.`, 'info', 5000);
          } else {
            rivalKnockedOut(state, r, state.location.systemId);
            toast(`${name}’s ${r.shipName} was destroyed by raiders. ${r.first} ejected.`, 'bad', 5000);
          }
          this.persist();
        },
        onHaulThanks: (haul) => {
          const { perUnit, min, standing } = HAULS.thanks;
          const paid = Math.max(min, haul.qty * perUnit);
          applyCredits(state, paid, 'reward', `Thanks from the ${haul.name}`);
          state.stats.rewards += paid;
          if (haul.faction !== 'independent') adjustReputation(state.reputation, haul.faction, standing);
          this.sfx('ui-confirm');
          toast(`The ${haul.name} got away: its owners send ${formatCredits(paid)} for the escort.`, 'good', 5000);
        },
        onRace: (e) => this.onRace(e),
        onMessage: (text, tone) => toast(text, tone, 2600),
      },
      traffic: this.trafficHere(),
      minedRocks: this.minedRocks,
    });
    const { width, height } = this.renderer.size;
    this.flight.setViewport(width, height);
    this.flight.start(spawn);
    this.flightFrames.start();
    this.mode = 'flight';
    this.loop.lowPower = false;
    this.objectiveTimer = 0;
    this.hint = null;
    this.refreshFlightUi();
    this.soundscape.flight(this.system!.def, moodFor(state.location.systemId), state, this.flight.player.position);
    this.tellStory();
    // Sightseers whose sight is in this system say so as they arrive (docs/PROCGEN.md §23).
    if (spawn.kind === 'arrival') {
      for (const s of sightsIn(state, state.location.systemId)) {
        const line = state.contracts[s.jobId] ? sightseersArrive(state.contracts[s.jobId]!) : null;
        if (line) this.comm(line.speaker, line.text, 5000);
      }
    }
  }

  /** Traffic for the system the player flies in: the plan, and everything their contracts and story put there. */
  private trafficHere(): NonNullable<ConstructorParameters<typeof FlightSession>[0]['traffic']> {
    const state = this.state!;
    const here = state.location.systemId;
    const base = trafficFor(here, this.renderer.quality, state.clock);
    // A knocked-out den sends no packs until it is rebuilt.
    const downDens = ALL_LOCATIONS.filter((l) => l.systemId === here && l.stationType === 'pirate-den' && denDown(state, l.id)).map((l) => l.id);
    const ambush = ambushIn(state, here);
    const duel = duelIn(state, here);
    const outpost = this.outpostHere();
    const race = this.raceHere();
    return {
      ...base,
      plan: downDens.length || this.packsOff ? { ...base.plan, packs: null } : base.plan,
      contractPacks: contractPacksIn(state, here),
      escorts: escortsIn(state, here),
      wrecks: wrecksIn(state, here),
      rescues: rescuesIn(state, here),
      stands: standsIn(state, here),
      lifeboats: lifeboatsIn(state, here),
      assaults: assaultsIn(state, here),
      defences: defencesIn(state, here),
      downDens,
      crew: launchList(state),
      wingOrder: this.wingCarry,
      battles: TEST_RUN && !this.battlesInTests ? [] : battlesDue(here, state.clock, 3_600, this.renderer.quality === 'low', state.world.border),
      sights: sightsIn(state, here),
      sites: sitesIn(state, here),
      lingering: this.takeLingering(),
      // Rivals' feuds (docs/PROCGEN.md §28): customs tipped off, hired guns waiting, a duel off the beacon.
      tipped: tippedPatrols(state, here),
      ...(ambush ? { rivalAmbush: { rivalId: ambush.rival.id, delay: ambush.delay, guns: ambush.guns, withRival: ambush.withRival, level: ambush.level } } : {}),
      ...(duel ? { duel: { jobId: duel.jobId, rivalId: duel.rival.id, started: duel.started } } : {}),
      ...(outpost ? { outpost } : {}),
      ...(race ? { race } : {}),
    };
  }

  /**
   * A race entered in this system (docs/PROCGEN.md §33): its course, heat and field, the pilot's par
   * and best. An entry for the other class of hull lapses here.
   */
  private raceHere(): RaceSetup | null {
    const state = this.state!;
    const e = racingLog(state)?.entry;
    const found = e ? courseById(e.course) : undefined;
    if (!e || !found || found.venue.systemId !== state.location.systemId) return null;
    if (raceClass(state.ship.model) !== e.cls) {
      endEntry(state, 'voided');
      toast(RACE_LINES.voided.replace('{class}', CLASS_NAMES[e.cls].toLowerCase()), 'bad', 6000);
      this.persist();
      return null;
    }
    const racers = lineUp(state, e.course, e.cls, e.heat);
    const par = ownParRun(found.line, state.ship);
    return {
      courseId: e.course,
      name: courseName(found.line),
      club: found.venue.club,
      cls: e.cls,
      closes: heatStart(e.heat + 1),
      racers,
      grid: gridOf(racers),
      par,
      best: racingLog(state)?.courses[courseKey(e.course, e.cls)]?.best?.raw ?? null,
      cutoff: RACING.cutoff * classPar(found.line, e.cls),
    };
  }

  /** What happens in a race: the marshal's countdown, the rivals' words at the start, gates missed, the finish and its card. */
  private onRace(e: RaceEvent): void {
    const state = this.state!;
    const winner = (field: readonly Standing[]) => [...field].filter((f) => f.time !== null).sort((a, b) => a.time! - b.time!)[0]?.id;
    switch (e.kind) {
      case 'count':
        if (e.n === RACING.start.countdown) this.comm(RACE_LINES.marshal, RACE_LINES.marshalStart, 2500);
        this.sfx('ui-click');
        break;
      case 'go': {
        this.sfx('ui-confirm');
        const entry = racingLog(state)?.entry;
        if (entry) {
          for (const r of lineUp(state, entry.course, entry.cls, entry.heat)) {
            const rival = r.rival ? rivalById(r.rival) : undefined;
            if (rival) this.comm(rivalName(rival), rng(WORLD_SEED, 'race-start', r.rival!, entry.heat).pick(RIVAL_START[rival.voice]), 4000);
          }
        }
        break;
      }
      case 'false-start':
        toast(RACE_LINES.falseStart, 'bad', 3500);
        this.sfx('ui-error');
        break;
      case 'gate':
        this.sfx('ui-click');
        break;
      case 'missed':
        toast(RACE_LINES.missed.replace('{n}', String(e.n)), 'bad', 3000);
        break;
      case 'finish': {
        const card = finishRace(state, e.raw, e.field);
        this.persist();
        if (!card) break;
        this.sfx(card.place === 1 ? 'mission-complete' : 'ui-confirm');
        void this.openRaceCard(card);
        break;
      }
      case 'cut':
      case 'retired':
      case 'lost': {
        const r = endEntry(state, e.kind, winner(e.field), e.field.length + 1);
        if (r) toast(e.kind === 'cut' ? RACE_LINES.cutoff : RACE_LINES.retired, 'info', 4000);
        this.persist();
        break;
      }
      case 'lapsed':
        if (endEntry(state, 'lapsed')) toast(RACE_LINES.lapsed, 'info', 5000);
        this.persist();
        break;
    }
  }

  /** The wing's order card (docs/PROCGEN.md §34): the game waits while it is open; the lead wingman answers. */
  private async openWingCard(): Promise<void> {
    const state = this.state;
    const flight = this.flight;
    if (!state || !flight || this.paused) return;
    this.setPaused(true, false);
    const pick = await showWingCard(state, flight.wingOptions());
    this.setPaused(false);
    const reply = pick && this.flight === flight ? flight.giveWingOrder(pick) : null;
    if (!reply) return;
    const lead = state.crew.find((w) => w.name === reply.speaker);
    this.comm(reply.speaker, `${lead && !lead.ally ? TRUST_PREFIX[trustBand(trustOf(lead))] : ''}${reply.text}`, 3500);
  }

  /** The result card: the game waits while it is open. */
  private async openRaceCard(card: RaceCard): Promise<void> {
    this.setPaused(true, false);
    await showRaceResult(card);
    this.setPaused(false);
  }

  /** The player's outpost in this system, as the flight scene needs it (docs/PROCGEN.md §29): turrets up, guards on post, a raid due. */
  private outpostHere(): NonNullable<ConstructorParameters<typeof FlightSession>[0]['traffic']>['outpost'] | null {
    const state = this.state!;
    const o = outpostIn(state, state.location.systemId);
    if (!o || o.stage <= 0) return null;
    defenceOf(o);
    const plan = nextRaid(state, o);
    return {
      locationId: outpostId(o.site),
      stage: o.stage,
      turrets: turretsUp(o, state.clock),
      // Guards on post, and those hired to come on post later (they join the flight at their time).
      guards: (o.defence?.guards ?? []).filter((g) => g.until > state.clock).map((g) => ({ id: g.id, name: g.name, model: g.model, skill: g.skill, from: g.from, until: g.until })),
      ...(plan && plan.at - state.clock < 2 * 3_600 ? { raid: { window: plan.window, at: plan.at, threat: plan.threat, ships: plan.ships } } : {}),
    };
  }

  /** What the player left in this system, if they come back soon enough (docs/PROCGEN.md §17); it is live again now. */
  private takeLingering(): { packs: Lingering['packs']; pods: Lingering['pods'] } | undefined {
    const state = this.state!;
    const l = state.world.lingering[state.location.systemId];
    if (!l) return undefined;
    delete state.world.lingering[state.location.systemId];
    return state.clock - l.at <= TRAFFIC.linger.seconds ? { packs: l.packs, pods: l.pods } : undefined;
  }

  /** Remembers what the player leaves in this system: packs that saw them, pods adrift, and the haulers they saw through. */
  private rememberLingering(): void {
    const state = this.state;
    const flight = this.flight;
    if (!state || !flight) return;
    for (const id of flight.haulsSeenThrough()) recordHaul(state.world, id, { at: state.clock, fate: 'safe', systemId: state.location.systemId });
    const l = flight.lingering();
    const all = state.world.lingering;
    const here = state.location.systemId;
    if (!l.packs.length && !l.pods.length) {
      delete all[here];
      return;
    }
    all[here] = { at: state.clock, ...l };
    const keys = Object.keys(all);
    if (keys.length > TRAFFIC.linger.maxSystems) delete all[keys.sort((a, b) => all[a]!.at - all[b]!.at)[0]!];
  }

  /** The far stars (docs/PROCGEN.md §25): the timeline set once the opening is done, and the stations' word as each moment comes. */
  private watchSky(state: GameState): void {
    if (scheduleSky(state)) this.persist();
    const now = skyMoment(state.clock);
    if (now !== this.skySaid) {
      this.skySaid = now;
      const line = now ? skyComm(now) : null;
      if (line) this.comm(line.speaker, line.text, 7000);
    }
    this.watchEdge(state);
  }

  /** Pyre (docs/PROCGEN.md §26): its warning set once the player is at the frontier, and the stations' word as each moment comes where the player is. */
  private watchEdge(state: GameState): void {
    if (scheduleEdge(state)) this.persist();
    // Pyre's lifeboats not got clear by the collapse (docs/PROCGEN.md §42.4).
    const lapsed = lifeboatsLapse(state);
    if (lapsed.length) {
      toast(LIFEBOAT_LINES.lapsed, 'bad', 7000);
      this.announceJobEvents(lapsed);
      this.persist();
    }
    const here = state.location.systemId;
    const now = edgeMoment(here, state.clock);
    const said = this.edgeSaid;
    this.edgeSaid = { kind: now, systemId: here };
    // A new system: its moments so far are its News, not the radio's.
    if (!said || said.systemId !== here || now === said.kind || !now) return;
    const line = edgeComm(now, here);
    if (line) this.comm(line.speaker, line.text, 7000);
  }

  private onDocked(locationId: string): void {
    const state = this.state!;
    this.leaveDuel();
    this.leaveOutpostRaid();
    this.flight?.writeBack(state);
    this.rememberLingering();
    // Customs at depots and military bases scan every ship that docks; tipped off by a rival, any lawful dock does (docs/PROCGEN.md §28).
    const dock = getLocation(locationId);
    const tip = isLawful(dock.factionId) ? tipoffIn(state, dock.systemId) : null;
    const customs = scansOnDocking(locationId) ?? (tip && isLawful(dock.factionId) ? dock.factionId : null);
    if (customs) {
      const tipped = tip ? `${spendTipoff(state, tip)} ` : '';
      const scan = customsScan(state, customs);
      if (scan.found.length || tipped) toast(`${tipped}${scan.text}`, scan.found.length ? 'bad' : 'info', 6000);
    }
    const out = dockAt(state, locationId);
    if (settleRacing(state, false)) toast(RACE_LINES.lapsed, 'info', 5000);
    this.persist();
    if (dockAccess(state, locationId) === 'emergency') {
      const faction = getLocation(locationId).factionId!;
      toast(
        occupied(locationId, state.clock, state.world.border)
          ? `The Hollow Wake holds ${getLocation(locationId).name}: emergency docking and repairs only.`
          : `Emergency docking only: the ${FACTIONS[faction].name} will repair you, and take your fines at the customs desk (News).`,
        'bad',
        6000,
      );
    }
    if (out.clearanceGranted) {
      this.sfx('ui-confirm');
      toast('Interstellar departure clearance granted.', 'good', 4500);
    }
    for (const n of out.watchNotes) toast(n.text, 'info', 6000);
    for (const n of out.lawNotes) toast(n, 'good', 6000);
    this.announceFleet(out.fleet);
    this.announceJobEvents(out.jobEvents, false);
    for (const n of out.sites.notes) toast(n.text, n.tone, 6000);
    this.announceJobEvents(out.sites.jobs, false);
    for (const n of out.allies) toast(n, 'info', 5000);
    this.announceStories(out.stories);
    this.announceCrew(out.crew);
    // The wing at a dock (docs/PROCGEN.md §34): rejoining, mended, a raise, credit, notice; orders start afresh.
    for (const n of settleWing(state, locationId)) toast(n.text, n.tone, 6000);
    this.wingCarry = 'free';
    const deliverable = Object.keys(state.jobs).some((id) => {
      const p = state.jobs[id]!;
      return p.status === 'active' && getJob(id, state).destinationLocationId === locationId;
    });
    const news = out.clearanceGranted || hasVoyage(state);
    const emergency = dockAccess(state, locationId) === 'emergency';
    const decision = !!choiceHere(state, locationId);
    this.enterDocked(
      locationId,
      emergency
        ? { room: 'bar', window: 'news', titleCard: true }
        : deliverable || decision
          ? { room: 'bar', window: 'jobs', titleCard: true }
          : news
            ? { room: 'deck', window: 'arrival', titleCard: true }
            : // Back at a station after the opening: where the player left off there.
              { ...((state.jobs.lifeline?.status === 'complete' && lastView(locationId)) || { room: 'deck', window: null }), titleCard: true },
    );
    this.tellStory();
    this.announceRanks(out.ranks);
    this.greetFolk(out.folk);
  }

  /**
   * The people at the pilot's outposts on docking (docs/PROCGEN.md §41.4): one fetched come aboard
   * at once; at an outpost, whoever has something to say, after any story told here.
   */
  private greetFolk(folk: DockOutcome['folk']): void {
    for (const n of folk.toasts) toast(n, 'good', 6000);
    const o = folk.outpost;
    if (!o || !folk.lines.length) return;
    this.persist();
    this.storyQueue = this.storyQueue
      .then(async () => {
        if (this.mode !== 'docked' || !this.state) return;
        await showFolkWords(this.state, o, folk.lines, folk.work ? WORK_WORDS[folk.work.trade].name : null);
        // A work built changes the station (its market, its repairs): show it so.
        if (folk.work) this.station?.render();
      })
      .catch((err) => console.error(err));
  }

  /** Ranks given or fallen at a dock (docs/PROCGEN.md §32): a fall said at once; a promotion's card after any story here. */
  private announceRanks(notes: RankNote[]): void {
    for (const n of notes) {
      if (n.kind === 'fell') {
        toast(n.text, 'bad', 7000);
        continue;
      }
      this.storyQueue = this.storyQueue
        .then(async () => {
          if (this.mode !== 'docked') return;
          this.sfx('mission-complete');
          await showPromotion(n);
          this.station?.render();
        })
        .catch((err) => console.error(err));
    }
    if (notes.length) this.persist();
  }

  // ------------------------------------------------------------------ flight events

  /** A raider of a bounty contract's pack went down: count it, and pay out when the pack is gone. */
  private onContractKill(jobId: string): void {
    const state = this.state!;
    const progress = state.jobs[jobId];
    if (!progress || progress.status !== 'active') return;
    progress.kills = (progress.kills ?? 0) + 1;
    state.stats.kills += 1;
    const o = currentObjective(state, jobId);
    if (o?.kind === 'bounty' && progress.kills < o.count) toast(`Contract target destroyed (${progress.kills}/${o.count})`, 'good', 3000);
    if (o?.kind === 'assault') {
      const n = Math.min(progress.kills, DENS.turrets);
      toast(n < DENS.turrets ? `Den turret destroyed (${n}/${DENS.turrets})` : 'The last turret is down: the reactor’s shield has failed!', 'good', 4000);
    }
    if (o?.kind === 'defend' && progress.kills < o.count) toast(`Sweep ship down (${progress.kills}/${o.count})`, 'good', 3000);
    this.announceJobEvents(advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId }));
    this.persist();
  }

  /** A raider from a pack destroyed by the player: the system's owner pays the bounty. */
  private onBounty(credits: number, name: string): void {
    const state = this.state!;
    const owner = WORLD.profiles.get(state.location.systemId)?.owner ?? null;
    const payer = owner && owner !== 'hollow-wake' ? owner : 'sta';
    state.stats.kills += 1;
    applyCredits(state, credits, 'bounty', `${name} bounty (${FACTIONS[payer].shortName})`);
    const change = adjustReputation(state.reputation, payer, 2);
    adjustReputation(state.reputation, 'hollow-wake', -3);
    this.sfx('credits');
    toast(`${name} destroyed. Bounty +${formatCredits(credits)}${change ? ` · ${FACTIONS[payer].shortName} ${signed(change)}` : ''}`, 'good', 4500);
    // Enough raiders down breaks a raid on the system (docs/PROCGEN.md §17).
    const broken = raidKill(state, state.location.systemId);
    if (broken) toast(broken.text, 'good', 6000);
    // Raiders downed on a front push the Wake back (docs/PROCGEN.md §20).
    recordDeed(state, state.location.systemId, BORDER.deeds.raiderKill);
    this.persist();
  }

  private onEncounterStart(def: EncounterDef): void {
    void def;
    this.hud.setEncounterBanner(true);
    toast('Hollow Wake raider inbound! Targeted automatically — you can also avoid the fight.', 'bad', 4500);
  }

  private onEncounterEnd(def: EncounterDef, outcome: EncounterOutcome): void {
    const state = this.state!;
    this.hud.setEncounterBanner(false);
    if (def.id === 'mars-raider') state.pirateOutcome = outcome;
    if (outcome === 'destroyed') {
      state.stats.kills += 1;
      applyCredits(state, def.bounty, 'bounty', 'Hollow Wake raider bounty (Transit Authority)');
      const change = adjustReputation(state.reputation, 'sta', 15);
      adjustReputation(state.reputation, 'hollow-wake', -10);
      this.sfx('credits');
      toast(`Raider destroyed. Bounty +${formatCredits(def.bounty)} · Transit Authority ${signed(change)} (${TIER_LABEL[standingTier(state.reputation.sta)]})`, 'good', 6000);
    } else if (outcome === 'escaped') {
      applyCredits(state, 80, 'bounty', 'Raider driven off (Transit Authority)');
      const change = adjustReputation(state.reputation, 'sta', 6);
      toast(`The raider fled. Transit Authority pays 80 cr for driving it off (${signed(change)} standing).`, 'good', 6000);
    } else {
      toast('Raider avoided. The route to Mars is clear.', 'info', 4000);
    }
    this.persist();
  }

  private async onDiscovery(bodyId: string): Promise<void> {
    const state = this.state!;
    this.scannedForFolk(bodyId);
    const { first, jobEvents } = discoverBody(state, bodyId);
    if (catalogue(state, bodyId)) this.hint = null;
    if (!first) return;
    this.persist();
    this.announceJobEvents(jobEvents);
    const planet = getPlanet(bodyId);
    if (!planet) {
      if (bodyId === 'sirius-b-close') toast('Close-range scan of Sirius B complete.', 'good');
      return;
    }
    this.sfx('scan');
    this.setPaused(true, false);
    await showModal({
      title: `Discovery: ${planet.displayName}`,
      body: planetCard(planet, true),
      actions: [{ label: 'Back to flight', value: 'ok', variant: 'primary', testId: 'discovery-ok' }],
      dismissValue: 'ok',
      testId: 'discovery-dialog',
    });
    this.setPaused(false);
  }

  /** A body scanned for one of the people at an outpost (docs/PROCGEN.md §41.2): ready to tell there. */
  private scannedForFolk(bodyId: string): void {
    const notes = scanFolk(this.state!, bodyId);
    for (const n of notes) toast(n, 'good', 6000);
    if (notes.length) this.persist();
  }

  private onScanInfo(t: Target): void {
    if (!t.bodyId) return;
    const state = this.state!;
    this.scannedForFolk(t.bodyId);
    // A comet's or a named asteroid's first scan goes in the logbook (docs/PROCGEN.md §46.1, §47.6).
    if (cometOf(t.bodyId) && noteComet(state, t.bodyId)) this.persist();
    if (asteroidOf(t.bodyId) && noteAsteroid(state, t.bodyId)) this.persist();
    // And a spacecraft's (§49.5).
    if (craftOf(t.bodyId) && noteCraft(state, t.bodyId)) this.persist();
    // Pyre and its black hole (docs/PROCGEN.md §26.5), a flaring star (§43.5), a pair's secondary (§44.5), a comet (§45.5) and an asteroid (§47.5): a scan is a reading for the work that wants one.
    if (t.bodyId === PYRE_ID || t.bodyId === PYRE_HOLE_ID || flareStar(t.bodyId) || orbitOf(t.bodyId)?.secondary === t.bodyId || cometOf(t.bodyId) || asteroidOf(t.bodyId)) {
      const jobs = recordObservation(state, t.bodyId, state.location.systemId);
      if (jobs.length) {
        toast(`${t.name}: readings recorded.`, 'good', 3000);
        this.announceJobEvents(advanceJobs(state, { dockedAt: null, systemId: state.location.systemId }));
        this.persist();
      }
    }
    if (catalogue(state, t.bodyId)) {
      const { done, total } = codexProgress(state);
      this.hint = null;
      toast(`Catalogued: ${t.name} · codex ${done}/${total}`, 'good', 3500);
      this.persist();
    }
    this.setPaused(true, false);
    const s = sheet(this.screenLayer, t.name, bodyCard(t.bodyId, t.name, state.clock, this.gameDate() ?? ORBIT_EPOCH_JD), () => this.setPaused(false), 'science-sheet');
    void s;
  }

  /**
   * Dialogs on a pad (a lane encounter's card among them, docs/PROCGEN.md §27): the D-pad moves
   * between the top dialog's buttons, A presses the one in focus (the first, before any), B closes it.
   */
  private padDialogs(): void {
    const top = [...document.querySelectorAll<HTMLElement>('.modal-backdrop')].at(-1);
    if (!top) return;
    const nav = this.gamepad.menu();
    if (!nav) return;
    if (nav === 'back') {
      top.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    const buttons = [...top.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (nav === 'confirm') (buttons[at] ?? buttons[0]!).click();
    else buttons[at < 0 ? 0 : (at + (nav === 'down' ? 1 : buttons.length - 1)) % buttons.length]!.focus();
  }

  /** A hail answered (docs/PROCGEN.md §27): its card, paused; the choice made, and what came of it in the save and the flight. */
  private async onAnswerHail(offer: LaneOffer): Promise<void> {
    const state = this.state!;
    this.setPaused(true, false);
    const pick = await showLaneCard(state, offer);
    const out = pick ? answerLane(state, offer, pick) : null;
    this.setPaused(false);
    this.flight?.laneOutcome(offer.id, out);
    if (!out) return;
    toast(out.text, out.tone, 6000);
    // A site to fly to, brought into the scene (docs/PROCGEN.md §31).
    const site = out.siteId ? siteSetup(state, out.siteId) : null;
    if (site) this.flight?.addSite(site);
    if (out.jobId) this.announceJobEvents(advanceJobs(state, { dockedAt: null, systemId: state.location.systemId }));
    this.persist();
  }

  /** What came of something at a site (docs/PROCGEN.md §31): notices, the radio, jobs, then a card to read, paused. */
  private announceSite(out: SiteOutcome): void {
    for (const n of out.notes) toast(n.text, n.tone, 5000);
    if (out.comm) this.comm(out.comm.speaker, out.comm.text, 5000);
    if (out.jobs.length) this.announceJobEvents(out.jobs);
    this.persist();
    if (out.card) void this.openSiteCard(out.card);
  }

  /** A log or a find's card: a lead followed (its trail begins), or the strongbox's ending chosen. */
  private async openSiteCard(card: SiteCard): Promise<void> {
    const state = this.state!;
    this.setPaused(true, false);
    const pick = await showSiteCard(card);
    this.setPaused(false);
    if (card.lead && pick === 'follow') {
      const r = followLead(state, card.site, card.lead.mystery);
      toast(r.message, r.ok ? 'good' : 'bad', 5000);
      const find = r.ok ? siteSetup(state, `mys.${card.lead.mystery}.1`) : null;
      if (find && find.systemId === state.location.systemId) this.flight?.addSite(find);
      if (r.ok) this.announceJobEvents(advanceJobs(state, { dockedAt: null, systemId: state.location.systemId }));
    } else if (card.choose) {
      toast(chooseEnding(state, pick === 'fence' ? 'fence' : 'insurer').message, 'info', 5000);
    }
    this.persist();
  }

  /** Jumps to Pyre refused now, and why (docs/PROCGEN.md §26). */
  private pyreClosed(state: GameState, from: SystemId): { closedTo?: ReadonlyMap<SystemId, string> } {
    const why = laneClosedReason(state.clock, hopsToPyre(from));
    return why ? { closedTo: new Map([[PYRE_ID, why]]) } : {};
  }

  /** Pyre exploded with the ship still in its system (docs/PROCGEN.md §26): its emergency drive carries it out (fiction). */
  private async onPyreBreakout(): Promise<void> {
    const state = this.state!;
    this.flight?.writeBack(state);
    const refuge = getLocation(pyreRefugeId());
    await showModal({
      title: 'Ship disabled',
      body: h(
        'div',
        { class: 'stack' },
        h('p', null, `The flash of ${getSystem(PYRE_ID).displayName} exploding floods the system and knocks out your ship’s systems. Its emergency drive carries it through the lane to ${refuge.name}.`),
        h('p', null, `Repairs cost up to ${formatCredits(RESCUE_FEE)} (you have ${formatCredits(state.credits)}). Your cargo is intact.`),
        h('p', { class: 'muted small' }, dataBadge('fictional'), ' Fiction: no ship this near an exploding star would live through it.'),
      ),
      actions: [{ label: 'Continue', value: 'ok', variant: 'primary', testId: 'pyre-rescue-ok' }],
      dismissValue: 'ok',
      testId: 'pyre-rescue-dialog',
    });
    const r = rescueFromPyre(state);
    toast(`Carried out of ${getSystem(PYRE_ID).displayName}: −${formatCredits(r.fee)}`, 'bad');
    // Observers carried out with the ship are where they wanted to be.
    this.announceJobEvents(advanceJobs(state, { dockedAt: r.dockId, systemId: getLocation(r.dockId).systemId }));
    await this.saves.save(state);
    this.enterDocked(r.dockId, {});
  }

  private async onPlayerDestroyed(): Promise<void> {
    const state = this.state!;
    this.leaveDuel();
    this.leaveOutpostRaid();
    const dock = getLocation(state.location.lastDockId);
    await showModal({
      title: 'Ship disabled',
      body: h(
        'div',
        { class: 'stack' },
        h('p', null, `A Transit Authority tug recovers your ship and brings it to ${dock.name}.`),
        h('p', null, `Rescue and repairs cost up to 150 cr (you have ${formatCredits(state.credits)}). Your cargo is intact.`),
      ),
      actions: [{ label: 'Continue', value: 'ok', variant: 'primary', testId: 'rescue-ok' }],
      dismissValue: 'ok',
      testId: 'rescue-dialog',
    });
    const r = rescueAfterDefeat(state);
    toast(`Rescued: −${formatCredits(r.fee)}`, 'bad');
    // The crew were aboard: hurt and shaken (docs/PROCGEN.md §30.5).
    if (crewAboard(state).length) toast('Your crew came through, hurt and shaken: a medic at any dock with repairs can treat them.', 'bad', 6000);
    // Passengers leave with the tug's crew: their trips are over (docs/PROCGEN.md §23).
    this.announceJobEvents(passengerJobs(state).flatMap((c) => failJob(state, c.id, `${partyName(c.contract?.party ?? [])} left with the tug’s crew`) ?? []));
    await this.saves.save(state);
    this.enterDocked(r.dockId, {});
  }

  // ------------------------------------------------------------------ map and jumps

  private mapState(): MapState {
    const state = this.state;
    const current = state?.location.systemId ?? 'sol';
    const objective = state ? primaryObjective(state) : null;
    return {
      currentSystemId: current,
      visited: new Set(state?.visitedSystems ?? ['sol']),
      credits: state?.credits ?? 0,
      readiness: state
        ? jumpReadiness(state, {
            hostilesNearby: this.flight?.hostilesNearby() ?? false,
            inLaneOrAutopilot: this.flight?.busy ?? false,
            escortBehind: this.flight?.escortBehind() ?? null,
          })
        : { canJump: false, reason: 'Start a game to travel.' },
      objectiveSystemId: objective?.targetSystemId ?? null,
      discoveredBodies: new Set(state?.discoveredBodies ?? []),
      feeCoverage: state ? this.feeCoverage() : null,
      news: state
        ? [
            ...newsAt(current, state.clock).map((n) => ({ id: n.event.id, systemId: n.event.systemId, kind: n.event.kind, headline: n.event.headline, detail: n.event.detail, active: n.active })),
            // Border fronts within reach that are fighting, on both of their systems.
            ...borderNews(current, state.clock)
              .filter((n) => atWar(n.state, 'law'))
              .flatMap((n) =>
                [n.state.front.lawSystem, n.state.front.wakeSystem].map((systemId) => ({ id: `border:${n.state.front.id}:${systemId}`, systemId, kind: 'border' as const, headline: n.headline, detail: n.detail, active: true })),
              ),
          ]
        : [],
      contractSystems: new Set(state ? activeJobIds(state).flatMap((id) => describeObjective(state, id)?.targetSystemId ?? []) : []),
      missions: state
        ? activeJobIds(state).flatMap((id) => {
            const o = describeObjective(state, id);
            return o?.targetSystemId ? [{ jobId: id, systemId: o.targetSystemId, title: o.jobTitle, step: o.text, primary: id === objective?.jobId }] : [];
          })
        : [],
      ...(state ? { catalogued: new Set(state.codex) } : {}),
      jumpReach: state ? performanceOf(state.ship).jumpReach : 0,
      // The lane to Pyre takes no arrivals from its collapse until its debris has thinned (docs/PROCGEN.md §26).
      ...(state ? this.pyreClosed(state, current) : {}),
      ...(state ? { inventedNote: pyreStatus(state.clock), inventedStations: pyreStationsNow(state.clock) } : {}),
      // Flare stars, and whether one flares now (docs/PROCGEN.md §43.4).
      ...(state ? { flares: new Map(flareSystems().map((id) => [id, flareStatus(id, state.clock)!] as const)) } : {}),
      // The game's date, for where the pairs with catalogued orbits stand (docs/PROCGEN.md §44.4).
      ...(this.gameDate() !== null ? { gameDate: this.gameDate()! } : {}),
    };
  }

  private feeCoverage(): MapState['feeCoverage'] {
    const s = this.state!;
    for (const [id, p] of Object.entries(s.jobs)) {
      if (p.status !== 'active') continue;
      const job = getJob(id, s);
      if (job.coversJumpFeesTo) return { systemId: job.coversJumpFeesTo, note: `Fee covered by contract: ${job.title}` };
    }
    return null;
  }

  /** The star map is a separate chunk, fetched the first time it opens. */
  private loadMap(): Promise<GalaxyMapView> {
    this.mapLoading ??= import('../galaxy/GalaxyMapView.ts').then(({ GalaxyMapView }) => {
      this.map = new GalaxyMapView({
        root: this.screenLayer,
        renderer: this.renderer.renderer,
        callbacks: { onJump: (route, fee) => this.startJump(route, fee), onClose: () => this.closeMap() },
        reducedMotion: this.settings.reducedMotion,
      });
      return this.map;
    });
    return this.mapLoading;
  }

  openMap(): void {
    if (this.map?.isOpen || this.mode === 'jump' || this.mode === 'title' || this.mode === 'map' || !this.state) return;
    if (!this.map) {
      void this.loadMap().then(() => this.openMap());
      return;
    }
    this.modeBeforeMap = this.mode;
    this.mode = 'map';
    clearToasts();
    this.station?.root.setAttribute('hidden', '');
    this.refreshFlightUi();
    this.map.resize(this.renderer.size.width, this.renderer.size.height);
    const objective = primaryObjective(this.state);
    this.map.open(this.mapState(), objective?.targetSystemId ?? undefined);
    this.loop.lowPower = false;
    this.soundscape.map(true);
  }

  private closeMap(): void {
    if (!this.map?.isOpen) return;
    this.map.close();
    this.mode = this.modeBeforeMap;
    this.station?.root.removeAttribute('hidden');
    this.loop.lowPower = this.mode === 'docked';
    this.refreshFlightUi();
    this.soundscape.map(false);
  }

  private startJump(route: Route, fee: number): void {
    const state = this.state!;
    const readiness = this.mapState().readiness;
    if (!readiness.canJump || route.hops.length === 0 || fee > state.credits) {
      toast(readiness.reason ?? 'Cannot jump right now.', 'bad');
      return;
    }
    // Jumping out of a race under way retires from it (docs/PROCGEN.md §33.4).
    if (this.flight?.raceUnderWay && endEntry(state, 'retired')) toast(RACE_LINES.retired, 'info', 4000);
    this.map?.close();
    this.mode = 'jump';
    this.refreshFlightUi();
    const dest = getSystem(route.to);
    const progress = h('span');
    const overlay = h(
      'div',
      { class: 'jump-overlay', 'data-testid': 'jump-overlay', role: 'status' },
      h(
        'div',
        { class: 'panel jump-card' },
        h('div', { class: 'eyebrow' }, 'Jump drive engaged ', dataBadge('fictional', 'Fictional technology')),
        h('h2', null, dest.displayName),
        h(
          'dl',
          { class: 'kv' },
          h('dt', null, 'Distance from Sol'),
          // Pyre's place is invented (docs/PROCGEN.md §26); every other system's is the archives'.
          h('dd', null, `${dest.distanceLightYears.toFixed(2)} ly `, isInventedSystem(dest.id) ? dataBadge('fictional', 'Invented') : dataBadge('observed')),
          h('dt', null, 'This jump'),
          h('dd', null, `${route.totalDistanceLy.toFixed(2)} ly via ${route.path.map((id) => getSystem(id).displayName).join(' → ')}`),
          h('dt', null, 'Transit time'),
          h('dd', null, `${route.totalTransitDays.toFixed(1)} days `, dataBadge('fictional')),
          h('dt', null, 'Fee'),
          h('dd', null, fee === 0 ? 'Covered by contract' : formatCredits(fee)),
        ),
        dest.positionSourceUrl ? h('p', { class: 'small' }, sourceLink({ label: 'Position source', url: dest.positionSourceUrl })) : null,
        h('div', { class: 'jump-progress' }, progress),
      ),
    );
    this.screenLayer.appendChild(overlay);
    this.jump = { route, fee, t: 0, phase: 'charge', overlay, progress, tunnel: null, tunnelScene: null, arrivalReady: false };
    this.sfx('jump-charge');
  }

  private updateJump(dt: number): void {
    const j = this.jump!;
    j.t += dt;
    const total = 4.2;
    j.progress.style.transform = `scaleX(${Math.min(1, j.t / total)})`;
    if (j.phase === 'charge') {
      // The ship keeps flying (straight) while the drive charges.
      if (this.flight) {
        const input = emptyInput();
        this.flight.update(dt, input);
        this.renderer.render(this.system!.scene, this.camera);
      }
      if (j.t >= 1.3) {
        j.phase = 'tunnel';
        const state = this.state!;
        this.leaveDuel();
        this.leaveOutpostRaid();
        this.flight?.writeBack(state);
        this.rememberLingering();
        // The wing's order carries over the jump (docs/PROCGEN.md §34).
        this.wingCarry = this.flight?.wingCarry() ?? 'free';
        this.disposeFlight();
        // Out of Pyre's system with its lifeboats aboard before the collapse (docs/PROCGEN.md §42.4).
        const clear = lifeboatsClear(state, state.location.systemId);
        if (clear.length) toast(LIFEBOAT_LINES.clear, 'good', 6000);
        const events = [...clear, ...performJump(state, j.route, j.fee)];
        this.announceJobEvents(events);
        for (const n of settleLaw(state)) toast(n, 'good', 6000);
        const wing = payWing(state, j.route.hops.length);
        if (wing.paid) toast(`Wing fees: ${formatCredits(wing.paid)}`, 'info', 3000);
        for (const note of wing.notes) toast(note, 'bad', 5000);
        // The wing is paid first: a hauler loading out of sight never leaves it unpaid.
        this.announceFleet(settleFleet(state));
        this.announceStories(settleRivalStories(state));
        void this.saves.save(state);
        // Build the tunnel scene, then load the destination while the tunnel plays.
        j.tunnelScene = new THREE.Scene();
        j.tunnelScene.add(this.camera);
        this.camera.position.set(0, 0, 0);
        this.camera.quaternion.identity();
        j.tunnel = createJumpTunnel(this.artCtx);
        this.camera.add(j.tunnel.object);
        this.system?.dispose();
        this.system = null;
        this.loadSystem(state.location.systemId);
        j.tunnelScene.add(this.camera);
        j.arrivalReady = true;
      }
      return;
    }
    const k = Math.min(1, (j.t - 1.3) / (total - 1.3));
    j.tunnel?.setProgress(k);
    j.tunnel?.update?.(dt, j.t, this.camera);
    this.camera.updateMatrixWorld();
    if (j.tunnelScene) this.renderer.render(j.tunnelScene, this.camera);
    if (k >= 1 && j.arrivalReady) {
      if (j.tunnel) {
        this.camera.remove(j.tunnel.object);
        j.tunnel.dispose();
      }
      j.overlay.remove();
      this.jump = null;
      this.system!.scene.add(this.camera);
      this.enterFlight({ kind: 'arrival' });
      const dest = getSystem(this.state!.location.systemId);
      toast(`Arrived: ${dest.displayName} — ${dest.distanceLightYears.toFixed(2)} ly from Sol`, 'good', 4000);
      this.announceSystemEvent();
      this.persist();
    }
  }

  // ------------------------------------------------------------------ pause, sheets

  setPaused(paused: boolean, showMenu = true): void {
    if (this.mode !== 'flight') return;
    if (paused === this.paused) return;
    this.paused = paused;
    this.pauseEl?.remove();
    this.pauseEl = null;
    if (paused && showMenu) {
      this.persist();
      this.pauseEl = h(
        'section',
        { class: 'screen pause-menu', role: 'dialog', 'aria-label': 'Paused', 'data-testid': 'pause-menu' },
        h(
          'div',
          { class: 'panel pause-card' },
          h('h2', null, 'Paused'),
          button('Resume', { variant: 'primary', size: 'lg', icon: 'play', testId: 'pause-resume', onClick: () => this.setPaused(false) }),
          button('Star map', { icon: 'map', onClick: () => {
            this.setPaused(false);
            this.openMap();
          } }),
          button('Saves', { icon: 'save', testId: 'saves-open', onClick: () => this.openSaves() }),
          button('Controls', { icon: 'help', onClick: () => this.openControls() }),
          button('Settings', { icon: 'settings', testId: 'pause-settings', onClick: () => this.openSettings() }),
          button('About the science', { icon: 'source', onClick: () => this.openAbout(this.state?.location.systemId) }),
          button('Save and quit to title', { icon: 'back', testId: 'pause-quit', onClick: () => void this.quitToTitle() }),
        ),
      );
      this.screenLayer.appendChild(this.pauseEl);
      this.pauseEl.querySelector<HTMLButtonElement>('button')?.focus();
    }
    this.refreshFlightUi();
  }

  private async quitToTitle(): Promise<void> {
    this.persist();
    await this.saves.flush();
    this.disposeFlight();
    this.hud.setEncounterBanner(false);
    await this.showTitle();
  }

  private openControls(title = 'Controls', tip?: string): void {
    const wasPaused = this.paused;
    if (this.mode === 'flight' && !wasPaused) this.setPaused(true, false);
    this.sheetsOpen++;
    const content = controlsContent(this.settings.steering, this.scheme);
    if (tip) content.prepend(h('p', { class: 'callout good', 'data-testid': 'flight-school-tip' }, tip));
    sheet(this.screenLayer, title, content, () => {
      this.sheetsOpen--;
      if (this.mode === 'flight' && !wasPaused) this.setPaused(false);
    }, 'controls-sheet');
  }

  private openSettings(): void {
    this.sheetsOpen++;
    sheet(
      this.screenLayer,
      'Settings',
      settingsContent(this.settings, {
        onChange: (next) => this.applySettings(next),
        onResetSave: () => void this.resetSave(),
        deviceReport: () => this.deviceReport(),
      }),
      () => this.sheetsOpen--,
      'settings-sheet',
    );
  }

  /** The device report in Settings: this device, its browser and how the game runs on it. */
  private async deviceReport(): Promise<string> {
    const facts = await collectDeviceFacts({
      build: __BUILD_ID__,
      graphics: this.renderer.graphicsInfo(),
      quality: { setting: this.settings.quality, preset: this.renderer.quality, pixelRatio: this.renderer.pixelRatio, bloom: this.renderer.useBloom },
      frameRate: this.flightFrames.summary(),
      sound: { state: this.audio.state === 'running' ? 'on' : this.audio.state === 'locked' ? 'waiting for a first tap or key press' : 'unavailable', muted: this.settings.muted },
      textScale: this.settings.textScale,
      reducedMotion: this.settings.reducedMotion,
    });
    return formatReport(facts);
  }

  /** The autosave and the save slots, with export and import: from the title, the pause menu or the station menu. */
  private openSaves(): void {
    const inGame = this.mode !== 'title' && this.state !== null;
    const wasPaused = this.paused;
    if (this.mode === 'flight' && !wasPaused) this.setPaused(true, false);
    this.sheetsOpen++;
    openSaves(this.screenLayer, {
      saves: this.saves,
      current: inGame
        ? () => {
            this.persist();
            return this.state;
          }
        : null,
      play: (state, message) => void this.playLoaded(state, message),
      onClose: () => {
        this.sheetsOpen--;
        if (this.mode === 'flight' && !wasPaused) this.setPaused(false);
      },
    });
  }

  /** The pilot's logbook (docs/PROCGEN.md §46.4). */
  private openLogbook(): void {
    const state = this.state;
    if (!state) return;
    this.sheetsOpen++;
    openLogbook(this.screenLayer, state, () => this.sheetsOpen--);
  }

  private openAbout(systemId?: SystemId): void {
    const wasPaused = this.paused;
    if (this.mode === 'flight' && !wasPaused) this.setPaused(true, false);
    this.sheetsOpen++;
    void import('../ui/encyclopedia.ts').then(({ openEncyclopedia }) => openEncyclopedia(this.screenLayer, {
      discoveredBodies: new Set(this.state?.discoveredBodies ?? []),
      ...(this.state ? { catalogued: new Set(this.state.codex) } : {}),
      ...(systemId ? { initialSystemId: systemId } : {}),
      ...(this.gameDate() !== null ? { gameDate: this.gameDate()! } : {}),
      onClose: () => {
        this.sheetsOpen--;
        if (this.mode === 'flight' && !wasPaused) this.setPaused(false);
      },
    }));
  }

  private async resetSave(): Promise<void> {
    const ok = await confirmDialog(
      'Reset saved game?',
      'This deletes the autosave in this browser. Save slots and settings are kept.',
      'Delete save',
      { danger: true },
    );
    if (!ok) return;
    await this.saves.reset();
    this.state = null;
    useWorldLog(null);
    useGameStart(null);
    document.querySelectorAll('.sheet-backdrop').forEach((el) => el.remove());
    this.sheetsOpen = 0;
    this.disposeFlight();
    toast('Save deleted.', 'info');
    await this.showTitle();
  }

  // ------------------------------------------------------------------ persistence

  /** Snapshot the state (including flight pose) and queue an atomic save. */
  persist(): void {
    const state = this.state;
    if (!state) return;
    // Milestones are noticed whenever the game saves.
    for (const m of checkMilestones(state)) {
      this.sfx('mission-complete');
      toast(`Milestone: ${m.title}${m.id === 'codex-all' ? ` · Frontier Cooperative grant +${formatCredits(CODEX_GRANT)}` : ''}`, 'good', 5000);
    }
    if (this.flight && this.mode !== 'jump') {
      this.flight.writeBack(state);
      if (!state.location.dockedAt && this.flight.alive) state.location.flight = this.flight.pose();
    }
    void this.saves.save(state);
  }

  private onVisibility(visible: boolean): void {
    this.audio.setSuspended(!visible);
    if (!visible) {
      this.persist();
      this.touch.resetPointers();
    }
  }

  // ------------------------------------------------------------------ frame

  private onResize(): void {
    this.renderer.resize();
    const { width, height } = this.renderer.size;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.flight?.setViewport(width, height);
    this.interior?.resize(width, height);
    this.map?.resize(width, height);
  }

  private onGlobalKey(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    const modalOpen = !!document.querySelector('.modal-backdrop, .sheet-backdrop');
    if (e.key === 'Escape' && this.mode === 'flight' && this.paused && this.pauseEl && !this.sheetsOpen && !modalOpen) {
      e.preventDefault();
      this.setPaused(false);
    } else if (e.key === 'Escape' && this.mode === 'map' && !modalOpen) {
      e.preventDefault();
      this.closeMap();
    } else if (e.code === 'KeyM' && this.mode === 'map' && !modalOpen && !(e.target instanceof HTMLInputElement)) {
      // Tab stays free for keyboard focus navigation inside the map.
      e.preventDefault();
      this.closeMap();
    }
  }

  private tick(rawDt: number): void {
    const dt = rawDt * this.timeScale;
    // Docked and menu screens draw every other refresh (Loop.lowPower), which is not slowness.
    this.renderer.recordFrame(rawDt, this.loop.lowPower ? 2 : 1);
    if (this.mode === 'flight' && !this.paused) this.flightFrames.frame(rawDt);
    this.onResizeIfNeeded();
    this.fpsTimer -= rawDt;
    if (this.settings.showFps && this.fpsTimer <= 0) {
      this.fpsTimer = 0.5;
      this.fpsEl.textContent = `${Math.round(this.renderer.fps)} fps · ${this.renderer.quality} · ${Math.round(this.renderer.pixelRatio * 100) / 100}x`;
    }
    if (this.renderer.contextLost) return;
    // Pads are read every frame on every screen, so a press counts once and never carries over.
    this.gamepad.update();
    this.padDialogs();
    switch (this.mode) {
      case 'docked':
        if (this.interior) {
          this.interior.update(rawDt);
          this.renderer.render(this.interior.scene, this.interior.camera);
          break;
        }
        this.dockedView?.update(rawDt);
        if (this.system) this.renderer.render(this.system.scene, this.camera);
        break;
      case 'title':
        this.dockedView?.update(rawDt);
        if (this.system) this.renderer.render(this.system.scene, this.camera);
        break;
      case 'map':
        // Back closes the star map, as it opened it.
        if (this.gamepad.pressed('map') && !document.querySelector('.modal-backdrop, .sheet-backdrop')) {
          this.closeMap();
          break;
        }
        this.map?.render(rawDt);
        break;
      case 'jump':
        this.updateJump(rawDt);
        break;
      case 'flight':
        this.tickFlight(dt);
        break;
      default:
        break;
    }
  }

  private onResizeIfNeeded(): void {
    const w = this.canvas.clientWidth;
    const h2 = this.canvas.clientHeight;
    const size = this.renderer.size;
    if (w && h2 && (w !== size.width || h2 !== size.height)) this.onResize();
  }

  private tickFlight(dt: number): void {
    const flight = this.flight;
    const state = this.state;
    if (!flight || !state || !this.system) return;
    if (this.paused || this.sheetsOpen > 0) {
      // Start closes the pause menu, as Esc does.
      if (this.gamepad.pressed('pause') && this.pauseEl && !this.sheetsOpen && !document.querySelector('.modal-backdrop, .sheet-backdrop')) {
        this.setPaused(false);
      }
      this.renderer.render(this.system.scene, this.camera);
      return;
    }
    state.clock += dt;
    const input = emptyInput();
    this.desktop.poll(dt, input);
    this.touch.poll(input);
    this.gamepad.poll(dt, input, this.scheme === 'gamepad');
    if (input.actions.has('map')) {
      input.actions.delete('map');
      this.openMap();
      return;
    }
    if (input.actions.has('pause')) {
      this.setPaused(true);
      return;
    }
    if (input.actions.has('help')) {
      input.actions.delete('help');
      this.openControls();
      return;
    }
    // The fleet keeps up in flight: its steps as they fall due, a raid due in sight left to the flight.
    this.fleetTimer -= dt;
    if (this.fleetTimer <= 0) {
      this.fleetTimer = 1;
      const fleet = settleFleet(state, { inSight: new Set(flight.captainsInSight()) });
      if (fleet.steps) {
        this.announceFleet(fleet);
        this.persist();
      }
      if (this.announceStories(settleRivalStories(state))) this.persist();
      // Sites elsewhere whose time ran out (never one in this system while the pilot flies here).
      const sites = settleSites(state, state.location.systemId);
      if (sites.notes.length || sites.jobs.length) this.announceSite(sites);
      // An entry whose heat closed before a start lapses (one staged in this flight says so itself).
      if (!flight.raceStaged && settleRacing(state, false)) {
        toast(RACE_LINES.lapsed, 'info', 5000);
        this.persist();
      }
      this.watchSky(state);
    }
    this.objectiveTimer -= dt;
    if (this.objectiveTimer <= 0) {
      this.objectiveTimer = 0.4;
      const obj = primaryObjective(state);
      this.objectiveText = obj
        ? obj.text
        : state.jobs[LIFELINE_ID]?.status === 'complete'
          ? (this.hint ??= whatNext(state) ?? 'Free exploration: open the star map and visit any system.')
          : 'Accept a contract at a station, or explore.';
      const here = obj && obj.targetSystemId === state.location.systemId;
      flight.setObjective(here ? obj.targetLocationId : null, here ? obj.targetBodyId : null, here ? (obj.targetId ?? null) : null);
    }
    flight.update(dt, input);
    const hudModel = flight.hud;
    this.soundscape.update(dt, { position: flight.player.position, inLane: hudModel.inLane, cruising: hudModel.cruise === 'on', combat: hudModel.encounterActive });
    const scan = flight.scanStatus;
    const fines = totalFines(state);
    const travelling = finesTravelling(state);
    this.hud.update(hudModel, {
      credits: state.credits,
      cargoUsed: cargoUsed(state.ship.cargo),
      cargoCapacity: cargoCapacity(state.ship),
      objective: scan ? `Cargo scan by a ${FACTIONS[scan.faction].shortName} patrol: hold your course (${Math.ceil(scan.left)} s)` : this.objectiveText,
      wanted: fines > 0 ? `Wanted · fines ${formatCredits(fines)}` : travelling > 0 ? `News of your crime is spreading (${formatCredits(travelling)})` : null,
      systemName: getSystem(state.location.systemId).displayName,
      scaleNote: `Local scale compressed · ${this.system.def.scaleNote}`,
    });
    if (this.touch.visible) {
      const ctx = hudModel.context;
      this.touch.setContextAction(ctx?.label ?? null, ctx?.action ?? null, ctx?.icon);
      this.touch.setCruiseState(hudModel.race?.sealedCruise ? 'sealed' : hudModel.cruise);
      this.touch.setCounts(hudModel.missiles, hudModel.repairKits, hudModel.decoys);
      this.touch.setWing(hudModel.wing);
      this.touch.setThrottle(hudModel.throttle);
      this.touch.setDrift(hudModel.drift);
    }
    this.renderer.render(this.system.scene, this.camera);
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 20) {
      this.autosaveTimer = 0;
      this.persist();
    }
  }

  // ------------------------------------------------------------------ context loss

  private showContextLost(): void {
    if (this.contextLostEl) return;
    this.persist();
    this.contextLostEl = h(
      'section',
      { class: 'screen context-lost', role: 'alertdialog', 'aria-label': 'Graphics interrupted', 'data-testid': 'context-lost' },
      h(
        'div',
        { class: 'panel panel-pad stack', style: 'max-width: 26rem' },
        h('h2', null, 'Graphics interrupted'),
        h('p', null, 'The browser paused 3D graphics (this can happen when a device is low on memory). Your progress is saved.'),
        h('p', { class: 'muted small' }, 'The game resumes by itself when graphics come back. If it does not, reload.'),
        button('Reload', { variant: 'primary', onClick: () => window.location.reload() }),
      ),
    );
    this.ui.appendChild(this.contextLostEl);
  }

  private hideContextLost(): void {
    this.contextLostEl?.remove();
    this.contextLostEl = null;
    this.onResize();
  }

  // ------------------------------------------------------------------ test hooks

  /** Read-only hooks for automated browser tests (enabled with ?test=1). */
  testApi() {
    return {
      mode: () => this.mode,
      /** Test-only: the last lines the radio said, oldest first. */
      comms: () => [...this.said],
      paused: () => this.paused,
      state: () => (this.state ? structuredClone(this.state) : null),
      hud: () => (this.flight ? structuredClone(this.flight.hud) : null),
      scheme: () => this.scheme,
      audioState: () => this.audio.state,
      framesDrawn: () => this.renderer.framesDrawn,
      setTimeScale: (s: number) => {
        this.timeScale = Math.max(0.1, Math.min(8, s));
      },
      player: () => {
        const f = this.flight;
        if (!f) return null;
        const p = f.player.position;
        const q = f.player.quaternion;
        return {
          position: [p.x, p.y, p.z],
          quaternion: [q.x, q.y, q.z, q.w],
          speed: f.player.speed,
          energy: f.player.energy,
          alive: f.alive,
          autopilot: f.autopilotMode,
        };
      },
      selectTarget: (id: string) => this.flight?.selectTarget(id),
      targets: () => this.flight?.allTargets().map((t) => ({ id: t.id, name: t.name, kind: t.kind, hostile: !!t.hostile })) ?? [],
      goTo: (id: string) => this.flight?.beginGoTo(id, id.startsWith('station:')),
      avoidCombat: () => this.flight?.avoidCombat(),
      npcs: () => this.flight?.debugNpcs() ?? [],
      dronesHit: () => this.flight?.dronesHit ?? 0,
      touchState: () => ({
        visible: this.touch.visible,
        steer: this.touch.model.steer.active,
        aim: this.touch.model.aim.active,
        steerVector: this.touch.model.steer.vector,
        aimVector: this.touch.model.aim.vector,
      }),
      /** Test-only: jump straight to a system's arrival point (screenshots, visual checks). */
      warp: (systemId: SystemId) => {
        if (!this.state) this.state = createNewGame(7);
        this.state.location = { ...this.state.location, systemId, dockedAt: null, flight: null };
        if (!this.state.visitedSystems.includes(systemId)) this.state.visitedSystems.push(systemId);
        this.state.flags.flightSchool = true;
        this.enterFlight({ kind: 'arrival' });
      },
      /** Test-only: dock at a station without flying there (a blockaded lane is no place for a test to be). */
      dockAt: (locationId: string) => {
        if (!this.state) return;
        this.state.location = { ...this.state.location, systemId: getLocation(locationId).systemId, dockedAt: null, flight: null };
        if (!this.state.visitedSystems.includes(this.state.location.systemId)) this.state.visitedSystems.push(this.state.location.systemId);
        this.onDocked(locationId);
      },
      /** Test-only: sets the save's own seed, which a new game draws at random, so its luck is the same every run. */
      setSeed: (seed: number) => {
        if (this.state) this.state.seed = seed;
      },
      /** Test-only: the career record the ratings read (raiders downed, contract pay, sales), docs/PROCGEN.md §13. */
      setRecord: (r: { kills?: number; rewards?: number; sales?: number }) => {
        if (!this.state) return;
        if (r.kills !== undefined) this.state.stats.kills = r.kills;
        if (r.rewards !== undefined) this.state.stats.rewards = r.rewards;
        if (r.sales !== undefined) this.state.stats.sales = r.sales;
      },
      /** Test-only: ranks held with each faction, what they open here, and the save's records (docs/PROCGEN.md §32). */
      ranks: () => {
        const state = this.state;
        if (!state) return null;
        const here = state.location.dockedAt;
        return {
          held: Object.fromEntries(RANK_FACTIONS.map((f) => [f, heldRank(state, f)])),
          earned: Object.fromEntries(RANK_FACTIONS.map((f) => [f, earnedRank(state, f)])),
          records: state.ranks ?? {},
          limit: activeLimit(state),
          covered: here ? coveredAt(state, here) : false,
        };
      },
      /** Test-only: the first commission (docs/PROCGEN.md §32.4) a station posts from a moment on, needing this rank or less, and a den. */
      findCommission: (arg: { at: string; from: number; rank?: number }) => {
        for (let e = boardEpoch(arg.from) + 1; e < boardEpoch(arg.from) + 80; e++) {
          const c = boardFor(arg.at, e).find((x) => x.requires?.rank && x.requires.rank.rank <= (arg.rank ?? 3));
          if (c) return { id: c.id, title: c.title, at: e * CONTRACTS.epochSeconds };
        }
        return null;
      },
      den: () => ALL_LOCATIONS.find((l) => l.stationType === 'pirate-den' && l.status === 'functional')?.id ?? null,
      /** Test-only: a racing club (docs/PROCGEN.md §33), in a system or at a level, and its courses. */
      findRaceVenue: (arg: { system?: string; level?: number } = {}) => {
        const v = venues().find((x) => (!arg.system || x.systemId === arg.system) && (!arg.level || x.level === arg.level));
        return v ? { locationId: v.locationId, systemId: v.systemId, level: v.level, club: v.club, sprint: v.courses.sprint.id, run: v.courses.run.id } : null;
      },
      /** Test-only: the racing log, and the race staged in this flight. */
      race: () => {
        const state = this.state;
        if (!state) return null;
        const e = racingLog(state)?.entry;
        return { log: racingLog(state) ?? null, status: this.flight?.raceStatus() ?? null, record: e ? (clubRecord(e.course, e.cls)?.time ?? null) : null };
      },
      /** Test-only: every racer's final time, flown on ahead from where they are now. */
      raceField: () => this.flight?.raceField() ?? [],
      /** Test-only: the ship in the start box (gate -1), or just short of a gate with the race clock at `at`. */
      raceAt: (arg: { gate: number; at?: number }) => this.flight?.raceAt(arg.gate, arg.at) ?? false,
      /** Test-only: set standing with a faction (the law and the outlaw path). */
      setReputation: (faction: 'sta' | 'frontier' | 'hollow-wake', value: number) => {
        if (!this.state) return;
        this.state.reputation[faction] = value;
      },
      /** Test-only: mark jobs complete (to start a story arc part-way through). */
      completeJobs: (ids: string[]) => {
        if (!this.state) return;
        for (const id of ids) {
          // A contract still on a board is taken first, as accepting it would.
          const posted = this.state.contracts[id] ? null : postedContract(id);
          if (posted) this.state.contracts[id] = structuredClone(posted);
          const job = getJob(id, this.state);
          this.state.jobs[id] = { status: 'complete', objectiveIndex: job.objectives.length, acceptedAt: this.state.clock, completedAt: this.state.clock };
          // A finale's lasting mark, or a decisive operation's settled front, comes with it, as when it is flown.
          const mark = storyMark(this.state, job.story);
          if (mark) leaveMark(this.state, mark);
          const c = job.contract;
          if (c?.decisive && c.front && !this.state.world.border[c.front]?.ending) settleFront(this.state, c.front, c.side === 'wake' ? 'wake' : 'law');
        }
        this.state.flags.clearance = true;
        this.station?.render();
      },
      /** Test-only: damage the ship's systems, set its decoys, or fill the stash (combat depth checks). */
      setCombat: (patch: { systems?: GameState['ship']['systems']; decoys?: number; stash?: string[] }) => {
        if (!this.state) return;
        if (patch.systems) this.state.ship.systems = { ...patch.systems };
        if (patch.decoys !== undefined) this.state.ship.decoys = patch.decoys;
        if (patch.stash) this.state.stash = [...patch.stash];
        this.station?.render();
      },
      /** Test-only: set the fines owed to a faction. */
      setFines: (faction: 'sta' | 'frontier', amount: number) => {
        if (!this.state) return;
        this.state.law.fines[faction] = amount;
      },
      /** Test-only: set what the hold carries, as if bought (an outpost's materials, docs/PROCGEN.md §22). */
      setCargo: (cargo: GameState['ship']['cargo']) => {
        if (!this.state) return;
        this.state.ship.cargo = { ...cargo };
        this.station?.render();
      },
      /** Test-only: set the wallet (shipyard and outfitter checks). */
      setCredits: (credits: number) => {
        if (!this.state) return;
        this.state.credits = credits;
        this.station?.render();
      },
      /** Test-only: let game time pass (as in flight), then settle the fleet as docking does. */
      advanceClock: (seconds: number) => {
        if (!this.state) return;
        this.state.clock += Math.max(0, seconds);
        this.announceFleet(settleFleet(this.state));
        this.announceStories(settleRivalStories(this.state));
        const sites = settleSites(this.state, this.mode === 'flight' ? this.state.location.systemId : null);
        for (const n of sites.notes) toast(n.text, n.tone, 5000);
        this.announceJobEvents(sites.jobs, false);
        this.persist();
        this.station?.render();
      },
      /**
       * Test-only: the first shortage from `from` on (hour by hour) whose first relief hauler gets
       * through on the timetable, and that hauler (docs/PROCGEN.md §21).
       */
      findRelief: (from: number) => {
        for (let t = from; t < from + 400 * 3_600; t += 3_600) {
          for (const e of eventsAt(t)) {
            const h = reliefHauls(e)[0];
            if (!h || !haulFate(h).delivered || h.depart < t) continue;
            return { eventId: e.id, at: e.locationId!, haul: { id: h.id, name: h.name, from: h.from, fromName: getLocation(h.from).name, to: h.to, path: h.path, depart: h.depart, arrive: h.arrive, qty: h.qty } };
          }
        }
        return null;
      },
      /** Test-only: the first glut from `from` on (hour by hour) whose first shipment sets off after it (docs/PROCGEN.md §21.6). */
      findGlut: (from: number) => {
        for (let t = from; t < from + 400 * 3_600; t += 3_600) {
          for (const e of eventsAt(t)) {
            const h = shipsOut(e) ? shipments(e)[0] : undefined;
            if (!h || e.start < from || !getLocation(e.locationId!).services.includes('market')) continue;
            return { eventId: e.id, at: e.locationId!, start: e.start, commodity: h.commodity, haul: { id: h.id, name: h.name, to: h.to, toName: getLocation(h.to).name, depart: h.depart, arrive: h.arrive, qty: h.qty } };
          }
        }
        return null;
      },
      /**
       * Test-only: the first relief haul or shipment from `from` on whose way crosses a raid, within an
       * escort's reach, from a station with a board: its sender posts an escort for it (docs/PROCGEN.md §21.7).
       */
      findReliefEscort: (from: number) => {
        for (let t = from; t < from + 400 * 3_600; t += 3_600) {
          for (const e of eventsAt(t)) {
            for (const h of eventHauls(e)) {
              // A minute after its event begins, its sender's board posts an escort for it.
              const at = e.start + 60;
              if (e.start < from || h.depart <= at || !raidsOnWay(h).length || !boardFor(h.from, boardEpoch(at)).some((c) => c.contract?.haul === h.id)) continue;
              return { eventId: e.id, start: e.start, at, giver: h.from, haul: { id: h.id, name: h.name, to: h.to, toName: getLocation(h.to).name, depart: h.depart, path: h.path, qty: h.qty } };
            }
          }
        }
        return null;
      },
      /** Test-only: sets when the far stars' first neutrino alert comes (docs/PROCGEN.md §25). */
      skyFrom: (at: number) => {
        if (!this.state) return;
        this.state.world.sky = { from: at };
        this.station?.render();
      },
      /** Test-only: the far stars' timeline in this save, and how they look now. */
      sky: () => {
        const from = this.state?.world.sky?.from ?? null;
        if (!this.state || from === null) return null;
        const look = (id: string) => farStarLook(id, this.state!.clock, from);
        return { from, timeline: skyTimeline(from), betelgeuse: look('betelgeuse'), antares: look('antares') };
      },
      /**
       * Test-only: the first lane encounter (docs/PROCGEN.md §27) from a moment on, in the given systems
       * (or any, or only those without raider packs), of a kind and trap or not if asked: where, when, and what.
       */
      findLane: (arg: { from: number; kind?: LaneKind; trap?: boolean; systems?: SystemId[]; quiet?: boolean }) => {
        // `quiet`: only systems no raider packs roam, so nothing comes for a ship sitting still.
        const systems = (arg.systems ?? SYSTEMS.map((x) => x.id)).filter((id) => !arg.quiet || !trafficFor(id, 'high').plan.packs);
        for (let slot = laneSlot(arg.from) + 1; slot < laneSlot(arg.from) + 400; slot++) {
          for (const id of systems) {
            const o = laneEncounter(id, slot);
            if (o && (!arg.kind || o.kind === arg.kind) && (arg.trap === undefined || o.trap === arg.trap)) return o;
          }
        }
        return null;
      },
      /** Test-only: the first scan slot from a moment on holding a find (docs/PROCGEN.md §31.3) in the given systems (or any), of a kind if asked. */
      findScanFind: (arg: { from: number; kind?: SiteKind; systems?: SystemId[]; dark?: boolean; guard?: boolean }) => {
        const systems = arg.systems ?? SYSTEMS.map((x) => x.id);
        for (let slot = scanSlot(arg.from) + 1; slot < scanSlot(arg.from) + 400; slot++) {
          for (const id of systems) {
            const f = scanFind(id, slot);
            if (!f || (arg.kind && f.kind !== arg.kind) || (arg.dark !== undefined && (f.dark !== null) !== arg.dark) || (arg.guard !== undefined && (f.guard !== null) !== arg.guard)) continue;
            return { id: f.id, systemId: f.systemId, slot, kind: f.kind, ship: f.ship, body: f.body, at: slot * WRECKS.scan.slotSeconds };
          }
        }
        return null;
      },
      /** Test-only: the sites this save has marked, and how the flight scene has them. */
      sites: () => ({ log: this.state?.world.wrecks ?? null, flight: this.flight?.debugSites() ?? [] }),
      /** Test-only: the trail under way, its record and where it leads. */
      mystery: () => {
        const id = this.state ? mysteryUnderWay(this.state) : null;
        const rec = id ? this.state!.world.wrecks!.mysteries![id]! : null;
        return id && rec ? { id, record: rec, places: mysteryPlaces(id, rec.from) } : null;
      },
      /** Test-only: lets lane encounters hail in this browser test (they are off in tests otherwise). */
      meetLanes: (on: boolean) => {
        this.lanesInTests = on;
        this.flight?.setLanes(on);
      },
      /** Test-only: the lane encounters this save has met, the hail waiting in flight, and what the pilot would meet here now. */
      lanes: () => ({
        met: this.state?.world.lanes ?? {},
        hail: this.flight?.hailState ?? null,
        kinds: LANE_KINDS,
        now: this.state ? (laneOfferFor(this.state, this.state.location.systemId)?.id ?? null) : null,
      }),
      /** Test-only: when Pyre's warning comes in this save (docs/PROCGEN.md §26); the far stars' story must be set. */
      edgeAt: (at: number) => {
        if (!this.state?.world.sky) return false;
        this.state.world.sky.edge = at;
        this.station?.render();
        return true;
      },
      /** Test-only: Pyre's timeline in this save, where it is in its story, and its black hole's glow. */
      pyre: () => {
        const edge = this.state?.world.sky?.edge;
        if (!this.state || edge === undefined) return null;
        return { edge, timeline: edgeTimeline(edge), stage: pyreStage(this.state.clock, edge), refuge: pyreRefugeId(), holeId: PYRE_HOLE_ID };
      },
      /** Test-only: the first bounty a rival hunter takes off a board from `from` on: where, which, when, and who. */
      findRivalClaim: (from: number) => {
        for (const r of ROSTER.filter((x) => x.style === 'hunter')) {
          for (let n = Math.max(0, turnOf(from)); n < turnOf(from) + 200; n++) {
            const c = claimFor(r, n);
            // With time to spare before the board's posting rolls over.
            if (c && c.at >= from && c.contract.contract?.kind === 'bounty' && boardEpoch(c.at + 600) === boardEpoch(c.at)) return { rival: r.id, giver: c.giver, contract: c.contract.id, title: c.contract.title, at: c.at };
          }
        }
        return null;
      },
      /** Test-only: where a rival is now (docked, flying, in a jump or refitting), and the run it is on or flies next. */
      rival: (id: string) => {
        const r = rivalById(id);
        if (!r || !this.state) return null;
        const w = rivalWhere(r, this.state.clock);
        const run = w.kind === 'flying' || w.kind === 'jumping' ? w.run : nextRun(r, this.state.clock);
        return { where: w.kind, at: w.kind === 'docked' ? w.locationId : w.kind === 'flying' ? w.leg.systemId : null, run: run ? { id: run.id, kind: run.kind, from: run.from, to: run.to, depart: run.depart, arrive: run.arrive, legs: run.legs.map((l) => ({ systemId: l.systemId, kind: l.kind, start: l.start, end: l.end })) } : null };
      },
      /**
       * Test-only: a ship of `model` parked where the player is docked, the prices at `to` known as if
       * seen there, and a captain hired (insured) for its best run (screenshots). Returns the ship's id.
       */
      hireCaptain: (arg: { model: string; to: string }) => {
        const state = this.state;
        const here = state?.location.dockedAt;
        if (!state || !here) return null;
        const to = getLocation(arg.to);
        markVisited(state, to.systemId, to.id);
        recordMarketVisit(state, to.id);
        const id = `ship-${state.fleet.ships.length + 1}`;
        const o = { id, ship: newShipState(arg.model), locationId: here };
        state.fleet.ships.push(o);
        const best = haulGoods(state, here, to.id).sort((a, b) => (haulEstimate(state, o, to.id, b, true)?.net ?? 0) - (haulEstimate(state, o, to.id, a, true)?.net ?? 0))[0];
        const r = best ? hireHauler(state, id, to.id, best, true) : null;
        this.station?.render();
        return r?.ok ? id : null;
      },
      /** Test-only: parks a ship of a model, with extra fittings, where the pilot is docked (docs/PROCGEN.md §37); its id. */
      parkShip: (arg: { model: string; fittings?: Record<string, string> }) => {
        const state = this.state;
        const here = state?.location.dockedAt;
        if (!state || !here) return null;
        const id = `ship-${state.fleet.ships.length + 1}`;
        const ship = newShipState(arg.model);
        ship.fittings = { ...ship.fittings, ...(arg.fittings ?? {}) };
        state.fleet.ships.push({ id, ship, locationId: here });
        this.station?.render();
        return id;
      },
      /** Test-only: the pilot's working captains (docs/PROCGEN.md §37): their records, and the mining ships in this flight. */
      workers: () => {
        const state = this.state;
        if (!state) return null;
        return { ships: state.fleet.ships.filter((o) => o.hauler?.work).map((o) => ({ id: o.id, cargo: o.ship.cargo, hauler: o.hauler })), flight: this.flight?.minerStatus() ?? null };
      },
      /**
       * Test-only: a rival's story (docs/PROCGEN.md §28): the record, how it stands, what it offers at
       * their table now, the holds on their career, standing, and the duel in this flight.
       */
      rivalStory: (id: string) => {
        const r = rivalById(id);
        const state = this.state;
        if (!r || !state) return null;
        const offer = storyOffer(state, r);
        return {
          story: state.world.rivals?.stories?.[id] ?? null,
          status: storyStatus(state, r),
          offer: offer ? { kind: offer.kind, lock: offer.lock } : null,
          holds: holdsOf(r).map((x) => ({ kind: x.kind, from: x.from, to: x.to === Infinity ? null : x.to, resume: x.resume, systemId: x.systemId ?? null })),
          standing: standingWith(state, id),
          duel: this.flight?.duelStatus() ?? null,
        };
      },
      /** Test-only: standing with a rival, through the rules (falling to hostile starts a feud), and when the player met them (`metAgo` seconds back). */
      setRival: (arg: { id: string; standing: number; metAgo?: number }) => {
        const state = this.state;
        if (!state || !rivalById(arg.id)) return;
        const rec = ((state.rivals ??= {})[arg.id] ??= { standing: 0 });
        if (arg.metAgo !== undefined) rec.met = Math.max(0, state.clock - arg.metAgo);
        shift(state, arg.id, arg.standing - rec.standing);
        this.station?.render();
        this.persist();
      },
      /** Test-only: the first moment from `from` on when a rival sits docked with a run of its own to fly next: when, and where. */
      findRivalDocked: (arg: { id: string; from: number }) => {
        const r = rivalById(arg.id);
        if (!r) return null;
        for (let t = Math.ceil(arg.from); t < arg.from + 40 * 3_600; t += 60) {
          const w = rivalWhere(r, t);
          const run = nextRun(r, t);
          if (w.kind === 'docked' && run && run.from === w.locationId && run.to !== w.locationId && run.depart - t > 120) return { at: t, locationId: w.locationId, to: run.to };
        }
        return null;
      },
      /** Test-only: an outpost's next raid (the first chartered, unless its site is named), how it stands against it, the raids met, and the raid in this flight (docs/PROCGEN.md §29). */
      outpostRaid: (site?: string) => {
        const state = this.state;
        const o = state ? outpostsOf(state).find((x) => !site || x.site === site) : undefined;
        if (!state || !o) return null;
        const next = nextRaid(state, o);
        return { next, warned: o.defence?.warned ?? null, raids: o.defence?.raids ?? [], turrets: o.defence?.turrets ?? 0, flight: this.flight?.outpostRaidStatus() ?? null };
      },
      /** Test-only: the stand in a belt in this flight (docs/PROCGEN.md §40.3), if one is under way here. */
      stand: () => this.flight?.standStatus() ?? null,
      /** Test-only: Pyre's lifeboats in this flight (docs/PROCGEN.md §42.4). */
      lifeboats: () => this.flight?.lifeboatStatus() ?? null,
      /** Test-only: the first time slot from now (or `from`) in which a station posts a pair's measurement (docs/PROCGEN.md §44.5), of a star if one is named. */
      measureJob: (q: { locationId: string; from?: number; secondary?: string }) => {
        const state = this.state;
        if (!state) return null;
        const first = boardEpoch(q.from ?? state.clock);
        for (let epoch = first; epoch < first + 400; epoch++) {
          const offer = measureOffer(q.locationId, epoch);
          if (offer && (!q.secondary || offer.orbit.secondary === q.secondary)) return { epoch, start: epoch * CONTRACTS.epochSeconds, secondary: offer.orbit.secondary, systemId: offer.orbit.systemId };
        }
        return null;
      },
      /** Test-only: the first time slot from now (or `from`) in which a station posts a comet to image (docs/PROCGEN.md §45.5), of a comet if one is named. */
      imageJob: (q: { locationId: string; from?: number; comet?: string }) => {
        const state = this.state;
        if (!state) return null;
        const first = boardEpoch(q.from ?? state.clock);
        for (let epoch = first; epoch < first + 400; epoch++) {
          const offer = imageOffer(q.locationId, epoch);
          if (offer && (!q.comet || offer.comet.id === q.comet)) return { epoch, start: epoch * CONTRACTS.epochSeconds, comet: offer.comet.id };
        }
        return null;
      },
      /** Test-only: the first time slot from now (or `from`) in which a station posts a near-Earth asteroid to track (docs/PROCGEN.md §47.5), of one if named. */
      trackJob: (q: { locationId: string; from?: number; asteroid?: string }) => {
        const state = this.state;
        if (!state) return null;
        const first = boardEpoch(q.from ?? state.clock);
        for (let epoch = first; epoch < first + 400; epoch++) {
          const start = epoch * CONTRACTS.epochSeconds;
          const offer = trackOffer(q.locationId, epoch, gameJulianDate(state.createdAt, start));
          if (offer && (!q.asteroid || offer.asteroid.id === q.asteroid)) return { epoch, start, asteroid: offer.asteroid.id, pass: offer.pass !== null };
        }
        return null;
      },
      /** Test-only: the named asteroids in this flight (docs/PROCGEN.md §47.3), where they stand and how they are drawn. */
      asteroids: () =>
        this.flight?.system.asteroids.map((a) => ({ id: a.id, name: a.name, position: a.position.toArray(), radius: a.radius, shape: a.shape, near: a.near, color: a.color })) ?? null,
      /** Test-only: the planets (and moons) in this flight, where they are drawn. */
      planets: () => this.flight?.system.planets.map((p) => ({ id: p.def.id, position: p.def.position.toArray(), radius: p.def.radius })) ?? null,
      /** Test-only: places the ship beyond a giant planet's moon, looking at it with its planet behind (for screenshots). */
      viewMoon: (arg: { id: string; planet: string; distance: number }) => this.flight?.viewMoon(arg.id, arg.planet, arg.distance) ?? false,
      /** Test-only: the spacecraft in this flight (docs/PROCGEN.md §49.3), where they stand and how they are drawn. */
      craft: () => this.flight?.system.craft.map((c) => ({ id: c.id, name: c.name, position: c.position.toArray(), radius: c.radius, look: c.look, near: c.near })) ?? null,
      /** Test-only: places the ship by a spacecraft, looking at it (for screenshots). */
      viewCraft: (arg: { id: string; distance: number }) => this.flight?.viewCraft(arg.id, arg.distance) ?? false,
      /** Test-only: places the ship by a named asteroid, looking at it (for screenshots). */
      viewAsteroid: (arg: { id: string; distance: number }) => this.flight?.viewAsteroid(arg.id, arg.distance) ?? false,
      /** Test-only: the comets in this flight (docs/PROCGEN.md §45.3), where they stand and how they are drawn. */
      comets: () =>
        this.flight?.system.comets.map((c) => ({ id: c.id, name: c.name, position: c.position.toArray(), radius: c.radius, coma: c.coma, tail: c.tail, gasDir: c.gasDir.toArray(), dustDir: c.dustDir.toArray() })) ?? null,
      /** Test-only: a few weeks of a career written in the logbook through its own functions, for screenshots (docs/PROCGEN.md §46). */
      logbookSample: () => {
        const state = this.state;
        if (!state) return false;
        const day = 86_400;
        const step = (days: number) => (state.clock += days * day);
        for (const to of ['alpha-centauri', 'barnard', 'wolf-359'] as SystemId[]) {
          step(2);
          const route = findRoute(SYSTEMS, state.location.systemId, to);
          if (!route) continue;
          const firsts = route.path.filter((id) => !state.visitedSystems.includes(id));
          for (const id of route.path) if (!state.visitedSystems.includes(id)) state.visitedSystems.push(id);
          state.location = { ...state.location, systemId: to };
          noteJump(state, firsts, route.hops);
        }
        step(3);
        noteComet(state, 'comet-2p');
        step(4);
        state.credits += 9_400;
        notePaid(state, 2_400, 'Image 2P/Encke');
        notePeak(state);
        step(5);
        logWrite(state, { kind: 'milestone', id: 'first-contract', where: 'earth-port' });
        this.persist();
        return true;
      },
      /** Test-only: the day the save began (ISO), which with the clock makes the game's date. */
      startedOn: (iso: string) => {
        const state = this.state;
        if (!state || !Number.isFinite(Date.parse(iso))) return false;
        state.createdAt = new Date(Date.parse(iso)).toISOString();
        useGameStart(state.createdAt);
        this.persist();
        return true;
      },
      /** Test-only: the flare under way in this flight's system, what it does and how its star glows (docs/PROCGEN.md §43.3). */
      flare: () => this.flight?.debugFlare() ?? null,
      /** Test-only: the first flare in a system (this one by default) starting after `from` (the clock by default), of a kind if one is named, within ten days (§43.2). */
      nextFlare: (q: { systemId?: string; kind?: string; from?: number } = {}) => {
        const state = this.state;
        if (!state) return null;
        const from = q.from ?? state.clock;
        const systemId = q.systemId ?? state.location.systemId;
        return flaresBetween(from, from + 10 * 86_400).find((f) => f.systemId === systemId && f.start > from && (!q.kind || f.kind === q.kind)) ?? null;
      },
      /**
       * Test-only: the first event at an outpost (the first chartered, unless its site is named) that
       * starts after `from` (the clock by default), of a kind if one is named, within ten days (docs/PROCGEN.md §39).
       */
      outpostEvent: (q: { kind?: string; from?: number; site?: string } = {}) => {
        const state = this.state;
        const o = state ? outpostsOf(state).find((x) => !q.site || x.site === q.site) : undefined;
        if (!state || !o) return null;
        const from = q.from ?? state.clock;
        const e = stationEventsBetween(outpostId(o.site), from, from + 10 * 86_400).find((x) => x.start > from && (!q.kind || x.kind === q.kind));
        return e ? { id: e.id, kind: e.kind, start: e.start, end: e.end, goods: e.goods, headline: e.headline, deficit: e.kind === 'shortage' ? Math.ceil(shortfall(e) * EVENTS.react.relief) : 0 } : null;
      },
      /**
       * Test-only: the people at an outpost (the first chartered, unless its site is named): who lives
       * there, their record, when the next ask comes, the spirit and the hour's income now (docs/PROCGEN.md §41).
       */
      folk: (site?: string) => {
        const state = this.state;
        const o = state ? outpostsOf(state).find((x) => !site || x.site === site) : undefined;
        if (!state || !o?.folk) return null;
        return { people: folkPeople(state, o), record: structuredClone(o.folk), next: nextAskAt(state.seed, o), spirit: spiritAt(o, state.clock), income: incomeAt(o, state.clock) };
      },
      /**
       * Test-only: an outpost's haulers (the first chartered, unless its site is named): the next to set
       * off or dock, the dock fees paid, and those flying to or from it in this flight (docs/PROCGEN.md §38).
       */
      outpostHaulers: (site?: string) => {
        const state = this.state;
        const o = state ? outpostsOf(state).find((x) => !site || x.site === site) : undefined;
        if (!state || !o) return null;
        const n = nextHauler(o, state.clock);
        const next = n ? { id: n.haul.id, name: n.haul.name, out: n.out, at: n.at, depart: n.haul.depart, arrive: n.haul.arrive, from: n.haul.from, to: n.haul.to, commodity: n.haul.commodity, qty: n.haul.qty } : null;
        return { next, fees: o.fees ?? 0, earned: o.earned, flight: this.flight?.haulersAt(outpostId(o.site)) ?? null };
      },
      /** Test-only: the crew aboard, what they do for the ship now, the deeds counted, who left (docs/PROCGEN.md §30). */
      crew: () => {
        const state = this.state;
        if (!state) return null;
        return { members: crewAboard(state), effects: crewEffects(state), deeds: state.aboard?.deeds ?? {}, former: state.aboard?.former ?? [], systems: state.ship.systems };
      },
      /** Test-only: the wing on the pilot's pay, who has left, and the wing's orders in this flight (docs/PROCGEN.md §34). */
      wing: () => {
        const state = this.state;
        if (!state) return null;
        return { crew: state.crew, former: state.wingFormer ?? [], flight: this.flight?.wingStatus() ?? null, carry: this.wingCarry };
      },
      /** Test-only: a hired wingman's record (the first, unless named): fights, downs, trust, and a hurt or a loss. */
      setWing: (arg: { id?: string; fights?: number; downs?: number; trust?: number; hurt?: 'hit' | 'down' }) => {
        const state = this.state;
        const w = state?.crew.find((x) => !x.ally && (!arg.id || x.id === arg.id));
        if (!state || !w) return;
        if (arg.fights !== undefined) w.fights = arg.fights;
        if (arg.downs !== undefined) w.downs = arg.downs;
        if (arg.trust !== undefined) w.trust = arg.trust;
        if (arg.hurt) wingHurt(state, w.id, arg.hurt);
        this.persist();
        this.station?.render();
      },
      /** Test-only: lets border battles be staged in this browser test (they are off in tests otherwise). */
      meetBattles: (on: boolean) => {
        this.battlesInTests = on;
      },
      /** Test-only: no raider packs in the flights to come (the battles' own ships still come). */
      quietPacks: (on: boolean) => {
        this.packsOff = on;
      },
      /**
       * Test-only: the first border battle of a kind due in a system from a moment on (docs/PROCGEN.md
       * §35); a clash only where no turning battle is due around it (one would come first).
       */
      findBattle: (arg: { system: SystemId; kind: BattleKind; from: number }) => {
        const low = this.renderer.quality === 'low';
        const log = this.state?.world.border ?? null;
        for (let t = arg.from; t < arg.from + 96 * 3_600; t += 3_600) {
          const plans = battlesDue(arg.system, t, 3_600, low, log).filter((p) => p.kind === arg.kind);
          const plan = plans.find((p) => p.kind !== 'clash' || !battlesDue(arg.system, p.opens - 1_800, 3_600, low, log).some((x) => x.kind !== 'clash'));
          if (plan) return { id: plan.id, opens: plan.opens, until: plan.until, toward: plan.toward, law: plan.law, wake: plan.wake, title: plan.title };
        }
        return null;
      },
      /** Test-only: the border battle in this flight, and the battles this save has seen to an end. */
      battle: () => ({ flight: this.flight?.battleStatus() ?? null, seen: this.state ? battlesSeen(this.state) : [] }),
      /** Test-only: downs the nearest ship of a side in the battle under way, by the pilot's guns or not. */
      downBattleShip: (arg: { side: 'law' | 'wake'; byPlayer: boolean }) => {
        const ship = this.flight?.battleStatus().ships.filter((x) => x.side === arg.side && !x.over).sort((a, b) => a.distance - b.distance)[0];
        return ship ? (this.flight?.debugDestroy(ship.id, arg.byPlayer) ?? false) : false;
      },
      /** Test-only: the nearest dock (by jumps) whose bar has a hand of this role (and heart) for hire now. */
      findCrew: (arg: { role: CrewRole; heart?: CrewHeart }) => {
        const state = this.state;
        if (!state) return null;
        const { role, heart } = arg;
        const jumps = jumpsFrom(WORLD.links, state.location.systemId);
        const docks = ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.stationType !== 'pirate-den').sort((a, b) => (jumps.get(a.systemId) ?? 99) - (jumps.get(b.systemId) ?? 99) || a.id.localeCompare(b.id));
        for (const l of docks) {
          const o = crewOffers(state, l.id).find((x) => x.role === role && (!heart || x.heart === heart));
          if (o) return { locationId: l.id, systemId: l.systemId, offerId: o.id, name: o.name, heart: o.heart, grade: o.grade };
        }
        return null;
      },
      /** Test-only: hurts the crew member of a role, as a hit would. */
      hurtCrew: (role: CrewRole) => {
        if (!this.state) return null;
        const m = hurtCrew(this.state, role);
        this.persist();
        return m?.id ?? null;
      },
      /** Test-only: deeds the crew aboard saw (counted until the next dock). */
      crewDeed: (arg: { deed: CrewDeed; n?: number }) => {
        if (!this.state) return;
        crewDeed(this.state, arg.deed, arg.n ?? 1);
        this.persist();
      },
      /** Test-only: a crew member's morale (0–100). */
      setCrew: (arg: { role: CrewRole; morale: number }) => {
        const m = this.state ? crewAboard(this.state).find((x) => x.role === arg.role) : undefined;
        if (!m) return false;
        m.morale = Math.max(0, Math.min(100, arg.morale));
        this.station?.render();
        this.persist();
        return true;
      },
      /** Test-only: the player's ship takes a hit in flight (shields first). */
      hurtPlayer: (amount: number) => this.flight?.debugHurt(amount),
      /** Test-only: destroy a ship in flight outright (`byPlayer`: as the player's guns would). */
      destroyNpc: (arg: { id: string; byPlayer: boolean }) => this.flight?.debugDestroy(arg.id, arg.byPlayer) ?? false,
      /** Test-only: what a station's board posts now (as the Jobs window lists it, before what the pilot holds). */
      board: (locationId: string) => (this.state ? postedContracts(this.state, locationId).map((c) => ({ id: c.id, title: c.title })) : []),
      /** Test-only: a deed on a border front (+ the law's way, − the Wake's), as war work done there now. */
      borderDeed: (frontId: string, amount: number) => {
        if (!this.state) return;
        pushFront(this.state, frontId, amount);
        this.persist();
      },
      /** Test-only: the open 3D star map's camera distance and where its stars are on screen. */
      mapView: () => this.map?.debugView() ?? null,
      /** Test-only: fit a catalogue item to the first slot of its type (empty first); flights launched after it fly with it. */
      fit: (gearId: string) => {
        const item = this.state ? getCatalog().gearById.get(gearId) : undefined;
        if (!this.state || !item) return false;
        const slots = shipModel(this.state.ship.model).slots.filter((s) => s.type === item.slot && item.tier <= s.maxClass);
        const slot = slots.find((s) => !this.state!.ship.fittings[s.id]) ?? slots[0];
        if (!slot) return false;
        this.state.ship.fittings[slot.id] = gearId;
        this.station?.render();
        return true;
      },
      /** Test-only: put the ship at rest `distance` metres from a target's surface, facing it. */
      placeNear: (arg: { id: string; distance: number; awayFrom?: string }) => this.flight?.placeNear(arg.id, arg.distance, arg.awayFrom) ?? false,
      /** Test-only: places the ship beside a comet, looking at its tails (for screenshots). */
      viewComet: (arg: { id: string; distance: number }) => this.flight?.viewComet(arg.id, arg.distance) ?? false,
      /** Test-only: turns the ship to face a target (for screenshots of the sky). */
      face: (arg: string | { id: string; below?: number }) => (typeof arg === 'string' ? this.flight?.face(arg) : this.flight?.face(arg.id, arg.below)) ?? false,
      /** Test-only: the mining laser, the rocks near the player and any pack hunting the miner. */
      mining: () => this.flight?.debugMining() ?? null,
      renderInfo: () => ({ quality: this.renderer.quality, pixelRatio: this.renderer.pixelRatio, fps: this.renderer.fps }),
      flush: () => this.saves.flush(),
    };
  }
}
