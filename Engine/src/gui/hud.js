import { Control } from '@babylonjs/gui/2D/controls/control.js';
import { Rectangle } from '@babylonjs/gui/2D/controls/rectangle.js';
import { StackPanel } from '@babylonjs/gui/2D/controls/stackPanel.js';
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock.js';

/**
 * The read-outs over the game: health, the ability bar, the cast bar and the
 * status line.
 *
 * Babylon GUI, drawn onto the same fullscreen texture as the item name plates,
 * so everything the game says about itself is one layer with one lifetime.
 *
 * Nothing here reads the level, the camera or the mode. It is told what to show
 * once a frame. That is what keeps it testable without a game, and what stops
 * the read-out quietly becoming a place where gameplay decisions get made.
 *
 * The one thing still in the DOM is the fault banner. It has to be readable
 * when a frame has thrown, and a banner drawn by the thing that just failed is
 * a banner you may never see.
 */

const FONT = 'ui-monospace, Menlo, Consolas, monospace';

const INK = '#c6d3e8';
const DIM = '#7f8ea8';
const LINE = '#2b3648';
const WELL = '#12161f';

/** Health bar, bottom centre. */
const BAR_WIDTH = 260;
const BAR_HEIGHT = 14;

/** How quickly the health bar catches up, per second. Was a CSS transition. */
const BAR_LERP = 12;

const CAST_WIDTH = 220;
const SLOT_WIDTH = 62;

/** Distance from the bottom of the screen, matching the old fixed positions. */
const VITALS_BOTTOM = 26;
const ABILITIES_BOTTOM = 74;
const CAST_BOTTOM = 132;

function text(content, { size = 12, color = INK } = {}) {
  const block = new TextBlock('', content);
  block.fontFamily = FONT;
  block.fontSize = size;
  block.color = color;
  block.resizeToFit = true;
  return block;
}

/** A recessed track with a fill that grows from its left edge. */
function bar(width, height, fillColor) {
  const track = new Rectangle('track');
  track.widthInPixels = width;
  track.heightInPixels = height;
  track.background = WELL;
  track.color = LINE;
  track.thickness = 1;
  track.cornerRadius = 3;

  const fill = new Rectangle('fill');
  fill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  fill.height = '100%';
  fill.width = '100%';
  fill.background = fillColor;
  fill.thickness = 0;
  track.addControl(fill);

  return { track, fill };
}

/**
 * @param {import('@babylonjs/gui/2D/advancedDynamicTexture.js').AdvancedDynamicTexture} ui
 * @param {Document} root where the fault banner lives
 */
