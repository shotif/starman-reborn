import type { DataClass, SourceRef } from '../data/types.ts';
import { h, type Child } from './dom.ts';
import { icon, type IconName } from './icons.ts';

/** Badge marking a value's data class with an icon and a word (never colour alone). */
export function dataBadge(kind: DataClass | 'provisional', text?: string): HTMLSpanElement {
  const spec = {
    observed: { icon: 'source' as IconName, label: 'Observed', title: 'Real astronomical data from the cited source' },
    estimated: {
      icon: 'estimated' as IconName,
      label: 'Illustrated',
      title: 'Estimated or artistic depiction, not a measurement',
    },
    fictional: { icon: 'fiction' as IconName, label: 'Fiction', title: 'Game fiction: not a real place or claim' },
    provisional: {
      icon: 'alert' as IconName,
      label: 'Pending verification',
      title: 'Transcribed from the cited catalog; not yet checked against an archive snapshot',
    },
  }[kind];
  return h('span', { class: `badge badge-${kind}`, title: spec.title }, icon(spec.icon), text ?? spec.label);
}

/** Small citation link with a source icon. */
export function sourceLink(source: SourceRef, extra?: string): HTMLAnchorElement {
  const details = [source.recordId, source.retrieved ? `retrieved ${source.retrieved}` : undefined, extra]
    .filter(Boolean)
    .join(' · ');
  return h(
    'a',
    {
      class: 'source-link',
      href: source.url,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: details ? `${source.label} — ${details}` : source.label,
    },
    icon('source'),
    source.label,
  );
}

export interface ButtonOptions {
  variant?: 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'lg';
  block?: boolean;
  icon?: IconName;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  testId?: string;
  onClick?: (event: MouseEvent) => void;
}

export function button(label: Child, opts: ButtonOptions = {}): HTMLButtonElement {
  const classes = ['btn'];
  if (opts.variant) classes.push(`btn-${opts.variant}`);
  if (opts.size) classes.push(`btn-${opts.size}`);
  if (opts.block) classes.push('btn-block');
  const el = h(
    'button',
    {
      type: 'button',
      class: classes.join(' '),
      title: opts.title,
      'aria-label': opts.ariaLabel,
      'data-testid': opts.testId,
      disabled: opts.disabled ?? false,
    },
    opts.icon ? icon(opts.icon) : null,
    label,
  );
  if (opts.onClick) el.addEventListener('click', opts.onClick);
  return el;
}

export function meter(kind: 'shield' | 'hull' | 'energy', fraction: number): HTMLDivElement {
  const fill = h('span');
  fill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
  return h('div', { class: `meter ${kind}`, role: 'presentation' }, fill);
}

// ---------- Modal dialogs ----------

let modalRoot: HTMLElement | null = null;

export function setModalRoot(el: HTMLElement): void {
  modalRoot = el;
}

export interface ModalOptions {
  title: string;
  body: Child;
  actions: { label: string; variant?: ButtonOptions['variant']; value: string; testId?: string }[];
  dismissValue?: string;
  testId?: string;
}

/** Shows a modal and resolves with the chosen action's value. Focus is trapped and restored. */
export function showModal(opts: ModalOptions): Promise<string> {
  const root = modalRoot ?? document.body;
  const previouslyFocused = document.activeElement as HTMLElement | null;
  return new Promise((resolve) => {
    const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
    const close = (value: string) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      previouslyFocused?.focus?.();
      resolve(value);
    };
    const actionButtons = opts.actions.map((a) =>
      button(a.label, {
        ...(a.variant ? { variant: a.variant } : {}),
        ...(a.testId ? { testId: a.testId } : {}),
        onClick: () => close(a.value),
      }),
    );
    const dialog = h(
      'div',
      { class: 'panel modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'data-testid': opts.testId },
      h('div', { class: 'modal-body scroll' }, h('h2', { id: titleId }, opts.title), opts.body),
      h('div', { class: 'modal-actions' }, actionButtons),
    );
    const backdrop = h('div', { class: 'modal-backdrop' }, dialog);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && opts.dismissValue !== undefined) {
        e.preventDefault();
        e.stopPropagation();
        close(opts.dismissValue);
      } else if (e.key === 'Tab') {
        const focusables = [...dialog.querySelectorAll<HTMLElement>('button, [href], select, input, [tabindex]')].filter(
          (el) => !el.hasAttribute('disabled'),
        );
        if (!focusables.length) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    root.appendChild(backdrop);
    (actionButtons[actionButtons.length - 1] ?? dialog).focus();
  });
}

export async function confirmDialog(
  title: string,
  message: Child,
  confirmLabel: string,
  opts: { danger?: boolean; cancelLabel?: string } = {},
): Promise<boolean> {
  const result = await showModal({
    title,
    body: typeof message === 'string' ? h('p', null, message) : message,
    actions: [
      { label: opts.cancelLabel ?? 'Cancel', value: 'cancel', testId: 'confirm-cancel' },
      { label: confirmLabel, variant: opts.danger ? 'danger' : 'primary', value: 'ok', testId: 'confirm-ok' },
    ],
    dismissValue: 'cancel',
  });
  return result === 'ok';
}

// ---------- Toasts ----------

let toastRoot: HTMLElement | null = null;

export function setToastRoot(el: HTMLElement): void {
  toastRoot = el;
}

export function toast(message: string, tone: 'good' | 'bad' | 'info' = 'info', ms = 3200): void {
  if (!toastRoot) return;
  const el = h('div', { class: `toast ${tone}`, role: 'status' }, message);
  toastRoot.appendChild(el);
  while (toastRoot.children.length > 4) toastRoot.firstElementChild?.remove();
  window.setTimeout(() => el.remove(), ms);
}

/** Drops any visible toasts (e.g. flight tips when a full-screen view opens). */
export function clearToasts(): void {
  toastRoot?.replaceChildren();
}
