import { exportSaveFile, parseSaveFile, SAVE_FILE_MAX_BYTES, SaveFileError } from '../../app/save/saveFile.ts';
import type { SaveManager } from '../../app/save/SaveManager.ts';
import { describeSave, placeLabel, SLOT_COUNT, slotGame, summarize, summaryLine, type SaveSlot, type SaveSummary } from '../../app/save/slots.ts';
import type { GameState } from '../../app/state.ts';
import { button, confirmDialog, showModal } from '../components.ts';
import { h, replaceChildren, type Child } from '../dom.ts';
import { icon } from '../icons.ts';
import { sheet } from './panels.ts';
import '../styles/screens.css';

export interface SavesOptions {
  saves: SaveManager;
  /**
   * In game: the running game, brought up to date and autosaved. Null on the title screen, where
   * nothing is running (so there is no Save here).
   */
  current: (() => GameState | null) | null;
  /** Plays a loaded game the way Continue does; the autosave follows it from then on. */
  play(state: GameState, message: string): void;
  /** After the sheet has closed. */
  onClose(): void;
}

type Tone = 'good' | 'bad' | 'info';

/**
 * The Saves sheet: the autosave and the manual slots with their summaries, and Save here (in game),
 * Load, Export, Delete and Import file. Results show in a status line kept in view at the bottom.
 */
