/**
 * The action registry.
 *
 * Two kinds of test, and the split is the point. The first is table-driven: it
 * walks every registered action and checks the things a hand-written file can
 * get wrong. That one test is what makes a hundred actions safe — a typo in the
 * ninety-seventh is caught without anybody writing a ninety-seventh test.
 *
 * The second kind pins the handful of lines that actually branch: the id guard,
 * the wiring lookup, the prefab overrides
 * without touching a map file, and the once-per-tile latch.
 *
 * Deliberately imports the registry directly rather than through anything that
 * globs. `import.meta.glob` does not exist under `node --test` — see
 * Games/Merc/game.js, which says so — and a registry that came back empty here
 * would pass every assertion below by having nothing to check.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ACTIONS, actionGroups, runAction, runActions } from '../Engine/src/game/actions/index.ts';
import {
  EVENTS,
  WIRABLE_LISTS,
  eventApplies,
  eventBlockedBy,
  wiringsFor,
} from '../Engine/src/game/events/index.ts';
import { FIELD_KINDS } from '../Engine/editor/fields/types.ts';
import { createDocument } from '../Engine/editor/document.ts';
import { fieldsFor } from '../Engine/editor/schema.ts';
import { mapToPrefab, prefabToMap } from '../Engine/editor/prefabDoc.ts';
import { serializeMap } from '../Engine/editor/serialize.ts';
import { mapDoc } from './helpers/terrainFixtures.ts';
import { expandPrefabs, normalizePrefab, override } from '../Engine/src/data/prefabs.ts';
import type { GameMap } from '../Engine/src/data/mapFormat.ts';
import type { ActionContext } from '../Engine/src/game/actions/index.ts';

/** Enough of a context to run a verb that only reads its own variables. */
const context = () =>
  ({
    object: { gx: 0, gy: 0 },
    player: {},
    world: {},
    effects: {},
    level: { pickUp: () => ({ ok: true, reason: '' }) },
  }) as unknown as Omit<ActionContext, 'vars'>;

test('every registered action is one the editor can draw and the engine can run', () => {
  const ids = Object.keys(ACTIONS);
  assert.ok(ids.length, 'the registry is empty, so nothing below checked anything');

  for (const [id, spec] of Object.entries(ACTIONS)) {
    assert.ok(spec.label, `${id} has no label, so the picker would show a blank row`);
    assert.ok(spec.hint, `${id} has no hint, and a long list is unreadable without one`);
    assert.equal(typeof spec.run, 'function', `${id} has nothing to run`);
    assert.ok(Array.isArray(spec.vars), `${id} does not say what variables it reads`);

    const seen = new Set<string>();
    for (const one of spec.vars) {
      assert.ok(one.key, `${id} has a variable with no key`);
      assert.ok(!seen.has(one.key), `${id} declares "${one.key}" twice`);
      seen.add(one.key);
      assert.ok(one.label, `${id}.${one.key} has no label`);
      assert.ok(
        (FIELD_KINDS as readonly string[]).includes(one.kind),
        `${id}.${one.key} is a "${one.kind}", which is not a control that exists`,
      );
      // A picker with nothing to pick draws as an empty box, which reads as a
      // broken panel rather than as a setting nobody filled in.
      if (one.kind === 'select') {
        assert.ok(one.options?.length, `${id}.${one.key} is a select with no options`);
      }
    }
  }
});

test('the categories account for every action exactly once', () => {
  const grouped = actionGroups().flatMap((group) => group.options.map(([id]) => id));
  assert.deepEqual(
    [...grouped].sort(),
    Object.keys(ACTIONS).sort(),
    'an action is in the table but in no category, or in two',
  );
  assert.equal(new Set(grouped).size, grouped.length, 'an action id is registered twice');
});

test('an event only reaches lists it could actually fire on', () => {
  for (const [event, spec] of Object.entries(EVENTS)) {
    assert.ok(spec.label, `the ${event} event has no label`);
    for (const list of spec.lists ?? []) {
      assert.ok(
        (WIRABLE_LISTS as readonly string[]).includes(list),
        `the ${event} event names "${list}", which nothing can carry a wiring on`,
      );
    }
  }
  assert.equal(eventApplies('interact', 'props'), true);
  assert.equal(eventApplies('nonesuch', 'props'), false);
  // A light is not a thing you walk into.
  assert.equal(eventApplies('collision', 'lights'), false);
});

