import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Rectangle } from '@babylonjs/gui/2D/controls/rectangle.js';
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock.js';
import type { AdvancedDynamicTexture } from '@babylonjs/gui/2D/advancedDynamicTexture.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Plate as Anchor } from '../render/groundItems.ts';

/** One name plate: its box, and the text inside it. */
type PlateControls = { box: Rectangle; caption: TextBlock };

/**
 * The name plates floating over dropped items — and the thing you click to
 * pick one up.
 *
 * A plate is a Babylon GUI control that projects itself onto a world point, so
 * nothing here has to know where the camera is or how to turn a position into
 * pixels. It is also already a pointer target, which means picking an item up
 * is a click handler rather than a second raycast that has to agree with the
 * first about what is under the cursor.
 *
 * Plates are pooled by drop id. Rebuilding them every frame would rebuild a
 * dozen controls sixty times a second, and would also drop whichever one the
 * pointer was over halfway through a click.
 */

const FONT = 'ui-monospace, Menlo, Consolas, monospace';

const PLATE = { fill: '#0b0f17', line: '#3b4257', ink: '#d7c08a' };
const HOVER = { fill: '#1b2231', line: '#7d6a3e', ink: '#f0dcae' };

const PLATE_HEIGHT = 18;
/** Roughly the width of a character at this size, plus the padding either side. */
const CHAR_WIDTH = 6.7;
const PADDING = 16;

/**
 * @param {import('@babylonjs/gui/2D/advancedDynamicTexture.js').AdvancedDynamicTexture} ui
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 */
export function createGroundLabels(
  ui: AdvancedDynamicTexture,
  scene: Scene,
  { onPick }: { onPick?: (id: string) => void } = {},
) {
  /** drop id -> its control. */
  const plates = new Map<string, PlateControls>();
  /**
   * Which plates the pointer is currently over.
   *
   * The plates live inside the canvas, so as far as the DOM is concerned a
   * press on one is a press on the world — which would swing at the floor as
   * well as answering the plate. This is what the frame loop asks instead.
   *
   * A set rather than a count, because a count can only be right if every
   * "entered" is matched by exactly one "left" — and a plate can be disposed
   * out from under the pointer, which is precisely when that stops being true.
   * Adding and removing the same plate twice is harmless; counting it twice is
   * a cursor that never lets go.
   */
  const hovered = new Set<Rectangle>();
  /** Reused so projecting a plate allocates nothing. */
  const at = new Vector3();

  function plateFor(id: string, label: string): PlateControls {
    let plate = plates.get(id);
    if (plate) return plate;

    const box = new Rectangle(`plate${id}`);
    box.heightInPixels = PLATE_HEIGHT;
    box.background = PLATE.fill;
    box.color = PLATE.line;
    box.alpha = 0.94;
    box.thickness = 1;
    box.cornerRadius = 3;
    box.isPointerBlocker = true;
    box.hoverCursor = 'pointer';
    // The plate hangs above the point it is anchored to, the way it did when
    // the anchor was the item and the plate was a tooltip over it.
    box.transformCenterY = 1;

    const caption = new TextBlock(`label${id}`, label);
    caption.fontFamily = FONT;
    caption.fontSize = 11;
    caption.color = PLATE.ink;
    box.addControl(caption);

    box.onPointerEnterObservable.add(() => {
      hovered.add(box);
      box.background = HOVER.fill;
      box.color = HOVER.line;
      caption.color = HOVER.ink;
    });
    box.onPointerOutObservable.add(() => {
      hovered.delete(box);
      box.background = PLATE.fill;
      box.color = PLATE.line;
      caption.color = PLATE.ink;
    });
    // Click, not up: a drag that happens to end over a plate is not a click
    // on it, and picking an item up because the pointer was released there
    // would be an item taken by accident.
    box.onPointerClickObservable.add(() => onPick?.(id));

    ui.addControl(box);
    plate = { box, caption };
    plates.set(id, plate);
    return plate;
  }

  return {
    get count() {
      return plates.size;
    },

    /** Is the pointer over a plate? A press there is interface, not an attack. */
    get hovering() {
      return hovered.size > 0;
    },

    /**
     * @param {{id: string, label: string, x: number, y: number, z: number}[]} anchors
     */
    update(anchors: readonly Anchor[]): void {
      const live = new Set<string>();

      for (const anchor of anchors) {
        live.add(anchor.id);
        const { box, caption } = plateFor(anchor.id, anchor.label);

        // Drop ids start again at 1 in each level, so the same id can come back
        // meaning a different item. Cheap to compare, and the alternative is a
        // plate that confidently names the last level's loot.
        if (caption.text !== anchor.label) caption.text = anchor.label;
        box.widthInPixels = anchor.label.length * CHAR_WIDTH + PADDING;

        at.set(anchor.x, anchor.y, anchor.z);
        box.moveToVector3(at, scene);
        // A plate anchored at the item's head should sit above it, not on it.
        box.linkOffsetYInPixels = -PLATE_HEIGHT;
      }

      for (const [id, plate] of plates) {
        if (live.has(id)) continue;
        hovered.delete(plate.box);
        plate.box.dispose();
        plates.delete(id);
      }
    },

    /** Drop every plate — the level changed, or the game stopped. */
    clear(): void {
      for (const plate of plates.values()) plate.box.dispose();
      plates.clear();
      hovered.clear();
    },

    /**
     * Hidden while the game is not running, without losing the pool. A control
     * hidden under the pointer is never told the pointer left, so the hover has
     * to be given up here.
     */
    setVisible(on: boolean): void {
      for (const plate of plates.values()) plate.box.isVisible = on;
      if (!on) hovered.clear();
    },
  };
}

/** The name plates hanging over what is on the floor. */
export type GroundLabels = ReturnType<typeof createGroundLabels>;
