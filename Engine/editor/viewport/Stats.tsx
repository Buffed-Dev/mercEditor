import { useEffect, useState } from 'react';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation.js';
import type { Scene } from '@babylonjs/core/scene.js';
import styles from './Stats.module.css';

/**
 * What the frame is spending its time on.
 *
 * Not a frame counter. A number that says 24 tells you there is a problem and
 * nothing else — the useful reading is the one underneath it, and the whole
 * point of this panel is to be able to say *which* of the four or five things
 * a frame does has grown. So it is a breakdown first and an fps last.
 *
 * Babylon's own instrumentation, rather than timers of our own. It hooks the
 * scene's before/after observables for each phase, which is the only place the
 * split between "working out what to draw" and "drawing it" can be seen from.
 *
 * The instrument is built when the panel opens and disposed when it closes.
 * Every counter costs a pair of observers and a clock reading per frame, which
 * is not much and is not nothing — and a measurement that is always running is
 * a measurement in every frame you ship.
 *
 * No GPU frame time. Babylon can read one, but only through a query extension
 * this engine does not import — and the reading is driver-dependent anyway.
 * What is here is the CPU side, split by phase, which is what a stall in the
 * editor has always turned out to be.
 */
export function Stats({ scene }: { scene: Scene }) {
  const [rows, setRows] = useState<readonly Row[]>([]);

  useEffect(() => {
    const engine = scene.getEngine();
    const sceneMeter = new SceneInstrumentation(scene);
    sceneMeter.captureFrameTime = true;
    sceneMeter.captureRenderTime = true;
    sceneMeter.captureInterFrameTime = true;
    sceneMeter.captureActiveMeshesEvaluationTime = true;
    sceneMeter.captureRenderTargetsRenderTime = true;
    sceneMeter.captureParticlesRenderTime = true;
    sceneMeter.captureAnimationsTime = true;

    /**
     * Read a few times a second, not every frame.
     *
     * Sixty renders a second to report on sixty renders a second is a panel
     * that changes what it is measuring. Four is faster than anyone reads, and
     * every time here is a one-second average anyway, so a quicker poll would
     * only redraw the same numbers.
     */
    const read = () => {
      setRows([
        ['Frames', `${engine.getFps().toFixed(0)} fps`, true],
        ['Frame', ms(sceneMeter.frameTimeCounter.lastSecAverage)],
        // What Babylon was not in: the browser's own work, our update, layout.
        ['Between frames', ms(sceneMeter.interFrameTimeCounter.lastSecAverage)],

        ['—'],
        // The four phases a frame is made of. One of these is the answer.
        ['Choosing meshes', ms(sceneMeter.activeMeshesEvaluationTimeCounter.lastSecAverage)],
        ['Shadow maps', ms(sceneMeter.renderTargetsRenderTimeCounter.lastSecAverage)],
        ['Drawing', ms(sceneMeter.renderTimeCounter.lastSecAverage)],
        ['Animation', ms(sceneMeter.animationsTimeCounter.lastSecAverage)],
        ['Particles', ms(sceneMeter.particlesRenderTimeCounter.lastSecAverage)],

        ['—'],
        // And what it was asked to draw, which is what those times are of.
        ['Draw calls', String(sceneMeter.drawCallsCounter.current)],
        ['Meshes drawn', `${scene.getActiveMeshes().length} / ${scene.meshes.length}`],
        ['Triangles', thousands(scene.getActiveIndices() / 3)],
        ['Lights', String(scene.lights.length)],
        ['Materials', String(scene.materials.length)],
        ['Textures', String(scene.textures.length)],
      ]);
    };

    read();
    const timer = setInterval(read, 250);
    return () => {
      clearInterval(timer);
      sceneMeter.dispose();
    };
  }, [scene]);

  return (
    <div className={styles.panel} role="status" aria-label="Performance">
      {rows.map(([label, value, strong], at) =>
        value === undefined ? (
          <hr key={`rule${at}`} className={styles.rule} />
        ) : (
          <div key={label} className={`${styles.row} ${strong ? styles.strong : ''}`}>
            <span className={styles.label}>{label}</span>
            <span className={styles.value}>{value}</span>
          </div>
        ),
      )}
    </div>
  );
}

/** A label and a reading, or a label alone for a rule between groups. */
type Row = readonly [string, string?, boolean?];

/**
 * A duration, to a tenth of a millisecond.
 *
 * Tenths because the interesting ones are small: a shadow pass going from 0.4
 * to 1.9 is the whole finding, and rounded to whole milliseconds it is 0 to 2.
 */
const ms = (value: number) => `${value.toFixed(1)} ms`;

const thousands = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0);
