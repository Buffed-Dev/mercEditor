import type { EdgeProfile, ProfileTransition } from '../../../src/data/profiles.ts';
import { Field } from '../../fields/Field';
import { FilePicker, type Files } from '../../ui/FilePicker';
import { Row, RowList } from './RowList';

/**
 * The corners an edge profile uses where it meets one particular other profile.
 *
 * Only consulted when this profile owns the corner — when its priority is the
 * higher of the two (see `cornerMesh`). A pair with nothing listed falls back
 * to this profile's plain outer and inner corners.
 */
export function ProfileTransitions({
  profile,
  options,
  files,
  onPatch,
}: {
  profile: EdgeProfile;
  /** Every other profile, as [id, label]. */
  options: readonly (readonly [string, string])[];
  files: Files;
  onPatch: (patch: { transitions: ProfileTransition[] }) => void;
}) {
  const rows = profile.transitions;
  const others = options.filter(([id]) => id !== profile.id);
  const write = (at: number, patch: Partial<ProfileTransition>) =>
    onPatch({ transitions: rows.map((one, i) => (i === at ? { ...one, ...patch } : one)) });

  return (
    <RowList
      title="Transition corners"
      count={rows.length}
      empty="Meeting another profile uses this profile's own corners."
      addLabel="Add"
      onAdd={() =>
        onPatch({ transitions: [...rows, { profile: others[0]?.[0] ?? '', outerCorner: '', innerCorner: '' }] })
      }
    >
      {rows.map((row, at) => (
        <Row
          key={at}
          label={`Transition ${at + 1}`}
          onRemove={() => onPatch({ transitions: rows.filter((_, i) => i !== at) })}
        >
          <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
            <Field
              field={{ key: 'profile', kind: 'select', label: 'Meeting', options: others }}
              value={row.profile}
              onInput={() => {}}
              onChange={(value) => write(at, { profile: String(value) })}
            />
            <FilePicker
              label="Outer corner"
              value={row.outerCorner}
              accept="mesh"
              files={files}
              onChange={(value) => write(at, { outerCorner: value })}
            />
            <FilePicker
              label="Inner corner"
              value={row.innerCorner}
              accept="mesh"
              files={files}
              onChange={(value) => write(at, { innerCorner: value })}
            />
          </div>
        </Row>
      ))}
    </RowList>
  );
}
