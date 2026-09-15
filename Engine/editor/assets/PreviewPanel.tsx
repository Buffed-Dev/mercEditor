import { useEffect, useMemo, useRef, useState } from 'react';
import { IconPlayerPlay, IconX } from '@tabler/icons-react';
import { fileUrl } from '../../src/data/assets.ts';
import { MATERIAL_SHAPE_KEYS, MATERIAL_SHAPES, type MaterialInput } from '../../src/data/materials.ts';
import type { PropInput } from '../../src/data/props.ts';
import type { ProfileInput } from '../../src/data/profiles.ts';
import type { DataDocument } from '../dataDocument.ts';
import { createAssetPreview } from '../preview/assetPreview.ts';
import { createMaterialPreview } from '../preview/materialPreview.ts';
import { createVfxPreview } from '../preview/vfxPreview.ts';
import { useDocument } from '../state/useDocument';
import { Button, IconButton } from '../ui/Button';
import { usePreviewStage } from '../viewport/usePreviewStage';
import { useAssetSelection } from './assetSelection.ts';
import { findRecord, previewReplay, useSelectedAssets } from './AssetInspector';
import { displayName, folderOf, type AssetEntry } from './model.ts';
import styles from './AssetInspector.module.css';

const WIDTH_KEY = 'merc.previewWidth';
const readWidth = () => {
  try {
    return Number(localStorage.getItem(WIDTH_KEY)) || 340;
  } catch {
    return 340;
  }
};

/**
 * The selected asset, drawn live beside the inspector. Opened and closed with
 * the inspector's preview button; drag its left edge to resize it, drag the
 * picture to turn around it.
 */
export function PreviewPanel({ game, rules: rulesDoc }: { game: string; rules: DataDocument | null }) {
  const open = useAssetSelection((state) => state.previewOpen);
  const chosen = useSelectedAssets();
  const [width, setWidth] = useState(readWidth);
  const entry = chosen.length === 1 ? chosen[0] : undefined;
  if (!open || !entry || entry.dir || entry.type === 'other') return null;

  const startResize = (event: React.PointerEvent) => {
    const from = event.clientX;
    const was = width;
    const move = (e: PointerEvent) => setWidth(Math.max(200, Math.min(900, was + (from - e.clientX))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_KEY, String(w));
        } catch {
          // Only a convenience.
        }
        return w;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <aside className={styles.preview} style={{ width, flex: 'none' }} aria-label="Asset preview">
      <div className={styles.resizer} onPointerDown={startResize} role="separator" aria-orientation="vertical" />
      <div className={styles.previewHead}>
        <span className={styles.previewTitle}>{displayName(entry)}</span>
        {entry.type === 'effect' && (
          <IconButton label="Restart effect" onClick={() => {
            previewReplay.count += 1;
            for (const listener of previewReplay.listeners) listener();
          }}>
            <IconPlayerPlay size={15} />
          </IconButton>
        )}
        <IconButton label="Close preview" onClick={() => useAssetSelection.getState().togglePreview()}>
          <IconX size={15} />
        </IconButton>
      </div>
      <div className={styles.canvasWrap}>
        {entry.type === 'texture' ? (
          <img className={styles.image} src={fileUrl(entry.path, game)} alt={displayName(entry)} />
        ) : (
          <Stage key={entry.type === 'material' ? 'material' : entry.type === 'effect' ? 'effect' : 'asset'} entry={entry} game={game} rules={rulesDoc} />
        )}
      </div>
    </aside>
  );
}

function Stage({ entry, game, rules: rulesDoc }: { entry: AssetEntry; game: string; rules: DataDocument | null }) {
  const rules = useDocument(rulesDoc);
  const [shape, setShape] = useState('sphere');
  const family = entry.type === 'material' ? 'material' : entry.type === 'effect' ? 'effect' : 'asset';
  const preview = useMemo(() => {
    if (family === 'material') return createMaterialPreview();
    if (family === 'effect') return createVfxPreview(game);
    return createAssetPreview();
  }, [family, game]);
  const { host, ready, orbit } = usePreviewStage(preview);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [replays, setReplays] = useState(0);

  useEffect(() => {
    const listener = () => setReplays((n) => n + 1);
    previewReplay.listeners.add(listener);
    return () => void previewReplay.listeners.delete(listener);
  }, []);

  const record =
    entry.type === 'model'
      ? entry.id
        ? { id: entry.id, mesh: entry.id, path: folderOf(entry.path), label: displayName(entry) }
        : null
      : (findRecord(rules, entry)?.record ?? null);
  const key = JSON.stringify(record);
  const materials = rules?.list('materials') ?? [];
  const props = rules?.list('props') ?? [];

  useEffect(() => {
    if (!ready || !record) return;
    const urlOf = (path: string) => fileUrl(path, game);
    if (family === 'material') {
      (preview as ReturnType<typeof createMaterialPreview>).draw(record, { shape, urlOf });
    } else if (family === 'effect') {
      (preview as ReturnType<typeof createVfxPreview>).draw(record);
    } else {
      (preview as ReturnType<typeof createAssetPreview>).draw(record, {
        kind:
          entry.type === 'block' ? 'terrains' : entry.type === 'prefab' ? 'prefabs' : entry.type === 'profile' ? 'profiles' : 'props',
        materials: materials as unknown as MaterialInput[],
        props: props as unknown as PropInput[],
        profiles: (rules?.list('profiles') ?? []) as unknown as ProfileInput[],
        game,
      });
    }
    // Redrawn whenever the record, its materials or its models change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, preview, key, shape, replays, rules?.revision, entry.type, game]);

  return (
    <>
      <canvas
        ref={host}
        className={styles.canvas}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          orbit(event.clientX - drag.current.x, event.clientY - drag.current.y);
          drag.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      />
      {family === 'material' && (
        <div className={styles.shapes} role="toolbar" aria-label="Preview shape">
          {(MATERIAL_SHAPE_KEYS as string[]).map((id) => (
            <Button key={id} variant="quiet" active={shape === id} onClick={() => setShape(id)}>
              {(MATERIAL_SHAPES as Record<string, { label: string }>)[id]?.label ?? id}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
