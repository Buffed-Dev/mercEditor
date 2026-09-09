/**
 * The abilities screen: everything you can do, and which key does it.
 *
 * Two lists that mean different things. The **keys** are the five bindings, in
 * the order the bar draws them, and dragging onto one binds it. The **known**
 * list is everything available — innate, and whatever your weapons grant — so
 * an ability appears in it whether or not it is bound anywhere.
 *
 * One key is the main hand's: it holds your weapon's attack, or your fists when
 * the hand is empty. It takes nothing else — dropping another ability on it is
 * refused, and the key says which of the two it is holding rather than leaving
 * that to be discovered by dragging at it. The attack itself *can* be dragged
 * off it, and takes the key with it: what you land on becomes the attack's key
 * and whatever was there goes back to the one you came from.
 *
 * Built from a view object like the other panels, so it holds no reference to a
 * level and can be rendered without a game. It decides nothing: a drop reports
 * which ability landed on which key, and the rules for what that means — swap,
 * replace, unbind — live in game/loadout.js where they can be tested.
 *
 * Drag and drop is the platform's, not a re-implementation. The one thing worth
 * knowing is that the panel is click-through except for its draggable pieces
 * (see `#abilities` in index.html), the same trick the character sheet uses, so
 * the game underneath is still playable with this open.
 */

/**
 * @param {object} [handlers]
 * @param {(index: number, ability: string|null) => void} [handlers.onAssign]
 *   an ability was dropped on a key, or a key was cleared
 */
export function createAbilitiesPanel(root, { onAssign } = {}) {
  let open = false;
  let signature = '';

  root.innerHTML =
    '<div class="ab-panel">' +
    '<header class="ab-head"><span class="ab-title">Abilities</span>' +
    '<span class="ab-hint">Drag onto a key</span></header>' +
    '<div class="ab-keys"></div>' +
    '<h2 class="ab-sub">Known</h2>' +
    '<div class="ab-known"></div>' +
    '</div>';

  const keys = root.querySelector('.ab-keys');
  const known = root.querySelector('.ab-known');

  /** The id being dragged. Kept here as well as on the event, because a drop
   *  target has to know what is coming before the drop to style itself. */
  let carrying = null;

  const setText = (element, text) => {
    if (element && element.textContent !== text) element.textContent = text;
  };

  /** One draggable ability chip. */
  function chip(ability, { fromSlot = null, draggable = true } = {}) {
    const element = document.createElement('div');
    element.className = `ab-chip ui-click${ability?.missing ? ' missing' : ''}`;
    element.draggable = Boolean(ability) && draggable;
    element.innerHTML =
      `<span class="ab-name"></span>` + (ability?.from ? '<span class="ab-from"></span>' : '');
    setText(element.querySelector('.ab-name'), ability?.label ?? '');
    if (ability?.from) setText(element.querySelector('.ab-from'), ability.from);

    if (!ability || !draggable) return element;

    element.ondragstart = (event) => {
      carrying = ability.id;
      event.dataTransfer.setData('text/plain', ability.id);
      event.dataTransfer.effectAllowed = 'move';
      // Where it came from, so dropping it back on the list unbinds that key
      // rather than doing nothing.
      element.dataset.fromSlot = fromSlot ?? '';
    };
    element.ondragend = () => {
      carrying = null;
      for (const box of keys.querySelectorAll('.ab-key')) box.classList.remove('over');
    };
    return element;
  }

  function build(view) {
    keys.innerHTML = '';
    const handId = view.hand?.id ?? null;

    for (const slot of view.slots) {
      const box = document.createElement('div');
      box.className =
        `ab-key ui-click${slot.ability ? '' : ' empty'}${slot.hand ? ' fixed' : ''}`;
      box.innerHTML = '<span class="ab-binding"></span>';
      setText(box.querySelector('.ab-binding'), slot.binding);
      box.append(chip(slot.ability, { fromSlot: slot.index }));

      // The hand's key says what it is holding, and takes no drop but the
      // attack coming back to it — which is a move it has just been dragged
      // out of, so it is never a useful drop either.
      if (slot.hand) {
        const why = document.createElement('span');
        why.className = 'ab-why';
        why.textContent = slot.ability ? (slot.ability.unarmed ? 'bare hands' : 'main hand') : '';
        box.append(why);
      } else {
        box.ondragover = (event) => {
          if (!carrying) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          box.classList.add('over');
        };
        box.ondragleave = () => box.classList.remove('over');
        box.ondrop = (event) => {
          event.preventDefault();
          box.classList.remove('over');
          const ability = event.dataTransfer.getData('text/plain') || carrying;
          if (ability) onAssign?.(slot.index, ability);
        };
      }

      keys.append(box);
    }

    known.innerHTML = '';
    if (!view.known.length) {
      const empty = document.createElement('div');
      empty.className = 'ab-empty';
      empty.textContent = 'Nothing yet. Equipping a weapon grants what it can do.';
      known.append(empty);
    }
    // What the hand is holding is shown but not dragged from *here*: it is
    // bound wherever it is bound, and the copy on its key is the one that
    // moves. Dragging this one would have no key to leave behind.
    for (const ability of view.known) {
      const held = ability.id === handId;
      const element = chip(ability, { draggable: !held });
      if (held) element.classList.add('held');
      known.append(element);
    }

    // Dropping onto the list takes an ability off its key. The whole list is
    // the target rather than a bin you have to aim at.
    known.ondragover = (event) => {
      if (carrying) event.preventDefault();
    };
    known.ondrop = (event) => {
      event.preventDefault();
      const from = Number(event.target.closest('.ab-chip')?.dataset.fromSlot ?? NaN);
      const source = document.querySelector('.ab-key .ab-chip[data-from-slot]');
      const index = Number.isInteger(from) ? from : Number(source?.dataset.fromSlot);
      // The attack cannot be unbound — there is nowhere for it to go — so a
      // drag of it that ends on the list is simply dropped.
      if (Number.isInteger(index) && carrying !== handId) onAssign?.(index, null);
    };
  }

  return {
    get open() {
      return open;
    },

    setOpen(next) {
      open = Boolean(next);
      root.classList.toggle('hidden', !open);
    },

    toggle() {
      this.setOpen(!open);
    },

    /**
     * Called every frame the screen is up.
     *
     * Rebuilt only when what is bound or known actually changes — a drag in
     * progress must not have its chips replaced underneath it, and nothing else
     * here moves between frames.
     */
    update(view) {
      if (!view) return;
      const next =
        view.slots.map((slot) => slot.ability?.id ?? '').join(',') +
        '|' +
        view.known.map((ability) => ability.id).join(',') +
        '|' +
        (view.hand?.id ?? '');
      if (next === signature) return;
      signature = next;
      build(view);
    },
  };
}
