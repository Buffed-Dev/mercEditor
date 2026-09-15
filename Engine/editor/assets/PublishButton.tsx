import { useState } from 'react';
import { IconCloudUpload, IconLoader2 } from '@tabler/icons-react';
import { useGame } from '../state/useGame';
import { say } from '../state/status';
import { Button } from '../ui/Button';
import { ProblemsDialog } from './Dialogs';
import { validate, type Problem } from './model.ts';
import { publish, refreshTree, useAssetTree } from './session.ts';

/**
 * Publish: every draft change goes into the game at once. Refused, with the
 * reasons listed, while an asset names something that is not there.
 */
export function PublishButton({ game }: { game: string }) {
  const loaded = useGame(game);
  const pending = useAssetTree((state) => state.pending);
  const saving = useAssetTree((state) => state.saving);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Problem[] | null>(null);

  async function onPublish() {
    const rules = loaded?.rules;
    if (!rules || busy) return;
    setBusy(true);
    try {
      // Let a pending autosave land first, so what is published is what is on screen.
      await new Promise((resolve) => setTimeout(resolve, 600));
      const { entries, errors } = useAssetTree.getState();
      const fileIds = new Set(entries.flatMap((entry) => (entry.id ? [entry.id] : [])));
      const found = [
        ...errors,
        ...validate(
          {
            materials: rules.list('materials'),
            terrains: rules.list('terrains'),
            prefabs: rules.list('prefabs'),
            vfx: rules.list('vfx'),
            props: rules.list('props'),
            profiles: rules.list('profiles'),
          },
          fileIds,
        ),
      ];
      const result = await publish(game, found);
      if (!result.ok) {
        setProblems(result.problems);
        return;
      }
      say(`Published: ${result.wrote} file${result.wrote === 1 ? '' : 's'} written, ${result.deleted} removed`, 'good');
      await refreshTree(game, rules);
    } catch (error) {
      say(`Publish failed: ${(error as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  const label = busy ? 'Publishing…' : pending ? `Publish (${pending})` : 'Publish';
  return (
    <>
      <ProblemsDialog problems={problems} onClose={() => setProblems(null)} />
      <Button
        variant="primary"
        onClick={() => void onPublish()}
        disabled={busy || !loaded}
        title={pending ? `${pending} unpublished change${pending === 1 ? '' : 's'}${saving ? ', saving…' : ''}` : 'Nothing to publish'}
      >
        {busy ? <IconLoader2 size={15} /> : <IconCloudUpload size={15} />}
        {label}
      </Button>
    </>
  );
}
