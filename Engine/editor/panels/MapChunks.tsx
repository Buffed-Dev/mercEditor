import { IconFocus, IconFocusCentered, IconPlus } from '@tabler/icons-react';
import { CHUNK_ROLES, chunkCount } from '../../src/data/maps/chunks.ts';
import { EMPTY, kindAt, type TerrainGrid } from '../../src/data/terrain/grid.ts';
import { endRun } from '../../src/data/maps/generate.ts';
import { Field } from '../fields/Field';
import type { FieldSpec, FieldValue } from '../fields/types';
import { Button, IconButton } from '../ui/Button';
import { Section } from '../ui/Section';
import { say } from '../state/status';
import { useSelection } from '../state/selection';
import styles from './MapChunks.module.css';

/**
 * The map's structure, as opposed to its contents.
 *
 * A chunk is not a thing *on* the map — it is a rectangle of the map itself,
 * which is why chunks are not in the object list beside the lights and the
 * portals. A generated map is mostly chunks, and listing them there buried
 * everything else under a wall of pieces.
 */

type Chunk = { name?: string; role?: string; gx: number; gy: number; w: number; h: number };

type MapDoc = {
  map: Record<string, unknown>;
  cols: number;
  rows: number;
  terrain: TerrainGrid;
  addChunk: () => number;
  removeObject: (list: string, index: number, checkpointed?: boolean) => void;
  setMeta: (key: string, value: unknown, checkpointed?: boolean) => void;
  checkpoint: (checkpointed?: boolean) => void;
};

type MapEditor = {
  invalidate: () => void;
  setFocus: (rect: Chunk | null, refit?: boolean) => void;
  focus: Chunk | null;
};

const field = (spec: { key: string; kind: string; label: string } & Record<string, unknown>) =>
  spec as unknown as FieldSpec;

/** What a role is called, so the entrance is findable without opening each. */
const roleLabel = (role?: string) =>
  CHUNK_ROLES.find(([id]) => id === (role ?? ''))?.[1] ?? '';

/** The object lists a chunk can contain — the same set `chunksOf` cuts out. */
const LISTS = ['lights', 'doors'];

/**
 * What is drawn on the map but inside no chunk, and so would not be generated.
 *
 * Worth saying out loud: a room you have drawn and not marked off is the
 * easiest thing in the world not to notice, and it simply will not be there.
 *
 * Counted off the live grid rather than through `strayCount`, which reads the
 * encoded rows a saved map has and the open document does not — it would report
 * every stray object and no stray ground at all.
 */
function straysIn(doc: MapDoc) {
  const chunks = (doc.map.chunks as Chunk[]) ?? [];
  const covered = (gx: number, gy: number) =>
    chunks.some((c) => gx >= c.gx && gx < c.gx + c.w && gy >= c.gy && gy < c.gy + c.h);

  let tiles = 0;
  for (let gy = 0; gy < doc.rows; gy += 1) {
    for (let gx = 0; gx < doc.cols; gx += 1) {
      if (kindAt(doc.terrain, gx, gy) !== EMPTY && !covered(gx, gy)) tiles += 1;
    }
  }

  let objects = 0;
  for (const list of LISTS) {
    for (const entry of ((doc.map[list] as { gx: number; gy: number }[]) ?? [])) {
      if (!covered(entry.gx, entry.gy)) objects += 1;
    }
  }
  return { tiles, objects };
}

