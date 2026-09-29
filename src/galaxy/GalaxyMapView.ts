import type * as THREE from 'three';
import { getSystem, SYSTEMS } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { button } from '../ui/components.ts';
import { h, replaceChildren } from '../ui/dom.ts';
import { findRoute } from './routing.ts';
import type { GalaxyMapCallbacks, MapState } from './types.ts';

export interface GalaxyMapOptions {
  root: HTMLElement;
  renderer: THREE.WebGLRenderer | null;
  callbacks: GalaxyMapCallbacks;
  reducedMotion?: boolean;
}

/** TEMPORARY list-based stand-in; replaced by the full 3D map module. */
export class GalaxyMapView {
  private readonly opts: GalaxyMapOptions;
  private readonly panel: HTMLElement;
  private state: MapState | null = null;
  private selected: SystemId | null = null;
  private open_ = false;

  constructor(opts: GalaxyMapOptions) {
    this.opts = opts;
    this.panel = h('section', { class: 'screen dim-backdrop', hidden: true, 'data-testid': 'galaxy-map' });
    opts.root.appendChild(this.panel);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(state: MapState, focusSystemId?: SystemId): void {
    this.state = state;
    this.selected = focusSystemId ?? state.objectiveSystemId ?? null;
    this.open_ = true;
    this.panel.hidden = false;
    this.draw();
  }

  update(state: MapState): void {
    this.state = state;
    if (this.open_) this.draw();
  }

  close(): void {
    this.open_ = false;
    this.panel.hidden = true;
  }

  render(_dt: number): void {}
  resize(_w: number, _h: number): void {}
  setReducedMotion(_on: boolean): void {}
  dispose(): void {
    this.panel.remove();
  }

  private draw(): void {
    const s = this.state!;
    const sel = this.selected;
    const route = sel ? findRoute(SYSTEMS, s.currentSystemId, sel) : null;
    const fee = route ? (s.feeCoverage?.systemId === route.to ? 0 : route.totalFee) : 0;
    const can = !!route && route.hops.length > 0 && s.readiness.canJump && s.credits >= fee;
    replaceChildren(
      this.panel,
      h(
        'div',
        { class: 'panel panel-pad stack', style: 'width:min(30rem,100%)' },
        h('h2', null, 'Star map'),
        h('p', { class: 'muted small' }, 'Star positions and distances based on astronomical data; travel technology and local scale are fictional.'),
        SYSTEMS.map((sys) =>
          button(`${sys.displayName} · ${sys.distanceLightYears.toFixed(2)} ly`, {
            testId: `map-system-${sys.id}`,
            onClick: () => {
              this.selected = sys.id;
              this.draw();
            },
          }),
        ),
        route && sel
          ? h('p', null, `Route to ${getSystem(sel).displayName}: ${route.path.join(' → ')} · ${route.totalDistanceLy.toFixed(2)} ly · fee ${fee} cr`)
          : null,
        !s.readiness.canJump ? h('p', { class: 'blocked' }, s.readiness.reason ?? '') : null,
        h(
          'div',
          { class: 'row' },
          button('Jump', { variant: 'primary', disabled: !can, testId: 'map-jump', onClick: () => route && this.opts.callbacks.onJump(route, fee) }),
          button('Close', { testId: 'map-close', onClick: () => this.opts.callbacks.onClose() }),
        ),
      ),
    );
  }
}

export function renderStarMap2D(container: HTMLElement, state: MapState, onSelect: (id: SystemId) => void, selected?: SystemId): void {
  void selected;
  replaceChildren(
    container,
    h('ul', null, SYSTEMS.map((s) => h('li', null, button(`${s.displayName} · ${s.distanceLightYears.toFixed(2)} ly`, { onClick: () => onSelect(s.id) })))),
  );
  void state;
}