test('every trigger is offered on any prefab, save one nothing could fire', () => {
  // A prefab used to declare its kind, and the kind decided this. It was a
  // second place to say what its triggers already said: adding an interact
  // trigger to a thing *is* saying it can be interacted with.
  const plain = { id: 'vase', label: 'Vase' };
  assert.equal(eventApplies('collision', 'prefabs', plain), true);
  assert.equal(eventApplies('interact', 'prefabs', plain), true);

  // Except being hit, which needs something the damage path can reach. Not
  // "is it a creature" — a vase is not one, and neither is a torch you can
  // swing at. It needs a body, and naming an archetype is how a prefab says so.
  assert.equal(eventApplies('hit', 'prefabs', plain), false);
  assert.equal(eventApplies('dead', 'prefabs', plain), false);
  assert.equal(eventApplies('hit', 'prefabs', { ...plain, archetype: 'vase' }), true);
  assert.equal(eventApplies('dead', 'prefabs', { ...plain, archetype: 'vase' }), true);
});

test('a trigger nothing could fire says why, rather than going missing', () => {
  const why = eventBlockedBy('hit', { id: 'torch' });
  assert.ok(why && why.length, 'a trigger left out of the menu reads as a bug in the menu');
  assert.equal(eventBlockedBy('hit', { archetype: 'vase' }), null);
  assert.equal(eventBlockedBy('interact', { id: 'torch' }), null);
});

test('an action that is not in the table runs nothing rather than throwing', () => {
  assert.equal(runAction({ do: 'nonesuch' }, context()), null);
  assert.equal(runAction({ do: 42 }, context()), null);
  assert.equal(runAction(null, context()), null);
  assert.equal(runAction({}, context()), null);
});

test('a teleport asks to go where its variables say, and nowhere without them', () => {
  assert.deepEqual(runAction({ do: 'teleport', to: 'cave', spawn: 'mouth' }, context()), {
    go: 'cave',
    spawn: 'mouth',
  });
  assert.deepEqual(runAction({ do: 'teleport', to: 'cave' }, context()), { go: 'cave' });
  // A map file may put anything in the field, so only a name is followed.
  assert.equal(runAction({ do: 'teleport', to: '' }, context()), null);
  assert.equal(runAction({ do: 'teleport' }, context()), null);
});

test('nothing is wired by which list it is on', () => {
  // There used to be a table saying an object on the `portals` list teleports
  // and one on `stations` opens crafting, whether or not anybody wired them.
  // It was a second kind of behaviour beside this one and invisible in the
  // panel; both lists are gone, and so is it. What a thing does is only ever
  // what is written on it.
  assert.deepEqual(wiringsFor('props', 'collision', { gx: 0, gy: 0, id: 'rock' }), []);
  assert.deepEqual(wiringsFor('prefabs', 'hit', { gx: 0, gy: 0, id: 'vase' }), []);
  assert.deepEqual(
    wiringsFor('props', 'collision', {
      gx: 0,
      gy: 0,
      collision: { do: 'say', message: 'It is cold.' },
    }),
    [{ do: 'say', message: 'It is cold.' }],
  );
});

test('one trigger runs every action under it, in the order they are written', () => {
  const lever = {
    gx: 0,
    gy: 0,
    interact: [
      { do: 'say', message: 'It gives.' },
      { do: 'teleport', to: 'cave' },
      { do: 'say', message: 'And you are elsewhere.' },
    ],
  };
  assert.deepEqual(runActions(wiringsFor('props', 'interact', lever), context()), [
    { say: 'It gives.' },
    { go: 'cave' },
    { say: 'And you are elsewhere.' },
  ]);
});

test('one action written on its own is read as a list of one', () => {
  // Everything already in a map file is written this way, so this is what stops
  // multiple actions from being a format change.
  assert.deepEqual(wiringsFor('props', 'interact', { gx: 0, gy: 0, interact: { do: 'say' } }), [
    { do: 'say' },
  ]);
});

test('an action that is not an action is skipped, and the rest still run', () => {
  const wirings = wiringsFor('props', 'interact', {
    gx: 0,
    gy: 0,
    interact: [{ do: 'nonesuch' }, { do: 'say', message: 'Still here.' }],
  });
  assert.deepEqual(runActions(wirings, context()), [{ say: 'Still here.' }]);
});

