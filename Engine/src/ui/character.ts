/**
 * The character sheet: what the player's numbers currently are, and what they
 * are carrying. Opened with C.
 *
 * The panel is built from a view object rather than from the level, so it holds
 * no reference to anything that a map change destroys and can be rendered in a
 * test without a game. `update` is called every frame while the sheet is open,
 * which is why the markup is built once and only text is written afterwards:
 * stats move continuously (health drains, a buff lands), and rewriting the
 * whole sheet sixty times a second to change one number would throw away hover
 * and selection along with it.
 *
 * The rows are rebuilt only when the *set* of attributes changes, which happens
 * when the rules editor play-tests an edited attribute list — not when a value
 * moves.
 *
 * Bag cells and worn slots are buttons, and this panel deliberately does not
 * decide what pressing one means. It reports which cell, which button, and
 * whether the pointer went down or came up; whoever wired it decides whether
 * that was a grab, a drop or an equip. The alternative — teaching the panel
 * about the item on the cursor — would put the same three-way decision in two
 * places and let them disagree.
 *
 * Which cells take the pointer does change with the cursor, though, so
 * `setHolding` is the one thing it is told: normally only the cells holding
 * something are targets, but while an item is being carried every cell is,
 * including the empty ones it could be put into. Everything else stays
 * click-through — the game does not pause for this panel, and swallowing
 * presses over half the screen would mean losing a fight to read your armour.
 */

import { countOf } from '../game/items.ts';
import { formatStat } from './format.ts';
import { part, setText } from './dom.ts';
import type { ItemInstance } from '../game/items.ts';
import type { InventorySnapshot } from '../game/inventory.ts';
import type { Cell } from './itemCursor.ts';

/** One attribute, as the panel shows it. */
export type StatView = {
  id: string;
  label: string;
  kind: string;
  value: number;
  current: number;
};

/** Everything this panel draws. Built by the level; see render/level.ts. */
export type CharacterView = {
  label: string;
  stats: readonly StatView[];
  inventory?: InventorySnapshot | null;
};

/**
 * @param {object} [handlers]
 * @param {(where: {kind: 'bag'|'slot', id: number|string}, button: number) => void}
 *   [handlers.onCellDown] the pointer went down on a cell
 * @param {(where: {kind: 'bag'|'slot', id: number|string}) => void}
 *   [handlers.onCellUp] the pointer came up over a cell
 */
