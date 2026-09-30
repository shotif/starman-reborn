import { gameJulianDate } from '../data/solar.ts';
import type { Lingering } from './state.ts';
import { TRAFFIC } from '../world/traffic/plan.ts';
import { raidKill } from '../economy/answers.ts';
import { useWorldLog } from '../economy/events.ts';
import { fleetNews, settleFleet, type FleetSettlement } from '../economy/fleet.ts';
import { lastView } from '../ui/station/lastView.ts';
import { fill, PAYMENT } from '../content/people/lines.ts';
import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine.ts';
import type { MusicMood, SfxId } from '../audio/types.ts';
import { ALL_LOCATIONS, getComponent, getLocation, getPlanet, getSystem, SYSTEMS, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { addCargo, cargoUsed, itemsThatFit } from '../economy/cargo.ts';
import { COMMODITIES } from '../economy/commodities.ts';
import { shipModel } from '../content/catalog.ts';
import { hashString } from '../content/random.ts';
import { cargoCapacity, performanceOf } from '../economy/loadout.ts';
import { adjustReputation, FACTIONS, standingTier, TIER_LABEL } from '../economy/factions.ts';
import { newsAt, systemEventAt } from '../economy/events.ts';
import {
  acceptJob,
  activeJobIds,
  advanceJobs,
  assaultsIn,
  contractPacksIn,
  countPiracy,
  currentObjective,
  defencesIn,
  deliverJob,
  describeObjective,
  escortArrived,
  escortLost,
  escortsIn,
  getJob,
  LIFELINE_ID,
  primaryObjective,
  wrecksIn,
  type JobEvent,
} from '../economy/jobs.ts';
import { briefingFor, choiceHere, denDown, isStoryJob, knockOutDen, makeChoice, markSeen, pendingBeats, speakerName } from '../economy/story.ts';
import { DENS } from '../content/dens/rules.ts';
import { showChoice, showDialogue } from '../ui/story.ts';
import { denBounty, payCrew, stashGear, wingmanLost } from '../economy/combat.ts';
import { moveStock, traderDelivery } from '../economy/markets.ts';
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
import { createStationInterior, type RoomView, type StationInterior } from '../world/rooms/index.ts';
import type { EncounterDef } from '../world/sceneTypes.ts';
import { spectralClass } from '../content/world/generate.ts';
import { sceneDefFor } from '../world/systems/index.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import { generatedInteriorStyle } from '../world/systems/interiors.ts';
import { SystemScene } from '../world/SystemScene.ts';
import type { Target } from '../world/targets.ts';
import { GameRenderer, isTouchDevice, resolveQuality } from './GameRenderer.ts';
import { Loop } from './Loop.ts';
import { discoverBody, dockAt, jumpReadiness, performJump, rescueAfterDefeat, routeFee, undock } from './rules.ts';
import type { SaveManager } from './save/SaveManager.ts';
import type { Settings } from './settings.ts';
import { Soundscape } from './soundscape.ts';
import { applyCredits, createNewGame, type GameState } from './state.ts';

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

export function applyDocumentSettings(settings: Settings): void {
  const root = document.documentElement;
  root.style.setProperty('--text-scale', String(settings.textScale));
  root.classList.toggle('reduced-motion', settings.reducedMotion);
}

export class Game {
  readonly audio = new AudioEngine();
  /** Music, station ambience and local radio, kept in step with where the player is. */
  private readonly soundscape = new Soundscape(this.audio);
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
  private flight: FlightSession | null = null;
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
    this.renderer.setQuality(resolveQuality(settings.quality), settings.bloom && !settings.reducedMotion);
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
      this.renderer.setQuality(resolveQuality(next.quality), next.bloom && !next.reducedMotion);
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
  }

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
    // The fleet catches up with the clock the save was made at (docs/PROCGEN.md §18).
    useWorldLog(this.state.world);
    const fleet = settleFleet(this.state);
    if (fleet.steps) this.persist();
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
  }

  // ------------------------------------------------------------------ scenes

  private loadSystem(systemId: SystemId): void {
    // Sol is laid out for the game date: rebuilt when the day changes (and after the title's schematic Sol).
    const jd = this.gameDate();
    const day = systemId === 'sol' && jd !== null ? Math.floor(jd) : null;
    if (this.system && this.system.def.systemId === systemId && this.systemDay === day) return;
    this.disposeFlight();
    this.dockedView = null;
    this.system?.dispose();
    this.system = new SystemScene(sceneDefFor(systemId, jd), this.artCtx);
    this.systemDay = day;
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
        openSettings: () => this.openSettings(),
        openControls: () => this.openControls(),
        openSaves: () => this.openSaves(),
        quitToTitle: () => void this.quitToTitle(),
        acceptJob: (id) => this.acceptJob(id),
        decide: () => void this.offerChoice(),
        reload: () => this.enterDocked(locationId, { room: this.station?.currentRoom ?? 'deck', window: 'news' }),
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
    const route = findRoute(SYSTEMS, from, to);
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
        const events = dockAt(state, state.location.dockedAt).jobEvents;
        this.announceJobEvents(events);
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
        this.sfx('mission-complete');
        if (job.reward + bonus === 0) toast(`${job.title} complete`, 'good', 5000);
        else toast(`${job.title} complete: +${formatCredits(job.reward + bonus)}${bonus ? ' with the on-time bonus' : e.text.includes('(late') ? ' (late: no bonus)' : ''}`, 'good', 5000);
        // The poster's dispatcher confirms the payment (story missions have their own words).
        if (job.reward + bonus > 0 && !job.story) {
          const giver = getLocation(job.giverLocationId);
          const lines = PAYMENT[giver.factionId ?? 'independent'];
          commToast(`${giver.name} dispatch`, fill(lines[hashString(e.jobId) % lines.length]!, { amount: formatCredits(job.reward + bonus) }), 4500);
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
  }

  // ------------------------------------------------------------------ story

  private storyQueue: Promise<void> = Promise.resolve();

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
    const pick = await showChoice(c.job, c.objective, briefingFor(state, c.job));
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
          this.persist();
        },
        onScan: (result, faction) => {
          if (!isLawful(faction)) return;
          if (result === 'evaded') {
            const out = commitCrime(state, 'evade', faction, state.location.systemId);
            toast(`You ran from a cargo scan. ${out.text}`, 'bad', 5000);
          } else {
            const scan = customsScan(state, faction);
            toast(scan.text, scan.found.length ? 'bad' : 'info', scan.found.length ? 5000 : 2600);
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
        onWingmanLost: (id) => {
          wingmanLost(state, id);
          this.persist();
        },
        onComm: (speaker, text) => this.comm(speaker, text, 5000),
        onHunterDown: () => {
          state.stats.kills += 1;
          toast('Bounty hunter destroyed. Nobody pays for that one.', 'good', 3500);
          this.persist();
        },
        onBounty: (credits, name) => this.onBounty(credits, name),
        onContractKill: (jobId) => this.onContractKill(jobId),
        onTraderArrived: (from, to, shipId) => {
          const flow = traderDelivery(from, to, shipId, state.markets, state.clock);
          if (!flow) return;
          if (from) moveStock(state.markets, from, flow.commodity, -flow.qty, state.clock);
          moveStock(state.markets, to, flow.commodity, flow.qty, state.clock);
        },
        onMessage: (text, tone) => toast(text, tone, 2600),
      },
      traffic: this.trafficHere(),
    });
    const { width, height } = this.renderer.size;
    this.flight.setViewport(width, height);
    this.flight.start(spawn);
    this.mode = 'flight';
    this.loop.lowPower = false;
    this.objectiveTimer = 0;
    this.hint = null;
    this.refreshFlightUi();
    this.soundscape.flight(this.system!.def, moodFor(state.location.systemId), state, this.flight.player.position);
    this.tellStory();
  }

  /** Traffic for the system the player flies in: the plan, and everything their contracts and story put there. */
  private trafficHere(): NonNullable<ConstructorParameters<typeof FlightSession>[0]['traffic']> {
    const state = this.state!;
    const here = state.location.systemId;
    const base = trafficFor(here, this.renderer.quality, state.clock);
    // A knocked-out den sends no packs until it is rebuilt.
    const downDens = ALL_LOCATIONS.filter((l) => l.systemId === here && l.stationType === 'pirate-den' && denDown(state, l.id)).map((l) => l.id);
    return {
      ...base,
      plan: downDens.length ? { ...base.plan, packs: null } : base.plan,
      contractPacks: contractPacksIn(state, here),
      escorts: escortsIn(state, here),
      wrecks: wrecksIn(state, here),
      assaults: assaultsIn(state, here),
      defences: defencesIn(state, here),
      downDens,
      crew: state.crew.map((w) => ({ id: w.id, name: w.name, model: w.model, skill: w.skill })),
      lingering: this.takeLingering(),
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

  /** Remembers what the player leaves in this system: packs that saw them, and pods adrift. */
  private rememberLingering(): void {
    const state = this.state;
    const flight = this.flight;
    if (!state || !flight) return;
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

  private onDocked(locationId: string): void {
    const state = this.state!;
    this.flight?.writeBack(state);
    this.rememberLingering();
    // Customs at depots and military bases scan every ship that docks.
    const customs = scansOnDocking(locationId);
    if (customs) {
      const scan = customsScan(state, customs);
      if (scan.found.length) toast(scan.text, 'bad', 6000);
    }
    const out = dockAt(state, locationId);
    this.persist();
    if (dockAccess(state, locationId) === 'emergency') {
      const faction = getLocation(locationId).factionId!;
      toast(`Emergency docking only: the ${FACTIONS[faction].name} will repair you, and take your fines at the customs desk (News).`, 'bad', 6000);
    }
    if (out.clearanceGranted) {
      this.sfx('ui-confirm');
      toast('Interstellar departure clearance granted.', 'good', 4500);
    }
    for (const n of out.watchNotes) toast(n.text, 'info', 6000);
    for (const n of out.lawNotes) toast(n, 'good', 6000);
    this.announceFleet(out.fleet);
    this.announceJobEvents(out.jobEvents, false);
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

  private onScanInfo(t: Target): void {
    if (!t.bodyId) return;
    const state = this.state!;
    if (catalogue(state, t.bodyId)) {
      const { done, total } = codexProgress(state);
      this.hint = null;
      toast(`Catalogued: ${t.name} · codex ${done}/${total}`, 'good', 3500);
      this.persist();
    }
    this.setPaused(true, false);
    const s = sheet(this.screenLayer, t.name, bodyCard(t.bodyId, t.name), () => this.setPaused(false), 'science-sheet');
    void s;
  }

  private async onPlayerDestroyed(): Promise<void> {
    const state = this.state!;
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
          })
        : { canJump: false, reason: 'Start a game to travel.' },
      objectiveSystemId: objective?.targetSystemId ?? null,
      discoveredBodies: new Set(state?.discoveredBodies ?? []),
      feeCoverage: state ? this.feeCoverage() : null,
      news: state
        ? newsAt(current, state.clock).map((n) => ({ id: n.event.id, systemId: n.event.systemId, kind: n.event.kind, headline: n.event.headline, detail: n.event.detail, active: n.active }))
        : [],
      contractSystems: new Set(state ? activeJobIds(state).flatMap((id) => describeObjective(state, id)?.targetSystemId ?? []) : []),
      ...(state ? { catalogued: new Set(state.codex) } : {}),
      jumpReach: state ? performanceOf(state.ship).jumpReach : 0,
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
          h('dd', null, `${dest.distanceLightYears.toFixed(2)} ly `, dataBadge('observed')),
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
        this.flight?.writeBack(state);
        this.rememberLingering();
        this.disposeFlight();
        const events = performJump(state, j.route, j.fee);
        this.announceJobEvents(events);
        for (const n of settleLaw(state)) toast(n, 'good', 6000);
        const wing = payCrew(state, j.route.hops.length);
        if (wing.paid) toast(`Wing fees: ${formatCredits(wing.paid)}`, 'info', 3000);
        for (const note of wing.notes) toast(note, 'bad', 5000);
        // The wing is paid first: a hauler loading out of sight never leaves it unpaid.
        this.announceFleet(settleFleet(state));
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
      }),
      () => this.sheetsOpen--,
      'settings-sheet',
    );
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

  private openAbout(systemId?: SystemId): void {
    const wasPaused = this.paused;
    if (this.mode === 'flight' && !wasPaused) this.setPaused(true, false);
    this.sheetsOpen++;
    void import('../ui/encyclopedia.ts').then(({ openEncyclopedia }) => openEncyclopedia(this.screenLayer, {
      discoveredBodies: new Set(this.state?.discoveredBodies ?? []),
      ...(this.state ? { catalogued: new Set(this.state.codex) } : {}),
      ...(systemId ? { initialSystemId: systemId } : {}),
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
    this.renderer.recordFrame(rawDt);
    this.onResizeIfNeeded();
    this.fpsTimer -= rawDt;
    if (this.settings.showFps && this.fpsTimer <= 0) {
      this.fpsTimer = 0.5;
      this.fpsEl.textContent = `${Math.round(this.renderer.fps)} fps · ${this.renderer.quality} · ${Math.round(this.renderer.pixelRatio * 100) / 100}x`;
    }
    if (this.renderer.contextLost) return;
    // Pads are read every frame on every screen, so a press counts once and never carries over.
    this.gamepad.update();
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
      this.touch.setCruiseState(hudModel.cruise);
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
      { class: 'screen context-lost', role: 'alertdialog', 'aria-label': 'Graphics interrupted' },
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
      paused: () => this.paused,
      state: () => (this.state ? structuredClone(this.state) : null),
      hud: () => (this.flight ? structuredClone(this.flight.hud) : null),
      scheme: () => this.scheme,
      audioState: () => this.audio.state,
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
      /** Test-only: set standing with a faction (the law and the outlaw path). */
      setReputation: (faction: 'sta' | 'frontier' | 'hollow-wake', value: number) => {
        if (!this.state) return;
        this.state.reputation[faction] = value;
      },
      /** Test-only: mark jobs complete (to start a story arc part-way through). */
      completeJobs: (ids: string[]) => {
        if (!this.state) return;
        for (const id of ids) {
          const job = getJob(id, this.state);
          this.state.jobs[id] = { status: 'complete', objectiveIndex: job.objectives.length, acceptedAt: this.state.clock, completedAt: this.state.clock };
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
        this.persist();
        this.station?.render();
      },
      renderInfo: () => ({ quality: this.renderer.quality, pixelRatio: this.renderer.pixelRatio, fps: this.renderer.fps }),
      flush: () => this.saves.flush(),
    };
  }
}