export function openSaves(parent: HTMLElement, opts: SavesOptions): { close(): void } {
  const { saves } = opts;
  const current = opts.current;
  let slots: SaveSlot[] = [];
  /** The autosave's game: the running game in game, the stored autosave on the title. */
  let autosave: GameState | null = null;
  let busy = false;
  let closed = false;
  let fresh: number | null = null;
  let messageTimer = 0;
  let loading: Promise<void> = Promise.resolve();

  const list = h('ul', { class: 'save-list', 'aria-label': 'Autosave and save slots', 'aria-busy': 'true' });
  const count = h('span', { class: 'num' });
  const message = h('p', { class: 'saves-message', 'data-testid': 'saves-message', hidden: true });
  const input = h('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'sr-only',
    tabindex: '-1',
    'aria-hidden': 'true',
    'data-testid': 'saves-import-file',
  });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    // Cleared so that choosing the same file again still reports a change.
    input.value = '';
    if (file) void run(() => importFile(file));
  });
  const body = h(
    'div',
    { class: 'stack saves' },
    h('p', { class: 'muted small saves-intro' }, 'The autosave follows your game. Slots keep copies in this browser; export a save file to keep one elsewhere or to play on another device.'),
    saves.backend.kind === 'memory'
      ? h('p', { class: 'saves-warning', role: 'note' }, icon('alert'), 'This browser is not keeping saves, so they last only until the page closes. Export a save file to keep your game.')
      : null,
    h('div', null, h('div', { class: 'list-head' }, h('span', null, 'In this browser'), count), list),
    h(
      'div',
      null,
      h('div', { class: 'list-head' }, h('span', null, 'Save file')),
      h(
        'div',
        { class: 'saves-file' },
        h('p', { class: 'muted small' }, 'Load a game exported on this or another device.'),
        button('Import file', { icon: 'upload', testId: 'saves-import', onClick: () => input.click() }),
        input,
      ),
    ),
    message,
  );
  const handle = sheet(parent, 'Saves', body, () => {
    closed = true;
    window.clearTimeout(messageTimer);
    opts.onClose();
  }, 'saves-sheet');

  /** Shows a result in the status line (errors stay until the next action). */
  function say(text: string | null, tone: Tone = 'info'): void {
    window.clearTimeout(messageTimer);
    // Scrolled to the end (after Import file), the line opens below the content instead of over it.
    const scroller = message.closest<HTMLElement>('.scroll');
    const atEnd = !!scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 8;
    message.hidden = !text;
    message.textContent = text ?? '';
    message.className = `saves-message ${tone}`;
    message.setAttribute('role', tone === 'bad' ? 'alert' : 'status');
    if (text && atEnd) scroller.scrollTop = scroller.scrollHeight;
    if (text && tone !== 'bad') messageTimer = window.setTimeout(() => say(null), 7000);
  }

  function reason(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /** Re-reads the saves and rebuilds the list, keeping focus on the same control. */
  async function refresh(): Promise<void> {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.testid : undefined;
    autosave = current ? current() : (await saves.load()).state;
    slots = await saves.listSlots();
    if (closed) return;
    count.textContent = `${slots.filter((s) => !s.empty).length}/${SLOT_COUNT} slots used`;
    replaceChildren(list, autosaveRow(), slots.map(slotRow));
    list.setAttribute('aria-busy', 'false');
    fresh = null;
    if (focused && list.contains(document.activeElement) === false) {
      handle.root.querySelector<HTMLElement>(`[data-testid="${focused}"]`)?.focus();
    }
  }

  /** Reads the saves again; actions wait for the latest read, so they never work from an empty list. */
  function reload(): Promise<void> {
    loading = refresh().catch((err: unknown) => say(`The saves could not be read. ${reason(err)}`, 'bad'));
    return loading;
  }

  /** Runs one action at a time, then shows the saves as they now are. */
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy || closed) return;
    busy = true;
    say(null);
    try {
      await loading;
      await action();
    } catch (err) {
      say(reason(err), 'bad');
    } finally {
      busy = false;
    }
    if (!closed) await reload();
  }

  // ---------------------------------------------------------------- rows

  function row(id: string, name: string, summary: SaveSummary | null, when: string | null, empty: string, actions: HTMLElement[], kind: string): HTMLElement {
    const t = summary ? describeSave(summary) : null;
    return h(
      'li',
      { class: `save-row ${kind}${fresh !== null && id === `slot-${fresh}` ? ' is-fresh' : ''}`, 'data-testid': `save-${id}` },
      saveInfo(name, t, when, empty),
      actions.length ? h('div', { class: `save-actions n${actions.length}` }, actions) : null,
    );
  }

  function autosaveRow(): HTMLElement {
    const summary = autosave ? summarize(autosave) : null;
    const actions: HTMLElement[] = [];
    if (autosave && !current) {
      // Loading the autosave is Continue: nothing is replaced, so nothing to ask.
      const state = autosave;
      actions.push(button('Load', { size: 'sm', testId: 'save-auto-load', onClick: () => void run(async () => loadGame(state, 'Progress restored')) }));
    }
    if (autosave) actions.push(button('Export', { size: 'sm', testId: 'save-auto-export', onClick: () => exportAutosave() }));
    const when = current ? 'Saves as you play' : summary ? `Saved ${describeSave(summary).saved}` : null;
    return row('auto', 'Autosave', summary, when, 'No game yet', actions, 'is-auto');
  }

  function slotRow(s: SaveSlot): HTMLElement {
    const n = s.slot;
    const actions: HTMLElement[] = [];
    if (current) actions.push(button('Save here', { size: 'sm', testId: `save-slot-${n}-save`, onClick: () => void run(() => saveHere(s)) }));
    if (s.summary) {
      actions.push(button('Load', { size: 'sm', testId: `save-slot-${n}-load`, onClick: () => void run(() => loadSlot(s)) }));
      actions.push(button('Export', { size: 'sm', testId: `save-slot-${n}-export`, onClick: () => exportSlot(s) }));
    }
    if (!s.empty) actions.push(button('Delete', { size: 'sm', variant: 'ghost', testId: `save-slot-${n}-delete`, onClick: () => void run(() => deleteSlot(s)) }));
    const when = s.summary ? `Saved ${describeSave(s.summary).saved}` : null;
    const kind = s.empty ? 'is-empty' : s.summary ? 'is-slot' : 'is-damaged';
    return row(`slot-${n}`, `Slot ${n}`, s.summary, when, s.empty ? 'Empty' : 'Damaged: this save cannot be read.', actions, kind);
  }

  // ---------------------------------------------------------------- actions

  /** "Slot 2 holds Sol · Halcyon Ring · 1,234 cr · saved …." */
  function holds(s: SaveSlot): string {
    return s.summary ? `Slot ${s.slot} holds ${summaryLine(s.summary)}.` : `Slot ${s.slot} holds a damaged save.`;
  }

  async function saveHere(s: SaveSlot): Promise<void> {
    if (!s.empty) {
      const ok = await confirmDialog(`Overwrite slot ${s.slot}?`, paragraphs(holds(s), 'It will be replaced by the game you are playing.'), 'Overwrite');
      if (!ok) return;
    }
    const state = current?.();
    if (!state) return;
    await saves.saveToSlot(s.slot, state);
    fresh = s.slot;
    say(`Saved in slot ${s.slot}.`, 'good');
  }

  async function loadSlot(s: SaveSlot): Promise<void> {
    let state: GameState;
    try {
      state = slotGame(s);
    } catch (err) {
      say(`Slot ${s.slot} cannot be loaded. ${reason(err)}`, 'bad');
      return;
    }
    const ok = await confirmReplace(`Load slot ${s.slot}?`, `Slot ${s.slot}: ${summaryLine(summarize(state))}.`, `Load slot ${s.slot}`);
    if (ok) loadGame(state, `Slot ${s.slot} loaded`);
  }

  /** Closes the sheet and plays `state`. */
  function loadGame(state: GameState, note: string): void {
    handle.close();
    opts.play(state, note);
  }

  /**
   * Asks before another game takes over: in game it replaces the running game, and on the title
   * the game in the autosave (nothing to ask when the autosave is empty).
   */
  async function confirmReplace(title: string, what: string, confirmLabel: string): Promise<boolean> {
    if (!current && !autosave) return true;
    const then = current
      ? 'The game you are playing will close, and the autosave will follow the loaded game from then on. Anything in the current game that is not kept in a save slot or a save file will be lost.'
      : `The autosave will follow the loaded game from then on, replacing the game it holds now (${summaryLine(summarize(autosave!))}). Export the autosave first if you want to keep that game.`;
    return confirmDialog(title, paragraphs(what, then), confirmLabel);
  }

  async function deleteSlot(s: SaveSlot): Promise<void> {
    const ok = await confirmDialog(`Delete slot ${s.slot}?`, paragraphs(holds(s), 'The save will be deleted from this browser. This cannot be undone.'), 'Delete', { danger: true });
    if (!ok) return;
    await saves.deleteSlot(s.slot);
    say(`Slot ${s.slot} deleted.`, 'info');
  }

  // Exports run straight from the tap: sharing a file needs the tap's user activation.

  function exportAutosave(): void {
    if (busy) return;
    say(null);
    const state = current ? current() : autosave;
    if (state) deliver(exportSaveFile(state));
  }

  function exportSlot(s: SaveSlot): void {
    if (busy) return;
    say(null);
    try {
      deliver(exportSaveFile(slotGame(s), new Date(), s.slot));
    } catch (err) {
      say(`Slot ${s.slot} cannot be exported. ${reason(err)}`, 'bad');
    }
  }

  function deliver(file: { name: string; json: string }): void {
    void deliverFile(file.name, file.json)
      .then((how) => {
        if (how === 'shared') say(`Exported ${file.name}.`, 'good');
        else if (how === 'downloaded') say(`Exported ${file.name} to your downloads.`, 'good');
        else if (how === 'opened') say(`${file.name} opened in a new tab: save it from there.`, 'info');
      })
      .catch((err: unknown) => say(`The save file could not be exported. ${reason(err)}`, 'bad'));
  }

  async function importFile(file: File): Promise<void> {
    if (file.size > SAVE_FILE_MAX_BYTES) {
      say('This file is too large to be a Starman Reborn save file.', 'bad');
      return;
    }
    let state: GameState;
    try {
      state = parseSaveFile(await file.text());
    } catch (err) {
      say(err instanceof SaveFileError ? err.message : 'This file could not be read.', 'bad');
      return;
    }
    const choice = await chooseImport(state);
    if (choice === 'play') {
      loadGame(state, 'Imported game loaded');
      return;
    }
    const target = slots.find((s) => `slot-${s.slot}` === choice);
    if (!target) return;
    if (!target.empty) {
      const ok = await confirmDialog(`Overwrite slot ${target.slot}?`, paragraphs(holds(target), 'It will be replaced by the imported game.'), 'Overwrite');
      if (!ok) return;
    }
    await saves.saveToSlot(target.slot, state, { keepSavedAt: true });
    fresh = target.slot;
    say(`Imported ${file.name} into slot ${target.slot}.`, 'good');
  }

  /** Asks where an imported game goes: a slot (value `slot-N`), play it now (`play`), or `cancel`. */
  function chooseImport(state: GameState): Promise<string> {
    const summary = summarize(state);
    const now = current
      ? 'Play it now closes the game you are playing (anything not kept in a save slot or a save file is lost), and the autosave will follow the imported game from then on.'
      : autosave
        ? `Play it now replaces the game in the autosave (${summaryLine(summarize(autosave))}), and the autosave will follow the imported game from then on.`
        : 'Play it now, and the autosave will follow it from then on.';
    return showModal({
      title: 'Import save file',
      testId: 'import-dialog',
      body: (close) =>
        h(
          'div',
          { class: 'stack import-choice' },
          h('div', { class: 'save-row is-file' }, saveInfo('Save file', describeSave(summary), `Saved ${describeSave(summary).saved}`, '')),
          h('div', null, h('div', { class: 'list-head' }, h('span', null, 'Keep it in a slot')), h(
            'div',
            { class: 'import-targets' },
            slots.map((s) =>
              button(h('span', { class: 'stack-tight' }, `Slot ${s.slot}`, h('small', null, s.empty ? 'Empty' : s.summary ? `Replaces ${placeLabel(s.summary)}` : 'Replaces a damaged save')), {
                size: 'sm',
                testId: `import-slot-${s.slot}`,
                onClick: () => close(`slot-${s.slot}`),
              }),
            ),
          )),
          h('p', { class: 'muted small' }, now),
        ),
      actions: [
        { label: 'Cancel', value: 'cancel', testId: 'import-cancel' },
        { label: 'Play it now', value: 'play', variant: 'primary', testId: 'import-play' },
      ],
      dismissValue: 'cancel',
    });
  }

  void reload();
  return { close: () => handle.close() };
}