export function MapChunks({
  doc,
  editor,
  mapId,
  onPlaytest,
}: {
  doc: MapDoc;
  editor: MapEditor | null;
  mapId: string;
  onPlaytest: () => void;
}) {
  const select = useSelection((state) => state.select);
  const chunks = (doc.map.chunks as Chunk[]) ?? [];
  const generated = Boolean(doc.map.generated);
  const focused = editor?.focus ?? null;
  const stray = straysIn(doc);

  return (
    <>
      <Section
        id="inspector:chunks"
        title="Chunks"
        count={chunks.length}
        action={
          <IconButton
            label="Add a chunk"
            onClick={() => {
              const at = doc.addChunk();
              editor?.invalidate();
              select({ list: 'chunks', index: at });
            }}
          >
            <IconPlus size={13} />
          </IconButton>
        }
      >
        {chunks.length === 0 ? (
          <p className={styles.note}>
            No pieces marked off. A chunk is a rectangle of this map that a run
            can place on its own.
          </p>
        ) : (
          chunks.map((chunk, index) => {
            const on = Boolean(
              focused &&
                focused.gx === chunk.gx &&
                focused.gy === chunk.gy &&
                focused.w === chunk.w &&
                focused.h === chunk.h,
            );
            return (
              <div key={index} className={styles.row}>
                <button
                  type="button"
                  className={styles.name}
                  onClick={() => select({ list: 'chunks', index })}
                  title="Edit this chunk"
                >
                  <span className={styles.label}>{chunk.name || `chunk ${index + 1}`}</span>
                  {/* Which piece is the entrance decides whether a run can
                      start at all, so it is worth seeing without opening one. */}
                  {chunk.role && <span className={styles.role}>{roleLabel(chunk.role)}</span>}
                  <span className={styles.size}>
                    {Math.round(chunk.w)}×{Math.round(chunk.h)}
                  </span>
                </button>
                {/*
                  Showing one chunk on its own is how it is edited: it is the
                  little map it will become, so the view is cut down to it and
                  everything outside stops being in the way — and stops being
                  clickable.
                */}
                <IconButton
                  label={on ? 'Show the whole map' : `Show only ${chunk.name || 'this chunk'}`}
                  active={on}
                  onClick={() => editor?.setFocus(on ? null : chunk)}
                >
                  {on ? <IconFocusCentered size={13} /> : <IconFocus size={13} />}
                </IconButton>
              </div>
            );
          })
        )}
      </Section>

      <Section id="inspector:generate" title="Generate">
        <Field
          field={field({ key: 'generated', kind: 'bool', label: 'Assemble from chunks' })}
          value={generated}
          onInput={() => {}}
          onChange={(value) => {
            doc.setMeta('generated', Boolean(value));
            editor?.invalidate();
          }}
        />

        {/*
          The chunks stay put either way — the switch is a switch, not a delete.
          What it decides is whether what you walk is this grid or something
          assembled from the pieces drawn on it.
        */}
        {generated && (
          <>
            <Field
              field={field({
                key: 'chunkCount',
                kind: 'range',
                label: 'Pieces per run',
                min: 1,
                max: 40,
                step: 1,
              })}
              // Through the game's own reader, not `?? DEFAULT`: a map stores
              // 0 to mean "however many the game decides", so a nullish check
              // shows a zero that reads as "no pieces at all".
              value={chunkCount(doc.map) as FieldValue}
              onInput={(value) => doc.setMeta('chunkCount', Number(value), false)}
              onChange={(value) => doc.setMeta('chunkCount', Number(value), false)}
            />

            {chunks.length === 0 && (
              <p className={styles.warn}>
                Nothing to assemble: mark at least one chunk, and one of them the
                entrance.
              </p>
            )}

            {chunks.length > 0 && !chunks.some((chunk) => chunk.role === 'start') && (
              <p className={styles.warn}>
                No entrance. A run needs one chunk with its role set to Entrance
                to start in.
              </p>
            )}

            {(stray.tiles > 0 || stray.objects > 0) && (
              <p className={styles.warn}>
                Outside every chunk: {stray.tiles} tile{stray.tiles === 1 ? '' : 's'} and{' '}
                {stray.objects} object{stray.objects === 1 ? '' : 's'}. None of it
                will be in a run.
              </p>
            )}

            {/*
              A dungeon is assembled once and kept for the whole run, so playing
              again without ending the last one shows the same layout — which
              reads as the generator ignoring the change you just made.
            */}
            <Button
              variant="default"
              className={styles.play}
              onClick={() => {
                endRun(mapId);
                say('Starting a fresh run.', 'good');
                onPlaytest();
              }}
            >
              Generate and play
            </Button>
          </>
        )}
      </Section>
    </>
  );
}
