/**
 * The crafting bench: what it can make, what each costs, and the base upgrade
 * that unlocks the rest. Opened by clicking the bench's name plate.
 *
 * Built from a view object like the character sheet, for the same reason — it
 * holds no reference to a level, and the numbers on it move between frames
 * while it is open, so the markup is written once and only text is rewritten
 * afterwards. The rows are rebuilt only when the *set* of recipes changes,
 * which happens when the rules editor play-tests an edited list.
 *
 * It decides nothing. Pressing a row reports which recipe; whether that was
 * affordable, unlocked or possible at all is answered by game/crafting.js, and
 * the refusal comes back as a notice. A panel that greyed a row out *and*
 * checked the price would be the same rule in two places.
 *
 * A locked row is shown rather than hidden. Upgrading the base has to have
 * something to promise, and a list that grows items you have never seen is a
 * worse promise than a list that already shows them out of reach.
 *
 * A craft takes a second, and the row being made fills up over it. Every row is
 * inert while the bench is busy — one bench, one thing at a time — which also
 * means a second press cannot be mistaken for a cancel.
 */

export function createCraftingPanel(root, { onCraft, onUpgrade } = {}) {
  let open = false;
  let signature = '';

  /** recipe id -> the pieces of its row that carry a value. */
  let rows = new Map();

  root.innerHTML =
    '<div class="cf-panel">' +
    '<header class="cf-head"><span class="cf-title">Crafting bench</span>' +
    '<span class="cf-purse"></span></header>' +
    '<div class="cf-base">' +
    '<span class="cf-level"></span>' +
    '<button class="cf-upgrade ui-click" type="button"></button>' +
    '</div>' +
    '<div class="cf-list"></div>' +
    '<p class="cf-help">Click to make one. It goes in your bag.</p>' +
    '</div>';

  const panel = root.querySelector('.cf-panel');
  const purse = root.querySelector('.cf-purse');
  const levelText = root.querySelector('.cf-level');
  const upgrade = root.querySelector('.cf-upgrade');
  const list = root.querySelector('.cf-list');

  upgrade.addEventListener('click', () => onUpgrade?.());

  const setText = (element, text) => {
    if (element && element.textContent !== text) element.textContent = text;
  };

  /** Rebuild the rows. Only when the set of recipes is not the one on screen. */
  function build(view) {
    rows = new Map();
    list.innerHTML = '';

    for (const recipe of view.recipes) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'cf-row ui-click';
      row.innerHTML =
        '<span class="cf-fill"></span>' +
        '<span class="cf-name"></span><span class="cf-cost"></span><span class="cf-lines"></span>';
      row.addEventListener('click', () => onCraft?.(recipe.id));
      list.append(row);
      rows.set(recipe.id, {
        row,
        fill: row.querySelector('.cf-fill'),
        name: row.querySelector('.cf-name'),
        cost: row.querySelector('.cf-cost'),
        lines: row.querySelector('.cf-lines'),
      });
    }
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

    /** Called every frame the panel is up. */
    update(view) {
      if (!view) return;

      const next = view.recipes.map((recipe) => recipe.id).join(',');
      if (next !== signature) {
        signature = next;
        build(view);
      }

      // Joined with a mark rather than spaces: HTML collapses a run of
      // whitespace, so two currencies would read as one four-word phrase.
      setText(purse, view.purse.map(({ label, amount }) => `${amount} ${label}`).join(' · '));
      setText(levelText, `Base level ${view.baseLevel}`);
      setText(
        upgrade,
        view.upgradeCost === null ? 'Fully built' : `Upgrade — ${view.upgradeCost}`,
      );
      upgrade.disabled = view.upgradeCost === null;
      upgrade.classList.toggle('poor', !view.canUpgrade && view.upgradeCost !== null);

      const busy = view.job !== null;

      for (const recipe of view.recipes) {
        const parts = rows.get(recipe.id);
        if (!parts) continue;
        setText(parts.name, recipe.label);
        setText(parts.cost, recipe.locked ? `Base ${recipe.minBase}` : recipe.cost);
        setText(parts.lines, recipe.lines.join('  ·  '));

        // The bar is the row's own background filling from the left, rather
        // than a separate widget: the thing being made is the thing that shows
        // it, so there is nowhere to look but at the row you pressed.
        const width = recipe.making ? `${Math.round(view.job.progress * 100)}%` : '0%';
        if (parts.fill.style.width !== width) parts.fill.style.width = width;

        // Locked and broken rows cannot be pressed at all, nor can any of them
        // while the bench is busy; one you merely cannot afford still can, so
        // the refusal gets to say which it was.
        parts.row.disabled = recipe.locked || recipe.missing || busy;
        parts.row.classList.toggle('locked', recipe.locked || recipe.missing);
        parts.row.classList.toggle('poor', !recipe.affordable && !recipe.locked);
        parts.row.classList.toggle('making', recipe.making);
      }
    },

    /** For tests and anything that wants the element without reaching for it. */
    get element() {
      return panel;
    },
  };
}