export function createHud(ui, root = document) {
  const fault = root.getElementById('fault');

  // ---------------------------------------------------------- status line
  const line = text('', { size: 14, color: DIM });
  line.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  line.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  line.leftInPixels = 16;
  line.topInPixels = 14;
  ui.addControl(line);

  // --------------------------------------------------------------- health
  const vitals = new StackPanel('vitals');
  vitals.isVertical = true;
  vitals.widthInPixels = BAR_WIDTH;
  vitals.adaptHeightToChildren = true;
  vitals.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
  vitals.topInPixels = -VITALS_BOTTOM;
  ui.addControl(vitals);

  const health = bar(BAR_WIDTH, BAR_HEIGHT, '#b8443b');
  health.track.paddingBottomInPixels = 3;
  vitals.addControl(health.track);

  const healthText = text('', { size: 12, color: DIM });
  healthText.heightInPixels = 14;
  vitals.addControl(healthText);

  /** Eased rather than snapped, so a hit reads as a drain and not as a jump. */
  let shownHealth = 1;
  let lastUpdate = performance.now();

  // -------------------------------------------------------- ability slots
  const abilityBar = new StackPanel('abilities');
  abilityBar.isVertical = false;
  abilityBar.adaptWidthToChildren = true;
  abilityBar.heightInPixels = 44;
  abilityBar.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
  abilityBar.topInPixels = -ABILITIES_BOTTOM;
  ui.addControl(abilityBar);

  /** One entry per slot, rebuilt only when the level changes. */
  let slotViews = [];

  // ------------------------------------------------------------- cast bar
  const castPanel = new StackPanel('cast');
  castPanel.isVertical = true;
  castPanel.widthInPixels = CAST_WIDTH;
  castPanel.adaptHeightToChildren = true;
  castPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
  castPanel.topInPixels = -CAST_BOTTOM;
  ui.addControl(castPanel);

  const castName = text('', { size: 11, color: '#9fb0cc' });
  castName.heightInPixels = 15;
  castPanel.addControl(castName);

  const castBar = bar(CAST_WIDTH, 8, '#6f8ecb');
  castPanel.addControl(castBar.track);

  // --------------------------------------------------------------- notice
  let noticeText = '';
  let noticeUntil = 0;

  return {
    /**
     * Rebuild the ability bar for whatever the player currently has.
     *
     * Rebuilt on level load and never during the frame loop: rebuilding it
     * every frame would restart the cooldown fill on every tick.
     *
     * @param {{label: string}[]} slots
     * @param {{label?: string}[]} bindings which key or button fires each slot
     */
    setAbilities(slots, bindings = []) {
      for (const view of slotViews) view.slot.dispose();

      slotViews = slots.map((ability, index) => {
        const slot = new Rectangle(`slot${index}`);
        slot.widthInPixels = SLOT_WIDTH;
        slot.heightInPixels = 40;
        slot.paddingRightInPixels = index === slots.length - 1 ? 0 : 8;
        // An empty key is drawn quieter rather than not drawn: the bar keeps
        // its shape as weapons come and go, so the key you reach for is always
        // in the same place.
        const empty = !ability?.id;
        slot.background = empty ? '#0c0f16' : '#12161f';
        slot.color = empty ? '#1c2330' : '#2c3648';
        slot.thickness = 1;
        slot.cornerRadius = 5;
        slot.clipChildren = true;

        // Grows up from the bottom to cover the slot while it is recharging.
        const cool = new Rectangle('cool');
        cool.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        cool.width = '100%';
        cool.height = '0%';
        cool.background = '#05070c';
        cool.alpha = 0.8;
        cool.thickness = 0;
        cool.zIndex = 2;
        slot.addControl(cool);

        const key = text(bindings[index]?.label ?? '', { size: 11, color: DIM });
        key.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        key.topInPixels = 6;
        slot.addControl(key);

        // How far into a combo this key is. Empty for everything else, so a
        // key that is one ability says nothing where a chain says "2/3".
        const step = text('', { size: 10, color: DIM });
        step.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        step.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        step.topInPixels = 6;
        step.leftInPixels = -5;
        slot.addControl(step);

        const name = text(ability.label || '—', { size: 11, color: empty ? '#3b4457' : INK });
        name.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        name.topInPixels = -6;
        name.widthInPixels = SLOT_WIDTH - 8;
        name.resizeToFit = false;
        name.textWrapping = false;
        slot.addControl(name);

        abilityBar.addControl(slot);
        return { slot, cool, name, step };
      });
    },

    /** A line of text in the corner for a few seconds. */
    notice(message, seconds = 2.5) {
      noticeText = message;
      noticeUntil = performance.now() + seconds * 1000;
    },

    /** Put the status line to something the caller composed — the editors do. */
    setLine(content) {
      line.text = content;
    },

    /**
     * Everything that belongs to a running game, gone. For the editors, which
     * cover the screen and have no health to report.
     */
    hideBars() {
      vitals.isVisible = false;
      abilityBar.isVisible = false;
      castPanel.isVisible = false;
    },

    /**
     * One frame's worth of read-out.
     *
     * @param {object} view
     * @param {boolean} view.playing
     * @param {object} view.vitals health, cast and slot state from the level
     * @param {string} view.status the right-hand half of the status line
     */
    update({ playing, vitals: state, status = '' }) {
      const { health: hp, maxHealth, slots, cast } = state;

      const now = performance.now();
      const dt = Math.min((now - lastUpdate) / 1000, 0.25);
      lastUpdate = now;

      const target = maxHealth > 0 ? hp / maxHealth : 0;
      shownHealth += (target - shownHealth) * Math.min(1, dt * BAR_LERP);
      health.fill.width = `${Math.max(0, shownHealth) * 100}%`;
      healthText.text = `${Math.ceil(hp)} / ${Math.round(maxHealth)}`;
      vitals.isVisible = playing;

      for (let slot = 0; slot < slotViews.length; slot++) {
        const view = slotViews[slot];
        const state = slots[slot];
        view.cool.height = `${(state?.fraction ?? 0) * 100}%`;

        // A combo names the step it is up to rather than itself: what the key
        // does changes with every press, and the name of the whole chain is
        // the one thing that does not tell you what pressing now would do.
        // Written here rather than when the bar is built, because the bar is
        // only rebuilt when what is *bound* changes.
        const chain = state?.step ?? null;
        const label = chain ? chain.label : (state?.label || '—');
        if (view.name.text !== label) view.name.text = label;
        const counter = chain ? `${chain.index}/${chain.count}` : '';
        if (view.step.text !== counter) view.step.text = counter;
      }
      abilityBar.isVisible = playing;

      // Only on screen while something is winding up.
      castPanel.isVisible = playing && Boolean(cast);
      if (cast) {
        castBar.fill.width = `${cast.progress * 100}%`;
        if (castName.text !== cast.label) castName.text = cast.label;
      }

      // A live notice is appended, not woven into the caller's string: the
      // caller composes what is true about the game, and how long a message has
      // left to live is this module's business.
      const showing = now < noticeUntil ? noticeText : '';
      line.text = showing ? `${status}   ${showing}` : status;
    },

    /**
     * A frame threw. Reported once per distinct fault: a bug that throws every
     * frame would otherwise bury the console at sixty lines a second, which
     * hides the first one — the only one with a useful stack.
     *
     * Deliberately the one part of the read-out still made of DOM. A frame that
     * throws may well have thrown inside the renderer, and a banner that needs
     * the renderer to appear is no banner at all.
     */
    fault: (() => {
      const seen = new Map();
      return (error) => {
        const message = String(error?.message ?? error);
        const count = (seen.get(message) ?? 0) + 1;
        seen.set(message, count);

        if (count === 1) console.error('[frame]', error);

        fault.textContent = `frame error — see console: ${message}${count > 1 ? ` (x${count})` : ''}`;
        fault.classList.remove('hidden');
      };
    })(),
  };
}