/** Name, place, credits and play time of a save. */
function saveInfo(name: string, t: ReturnType<typeof describeSave> | null, when: string | null, empty: string): HTMLElement {
  return h(
    'div',
    { class: 'save-info' },
    h('div', { class: 'save-top' }, h('span', { class: 'save-name' }, name), when ? h('span', { class: 'save-when' }, when) : null),
    t
      ? [h('span', { class: 'save-place' }, t.place), h('span', { class: 'save-meta' }, h('span', { class: 'num' }, t.credits), ` · ${t.played}`)]
      : h('span', { class: 'save-empty' }, empty),
  );
}

function paragraphs(...lines: Child[]): HTMLElement {
  return h('div', { class: 'stack' }, lines.map((line) => h('p', null, line)));
}

// ---------------------------------------------------------------- handing over a file

type Delivery = 'shared' | 'downloaded' | 'opened' | 'cancelled';

/** Phones that can share files (iPhone and iPad: Save to Files, AirDrop, mail) get the share sheet. */
function canShareFile(file: File): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  if (!window.matchMedia?.('(pointer: coarse)').matches) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Hands a save file to the player: the share sheet where a phone can share files (iOS; Android
 * Chrome does not share JSON), otherwise a download through a temporary link (Android Chrome,
 * desktops), otherwise the JSON in a new tab. Call it straight from a tap: sharing needs the tap's
 * user activation.
 */
async function deliverFile(name: string, json: string): Promise<Delivery> {
  const blob = new Blob([json], { type: 'application/json' });
  const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
  if (file && canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Sharing is not allowed here: download instead.
    }
  }
  const url = URL.createObjectURL(blob);
  // Kept for a while: Safari reads the file only once the player accepts the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  if ('download' in HTMLAnchorElement.prototype) {
    const link = h('a', { href: url, download: name, rel: 'noopener', hidden: true });
    document.body.appendChild(link);
    link.click();
    link.remove();
    return 'downloaded';
  }
  window.open(url, '_blank');
  return 'opened';
}
