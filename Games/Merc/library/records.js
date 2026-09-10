/**
 * The records in a game's assets folder, as the modules beside this one read
 * them.
 *
 * A record lives in the folder with the files it is made of — a material is
 * `Materials/Wood/material.json` next to the two pictures it names — so where
 * one was found is also where its files are, and that is what `path` carries.
 *
 * `path` is never written into the file itself. If it were, renaming a folder
 * would mean rewriting every record inside it to stay true, and the rename
 * would be a thing that could half-fail. Derived from where the file was
 * found, it costs nothing and cannot disagree.
 */
export function recordsFrom(found, file) {
  return (
    Object.entries(found)
      // Sorted, because a glob hands them back in the filesystem's order and a
      // list that reshuffled between two machines would make every save a diff.
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, record]) => ({
        ...record,
        // '../assets/Materials/Wood/material.json' → 'Materials/Wood'
        path: key.slice('../assets/'.length, -(file.length + 1)),
      }))
  );
}