// ------------------------------------------------------------ through a save

/**
 * The serializer used to promise this and not do it.
 *
 * Every list's formatter is a fixed set of columns, so a field it had not been
 * told about was dropped the first time the map was saved. A wiring is exactly
 * such a field — and so is every variable of every action there will ever be,
 * which is why this is the test that stands for all of them rather than one per
 * action.
 */
test('a wiring survives being written to a map file and read back', async () => {
  const doc = createDocument(
    {
      ...mapDoc(['....', '....', '....'], { id: 'yard', name: 'Yard' }),
      props: [
        { gx: 1, gy: 1, id: 'rock', collision: { do: 'teleport', to: 'cave', spawn: 'mouth' } },
        { gx: 2, gy: 0, id: 'bench', interact: { do: 'openUI', ui: 'crafting' } },
      ],
      prefabs: [{ gx: 0, gy: 2, id: 'vase', hit: { do: 'say', message: 'Hello.' } }],
    } as unknown as GameMap,
    () => null,
  );

  const source = serializeMap(doc.map, () => 'gr');
  const module = (await import(
    `data:text/javascript,${encodeURIComponent(source)}`
  )) as Record<string, GameMap>;
  const read = Object.values(module)[0];

  assert.deepEqual(read.props?.[0].collision, { do: 'teleport', to: 'cave', spawn: 'mouth' });
  assert.deepEqual(read.props?.[1].interact, { do: 'openUI', ui: 'crafting' });
  assert.deepEqual(read.prefabs?.[0].hit, { do: 'say', message: 'Hello.' });
  // And what was already written is still written the way it was.
  assert.equal(read.prefabs?.[0].id, 'vase');
  assert.equal(read.props?.[0].id, 'rock');
});

test('choosing a different action does not drag the old one"s variables along', () => {
  const doc = createDocument(
    {
      ...mapDoc(['....', '....'], { id: 'yard' }),
      props: [{ gx: 0, gy: 0, id: 'rock', interact: { do: 'teleport', to: 'cave' } }],
    } as unknown as GameMap,
    () => null,
  );

  doc.updateObject('props', 0, { 'interact.do': 'say' });
  // `to` meant something to a teleport and nothing to a say. Left behind, it
  // would be written into the map file for as long as the object existed.
  assert.deepEqual(doc.map.props?.[0].interact, { do: 'say' });

  doc.updateObject('props', 0, { 'interact.message': 'Hello.' });
  assert.deepEqual(doc.map.props?.[0].interact, { do: 'say', message: 'Hello.' });
});

// ------------------------------------------------- one prefab, many settings

/**
 * A door prefab: an arch you walk into, going nowhere until a placement says.
 *
 * The wiring is on the child rather than on the record, because `expandPrefabs`
 * is what these three exercise and children are all it touches. A record's own
 * triggers are overridden a layer up, where the level resolves a placement —
 * see "a prefab carries its own triggers" below.
 */
const doorPrefab = normalizePrefab({
  id: 'door',
  label: 'Door',
  props: [{ gx: 0, gy: 0, id: 'arch', collision: { do: 'teleport', to: '', spawn: '' } }],
} as never);

test('a placement says where this one of them goes, and its prefab keeps the default', () => {
  const map = expandPrefabs(
    {
      id: 'yard',
      prefabs: [
        { gx: 1, gy: 1, id: 'door', set: { to: 'cave', spawn: 'mouth' } },
        { gx: 5, gy: 1, id: 'door', set: { to: 'town' } },
        { gx: 9, gy: 1, id: 'door' },
      ],
    } as unknown as GameMap,
    (id) => (id === 'door' ? doorPrefab : null),
  );

  assert.deepEqual(
    (map.props ?? []).map((one) => [one.gx, (one.collision as Record<string, unknown>).to]),
    [
      [1, 'cave'],
      [5, 'town'],
      [9, ''],
    ],
  );
  // The record itself is untouched, or the second placement would have been
  // read out of a prefab the first one had already edited.
  assert.equal(
    ((doorPrefab.props[0] as Record<string, unknown>).collision as Record<string, unknown>).to,
    '',
  );
});