export function createCharacterPanel(
  root: HTMLElement,
  {
    onCellDown,
    onCellUp,
  }: {
    onCellDown?: (where: Cell, button: number) => void;
    onCellUp?: (where: Cell) => void;
  } = {},
) {
  let open = false;
  let signature = '';
  /** id -> the element the value is written into. */
  let statValues = new Map<string, Element>();
  let bagSize = -1;
  /** slot id -> the element the worn item's name is written into. */
  let equipmentNames = new Map<string, Element>();
  /** slot id -> the whole cell, which is the thing you click to take it off. */
  let equipmentCells = new Map<string, HTMLElement>();

  root.innerHTML =
    '<div class="ch-panel">' +
    '<header class="ch-head"><span class="ch-title">Character</span>' +
    '<span class="ch-archetype"></span></header>' +
    '<div class="ch-body">' +
    '<section class="ch-col"><h2>Attributes</h2><div class="ch-stats"></div></section>' +
    '<section class="ch-col"><h2>Equipment</h2><div class="ch-doll"></div>' +
    '<h2 class="ch-baghead">Inventory</h2><div class="ch-bag"></div></section>' +
    '</div>' +
    // Neither button is guessable, and hovering a cell for its tooltip only
    // helps someone who already suspects there is something to find.
    '<div class="ch-help">Drag or click to pick up &middot; right-click to equip</div>' +
    '</div>';

  const panel = part(root, '.ch-panel');
  const archetype = part(root, '.ch-archetype');
  const stats = part(root, '.ch-stats');
  const doll = part(root, '.ch-doll');
  const bag = part(root, '.ch-bag');

  /** Rebuild the stat rows for a new set of attributes. */
  function buildStats(list: readonly StatView[]): void {
    // Labels are author-typed data, so they are written as text and never
    // interpolated into markup.
    stats.innerHTML = list
      .map(() => '<div class="ch-stat"><span class="ch-k"></span><span class="ch-v"></span></div>')
      .join('');

    const rows = [...stats.querySelectorAll('.ch-stat')];
    statValues = new Map<string, Element>();
    list.forEach((stat, i) => {
      setText(part(rows[i], '.ch-k'), stat.label);
      statValues.set(stat.id, part(rows[i], '.ch-v'));
    });
  }

  function buildEquipment(list: InventorySnapshot['equipment']): void {
    doll.innerHTML = list
      .map(
        (slot) =>
          `<button type="button" class="ch-slot ui-click" style="grid-column:${slot.column + 1}">` +
          '<span class="ch-slot-label"></span><span class="ch-item"></span></button>',
      )
      .join('');

    const cells = [...doll.querySelectorAll<HTMLElement>('.ch-slot')];
    equipmentNames = new Map<string, Element>();
    equipmentCells = new Map<string, HTMLElement>();
    list.forEach((slot, i) => {
      setText(part(cells[i], '.ch-slot-label'), slot.label);
      equipmentNames.set(slot.id, part(cells[i], '.ch-item'));
      equipmentCells.set(slot.id, cells[i]);
      wireCell(cells[i], { kind: 'slot', id: slot.id });
    });
  }

  function buildBag(inventory: InventorySnapshot): void {
    bag.style.gridTemplateColumns = `repeat(${inventory.cols}, 1fr)`;
    bag.innerHTML = inventory.bag
      .map(() => '<button type="button" class="ch-cell ui-click"></button>')
      .join('');
    bagSize = inventory.bag.length;

    const cells = [...bag.querySelectorAll<HTMLElement>('.ch-cell')];
    cells.forEach((cell, index) => wireCell(cell, { kind: 'bag', id: index }));
  }

  /**
   * One cell's events, reported as they happened and nothing more.
   *
   * Down and up are separate because a press and a release can land on
   * different cells — that is a drag, and it is the same gesture as a click
   * right up until the pointer moves.
   */
  function wireCell(cell: HTMLElement, where: Cell): void {
    cell.onpointerdown = (e) => onCellDown?.(where, e?.button ?? 0);
    cell.onpointerup = () => onCellUp?.(where);
    // The browser menu must not open over a game that is still running; the
    // right button has a job in here.
    cell.oncontextmenu = (e) => e.preventDefault();
  }

  /**
   * What an item does, for the cell's tooltip.
   *
   * The sheet has room for a name and no more, so the numbers live here. They
   * are written against the attribute labels the view already carries rather
   * than against ids — "+6 Attack power", not "+6 attackPower".
   */
  function describe(item: ItemInstance | null | undefined, labels: Map<string, string>): string {
    if (!item) return '';
    const lines = (item.stats ?? []).map((stat) => {
      const name = labels.get(stat.attribute) ?? stat.attribute;
      if (stat.op === 'multiply') return `+${Math.round(stat.value * 100)}% ${name}`;
      if (stat.op === 'override') return `${name}: ${stat.value}`;
      return `${stat.value >= 0 ? '+' : ''}${stat.value} ${name}`;
    });
    return [item.label, ...lines].join('\n');
  }

  /** Set a tooltip only when it changed: this runs every frame the sheet is up. */
  function setTitle(cell: HTMLElement | null | undefined, text: string): void {
    if (cell && cell.title !== text) cell.title = text;
  }

  /**
   * Whether this cell holds something. Styling and hit-testing both key off it:
   * an empty cell is not a target unless something is being carried, which is
   * what the panel's own `holding` class decides.
   */
  function setFilled(cell: Element | null | undefined, filled: boolean): void {
    if (!cell || cell.classList.contains('filled') === filled) return;
    cell.classList.toggle('filled', filled);
  }

  return {
    get open() {
      return open;
    },

    setOpen(next: boolean): boolean {
      open = Boolean(next);
      root.classList.toggle('hidden', !open);
      return open;
    },

    toggle(): boolean {
      open = !open;
      root.classList.toggle('hidden', !open);
      return open;
    },

    /**
     * Something is on the cursor. Every cell becomes a target while it is —
     * an empty one is exactly where you might want to put the thing down.
     */
    setHolding(holding: unknown): void {
      panel?.classList.toggle('holding', Boolean(holding));
    },

    /**
     * @param {{label: string, stats: object[], inventory: object}} view
     */
    update(view: CharacterView | null | undefined): void {
      if (!view) return;

      // What was built is keyed on the shape, not the values — so a health tick
      // costs two textContent writes and a rules change costs a rebuild.
      const next = view.stats.map((stat) => `${stat.id}:${stat.kind}`).join(',');
      if (next !== signature) {
        signature = next;
        buildStats(view.stats);
      }

      setText(archetype, view.label);

      for (const stat of view.stats) {
        const cell = statValues.get(stat.id);
        if (!cell) continue;
        const text =
          stat.kind === 'resource'
            ? `${formatStat(stat.current)} / ${formatStat(stat.value)}`
            : formatStat(stat.value);
        setText(cell, text);
      }

      const inventory = view.inventory;
      if (!inventory) return;

      // Built from the view rather than kept: the set of attributes changes
      // when the rules editor play-tests an edit.
      const labels = new Map(view.stats.map((stat) => [stat.id, stat.label]));

      if (equipmentNames.size !== inventory.equipment.length) buildEquipment(inventory.equipment);
      for (const slot of inventory.equipment) {
        const cell = equipmentNames.get(slot.id);
        if (!cell) continue;
        setText(cell, slot.item?.label ?? '');
        const worn = equipmentCells.get(slot.id);
        setFilled(worn, Boolean(slot.item));
        setTitle(worn, slot.item ? describe(slot.item, labels) : '');
      }

      if (bagSize !== inventory.bag.length) buildBag(inventory);
      const cells = bag.querySelectorAll<HTMLElement>('.ch-cell');
      for (let i = 0; i < inventory.bag.length; i++) {
        // A stack says how deep it is; one of something says nothing, because
        // "Short sword ×1" is noise on every cell that holds equipment.
        const held = inventory.bag[i];
        const depth = countOf(held);
        const text = held ? `${held.label}${depth > 1 ? ` ×${depth}` : ''}` : '';
        if (!cells[i]) continue;
        setText(cells[i], text);
        setFilled(cells[i], Boolean(inventory.bag[i]));
        setTitle(cells[i], describe(inventory.bag[i], labels));
      }
    },
  };
}

/** The character sheet: attributes, the doll and the bag. */
export type CharacterPanel = ReturnType<typeof createCharacterPanel>;
