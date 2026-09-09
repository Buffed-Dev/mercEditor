/**
 * Printing JavaScript values back out as source.
 *
 * The editor writes real modules to disk, so anything it emits has to parse. A
 * name typed into the inspector can contain an apostrophe, a quote or a
 * backslash, and interpolating one straight into `'…'` writes a file that will
 * not load — with the failure landing at import time, well away from the typing
 * that caused it.
 */

// Characters that cannot sit raw inside a single-quoted literal. U+2028 and
// U+2029 are in the list because a JS parser treats them as line terminators
// even though nothing renders them, which makes the syntax error baffling.
const UNSAFE = ["'", '\\', '\n', '\r', ' ', ' '];

/** A string as a JS literal. Prefers the house single quotes when it can. */
export function quote(value: unknown): string {
  const text = String(value ?? '');
  if (UNSAFE.some((character) => text.includes(character))) return JSON.stringify(text);
  return `'${text}'`;
}

/** A number, trimmed of float noise like 0.30000000000000004. */
export function number(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return String(Number(value.toFixed(6)));
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Bare when it is a valid identifier, quoted when it is not. */
function propertyKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : quote(key);
}

/**
 * A value as pretty-printed source. Objects and arrays stay on one line while
 * they are short enough to read that way and break otherwise, which is what
 * keeps a list of attributes scannable rather than hundreds of lines tall.
 */
export function literal(value: unknown, indent = ''): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return number(value);
  if (typeof value === 'string') return quote(value);

  const inner = `${indent}  `;

  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const parts = value.map((item) => literal(item, inner));
    const oneLine = `[${parts.join(', ')}]`;
    if (oneLine.length + indent.length <= 96 && !oneLine.includes('\n')) return oneLine;
    return `[\n${parts.map((part) => `${inner}${part}`).join(',\n')},\n${indent}]`;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (!entries.length) return '{}';
    const parts = entries.map(([key, item]) => `${propertyKey(key)}: ${literal(item, inner)}`);
    const oneLine = `{ ${parts.join(', ')} }`;
    if (oneLine.length + indent.length <= 96 && !oneLine.includes('\n')) return oneLine;
    return `{\n${parts.map((part) => `${inner}${part}`).join(',\n')},\n${indent}}`;
  }

  return 'null';
}