test('an override reaches a setting inside a wiring, not only a loose field', () => {
  const bench = normalizePrefab({
    id: 'bench',
    label: 'Bench',
    props: [{ gx: 0, gy: 0, id: 'table', interact: { do: 'openUI', ui: 'crafting' } }],
  });

  const map = expandPrefabs(
    { id: 'yard', prefabs: [{ gx: 0, gy: 0, id: 'bench', set: { ui: 'character' } }] } as unknown as GameMap,
    () => bench,
  );

  assert.deepEqual(map.props?.[0].interact, { do: 'openUI', ui: 'character' });
});

test('an override names a setting the prefab has not got, and nothing happens', () => {
  const map = expandPrefabs(
    {
      id: 'yard',
      prefabs: [{ gx: 0, gy: 0, id: 'door', set: { nonesuch: 'x', ui: 'character' } }],
    } as unknown as GameMap,
    () => doorPrefab,
  );

  // Not added. A setting lands where that name already is and nowhere else, so
  // a stale override is inert rather than quietly writing a field the game will
  // then read.
  const child = (map.props?.[0] ?? {}) as Record<string, unknown>;
  assert.equal('nonesuch' in child, false);
  assert.equal('ui' in (child.collision as Record<string, unknown>), false);
});

test('a placement carrying settings round-trips through a save', async () => {
  const doc = createDocument(
    {
      ...mapDoc(['....', '....'], { id: 'yard', name: 'Yard' }),
      prefabs: [{ gx: 1, gy: 1, id: 'door', set: { to: 'cave' } }],
    } as unknown as GameMap,
    () => doorPrefab,
  );

  const source = serializeMap(doc.map, () => 'gr');
  const module = (await import(
    `data:text/javascript,${encodeURIComponent(source)}`
  )) as Record<string, GameMap>;
  const read = Object.values(module)[0];

  assert.deepEqual(read.prefabs, [{ gx: 1, gy: 1, id: 'door', set: { to: 'cave' } }]);
});

// ------------------------------------------------------- what the panel draws

test('a thing is offered the triggers that can reach it, and no others', () => {
  const triggers = (list: string, entry?: Record<string, unknown>) =>
    Object.keys(EVENTS).filter((e) => eventApplies(e, list, entry));

  assert.deepEqual(triggers('props').sort(), ['collision', 'interact']);
  // Being hit means having a body that takes damage, which only an actor has.
  assert.ok(!triggers('props').includes('hit'));
  // A light is not a thing you walk into, and a spawn is a name and a tile.
  assert.deepEqual(triggers('lights'), []);
  assert.deepEqual(triggers('spawns'), []);

  // A prefab gets everything its contents can actually answer for.
  assert.deepEqual(triggers('prefabs', { id: 'torch' }).sort(), ['collision', 'interact']);
  assert.deepEqual(
    triggers('prefabs', { id: 'vase', archetype: 'vase' }).sort(),
    ['collision', 'dead', 'hit', 'interact'],
  );
});

test('the action picker offers every registered action, under its own heading', () => {
  const groups = actionGroups();
  const offered = groups.flatMap((group) => group.options.map(([id]) => id));
  assert.deepEqual(
    [...offered].sort(),
    Object.keys(ACTIONS).sort(),
    'the picker and the registry disagree, so something offered will not run',
  );
  assert.ok(
    groups.every((group) => group.label && group.options.length),
    'a heading with nothing under it is a heading that reads as a bug',
  );
});

test('a placement offers the settings its own prefab has, and no others', () => {
  const rules = {
    list: (kind: string) =>
      kind === 'prefabs' ? [doorPrefab as unknown as Record<string, unknown>] : [],
  };
  const keys = fieldsFor('prefabs', { gx: 0, gy: 0, id: 'door' }, rules).map((one) => one.key);

  // A portal prefab: where this one goes, and where it puts you down.
  assert.ok(keys.includes('set.to'));
  assert.ok(keys.includes('set.spawn'));
  // Not a panel to open: nothing in this prefab opens one.
  assert.ok(!keys.includes('set.ui'));
  // A placement naming nothing offers nothing rather than everything.
  assert.deepEqual(
    fieldsFor('prefabs', { gx: 0, gy: 0 }, rules)
      .map((one) => one.key)
      .filter((key) => key.startsWith('set.')),
    [],
  );
});

// ---------------------------------------------- a prefab wired as one thing

