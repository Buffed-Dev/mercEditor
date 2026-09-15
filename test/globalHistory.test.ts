import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlobalHistory } from '../Engine/editor/globalHistory.ts';
import { createUndoable } from '../Engine/editor/undoable.ts';

test('one undo stack replays two documents and a file step in the order they happened', async () => {
  const history = createGlobalHistory();
  const a = createUndoable({ n: 0 });
  const b = createUndoable({ n: 0 });
  history.attach(a, 'a');
  history.attach(b, 'b');
  const files: string[] = [];

  a.checkpoint();
  a.state.n = 1;
  history.push({ label: 'file', undo: () => files.push('undo'), redo: () => files.push('redo') });
  b.checkpoint();
  b.state.n = 1;

  await history.undo();
  assert.equal(b.state.n, 0);
  assert.equal(a.state.n, 1);
  await history.undo();
  assert.deepEqual(files, ['undo']);
  await history.undo();
  assert.equal(a.state.n, 0);
  assert.equal(history.canUndo, false);

  await history.redo();
  assert.equal(a.state.n, 1);
  // Replaying a document's undo does not record a new step and clear redo.
  assert.equal(history.canRedo, true);
});

test('steps taken inside a batch are not recorded on their own', async () => {
  const history = createGlobalHistory();
  const doc = createUndoable({ n: 0 });
  history.attach(doc, 'doc');
  await history.batch(() => {
    doc.checkpoint();
    doc.state.n = 5;
  });
  assert.equal(history.canUndo, false);
});