test('a prefab carries its own triggers, and a placement sets what they do', () => {
  // The bench is a table, a light and a stool. What you walk up to is the
  // bench, so the wiring is the prefab's rather than the table's.
  const bench = {
    id: 'bench',
    label: 'Bench',
    interact: [
      { do: 'openUI', ui: 'crafting' },
      { do: 'say', message: 'You set to work.' },
    ],
    props: [{ gx: 0, gy: 0, id: 'table' }],
  };

  assert.deepEqual(
    wiringsFor('prefabs', 'interact', bench).map((one) => one.do),
    ['openUI', 'say'],
    'a prefab with two actions under one trigger runs both',
  );

  // This one of them opens the character sheet and says something else.
  const mine = override(bench, { ui: 'character', message: 'Not here.' });
  assert.deepEqual(mine.interact, [
    { do: 'openUI', ui: 'character' },
    { do: 'say', message: 'Not here.' },
  ]);
  // And the record is untouched, or the next placement would read this one's.
  assert.deepEqual(bench.interact, [
    { do: 'openUI', ui: 'crafting' },
    { do: 'say', message: 'You set to work.' },
  ]);
});

test('a placement offers the settings of the prefab"s own triggers, not just its parts"', () => {
  const bench = {
    id: 'bench',
    label: 'Bench',
    interact: [{ do: 'openUI', ui: 'crafting' }],
    props: [{ gx: 0, gy: 0, id: 'table', collision: { do: 'say', message: 'Mind the corner.' } }],
  };
  const rules = { list: (kind: string) => (kind === 'prefabs' ? [bench] : []) };
  const keys = fieldsFor('prefabs', { gx: 0, gy: 0, id: 'bench' }, rules).map((one) => one.key);

  assert.ok(keys.includes('set.ui'), 'the prefab"s own trigger offers nothing to set');
  assert.ok(keys.includes('set.message'), 'a part"s trigger offers nothing to set');
  assert.ok(!keys.includes('set.to'), 'nothing here teleports');
});

test('a list of actions survives being written to a map file and read back', async () => {
  const doc = createDocument(
    {
      ...mapDoc(['....', '....'], { id: 'yard', name: 'Yard' }),
      props: [
        {
          gx: 1,
          gy: 1,
          id: 'lever',
          interact: [
            { do: 'say', message: 'It gives.' },
            { do: 'teleport', to: 'cave', spawn: 'mouth' },
          ],
        },
      ],
    } as unknown as GameMap,
    () => null,
  );

  const source = serializeMap(doc.map, () => 'gr');
  const module = (await import(
    `data:text/javascript,${encodeURIComponent(source)}`
  )) as Record<string, GameMap>;
  const read = Object.values(module)[0];

  assert.deepEqual(read.props?.[0].interact, [
    { do: 'say', message: 'It gives.' },
    { do: 'teleport', to: 'cave', spawn: 'mouth' },
  ]);
});

test('a prefab keeps its triggers through every trip that reshapes it', () => {
  // The bug this stands for: the wirings saved to the file correctly and were
  // stripped the moment the file was read back, so a wired prefab did nothing
  // and looked like it had never been wired.
  const wired = normalizePrefab({
    id: 'arch',
    label: 'Arch',
    collision: [{ do: 'say', message: 'It hums.' }],
    props: [{ gx: 0, gy: 0, id: 'arch' }],
  } as never);

  assert.deepEqual(wired.collision, [{ do: 'say', message: 'It hums.' }]);
  // And read a second time, which is what a reload is.
  assert.deepEqual(normalizePrefab(wired).collision, [{ do: 'say', message: 'It hums.' }]);
  // The footprint is still measured rather than taken from the record.
  assert.equal(wired.w, 1);
  assert.equal(wired.h, 1);
  assert.deepEqual(wiringsFor('prefabs', 'collision', wired).map((one) => one.do), ['say']);
});

test('editing a prefab as a map gives it back with its triggers still on it', () => {
  const was = normalizePrefab({
    id: 'arch',
    label: 'Arch',
    collision: [{ do: 'say', message: 'It hums.' }],
    props: [{ gx: 0, gy: 0, id: 'arch' }],
  } as never);

  const back = mapToPrefab(prefabToMap(was), was);
  assert.deepEqual(back.collision, [{ do: 'say', message: 'It hums.' }]);
  assert.equal(back.id, 'arch');
  assert.equal(back.props.length, 1);
});
